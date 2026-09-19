"""Keyword search over the bundled docs index."""

from __future__ import annotations

import json

import pytest
from langflow.agentic.services import docs_search

INDEX = {
    "schema_version": 1,
    "corpus_hash": "sha256:test",
    "doc_count": 3,
    "chunk_count": 5,
    "docs": [
        {"path": "Flows/playground.mdx", "slug": "/concepts-playground", "title": "Test flows in the Playground"},
        {"path": "Develop/variables.mdx", "slug": "/configuration-global-variables", "title": "Global variables"},
        {"path": "Agents/agents.mdx", "slug": "/agents", "title": "Use Langflow agents"},
    ],
    "chunks": [
        {"doc": 0, "heading": "Test flows in the Playground", "anchor": "", "text": "The Playground runs a flow."},
        {
            "doc": 0,
            "heading": "Run a flow in the Playground",
            "anchor": "run-a-flow",
            "text": "Open the flow and click Playground. Enter a prompt in the chat.",
        },
        {
            "doc": 0,
            "heading": "Run a flow in the Playground",
            "anchor": "run-a-flow",
            "text": "A flow needs a Chat Input and a Chat Output to run in the Playground chat.",
        },
        {
            "doc": 1,
            "heading": "Create a global variable",
            "anchor": "create-a-global-variable",
            "text": "Open Settings, select Global Variables, and add your API key as a credential.",
        },
        {
            "doc": 2,
            "heading": "Agent instructions",
            "anchor": "agent-instructions",
            "text": "The system prompt tells the agent how to behave. Mention the playground only in passing.",
        },
    ],
}


@pytest.fixture
def docs_index(tmp_path, monkeypatch):
    path = tmp_path / "docs_index.json"
    path.write_text(json.dumps(INDEX), encoding="utf-8")
    monkeypatch.setattr(docs_search, "DOCS_INDEX_PATH", path)
    monkeypatch.delenv(docs_search.DOCS_BASE_URL_ENV, raising=False)
    docs_search.reset_cache()
    yield path
    docs_search.reset_cache()


@pytest.mark.usefixtures("docs_index")
def test_search_ranks_the_section_about_the_topic_first():
    hits = docs_search.search("add api key global variable")

    assert hits[0].ref == "/configuration-global-variables#create-a-global-variable"
    assert hits[0].title == "Global variables"
    assert hits[0].url == "https://docs.langflow.org/configuration-global-variables#create-a-global-variable"
    assert "API key" in hits[0].snippet


@pytest.mark.usefixtures("docs_index")
def test_a_heading_match_outranks_a_passing_mention():
    hits = docs_search.search("playground")

    assert hits[0].ref.startswith("/concepts-playground")
    assert hits[-1].ref == "/agents#agent-instructions"


@pytest.mark.usefixtures("docs_index")
def test_search_returns_one_hit_per_section():
    refs = [hit.ref for hit in docs_search.search("run flow playground chat", limit=10)]

    assert len(refs) == len(set(refs))
    assert refs.count("/concepts-playground#run-a-flow") == 1


@pytest.mark.usefixtures("docs_index")
def test_search_folds_plurals_and_ignores_stopwords():
    assert docs_search.tokenize("How do I use the Global Variables?") == ["global", "variable"]
    assert docs_search.search("variables")[0].ref.startswith("/configuration-global-variables")


@pytest.mark.usefixtures("docs_index")
def test_search_clamps_the_limit_and_handles_empty_queries():
    assert len(docs_search.search("flow playground agent variable", limit=1)) == 1
    assert len(docs_search.search("flow playground agent variable", limit=0)) == 1
    assert docs_search.search("   ") == []
    assert docs_search.search("zzzz-no-such-word") == []


@pytest.mark.usefixtures("docs_index")
def test_read_returns_a_page_or_one_section():
    page = docs_search.read("/concepts-playground")
    section = docs_search.read("/concepts-playground#run-a-flow")

    assert page["title"] == "Test flows in the Playground"
    assert page["url"] == "https://docs.langflow.org/concepts-playground"
    assert "The Playground runs a flow." in page["text"]
    assert "## Run a flow in the Playground" in page["text"]
    # The heading is printed once even though the section spans two chunks.
    assert page["text"].count("## Run a flow in the Playground") == 1
    assert section["url"].endswith("#run-a-flow")
    assert "The Playground runs a flow." not in section["text"]
    assert "Chat Output" in section["text"]


@pytest.mark.usefixtures("docs_index")
def test_read_only_matches_refs_in_the_index():
    assert docs_search.read("/no-such-page") is None
    assert docs_search.read("/concepts-playground#no-such-anchor") is None
    assert docs_search.read("/../../etc/passwd") is None
    assert docs_search.read("") is None


@pytest.mark.usefixtures("docs_index")
def test_read_truncates_a_very_long_page(monkeypatch):
    monkeypatch.setattr(docs_search, "MAX_READ_CHARS", 40)

    page = docs_search.read("/concepts-playground")

    assert page["truncated"] is True
    assert page["text"].endswith("[truncated]")


@pytest.mark.usefixtures("docs_index")
def test_cited_urls_can_point_at_an_internal_mirror(monkeypatch):
    monkeypatch.setenv(docs_search.DOCS_BASE_URL_ENV, "https://docs.internal.example/langflow/")

    assert docs_search.search("playground")[0].url.startswith("https://docs.internal.example/langflow/concepts-")


def test_a_missing_index_disables_search_instead_of_raising(tmp_path, monkeypatch):
    monkeypatch.setattr(docs_search, "DOCS_INDEX_PATH", tmp_path / "absent.json")
    docs_search.reset_cache()
    try:
        assert docs_search.docs_index_available() is False
        assert docs_search.search("playground") == []
        assert docs_search.read("/concepts-playground") is None
    finally:
        docs_search.reset_cache()


def test_a_corrupt_index_disables_search_instead_of_raising(tmp_path, monkeypatch):
    path = tmp_path / "docs_index.json"
    path.write_text("{not json", encoding="utf-8")
    monkeypatch.setattr(docs_search, "DOCS_INDEX_PATH", path)
    docs_search.reset_cache()
    try:
        assert docs_search.docs_index_available() is False
    finally:
        docs_search.reset_cache()
