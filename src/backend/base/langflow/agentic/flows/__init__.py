"""Langflow Assistant flows.

Each module defines a ``get_graph`` the flow executor loads by file name:

- ask_assistant: read-only Q&A grounded on the bundled docs index (Ask tab)
- component_writer: writes one custom component per request (Component tab)
- prompt_writer: writes the instructions of an Agent or Language Model (Prompt tab)
- assistant_agent: the Chat Input -> Agent -> Chat Output graph all three share

The package deliberately re-exports nothing, so loading one flow never imports another.
"""
