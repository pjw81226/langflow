"""Flow execution types and constants."""

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

from fastapi import HTTPException

_GENERIC_FLOW_EXECUTION_DETAIL = "An internal error occurred while executing the flow."

# Base path for flow files (JSON and Python)
FLOWS_BASE_PATH = Path(__file__).parent.parent / "flows"

# Streaming configuration
STREAMING_QUEUE_MAX_SIZE = 1000
STREAMING_EVENT_TIMEOUT_SECONDS = 300.0

# Assistant configuration
MAX_VALIDATION_RETRIES = 3
# Hard cost ceiling for the post-build flow-validation loop. Each attempt
# is deterministic (Tier-1 static + Tier-2 graph build, zero LLM tokens);
# the only LLM cost is the agent's own fix turn between attempts.
MAX_FLOW_VALIDATION_ATTEMPTS = 3
# Hard cost ceiling for the post-build flow-verification loop (real graph
# runs). Each attempt costs one full execution plus, at most, one agent
# fix turn — so the cap doubles as the user-visible "after N attempt(s)"
# caveat string emitted by ``_failed_caveat``.
MAX_FLOW_VERIFICATION_ATTEMPTS = 3
VALIDATION_UI_DELAY_SECONDS = 0.3
# Hard cap on the canvas-summary string injected into prompts. Large canvases
# (50+ components, long sticky notes, big custom-component code) can produce
# multi-kB summaries that get re-sent on every LLM turn — exploding cost and
# crowding out the user's actual instruction. 2000 chars is a few hundred
# tokens, enough to convey shape (node/edge graph) without dumping field-level
# detail. ``flow_to_spec_summary`` already runs first; this is the safety net.
MAX_CANVAS_SUMMARY_CHARS = 2000
LANGFLOW_ASSISTANT_FLOW = "LangflowAssistant.json"
FLOW_BUILDER_ASSISTANT_FLOW = "flow_builder_assistant"
# Read-only Q&A agent grounded on the bundled docs index (the panel's Ask mode).
ASK_ASSISTANT_FLOW = "ask_assistant"
# Writers behind the panel's Component and Prompt tabs.
COMPONENT_WRITER_FLOW = "component_writer"
PROMPT_WRITER_FLOW = "prompt_writer"
TRANSLATION_FLOW = "translation_flow.py"

# Verbatim text the frontend sends when the user clicks Continue on a
# proposed plan (manual approve or skip-all auto-approve). Used to switch
# the "Generating plan..." indicator into "Generating flow..." on the
# follow-up turn. Must stay in sync with `SKIP_ALL_APPROVAL_TEXT` in
# src/frontend/.../hooks/use-assistant-chat.ts.
PLAN_APPROVAL_INPUT = "User approved the plan. Proceed with the build."

# Verbatim text the frontend sends as a silent continuation turn once the
# user resolves a man-in-the-loop edit diff card with >=1 applied change.
# It lets the agent's "execution stack" survive the approval boundary so
# it can finish the rest of the original request (e.g. running the flow
# the user also asked for). Must stay byte-identical to
# `EDIT_CONTINUATION_INPUT` in src/frontend/.../hooks/use-assistant-chat.ts.
EDIT_CONTINUATION_INPUT = (
    "The proposed canvas edits were applied. Continue with the remaining steps of my "
    "previous request (for example, running the flow). If editing was the entire "
    "request, just confirm briefly."
)

# Explicit panel mode sent by the UI. ``None`` keeps the classifier-driven
# routing; "ask" is a read-only help turn that must never touch the canvas.
AssistantMode = Literal["build", "ask"]

# Prepended to the agent input when an Ask turn has to fall back to the default
# assistant flow (no docs index shipped). That flow advertises building, so the
# turn itself has to state that this one is read-only and where a build request
# belongs. The dedicated Ask flow carries the same rules in its system prompt.
ASK_MODE_PREAMBLE = (
    "[Panel mode: ASK. This is a read-only help turn. You cannot add, remove, connect, configure, "
    "build or run anything, so never say or imply that you did. Answer the question. If the user "
    "wants something built, changed, fixed or run, say in one or two sentences what would be done "
    "and tell them to switch the panel to Build and send the same request there. Reply in the "
    "language of the user's message.]\n\n"
)

# Prepended on build turns when the panel applies flows without asking. The agent
# otherwise narrates a flow as "proposed, waiting for your approval", which is
# false there and leaves the user looking for a button that never appears.
AUTO_APPLY_PREAMBLE = (
    "[The panel applies the flow you build to the canvas immediately; there is no approval step. "
    "Report it as added to the canvas. Do NOT call it proposed or pending, and do not ask the user "
    "to approve, continue or add it.]\n\n"
)

OFF_TOPIC_REFUSAL_MESSAGE = (
    "I appreciate your interest, but I'm the Langflow Assistant and can only help with "
    "Langflow-related topics such as building components, creating flows, configuring "
    "deployments, and troubleshooting issues. Could you rephrase your question about Langflow?"
)

VALIDATION_RETRY_TEMPLATE = """The previous component code has an error. Please fix it.

ERROR:
{error}

BROKEN CODE:
```python
{code}
```

Please provide a corrected version of the component code."""

# Env var that disables the post-build flow-verification loop (kill
# switch). Any value other than "0"/"false"/"no" keeps it enabled.
FLOW_VERIFICATION_ENABLED_ENV = "LANGFLOW_ASSISTANT_VERIFY_FLOWS"

# Fed back to the agent when a freshly built flow failed to RUN (not just
# build). Distinct from the component template — this is about a runnable
# graph, not a Python class.
FLOW_VERIFICATION_RETRY_TEMPLATE = """The flow you just built was executed to verify it works, \
but the run FAILED with this error:

{error}

Fix the flow so it runs end to end: correct the wiring, the component choice, the field values, \
or add the missing model on the Agent. Then rebuild the flow with the build tool. Do not just \
describe the fix — actually apply it."""

EXECUTION_RETRY_TEMPLATE = """The previous attempt to generate a component failed during flow execution.

ERROR:
{error}

ORIGINAL REQUEST:
{original_input}

Respond with a complete, valid Langflow component as a Python class extending Component, \
inside a single ```python code block. Do not emit raw tool calls or partial JSON."""

NO_ACTION_RETRY_TEMPLATE = """Your previous reply did not change the canvas. You only described \
what you would do, or asked for confirmation of something the user already requested.

ORIGINAL REQUEST:
{original_input}

Do it NOW by calling the canvas tools (propose_plan / build_flow / add_component / \
connect_components / configure_component). Rules:
- NEVER ask the user to confirm an action they already asked for — just perform it.
- NEVER claim an action was done without actually calling the tool that does it.
- Respond in the same language the user wrote in."""


@dataclass
class IntentResult:
    """Result from intent classification flow."""

    translation: str
    intent: str  # "generate_component", "build_flow", "manage_files", "question", or "off_topic"
    # TranslationFlow LLM cost for this classification turn. ``None`` when no
    # LLM call ran (empty text / EDIT_CONTINUATION_INPUT short-circuit) or when
    # the call failed before producing usage (timeout / generic exception).
    # The upstream assistant service sums it into the per-turn ``usage`` field
    # rendered by the chat ``MessageMetadata`` badge.
    tokens: dict[str, int] | None = None
    # The model the user EXPLICITLY named in their request (e.g. "use the OpenAI
    # gpt-5.4 model"), extracted by the TranslationFlow. ``None`` when the user
    # named no model. Downstream this is ENFORCED onto Agent nodes so the canvas
    # reflects exactly what the user asked for — never the assistant's own
    # runtime model. ``requested_provider`` is its provider (e.g. "OpenAI").
    requested_model: str | None = None
    requested_provider: str | None = None


@dataclass
class FlowExecutionResult:
    """Holds the result or error from async flow execution."""

    result: dict[str, Any] = field(default_factory=dict)
    error: Exception | None = None

    @property
    def has_error(self) -> bool:
        return self.error is not None

    @property
    def has_result(self) -> bool:
        return bool(self.result)


class FlowExecutionError(HTTPException):
    """Flow execution failure that keeps the raw error internal.

    The public ``detail`` stays generic so external HTTP callers never receive
    stack traces or internal identifiers. Internal callers (the assistant retry
    loop) read ``original_error_message`` to feed the friendly-error mapper for
    user-facing display.
    """

    def __init__(self, original_error_message: str, status_code: int = 500) -> None:
        super().__init__(status_code=status_code, detail=_GENERIC_FLOW_EXECUTION_DETAIL)
        self.original_error_message = original_error_message
