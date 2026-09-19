import { useTranslation } from "react-i18next";
import { cn } from "@/utils/utils";
import type { AssistantMode } from "../assistant-panel.types";

interface AssistantStarterPromptsProps {
  mode: AssistantMode;
  /** "expanded" adds the title and centers the block in the empty panel. */
  variant: "compact" | "expanded";
  disabled?: boolean;
  /** The chosen example, translated. It fills the composer; it is not sent. */
  onSelect: (text: string) => void;
}

const STARTER_INDEXES = [0, 1, 2] as const;

/**
 * Example prompts for an empty panel.
 *
 * Someone who has never used the assistant does not know what it can be asked.
 * The composer's placeholder would tell them, but it disappears as soon as the
 * textarea is focused, which is on open. These stay visible until the first
 * message, and differ per mode: a component to create, how an agent should
 * answer, or a question.
 *
 * Picking one fills the composer instead of sending it: an example is a
 * starting point to edit, not a request to run as is.
 */
export function AssistantStarterPrompts({
  mode,
  variant,
  disabled = false,
  onSelect,
}: AssistantStarterPromptsProps) {
  const { t } = useTranslation();

  return (
    <div
      data-testid="assistant-starter-prompts"
      className={cn(
        "flex flex-col gap-1 px-4 pb-2",
        variant === "expanded" && "flex-1 justify-end pb-3",
      )}
    >
      {variant === "expanded" && (
        <p className="mb-1 text-sm font-medium text-foreground">
          {t(`assistant.starter.${mode}.title`)}
        </p>
      )}
      <ul aria-label={t("assistant.starter.listLabel")} className="contents">
        {STARTER_INDEXES.map((index) => {
          const text = t(`assistant.starter.${mode}.${index}`);
          return (
            <li key={index} className="contents">
              <button
                type="button"
                data-testid={`assistant-starter-${mode}-${index}`}
                disabled={disabled}
                onClick={() => onSelect(text)}
                className="h-8 w-full truncate rounded-md border border-border px-3 text-left text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
              >
                {text}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
