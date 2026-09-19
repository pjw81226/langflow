import type { AgenticStepType } from "@/controllers/API/queries/agentic";
import type {
  AssistantMessage,
  AssistantMode,
  AssistantModel,
  PromptTargetRef,
} from "../assistant-panel.types";

export interface AssistantSendOptions {
  /** Panel mode of an agent turn, "ask" when omitted. Ignored with an action. */
  mode?: AssistantMode;
  /** "test_flow": the backend runs the canvas flow once instead of starting
   * an agent turn; the content is only the bubble's label. */
  action?: "test_flow";
  /** Prompt turns: the field the prompt is for. Its current text is read
   * when the turn is sent. */
  promptTarget?: PromptTargetRef;
}

export interface UseAssistantChatReturn {
  messages: AssistantMessage[];
  sessionId: string;
  isProcessing: boolean;
  currentStep: AgenticStepType | null;
  handleSend: (
    content: string,
    model: AssistantModel | null,
    options?: AssistantSendOptions,
  ) => Promise<void>;
  /** Saves the flow, then has the backend run it once and report the result. */
  handleTestFlow: (model: AssistantModel | null) => Promise<void>;
  handleApprove: (messageId: string, componentCode?: string) => Promise<void>;
  /** Writes a proposed prompt into its field and remembers what it replaced. */
  handleApplyPrompt: (messageId: string) => void;
  /** Puts back the text an applied prompt replaced. */
  handleUndoPrompt: (messageId: string) => void;
  /**
   * Mark the component validation gate as acknowledged on the message.
   * Persisted across remounts so panel close/reopen doesn't bring the
   * loading card back after the user already pressed Continue.
   */
  handleAcknowledgeValidation: (messageId: string) => void;
  handleRetry: (
    messageId: string,
    isModelEnabled: (model: AssistantModel) => boolean,
  ) => void;
  handleStopGeneration: () => void;
  handleClearHistory: () => void;
  loadSession: (id: string, msgs: AssistantMessage[]) => void;
}
