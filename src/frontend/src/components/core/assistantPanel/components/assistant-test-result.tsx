/**
 * Result card for a flow's test run.
 *
 * "Test flow" has the backend run the canvas flow once. This card says what
 * happened in the UI language: passed, failed (and where), needs something
 * only the user can supply, or not tested yet.
 *
 * The headline and the explanation come from translation keys chosen by the
 * result's status and error kind. The server's own message is English and
 * technical, so it sits under "Details".
 */

import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleDashed,
  Play,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { AgenticTestResult } from "@/controllers/API/queries/agentic";
import { cn } from "@/utils/utils";
import {
  GHOST_PRIMARY_BUTTON,
  GHOST_SECONDARY_BUTTON,
} from "../helpers/button-styles";

interface AssistantTestResultProps {
  result: AgenticTestResult;
  /** Re-run the test. Omitted while it cannot run (a turn is in progress). */
  onTestAgain?: () => void;
  /** Open the Playground beside the canvas. Omitted when the flow has no chat I/O. */
  onOpenPlayground?: () => void;
}

const KNOWN_KINDS = new Set([
  "fixable",
  "external_resource",
  "timeout",
  "unknown",
]);
const KNOWN_SKIP_REASONS = new Set(["edit_not_verified"]);

const STATUS_STYLE: Record<
  AgenticTestResult["status"],
  { icon: typeof CheckCircle2; tone: string; border: string }
> = {
  passed: {
    icon: CheckCircle2,
    tone: "text-accent-emerald-foreground",
    border: "border-accent-emerald-foreground/30",
  },
  failed: {
    icon: XCircle,
    tone: "text-destructive",
    border: "border-destructive/30",
  },
  needs_attention: {
    icon: AlertTriangle,
    tone: "text-accent-amber-foreground",
    border: "border-accent-amber-foreground/30",
  },
  skipped: {
    icon: CircleDashed,
    tone: "text-muted-foreground",
    border: "border-border",
  },
};

export function AssistantTestResult({
  result,
  onTestAgain,
  onOpenPlayground,
}: AssistantTestResultProps) {
  const { t } = useTranslation();
  const [showDetails, setShowDetails] = useState(false);

  const style = STATUS_STYLE[result.status] ?? STATUS_STYLE.skipped;
  const StatusIcon = style.icon;
  const error = result.error;

  const headline =
    result.status === "passed"
      ? t("assistant.test.passed")
      : result.status === "failed"
        ? t("assistant.test.failed")
        : result.status === "needs_attention"
          ? t("assistant.test.needsAttention")
          : t("assistant.test.notTested");

  const explanation =
    result.status === "skipped"
      ? t(
          `assistant.test.skipped.${
            KNOWN_SKIP_REASONS.has(result.skipped_reason ?? "")
              ? result.skipped_reason
              : "default"
          }`,
        )
      : result.status === "passed"
        ? undefined
        : t(
            `assistant.test.kind.${
              KNOWN_KINDS.has(error?.kind ?? "") ? error?.kind : "unknown"
            }`,
          );

  const hasDetails = Boolean(
    error?.message ||
      error?.recommendation ||
      result.probe_input ||
      result.output_preview,
  );
  const isSkipped = result.status === "skipped";

  return (
    <div
      data-testid="assistant-test-result"
      data-status={result.status}
      className={cn(
        "mt-2 max-w-[80%] rounded-lg border bg-muted/20 px-3 py-2",
        style.border,
      )}
    >
      <div className="flex items-center gap-2">
        <StatusIcon className={cn("h-4 w-4 shrink-0", style.tone)} />
        <span className={cn("text-sm font-medium", style.tone)}>
          {headline}
        </span>
        {typeof result.duration_seconds === "number" && (
          <span className="text-xs text-muted-foreground">
            {t("assistant.test.duration", {
              seconds: result.duration_seconds.toFixed(1),
            })}
          </span>
        )}
      </div>

      {error?.component_name && (
        <p
          data-testid="assistant-test-result-component"
          className="mt-1 text-xs font-medium text-foreground"
        >
          {t("assistant.test.failedAt", { component: error.component_name })}
        </p>
      )}

      {explanation && (
        <p className="mt-1 text-xs text-muted-foreground">{explanation}</p>
      )}

      {hasDetails && (
        <div className="mt-1.5">
          <button
            type="button"
            data-testid="assistant-test-result-details-toggle"
            aria-expanded={showDetails}
            onClick={() => setShowDetails((open) => !open)}
            className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            {showDetails ? (
              <ChevronUp className="h-3 w-3" />
            ) : (
              <ChevronDown className="h-3 w-3" />
            )}
            {t("assistant.test.details")}
          </button>
          {showDetails && (
            <div
              data-testid="assistant-test-result-details"
              className="mt-1.5 space-y-1.5 rounded-md bg-muted/50 p-2 text-xs"
            >
              {error?.message && (
                <p className="whitespace-pre-wrap break-words font-mono text-destructive">
                  {error.message}
                </p>
              )}
              {error?.recommendation && (
                <p className="text-muted-foreground">{error.recommendation}</p>
              )}
              {result.probe_input && (
                <div>
                  <p className="font-medium text-foreground">
                    {t("assistant.test.input")}
                  </p>
                  <p className="whitespace-pre-wrap break-words text-muted-foreground">
                    {result.probe_input}
                  </p>
                </div>
              )}
              {result.output_preview && (
                <div>
                  <p className="font-medium text-foreground">
                    {t("assistant.test.output")}
                  </p>
                  <p className="whitespace-pre-wrap break-words text-muted-foreground">
                    {result.output_preview}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-1">
        <button
          type="button"
          data-testid="assistant-test-again-button"
          className={cn(
            isSkipped ? GHOST_PRIMARY_BUTTON : GHOST_SECONDARY_BUTTON,
            "disabled:pointer-events-none disabled:opacity-40",
          )}
          onClick={onTestAgain}
          disabled={!onTestAgain}
        >
          <Play className="h-3.5 w-3.5" />
          <span>
            {isSkipped
              ? t("assistant.test.action")
              : t("assistant.test.testAgain")}
          </span>
        </button>
        {onOpenPlayground && (
          <button
            type="button"
            data-testid="assistant-test-playground-button"
            className={GHOST_SECONDARY_BUTTON}
            onClick={onOpenPlayground}
          >
            <span>{t("assistant.test.openPlayground")}</span>
          </button>
        )}
      </div>
    </div>
  );
}
