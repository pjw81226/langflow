"""Build the docs search index the Langflow Assistant uses in Ask mode.

Reads ``docs/docs`` and writes ``src/backend/base/langflow/agentic/assets/docs_index.json``.
Run it whenever the docs change (``make build_assistant_docs_index``); a unit test fails
when the committed index no longer matches the docs.

Usage:
    uv run python scripts/build_assistant_docs_index.py [--check]
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from langflow.agentic.services.docs_corpus import build_corpus, dump_index
from langflow.agentic.services.docs_search import DOCS_INDEX_PATH

REPO_ROOT = Path(__file__).resolve().parent.parent
DOCS_ROOT = REPO_ROOT / "docs" / "docs"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--check", action="store_true", help="exit 1 if the committed index is stale; write nothing")
    args = parser.parse_args()

    if not DOCS_ROOT.is_dir():
        print(f"docs directory not found: {DOCS_ROOT}", file=sys.stderr)
        return 2

    index = build_corpus(DOCS_ROOT)
    rendered = dump_index(index)
    summary = f"{index['doc_count']} pages, {index['chunk_count']} chunks, {len(rendered.encode('utf-8')):,} bytes"

    if args.check:
        current = DOCS_INDEX_PATH.read_text(encoding="utf-8") if DOCS_INDEX_PATH.is_file() else ""
        if current != rendered:
            print("docs index is stale; run: make build_assistant_docs_index", file=sys.stderr)
            return 1
        print(f"docs index is up to date ({summary})")
        return 0

    DOCS_INDEX_PATH.parent.mkdir(parents=True, exist_ok=True)
    DOCS_INDEX_PATH.write_text(rendered, encoding="utf-8")
    print(f"wrote {DOCS_INDEX_PATH.relative_to(REPO_ROOT)} ({summary})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
