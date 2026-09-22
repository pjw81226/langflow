"""Request and response schemas for the Assistant API."""

from typing import Annotated, Literal

from lfx.services.deps import get_settings_service
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

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
    "generating_document",  # Agent is materializing a file in the sandboxed workspace
    "document_ready",  # File write completed
]


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
    input_value: str | None = None
    max_retries: int | None = Field(None, ge=1, le=5)
    model_name: str | None = None
    provider: str | None = None
    session_id: str | None = None
    history_limit: int | None = Field(None, ge=0, le=100)
    iterations_limit: int | None = Field(None, ge=1, le=200)

    @field_validator("input_value")
    @classmethod
    def check_input_value_length(cls, value: str | None) -> str | None:
        return _reject_overlong_message(value)


class HeadlessAssistantRequest(BaseModel):
    """Request model for the headless (auto-apply) assistant route.

    Unlike ``AssistantRequest`` the flow is optional (one is created when absent)
    and the caller is not a UI, so there is no component/field review context.
    """

    instruction: str
    flow_id: str | None = None
    provider: str | None = None
    model_name: str | None = None
    session_id: str | None = None

    @field_validator("instruction")
    @classmethod
    def check_instruction_length(cls, value: str) -> str:
        _reject_overlong_message(value)
        return value


class _InterviewModel(BaseModel):
    """Strict, bounded base for work-interview wire models."""

    model_config = ConfigDict(extra="forbid")


class InterviewAnswers(_InterviewModel):
    role: str = Field(max_length=500)
    task: str = Field(max_length=1000)
    sources: list[Annotated[str, Field(max_length=200)]] = Field(max_length=8)
    process: str = Field(max_length=4000)
    output: str = Field(max_length=1000)
    frequency: str | None = Field(default=None, max_length=500)


class InterviewRule(_InterviewModel):
    text: str = Field(min_length=1, max_length=1000)
    source: Literal["user", "suggested"]


class InterviewStep(_InterviewModel):
    id: str = Field(min_length=1, max_length=100)
    label: str = Field(min_length=1, max_length=200)
    description: str = Field(min_length=1, max_length=1000)
    kind: Literal["input", "action", "decision", "output", "human"]
    actor: Literal["user", "ai"]
    node_ids: list[Annotated[str, Field(max_length=200)]] = Field(max_length=8)

    @model_validator(mode="after")
    def remove_node_ids_from_human_steps(self):
        if self.kind == "human":
            self.node_ids = []
        return self


class InterviewEdge(_InterviewModel):
    source: str = Field(min_length=1, max_length=100)
    target: str = Field(min_length=1, max_length=100)
    label: str = Field(max_length=200)


class WorkOpportunity(_InterviewModel):
    id: str = Field(min_length=1, max_length=100)
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(min_length=1, max_length=2000)
    input: str = Field(min_length=1, max_length=1000)
    output: str = Field(min_length=1, max_length=1000)
    review: str = Field(min_length=1, max_length=1000)
    rules: list[InterviewRule] = Field(max_length=12)
    steps: list[InterviewStep] = Field(min_length=3, max_length=6)
    edges: list[InterviewEdge] = Field(max_length=12)

    @model_validator(mode="after")
    def validate_graph_shape(self):
        step_ids = [step.id for step in self.steps]
        if len(step_ids) != len(set(step_ids)):
            msg = "Opportunity step ids must be unique."
            raise ValueError(msg)
        unknown = {
            endpoint
            for edge in self.edges
            for endpoint in (edge.source, edge.target)
            if endpoint not in step_ids
        }
        if unknown:
            msg = f"Opportunity edges reference an unknown step: {', '.join(sorted(unknown))}."
            raise ValueError(msg)
        return self


class InterviewFollowUpAnswer(_InterviewModel):
    question: str = Field(min_length=1, max_length=1000)
    answer: str = Field(min_length=1, max_length=2000)


class InterviewRequest(_InterviewModel):
    flow_id: str = Field(min_length=1, max_length=100)
    stage: Literal["examples", "recommend", "refine", "explain"]
    answers: InterviewAnswers
    follow_up_answers: list[InterviewFollowUpAnswer] | None = Field(default=None, max_length=2)
    opportunity: WorkOpportunity | None = None
    feedback: str | None = Field(default=None, max_length=4000)
    provider: str | None = Field(default=None, max_length=100)
    model_name: str | None = Field(default=None, max_length=200)

    @model_validator(mode="after")
    def validate_stage_inputs(self):
        if self.stage in {"refine", "explain"} and self.opportunity is None:
            msg = f"opportunity is required for the {self.stage} stage."
            raise ValueError(msg)
        return self


class InterviewResponse(_InterviewModel):
    summary: str = Field(max_length=2000)
    examples: list[Annotated[str, Field(max_length=500)]] = Field(max_length=6)
    follow_up_questions: list[Annotated[str, Field(max_length=500)]] = Field(max_length=2)
    opportunities: list[WorkOpportunity] = Field(max_length=3)


class ValidationResult(BaseModel):
    """Result of component code validation."""

    is_valid: bool
    code: str | None = None
    error: str | None = None
    class_name: str | None = None
