"""Read-only documentation tools for the Assistant's Ask mode.

Two tools over the bundled docs index: ``search_docs`` finds the sections that
match a question and ``read_doc`` returns a whole page or section when a snippet
is not enough. Neither touches the working flow nor emits canvas events, which
is what lets Ask mode promise it never changes the canvas.

The tool name the agent sees is the output method name, so ``search_docs`` and
``read_doc`` are part of the Ask prompt's contract.
"""

from __future__ import annotations

from dataclasses import asdict

from lfx.custom import Component
from lfx.io import IntInput, MessageTextInput, Output
from lfx.schema import Data

from langflow.agentic.services import docs_search


class SearchDocs(Component):
    display_name = "Search Docs"
    description = (
        "Search the Langflow documentation for this version. Returns the best matching sections "
        "with a snippet, a URL to cite, and a ref for read_doc. Write the query as English keywords."
    )
    icon = "BookOpen"
    name = "SearchDocs"

    inputs = [
        MessageTextInput(
            name="query",
            display_name="Query",
            info="3-8 English keywords, e.g. 'playground chat input missing'. The docs are in English.",
            required=True,
            tool_mode=True,
        ),
        IntInput(
            name="limit",
            display_name="Limit",
            info=f"How many sections to return (1-{docs_search.MAX_SEARCH_LIMIT}).",
            value=docs_search.DEFAULT_SEARCH_LIMIT,
            tool_mode=True,
        ),
    ]

    outputs = [
        Output(name="results", display_name="Results", method="search_docs"),
    ]

    def search_docs(self) -> Data:
        try:
            limit = int(self.limit or docs_search.DEFAULT_SEARCH_LIMIT)
        except (TypeError, ValueError):
            limit = docs_search.DEFAULT_SEARCH_LIMIT
        hits = docs_search.search(self.query or "", limit=limit)
        if not hits:
            return Data(
                data={
                    "results": [],
                    "count": 0,
                    "note": "No documentation matched. Try fewer or different English keywords.",
                }
            )
        return Data(data={"results": [asdict(hit) for hit in hits], "count": len(hits)})


class ReadDoc(Component):
    display_name = "Read Doc"
    description = (
        "Read a full documentation page or one section. Use the ref of a search_docs result "
        "('/slug' for the page, '/slug#anchor' for one section) when the snippet is not enough."
    )
    icon = "FileText"
    name = "ReadDoc"

    inputs = [
        MessageTextInput(
            name="ref",
            display_name="Ref",
            info="The ref of a search_docs result, e.g. '/concepts-playground#run-a-flow'.",
            required=True,
            tool_mode=True,
        ),
    ]

    outputs = [
        Output(name="page", display_name="Page", method="read_doc"),
    ]

    def read_doc(self) -> Data:
        page = docs_search.read(self.ref or "")
        if page is None:
            return Data(data={"error": f"No documentation page matches ref {self.ref!r}. Use a ref from search_docs."})
        return Data(data=page)
