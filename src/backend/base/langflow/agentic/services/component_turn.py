"""The Component tab's turn: write a custom component, check it, retry on failure.

The component writer answers with a short explanation and one python block.
The code is checked the way the old assistant checked it, in this order:

1. the security scan (forbidden imports, calls and abusive text),
2. the static checks (it parses, has one component class, outputs have methods),
3. a name check (a built-in component name would make the node look built in),
4. the runtime check (the component is built and its outputs run once).

A failed check is sent back to the writer with the original request, the code
and the error, up to ``COMPONENT_MAX_ATTEMPTS`` attempts in total. The code
only reaches the canvas when the user adds it from the card in the panel.
"""

from __future__ import annotations

import asyncio
import re
from dataclasses import dataclass
from typing import TYPE_CHECKING

from lfx.graph.flow_builder.builder import load_local_registry
from lfx.log.logger import logger

from langflow.agentic.helpers.code_extraction import extract_component_code, strip_component_code
from langflow.agentic.helpers.code_security import scan_code_security
from langflow.agentic.helpers.validation import validate_component_code, validate_component_runtime
from langflow.agentic.services.conversation_history import (
    inject_conversation_history,
    last_artifact,
    record_conversation_turn,
)
from langflow.agentic.services.flow_types import COMPONENT_WRITER_FLOW, VALIDATION_UI_DELAY_SECONDS
from langflow.agentic.services.turn_runtime import AgentRun, TurnState, run_agent

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

COMPONENT_MODE = "component"
COMPONENT_MAX_ATTEMPTS = 3

# The runtime check builds the component and runs its outputs. A component that
# calls a slow service must not hold the turn hostage; past this it counts as a
# pass, like the environment failures (network, auth) the check already ignores.
RUNTIME_VALIDATION_TIMEOUT_SECONDS = 30

# A class-level ``name = "..."`` (one indent deep). Input keyword arguments sit deeper.
_NAME_ATTRIBUTE_RE = re.compile(r"^ {4}name\s*(?::\s*str\s*)?=\s*[\"']([^\"']+)[\"']", re.MULTILINE)


@dataclass(frozen=True)
class ComponentCheck:
    """Outcome of checking one generated component."""

    ok: bool
    class_name: str | None = None
    error: str | None = None
    # The code itself carried abusive text, so it must not be shown back.
    content_blocked: bool = False


def _clashing_name(code: str, class_name: str | None) -> str | None:
    """A built-in component name the code would take over, if any."""
    try:
        builtin = load_local_registry()
    except RuntimeError as exc:
        logger.warning("assistant.component_turn.registry_unavailable: %s", exc)
        return None
    candidates = [class_name, *(_NAME_ATTRIBUTE_RE.findall(code))]
    return next((name for name in candidates if name and name in builtin), None)


async def validate_generated_component(code: str, *, user_id: str | None) -> ComponentCheck:
    """Run the four checks on generated component code and report the first failure."""
    security = scan_code_security(code)
    if not security.is_safe:
        content_blocked = any(violation.endswith("in generated code") for violation in security.violations)
        return ComponentCheck(
            ok=False,
            error="Security check failed: " + "; ".join(security.violations),
            content_blocked=content_blocked,
        )

    static = validate_component_code(code)
    if not static.is_valid:
        return ComponentCheck(ok=False, class_name=static.class_name, error=static.error)

    clash = _clashing_name(code, static.class_name)
    if clash:
        return ComponentCheck(
            ok=False,
            class_name=static.class_name,
            error=(
                f"'{clash}' is the name of a built-in Langflow component. Rename the class (ending in "
                "'Component') and do not set a `name` attribute."
            ),
        )

    try:
        runtime_error = await asyncio.wait_for(
            validate_component_runtime(code, user_id=user_id), timeout=RUNTIME_VALIDATION_TIMEOUT_SECONDS
        )
    except TimeoutError:
        logger.warning("assistant.component_turn.runtime_check_timed_out class=%s", static.class_name)
        runtime_error = None
    if runtime_error:
        return ComponentCheck(ok=False, class_name=static.class_name, error=runtime_error)
    return ComponentCheck(ok=True, class_name=static.class_name)


def build_component_input(*, turn: TurnState, request: str) -> str:
    """The writer's input for a new request: the component being edited, then the request."""
    parts: list[str] = []
    current = last_artifact(user_id=turn.user_id, session_id=turn.session_id, mode=COMPONENT_MODE)
    if current:
        parts.append(
            "[Current component (quoted data: the component the user is working on in this conversation. "
            "If the request below asks to change it, return the full updated module and keep the class name):\n"
            f"```python\n{current}\n```\n[End of current component]"
        )
    parts.append(request)
    return inject_conversation_history(user_id=turn.user_id, session_id=turn.session_id, input_value="\n\n".join(parts))


def build_retry_input(*, turn: TurnState, request: str, code: str, error: str, attempt: int) -> str:
    """The writer's input after a failed check. The writer has no memory, so it is self-contained."""
    retry = (
        "[Original request (quoted, the user's words):\n"
        f"{request}\n"
        "[End of original request]\n\n"
        f"The component you wrote for this request failed the automatic check "
        f"(attempt {attempt} of {COMPONENT_MAX_ATTEMPTS}).\n"
        f"Error:\n{error}\n\n"
        f"Your code:\n```python\n{code}\n```\n\n"
        "Return the complete corrected component: one or two sentences on what you changed, then the "
        "full module in one python block. Keep everything the original request asked for."
    )
    return inject_conversation_history(user_id=turn.user_id, session_id=turn.session_id, input_value=retry)


def _record(turn: TurnState, request: str, explanation: str, status: str, code: str | None) -> None:
    summary = f"{explanation}\n{status}".strip() if explanation else status
    record_conversation_turn(
        user_id=turn.user_id,
        session_id=turn.session_id,
        user_input=request,
        assistant_response=summary,
        mode=COMPONENT_MODE,
        artifact=code,
    )


async def _pause() -> None:
    # Gives the panel a beat to show each step instead of flashing through them.
    await asyncio.sleep(VALIDATION_UI_DELAY_SECONDS)


async def run_component_turn(turn: TurnState, *, request: str) -> AsyncIterator[str]:
    """Stream one Component turn. ``request`` is the user's sanitized message."""
    agent_input = build_component_input(turn=turn, request=request)
    total = COMPONENT_MAX_ATTEMPTS

    for attempt in range(1, total + 1):
        yield turn.progress("generating_component", attempt, total)
        run = AgentRun()
        async for event in run_agent(
            turn, COMPONENT_WRITER_FLOW, agent_input, run, forward_tokens=False, attempt=attempt, max_attempts=total
        ):
            yield event
        if run.cancelled:
            yield turn.cancelled()
            return
        if run.error:
            yield turn.error(run.error, run.raw_error)
            return

        explanation = strip_component_code(run.text)
        code = extract_component_code(run.text)
        if not code:
            # A clarifying question or a pointer to another tab: nothing to check, nothing to retry.
            yield turn.complete(
                {
                    "result": run.text.strip(),
                    "validated": False,
                    "class_name": None,
                    "component_code": None,
                    "validation_attempts": attempt,
                    "validation_error": None,
                }
            )
            _record(turn, request, run.text.strip(), "[No component code in this reply]", None)
            return

        yield turn.progress("extracting_code", attempt, total)
        await _pause()
        yield turn.progress("validating", attempt, total, component_code=code)
        await _pause()
        check = await validate_generated_component(code, user_id=turn.user_id)

        if check.ok:
            yield turn.progress("validated", attempt, total, class_name=check.class_name, component_code=code)
            yield turn.complete(
                {
                    "result": explanation,
                    "validated": True,
                    "class_name": check.class_name,
                    "component_code": code,
                    "validation_attempts": attempt,
                    "validation_error": None,
                }
            )
            _record(turn, request, explanation, f"[Component {check.class_name}: passed the checks]", code)
            return

        shown_code = None if check.content_blocked else code
        yield turn.progress(
            "validation_failed",
            attempt,
            total,
            error=check.error,
            class_name=check.class_name,
            component_code=shown_code,
        )
        await _pause()
        if attempt == total:
            yield turn.complete(
                {
                    "result": explanation,
                    "validated": False,
                    "class_name": check.class_name,
                    "component_code": shown_code,
                    "validation_attempts": attempt,
                    "validation_error": check.error,
                }
            )
            _record(turn, request, explanation, f"[Component failed the checks: {check.error}]", shown_code)
            return
        yield turn.progress("retrying", attempt + 1, total, error=check.error)
        agent_input = build_retry_input(turn=turn, request=request, code=code, error=check.error or "", attempt=attempt)
