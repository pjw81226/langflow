import { useState } from "react";
import { useTranslation } from "react-i18next";
import ForwardedIconComponent from "@/components/common/genericIconComponent";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { type PromptTarget, promptTargetKey } from "../helpers/prompt-targets";

export interface PromptTargetChoice {
  targets: PromptTarget[];
  selected: PromptTarget | null;
  onSelect: (target: PromptTarget) => void;
}

interface AssistantPromptTargetPickerProps extends PromptTargetChoice {
  disabled?: boolean;
}

/** "Apply to:" — the agent or model a Prompt turn writes instructions for. */
export function AssistantPromptTargetPicker({
  targets,
  selected,
  onSelect,
  disabled = false,
}: AssistantPromptTargetPickerProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div
      data-testid="assistant-prompt-target"
      className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground"
    >
      <span className="shrink-0">{t("assistant.promptTarget.label")}</span>
      {targets.length === 0 ? (
        <span
          data-testid="assistant-prompt-target-empty"
          className="min-w-0 px-2"
        >
          {t("assistant.promptTarget.none")}
        </span>
      ) : (
        <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              data-testid="assistant-prompt-target-trigger"
              aria-label={t("assistant.promptTarget.ariaLabel")}
              disabled={disabled}
              // The composer focuses the textarea on any click inside it.
              onClick={(e) => e.stopPropagation()}
              className="h-6 min-w-0 gap-1 px-2 text-xs text-foreground active:!scale-100"
            >
              <span className="truncate">{selected?.label}</span>
              <ForwardedIconComponent
                name={isOpen ? "ChevronUp" : "ChevronDown"}
                className="h-3 w-3 shrink-0"
              />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="z-[70] max-h-72 w-64 overflow-y-auto"
          >
            <DropdownMenuRadioGroup
              value={selected ? promptTargetKey(selected) : undefined}
              onValueChange={(key) => {
                const target = targets.find(
                  (candidate) => promptTargetKey(candidate) === key,
                );
                if (target) onSelect(target);
              }}
            >
              {targets.map((target) => (
                <DropdownMenuRadioItem
                  key={promptTargetKey(target)}
                  value={promptTargetKey(target)}
                  data-testid={`assistant-prompt-target-option-${target.componentId}`}
                  className="cursor-pointer gap-1.5 text-[13px]"
                >
                  <span className="truncate">{target.label}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {target.fieldLabel}
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
