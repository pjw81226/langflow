"""The ``test_result`` object the Test flow action attaches to its complete event."""

from __future__ import annotations

from langflow.agentic.services import flow_test_result

FLOW = {
    "data": {
        "nodes": [
            {"id": "Agent-1", "data": {"id": "Agent-1", "node": {"display_name": "Agent"}}},
            {"id": "URLComponent-1", "data": {"id": "URLComponent-1", "node": {"display_name": "URL"}}},
            {"id": "URLComponent-2", "data": {"id": "URLComponent-2", "node": {"display_name": "URL"}}},
        ]
    }
}


def test_an_ambiguous_display_name_is_reported_without_an_id():
    result = flow_test_result.from_run({"error": "boom", "error_component": "URL"}, flow=FLOW)

    assert result["error"]["component_name"] == "URL"
    assert "component_id" not in result["error"]


def test_a_single_run_is_classified_by_what_went_wrong():
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
