export type AgenticStepType =
  | "generating"
  | "generating_component"
  | "extracting_code"
  | "validating"
  | "validated"
  | "validation_failed"
  | "retrying"
  | "verifying_flow";

export interface AgenticProgressEvent {
  event: "progress";
  step: AgenticStepType;
  attempt: number;
  max_attempts: number;
  message?: string;
  error?: string;
  class_name?: string;
  component_code?: string;
}

export interface AgenticTokenEvent {
  event: "token";
  chunk: string;
}

export interface AgenticCompleteData {
  result: string;
  /** Component turns: the generated code passed validation. Missing = false. */
  validated?: boolean;
  /** Echo of the request mode, when one was sent. */
  mode?: AssistantMode;
  /** Test turns: the structured outcome of the run. */
  test_result?: AgenticTestResult;
  class_name?: string;
  component_code?: string;
  validation_attempts?: number;
  validation_error?: string;
  /** Accumulated LLM token usage for the whole turn — TranslationFlow
   * classification + every agent attempt. Same shape as the playground's
   * message metadata (``properties.usage``) so the ``MessageMetadata`` badge
   * is reused unchanged. Absent only if no LLM call ran on this turn. */
  usage?: {
    input_tokens?: number | null;
    output_tokens?: number | null;
    total_tokens?: number | null;
  };
  /** Wall-clock duration of the turn, measured server-side around the whole
   * pipeline. Rendered as the duration half of the cost badge. */
  duration_seconds?: number;
  /** Non-fatal model errors this turn recovered from (the chosen model failed
   * silently in the background and the assistant fell back / retried). Rendered
   * as an (i) next to the message so the swap is not hidden. Absent when the
   * chosen model worked. */
  notices?: AssistantModelNotice[];
}

/** A silent, recovered model failure surfaced to the user. */
export interface AssistantModelNotice {
  /** ``model_fallback`` (swapped to another model) or ``model_remediation``
   * (retried the same model with adjusted params). */
  type: "model_fallback" | "model_remediation" | string;
  /** User-facing friendly reason (e.g. "requires a subscription"). */
  reason: string;
  /** The model the user selected that failed. */
  failed_model?: string;
  /** The model that actually produced the answer (fallback only). */
  used_model?: string;
}

export interface AgenticCompleteEvent {
  event: "complete";
  data: AgenticCompleteData;
}

/** Additive structured-failure context on the SSE error event. All fields
 * optional — older backends simply omit ``detail`` and only ``message`` renders. */
export interface AgenticErrorDetail {
  /** Last progress step the backend emitted before failing. */
  step?: string;
  /** Component the backend was running when it failed. */
  component_id?: string;
  /** Tool involved in the failure, when extractable. */
  tool?: string;
  /** Pre-truncation error string (capped server-side at 2000 chars). */
  raw_cause?: string;
  /** Recommended next step mapped from the known error categories. */
  recommendation?: string;
}

export interface AgenticErrorEvent {
  event: "error";
  message: string;
  detail?: AgenticErrorDetail;
}

export interface AgenticCancelledEvent {
  event: "cancelled";
  message: string;
}

export type AgenticSSEEvent =
  | AgenticProgressEvent
  | AgenticTokenEvent
  | AgenticCompleteEvent
  | AgenticErrorEvent
  | AgenticCancelledEvent;

export type AgenticTestStatus =
  | "passed"
  | "failed"
  | "needs_attention"
  | "skipped";

/**
 * Why a test run failed. "external_resource" and "timeout" are not the agent's
 * to fix: the flow is sound and needs something from the user.
 */
export type AgenticTestErrorKind =
  | "fixable"
  | "external_resource"
  | "timeout"
  | "unknown"
  // Future kinds must not break an older client.
  | (string & {});

export interface AgenticTestResult {
  status: AgenticTestStatus;
  trigger?: "build" | "manual";
  attempts?: number;
  /** True when a fix turn repaired the flow before it passed. */
  fixed?: boolean;
  duration_seconds?: number;
  /** Text the run put into an empty Chat Input. */
  probe_input?: string;
  output_preview?: string;
  error?: {
    kind?: AgenticTestErrorKind;
    /** Server-side English; shown under "Details", never as the headline. */
    message?: string;
    recommendation?: string;
    component_name?: string;
    component_id?: string;
  };
  skipped_reason?: string;
}

/**
 * Panel mode the user picked for a turn. "build" lets the assistant change the
 * canvas (today's behaviour); "ask" is a read-only help turn.
 */
export type AssistantMode = "build" | "ask";

export interface AgenticAssistRequest {
  flow_id: string;
  input_value: string;
  model_name?: string;
  provider?: string;
  max_retries?: number;
  session_id?: string;
  /** Absent means "build". A backend without mode support ignores the field. */
  mode?: AssistantMode;
  /** "test_flow" runs the canvas flow once instead of starting an agent turn. */
  action?: "test_flow";
  /** {English label: label in the UI language}, sent with ask turns on a
   * translated UI so the agent can match labels to the English docs. */
  ui_glossary?: Record<string, string>;
}

export interface AgenticProgressState {
  step: AgenticStepType;
  attempt: number;
  maxAttempts: number;
  message?: string;
  error?: string;
  className?: string;
  componentCode?: string;
}

export interface AgenticResult {
  content: string;
  validated: boolean;
  className?: string;
  componentCode?: string;
  validationError?: string;
  validationAttempts?: number;
}
