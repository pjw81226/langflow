"""Ask mode is a read-only help turn.

The panel lets the user pick Build or Ask. In Ask mode the assistant must
answer and nothing else: no intent classification call, no canvas-mutating
agent, no restore point, no canvas events, and an example in the answer must
not be mistaken for a generated flow or component.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from langflow.agentic.services import assistant_service
from langflow.agentic.services.assistant_service import (
    execute_flow_with_validation,
    execute_flow_with_validation_streaming,
)
from langflow.agentic.services.flow_types import ASK_MODE_PREAMBLE, IntentResult

MODULE = "langflow.agentic.services.assistant_service"

FLOW_JSON_SAMPLE = (
    "A flow file looks like this:\n"
    '```flow_json\n{"name": "sample", "data": {"nodes": [{"id": "ChatInput-1"}], "edges": []}}\n```'
)
PYTHON_SAMPLE = (
    "A component looks like this:\n"
    "```python\n"
    "from langflow.custom import Component\n\n\n"
    "class Example(Component):\n"
    '    display_name = "Example"\n'
    "```"
)


def _gen(events):
    async def g():
        for event_type, event_data in events:
            yield event_type, event_data

    return g()


async def _collect(agen):
    return [event async for event in agen]


def _complete_event(events: list[str]) -> str:
    return next(event for event in events if '"event": "complete"' in event)


async def _run_ask(*, answer: str = "Open the Playground.", input_value: str = "How do I test a flow?", **patches):
    """Run one streaming Ask turn and return (events, captured kwargs, mocks)."""
    captured: dict = {}

    def streaming_factory(**kwargs):
        captured.update(kwargs)
        return _gen([("token", answer), ("end", {"result": answer})])

    classify = AsyncMock(return_value=IntentResult(intent="build_flow", translation="build a flow"))
    restore_point = AsyncMock(return_value="version-1")
    with (
        patch(f"{MODULE}.classify_intent", classify),
        patch(f"{MODULE}.create_restore_point", restore_point),
        patch(f"{MODULE}.execute_flow_file_streaming", side_effect=streaming_factory),
        patch(f"{MODULE}.drain_flow_events", return_value=patches.get("queued_events", [])),
        patch("asyncio.sleep", new_callable=AsyncMock),
    ):
        events = await _collect(
            execute_flow_with_validation_streaming(
                flow_filename="TestFlow",
                input_value=input_value,
                global_variables={},
                max_retries=1,
                provider="OpenAI",
                model_name="gpt-test",
                mode="ask",
            )
        )
    return events, captured, {"classify": classify, "restore_point": restore_point}


@pytest.mark.asyncio
async def test_ask_mode_skips_the_intent_classification_call():
    _events, _captured, mocks = await _run_ask()

    mocks["classify"].assert_not_awaited()


@pytest.mark.asyncio
async def test_ask_mode_never_routes_to_the_canvas_building_agent():
    _events, captured, _mocks = await _run_ask(input_value="build me a chatbot flow")

    assert not captured["flow_filename"].startswith("flow_builder_assistant"), captured["flow_filename"]


@pytest.mark.asyncio
async def test_ask_mode_creates_no_restore_point():
    _events, _captured, mocks = await _run_ask(input_value="build me a chatbot flow")

    mocks["restore_point"].assert_not_awaited()


@pytest.mark.asyncio
async def test_ask_mode_drops_queued_canvas_events():
    queued = [
        {"action": "set_flow", "flow": {"data": {"nodes": [], "edges": []}}},
        {"action": "configure", "component_id": "Agent-1", "field": "system_prompt", "value": "x"},
    ]
    events, _captured, _mocks = await _run_ask(queued_events=queued)

    assert not any('"event": "flow_update"' in event for event in events), events
    assert '"has_flow"' not in _complete_event(events)


@pytest.mark.asyncio
async def test_ask_mode_does_not_turn_a_flow_json_sample_into_a_preview():
    events, _captured, _mocks = await _run_ask(answer=FLOW_JSON_SAMPLE)

    assert not any('"event": "flow_preview"' in event for event in events), events
    assert '"has_flow"' not in _complete_event(events)


@pytest.mark.asyncio
async def test_ask_mode_does_not_validate_a_python_sample_as_a_component():
    events, _captured, _mocks = await _run_ask(answer=PYTHON_SAMPLE)

    assert not any('"extracting_code"' in event or '"validating"' in event for event in events), events
    assert '"validated"' not in _complete_event(events)


@pytest.mark.asyncio
async def test_ask_mode_states_the_read_only_contract_and_omits_the_build_hint():
    _events, captured, _mocks = await _run_ask()

    assert ASK_MODE_PREAMBLE.strip() in captured["input_value"]
    assert "[Available language models" not in captured["input_value"]


@pytest.mark.asyncio
async def test_ask_mode_reports_the_mode_and_expects_no_continuation():
    events, _captured, _mocks = await _run_ask(input_value="how do I run the flow?")

    complete = _complete_event(events)
    assert '"mode": "ask"' in complete, complete
    assert '"continuation_expected": false' in complete, complete


@pytest.mark.asyncio
async def test_without_a_mode_the_classifier_still_routes_the_turn():
    classify = AsyncMock(return_value=IntentResult(intent="question", translation="how do I test a flow?"))
    with (
        patch(f"{MODULE}.classify_intent", classify),
        patch(
            f"{MODULE}.execute_flow_file_streaming",
            return_value=_gen([("end", {"result": "Open the Playground."})]),
        ),
        patch(f"{MODULE}.drain_flow_events", return_value=[]),
        patch("asyncio.sleep", new_callable=AsyncMock),
    ):
        events = await _collect(
            execute_flow_with_validation_streaming(
                flow_filename="TestFlow",
                input_value="How do I test a flow?",
                global_variables={},
                max_retries=1,
            )
        )

    classify.assert_awaited_once()
    assert '"mode"' not in _complete_event(events)


@pytest.mark.asyncio
async def test_non_streaming_ask_mode_answers_once_without_component_validation():
    calls: list[dict] = []

    async def fake_execute_flow_file(**kwargs) -> dict:
        calls.append(kwargs)
        return {"result": PYTHON_SAMPLE}

    with (
        patch.object(assistant_service, "execute_flow_file", side_effect=fake_execute_flow_file),
        patch.object(assistant_service, "drain_flow_events", return_value=[{"action": "set_flow"}]),
    ):
        result = await execute_flow_with_validation(
            flow_filename="TestFlow",
            input_value="show me a component",
            global_variables={},
            mode="ask",
        )

    assert len(calls) == 1
    assert calls[0]["input_value"].startswith(ASK_MODE_PREAMBLE)
    assert result["mode"] == "ask"
    assert "validated" not in result
    assert "has_flow" not in result
    assert "flow_updates" not in result
