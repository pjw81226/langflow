"""Flow execution types and constants."""

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from fastapi import HTTPException

_GENERIC_FLOW_EXECUTION_DETAIL = "An internal error occurred while executing the flow."

# Base path for flow files (JSON and Python)
FLOWS_BASE_PATH = Path(__file__).parent.parent / "flows"

# Streaming configuration
STREAMING_QUEUE_MAX_SIZE = 1000
STREAMING_EVENT_TIMEOUT_SECONDS = 300.0

# Pause between component-check steps so the panel shows each one.
VALIDATION_UI_DELAY_SECONDS = 0.3
# Hard cap on the canvas-summary string injected into prompts. Large canvases
# (50+ components, long sticky notes, big custom-component code) can produce
# multi-kB summaries that get re-sent on every LLM turn — exploding cost and
# crowding out the user's actual instruction. 2000 chars is a few hundred
# tokens, enough to convey shape (node/edge graph) without dumping field-level
# detail. ``flow_to_spec_summary`` already runs first; this is the safety net.
MAX_CANVAS_SUMMARY_CHARS = 2000

# The assistant's agents, one per panel tab, by the file name the loader resolves.
# Read-only Q&A grounded on the bundled docs index (Ask tab).
ASK_ASSISTANT_FLOW = "ask_assistant"
# Writers behind the Component and Prompt tabs.
COMPONENT_WRITER_FLOW = "component_writer"
PROMPT_WRITER_FLOW = "prompt_writer"


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
    stack traces or internal identifiers. Internal callers (the assistant's turn
    runtime) read ``original_error_message`` to feed the friendly-error mapper
    for user-facing display.
    """

    def __init__(self, original_error_message: str, status_code: int = 500) -> None:
        super().__init__(status_code=status_code, detail=_GENERIC_FLOW_EXECUTION_DETAIL)
        self.original_error_message = original_error_message
