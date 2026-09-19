"""Run the flow on the canvas once and report whether it works.

This is the panel's "Test flow" button. It is deliberately not an agent turn:
no intent classification, no LLM deciding whether and how to run, no tokens
spent beyond what the flow itself uses. The same request always does the same
thing, and the answer is a ``test_result`` the panel renders as a card.
"""

from __future__ import annotations

import copy
from uuid import uuid4

from langflow.agentic.services import flow_test_result
from langflow.agentic.services.flow_probe_input import PROBE_INPUT_TEXT, apply_probe_input
from langflow.agentic.services.flow_run import run_working_flow
from langflow.agentic.services.flow_structural_validation import (
    flow_has_loop_edge,
    loop_structural_caveat,
    structural_failures,
)

# The run gets a session of its own. Without one the graph falls back to the flow
# id, which is the Playground's default session: every test would leave a "Hello"
# and its answer in the user's chat history and in the flow's memory.
# The "agentic_" prefix matters: the monitor API hides such sessions from the
# Playground's session list, the same way it hides the assistant's own chats.
TEST_SESSION_PREFIX = "agentic_test_"

_MAX_OUTPUT_PREVIEW_CHARS = 500


def _preview(text: object) -> str | None:
    if not isinstance(text, str) or not text.strip():
        return None
    text = text.strip()
    return text if len(text) <= _MAX_OUTPUT_PREVIEW_CHARS else text[: _MAX_OUTPUT_PREVIEW_CHARS - 1].rstrip() + "…"


async def run_flow_test(*, flow: dict | None, flow_id: str | None, user_id: str | None) -> dict:
    """Test the given canvas flow and return its ``test_result``.

    The flow is copied first, so filling an empty Chat Input with the probe text
    never reaches the canvas.
    """
    nodes = ((flow or {}).get("data") or {}).get("nodes") or []
    if not flow or not flow_id or not nodes:
        return flow_test_result.skipped("no_flow", trigger="manual")

    candidate = copy.deepcopy(flow)

    # A loop cannot be run to completion safely (it may never end), so it is
    # checked for missing connections instead, as the post-build verification does.
    if flow_has_loop_edge(candidate):
        issues = structural_failures(candidate)
        if not issues:
            return {"status": "passed", "trigger": "manual", "attempts": 1, "fixed": False}
        return flow_test_result.from_run({"error": loop_structural_caveat(issues)}, flow=candidate, trigger="manual")

    probe_input = PROBE_INPUT_TEXT if apply_probe_input(candidate) else None
    run = await run_working_flow(
        flow_data=candidate,
        flow_id=flow_id,
        user_id=user_id,
        session_id=f"{TEST_SESSION_PREFIX}{uuid4().hex}",
    )
    return flow_test_result.from_run(
        run,
        flow=candidate,
        trigger="manual",
        probe_input=probe_input,
        output_preview=_preview(run.get("result")),
    )


def summarize(test_result: dict) -> str:
    """One English sentence for the conversation buffer, so a follow-up question has context.

    The panel does not show this text: it renders the card from ``test_result``.
    """
    status = test_result.get("status")
    error = test_result.get("error") or {}
    where = f" in {error['component_name']}" if error.get("component_name") else ""
    if status == "passed":
        return "Flow test: passed. The flow ran without errors."
    if status == "needs_attention":
        return f"Flow test: could not run here{where}. {error.get('message', '')}".strip()
    if status == "failed":
        return f"Flow test: failed{where}. {error.get('message', '')}".strip()
    return "Flow test: not run. There is no flow on the canvas to test."
