"""The runtime step budget a JSON assistant flow receives.

LangGraph derives an Agent's recursion limit from ``max_iterations``
(``max_iterations * 2 + 5``), so the budget injected into a JSON flow must reach
every Agent node and stay within bounds.
"""

import pytest
from langflow.agentic.services.flow_preparation import (
    MAX_ASSISTANT_ITERATIONS,
    inject_iterations_into_flow,
)


def _agent_max_iterations(flow: dict) -> int | None:
    for node in flow["data"]["nodes"]:
        if node["data"].get("type") == "Agent":
            return node["data"]["node"]["template"]["max_iterations"]["value"]
    return None


def _flow_with_agent(max_iterations: int = 15) -> dict:
    return {
        "data": {
            "nodes": [
                {
                    "data": {
                        "type": "Agent",
                        "node": {"template": {"max_iterations": {"value": max_iterations}}},
                    }
                },
                {"data": {"type": "ChatOutput", "node": {"template": {}}}},
            ]
        }
    }


def test_injects_the_runtime_budget_onto_every_agent():
    flow = inject_iterations_into_flow(_flow_with_agent(), 50)
    assert _agent_max_iterations(flow) == 50


def test_none_leaves_the_flow_default_untouched():
    flow = inject_iterations_into_flow(_flow_with_agent(15), None)
    assert _agent_max_iterations(flow) == 15


@pytest.mark.parametrize(
    ("requested", "expected"),
    [(0, 1), (-5, 1), (10_000, MAX_ASSISTANT_ITERATIONS)],
)
def test_clamps_out_of_range_budgets(requested, expected):
    """A bad input can neither disable the cap nor run away."""
    flow = inject_iterations_into_flow(_flow_with_agent(), requested)
    assert _agent_max_iterations(flow) == expected


def test_ignores_flows_without_an_agent():
    flow = {"data": {"nodes": [{"data": {"type": "ChatInput", "node": {"template": {}}}}]}}
    assert inject_iterations_into_flow(flow, 40) == flow
