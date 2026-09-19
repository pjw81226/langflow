"""The Ask agent is read-only because of the tools it holds, not because it is told to be.

The panel promises that an Ask turn never changes the canvas. The prompt says so
too, but a prompt is a request. What actually guarantees it is that the agent is
never handed a tool that can add, connect, configure, build or run anything.
"""

from __future__ import annotations

from langflow.agentic.flows import ask_assistant
from langflow.agentic.flows.ask_assistant import (
    ASK_ASSISTANT_PROMPT,
    ASK_MAX_ITERATIONS,
    ASK_TOOL_NAMES,
    build_toolkit,
    get_graph,
)
from langflow.agentic.flows.flow_builder_assistant import build_toolkit as build_flow_builder_toolkit

# Every tool of the flow builder that changes the canvas, the workspace or runs a flow.
MUTATING_TOOL_NAMES = {
    "add_component",
    "remove_component",
    "connect_components",
    "configure_component",
    "build_flow",
    "run_flow",
    "use_template",
    "propose_plan",
    "propose_field_edit",
    "generate_component",
    "write_file",
    "edit_file",
}


async def test_the_toolkit_is_exactly_the_read_only_allow_list():
    names = {tool.name for tool in await build_toolkit()}

    assert names == ASK_TOOL_NAMES


async def test_the_toolkit_holds_no_tool_that_can_change_anything():
    names = {tool.name for tool in await build_toolkit()}

    assert not names & MUTATING_TOOL_NAMES


async def test_the_list_of_mutating_tools_is_the_flow_builders_own():
    """Guards the guard: a mutating tool renamed upstream must not slip past the check above."""
    builder_names = {tool.name for tool in await build_flow_builder_toolkit()}
    read_only_shared = ASK_TOOL_NAMES - {"search_docs", "read_doc"}
    sandbox_reads = {"read_file", "glob_search", "grep_search"}

    assert builder_names - read_only_shared - sandbox_reads == MUTATING_TOOL_NAMES


def test_the_prompt_states_the_contract_the_panel_relies_on():
    prompt = ASK_ASSISTANT_PROMPT

    assert "READ-ONLY" in prompt
    assert "switch the panel to **Build**" in prompt
    assert "Reply in the language of the user's latest message" in prompt
    assert "ALWAYS write search_docs queries as 3-8 English keywords" in prompt
    assert "Never invent a link" in prompt
    # The prompt may only name tools the agent really has.
    for tool_name in ("search_docs", "read_doc", "describe_component", "get_field_value", "describe_flow_io"):
        assert tool_name in prompt
        assert tool_name in ASK_TOOL_NAMES


async def test_the_graph_wires_chat_input_agent_and_chat_output():
    graph = await get_graph(provider="OpenAI", model_name="gpt-test")

    vertex_types = sorted(vertex.display_name for vertex in graph.vertices)
    assert vertex_types == ["Agent", "Chat Input", "Chat Output"]


async def test_the_step_budget_can_be_lowered_but_never_raised(monkeypatch):
    captured: list[int] = []
    original_set = ask_assistant.AgentComponent.set

    def spy(self, **kwargs):
        if "max_iterations" in kwargs:
            captured.append(kwargs["max_iterations"])
        return original_set(self, **kwargs)

    monkeypatch.setattr(ask_assistant.AgentComponent, "set", spy)

    await get_graph(provider="OpenAI", model_name="gpt-test")
    await get_graph(provider="OpenAI", model_name="gpt-test", iterations_limit=3)
    await get_graph(provider="OpenAI", model_name="gpt-test", iterations_limit=200)

    assert captured == [ASK_MAX_ITERATIONS, 3, ASK_MAX_ITERATIONS]
