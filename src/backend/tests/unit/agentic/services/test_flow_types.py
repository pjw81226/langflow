"""Tests for flow execution types and constants.

Tests the dataclasses and constants used in flow execution.
"""

from pathlib import Path

from langflow.agentic.services.flow_types import (
    ASK_ASSISTANT_FLOW,
    COMPONENT_WRITER_FLOW,
    FLOWS_BASE_PATH,
    PROMPT_WRITER_FLOW,
    STREAMING_EVENT_TIMEOUT_SECONDS,
    STREAMING_QUEUE_MAX_SIZE,
    VALIDATION_UI_DELAY_SECONDS,
    FlowExecutionResult,
)


class TestFlowExecutionResult:
    """Tests for FlowExecutionResult dataclass."""

    def test_should_create_with_defaults(self):
        """Should create with empty result and no error by default."""
        result = FlowExecutionResult()
        assert result.result == {}
        assert result.error is None

    def test_should_detect_error_when_set(self):
        """Should return has_error=True when error is set."""
        result = FlowExecutionResult(error=ValueError("test error"))
        assert result.has_error is True
        assert result.has_result is False

    def test_should_detect_result_when_set(self):
        """Should return has_result=True when result is non-empty."""
        result = FlowExecutionResult(result={"key": "value"})
        assert result.has_result is True
        assert result.has_error is False

    def test_should_allow_both_result_and_error(self):
        """Should allow both result and error to be set simultaneously."""
        result = FlowExecutionResult(
            result={"partial": "data"},
            error=RuntimeError("partial failure"),
        )
        assert result.has_result is True
        assert result.has_error is True

    def test_should_return_false_for_empty_dict_result(self):
        """Should return has_result=False for empty dict."""
        result = FlowExecutionResult(result={})
        assert result.has_result is False

    def test_should_store_exception_details(self):
        """Should preserve exception details."""
        error = ValueError("detailed message")
        result = FlowExecutionResult(error=error)
        assert result.error is error
        assert str(result.error) == "detailed message"


class TestConstants:
    """Tests for module constants."""

    def test_flows_base_path_should_exist(self):
        """FLOWS_BASE_PATH should be a valid path to flows directory."""
        assert isinstance(FLOWS_BASE_PATH, Path)
        assert FLOWS_BASE_PATH.name == "flows"

    def test_flows_base_path_parent_should_be_agentic(self):
        """FLOWS_BASE_PATH parent should be agentic directory."""
        assert FLOWS_BASE_PATH.parent.name == "agentic"

    def test_streaming_queue_max_size_should_be_positive(self):
        """STREAMING_QUEUE_MAX_SIZE should be a positive integer."""
        assert isinstance(STREAMING_QUEUE_MAX_SIZE, int)
        assert STREAMING_QUEUE_MAX_SIZE > 0

    def test_streaming_queue_max_size_should_be_reasonable(self):
        """STREAMING_QUEUE_MAX_SIZE should be within reasonable bounds."""
        assert STREAMING_QUEUE_MAX_SIZE >= 100
        assert STREAMING_QUEUE_MAX_SIZE <= 10000

    def test_streaming_timeout_should_be_positive(self):
        """STREAMING_EVENT_TIMEOUT_SECONDS should be positive."""
        assert isinstance(STREAMING_EVENT_TIMEOUT_SECONDS, float)
        assert STREAMING_EVENT_TIMEOUT_SECONDS > 0

    def test_streaming_timeout_should_be_reasonable(self):
        """STREAMING_EVENT_TIMEOUT_SECONDS should be within reasonable bounds."""
        assert STREAMING_EVENT_TIMEOUT_SECONDS >= 30
        assert STREAMING_EVENT_TIMEOUT_SECONDS <= 600

    def test_validation_ui_delay_should_be_small(self):
        """VALIDATION_UI_DELAY_SECONDS should be a small positive value."""
        assert isinstance(VALIDATION_UI_DELAY_SECONDS, float)
        assert VALIDATION_UI_DELAY_SECONDS > 0
        assert VALIDATION_UI_DELAY_SECONDS < 2

    def test_every_agent_flow_resolves_to_a_python_module(self):
        """Each tab's agent is loaded by file name from the flows folder."""
        for name in (ASK_ASSISTANT_FLOW, COMPONENT_WRITER_FLOW, PROMPT_WRITER_FLOW):
            assert (FLOWS_BASE_PATH / f"{name}.py").is_file(), name
