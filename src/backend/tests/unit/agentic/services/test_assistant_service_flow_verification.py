"""Slice 4 — post-build flow verification wired into the live turn.

Characterization first (the no-FLOW_ID path must stay byte-identical),
then the new behavior: a built flow whose real run fails with a
non-fixable error is delivered with an honest caveat — never as a
confident success — and the kill switch restores legacy behavior.
"""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from langflow.agentic.services.assistant_service import execute_flow_with_validation_streaming
from langflow.agentic.services.flow_types import IntentResult

MODULE = "langflow.agentic.services.assistant_service"


def _intent(intent):
    return IntentResult(intent=intent, translation="build a flow")


def _stream_end():
    async def gen():
        yield "end", {"result": "Flow built."}

    return gen()


def _drain_set_flow_once():
    """drain_flow_events: emit one set_flow on the first call, then []."""
    state = {"done": False}

    def _drain():
        if state["done"]:
            return []
        state["done"] = True
        return [{"action": "set_flow"}]

    return _drain


_BUILT_FLOW = {
    "name": "f",
    "data": {
        "nodes": [
            {"id": "ChatInput-1", "data": {"type": "ChatInput", "node": {"template": {"input_value": {"value": ""}}}}},
            {"id": "ChatOutput-1", "data": {"type": "ChatOutput", "node": {"template": {}}}},
        ],
        "edges": [{"source": "ChatInput-1", "target": "ChatOutput-1"}],
    },
}


_BUILT_LOOP_FLOW = {
    "name": "loop",
    "data": {
        "nodes": [
            {"id": "LoopComponent-1", "data": {"type": "LoopComponent", "node": {"template": {}}}},
            {"id": "TypeConverterComponent-1", "data": {"type": "TypeConverterComponent", "node": {"template": {}}}},
        ],
        "edges": [
            {
                "source": "TypeConverterComponent-1",
                "target": "LoopComponent-1",
                "data": {"targetHandle": {"name": "item", "id": "LoopComponent-1", "output_types": ["Data"]}},
            }
        ],
    },
}


_LOOP_OUTPUTS = [
    {"name": "item", "types": ["Data"], "allows_loop": True, "group_outputs": True},
    {"name": "done", "types": ["DataFrame"], "allows_loop": False, "group_outputs": True},
]

_COMPLETE_LOOP_FLOW = {
    "name": "loop",
    "data": {
        "nodes": [
            {"id": "ChatInput-1", "data": {"id": "ChatInput-1", "type": "ChatInput", "node": {"template": {}}}},
            {
                "id": "LoopComponent-1",
                "data": {
                    "id": "LoopComponent-1",
                    "type": "LoopComponent",
                    "node": {"template": {"data": {"input_types": ["Data"]}}, "outputs": _LOOP_OUTPUTS},
                },
            },
            {"id": "ChatOutput-1", "data": {"id": "ChatOutput-1", "type": "ChatOutput", "node": {"template": {}}}},
        ],
        "edges": [
            {
                "source": "ChatInput-1",
                "target": "LoopComponent-1",
                "data": {
                    "sourceHandle": {"name": "message", "id": "ChatInput-1"},
                    "targetHandle": {"fieldName": "data", "id": "LoopComponent-1"},
                },
            },
            {
                "source": "LoopComponent-1",
                "target": "ChatOutput-1",
                "data": {
                    "sourceHandle": {"name": "item", "id": "LoopComponent-1"},
                    "targetHandle": {"fieldName": "input_value", "id": "ChatOutput-1"},
                },
            },
            {
                "source": "ChatOutput-1",
                "target": "LoopComponent-1",
                "data": {
                    "sourceHandle": {"name": "message", "id": "ChatOutput-1"},
                    "targetHandle": {"name": "item", "id": "LoopComponent-1", "output_types": ["Data"]},
                },
            },
        ],
    },
}


def _complete_payload(events):
    for e in events:
        if '"event": "complete"' in e:
            return json.loads(e.split("data: ", 1)[1])
    return None


async def _collect(gen):
    return [e async for e in gen]


class TestCharacterizationNoFlowIdPath:
    """SAFETY NET: with no FLOW_ID, the build path is unchanged by Slice 4."""

    @pytest.mark.asyncio
    async def test_should_emit_flow_proposal_ready_then_one_complete_without_caveat(self):
        with (
            patch(f"{MODULE}.classify_intent", AsyncMock(return_value=_intent("build_flow"))),
            patch(f"{MODULE}.execute_flow_file_streaming", MagicMock(side_effect=lambda **_k: _stream_end())),
            patch(f"{MODULE}.drain_flow_events", side_effect=_drain_set_flow_once()),
            patch(f"{MODULE}.extract_response_text", return_value="Flow built."),
            patch("asyncio.sleep", new_callable=AsyncMock),
        ):
            events = await _collect(
                execute_flow_with_validation_streaming(
                    flow_filename="flow_builder_assistant",
                    input_value="build me a chat flow",
                    global_variables={},  # NO FLOW_ID → verification must not trigger
                    max_retries=1,
                )
            )

        blob = "\n".join(events)
        assert '"step": "flow_proposal_ready"' in blob
        assert len([e for e in events if '"event": "complete"' in e]) == 1
        assert '"event": "error"' not in blob
        assert "verification_caveat" not in blob


class TestFlowVerificationDeliversHonestCaveat:
    @pytest.mark.asyncio
    async def test_should_deliver_caveat_when_built_flow_run_fails_non_fixably(self):
        run = AsyncMock(return_value={"error": "Incorrect API key provided"})
        with (
            patch(f"{MODULE}.classify_intent", AsyncMock(return_value=_intent("build_flow"))),
            patch(f"{MODULE}.execute_flow_file_streaming", MagicMock(side_effect=lambda **_k: _stream_end())),
            patch(f"{MODULE}.drain_flow_events", side_effect=_drain_set_flow_once()),
            patch(f"{MODULE}.extract_response_text", return_value="Flow built."),
            patch(f"{MODULE}.get_working_flow", return_value=_BUILT_FLOW),
            patch(f"{MODULE}.run_working_flow", run),
            patch("asyncio.sleep", new_callable=AsyncMock),
        ):
            events = await _collect(
                execute_flow_with_validation_streaming(
                    flow_filename="flow_builder_assistant",
                    input_value="build me a chat flow",
                    global_variables={"FLOW_ID": "11111111-1111-1111-1111-111111111111"},
                    max_retries=1,
                )
            )

        run.assert_awaited()  # the flow was actually run to verify it
        blob = "\n".join(events)
        assert '"event": "error"' not in blob  # flow still delivered, not an error
        data = _complete_payload(events)
        assert data is not None
        # Honest: presented with a caveat, NOT as a confident success.
        assert data["data"].get("verified") is False
        assert data["data"].get("verification_caveat")
        assert "couldn't" in data["data"]["verification_caveat"].lower()

    @pytest.mark.asyncio
    async def test_cyclic_loop_flow_is_structurally_validated_not_run_and_flags_incomplete(self):
        run = AsyncMock()
        # get_working_flow returns the same broken loop each time, so the
        # structural fix loop can never repair it -> honest incomplete caveat.
        with (
            patch(f"{MODULE}.classify_intent", AsyncMock(return_value=_intent("build_flow"))),
            patch(f"{MODULE}.execute_flow_file_streaming", MagicMock(side_effect=lambda **_k: _stream_end())),
            patch(f"{MODULE}.execute_flow_file", new_callable=AsyncMock),
            patch(f"{MODULE}.drain_flow_events", side_effect=_drain_set_flow_once()),
            patch(f"{MODULE}.extract_response_text", return_value="Flow built."),
            patch(f"{MODULE}.get_working_flow", return_value=_BUILT_LOOP_FLOW),
            patch(f"{MODULE}.run_working_flow", run),
            patch("asyncio.sleep", new_callable=AsyncMock),
        ):
            events = await _collect(
                execute_flow_with_validation_streaming(
                    flow_filename="flow_builder_assistant",
                    input_value="build me a loop flow",
                    global_variables={"FLOW_ID": "11111111-1111-1111-1111-111111111111"},
                    max_retries=1,
                )
            )

        run.assert_not_called()  # cyclic flow is never run to completion for verification
        data = _complete_payload(events)
        assert data is not None
        assert data["data"].get("verified") is False
        caveat = data["data"]["verification_caveat"].lower()
        assert "loop" in caveat
        assert "incomplete" in caveat
        assert '"event": "error"' not in "\n".join(events)

    @pytest.mark.asyncio
    async def test_structurally_complete_loop_is_delivered_as_verified(self):
        run = AsyncMock()
        fix = AsyncMock()
        with (
            patch(f"{MODULE}.classify_intent", AsyncMock(return_value=_intent("build_flow"))),
            patch(f"{MODULE}.execute_flow_file_streaming", MagicMock(side_effect=lambda **_k: _stream_end())),
            patch(f"{MODULE}.execute_flow_file", fix),
            patch(f"{MODULE}.drain_flow_events", side_effect=_drain_set_flow_once()),
            patch(f"{MODULE}.extract_response_text", return_value="Flow built."),
            patch(f"{MODULE}.get_working_flow", return_value=_COMPLETE_LOOP_FLOW),
            patch(f"{MODULE}.run_working_flow", run),
            patch("asyncio.sleep", new_callable=AsyncMock),
        ):
            events = await _collect(
                execute_flow_with_validation_streaming(
                    flow_filename="flow_builder_assistant",
                    input_value="build me a loop flow",
                    global_variables={"FLOW_ID": "11111111-1111-1111-1111-111111111111"},
                    max_retries=1,
                )
            )

        run.assert_not_called()  # loops are validated structurally, never run
        fix.assert_not_awaited()  # a sound loop needs no fix turn
        data = _complete_payload(events)
        assert data is not None
        assert data["data"].get("verified") is True
        assert "verification_caveat" not in data["data"]

    @pytest.mark.asyncio
    async def test_kill_switch_disables_verification(self, monkeypatch):
        monkeypatch.setenv("LANGFLOW_ASSISTANT_VERIFY_FLOWS", "0")
        run = AsyncMock()
        with (
            patch(f"{MODULE}.classify_intent", AsyncMock(return_value=_intent("build_flow"))),
            patch(f"{MODULE}.execute_flow_file_streaming", MagicMock(side_effect=lambda **_k: _stream_end())),
            patch(f"{MODULE}.drain_flow_events", side_effect=_drain_set_flow_once()),
            patch(f"{MODULE}.extract_response_text", return_value="Flow built."),
            patch(f"{MODULE}.get_working_flow", return_value=_BUILT_FLOW),
            patch(f"{MODULE}.run_working_flow", run),
            patch("asyncio.sleep", new_callable=AsyncMock),
        ):
            events = await _collect(
                execute_flow_with_validation_streaming(
                    flow_filename="flow_builder_assistant",
                    input_value="build me a chat flow",
                    global_variables={"FLOW_ID": "11111111-1111-1111-1111-111111111111"},
                    max_retries=1,
                )
            )

        run.assert_not_called()  # kill switch → no verification run
        assert "verification_caveat" not in "\n".join(events)


class TestStructuredTestResult:
    """The panel renders a result card from ``test_result`` instead of parsing the caveat."""

    async def _build_turn(self, run):
        with (
            patch(f"{MODULE}.classify_intent", AsyncMock(return_value=_intent("build_flow"))),
            patch(f"{MODULE}.execute_flow_file_streaming", MagicMock(side_effect=lambda **_k: _stream_end())),
            patch(f"{MODULE}.drain_flow_events", side_effect=_drain_set_flow_once()),
            patch(f"{MODULE}.extract_response_text", return_value="Flow built."),
            patch(f"{MODULE}.get_working_flow", return_value=_BUILT_FLOW),
            patch(f"{MODULE}.run_working_flow", run),
            patch("asyncio.sleep", new_callable=AsyncMock),
        ):
            return await _collect(
                execute_flow_with_validation_streaming(
                    flow_filename="flow_builder_assistant",
                    input_value="build me a chat flow",
                    global_variables={"FLOW_ID": "11111111-1111-1111-1111-111111111111"},
                    max_retries=1,
                )
            )

    @pytest.mark.asyncio
    async def test_a_passing_run_is_reported_with_its_output_and_duration(self):
        run = AsyncMock(return_value={"result": "Hi there!", "metrics": {"duration_seconds": 2.5}})

        events = await self._build_turn(run)

        test_result = _complete_payload(events)["data"]["test_result"]
        assert test_result["status"] == "passed"
        assert test_result["trigger"] == "build"
        assert test_result["output_preview"] == "Hi there!"
        assert test_result["duration_seconds"] == 2.5
        assert test_result["probe_input"] == "Hello"

    @pytest.mark.asyncio
    async def test_a_missing_credential_is_reported_as_needing_attention(self):
        run = AsyncMock(return_value={"error": "Incorrect API key provided", "error_component": "Agent"})

        events = await self._build_turn(run)

        data = _complete_payload(events)["data"]
        # The prose twin stays for older clients.
        assert data["verified"] is False
        assert data["test_result"]["status"] == "needs_attention"
        assert data["test_result"]["error"]["kind"] == "external_resource"
        assert data["test_result"]["error"]["component_name"] == "Agent"

    @pytest.mark.asyncio
    async def test_the_panel_is_told_the_flow_is_being_tested_before_the_run(self):
        run = AsyncMock(return_value={"result": "ok"})

        events = await self._build_turn(run)

        steps = [json.loads(e.split("data: ", 1)[1]).get("step") for e in events if '"event": "progress"' in e]
        assert "verifying_flow" in steps
        assert steps.index("verifying_flow") < len(steps)
        blob = "\n".join(events)
        assert blob.index('"verifying_flow"') < blob.index('"event": "complete"')

    @pytest.mark.asyncio
    async def test_an_edit_turn_is_reported_as_not_tested(self):
        """Editing an existing flow never runs it behind the user's back."""
        run = AsyncMock()
        state = {"done": False}

        def drain_edit_once():
            if state["done"]:
                return []
            state["done"] = True
            return [{"action": "configure", "component_id": "Agent-1", "field": "system_prompt", "value": "x"}]

        with (
            patch(f"{MODULE}.classify_intent", AsyncMock(return_value=_intent("build_flow"))),
            patch(f"{MODULE}.execute_flow_file_streaming", MagicMock(side_effect=lambda **_k: _stream_end())),
            patch(f"{MODULE}.drain_flow_events", side_effect=drain_edit_once),
            patch(f"{MODULE}.extract_response_text", return_value="Updated the prompt."),
            patch(f"{MODULE}.get_working_flow", return_value=_BUILT_FLOW),
            patch(f"{MODULE}.run_working_flow", run),
            patch("asyncio.sleep", new_callable=AsyncMock),
        ):
            events = await _collect(
                execute_flow_with_validation_streaming(
                    flow_filename="flow_builder_assistant",
                    input_value="make the agent friendlier",
                    global_variables={"FLOW_ID": "11111111-1111-1111-1111-111111111111"},
                    max_retries=1,
                )
            )

        run.assert_not_awaited()
        assert _complete_payload(events)["data"]["test_result"] == {
            "status": "skipped",
            "trigger": "build",
            "skipped_reason": "edit_not_verified",
        }

    @pytest.mark.asyncio
    async def test_a_question_carries_no_test_result(self):
        with (
            patch(f"{MODULE}.classify_intent", AsyncMock(return_value=_intent("question"))),
            patch(f"{MODULE}.execute_flow_file_streaming", MagicMock(side_effect=lambda **_k: _stream_end())),
            patch(f"{MODULE}.drain_flow_events", return_value=[]),
            patch("asyncio.sleep", new_callable=AsyncMock),
        ):
            events = await _collect(
                execute_flow_with_validation_streaming(
                    flow_filename="TestFlow",
                    input_value="what is an Agent?",
                    global_variables={},
                    max_retries=1,
                )
            )

        assert "test_result" not in _complete_payload(events)["data"]
