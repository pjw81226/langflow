"""The ``test_result`` object the Test flow action attaches to its ``complete`` event.

A run's outcome is more than pass or fail: "needs your API key" and "broken"
call for different things from the user. This module turns what a run knows
into one small, stable shape the UI renders as a result card, in any language.

Pure functions: no I/O, no logging.
"""

from __future__ import annotations

from typing import Any, Literal

from langflow.agentic.helpers.error_handling import get_error_recommendation
from langflow.agentic.services.flow_run_error_classification import RunErrorKind, classify_run_error

TestTrigger = Literal["build", "manual"]
SkippedReason = Literal["disabled", "no_flow", "pending_approval", "edit_not_verified", "verification_error"]

# ``needs_attention``: the flow is sound but could not run here (a missing key, a
# file, a database, a timeout). The user has something to supply, not something
# to fix, so the card explains what is missing instead of calling the flow broken.
_NOT_FIXABLE = (RunErrorKind.EXTERNAL_RESOURCE, RunErrorKind.TIMEOUT)


def _component_id(flow: dict | None, display_name: str | None) -> str | None:
    """ID of the node with that display name, only when exactly one node has it."""
    if not display_name:
        return None
    nodes = ((flow or {}).get("data") or {}).get("nodes") or []
    matches = [
        (node.get("data") or {}).get("id") or node.get("id")
        for node in nodes
        if (((node.get("data") or {}).get("node") or {}).get("display_name") or "") == display_name
    ]
    return matches[0] if len(matches) == 1 else None


def _error(*, message: str, kind: str, component_name: str | None, flow: dict | None) -> dict[str, Any]:
    error: dict[str, Any] = {"kind": kind, "message": message}
    recommendation = get_error_recommendation(message)
    if recommendation:
        error["recommendation"] = recommendation
    if component_name:
        error["component_name"] = component_name
        component_id = _component_id(flow, component_name)
        if component_id:
            error["component_id"] = component_id
    return error


def _with_run_facts(result: dict[str, Any], *, metrics: dict | None, probe_input: str | None) -> dict[str, Any]:
    duration = (metrics or {}).get("duration_seconds")
    if isinstance(duration, (int, float)):
        result["duration_seconds"] = duration
    if probe_input:
        result["probe_input"] = probe_input
    return result


def from_run(
    run: dict[str, Any],
    *,
    flow: dict | None = None,
    trigger: TestTrigger = "manual",
    probe_input: str | None = None,
    output_preview: str | None = None,
) -> dict[str, Any]:
    """Result of a single run (``run_working_flow``'s envelope), with no fix loop."""
    result: dict[str, Any] = {"trigger": trigger, "attempts": 1, "fixed": False}
    message = run.get("error")
    if message:
        kind = classify_run_error(message)
        result["status"] = "needs_attention" if kind in _NOT_FIXABLE else "failed"
        result["error"] = _error(message=message, kind=kind.value, component_name=run.get("error_component"), flow=flow)
    else:
        result["status"] = "passed"
        if output_preview:
            result["output_preview"] = output_preview
    return _with_run_facts(result, metrics=run.get("metrics"), probe_input=probe_input)


def skipped(reason: SkippedReason, *, trigger: TestTrigger = "build") -> dict[str, Any]:
    """The flow changed but was not run. The UI shows "Not tested yet" and offers a test."""
    return {"status": "skipped", "trigger": trigger, "skipped_reason": reason}
