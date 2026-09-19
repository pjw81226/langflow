"""The two documentation tools the Ask agent is given."""

from __future__ import annotations

import json

import pytest
from langflow.agentic.services import docs_search
from langflow.agentic.services.docs_tools import ReadDoc, SearchDocs

INDEX = {
    "schema_version": 1,
    "corpus_hash": "sha256:test",
    "doc_count": 1,
    "chunk_count": 2,
    "docs": [{"path": "Flows/playground.mdx", "slug": "/concepts-playground", "title": "Test flows in the Playground"}],
    "chunks": [
        {"doc": 0, "heading": "Test flows in the Playground", "anchor": "", "text": "The Playground runs a flow."},
        {
            "doc": 0,
            "heading": "Run a flow in the Playground",
            "anchor": "run-a-flow",
            "text": "Open the flow and click Playground. Enter a prompt in the chat.",
        },
    ],
}


@pytest.fixture(autouse=True)
def docs_index(tmp_path, monkeypatch):
    path = tmp_path / "docs_index.json"
    path.write_text(json.dumps(INDEX), encoding="utf-8")
    monkeypatch.setattr(docs_search, "DOCS_INDEX_PATH", path)
    docs_search.reset_cache()
    yield
    docs_search.reset_cache()


def test_search_docs_returns_citable_hits():
    result = SearchDocs(query="run flow playground", limit=1).search_docs()

    assert result.data["count"] == 1
    hit = result.data["results"][0]
    assert hit["ref"] == "/concepts-playground#run-a-flow"
    assert hit["url"] == "https://docs.langflow.org/concepts-playground#run-a-flow"
    assert hit["title"] == "Test flows in the Playground"
    assert "click Playground" in hit["snippet"]


def test_search_docs_says_so_when_nothing_matches():
    result = SearchDocs(query="zzzz-no-such-word").search_docs()

    assert result.data["count"] == 0
    assert result.data["results"] == []
    assert "No documentation matched" in result.data["note"]


def test_search_docs_survives_a_limit_the_model_sent_as_text():
    result = SearchDocs(query="playground", limit="not a number").search_docs()

    assert result.data["count"] >= 1


def test_read_doc_returns_the_section_text():
    result = ReadDoc(ref="/concepts-playground#run-a-flow").read_doc()

    assert result.data["title"] == "Test flows in the Playground"
    assert "Enter a prompt in the chat." in result.data["text"]


def test_read_doc_reports_an_unknown_ref_instead_of_raising():
    result = ReadDoc(ref="/../../etc/passwd").read_doc()

    assert "error" in result.data
    assert "search_docs" in result.data["error"]


async def test_the_tool_names_the_prompt_relies_on():
    tools = [*(await SearchDocs().to_toolkit()), *(await ReadDoc().to_toolkit())]

    assert sorted(tool.name for tool in tools) == ["read_doc", "search_docs"]
    search_tool = next(tool for tool in tools if tool.name == "search_docs")
    assert {"query", "limit"} <= set(search_tool.args)
