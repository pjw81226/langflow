import { useTranslation } from "react-i18next";
import ShadTooltip from "@/components/common/shadTooltipComponent";
import { cn } from "@/utils/utils";
import type { AssistantMode } from "../assistant-panel.types";

interface AssistantModeSwitchProps {
  mode: AssistantMode;
  onChange: (mode: AssistantMode) => void;
  disabled?: boolean;
}

const MODES: AssistantMode[] = ["build", "ask"];

/**
 * Build | Ask. A radio group rather than tabs: there are no tab panels, so
 * tabs would leave dangling aria-controls.
 */
export function AssistantModeSwitch({
  mode,
  onChange,
  disabled = false,
}: AssistantModeSwitchProps) {
  const { t } = useTranslation();

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (
      !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key) ||
      disabled
    )
      return;
    e.preventDefault();
    onChange(mode === "build" ? "ask" : "build");
  };

  return (
    <div
      role="radiogroup"
      aria-label={t("assistant.mode.label")}
      data-testid="assistant-mode-switch"
      className="inline-flex items-center rounded-md bg-muted p-0.5"
    >
      {MODES.map((option) => {
        const selected = option === mode;
        return (
          <ShadTooltip
            key={option}
            content={t(`assistant.mode.${option}Tooltip`)}
            side="top"
          >
            {/* biome-ignore lint/a11y/useSemanticElements: a segmented control; native radios cannot be styled as one */}
            <button
              type="button"
              role="radio"
              aria-checked={selected}
              // Roving tabindex: the group is one tab stop, arrows move inside it.
              tabIndex={selected ? 0 : -1}
              disabled={disabled}
              data-testid={`assistant-mode-${option}`}
              onClick={(e) => {
                // The composer focuses the textarea on click; keep that from
                // stealing the press.
                e.stopPropagation();
                if (!selected) onChange(option);
              }}
              onKeyDown={handleKeyDown}
              className={cn(
                "rounded px-2.5 py-0.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                selected
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t(`assistant.mode.${option}`)}
            </button>
          </ShadTooltip>
        );
      })}
    </div>
  );
}
