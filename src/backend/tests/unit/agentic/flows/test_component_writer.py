"""The component writer's prompt must agree with the checks its code has to pass."""

from __future__ import annotations

from langflow.agentic.flows.component_writer import COMPONENT_WRITER_PROMPT
from langflow.agentic.helpers import code_security
from langflow.agentic.helpers.code_extraction import extract_component_code
from langflow.agentic.helpers.code_security import scan_code_security
from langflow.agentic.helpers.validation import validate_component_code, validate_component_runtime

# The prompt is resent on every model call of every attempt; keep it lean.
MAX_PROMPT_CHARS = 14_000


def test_the_prompt_lists_everything_the_security_scanner_rejects():
    prompt = COMPONENT_WRITER_PROMPT

    for module in code_security.DANGEROUS_IMPORTS | set(code_security.DANGEROUS_SUBMODULES):
        assert module in prompt, module
    for call in code_security.DANGEROUS_CALLS:
        assert f"{call}()" in prompt, call
    for module, attr, _ in code_security.DANGEROUS_ATTR_CALLS:
        assert f"{module}.{attr}()" in prompt, attr
    for module, attr, _ in code_security.DANGEROUS_ATTRIBUTE_READS:
        assert f"{module}.{attr}" in prompt, attr
    for attr in code_security.DANGEROUS_DUNDER_ATTRS:
        assert attr in prompt, attr


def test_the_prompt_stays_under_its_size_budget():
    assert len(COMPONENT_WRITER_PROMPT) < MAX_PROMPT_CHARS


def test_the_prompt_states_the_reply_contract():
    prompt = COMPONENT_WRITER_PROMPT

    assert "Exactly one code block" in prompt
    assert "Nothing after the code block" in prompt
    assert "never say you added, connected, ran or saved anything" in prompt
    assert "keep its class name" in prompt
    assert "**Prompt** tab" in prompt
    assert "**Ask** tab" in prompt


def test_the_prompt_keeps_the_agent_tool_rules():
    prompt = COMPONENT_WRITER_PROMPT

    assert "Agent Tool Compatibility" in prompt
    for generic in ("output", "process", "run", "execute", "build_output"):
        assert f"`{generic}`" in prompt
    assert "get_random_menu_item" in prompt
    assert "fetch_weather" in prompt
    assert "tool description" in prompt
    assert "tool_mode=True" in prompt
    assert "info=" in prompt
    assert "component_as_tool" in prompt
    assert "to_toolkit" in prompt


def test_the_prompt_teaches_the_exact_input_parameters():
    prompt = COMPONENT_WRITER_PROMPT

    assert "range_spec=" in prompt
    assert "never `minimum=` or `maximum=`" in prompt
    assert "options=" in prompt
    assert "never `choices=`" in prompt
    assert "from lfx.custom import Component" in prompt
    assert "Never import from `langflow`" in prompt


async def test_the_example_component_in_the_prompt_passes_every_check():
    code = extract_component_code(COMPONENT_WRITER_PROMPT)

    assert code is not None
    assert "class WordCounterComponent(Component)" in code
    assert scan_code_security(code).is_safe
    assert validate_component_code(code).is_valid
    assert await validate_component_runtime(code) is None
