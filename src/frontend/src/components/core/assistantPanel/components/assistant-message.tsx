import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import langflowAssistantIcon from "@/assets/langflow_assistant.svg";
import MessageMetadata from "@/components/common/messageMetadataComponent";
import { CustomProfileIcon } from "@/customization/components/custom-profile-icon";
import { cn } from "@/utils/utils";
import type { AssistantMessage } from "../assistant-panel.types";
import { getRandomThinkingMessage } from "../helpers/messages";
import { AssistantMessageBody } from "./assistant-message-body";
import { AssistantModelNotice } from "./assistant-model-notice";
import { AssistantTestResult } from "./assistant-test-result";

interface AssistantMessageItemProps {
  message: AssistantMessage;
  onApprove?: (messageId: string) => void;
  onApplyPrompt?: (messageId: string) => void;
  onUndoPrompt?: (messageId: string) => void;
  onRetry?: (messageId: string) => void;
  /**
   * Persists the user's acknowledgement of the validation gate (Continue
   * click or 30s auto-dismiss) onto the message itself so panel
   * close/reopen doesn't bring the gate back.
   */
  onAcknowledgeValidation?: (messageId: string) => void;
  /**
   * Actions of the test result card. Only the latest result gets them: a
   * "Test again" on an old card would read as testing that old state.
   */
  onTestFlow?: () => void;
  onOpenPlayground?: () => void;
}

// Steps where AssistantLoadingState replaces the simple thinking dots.
const RICH_LOADING_STEPS = [
  "generating_component",
  "extracting_code",
  "validating",
  "validation_failed",
  "retrying",
  "validated",
  "verifying_flow",
];

function ThinkingIndicator({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-3 text-sm text-muted-foreground">
      <span className="flex gap-1">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground" />
        <span
          className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground"
          style={{ animationDelay: "150ms" }}
        />
        <span
          className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground"
          style={{ animationDelay: "300ms" }}
        />
      </span>
      <span>{message}</span>
    </div>
  );
}

export function AssistantMessageItem({
  message,
  onApprove,
  onApplyPrompt,
  onUndoPrompt,
  onRetry,
  onAcknowledgeValidation,
  onTestFlow,
  onOpenPlayground,
}: AssistantMessageItemProps) {
  const { t } = useTranslation();
  const isUser = message.role === "user";
  const isStreaming = message.status === "streaming";

  // Randomized once per message.
  const randomThinking = useMemo(() => getRandomThinkingMessage(), []);
  // Writing a prompt has a label of its own, matching the input placeholder.
  const thinkingMessage =
    message.progress?.step === "writing_prompt"
      ? t("assistant.generating.prompt")
      : randomThinking;

  // Component code streaming in before the first progress event. Only a
  // component turn writes one; an answer may quote code as an example.
  // Memoized: the regex would otherwise run on every token.
  const contentLooksLikeComponentCode = useMemo(
    () =>
      isStreaming &&
      message.mode === "component" &&
      !!message.content &&
      /```python[\s\S]*class\s+\w+.*Component/.test(message.content),
    [isStreaming, message.mode, message.content],
  );

  // True when the rich loading state (component generation or a test run)
  // should render instead of the simple thinking indicator.
  const showsRichLoadingState = Boolean(
    (message.progress && RICH_LOADING_STEPS.includes(message.progress.step)) ||
      contentLooksLikeComponentCode,
  );

  const isGeneratingCode = isStreaming && showsRichLoadingState;

  // Simple thinking: streaming with no content and no rich state yet.
  const isSimpleThinking = isStreaming && !isGeneratingCode && !message.content;

  if (isSimpleThinking && !isUser) {
    return (
      <div className="mb-6 mt-4">
        <ThinkingIndicator message={thinkingMessage} />
      </div>
    );
  }

  return (
    <div
      className="mb-6"
      data-testid={
        isUser ? "assistant-message-user" : "assistant-message-assistant"
      }
    >
      <div className="flex items-start gap-3">
        {isUser ? (
          <CustomProfileIcon className="h-7 w-7 shrink-0 rounded-full" />
        ) : (
          <div className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-lg">
            <img
              src={langflowAssistantIcon}
              alt={t("assistant.title")}
              className="h-full w-full object-cover"
            />
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "text-[13px] font-semibold leading-4",
                isUser ? "text-foreground" : "text-accent-pink-foreground",
              )}
            >
              {isUser ? t("assistant.user") : t("assistant.title")}
            </span>
            {isUser && message.mode && (
              <span
                data-testid="assistant-message-mode-chip"
                data-mode={message.mode}
                className="rounded-full border border-border px-1.5 text-[10px] font-medium leading-4 text-muted-foreground"
              >
                {t(`assistant.mode.${message.mode}`)}
              </span>
            )}
            {!isUser && message.status === "complete" && (
              <MessageMetadata
                usage={message.usage}
                duration={message.duration}
                subtle
              />
            )}
            {!isUser &&
              message.status === "complete" &&
              message.notices &&
              message.notices.length > 0 && (
                <AssistantModelNotice notices={message.notices} />
              )}
          </div>
          <div className="mt-3 overflow-hidden">
            <AssistantMessageBody
              message={message}
              isGeneratingCode={isGeneratingCode}
              onApprove={onApprove}
              onApplyPrompt={onApplyPrompt}
              onUndoPrompt={onUndoPrompt}
              onRetry={onRetry}
              onAcknowledgeValidation={onAcknowledgeValidation}
            />
          </div>
          {!isUser && message.status === "complete" && message.testResult && (
            <AssistantTestResult
              result={message.testResult}
              onTestAgain={onTestFlow}
              onOpenPlayground={onOpenPlayground}
            />
          )}
        </div>
      </div>
    </div>
  );
}
