import { useTranslation } from "react-i18next";
import { GHOST_SECONDARY_BUTTON } from "../helpers/button-styles";
import type { NextStep } from "../helpers/next-steps";

interface AssistantNextStepsProps {
  steps: NextStep[];
  onSelect: (step: NextStep) => void;
}

/**
 * The follow-up row under the last finished turn: one or two things the user
 * is likely to do next. A step never runs on its own beyond opening the
 * matching tab; question steps land in the composer so the user can edit the
 * sentence before sending it.
 */
export function AssistantNextSteps({
  steps,
  onSelect,
}: AssistantNextStepsProps) {
  const { t } = useTranslation();

  if (steps.length === 0) return null;

  return (
    <div
      data-testid="assistant-next-steps"
      className="mt-3 flex flex-wrap items-center gap-1.5"
    >
      <span className="text-sm text-muted-foreground">
        {t("assistant.nextSteps.label")}
      </span>
      {steps.map((step) => (
        <button
          key={step.id}
          type="button"
          data-testid={`assistant-next-step-${step.id}`}
          className={GHOST_SECONDARY_BUTTON}
          onClick={() => onSelect(step)}
        >
          {step.label}
        </button>
      ))}
    </div>
  );
}
