/**
 * The prompt a Prompt turn wrote, with Apply, Undo and Copy.
 *
 * The card reads the canvas on every render, so it says why a prompt cannot
 * be applied as soon as that becomes true: the component was removed, the
 * field got a connection, the flow was locked. Copy always works.
 */

import { Check, ChevronDown, ChevronUp, Copy, Undo2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import useFlowStore from "@/stores/flowStore";
import type { PromptProposal } from "../assistant-panel.types";
import {
  GHOST_PRIMARY_BUTTON,
  GHOST_SECONDARY_BUTTON,
} from "../helpers/button-styles";
import {
  getPromptApplyState,
  type PromptApplyState,
} from "../helpers/prompt-proposal";

const COPIED_DISPLAY_MS = 2000;

const REASON_KEYS: Partial<Record<PromptApplyState, string>> = {
  copy_only: "assistant.promptProposal.copyOnly",
  node_missing: "assistant.promptProposal.nodeMissing",
  field_missing: "assistant.promptProposal.fieldMissing",
  field_connected: "assistant.promptProposal.fieldConnected",
  flow_locked: "assistant.promptProposal.flowLocked",
};

interface AssistantPromptProposalProps {
  proposal: PromptProposal;
  /** The component's name as the picker showed it when the turn was sent. */
  targetLabel?: string;
  onApply?: () => void;
  onUndo?: () => void;
}

export function AssistantPromptProposal({
  proposal,
  targetLabel,
  onApply,
  onUndo,
}: AssistantPromptProposalProps) {
  const { t } = useTranslation();
  const [showCurrent, setShowCurrent] = useState(false);
  const [copied, setCopied] = useState(false);
  // A string, so the store only re-renders the card when the state changes.
  const state = useFlowStore((flow) =>
    getPromptApplyState(proposal, {
      nodes: flow.nodes ?? [],
      edges: flow.edges ?? [],
      locked: Boolean(flow.currentFlow?.locked),
    }),
  );

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_DISPLAY_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const handleCopy = async () => {
    // No clipboard API on plain-HTTP origins; the text stays selectable.
    if (!navigator.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(proposal.newValue);
      setCopied(true);
    } catch {
      // Permission denied: nothing to do, the text can still be selected.
    }
  };

  const componentName = targetLabel ?? proposal.componentName;
  const fieldName = proposal.fieldLabel ?? proposal.field;
  const reasonKey = REASON_KEYS[state];

  return (
    <div
      data-testid="assistant-prompt-proposal"
      data-state={state}
      className="max-w-[80%] rounded-md bg-muted/30 px-3 py-3"
    >
      <p className="text-sm font-semibold text-foreground">
        {t("assistant.promptProposal.title")}
      </p>
      {proposal.componentId && componentName && (
        <p className="mt-0.5 text-xs text-muted-foreground">
          {t("assistant.promptProposal.target", {
            component: componentName,
            field: fieldName,
          })}
        </p>
      )}

      <pre className="custom-scroll mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/40 px-3 py-2 font-sans text-sm text-foreground">
        {proposal.newValue}
      </pre>

      {proposal.oldValue && (
        <div className="mt-2">
          <button
            type="button"
            data-testid="assistant-prompt-proposal-old-toggle"
            aria-expanded={showCurrent}
            onClick={() => setShowCurrent((open) => !open)}
            className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            {showCurrent ? (
              <ChevronUp className="h-3 w-3" />
            ) : (
              <ChevronDown className="h-3 w-3" />
            )}
            {showCurrent
              ? t("assistant.promptProposal.hideCurrent")
              : t("assistant.promptProposal.showCurrent")}
          </button>
          {showCurrent && (
            <pre className="custom-scroll mt-1.5 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/40 px-3 py-2 font-sans text-xs text-muted-foreground">
              {proposal.oldValue}
            </pre>
          )}
        </div>
      )}

      {reasonKey && (
        <p
          data-testid="assistant-prompt-proposal-reason"
          className="mt-2 text-xs text-muted-foreground"
        >
          {t(reasonKey)}
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-1">
        {state === "ready" && (
          <button
            type="button"
            data-testid="assistant-prompt-proposal-apply"
            className={GHOST_PRIMARY_BUTTON}
            onClick={onApply}
          >
            <Check className="h-3.5 w-3.5" />
            <span>{t("assistant.promptProposal.apply")}</span>
          </button>
        )}
        {state === "applied" && (
          <>
            <span
              data-testid="assistant-prompt-proposal-applied"
              className="flex h-7 items-center gap-1.5 px-2 text-sm font-medium text-accent-emerald-foreground"
            >
              <Check className="h-3.5 w-3.5" />
              {t("assistant.promptProposal.applied")}
            </span>
            <button
              type="button"
              data-testid="assistant-prompt-proposal-undo"
              className={GHOST_SECONDARY_BUTTON}
              onClick={onUndo}
            >
              <Undo2 className="h-3.5 w-3.5" />
              <span>{t("assistant.promptProposal.undo")}</span>
            </button>
          </>
        )}
        <button
          type="button"
          data-testid="assistant-prompt-proposal-copy"
          className={GHOST_SECONDARY_BUTTON}
          onClick={() => void handleCopy()}
        >
          {copied ? (
            <Check className="h-3.5 w-3.5" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
          <span>
            {copied
              ? t("assistant.promptProposal.copied")
              : t("assistant.promptProposal.copy")}
          </span>
        </button>
      </div>
    </div>
  );
}
