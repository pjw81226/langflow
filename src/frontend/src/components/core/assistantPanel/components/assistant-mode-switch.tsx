import { useRef } from "react";
import { useTranslation } from "react-i18next";
import ShadTooltip from "@/components/common/shadTooltipComponent";
import { cn } from "@/utils/utils";
import { ASSISTANT_MODES } from "../assistant-modes";
import type { AssistantMode } from "../assistant-panel.types";
import { useComponentModeBlockedReason } from "../hooks/use-component-mode-blocked-reason";

interface AssistantModeSwitchProps {
  mode: AssistantMode;
  onChange: (mode: AssistantMode) => void;
  disabled?: boolean;
}

const NEXT_KEYS = ["ArrowRight", "ArrowDown"];
const PREVIOUS_KEYS = ["ArrowLeft", "ArrowUp"];

/**
 * Component | Prompt | Ask. A radio group rather than tabs: there are no tab
 * panels, so tabs would leave dangling aria-controls.
 */
export function AssistantModeSwitch({
  mode,
  onChange,
  disabled = false,
}: AssistantModeSwitchProps) {
  const { t } = useTranslation();
  const componentBlockedReason = useComponentModeBlockedReason();
  const optionRefs = useRef<
    Partial<Record<AssistantMode, HTMLButtonElement | null>>
  >({});

  const blockedReason = (option: AssistantMode): string | null =>
    option === "component" ? componentBlockedReason : null;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const step = NEXT_KEYS.includes(e.key)
      ? 1
      : PREVIOUS_KEYS.includes(e.key)
        ? -1
        : 0;
    if (step === 0 || disabled) return;
    e.preventDefault();
    const available = ASSISTANT_MODES.filter(
      (option) => !blockedReason(option),
    );
    const index = available.indexOf(mode);
    const next =
      available[(index + step + available.length) % available.length];
    if (!next || next === mode) return;
    onChange(next);
    optionRefs.current[next]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={t("assistant.mode.label")}
      data-testid="assistant-mode-switch"
      className="inline-flex items-center rounded-md bg-muted p-0.5"
    >
      {ASSISTANT_MODES.map((option) => {
        const selected = option === mode;
        const reason = blockedReason(option);
        const button = (
          // biome-ignore lint/a11y/useSemanticElements: a segmented control; native radios cannot be styled as one
          <button
            ref={(element) => {
              optionRefs.current[option] = element;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            // Roving tabindex: the group is one tab stop, arrows move inside it.
            tabIndex={selected ? 0 : -1}
            disabled={disabled || reason !== null}
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
        );
        return (
          <ShadTooltip
            key={option}
            content={reason ? t(reason) : t(`assistant.mode.${option}Tooltip`)}
            side="top"
          >
            {/* A disabled button gets no pointer events, so the tooltip that
                says why hangs on a wrapper. */}
            {reason ? (
              <span
                className="inline-flex"
                data-testid={`assistant-mode-${option}-blocked`}
              >
                {button}
              </span>
            ) : (
              button
            )}
          </ShadTooltip>
        );
      })}
    </div>
  );
}
