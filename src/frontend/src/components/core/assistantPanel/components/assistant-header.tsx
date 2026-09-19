import { useTranslation } from "react-i18next";
import ForwardedIconComponent from "@/components/common/genericIconComponent";
import ShadTooltip from "@/components/common/shadTooltipComponent";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ASSISTANT_MAX_SESSIONS } from "../assistant-panel.constants";
import type { SessionHistoryEntry } from "../assistant-panel.types";
import { SessionHistoryDropdown } from "./session-history-dropdown";

interface AssistantHeaderProps {
  onClose: () => void;
  onNewSession: () => void;
  hasMessages: boolean;
  sessions: SessionHistoryEntry[];
  activeSessionId: string;
  onSelectSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  isExpanded: boolean;
  /** Mirrors the hook's skipAll preference. Renders an inline badge cue. */
  skipAll?: boolean;
  /** When provided, the header shows a menu with the auto-apply toggle. */
  onToggleSkipAll?: () => void;
  /** A turn is running: the toggle is locked so it cannot flip mid-turn. */
  isProcessing?: boolean;
  /** The panel is docked beside the canvas instead of floating over it. */
  isDocked?: boolean;
  /** False on narrow viewports, where the dock toggle is not offered. */
  canDock?: boolean;
  onToggleDock?: () => void;
}

export function AssistantHeader({
  onClose,
  onNewSession,
  hasMessages,
  sessions,
  activeSessionId,
  onSelectSession,
  onDeleteSession,
  isExpanded,
  skipAll = false,
  onToggleSkipAll,
  isProcessing = false,
  isDocked = false,
  canDock = false,
  onToggleDock,
}: AssistantHeaderProps) {
  const { t } = useTranslation();
  const isAtSessionLimit = sessions.length >= ASSISTANT_MAX_SESSIONS;
  const isNewSessionDisabled = !hasMessages || isAtSessionLimit;

  return (
    <div className="flex h-12 items-center justify-between px-4">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-medium text-foreground">
          {t("assistant.title")}
        </h2>
        {skipAll && (
          <span
            data-testid="assistant-skip-all-badge"
            className="flex h-5 items-center gap-1 rounded-full border border-muted-foreground/30 bg-muted-foreground/10 px-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
            title={t("assistant.autoApply.badgeTooltip")}
          >
            <ForwardedIconComponent name="Zap" className="h-2.5 w-2.5" />
            {t("assistant.autoApply.badge")}
          </span>
        )}
      </div>
      <div className="flex items-center">
        <ShadTooltip
          content={
            isAtSessionLimit
              ? t("assistant.maxSessionsTooltip", {
                  max: ASSISTANT_MAX_SESSIONS,
                })
              : ""
          }
          side="bottom"
          avoidCollisions={false}
        >
          <span className="inline-flex">
            <Button
              variant="ghost"
              size="sm"
              data-testid="assistant-new-session"
              className="h-8 gap-1.5 px-2 text-sm text-muted-foreground hover:text-foreground"
              onClick={onNewSession}
              disabled={isNewSessionDisabled}
            >
              <ForwardedIconComponent
                name={isAtSessionLimit ? "AlertCircle" : "Plus"}
                className="h-4 w-4"
              />
              {isAtSessionLimit
                ? t("assistant.maxSessionsLabel")
                : t("assistant.newSession")}
            </Button>
          </span>
        </ShadTooltip>

        <SessionHistoryDropdown
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSelectSession={onSelectSession}
          onDeleteSession={onDeleteSession}
          isExpanded={isExpanded}
        />

        {onToggleSkipAll && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                data-testid="assistant-menu"
                aria-label={t("assistant.menu.more")}
                className="h-8 w-8 px-0 text-muted-foreground hover:text-foreground"
              >
                <ForwardedIconComponent name="Ellipsis" className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              side="bottom"
              sideOffset={4}
              className="z-[70] w-72"
            >
              <DropdownMenuCheckboxItem
                data-testid="assistant-auto-apply-toggle"
                checked={skipAll}
                disabled={isProcessing}
                onCheckedChange={() => onToggleSkipAll()}
                // Keep the menu open so the new state is visible.
                onSelect={(e) => e.preventDefault()}
                className="items-start"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm">
                    {t("assistant.autoApply.label")}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t("assistant.autoApply.description")}
                  </span>
                </div>
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {canDock && onToggleDock && (
          <ShadTooltip
            content={
              isDocked ? t("assistant.dock.undock") : t("assistant.dock.dock")
            }
            side="bottom"
          >
            <Button
              variant="ghost"
              size="sm"
              data-testid="assistant-dock-toggle"
              aria-label={
                isDocked ? t("assistant.dock.undock") : t("assistant.dock.dock")
              }
              aria-pressed={isDocked}
              className="h-8 w-8 px-0 text-muted-foreground hover:text-foreground"
              onClick={onToggleDock}
            >
              <ForwardedIconComponent
                name={isDocked ? "PictureInPicture2" : "PanelRight"}
                className="h-4 w-4"
              />
            </Button>
          </ShadTooltip>
        )}

        {/* A floating panel closes on an outside click. A docked one does not,
            so it needs a button of its own. */}
        {isDocked && (
          <ShadTooltip content={t("assistant.close")} side="bottom">
            <Button
              variant="ghost"
              size="sm"
              data-testid="assistant-close"
              aria-label={t("assistant.close")}
              className="h-8 w-8 px-0 text-muted-foreground hover:text-foreground"
              onClick={onClose}
            >
              <ForwardedIconComponent name="X" className="h-4 w-4" />
            </Button>
          </ShadTooltip>
        )}
      </div>
    </div>
  );
}
