"""Request and response schemas for the Assistant API."""

from typing import Literal

from lfx.services.deps import get_settings_service
from pydantic import BaseModel, Field, field_validator

# All possible step types for SSE progress events
StepType = Literal[
    "generating",  # LLM is generating response
    "generating_component",  # LLM is generating component code
    "generating_plan",  # LLM is drafting a plan (precedes propose_plan / build_flow)
    "generating_flow",  # LLM is building a flow
    "orchestrating",  # Single agent loop working a multi-ask request (component + flow + run)
    "generation_complete",  # LLM finished generating
    "extracting_code",  # Extracting Python code from response
    "validating",  # Validating component code
    "validated",  # Validation succeeded
    "validation_failed",  # Validation failed
    "retrying",  # About to retry with error context
    "searching_components",  # Agent is searching for components
    "building_flow",  # Agent is building a flow from spec
    "flow_built",  # Flow built successfully
    "flow_build_failed",  # Flow build failed
    "flow_proposal_ready",  # Build-from-scratch flow ready, gated on user Continue/Dismiss
    "verifying_flow",  # The built flow is being test-run before it is delivered
    "writing_prompt",  # The prompt writer is drafting instructions
    "generating_document",  # Agent is materializing a file in the sandboxed workspace
    "document_ready",  # File write completed
]


# A glossary is a short list of short labels. The caps keep it from becoming a second,
# unbounded prompt channel.
MAX_UI_GLOSSARY_ENTRIES = 60
MAX_UI_GLOSSARY_LABEL_CHARS = 80


def _reject_overlong_message(value: str | None) -> str | None:
    """Enforce ``LANGFLOW_ASSISTANT_MAX_MESSAGE_LENGTH`` on an assistant prompt.

    Checked at request time rather than as a static ``max_length`` so the limit stays a single
    operator-tunable number shared with the UI (mirrored through ``/api/v1/config``); a static
    schema bound would drift from whatever the deployment configured.
    """
    if value is None:
        return value
    limit = get_settings_service().settings.assistant_max_message_length
    if len(value) > limit:
        msg = f"Message is too long: {len(value)} characters, limit is {limit}."
        raise ValueError(msg)
    return value


class AssistantRequest(BaseModel):
    """Request model for assistant interactions."""

    flow_id: str
    component_id: str | None = None
    field_name: str | None = None
    # The live text of ``field_name`` on ``component_id``, sent with Prompt turns. It is
    # quoted data, not a message, so it keeps its line breaks and has its own cap.
    field_value: str | None = Field(None, max_length=20_000)
    input_value: str | None = None
    max_retries: int | None = Field(None, ge=1, le=5)
    model_name: str | None = None
    provider: str | None = None
    session_id: str | None = None
    history_limit: int | None = Field(None, ge=0, le=100)
    iterations_limit: int | None = Field(None, ge=1, le=200)
    # Panel mode chosen by the user. None keeps the classifier-driven routing;
    # "ask" is a read-only help turn that never changes the canvas. "component" and
    # "prompt" are the tabs of the assistant that replaces the classifier.
    mode: Literal["build", "ask", "component", "prompt"] | None = None
    # "test_flow" runs the flow on the canvas once and returns a test_result. It is
    # not an agent turn: no classification, no LLM, and input_value is ignored.
    action: Literal["test_flow"] | None = None
    # The panel applies built flows without asking (its auto-apply preference). The
    # agent is told, so it reports the flow as added to the canvas, not as proposed.
    auto_apply: bool | None = None
    # UI labels as the user sees them, {English label: label in the UI language}, sent
    # with Ask turns when the UI is not in English. The docs are English, so without it
    # a label quoted in the user's language cannot be matched to what the docs describe.
    ui_glossary: dict[str, str] | None = None

    @field_validator("ui_glossary")
    @classmethod
    def check_ui_glossary(cls, value: dict[str, str] | None) -> dict[str, str] | None:
        if value is None:
            return None
        if len(value) > MAX_UI_GLOSSARY_ENTRIES:
            msg = f"ui_glossary has {len(value)} entries, limit is {MAX_UI_GLOSSARY_ENTRIES}."
            raise ValueError(msg)
        for english, shown in value.items():
            if len(english) > MAX_UI_GLOSSARY_LABEL_CHARS or len(shown) > MAX_UI_GLOSSARY_LABEL_CHARS:
                msg = f"ui_glossary labels are limited to {MAX_UI_GLOSSARY_LABEL_CHARS} characters."
                raise ValueError(msg)
        return value

    @field_validator("input_value")
    @classmethod
    def check_input_value_length(cls, value: str | None) -> str | None:
        return _reject_overlong_message(value)


class ValidationResult(BaseModel):
    """Result of component code validation."""

    is_valid: bool
    code: str | None = None
    error: str | None = None
    class_name: str | None = None
