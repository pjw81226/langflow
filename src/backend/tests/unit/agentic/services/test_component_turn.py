"""Tests for the Component tab's turn: write, check, retry, remember.

The flow executor is replaced by a scripted fake. The checks are the real ones,
so a script's code has to be genuinely valid or genuinely broken.
"""

from __future__ import annotations

import asyncio
import json

import pytest
from langflow.agentic.helpers.code_security import SecurityScanResult
from langflow.agentic.services import component_turn, turn_runtime
from langflow.agentic.services.component_turn import COMPONENT_MAX_ATTEMPTS, run_component_turn
from langflow.agentic.services.conversation_buffer import ConversationBuffer
from langflow.agentic.services.turn_runtime import TurnState

VALID = """from lfx.custom import Component
from lfx.io import MessageTextInput, Output
from lfx.schema import Message


class ShoutComponent(Component):
    display_name = "Shout"
    description = "Turns text into capital letters. Use it to make a message stand out."
    icon = "Megaphone"

    inputs = [MessageTextInput(name="text", display_name="Text", info="Text to shout.", tool_mode=True)]
    outputs = [Output(name="shouted", display_name="Shouted", method="shout_text")]

    def shout_text(self) -> Message:
        return Message(text=(self.text or "").upper())
"""

INSECURE = VALID.replace("from lfx.schema import Message\n", "from lfx.schema import Message\nimport subprocess\n")

BUILTIN_NAME = VALID.replace("class ShoutComponent(Component):", "class ChatInput(Component):")


def _reply(code: str, explanation: str = "Here is a component that shouts.") -> list:
    return [("end", {"result": f"{explanation}\n\n```python\n{code}```\n"})]


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
def executor(monkeypatch, buffer):  # noqa: ARG001 - every turn here records into a fresh buffer
    async def no_pause():
        return None

    monkeypatch.setattr(component_turn, "_pause", no_pause)

    def install(*scripts):
        fake = ScriptedExecutor(*scripts)
        monkeypatch.setattr(turn_runtime, "execute_flow_file_streaming", fake)
        return fake

    return install


def _turn() -> TurnState:
    return TurnState(
        user_id="user-1",
        session_id="agentic_s1",
        flow_id="flow-1",
        provider="OpenAI",
        model_name="gpt-a",
        api_key_var=None,
        global_variables={},
        mode="component",
    )


async def _run(request: str = "Make a component that shouts text", turn: TurnState | None = None) -> list[dict]:
    events = [event async for event in run_component_turn(turn or _turn(), request=request)]
    return [json.loads(event.removeprefix("data: ")) for event in events]


def _steps(events: list[dict]) -> list[tuple[str, int]]:
    return [(e["step"], e["attempt"]) for e in events if e["event"] == "progress"]


def _complete(events: list[dict]) -> dict:
    return next(e["data"] for e in events if e["event"] == "complete")


async def test_a_valid_component_passes_on_the_first_attempt(executor):
    executor(_reply(VALID))

    events = await _run()

    assert _steps(events) == [
        ("generating_component", 1),
        ("extracting_code", 1),
        ("validating", 1),
        ("validated", 1),
    ]
    assert not [e for e in events if e["event"] == "token"]
    data = _complete(events)
    assert data["validated"] is True
    assert data["class_name"] == "ShoutComponent"
    assert data["component_code"].startswith("from lfx.custom import Component")
    assert data["validation_attempts"] == 1
    assert data["validation_error"] is None
    assert data["result"] == "Here is a component that shouts."
    assert data["mode"] == "component"


async def test_a_failed_check_is_retried_with_the_request_the_code_and_the_error(executor):
    fake = executor(_reply(INSECURE), _reply(VALID))

    events = await _run("Make a component that shouts text")

    assert ("validation_failed", 1) in _steps(events)
    assert ("retrying", 2) in _steps(events)
    retry_input = fake.inputs[1]
    assert "Make a component that shouts text" in retry_input
    assert "import subprocess" in retry_input
    assert "subprocess" in retry_input.split("Error:")[1]
    data = _complete(events)
    assert data["validated"] is True
    assert data["validation_attempts"] == 2


async def test_it_gives_up_after_the_last_attempt(executor):
    fake = executor(*[_reply(INSECURE) for _ in range(COMPONENT_MAX_ATTEMPTS)])

    events = await _run()

    assert len(fake.inputs) == COMPONENT_MAX_ATTEMPTS
    data = _complete(events)
    assert data["validated"] is False
    assert data["validation_attempts"] == COMPONENT_MAX_ATTEMPTS
    assert "subprocess" in data["validation_error"]
    assert "import subprocess" in data["component_code"]


async def test_a_built_in_component_name_fails_the_check(executor):
    executor(_reply(BUILTIN_NAME), _reply(VALID))

    events = await _run()

    failed = next(e for e in events if e.get("step") == "validation_failed")
    assert "ChatInput" in failed["error"]
    assert _complete(events)["validated"] is True


async def test_a_slow_runtime_check_counts_as_a_pass(executor, monkeypatch):
    async def slow(_code, user_id=None):  # noqa: ARG001
        await asyncio.sleep(5)
        return "never reached"

    monkeypatch.setattr(component_turn, "validate_component_runtime", slow)
    monkeypatch.setattr(component_turn, "RUNTIME_VALIDATION_TIMEOUT_SECONDS", 0.01)
    executor(_reply(VALID))

    assert _complete(await _run())["validated"] is True


async def test_a_reply_without_code_is_answered_as_is_and_not_retried(executor):
    fake = executor([("end", {"result": "Which text should it read, a message or a file?"})])

    events = await _run()

    assert len(fake.inputs) == 1
    data = _complete(events)
    assert data["validated"] is False
    assert data["component_code"] is None
    assert data["validation_error"] is None
    assert data["result"] == "Which text should it read, a message or a file?"


async def test_the_component_is_remembered_for_the_next_request(executor, buffer):
    fake = executor(_reply(VALID), _reply(VALID.replace("upper()", "upper() + '!'")))
    turn = _turn()

    await _run("Make a component that shouts text", turn)
    await _run("Add an exclamation mark", turn)

    recorded = buffer.get_recent("user-1", "agentic_s1")
    assert recorded[0].mode == "component"
    assert recorded[0].artifact.startswith("from lfx.custom import Component")
    assert "class ShoutComponent" not in recorded[0].assistant
    follow_up = fake.inputs[1]
    assert "[Current component" in follow_up
    assert "class ShoutComponent(Component)" in follow_up
    assert follow_up.rstrip().endswith("Add an exclamation mark")


async def test_code_with_abusive_text_is_not_shown_back(executor, monkeypatch):
    monkeypatch.setattr(
        component_turn,
        "scan_code_security",
        lambda _code: SecurityScanResult(is_safe=False, violations=("harassment in generated code",)),
    )
    executor(*[_reply(VALID) for _ in range(COMPONENT_MAX_ATTEMPTS)])

    events = await _run()

    failed = [e for e in events if e.get("step") == "validation_failed"]
    assert failed
    assert all("component_code" not in e for e in failed)
    assert _complete(events)["component_code"] is None


async def test_a_cancelled_run_ends_the_turn(executor):
    executor([("cancelled", {})])

    events = await _run()

    assert events[-1]["event"] == "cancelled"
    assert not [e for e in events if e["event"] == "complete"]


async def test_a_failed_run_ends_with_an_error(executor, monkeypatch):
    from langflow.agentic.services.flow_types import FlowExecutionError

    async def failing(**_kwargs):
        message = "401 Incorrect API key provided"
        raise FlowExecutionError(message)
        yield  # pragma: no cover - makes this an async generator

    executor()
    monkeypatch.setattr(turn_runtime, "execute_flow_file_streaming", failing)

    events = await _run()

    assert events[-1]["event"] == "error"
