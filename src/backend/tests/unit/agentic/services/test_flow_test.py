"""The panel's Test button: run the canvas flow once and report it."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from langflow.agentic.services import flow_test
from langflow.agentic.services.flow_test import TEST_SESSION_PREFIX, run_flow_test, summarize

MODULE = "langflow.agentic.services.flow_test"


def _flow(chat_input_value: str = "") -> dict:
    return {
        "name": "f",
        "data": {
            "nodes": [
                {
                    "id": "ChatInput-1",
                    "data": {
                        "id": "ChatInput-1",
                        "type": "ChatInput",
                        "node": {
                            "display_name": "Chat Input",
                            "template": {"input_value": {"value": chat_input_value}},
                        },
                    },
                },
                {
                    "id": "ChatOutput-1",
                    "data": {
                        "id": "ChatOutput-1",
                        "type": "ChatOutput",
                        "node": {"display_name": "Chat Output", "template": {}},
                    },
                },
            ],
            "edges": [{"source": "ChatInput-1", "target": "ChatOutput-1"}],
        },
    }


LOOP_FLOW = {
    "name": "loop",
    "data": {
        "nodes": [{"id": "LoopComponent-1", "data": {"type": "LoopComponent", "node": {"template": {}}}}],
        "edges": [
            {
                "source": "X-1",
                "target": "LoopComponent-1",
                "data": {"targetHandle": {"name": "item", "id": "LoopComponent-1", "output_types": ["Data"]}},
            }
        ],
    },
}


@pytest.mark.asyncio
async def test_a_passing_flow_reports_the_output_the_probe_and_the_duration():
    run = AsyncMock(return_value={"result": "Hi there!", "metrics": {"duration_seconds": 1.2}})
    with patch(f"{MODULE}.run_working_flow", run):
        result = await run_flow_test(flow=_flow(), flow_id="flow-1", user_id="u1")

    assert result == {
        "trigger": "manual",
        "attempts": 1,
        "fixed": False,
        "status": "passed",
        "output_preview": "Hi there!",
        "duration_seconds": 1.2,
        "probe_input": "Hello",
    }


@pytest.mark.asyncio
async def test_the_probe_never_reaches_the_canvas_flow():
    canvas = _flow()
    with patch(f"{MODULE}.run_working_flow", AsyncMock(return_value={"result": "ok"})) as run:
        await run_flow_test(flow=canvas, flow_id="flow-1", user_id="u1")

    ran = run.await_args.kwargs["flow_data"]
    assert ran["data"]["nodes"][0]["data"]["node"]["template"]["input_value"]["value"] == "Hello"
    assert canvas["data"]["nodes"][0]["data"]["node"]["template"]["input_value"]["value"] == ""


@pytest.mark.asyncio
async def test_a_value_the_user_set_is_tested_as_is():
    with patch(f"{MODULE}.run_working_flow", AsyncMock(return_value={"result": "ok"})) as run:
        result = await run_flow_test(flow=_flow("What is Langflow?"), flow_id="flow-1", user_id="u1")

    ran = run.await_args.kwargs["flow_data"]
    assert ran["data"]["nodes"][0]["data"]["node"]["template"]["input_value"]["value"] == "What is Langflow?"
    assert "probe_input" not in result


@pytest.mark.asyncio
async def test_each_test_runs_in_a_session_of_its_own():
    """Otherwise the run lands in the Playground's default session and its chat memory."""
    with patch(f"{MODULE}.run_working_flow", AsyncMock(return_value={"result": "ok"})) as run:
        await run_flow_test(flow=_flow(), flow_id="flow-1", user_id="u1")
        await run_flow_test(flow=_flow(), flow_id="flow-1", user_id="u1")

    sessions = [call.kwargs["session_id"] for call in run.await_args_list]
    assert all(session.startswith(TEST_SESSION_PREFIX) for session in sessions)
    # The monitor API hides "agentic_" sessions from the Playground's session list.
    assert TEST_SESSION_PREFIX.startswith("agentic_")
    assert sessions[0] != sessions[1]
    assert "flow-1" not in sessions


@pytest.mark.asyncio
async def test_a_failure_names_the_component_and_whether_it_can_be_fixed():
    run = AsyncMock(
        return_value={
            "error": "Authentication failed. Check your API key.",
            "error_component": "Chat Output",
            "metrics": {"duration_seconds": 0.3},
        }
    )
    with patch(f"{MODULE}.run_working_flow", run):
        result = await run_flow_test(flow=_flow(), flow_id="flow-1", user_id="u1")

    assert result["status"] == "needs_attention"
    assert result["error"]["kind"] == "external_resource"
    assert result["error"]["component_name"] == "Chat Output"
    assert result["error"]["component_id"] == "ChatOutput-1"


@pytest.mark.asyncio
async def test_a_loop_is_checked_for_missing_connections_instead_of_being_run():
    run = AsyncMock()
    with (
        patch(f"{MODULE}.run_working_flow", run),
        patch(f"{MODULE}.structural_failures", return_value=["Loop has no input"]),
    ):
        broken = await run_flow_test(flow=LOOP_FLOW, flow_id="flow-1", user_id="u1")
    with patch(f"{MODULE}.run_working_flow", run), patch(f"{MODULE}.structural_failures", return_value=[]):
        sound = await run_flow_test(flow=LOOP_FLOW, flow_id="flow-1", user_id="u1")

    run.assert_not_awaited()
    assert broken["status"] in {"failed", "needs_attention"}
    assert "Loop has no input" in broken["error"]["message"]
    assert sound["status"] == "passed"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("flow", "flow_id"),
    [(None, "flow-1"), ({"data": {"nodes": []}}, "flow-1"), (_flow(), None)],
)
async def test_nothing_to_test_is_reported_as_skipped(flow, flow_id):
    with patch(f"{MODULE}.run_working_flow", AsyncMock()) as run:
        result = await run_flow_test(flow=flow, flow_id=flow_id, user_id="u1")

    run.assert_not_awaited()
    assert result == {"status": "skipped", "trigger": "manual", "skipped_reason": "no_flow"}


def test_the_summary_gives_a_follow_up_question_something_to_refer_to():
    assert summarize({"status": "passed"}) == "Flow test: passed. The flow ran without errors."
    assert (
        summarize({"status": "failed", "error": {"message": "NameError: x", "component_name": "Parser"}})
        == "Flow test: failed in Parser. NameError: x"
    )
    assert summarize({"status": "needs_attention", "error": {"message": "Check your API key."}}).startswith(
        "Flow test: could not run here."
    )
    assert "not run" in summarize({"status": "skipped"})


def test_the_preview_is_trimmed():
    assert flow_test._preview("x" * 900).endswith("…")
    assert len(flow_test._preview("x" * 900)) == 500
    assert flow_test._preview("   ") is None
