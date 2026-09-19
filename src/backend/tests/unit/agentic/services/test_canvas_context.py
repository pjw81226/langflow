"""Tests for the canvas context an assistant turn works from.

The router hands the turn a snapshot of the saved flow; these helpers turn it
into the quoted canvas reference and into the target a written prompt goes to.
"""

from __future__ import annotations

import pytest
from langflow.agentic.services import canvas_context
from langflow.agentic.services.canvas_context import (
    ToolInfo,
    canvas_reference_block,
    is_default_prompt,
    resolve_prompt_target,
)
from langflow.agentic.services.flow_types import MAX_CANVAS_SUMMARY_CHARS
from lfx.base.agents.default_system_prompt import DEFAULT_SYSTEM_PROMPT_TEMPLATE


def _node(node_id, node_type, *, display_name=None, template=None, description=""):
    return {
        "id": node_id,
        "data": {
            "id": node_id,
            "type": node_type,
            "node": {"display_name": display_name or node_type, "description": description, "template": template or {}},
        },
    }


def _edge(source, target, field):
    return {
        "source": source,
        "target": target,
        "data": {"sourceHandle": {"name": "out", "id": source}, "targetHandle": {"fieldName": field, "id": target}},
    }


def _canvas(nodes, edges=()):
    return {"name": "My flow", "data": {"nodes": list(nodes), "edges": list(edges)}}


def _agent(node_id="Agent-a1", *, prompt="Be brief.", display_name="Agent", model=""):
    return _node(
        node_id,
        "Agent",
        display_name=display_name,
        template={
            "system_prompt": {"type": "str", "display_name": "Agent Instructions", "value": prompt, "show": True},
            "model": {"value": model},
        },
    )


class TestCanvasReference:
    def test_should_return_none_for_no_canvas(self):
        assert canvas_reference_block(None) is None
        assert canvas_reference_block(_canvas([])) is None

    def test_should_frame_the_summary_as_quoted_data_with_visible_names(self):
        block = canvas_reference_block(_canvas([_agent(display_name="Support Agent")]))

        assert block.startswith("[Canvas reference (quoted prior state")
        assert block.endswith("[End of canvas reference]")
        assert "Agent-a1: Agent" in block
        assert "Agent-a1: Support Agent" in block

    def test_should_truncate_a_huge_summary(self, monkeypatch):
        monkeypatch.setattr(canvas_context, "flow_to_spec_summary", lambda _c: "X" * (MAX_CANVAS_SUMMARY_CHARS * 5))

        block = canvas_reference_block(_canvas([_agent()]))

        assert "X" * (MAX_CANVAS_SUMMARY_CHARS + 1) not in block
        assert "... [truncated]" in block

    def test_should_degrade_to_none_when_the_summary_fails(self, monkeypatch):
        def boom(_canvas):
            msg = "bad flow"
            raise ValueError(msg)

        monkeypatch.setattr(canvas_context, "flow_to_spec_summary", boom)

        assert canvas_reference_block(_canvas([_agent()])) is None


class TestPromptTarget:
    def test_should_have_no_target_without_a_component(self):
        assert resolve_prompt_target(_canvas([_agent()]), component_id=None, field_name=None, field_value=None) is None

    def test_should_find_the_agent_instructions_by_default(self):
        target = resolve_prompt_target(_canvas([_agent()]), component_id="Agent-a1", field_name=None, field_value=None)

        assert target.field == "system_prompt"
        assert target.field_label == "Agent Instructions"
        assert target.component_name == "Agent"
        assert target.current_value == "Be brief."
        assert target.applicable
        assert target.brace_mode == "placeholders"
        assert target.ref == "Agent-a1:system_prompt"

    def test_should_prefer_the_live_value_the_panel_sent(self):
        target = resolve_prompt_target(
            _canvas([_agent(prompt="saved")]), component_id="Agent-a1", field_name="system_prompt", field_value="live"
        )

        assert target.current_value == "live"

    def test_should_keep_newlines_in_the_live_value(self):
        target = resolve_prompt_target(
            _canvas([_agent()]), component_id="Agent-a1", field_name="system_prompt", field_value="line 1\nline 2"
        )

        assert target.current_value == "line 1\nline 2"

    def test_should_use_system_message_on_a_language_model(self):
        model = _node(
            "LanguageModelComponent-m1",
            "LanguageModelComponent",
            display_name="Language Model",
            template={"system_message": {"type": "str", "display_name": "System Message", "value": ""}},
        )

        target = resolve_prompt_target(
            _canvas([model]), component_id="LanguageModelComponent-m1", field_name=None, field_value=None
        )

        assert target.field == "system_message"
        assert target.field_label == "System Message"
        assert target.brace_mode == "literal"

    def test_should_trust_the_request_for_a_component_not_saved_yet(self):
        target = resolve_prompt_target(
            _canvas([]), component_id="Agent-new01", field_name="system_prompt", field_value="draft"
        )

        assert target.on_canvas is False
        assert target.applicable
        assert target.component_type == "Agent"
        assert target.current_value == "draft"
        assert target.brace_mode == "placeholders"

    def test_should_have_no_target_for_an_unsaved_component_without_a_field(self):
        assert resolve_prompt_target(_canvas([]), component_id="Agent-new01", field_name=None, field_value=None) is None

    def test_should_mark_a_component_without_instructions_as_unavailable(self):
        chat_input = _node("ChatInput-c1", "ChatInput", display_name="Chat Input")

        target = resolve_prompt_target(
            _canvas([chat_input]), component_id="ChatInput-c1", field_name=None, field_value=None
        )

        assert target.unavailable_reason == "no_field"
        assert not target.applicable

    def test_should_mark_a_field_fed_by_a_connection_as_unavailable(self):
        prompt = _node("Prompt-p1", "Prompt", display_name="Prompt Template")
        canvas = _canvas([_agent(), prompt], [_edge("Prompt-p1", "Agent-a1", "system_prompt")])

        target = resolve_prompt_target(canvas, component_id="Agent-a1", field_name="system_prompt", field_value=None)

        assert target.connected_from == "Prompt Template"
        assert target.unavailable_reason == "connected"
        assert not target.applicable

    def test_should_list_only_enabled_tools(self):
        search = _node(
            "WebSearch-w1",
            "UnifiedWebSearch",
            display_name="Web Search",
            template={
                "tools_metadata": {
                    "value": [
                        {"name": "perform_search", "description": "Search the web.", "status": True},
                        {"name": "fetch_news", "description": "Read news.", "status": False},
                    ]
                }
            },
        )
        calculator = _node("Calculator-k1", "Calculator", display_name="Calculator", description="Does math.")
        canvas = _canvas(
            [_agent(), search, calculator],
            [_edge("WebSearch-w1", "Agent-a1", "tools"), _edge("Calculator-k1", "Agent-a1", "tools")],
        )

        target = resolve_prompt_target(canvas, component_id="Agent-a1", field_name=None, field_value=None)

        assert target.tools == (
            ToolInfo("perform_search", "Search the web."),
            ToolInfo("Calculator", "Does math."),
        )

    @pytest.mark.parametrize(
        ("model_value", "expected"),
        [
            ([{"provider": "OpenAI", "name": "gpt-5.6-terra"}], "OpenAI gpt-5.6-terra"),
            ("gpt-4o", "gpt-4o"),
            ("", None),
        ],
    )
    def test_should_describe_the_model(self, model_value, expected):
        target = resolve_prompt_target(
            _canvas([_agent(model=model_value)]), component_id="Agent-a1", field_name=None, field_value=None
        )

        assert target.model == expected

    def test_should_detect_langflows_default_instructions(self):
        stock = "\n\n" + DEFAULT_SYSTEM_PROMPT_TEMPLATE.replace("\n", "\n  ") + "  "
        target = resolve_prompt_target(
            _canvas([_agent(prompt=stock)]), component_id="Agent-a1", field_name=None, field_value=None
        )

        assert target.holds_default
        assert not is_default_prompt("You are a pirate.")
        assert not is_default_prompt("")

    @pytest.mark.parametrize("component_type", ["OpenAIToolsAgent", "XMLAgent"])
    def test_should_treat_braces_as_template_syntax_for_langchain_agents(self, component_type):
        node = _node(
            f"{component_type}-x1",
            component_type,
            template={"system_prompt": {"type": "str", "display_name": "Prompt", "value": ""}},
        )

        target = resolve_prompt_target(
            _canvas([node]), component_id=f"{component_type}-x1", field_name=None, field_value=None
        )

        assert target.brace_mode == "template"
