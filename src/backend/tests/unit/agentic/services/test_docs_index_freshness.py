"""The committed docs index must match the docs it was built from.

The Assistant's Ask mode answers from ``agentic/assets/docs_index.json``. If the
docs change and the index is not rebuilt, Ask mode quietly answers from stale
text, so this fails until ``make build_assistant_docs_index`` has been run.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from langflow.agentic.services.docs_corpus import build_corpus, dump_index
from langflow.agentic.services.docs_search import DOCS_INDEX_PATH

# .../src/backend/tests/unit/agentic/services/<this file>
DOCS_ROOT = Path(__file__).resolve().parents[6] / "docs" / "docs"

pytestmark = pytest.mark.skipif(
    not DOCS_ROOT.is_dir(), reason="the docs sources are only present in a repository checkout"
)


def test_the_committed_index_exists_and_is_well_formed():
    index = json.loads(DOCS_INDEX_PATH.read_text(encoding="utf-8"))

    assert index["doc_count"] == len(index["docs"]) > 0
    assert index["chunk_count"] == len(index["chunks"]) > 0
    assert all(0 <= chunk["doc"] < len(index["docs"]) for chunk in index["chunks"])


def test_the_committed_index_matches_the_docs():
    rebuilt = dump_index(build_corpus(DOCS_ROOT))

    assert DOCS_INDEX_PATH.read_text(encoding="utf-8") == rebuilt, (
        "docs/docs changed without rebuilding the Assistant docs index. Run: make build_assistant_docs_index"
    )
