/**
 * Body of an assistant chat message — the part that switches between the
 * loading state, the error, the component result, the proposed prompt and
 * the plain markdown response. Owns the validation-gate acknowledgement state
 * (Continue click / 30s timeout) so the parent `AssistantMessageItem` stays
 * focused on avatar + header layout.
 */

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import SimplifiedCodeTabComponent from "@/components/core/codeTabsComponent";
import { extractLanguage, isCodeBlock } from "@/utils/codeBlockUtils";
import type { AssistantMessage } from "../assistant-panel.types";
import { ChatMarkdown } from "../helpers/chat-markdown";
import { AssistantComponentResult } from "./assistant-component-result";
import { AssistantErrorDetails } from "./assistant-error-details";
import { AssistantLoadingState } from "./assistant-loading-state";
import { AssistantPromptProposal } from "./assistant-prompt-proposal";
import { AssistantValidationFailed } from "./assistant-validation-failed";

// Auto-dismiss the validation gate after this long in a terminal state, so the
// loading card never gets stuck if the user walks away without clicking Continue.
const VALIDATION_GATE_AUTO_DISMISS_MS = 30000;

export interface AssistantMessageBodyProps {
  message: AssistantMessage;
  /** True when streaming AND in a rich loading step (component generation). */
  isGeneratingCode: boolean;
  onApprove?: (messageId: string) => void;
  onApplyPrompt?: (messageId: string) => void;
  onUndoPrompt?: (messageId: string) => void;
  onRetry?: (messageId: string) => void;
  /** Persist the validation-gate acknowledgement onto the message itself. */
  onAcknowledgeValidation?: (messageId: string) => void;
}

export function AssistantMessageBody({
  message,
  isGeneratingCode,
  onApprove,
  onApplyPrompt,
  onUndoPrompt,
  onRetry,
  onAcknowledgeValidation,
}: AssistantMessageBodyProps) {
  const { t } = useTranslation();
  const isStreaming = message.status === "streaming";
  const hasValidatedResult =
    message.result?.validated && message.result?.componentCode;
  const hasValidationError =
    message.result?.validated === false && message.result?.validationError;

  // validationAcknowledged is the persisted twin so the gate doesn't reappear
  // on remount (panel close+reopen).
  const [validationAnimationComplete, setValidationAnimationComplete] =
    useState(() => Boolean(message.validationAcknowledged));

  // Persist the acknowledgement onto the message itself. Fires once when
  // the local state transitions to true (Continue click OR 30s timeout).
  useEffect(() => {
    if (validationAnimationComplete && !message.validationAcknowledged) {
      onAcknowledgeValidation?.(message.id);
    }
  }, [
    validationAnimationComplete,
    message.id,
    message.validationAcknowledged,
    onAcknowledgeValidation,
  ]);

  // Timeout fallback: if message is complete but user hasn't clicked
  // Continue, force-dismiss after ${VALIDATION_GATE_AUTO_DISMISS_MS}ms.
  useEffect(() => {
    if (
      message.status === "complete" &&
      (hasValidatedResult || hasValidationError) &&
      !validationAnimationComplete
    ) {
      const timer = setTimeout(() => {
        setValidationAnimationComplete(true);
      }, VALIDATION_GATE_AUTO_DISMISS_MS);
      return () => clearTimeout(timer);
    }
  }, [
    message.status,
    hasValidatedResult,
    hasValidationError,
    validationAnimationComplete,
  ]);

  // Detailed loading state during component generation, until the validation
  // animation completes.
  const showLoadingState =
    (isGeneratingCode && message.progress) ||
    ((hasValidatedResult || hasValidationError) &&
      !validationAnimationComplete &&
      message.progress);

  if (showLoadingState && message.progress) {
    return (
      <AssistantLoadingState
        key={message.id}
        progress={message.progress}
        streamingContent={message.content}
        onValidationComplete={() => setValidationAnimationComplete(true)}
      />
    );
  }

  if (message.status === "error" && message.error) {
    return (
      <div className="flex flex-col gap-1">
        <p className="text-sm font-normal text-destructive">{message.error}</p>
        {message.errorDetail && (
          <AssistantErrorDetails detail={message.errorDetail} />
        )}
      </div>
    );
  }

  if (message.status === "cancelled") {
    return (
      <span className="text-sm text-muted-foreground/60 italic">
        {t("assistant.cancelled")}
      </span>
    );
  }

  // Show validation failure after all retries (only after the animation
  // completes, or if no progress event ever arrived).
  const canShowResult = validationAnimationComplete || !message.progress;
  if (hasValidationError && message.result && canShowResult) {
    return (
      <AssistantValidationFailed
        result={message.result}
        onRetry={onRetry ? () => onRetry(message.id) : undefined}
      />
    );
  }

  // Successful component result (only after validation animation completes,
  // or if no animation was needed in the first place).
  if (hasValidatedResult && message.result && canShowResult) {
    return (
      <AssistantComponentResult
        result={message.result}
        onApprove={() => onApprove?.(message.id)}
      />
    );
  }

  if (message.promptProposal) {
    return (
      <div className="flex flex-col gap-3">
        {message.content && <ChatMarkdown>{message.content}</ChatMarkdown>}
        <AssistantPromptProposal
          proposal={message.promptProposal}
          targetLabel={message.promptTarget?.label}
          onApply={() => onApplyPrompt?.(message.id)}
          onUndo={() => onUndoPrompt?.(message.id)}
        />
      </div>
    );
  }

  // Default text content with rich markdown support (anchor + code blocks).
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      className="prose prose-sm max-w-full text-muted-foreground dark:prose-invert prose-p:leading-relaxed prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5"
      components={{
        a: ({ node, ...props }) => (
          <a
            {...props}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline"
          >
            {props.children}
          </a>
        ),
        p({ node, ...props }) {
          return <p className="my-1">{props.children}</p>;
        },
        pre({ node, ...props }) {
          return <>{props.children}</>;
        },
        code: ({ node, className, children, ...props }) => {
          const content = String(children);
          if (isCodeBlock(className, props, content)) {
            return (
              <SimplifiedCodeTabComponent
                language={extractLanguage(className)}
                code={content.replace(/\n$/, "")}
                maxHeight={isStreaming ? "200px" : undefined}
              />
            );
          }
          return (
            <code className="rounded bg-muted px-1 py-0.5 text-sm" {...props}>
              {children}
            </code>
          );
        },
      }}
    >
      {message.content}
    </Markdown>
  );
}
