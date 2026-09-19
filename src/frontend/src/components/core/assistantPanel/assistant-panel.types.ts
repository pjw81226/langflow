import type {
  AgenticErrorDetail,
  AgenticProgressState,
  AgenticResult,
  AgenticTestResult,
  AssistantMode,
  AssistantModelNotice,
} from "@/controllers/API/queries/agentic";

export type { AssistantMode };

export type AssistantMessageStatus =
  | "pending"
  | "streaming"
  | "complete"
  | "error"
  | "cancelled";

export interface AssistantMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** Panel mode this turn was sent in. Absent on test turns. */
  mode?: AssistantMode;
  /** Set on both messages of a "Test flow" turn: no agent ran. */
  action?: "test_flow";
  /** Prompt turns: the component and field the prompt was written for. */
  promptTarget?: PromptTargetRef;
  /** Outcome of the flow's test run, rendered as a result card. */
  testResult?: AgenticTestResult;
  timestamp: Date;
  status?: AssistantMessageStatus;
  progress?: AgenticProgressState;
  result?: AgenticResult;
  error?: string;
  /** Structured failure context from the SSE error event's additive
   * ``detail`` field — rendered as a collapsed "Error details" expander. */
  errorDetail?: AgenticErrorDetail;
  /**
   * True once the user has acknowledged the "Component ready" / validation
   * gate — either by clicking Continue or by the 30s auto-dismiss timer
   * firing. Persisted on the message so panel close/reopen (which
   * remounts the item) doesn't bring the gate back. Without this, local
   * state would reset and the user would see the loading card again on
   * every reopen.
   */
  validationAcknowledged?: boolean;
  /** Per-turn LLM cost reported by the backend on the ``complete`` SSE event.
   * Used by ``MessageMetadata`` (the playground's renderer, reused here) to
   * display the token-count + duration badge with the breakdown tooltip. */
  usage?: {
    input_tokens?: number | null;
    output_tokens?: number | null;
    total_tokens?: number | null;
  };
  /** Wall-clock duration of the turn in milliseconds (already converted from
   * the backend's ``duration_seconds``). Same units that ``MessageMetadata``
   * expects in the playground. */
  duration?: number;
  /** Non-fatal model errors this turn recovered from (silent fallback/retry).
   * Rendered as an (i) next to the message metadata. */
  notices?: AssistantModelNotice[];
}

/** The field a Prompt turn writes for, as the user picked it. */
export interface PromptTargetRef {
  componentId: string;
  fieldName: string;
  /** The component's name in the picker when the turn was sent. */
  label: string;
}

export interface AssistantModel {
  id: string;
  name: string;
  provider: string;
  displayName: string;
}

export interface AssistantPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

/** AssistantMessage with Date serialized as ISO string and progress stripped. */
export type SerializedAssistantMessage = Omit<
  AssistantMessage,
  "timestamp" | "progress"
> & {
  timestamp: string;
};

/** A saved session entry stored in localStorage. */
export interface SessionHistoryEntry {
  sessionId: string;
  firstUserMessage: string;
  messageCount: number;
  lastActiveAt: string;
  messages: SerializedAssistantMessage[];
}
