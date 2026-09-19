"""Tests for the runtime every assistant turn shares.

The flow executor is replaced by a scripted fake: each call plays the next
script, either a list of ``(kind, payload)`` events or an exception to raise.
"""

from __future__ import annotations

import json

import pytest
from langflow.agentic.helpers.content_safety import REFUSAL_MESSAGE
from langflow.agentic.services import turn_runtime
from langflow.agentic.services.flow_types import FlowExecutionError
from langflow.agentic.services.turn_runtime import AgentRun, TurnState, run_agent


def _turn(**overrides) -> TurnState:
    values = {
        "user_id": "user-1",
        "session_id": "agentic_s1",
        "flow_id": "flow-1",
        "provider": "OpenAI",
        "model_name": "gpt-a",
        "api_key_var": "OPENAI_API_KEY",  # pragma: allowlist secret
        "global_variables": {"MODEL_NAME": "gpt-a", "USER_ID": "user-1"},
        "mode": "ask",
    }
    values.update(overrides)
    return TurnState(**values)


class ScriptedExecutor:
    def __init__(self, *scripts):
        self.scripts = list(scripts)
        self.calls: list[dict] = []

    async def __call__(self, **kwargs):
        self.calls.append(kwargs)
        script = self.scripts.pop(0)
        if isinstance(script, Exception):
            raise script
        for event in script:
            yield event


def _events(sse: list[str]) -> list[dict]:
    return [json.loads(line.removeprefix("data: ")) for line in sse]


async def _drain(turn, run, *, forward_tokens=True, **kwargs) -> list[dict]:
    return _events(
        [
            event
            async for event in run_agent(
                turn, "ask_assistant", "question", run, forward_tokens=forward_tokens, **kwargs
            )
        ]
    )


@pytest.fixture
def executor(monkeypatch):
    def install(*scripts):
        fake = ScriptedExecutor(*scripts)
        monkeypatch.setattr(turn_runtime, "execute_flow_file_streaming", fake)
        return fake

    return install


class TestRunAgent:
    async def test_should_forward_tokens_and_collect_the_answer(self, executor):
        executor([("token", "Hel"), ("token", "lo"), ("end", {"result": "Hello", "_metrics": {"total_tokens": 7}})])
        turn, run = _turn(), AgentRun()

        events = await _drain(turn, run)

        assert [e["chunk"] for e in events] == ["Hel", "lo"]
        assert run.completed
        assert run.text == "Hello"
        assert turn.usage["total_tokens"] == 7

    async def test_should_keep_tokens_back_when_not_forwarding(self, executor):
        executor([("token", "code"), ("end", {"result": "code"})])
        run = AgentRun()

        events = await _drain(_turn(), run, forward_tokens=False)

        assert events == []
        assert run.text == "code"

    async def test_should_ignore_canvas_events(self, executor):
        executor([("tool_start", {"tool": "add_component"}), ("flow_preview", {}), ("end", {"result": "ok"})])
        run = AgentRun()

        assert await _drain(_turn(), run) == []
        assert run.text == "ok"

    async def test_should_report_a_cancelled_run(self, executor):
        executor([("token", "x"), ("cancelled", {})])
        run = AgentRun()

        await _drain(_turn(), run)

        assert run.cancelled
        assert not run.completed

    async def test_should_move_to_the_next_model_when_the_account_lacks_one(self, executor, monkeypatch):
        fake = executor(
            FlowExecutionError("Error code: 403 - model_not_found"),
            [("end", {"result": "answer"})],
        )
        monkeypatch.setattr(turn_runtime, "get_provider_model_candidates", lambda *_a, **_k: ["gpt-a", "gpt-b"])
        turn, run = _turn(), AgentRun()

        await _drain(turn, run)

        assert run.text == "answer"
        assert fake.calls[1]["model_name"] == "gpt-b"
        assert fake.calls[1]["global_variables"]["MODEL_NAME"] == "gpt-b"
        assert turn.notices[0]["type"] == "model_fallback"
        assert turn.notices[0]["used_model"] == "gpt-b"

    async def test_should_stop_when_every_model_was_tried(self, executor, monkeypatch):
        executor(FlowExecutionError("model_not_found"), FlowExecutionError("model_not_found"))
        monkeypatch.setattr(turn_runtime, "get_provider_model_candidates", lambda *_a, **_k: ["gpt-a", "gpt-b"])
        run = AgentRun()

        await _drain(_turn(), run)

        assert "No accessible model on OpenAI" in run.error
        assert not run.completed

    async def test_should_resample_a_malformed_tool_call_once(self, executor):
        executor(
            FlowExecutionError("error parsing tool call: bad json"),
            [("end", {"result": "fine"})],
        )
        run = AgentRun()

        events = await _drain(_turn(), run, attempt=2, max_attempts=3)

        assert events[0]["step"] == "retrying"
        assert (events[0]["attempt"], events[0]["max_attempts"]) == (2, 3)
        assert run.text == "fine"

    async def test_should_give_up_after_one_resample(self, executor):
        executor(FlowExecutionError("error parsing tool call"), FlowExecutionError("error parsing tool call"))
        run = AgentRun()

        await _drain(_turn(), run)

        assert run.error
        assert run.raw_error == "error parsing tool call"

    async def test_should_turn_other_failures_into_a_friendly_error(self, executor):
        executor(FlowExecutionError("401 Incorrect API key provided"))
        run = AgentRun()

        await _drain(_turn(), run)

        assert run.error
        assert not run.completed


class TestTurnState:
    def test_complete_should_carry_usage_duration_notices_and_mode(self):
        turn = _turn(mode="prompt")
        turn.accumulate({"input_tokens": 3, "output_tokens": 4, "total_tokens": 7})
        turn.accumulate({"input_tokens": "bad", "total_tokens": 1})

        payload = json.loads(turn.complete({"result": "hi"}).removeprefix("data: "))["data"]

        assert payload["result"] == "hi"
        assert payload["mode"] == "prompt"
        assert payload["usage"] == {"input_tokens": 3, "output_tokens": 4, "total_tokens": 8}
        assert payload["notices"] == []
        assert payload["duration_seconds"] >= 0

    def test_complete_should_leave_out_an_unset_mode(self):
        payload = json.loads(_turn(mode=None).complete({"result": ""}).removeprefix("data: "))["data"]

        assert "mode" not in payload

    def test_complete_should_block_an_abusive_answer(self, monkeypatch):
        class Unsafe:
            is_safe = False
            violation = "abuse"

        monkeypatch.setattr(turn_runtime, "check_content", lambda _text: Unsafe())

        payload = json.loads(_turn().complete({"result": "something vile"}).removeprefix("data: "))["data"]

        assert payload["result"] == REFUSAL_MESSAGE

    def test_error_should_show_the_raw_cause_to_superusers_only(self):
        raw = "Traceback: secret internals"
        member = json.loads(_turn(is_superuser=False).error("Failed", raw).removeprefix("data: "))
        admin = json.loads(_turn(is_superuser=True).error("Failed", raw).removeprefix("data: "))

        assert "raw_cause" not in (member.get("detail") or {})
        assert admin["detail"]["raw_cause"] == raw

    def test_progress_should_remember_the_last_step(self):
        turn = _turn()

        turn.progress("validating", 1, 3)

        assert turn.last_step == "validating"
        assert json.loads(turn.error("x", "boom").removeprefix("data: "))["detail"]["step"] == "validating"
