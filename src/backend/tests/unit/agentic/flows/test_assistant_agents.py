"""The three assistant agents share one graph and hold only the tools they are allowed.

The panel promises that nothing reaches the canvas until the user presses a
button on a card. The prompts say so too, but a prompt is a request: what
guarantees it is that no agent is handed a tool that can add, connect,
configure, build or run anything. The shared graph also switches off the
Agent's own chat memory (the turn injects the conversation buffer instead) and
the date and calculator tools the Agent would otherwise add behind the
allow-lists' back.
"""

from __future__ import annotations

import inspect

import pytest
from langflow.agentic.flows import ask_assistant, assistant_agent, component_writer, prompt_writer
from langflow.agentic.flows.assistant_agent import CONTENT_POLICY
from lfx.custom import Component
from lfx.mcp import flow_builder_tools

# Tools of the flow-builder toolkit that only read. Everything else in it changes
# the canvas, the workspace or runs a flow.
READ_ONLY_FLOW_BUILDER_TOOLS = {
    "search_components",
    "describe_component",
    "describe_flow_io",
    "get_field_value",
    "list_templates",
}
# The sandboxed file tools the old builder held; no assistant agent may write files.
FILE_WRITE_TOOLS = {"write_file", "edit_file"}

AGENTS = [
    pytest.param(ask_assistant, ask_assistant.ASK_TOOL_NAMES, ask_assistant.ASK_ASSISTANT_PROMPT, id="ask"),
    pytest.param(
        component_writer,
        component_writer.COMPONENT_WRITER_TOOL_NAMES,
        component_writer.COMPONENT_WRITER_PROMPT,
        id="component",
    ),
    pytest.param(prompt_writer, frozenset(), prompt_writer.PROMPT_WRITER_PROMPT, id="prompt"),
]


async def _mutating_tool_names() -> set[str]:
    names: set[str] = set()
    for attr in flow_builder_tools.__all__:
        candidate = getattr(flow_builder_tools, attr)
        if inspect.isclass(candidate) and issubclass(candidate, Component):
            names.update(tool.name for tool in await candidate().to_toolkit())
    return (names - READ_ONLY_FLOW_BUILDER_TOOLS) | FILE_WRITE_TOOLS


async def test_the_mutating_tool_list_covers_the_flow_builder_toolkit():
    """Guards the guard: a mutating tool added or renamed upstream is caught below."""
    mutating = await _mutating_tool_names()

    assert {"add_component", "connect_components", "configure_component", "build_flow", "run_flow"} <= mutating
    assert {"propose_field_edit", "propose_plan", "generate_component", "use_template"} <= mutating
    assert not mutating & READ_ONLY_FLOW_BUILDER_TOOLS


@pytest.mark.parametrize(("module", "allowed", "_prompt"), AGENTS)
async def test_each_toolkit_is_exactly_its_allow_list(module, allowed, _prompt):
    names = {tool.name for tool in await module.build_toolkit()}

    assert names == set(allowed)


@pytest.mark.parametrize(("module", "_allowed", "_prompt"), AGENTS)
async def test_no_agent_holds_a_tool_that_changes_anything(module, _allowed, _prompt):
    names = {tool.name for tool in await module.build_toolkit()}

    assert not names & await _mutating_tool_names()


async def test_the_prompt_writer_holds_no_tools():
    assert await prompt_writer.build_toolkit() == []


@pytest.mark.parametrize(("module", "_allowed", "_prompt"), AGENTS)
async def test_every_agent_runs_without_chat_memory_or_hidden_tools(module, _allowed, _prompt, monkeypatch):
    agent_settings: dict = {}
    chat_input_settings: dict = {}
    original_agent_set = assistant_agent.AgentComponent.set
    original_input_set = assistant_agent.ChatInput.set

    def spy_agent(self, **kwargs):
        agent_settings.update(kwargs)
        return original_agent_set(self, **kwargs)

    def spy_input(self, **kwargs):
        chat_input_settings.update(kwargs)
        return original_input_set(self, **kwargs)

    monkeypatch.setattr(assistant_agent.AgentComponent, "set", spy_agent)
    monkeypatch.setattr(assistant_agent.ChatInput, "set", spy_input)

    graph = await module.get_graph(provider="OpenAI", model_name="gpt-test", api_key_var="OPENAI_API_KEY")

    assert sorted(vertex.display_name for vertex in graph.vertices) == ["Agent", "Chat Input", "Chat Output"]
    assert agent_settings["n_messages"] == 0
    assert agent_settings["add_current_date_tool"] is False
    assert agent_settings["add_calculator_tool"] is False
    assert agent_settings["api_key"] == "OPENAI_API_KEY"  # pragma: allowlist secret
    assert chat_input_settings["should_store_message"] is False


@pytest.mark.parametrize(("_module", "_allowed", "prompt"), AGENTS)
def test_every_prompt_carries_the_content_policy_and_the_language_rule(_module, _allowed, prompt):
    assert CONTENT_POLICY in prompt
    assert "language of the user's latest message" in prompt


@pytest.mark.parametrize(("_module", "_allowed", "prompt"), AGENTS)
def test_every_prompt_only_names_tools_its_agent_has(_module, _allowed, prompt):
    for tool_name in ("add_component", "build_flow", "propose_field_edit", "write_file", "run_flow"):
        assert tool_name not in prompt
