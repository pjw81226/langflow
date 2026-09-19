"""The docs corpus builder turns Docusaurus MDX into plain-text chunks for Ask mode."""

from __future__ import annotations

import json
from typing import TYPE_CHECKING

from langflow.agentic.services.docs_corpus import (
    MAX_CHUNK_CHARS,
    build_corpus,
    compute_corpus_hash,
    dump_index,
    slugify,
)

if TYPE_CHECKING:
    from pathlib import Path


def _write(root: Path, relative: str, content: str) -> None:
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def _page(body: str, *, title: str = "Sample page", slug: str = "/sample") -> str:
    return f"---\ntitle: {title}\nslug: {slug}\n---\n\n{body}"


def _texts(index: dict) -> str:
    return "\n".join(chunk["text"] for chunk in index["chunks"])


def test_pages_without_a_title_or_slug_are_skipped(tmp_path):
    _write(tmp_path, "Flows/page.mdx", _page("Intro text for the page."))
    _write(tmp_path, "API/README.md", "# Not a site page\n\nNo front matter here.")

    index = build_corpus(tmp_path)

    assert [doc["path"] for doc in index["docs"]] == ["Flows/page.mdx"]
    assert index["docs"][0] == {"path": "Flows/page.mdx", "slug": "/sample", "title": "Sample page"}


def test_mdx_imports_are_dropped_but_imports_inside_code_fences_survive(tmp_path):
    body = (
        "import Tabs from '@theme/Tabs';\n"
        "export const meta = {};\n\n"
        "Call the API like this:\n\n"
        "```python\nimport requests\nrequests.get(url)\n```\n"
    )
    _write(tmp_path, "page.mdx", _page(body))

    text = _texts(build_corpus(tmp_path))

    assert "@theme/Tabs" not in text
    assert "export const" not in text
    assert "import requests" in text


def test_partials_are_inlined_where_they_are_used(tmp_path):
    _write(tmp_path, "_partial-note.mdx", "Hidden parameters are behind the **Controls** button.")
    body = "import PartialNote from '@site/docs/_partial-note.mdx';\n\nBefore.\n\n<PartialNote />\n\nAfter."
    _write(tmp_path, "page.mdx", _page(body))

    index = build_corpus(tmp_path)
    text = _texts(index)

    assert "Before." in text
    assert "Hidden parameters are behind the **Controls** button." in text
    assert "After." in text
    assert "<PartialNote" not in text
    # A partial is never a page of its own.
    assert len(index["docs"]) == 1


def test_raw_loader_samples_are_inlined_as_code(tmp_path):
    _write(tmp_path, "API/examples/run.sh", 'curl -X POST "$URL/api/v1/run/$FLOW_ID"\n')
    body = (
        "import exampleRun from '!!raw-loader!@site/docs/API/examples/run.sh';\n\n"
        'Run it:\n\n<CodeBlock language="bash">{exampleRun}</CodeBlock>\n'
    )
    _write(tmp_path, "page.mdx", _page(body))

    text = _texts(build_corpus(tmp_path))

    assert "```bash" in text
    assert 'curl -X POST "$URL/api/v1/run/$FLOW_ID"' in text
    assert "{exampleRun}" not in text


def test_jsx_is_stripped_and_its_text_is_kept(tmp_path):
    body = (
        'Click <Icon name="Play" aria-hidden="true"/> **Playground**.\n\n'
        '<Tabs>\n<TabItem value="a" label="Python" default>\n\nUse the client.\n\n</TabItem>\n</Tabs>\n\n'
        "![A screenshot](/img/shot.png)\n\n"
        "See [the run endpoint](/api-flows-run) for details.\n"
    )
    _write(tmp_path, "page.mdx", _page(body))

    text = _texts(build_corpus(tmp_path))

    assert "Click **Playground**." in text
    assert "[Python]" in text
    assert "Use the client." in text
    assert "shot.png" not in text
    assert "See the run endpoint for details." in text
    assert "<" not in text


def test_admonitions_become_labelled_text(tmp_path):
    body = "Body.\n\n:::tip\nConnect a **Chat Input** first.\n:::\n\n:::warning Keys\nNever paste a key here.\n:::\n"
    _write(tmp_path, "page.mdx", _page(body))

    text = _texts(build_corpus(tmp_path))

    assert "Tip:\nConnect a **Chat Input** first." in text
    assert "Warning (Keys):" in text
    assert ":::" not in text


def test_sections_use_explicit_anchors_and_slugified_headings(tmp_path):
    long = "This sentence pads the section so that it is not merged into its neighbour. " * 4
    body = f"{long}\n\n## Run a flow {{#run-a-flow}}\n\n{long}\n\n### Use `voice` mode!\n\n{long}\n"
    _write(tmp_path, "page.mdx", _page(body))

    index = build_corpus(tmp_path)

    assert [(c["heading"], c["anchor"]) for c in index["chunks"]] == [
        ("Sample page", ""),
        ("Run a flow", "run-a-flow"),
        ("Use voice mode!", "use-voice-mode"),
    ]


def test_headings_inside_code_fences_do_not_start_a_section(tmp_path):
    body = "Intro.\n\n```bash\n## not a heading\necho ok\n```\n"
    _write(tmp_path, "page.mdx", _page(body))

    index = build_corpus(tmp_path)

    assert len(index["chunks"]) == 1
    assert "## not a heading" in index["chunks"][0]["text"]


def test_navigation_sections_are_left_out(tmp_path):
    long = "Useful explanation of the feature that people search for. " * 5
    body = f"{long}\n\n## See also\n\n- [Other page](/other)\n\n## Next steps\n\n- [More](/more)\n"
    _write(tmp_path, "page.mdx", _page(body))

    index = build_corpus(tmp_path)

    assert [c["heading"] for c in index["chunks"]] == ["Sample page"]
    assert "Other page" not in _texts(index)


def test_short_sections_are_merged_into_the_previous_chunk(tmp_path):
    long = "A proper paragraph that explains how the feature works in practice. " * 4
    body = f"{long}\n\n## Tiny\n\nOne line.\n"
    _write(tmp_path, "page.mdx", _page(body))

    index = build_corpus(tmp_path)

    assert len(index["chunks"]) == 1
    assert index["chunks"][0]["text"].endswith("Tiny\nOne line.")


def test_long_sections_are_split_under_the_cap_even_without_paragraph_breaks(tmp_path):
    paragraphs = "\n\n".join(f"Paragraph {i}. " + "word " * 120 for i in range(6))
    one_block = "\n".join("line " * 30 for _ in range(40))
    _write(tmp_path, "page.mdx", _page(f"{paragraphs}\n\n## Block\n\n{one_block}\n"))

    index = build_corpus(tmp_path)

    assert len(index["chunks"]) > 2
    assert max(len(c["text"]) for c in index["chunks"]) <= MAX_CHUNK_CHARS


def test_the_index_is_deterministic_and_round_trips(tmp_path):
    _write(tmp_path, "b.mdx", _page("Second page body text.", title="B", slug="/b"))
    _write(tmp_path, "a.mdx", _page("First page body text.", title="A", slug="/a"))

    first, second = build_corpus(tmp_path), build_corpus(tmp_path)

    assert first == second
    assert [doc["slug"] for doc in first["docs"]] == ["/a", "/b"]
    assert first["corpus_hash"] == compute_corpus_hash(first["docs"], first["chunks"])
    assert json.loads(dump_index(first)) == first


def test_slugify_matches_the_site_anchors():
    assert slugify("Run a flow") == "run-a-flow"
    assert slugify("Generate requirements.txt for flows") == "generate-requirementstxt-for-flows"
    assert slugify("Use `voice` mode!") == "use-voice-mode"
