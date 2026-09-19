"""Request and response schemas for the Assistant API."""

from typing import Literal

from lfx.services.deps import get_settings_service
from pydantic import BaseModel, Field, field_validator, model_validator

# All possible step types for SSE progress events
StepType = Literal[
    "generating",  # The Ask agent is answering
    "generating_component",  # The component writer is writing code
    "extracting_code",  # Extracting Python code from the reply
    "validating",  # Checking the component code
    "validated",  # The code passed every check
    "validation_failed",  # A check failed
    "retrying",  # About to retry with the error as context
    "writing_prompt",  # The prompt writer is drafting instructions
    "verifying_flow",  # The Test flow action is running the flow
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
    """Request model for one assistant turn."""

    flow_id: str
    input_value: str | None = None
    model_name: str | None = None
    provider: str | None = None
    session_id: str | None = Field(None, max_length=128)
    # The tab the user sent the message from. "ask" is a read-only help turn.
    mode: Literal["component", "prompt", "ask"] = "ask"
    # "test_flow" runs the flow on the canvas once and returns a test_result. It is
    # not an agent turn: no LLM runs, and input_value is only the panel's label.
    action: Literal["test_flow"] | None = None
    # The Prompt tab's target: which component and field the instructions are for.
    component_id: str | None = Field(None, max_length=200)
    field_name: str | None = Field(None, max_length=100)
    # The live text of that field. It is quoted data, not a message, so it keeps its
    # line breaks and has its own cap.
    field_value: str | None = Field(None, max_length=20_000)
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

    @model_validator(mode="after")
    def check_message_present(self) -> "AssistantRequest":
        if self.action is None and not (self.input_value or "").strip():
            msg = "input_value is required unless an action is given."
            raise ValueError(msg)
        return self


class ValidationResult(BaseModel):
    """Result of component code validation."""

    is_valid: bool
    code: str | None = None
    error: str | None = None
    class_name: str | None = None
