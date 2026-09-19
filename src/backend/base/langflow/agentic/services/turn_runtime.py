"""Shared runtime of an assistant turn: run an agent, stream, count tokens, finish.

Every turn (Component, Prompt, Ask) runs one of the assistant's agents through
the flow executor and ends with exactly one ``complete``, ``error`` or
``cancelled`` event. This module owns that shared part, so the mode modules
only decide what to ask the agent and what to do with its answer.

Two recoveries happen here, both visible to the user:

* the chosen model is not available to the account (``model_not_found``): the
  run moves to the next model the provider offers and the turn's ``notices``
  say so;
* the model produced a malformed tool call: the run is resampled once.

Model *remediation* (retrying the same model with adjusted parameters) is not
repeated here; the Agent component already does it on its own.
"""

from __future__ import annotations

import asyncio
import contextlib
from contextlib import aclosing
from dataclasses import dataclass, field
from time import perf_counter
from typing import TYPE_CHECKING, Any

from fastapi import HTTPException
from lfx.log.logger import logger

from langflow.agentic.helpers.content_safety import REFUSAL_MESSAGE as CONTENT_REFUSAL_MESSAGE
from langflow.agentic.helpers.content_safety import check_content
from langflow.agentic.helpers.error_handling import (
    build_error_detail,
    build_recovered_notice,
    extract_friendly_error,
    format_models_exhausted_message,
    is_model_unavailable_error,
    is_transient_tool_call_error,
)
from langflow.agentic.helpers.sse import (
    format_cancelled_event,
    format_complete_event,
    format_error_event,
    format_progress_event,
    format_token_event,
)
from langflow.agentic.services.flow_executor import execute_flow_file_streaming, extract_response_text
from langflow.agentic.services.flow_types import FlowExecutionError
from langflow.agentic.services.provider_service import get_provider_model_candidates

if TYPE_CHECKING:
    from collections.abc import AsyncIterator, Awaitable, Callable

    from langflow.agentic.api.schemas import StepType


def _empty_usage() -> dict[str, int]:
    return {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}


@dataclass
class TurnState:
    """Everything one turn carries from its first event to its last."""

    user_id: str | None
    session_id: str
    flow_id: str | None
    provider: str | None
    model_name: str | None
    api_key_var: str | None
    global_variables: dict[str, str]
    mode: str | None = None
    is_superuser: bool = False
    is_disconnected: Callable[[], Awaitable[bool]] | None = None
    cancel_event: asyncio.Event = field(default_factory=asyncio.Event)
    usage: dict[str, int] = field(default_factory=_empty_usage)
    notices: list[dict[str, str]] = field(default_factory=list)
    started_at: float = field(default_factory=perf_counter)
    last_step: str | None = None

    def accumulate(self, metrics: dict[str, Any] | None) -> None:
        """Add one run's token usage to the turn total."""
        if not metrics:
            return
        for key in self.usage:
            # Degraded engine paths occasionally report non-integer counts; count them as zero.
            with contextlib.suppress(TypeError, ValueError):
                self.usage[key] += int(metrics.get(key, 0) or 0)

    def switch_model(self, model_name: str) -> None:
        """Run the rest of the turn on ``model_name``. The Agent reads MODEL_NAME from the globals."""
        self.model_name = model_name
        self.global_variables = {**self.global_variables, "MODEL_NAME": model_name}

    def progress(self, step: StepType, attempt: int, max_attempts: int, **fields: str | None) -> str:
        """Format a progress event and remember the step for error reports."""
        self.last_step = step
        return format_progress_event(step, attempt, max_attempts, **fields)

    def complete(self, data: dict[str, Any]) -> str:
        """The turn's final ``complete`` event, after the output guardrail.

        Input checks cannot see what the model itself produced, and with a local
        unaligned provider nothing else here would, so the reply text is checked
        once more before it leaves.
        """
        result = data.get("result")
        if isinstance(result, str) and result:
            outcome = check_content(result)
            if not outcome.is_safe:
                logger.warning("assistant.output_guardrail.blocked violation=%s", outcome.violation)
                data = {**data, "result": CONTENT_REFUSAL_MESSAGE}
        payload = {
            **data,
            "usage": dict(self.usage),
            "duration_seconds": round(perf_counter() - self.started_at, 3),
            "notices": list(self.notices),
        }
        if self.mode:
            payload["mode"] = self.mode
        return format_complete_event(payload)

    def error(self, message: str, raw_error: str | None = None) -> str:
        """The turn's final ``error`` event. The raw cause is shown to superusers only."""
        detail = build_error_detail(raw_error, step=self.last_step, include_raw_cause=self.is_superuser)
        return format_error_event(message, detail=detail)

    def cancelled(self) -> str:
        return format_cancelled_event()


@dataclass
class AgentRun:
    """What one ``run_agent`` call produced."""

    text: str = ""
    completed: bool = False
    cancelled: bool = False
    error: str | None = None
    raw_error: str | None = None


async def run_agent(
    turn: TurnState,
    flow_name: str,
    agent_input: str,
    run: AgentRun,
    *,
    forward_tokens: bool,
    attempt: int = 1,
    max_attempts: int = 1,
) -> AsyncIterator[str]:
    """Run ``flow_name`` once (plus recoveries), yielding SSE events and filling ``run``.

    Yields ``token`` events only when ``forward_tokens`` is set, and a
    ``retrying`` progress event before a resample so the panel can drop text it
    already showed. It never yields the turn's final event: the caller reads
    ``run`` and finishes the turn.
    """
    tried_models = {turn.model_name} if turn.model_name else set()
    resampled = False

    while True:
        try:
            async with aclosing(
                execute_flow_file_streaming(
                    flow_filename=flow_name,
                    input_value=agent_input,
                    global_variables=turn.global_variables,
                    user_id=turn.user_id,
                    session_id=turn.session_id,
                    provider=turn.provider,
                    model_name=turn.model_name,
                    api_key_var=turn.api_key_var,
                    is_disconnected=turn.is_disconnected,
                    cancel_event=turn.cancel_event,
                )
            ) as events:
                async for kind, payload in events:
                    if kind == "token":
                        if forward_tokens:
                            yield format_token_event(payload)
                    elif kind == "end":
                        if isinstance(payload, dict):
                            turn.accumulate(payload.pop("_metrics", None))
                            run.text = extract_response_text(payload) or ""
                        else:
                            run.text = str(payload or "")
                        run.completed = True
                    elif kind == "cancelled":
                        run.cancelled = True
                        return
                    # tool_start and flow_preview belong to canvas-changing tools,
                    # which no assistant agent holds.
        except GeneratorExit:
            turn.cancel_event.set()
            raise
        except FlowExecutionError as exc:
            raw = exc.original_error_message or ""
            if turn.provider and is_model_unavailable_error(raw):
                candidates = get_provider_model_candidates(turn.provider, user_id=turn.user_id)
                next_model = next((model for model in candidates if model not in tried_models), None)
                if next_model:
                    logger.info(
                        "assistant.model_fallback from=%s to=%s provider=%s", turn.model_name, next_model, turn.provider
                    )
                    turn.notices.append(
                        build_recovered_notice(
                            "model_fallback", failed_model=turn.model_name, raw_error=raw, used_model=next_model
                        )
                    )
                    tried_models.add(next_model)
                    turn.switch_model(next_model)
                    continue
                run.error = format_models_exhausted_message(turn.provider, tried_models)
                run.raw_error = raw
                return
            if is_transient_tool_call_error(raw) and not resampled:
                resampled = True
                yield turn.progress(
                    "retrying",
                    attempt,
                    max_attempts,
                    message="The model produced a malformed tool call. Retrying...",
                )
                continue
            run.error = extract_friendly_error(raw)
            run.raw_error = raw
            return
        except HTTPException as exc:
            run.error = extract_friendly_error(str(exc.detail))
            run.raw_error = str(exc.detail)
            return
        else:
            return
