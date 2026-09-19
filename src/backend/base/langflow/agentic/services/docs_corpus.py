"""Turn the Docusaurus docs into plain-text chunks for the Assistant's Ask mode.

Ask mode answers "how do I use Langflow" questions. Grounding it on the docs that
ship with this checkout instead of the live site keeps the answers on the same
version as the running server, makes them fast, and works with no internet.

This module is a pure builder: it reads ``docs/docs`` and returns the index as a
dict. It runs at development time (see ``scripts/build_assistant_docs_index.py``);
the server only ever reads the generated asset through ``docs_search``.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

import yaml

if TYPE_CHECKING:
    from pathlib import Path

SCHEMA_VERSION = 1

# A chunk is what one search hit returns, so it has to fit comfortably in a tool
# result: long enough to hold a full procedure, short enough to rank precisely.
MAX_CHUNK_CHARS = 1500
# Sections shorter than this are usually a lone sentence under a heading; on
# their own they rank well for the heading words and answer nothing.
MIN_CHUNK_CHARS = 200
# Code samples pulled in through raw-loader. The point is to show the shape of a
# call, not to reproduce a 200-line script.
MAX_SAMPLE_LINES = 40
# Partials can include partials.
MAX_PARTIAL_DEPTH = 2

# Navigation sections: lists of links that match many queries and answer none.
_SKIPPED_SECTIONS = frozenset({"see also", "next steps"})

_FRONT_MATTER_RE = re.compile(r"\A---\s*\n(.*?)\n---\s*\n", re.DOTALL)
_FENCE_RE = re.compile(r"^\s*(```|~~~)")
_HEADING_RE = re.compile(r"^(#{2,4})\s+(.*?)\s*$")
_ANCHOR_RE = re.compile(r"\s*\{#([A-Za-z0-9_-]+)\}\s*$")
_IMPORT_PARTIAL_RE = re.compile(r"""^import\s+(\w+)\s+from\s+['"]@site/docs/(_partial-[\w.-]+\.mdx)['"]""")
_IMPORT_RAW_RE = re.compile(r"""^import\s+(\w+)\s+from\s+['"]!!raw-loader!@site/docs/([^'"]+)['"]""")
_IMPORT_OR_EXPORT_RE = re.compile(r"^(import|export)\s")
_PARTIAL_USE_RE = re.compile(r"^\s*<(\w+)\s*/>\s*$")
_CODEBLOCK_RE = re.compile(r"<CodeBlock\b([^>]*)>\s*\{(\w+)\}\s*</CodeBlock>")
_LANGUAGE_ATTR_RE = re.compile(r"""\blanguage=["'](\w+)["']""")
_TAB_ITEM_RE = re.compile(r"""<TabItem\b[^>]*?\blabel=["']([^"']+)["'][^>]*>""")
_ADMONITION_OPEN_RE = re.compile(r"^\s*:::(\w+)\s*(.*)$")
_ADMONITION_CLOSE_RE = re.compile(r"^\s*:::\s*$")
_IMAGE_RE = re.compile(r"!\[[^\]]*\]\([^)]*\)")
_LINK_RE = re.compile(r"\[([^\]]+)\]\([^)]*\)")
_MDX_COMMENT_RE = re.compile(r"\{/\*.*?\*/\}", re.DOTALL)
_HTML_COMMENT_RE = re.compile(r"<!--.*?-->", re.DOTALL)
_JSX_TAG_RE = re.compile(r"</?[A-Za-z][\w.]*\b[^<>]*?/?>")
_BLANK_RUN_RE = re.compile(r"\n{3,}")
_SPACE_RUN_RE = re.compile(r" {2,}")
_SLUG_DROP_RE = re.compile(r"[^\w\s-]")
_SLUG_SPACE_RE = re.compile(r"\s+")


@dataclass
class _Section:
    heading: str
    anchor: str
    lines: list[str] = field(default_factory=list)


def slugify(heading: str) -> str:
    """Anchor Docusaurus derives from a heading (github-slugger rules, close enough)."""
    text = re.sub(r"[`*_]", "", heading).strip().lower()
    text = _SLUG_DROP_RE.sub("", text)
    return _SLUG_SPACE_RE.sub("-", text)


def _split_front_matter(raw: str) -> tuple[dict, str]:
    match = _FRONT_MATTER_RE.match(raw)
    if not match:
        return {}, raw
    try:
        meta = yaml.safe_load(match.group(1)) or {}
    except yaml.YAMLError:
        meta = {}
    return (meta if isinstance(meta, dict) else {}), raw[match.end() :]


def _read_sample(docs_root: Path, relative: str) -> list[str]:
    path = docs_root / relative
    if not path.is_file():
        return []
    lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    if len(lines) > MAX_SAMPLE_LINES:
        lines = [*lines[:MAX_SAMPLE_LINES], "..."]
    return lines


def _clean_prose(line: str) -> str:
    """Strip markup from one line that is known to be outside a code fence."""
    line = _IMAGE_RE.sub("", line)
    line = _LINK_RE.sub(r"\1", line)
    line = _TAB_ITEM_RE.sub(r"[\1]", line)
    line = _JSX_TAG_RE.sub("", line)
    # A removed inline tag (an icon before a button name) leaves a double space.
    indent = line[: len(line) - len(line.lstrip())]
    return (indent + _SPACE_RUN_RE.sub(" ", line.strip())).rstrip()


def _render_body(body: str, docs_root: Path, depth: int = 0) -> list[str]:
    """MDX body -> plain lines. Code fences are kept verbatim; everything else is de-marked."""
    body = _MDX_COMMENT_RE.sub("", _HTML_COMMENT_RE.sub("", body))
    partials: dict[str, str] = {}
    samples: dict[str, str] = {}
    out: list[str] = []
    in_fence = False

    for raw_line in body.splitlines():
        if _FENCE_RE.match(raw_line):
            in_fence = not in_fence
            out.append(raw_line.rstrip())
            continue
        if in_fence:
            # Real code: an `import` here belongs to the sample, not to MDX.
            out.append(raw_line.rstrip())
            continue

        partial_import = _IMPORT_PARTIAL_RE.match(raw_line)
        if partial_import:
            partials[partial_import.group(1)] = partial_import.group(2)
            continue
        raw_import = _IMPORT_RAW_RE.match(raw_line)
        if raw_import:
            samples[raw_import.group(1)] = raw_import.group(2)
            continue
        if _IMPORT_OR_EXPORT_RE.match(raw_line):
            continue

        partial_use = _PARTIAL_USE_RE.match(raw_line)
        if partial_use and partial_use.group(1) in partials:
            if depth < MAX_PARTIAL_DEPTH:
                partial_path = docs_root / partials[partial_use.group(1)]
                if partial_path.is_file():
                    _meta, partial_body = _split_front_matter(partial_path.read_text(encoding="utf-8"))
                    out.extend(_render_body(partial_body, docs_root, depth + 1))
            continue

        code_block = _CODEBLOCK_RE.search(raw_line)
        if code_block and code_block.group(2) in samples:
            sample_lines = _read_sample(docs_root, samples[code_block.group(2)])
            if sample_lines:
                language = _LANGUAGE_ATTR_RE.search(code_block.group(1))
                out.extend([f"```{language.group(1) if language else ''}", *sample_lines, "```"])
            continue

        admonition = _ADMONITION_OPEN_RE.match(raw_line)
        if admonition and not _ADMONITION_CLOSE_RE.match(raw_line):
            label = admonition.group(1).capitalize()
            title = admonition.group(2).strip().strip("[]")
            out.append(f"{label} ({title}):" if title else f"{label}:")
            continue
        if _ADMONITION_CLOSE_RE.match(raw_line):
            continue

        out.append(_clean_prose(raw_line))

    return out


def _split_sections(lines: list[str], title: str) -> list[_Section]:
    sections = [_Section(heading=title, anchor="")]
    in_fence = False
    for line in lines:
        if _FENCE_RE.match(line):
            in_fence = not in_fence
        heading = None if in_fence else _HEADING_RE.match(line)
        if heading:
            text = heading.group(2)
            explicit = _ANCHOR_RE.search(text)
            if explicit:
                text = _ANCHOR_RE.sub("", text)
            text = re.sub(r"[`*]", "", text).strip()
            sections.append(_Section(heading=text, anchor=explicit.group(1) if explicit else slugify(text)))
            continue
        sections[-1].lines.append(line)
    return [s for s in sections if s.heading.strip().lower() not in _SKIPPED_SECTIONS]


def _normalize(lines: list[str]) -> str:
    return _BLANK_RUN_RE.sub("\n\n", "\n".join(lines)).strip()


def _split_long(text: str) -> list[str]:
    """Split on paragraph boundaries; fall back to lines for one oversized paragraph."""
    if len(text) <= MAX_CHUNK_CHARS:
        return [text]
    pieces: list[str] = []
    current = ""
    for paragraph in text.split("\n\n"):
        units = [paragraph]
        if len(paragraph) > MAX_CHUNK_CHARS:
            units, buffer = [], ""
            for line in paragraph.split("\n"):
                # A single line longer than the cap (a minified sample) is cut hard.
                while len(line) > MAX_CHUNK_CHARS:
                    if buffer:
                        units.append(buffer)
                        buffer = ""
                    units.append(line[:MAX_CHUNK_CHARS])
                    line = line[MAX_CHUNK_CHARS:]  # noqa: PLW2901
                if buffer and len(buffer) + 1 + len(line) > MAX_CHUNK_CHARS:
                    units.append(buffer)
                    buffer = line
                else:
                    buffer = f"{buffer}\n{line}" if buffer else line
            if buffer:
                units.append(buffer)
        for unit in units:
            if current and len(current) + 2 + len(unit) > MAX_CHUNK_CHARS:
                pieces.append(current)
                current = unit
            else:
                current = f"{current}\n\n{unit}" if current else unit
    if current:
        pieces.append(current)
    return pieces


def _chunk_document(doc_index: int, sections: list[_Section]) -> list[dict]:
    chunks: list[dict] = []
    for section in sections:
        text = _normalize(section.lines)
        if not text:
            continue
        # A stub section reads better as the tail of the section before it.
        if len(text) < MIN_CHUNK_CHARS and chunks:
            merged = f"{chunks[-1]['text']}\n\n{section.heading}\n{text}"
            if len(merged) <= MAX_CHUNK_CHARS:
                chunks[-1]["text"] = merged
                continue
        chunks.extend(
            {"doc": doc_index, "heading": section.heading, "anchor": section.anchor, "text": piece}
            for piece in _split_long(text)
        )
    return chunks


def iter_doc_files(docs_root: Path) -> list[Path]:
    """Every page of the docs site, in a stable order. Partials are only ever inlined."""
    return sorted(
        path
        for pattern in ("*.mdx", "*.md")
        for path in docs_root.rglob(pattern)
        if not path.name.startswith("_partial")
    )


def build_corpus(docs_root: Path) -> dict:
    """Build the search index for every page under ``docs_root`` that has a title and a slug."""
    docs: list[dict] = []
    chunks: list[dict] = []
    for path in iter_doc_files(docs_root):
        meta, body = _split_front_matter(path.read_text(encoding="utf-8"))
        title, slug = meta.get("title"), meta.get("slug")
        if not isinstance(title, str) or not isinstance(slug, str):
            continue
        sections = _split_sections(_render_body(body, docs_root), title)
        doc_chunks = _chunk_document(len(docs), sections)
        if not doc_chunks:
            continue
        docs.append({"path": path.relative_to(docs_root).as_posix(), "slug": slug, "title": title})
        chunks.extend(doc_chunks)
    return {
        "schema_version": SCHEMA_VERSION,
        "corpus_hash": compute_corpus_hash(docs, chunks),
        "doc_count": len(docs),
        "chunk_count": len(chunks),
        "docs": docs,
        "chunks": chunks,
    }


def compute_corpus_hash(docs: list[dict], chunks: list[dict]) -> str:
    """Fingerprint of the indexed content, so a stale asset is cheap to spot."""
    payload = json.dumps({"docs": docs, "chunks": chunks}, sort_keys=True, ensure_ascii=False)
    return "sha256:" + hashlib.sha256(payload.encode("utf-8")).hexdigest()


def dump_index(index: dict) -> str:
    """Serialize with one document and one chunk per line, so a docs edit is a small diff."""
    lines = [
        "{",
        f' "schema_version": {json.dumps(index["schema_version"])},',
        f' "corpus_hash": {json.dumps(index["corpus_hash"])},',
        f' "doc_count": {json.dumps(index["doc_count"])},',
        f' "chunk_count": {json.dumps(index["chunk_count"])},',
        ' "docs": [',
        ",\n".join("  " + json.dumps(doc, ensure_ascii=False, sort_keys=True) for doc in index["docs"]),
        " ],",
        ' "chunks": [',
        ",\n".join("  " + json.dumps(chunk, ensure_ascii=False, sort_keys=True) for chunk in index["chunks"]),
        " ]",
        "}",
    ]
    return "\n".join(lines) + "\n"
