/**
 * What to offer after a finished turn.
 *
 * A turn usually has one obvious follow-up: a written component has to reach
 * an agent as a tool, an applied prompt is worth a test run, a failed test
 * needs a reason. Users who don't know the product can't name those steps
 * themselves, so the panel names them and fills the composer with the
 * sentence, leaving the send to the user.
 *
 * The steps are derived from the finished message alone, so they cost no
 * tokens and stay the same for the same outcome.
 */

import type { AssistantMessage, AssistantMode } from "../assistant-panel.types";

/** The part of i18next's ``t`` these steps use: a label and its variables. */
type Translate = (key: string, vars?: Record<string, string>) => string;

export type NextStepAction =
  /** Switch to ``mode`` and put ``text`` in the composer, unsent. */
  | { type: "prefill"; mode: AssistantMode; text: string }
  | { type: "test_flow" };

export interface NextStep {
  id: string;
  label: string;
  action: NextStepAction;
}

/** Suggestions for a finished assistant turn; empty when nothing fits. */
export function getNextSteps(
  message: AssistantMessage,
  t: Translate,
): NextStep[] {
  if (message.role !== "assistant" || message.status !== "complete") return [];

  const testFlowStep: NextStep = {
    id: "test-flow",
    label: t("assistant.test.action"),
    action: { type: "test_flow" },
  };

  if (message.action === "test_flow") {
    const status = message.testResult?.status;
    if (status === "failed") {
      const component = message.testResult?.error?.component_name;
      return [
        {
          id: "why-failed",
          label: t("assistant.nextSteps.whyFailed"),
          action: {
            type: "prefill",
            mode: "ask",
            text: component
              ? t("assistant.nextSteps.whyFailedText", { component })
              : t("assistant.nextSteps.whyFailedTextGeneric"),
          },
        },
      ];
    }
    if (status === "needs_attention") {
      return [
        {
          id: "what-to-fill",
          label: t("assistant.nextSteps.whatToFill"),
          action: {
            type: "prefill",
            mode: "ask",
            text: t("assistant.nextSteps.whatToFillText"),
          },
        },
      ];
    }
    return [];
  }

  if (message.mode === "component" && message.result?.validated) {
    const component = message.result.className;
    return [
      {
        id: "connect-as-tool",
        label: t("assistant.nextSteps.connectAsTool"),
        action: {
          type: "prefill",
          mode: "ask",
          text: component
            ? t("assistant.nextSteps.connectAsToolText", { component })
            : t("assistant.nextSteps.connectAsToolTextGeneric"),
        },
      },
    ];
  }

  if (message.mode === "prompt" && message.promptProposal) {
    // No component to write into: the prompt can only be copied, so the open
    // question is where it goes.
    if (!message.promptProposal.componentId) {
      return [
        {
          id: "where-to-paste",
          label: t("assistant.nextSteps.whereToPaste"),
          action: {
            type: "prefill",
            mode: "ask",
            text: t("assistant.nextSteps.whereToPasteText"),
          },
        },
      ];
    }
    const shorter: NextStep = {
      id: "shorter",
      label: t("assistant.nextSteps.shorter"),
      action: {
        type: "prefill",
        mode: "prompt",
        text: t("assistant.nextSteps.shorterText"),
      },
    };
    // Testing only makes sense once the prompt is in the field.
    const applied = message.promptProposal.replacedValue !== undefined;
    return applied ? [shorter, testFlowStep] : [shorter];
  }

  return [];
}
