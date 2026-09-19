"""Tests for API schemas.

Tests the Pydantic models used for request/response validation.
"""

import pytest
from langflow.agentic.api.schemas import (
    AssistantRequest,
    StepType,
    ValidationResult,
)
from lfx.services.deps import get_settings_service
from pydantic import ValidationError


class TestAssistantRequest:
    """Tests for AssistantRequest schema."""

    def test_should_create_with_a_message_only(self):
        request = AssistantRequest(flow_id="test-flow-id", input_value="hi")

        assert request.flow_id == "test-flow-id"
        assert request.mode == "ask"
        assert request.action is None
        assert request.component_id is None
        assert request.field_name is None
        assert request.field_value is None
        assert request.model_name is None
        assert request.provider is None
        assert request.session_id is None

    @pytest.mark.parametrize("mode", ["component", "prompt", "ask"])
    def test_should_accept_the_panel_tabs(self, mode):
        request = AssistantRequest(flow_id="test-flow-id", input_value="hi", mode=mode)

        assert request.mode == mode
        assert AssistantRequest.model_validate_json(request.model_dump_json()).mode == mode

    @pytest.mark.parametrize("mode", ["build", "chat", None])
    def test_should_reject_other_modes(self, mode):
        with pytest.raises(ValidationError):
            AssistantRequest(flow_id="test-flow-id", input_value="hi", mode=mode)

    def test_should_accept_the_test_flow_action_without_a_message(self):
        """The Test button sends no text."""
        request = AssistantRequest(flow_id="test-flow-id", action="test_flow")

        assert request.action == "test_flow"
        assert request.input_value is None

    def test_should_require_a_message_for_an_agent_turn(self):
        with pytest.raises(ValidationError):
            AssistantRequest(flow_id="test-flow-id")
        with pytest.raises(ValidationError):
            AssistantRequest(flow_id="test-flow-id", input_value="   ")

    def test_should_default_to_no_action_and_reject_unknown_ones(self):
        assert AssistantRequest(flow_id="test-flow-id", input_value="hi").action is None
        with pytest.raises(ValidationError):
            AssistantRequest(flow_id="test-flow-id", action="delete_flow")

    def test_should_carry_the_prompt_target_with_its_line_breaks(self):
        request = AssistantRequest(
            flow_id="flow-123",
            input_value="Make it friendly",
            mode="prompt",
            component_id="Agent-a1",
            field_name="system_prompt",
            field_value="Rule one.\nRule two.",
        )

        assert request.field_value == "Rule one.\nRule two."

    def test_should_cap_the_field_value(self):
        with pytest.raises(ValidationError):
            AssistantRequest(flow_id="f", input_value="hi", mode="prompt", field_value="x" * 20_001)

    def test_should_cap_the_session_id(self):
        with pytest.raises(ValidationError):
            AssistantRequest(flow_id="f", input_value="hi", session_id="s" * 129)

    def test_should_ignore_fields_the_old_panel_sent(self):
        request = AssistantRequest.model_validate(
            {"flow_id": "f", "input_value": "hi", "auto_apply": True, "history_limit": 3, "max_retries": 2}
        )

        assert not hasattr(request, "auto_apply")
        assert "history_limit" not in request.model_dump()

    def test_should_accept_a_small_ui_glossary(self):
        request = AssistantRequest(flow_id="test-flow-id", input_value="hi", ui_glossary={"Ask": "질문하기"})

        assert request.ui_glossary == {"Ask": "질문하기"}

    def test_should_reject_a_glossary_used_as_a_second_prompt(self):
        with pytest.raises(ValidationError):
            AssistantRequest(
                flow_id="test-flow-id", input_value="hi", ui_glossary={f"label {i}": "x" for i in range(61)}
            )
        with pytest.raises(ValidationError):
            AssistantRequest(flow_id="test-flow-id", input_value="hi", ui_glossary={"Ask": "x" * 81})

    def test_should_raise_error_for_missing_flow_id(self):
        """Should raise validation error when flow_id is missing."""
        with pytest.raises(ValidationError) as exc_info:
            AssistantRequest(input_value="hi")

        assert "flow_id" in str(exc_info.value)

    def test_should_serialize_to_dict(self):
        request = AssistantRequest(flow_id="test-flow", input_value="hi", provider="Anthropic")

        data = request.model_dump()

        assert data["flow_id"] == "test-flow"
        assert data["provider"] == "Anthropic"
        assert data["component_id"] is None


class TestValidationResult:
    """Tests for ValidationResult schema."""

    def test_should_create_valid_result(self):
        """Should create a valid validation result."""
        result = ValidationResult(
            is_valid=True,
            code="class MyComponent(Component): pass",
            class_name="MyComponent",
        )

        assert result.is_valid is True
        assert result.code == "class MyComponent(Component): pass"
        assert result.class_name == "MyComponent"
        assert result.error is None

    def test_should_create_invalid_result_with_error(self):
        """Should create an invalid validation result with error."""
        result = ValidationResult(
            is_valid=False,
            code="class Broken(Component)",
            error="SyntaxError: expected ':'",
            class_name="Broken",
        )

        assert result.is_valid is False
        assert result.error == "SyntaxError: expected ':'"
        assert result.class_name == "Broken"

    def test_should_create_with_required_field_only(self):
        """Should create with only required is_valid field."""
        result = ValidationResult(is_valid=False)

        assert result.is_valid is False
        assert result.code is None
        assert result.error is None
        assert result.class_name is None

    def test_should_serialize_to_dict(self):
        """Should serialize to dictionary correctly."""
        result = ValidationResult(
            is_valid=True,
            code="test code",
            class_name="TestComponent",
        )

        data = result.model_dump()

        assert data["is_valid"] is True
        assert data["code"] == "test code"
        assert data["class_name"] == "TestComponent"
        assert data["error"] is None

    def test_should_deserialize_from_dict(self):
        """Should deserialize from dictionary correctly."""
        data = {
            "is_valid": False,
            "error": "Test error",
        }

        result = ValidationResult(**data)

        assert result.is_valid is False
        assert result.error == "Test error"


class TestStepType:
    """Tests for StepType literal type."""

    def test_should_define_all_expected_step_types(self):
        """Should define exactly the steps the assistant emits."""
        expected_steps = [
            "generating",
            "generating_component",
            "extracting_code",
            "validating",
            "validated",
            "validation_failed",
            "retrying",
            "writing_prompt",
            "verifying_flow",
        ]

        # StepType is a Literal, we can check its args
        step_type_args = StepType.__args__

        assert set(step_type_args) == set(expected_steps)

    def test_step_types_should_be_strings(self):
        """All step types should be strings."""
        for step in StepType.__args__:
            assert isinstance(step, str)


class TestSchemaIntegration:
    """Integration tests for schema interactions."""

    def test_assistant_request_json_round_trip(self):
        """Should survive JSON serialization round trip."""
        original = AssistantRequest(
            flow_id="test-flow",
            component_id="comp-1",
            input_value="test",
            mode="component",
        )

        json_str = original.model_dump_json()
        restored = AssistantRequest.model_validate_json(json_str)

        assert restored == original

    def test_validation_result_json_round_trip(self):
        """Should survive JSON serialization round trip."""
        original = ValidationResult(
            is_valid=True,
            code="class Test: pass",
            class_name="Test",
        )

        json_str = original.model_dump_json()
        restored = ValidationResult.model_validate_json(json_str)

        assert restored.is_valid == original.is_valid
        assert restored.code == original.code
        assert restored.class_name == original.class_name


class TestAssistantMessageLengthLimit:
    """Tests for the operator-tunable prompt length cap."""

    def test_should_accept_a_prompt_at_the_default_limit(self):
        """A prompt of exactly the default limit is valid."""
        limit = get_settings_service().settings.assistant_max_message_length
        assert limit == 2000

        request = AssistantRequest(flow_id="flow-1", input_value="a" * limit)

        assert request.input_value is not None
        assert len(request.input_value) == limit

    def test_should_reject_a_prompt_over_the_limit(self):
        """A prompt past the limit is rejected with the limit in the message."""
        limit = get_settings_service().settings.assistant_max_message_length

        with pytest.raises(ValidationError) as exc_info:
            AssistantRequest(flow_id="flow-1", input_value="a" * (limit + 1))

        assert str(limit) in str(exc_info.value)

    def test_should_honor_a_raised_limit(self, monkeypatch):
        """Raising LANGFLOW_ASSISTANT_MAX_MESSAGE_LENGTH widens the limit."""
        settings = get_settings_service().settings
        monkeypatch.setattr(settings, "assistant_max_message_length", 6000)

        assert AssistantRequest(flow_id="flow-1", input_value="a" * 6000).input_value is not None

        with pytest.raises(ValidationError):
            AssistantRequest(flow_id="flow-1", input_value="a" * 6001)

    def test_should_honor_a_lowered_limit(self, monkeypatch):
        """Lowering the limit rejects prompts that the default would accept."""
        settings = get_settings_service().settings
        monkeypatch.setattr(settings, "assistant_max_message_length", 100)

        with pytest.raises(ValidationError):
            AssistantRequest(flow_id="flow-1", input_value="a" * 101)
