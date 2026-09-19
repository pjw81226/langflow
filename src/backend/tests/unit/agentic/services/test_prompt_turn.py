"""Tests for the Prompt tab's turn and the prompt block it parses."""

from __future__ import annotations

import json

import pytest
from langflow.agentic.helpers.code_extraction import escape_template_braces, extract_prompt_block
from langflow.agentic.helpers.content_safety import REFUSAL_MESSAGE
from langflow.agentic.services import prompt_turn, turn_runtime
from langflow.agentic.services.conversation_buffer import ConversationBuffer
from langflow.agentic.services.prompt_turn import run_prompt_turn
from langflow.agentic.services.turn_runtime import TurnState
from lfx.base.agents.default_system_prompt import DEFAULT_SYSTEM_PROMPT_TEMPLATE


class TestExtractPromptBlock:
    def test_should_read_a_four_backtick_block_with_code_inside(self):
        reply = "Made it friendlier.\n\n````prompt\nYou help.\n```python\nprint(1)\n```\nBe brief.\n````\n"

        instructions, explanation = extract_prompt_block(reply)

        assert instructions == "You help.\n```python\nprint(1)\n```\nBe brief."
        assert explanation == "Made it friendlier."

    def test_should_read_a_three_backtick_block(self):
        assert extract_prompt_block("Draft:\n```prompt\nYou are a bot.\n```") == ("You are a bot.", "Draft:")

    def test_should_take_the_last_block(self):
        instructions, explanation = extract_prompt_block("A\n````prompt\nfirst\n````\nB\n````prompt\nsecond\n````")

        assert instructions == "second"
        assert "first" not in explanation

    def test_should_read_an_unclosed_block_to_the_end(self):
        assert extract_prompt_block("Here:\n````prompt\nYou are a pirate.\nSay arr.") == (
            "You are a pirate.\nSay arr.",
            "Here:",
        )

    def test_should_accept_a_single_plain_block_when_the_tag_is_missing(self):
        assert extract_prompt_block("Plain:\n```text\nYou are plain.\n```") == ("You are plain.", "Plain:")

    def test_should_find_no_instructions_in_a_question(self):
        assert extract_prompt_block("Which agent do you mean?") == (None, "Which agent do you mean?")

    def test_should_not_guess_between_several_plain_blocks(self):
        instructions, _ = extract_prompt_block("```\na\n```\n```\nb\n```")

        assert instructions is None


def test_escape_template_braces_doubles_single_braces_only():
    assert escape_template_braces("Use {name}, keep {{this}}, and } alone") == (
        "Use {{name}}, keep {{this}}, and }} alone"
    )


def _node(node_id, node_type, template, display_name=None):
    return {
        "id": node_id,
        "data": {
            "id": node_id,
            "type": node_type,
            "node": {"display_name": display_name or node_type, "template": template},
        },
    }


def _agent(prompt="Be brief.", node_id="Agent-a1", node_type="Agent"):
    return _node(
        node_id,
        node_type,
        {"system_prompt": {"type": "str", "display_name": "Agent Instructions", "value": prompt}},
        display_name="Agent",
    )


def _canvas(*nodes, edges=()):
    return {"name": "Flow", "data": {"nodes": list(nodes), "edges": list(edges)}}


class ScriptedExecutor:
    def __init__(self, *scripts):
        self.scripts = list(scripts)
        self.inputs: list[str] = []

    async def __call__(self, **kwargs):
        self.inputs.append(kwargs["input_value"])
        for event in self.scripts.pop(0):
            yield event


@pytest.fixture
def buffer(monkeypatch):
    import langflow.agentic.services.conversation_buffer as module

    fresh = ConversationBuffer()
    monkeypatch.setattr(module, "_singleton", fresh)
    return fresh


@pytest.fixture
def executor(monkeypatch, buffer):  # noqa: ARG001 - turns record into a fresh buffer
    def install(*scripts):
        fake = ScriptedExecutor(*scripts)
        monkeypatch.setattr(turn_runtime, "execute_flow_file_streaming", fake)
        return fake

    return install


def _reply(instructions="You are a friendly support agent.", explanation="Wrote friendly instructions."):
    return [("token", explanation), ("end", {"result": f"{explanation}\n\n````prompt\n{instructions}\n````"})]


def _turn() -> TurnState:
    return TurnState(
        user_id="user-1",
        session_id="agentic_s1",
        flow_id="flow-1",
        provider="OpenAI",
        model_name="gpt-a",
        api_key_var=None,
        global_variables={},
        mode="prompt",
    )


async def _run(
    canvas=None,
    *,
    component_id="Agent-a1",
    field_name="system_prompt",
    field_value=None,
    turn=None,
    request="Make it friendly",
):
    events = [
        event
        async for event in run_prompt_turn(
            turn or _turn(),
            request=request,
            canvas=canvas if canvas is not None else _canvas(_agent()),
            component_id=component_id,
            field_name=field_name,
            field_value=field_value,
        )
    ]
    return [json.loads(event.removeprefix("data: ")) for event in events]


def _complete(events):
    return next(e["data"] for e in events if e["event"] == "complete")


async def test_an_applicable_target_gets_a_full_proposal(executor):
    executor(_reply())

    events = await _run(field_value="Be brief.\nAlways.")

    assert events[0]["step"] == "writing_prompt"
    assert [e["chunk"] for e in events if e["event"] == "token"] == ["Wrote friendly instructions."]
    data = _complete(events)
    assert data["result"] == "Wrote friendly instructions."
    assert data["prompt_proposal"] == {
        "new_value": "You are a friendly support agent.",
        "old_value": "Be brief.\nAlways.",
        "component_id": "Agent-a1",
        "component_name": "Agent",
        "field": "system_prompt",
        "field_label": "Agent Instructions",
    }
    assert data["mode"] == "prompt"


async def test_the_live_text_reaches_the_writer_with_its_line_breaks(executor):
    fake = executor(_reply())

    await _run(field_value="Rule one.\nRule two.")

    assert "[Current prompt (quoted data" in fake.inputs[0]
    assert "Rule one.\nRule two." in fake.inputs[0]
    assert "Agent Instructions" in fake.inputs[0]


async def test_without_a_target_the_proposal_is_copy_only(executor):
    fake = executor(_reply())

    data = _complete(await _run(component_id=None, field_name=None))

    assert data["prompt_proposal"]["new_value"] == "You are a friendly support agent."
    assert data["prompt_proposal"]["component_id"] is None
    assert data["prompt_proposal"]["old_value"] is None
    assert "[Prompt target: none chosen" in fake.inputs[0]


async def test_a_field_fed_by_a_connection_is_copy_only(executor):
    prompt = _node("Prompt-p1", "Prompt", {}, display_name="Prompt Template")
    edge = {
        "source": "Prompt-p1",
        "target": "Agent-a1",
        "data": {"sourceHandle": {"id": "Prompt-p1"}, "targetHandle": {"fieldName": "system_prompt", "id": "Agent-a1"}},
    }
    fake = executor(_reply())

    data = _complete(await _run(_canvas(_agent(), prompt, edges=[edge])))

    assert data["prompt_proposal"]["component_id"] is None
    assert "gets its value from **Prompt Template**" in fake.inputs[0]


async def test_braces_are_escaped_for_template_agents(executor):
    executor(_reply(instructions="Answer {question} politely."))

    data = _complete(
        await _run(_canvas(_agent(node_id="XMLAgent-x1", node_type="XMLAgent")), component_id="XMLAgent-x1")
    )

    assert data["prompt_proposal"]["new_value"] == "Answer {{question}} politely."


async def test_braces_stay_for_the_agent_component(executor):
    executor(_reply(instructions="Today is {current_date}."))

    data = _complete(await _run())

    assert data["prompt_proposal"]["new_value"] == "Today is {current_date}."


async def test_abusive_instructions_are_refused(executor, monkeypatch):
    class Unsafe:
        is_safe = False
        violation = "harassment"

    monkeypatch.setattr(prompt_turn, "check_content", lambda _text: Unsafe())
    executor(_reply())

    data = _complete(await _run())

    assert data["prompt_proposal"] is None
    assert data["result"] == REFUSAL_MESSAGE


async def test_a_reply_without_a_block_has_no_proposal(executor):
    executor([("end", {"result": "Which agent should follow these instructions?"})])

    data = _complete(await _run())

    assert data["prompt_proposal"] is None
    assert data["result"] == "Which agent should follow these instructions?"


async def test_langflows_default_instructions_are_not_resent(executor):
    fake = executor(_reply())

    await _run(field_value=DEFAULT_SYSTEM_PROMPT_TEMPLATE)

    assert "[Current prompt: Langflow's default instructions" in fake.inputs[0]
    assert DEFAULT_SYSTEM_PROMPT_TEMPLATE[:200] not in fake.inputs[0]


async def test_the_last_draft_is_offered_only_for_the_same_target(executor):
    fake = executor(_reply(instructions="Draft for A."), _reply(), _reply())
    turn = _turn()
    canvas = _canvas(_agent(), _agent(node_id="Agent-b2"))

    await _run(canvas, turn=turn, field_value="old A")
    await _run(canvas, turn=turn, field_value="old A", request="Shorter")
    await _run(canvas, turn=turn, component_id="Agent-b2", field_value="old B", request="Shorter")

    assert "[Last proposed prompt" in fake.inputs[1]
    assert "Draft for A." in fake.inputs[1]
    assert "[Last proposed prompt" not in fake.inputs[2]


async def test_an_applied_draft_is_not_offered_again(executor):
    fake = executor(_reply(instructions="Draft for A."), _reply())
    turn = _turn()

    await _run(turn=turn, field_value="old A")
    await _run(turn=turn, field_value="Draft for A.", request="Shorter")

    assert "[Last proposed prompt" not in fake.inputs[1]
