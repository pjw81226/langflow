"""The ``test_result`` object attached to a turn's complete event."""

from __future__ import annotations

from langflow.agentic.services import flow_test_result
from langflow.agentic.services.flow_verification import FlowVerificationResult, FlowVerificationStatus

FLOW = {
    "data": {
        "nodes": [
            {"id": "Agent-1", "data": {"id": "Agent-1", "node": {"display_name": "Agent"}}},
            {"id": "URLComponent-1", "data": {"id": "URLComponent-1", "node": {"display_name": "URL"}}},
            {"id": "URLComponent-2", "data": {"id": "URLComponent-2", "node": {"display_name": "URL"}}},
        ]
    }
}


def _verification(status, **kwargs) -> FlowVerificationResult:
    return FlowVerificationResult(status, kwargs.pop("attempts", 1), kwargs.pop("caveat", None), FLOW, **kwargs)


def test_a_passed_verification_reports_what_the_run_showed():
    result = flow_test_result.from_verification(
        _verification(
            FlowVerificationStatus.PASSED,
            output="Hi there!",
            metrics={"duration_seconds": 3.2, "total_tokens": 40},
            probe_input="Hello",
        )
    )

    assert result == {
        "status": "passed",
        "trigger": "build",
        "attempts": 1,
        "fixed": False,
        "output_preview": "Hi there!",
        "duration_seconds": 3.2,
        "probe_input": "Hello",
    }


def test_a_pass_after_a_fix_turn_says_the_flow_was_fixed():
    result = flow_test_result.from_verification(_verification(FlowVerificationStatus.PASSED, attempts=2))

    assert result["fixed"] is True


def test_a_missing_credential_needs_attention_and_is_not_offered_as_fixable():
    result = flow_test_result.from_verification(
        _verification(
            FlowVerificationStatus.NEEDS_CAVEAT,
            caveat="I couldn't fully run it here because: Incorrect API key provided.",
            error="Incorrect API key provided",
            error_kind="external_resource",
            error_component="Agent",
        )
    )

    assert result["status"] == "needs_attention"
    assert result["error"]["kind"] == "external_resource"
    assert result["error"]["message"] == "Incorrect API key provided"
    assert result["error"]["component_name"] == "Agent"
    assert result["error"]["component_id"] == "Agent-1"
    assert "output_preview" not in result


def test_a_failed_verification_names_the_error_kind_the_ui_gates_fix_it_on():
    result = flow_test_result.from_verification(
        _verification(
            FlowVerificationStatus.FAILED,
            attempts=3,
            caveat="couldn't get it to run",
            error="AttributeError: 'NoneType' object has no attribute 'text'",
            error_kind="fixable",
        )
    )

    assert result["status"] == "failed"
    assert result["attempts"] == 3
    assert result["fixed"] is False
    assert result["error"]["kind"] == "fixable"


def test_a_structural_result_without_run_facts_still_has_a_message():
    """Loops are validated, not run: there is a caveat but no captured run error."""
    result = flow_test_result.from_verification(
        _verification(FlowVerificationStatus.NEEDS_CAVEAT, caveat="This flow contains a loop ...")
    )

    assert result["status"] == "needs_attention"
    assert result["error"] == {"kind": "unknown", "message": "This flow contains a loop ..."}
    assert "duration_seconds" not in result


def test_an_ambiguous_display_name_is_reported_without_an_id():
    result = flow_test_result.from_run({"error": "boom", "error_component": "URL"}, flow=FLOW)

    assert result["error"]["component_name"] == "URL"
    assert "component_id" not in result["error"]


def test_a_single_run_is_classified_like_the_verification_loop_would():
    timed_out = flow_test_result.from_run(
        {"error": "The flow run timed out after 120s.", "metrics": {"duration_seconds": 120.0}}
    )
    broken = flow_test_result.from_run({"error": "NameError: name 'x' is not defined"})
    passed = flow_test_result.from_run(
        {"result": "ok", "metrics": {"duration_seconds": 1.5}}, probe_input="Hello", output_preview="ok"
    )

    assert (timed_out["status"], timed_out["error"]["kind"], timed_out["duration_seconds"]) == (
        "needs_attention",
        "timeout",
        120.0,
    )
    assert (broken["status"], broken["error"]["kind"]) == ("failed", "fixable")
    assert passed == {
        "trigger": "manual",
        "attempts": 1,
        "fixed": False,
        "status": "passed",
        "output_preview": "ok",
        "duration_seconds": 1.5,
        "probe_input": "Hello",
    }


def test_a_known_error_carries_its_recommendation():
    # The runner reports the friendly form of a provider error.
    result = flow_test_result.from_run({"error": "Authentication failed. Check your API key."})

    assert result["status"] == "needs_attention"
    assert result["error"]["recommendation"] == "Check the API key in Settings → Model Providers."


def test_an_unknown_error_has_no_recommendation():
    result = flow_test_result.from_run({"error": "NameError: name 'x' is not defined"})

    assert "recommendation" not in result["error"]


def test_skipped_says_why_the_flow_was_not_run():
    assert flow_test_result.skipped("edit_not_verified") == {
        "status": "skipped",
        "trigger": "build",
        "skipped_reason": "edit_not_verified",
    }
