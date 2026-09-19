import { useTranslation } from "react-i18next";
import ForwardedIconComponent from "@/components/common/genericIconComponent";
import ShadTooltip from "@/components/common/shadTooltipComponent";
import { Button } from "@/components/ui/button";
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
