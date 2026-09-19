"""RunFlow MCP tool — the agent-facing piece.

Lives in lfx.mcp.flow_builder_tools but is exercised here (backend tree)
because it lazily imports langflow.agentic.services.flow_run, which the
isolated lfx suite cannot resolve.
"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, patch

from lfx.mcp.flow_builder_tools import (
    RunFlow,
    drain_flow_events,
    init_working_flow,
    reset_working_flow,
)

RWF = "langflow.agentic.services.flow_run.run_working_flow"


def _run(tool: RunFlow):
    return asyncio.run(tool.run_flow())


class TestRunFlowTool:
    def setup_method(self):
        reset_working_flow()

    def test_returns_result_text_for_the_agent_on_success(self):
        init_working_flow(
            {"name": "F", "data": {"nodes": [{"id": "ChatInput-1"}], "edges": []}},
            "flow-1",
        )
        with patch(RWF, new_callable=AsyncMock, return_value={"result": "woof"}) as m:
            data = _run(RunFlow())

        m.assert_awaited_once()
        # The LLM reads `text`; it must carry the run result so the agent can
        # answer questions about it.
        assert data.data["text"] == "woof"
        assert data.data["result"] == "woof"

    def test_exposes_run_metrics_to_the_agent(self):
        init_working_flow(
            {"name": "F", "data": {"nodes": [{"id": "ChatInput-1"}], "edges": []}},
            "flow-1",
        )
        metrics = {
            "duration_seconds": 1.25,
            "input_tokens": 7,
            "output_tokens": 3,
            "total_tokens": 10,
        }
        with patch(
            RWF,
            new_callable=AsyncMock,
            return_value={"result": "woof", "metrics": metrics},
        ):
            data = _run(RunFlow())

        # Structured for any programmatic use.
        assert data.data["metrics"] == metrics
        # The LLM only reads `text`; the performance summary must be in it so
        # the agent can actually report time/tokens to the user.
        assert "1.25" in data.data["text"]
        assert "10" in data.data["text"]

    def test_refuses_when_canvas_is_empty_without_running(self):
        init_working_flow({"name": "F", "data": {"nodes": [], "edges": []}}, "flow-1")
        with patch(RWF, new_callable=AsyncMock) as m:
            data = _run(RunFlow())

        m.assert_not_awaited()
        assert "error" in data.data
        assert "no flow" in data.data["error"].lower() or "empty" in data.data["error"].lower()

    def test_surfaces_run_error_as_data_error_not_exception(self):
        init_working_flow(
            {"name": "F", "data": {"nodes": [{"id": "Agent-1"}], "edges": []}},
            "flow-1",
        )
        with patch(RWF, new_callable=AsyncMock, return_value={"error": "Rate limit exceeded."}):
            data = _run(RunFlow())

        assert data.data["error"] == "Rate limit exceeded."
        assert data.data["text"] == "Rate limit exceeded."

    def test_passes_working_flow_and_flow_id_to_orchestration(self):
        flow = {"name": "F", "data": {"nodes": [{"id": "ChatInput-1"}], "edges": []}}
        init_working_flow(flow, "flow-xyz")
        with patch(RWF, new_callable=AsyncMock, return_value={"result": "ok"}) as m:
            _run(RunFlow())

        kwargs = m.call_args.kwargs
        assert kwargs["flow_id"] == "flow-xyz"
        assert kwargs["flow_data"]["data"]["nodes"][0]["id"] == "ChatInput-1"


class TestRunFlowEmitsRanSignal:
    """RunFlow must emit a deterministic ``flow_ran`` signal on success.

    This is the LLM/language-agnostic anchor for "the agent built AND ran
    the flow this turn → apply it to the canvas". It fires on the REAL
    action (a successful run), never inferred from the user's wording, so
    paraphrases like "rode ele" / "run it" / any language work identically.
    """

    def setup_method(self):
        reset_working_flow()

    def test_emits_flow_ran_on_successful_run(self):
        init_working_flow(
            {"name": "F", "data": {"nodes": [{"id": "ChatInput-1"}], "edges": []}},
            "flow-1",
        )
        with patch(RWF, new_callable=AsyncMock, return_value={"result": "12.0"}):
            _run(RunFlow())

        events = drain_flow_events()
        ran = [e for e in events if e.get("action") == "flow_ran"]
        assert len(ran) == 1, f"expected exactly one flow_ran, got {events}"

    def test_does_not_emit_flow_ran_when_run_errors(self):
        init_working_flow(
            {"name": "F", "data": {"nodes": [{"id": "Agent-1"}], "edges": []}},
            "flow-1",
        )
        with patch(RWF, new_callable=AsyncMock, return_value={"error": "Authentication failed."}):
            _run(RunFlow())

        assert not [e for e in drain_flow_events() if e.get("action") == "flow_ran"], (
            "a failed run must NOT claim the flow ran (no false canvas application)"
        )

    def test_does_not_emit_flow_ran_when_canvas_empty(self):
        init_working_flow({"name": "F", "data": {"nodes": [], "edges": []}}, "flow-1")
        with patch(RWF, new_callable=AsyncMock):
            _run(RunFlow())

        assert not [e for e in drain_flow_events() if e.get("action") == "flow_ran"]
