"""Keyword search over the bundled docs index, for the Assistant's Ask mode.

Pure Python BM25 over the asset built by ``docs_corpus``: no embedding model, no
network, no new dependency. The corpus is a couple of thousand short chunks, so
an in-memory inverted index answers a query in well under a millisecond.

The index is loaded once per process. Agent tools are deep-copied on every call,
so nothing here may live on a component instance.
"""

from __future__ import annotations

import json
import math
import os
import re
from collections import Counter
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from lfx.log.logger import logger

DOCS_INDEX_PATH = Path(__file__).resolve().parent.parent / "assets" / "docs_index.json"
DOCS_BASE_URL_ENV = "LANGFLOW_ASSISTANT_DOCS_BASE_URL"
DEFAULT_DOCS_BASE_URL = "https://docs.langflow.org"

DEFAULT_SEARCH_LIMIT = 5
MAX_SEARCH_LIMIT = 10
SNIPPET_CHARS = 500
# ``read`` returns a whole page or section; cap it so one call cannot flood the context.
MAX_READ_CHARS = 6000

# BM25 parameters (the usual defaults).
_K1 = 1.5
_B = 0.75
# A query word in the page title or the section heading says more about what the
# chunk is for than the same word somewhere in its body.
_TITLE_WEIGHT = 2
_HEADING_WEIGHT = 3

_TOKEN_RE = re.compile(r"[a-z0-9_]+")
_MIN_PLURAL_STEM = 3
_STOPWORDS = frozenset(
    """
    a an and are as at be by can do does for from how i if in into is it its my of on or so
    that the their then there these this to use used using was what when where which who why
    will with you your
    """.split()
)


@dataclass(frozen=True)
class DocsHit:
    """One search result: enough to answer from, plus what is needed to cite it."""

    ref: str
    title: str
    heading: str
    url: str
    snippet: str
    score: float


def tokenize(text: str) -> list[str]:
    """Lowercase word tokens without stopwords, with a plain trailing "s" folded away."""
    tokens = []
    for token in _TOKEN_RE.findall(text.lower()):
        if token in _STOPWORDS:
            continue
        if len(token) > _MIN_PLURAL_STEM and token.endswith("s") and not token.endswith("ss"):
            token = token[:-1]  # noqa: PLW2901
        tokens.append(token)
    return tokens


class _Index:
    def __init__(self, data: dict) -> None:
        self.docs: list[dict] = data["docs"]
        self.chunks: list[dict] = data["chunks"]
        self.postings: dict[str, list[tuple[int, int]]] = {}
        self.lengths: list[int] = []
        for chunk_id, chunk in enumerate(self.chunks):
            doc = self.docs[chunk["doc"]]
            counts: Counter[str] = Counter(tokenize(chunk["text"]))
            for token in tokenize(doc["title"]):
                counts[token] += _TITLE_WEIGHT
            for token in tokenize(chunk["heading"]):
                counts[token] += _HEADING_WEIGHT
            self.lengths.append(sum(counts.values()))
            for token, frequency in counts.items():
                self.postings.setdefault(token, []).append((chunk_id, frequency))
        self.average_length = (sum(self.lengths) / len(self.lengths)) if self.lengths else 0.0

    def ref_of(self, chunk: dict) -> str:
        slug = self.docs[chunk["doc"]]["slug"]
        return f"{slug}#{chunk['anchor']}" if chunk["anchor"] else slug

    def rank(self, query: str) -> list[tuple[int, float]]:
        total = len(self.chunks)
        scores: dict[int, float] = {}
        for token in dict.fromkeys(tokenize(query)):
            posting = self.postings.get(token)
            if not posting:
                continue
            idf = math.log(1 + (total - len(posting) + 0.5) / (len(posting) + 0.5))
            for chunk_id, frequency in posting:
                norm = 1 - _B + _B * self.lengths[chunk_id] / self.average_length
                scores[chunk_id] = scores.get(chunk_id, 0.0) + idf * frequency * (_K1 + 1) / (frequency + _K1 * norm)
        # Ties break on position so the result order is stable.
        return sorted(scores.items(), key=lambda item: (-item[1], item[0]))


@lru_cache(maxsize=1)
def _load_index() -> _Index | None:
    try:
        data = json.loads(DOCS_INDEX_PATH.read_text(encoding="utf-8"))
        return _Index(data)
    except FileNotFoundError:
        logger.info("assistant.docs_index.missing path=%s", DOCS_INDEX_PATH)
    except (OSError, ValueError, KeyError, TypeError) as exc:
        logger.warning("assistant.docs_index.unreadable path=%s error=%s", DOCS_INDEX_PATH, exc)
    return None


def docs_index_available() -> bool:
    """Whether the bundled docs index can be used. Ask mode falls back to the live site if not."""
    return _load_index() is not None


def docs_base_url() -> str:
    """Where cited pages live. Overridable so a closed network can point at an internal mirror."""
    return (os.getenv(DOCS_BASE_URL_ENV) or DEFAULT_DOCS_BASE_URL).rstrip("/")


def _url_for(ref: str) -> str:
    return f"{docs_base_url()}{ref}"


def search(query: str, limit: int = DEFAULT_SEARCH_LIMIT) -> list[DocsHit]:
    """Best-matching doc sections for an English keyword query, best first."""
    index = _load_index()
    if index is None or not query or not query.strip():
        return []
    limit = max(1, min(int(limit), MAX_SEARCH_LIMIT))
    hits: list[DocsHit] = []
    seen: set[str] = set()
    for chunk_id, score in index.rank(query):
        if len(hits) == limit:
            break
        chunk = index.chunks[chunk_id]
        ref = index.ref_of(chunk)
        # A long section is several chunks; one hit per section keeps the results distinct.
        if ref in seen:
            continue
        seen.add(ref)
        text = chunk["text"]
        hits.append(
            DocsHit(
                ref=ref,
                title=index.docs[chunk["doc"]]["title"],
                heading=chunk["heading"],
                url=_url_for(ref),
                snippet=text if len(text) <= SNIPPET_CHARS else text[:SNIPPET_CHARS].rstrip() + "...",
                score=round(score, 3),
            )
        )
    return hits


def read(ref: str) -> dict | None:
    """Full text of a page (``/slug``) or of one section (``/slug#anchor``).

    ``ref`` comes from a search hit. It is only ever matched against the index,
    never turned into a path, so it cannot reach outside the bundled docs.
    """
    index = _load_index()
    if index is None or not ref:
        return None
    slug, _, anchor = ref.strip().partition("#")
    doc_id = next((i for i, doc in enumerate(index.docs) if doc["slug"] == slug), None)
    if doc_id is None:
        return None
    chunks = [c for c in index.chunks if c["doc"] == doc_id and (not anchor or c["anchor"] == anchor)]
    if not chunks:
        return None
    parts: list[str] = []
    previous_heading = None
    for chunk in chunks:
        if chunk["heading"] != previous_heading:
            parts.append(f"## {chunk['heading']}")
            previous_heading = chunk["heading"]
        parts.append(chunk["text"])
    text = "\n\n".join(parts)
    truncated = len(text) > MAX_READ_CHARS
    return {
        "title": index.docs[doc_id]["title"],
        "url": _url_for(f"{slug}#{anchor}" if anchor else slug),
        "text": text[:MAX_READ_CHARS].rstrip() + ("\n\n[truncated]" if truncated else ""),
        "truncated": truncated,
    }


def reset_cache() -> None:
    """Forget the loaded index (tests, and after the asset is regenerated)."""
    _load_index.cache_clear()
