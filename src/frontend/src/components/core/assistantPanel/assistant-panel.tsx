import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";
import { useSidebar } from "@/components/ui/sidebar";
import { useIsFlowReadOnly } from "@/contexts/permissionsContext";
import type { AgenticStepType } from "@/controllers/API/queries/agentic";
import useFlowStore from "@/stores/flowStore";
import { usePlaygroundStore } from "@/stores/playgroundStore";
import { useUtilityStore } from "@/stores/utilityStore";
import { cn } from "@/utils/utils";
import type {
  AssistantMode,
  AssistantModel,
  AssistantPanelProps,
} from "./assistant-panel.types";
import { AssistantDisabledState } from "./components/assistant-disabled-state";
import { AssistantHeader } from "./components/assistant-header";
import { AssistantInput } from "./components/assistant-input";
import { AssistantMessageItem } from "./components/assistant-message";
import { AssistantNoModelsState } from "./components/assistant-no-models-state";
import type { PromptTargetChoice } from "./components/assistant-prompt-target-picker";
import { AssistantStarterPrompts } from "./components/assistant-starter-prompts";
import { useAssistantChat, useEnabledModels, useSessionHistory } from "./hooks";
// Direct paths: tests mock the ./hooks barrel wholesale.
import { purgeLegacyAssistantStorage } from "./hooks/legacy-storage";
import { useAssistantDock } from "./hooks/use-assistant-dock";
import { useAssistantMode } from "./hooks/use-assistant-mode";
import { usePromptTarget } from "./hooks/use-prompt-target";

// Module-level draft cache — survives panel unmount/remount
let draftMessageCache = "";

const PANEL_SIZE_KEY = "langflow-assistant-panel-size";
const MENTION_PANEL_HEIGHT = "26rem";
const DEFAULT_SIZE = { width: 620, height: 600 };
const MIN_SIZE = { width: 456, height: 400 };
const MAX_SIZE = { width: 900, height: 800 };

function getStoredSize(): { width: number; height: number } {
  try {
    const stored = localStorage.getItem(PANEL_SIZE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed.width && parsed.height) return parsed;
    }
  } catch {
    // ignore
  }
  return DEFAULT_SIZE;
}

interface AssistantInputWithScrollProps {
  onSend: (content: string, model: AssistantModel | null) => void;
  onStop: () => void;
  disabled: boolean;
  isProcessing: boolean;
  currentStep: AgenticStepType | null;
  autoFocus?: boolean;
  draftMessage?: string;
  onDraftChange?: (draft: string) => void;
  mode: AssistantMode;
  onModeChange: (mode: AssistantMode) => void;
  onTestFlow: (model: AssistantModel | null) => void;
  promptTargetPicker?: PromptTargetChoice;
}

function AssistantInputWithScroll({
  onSend,
  onStop,
  disabled,
  isProcessing,
  currentStep,
  autoFocus,
  draftMessage,
  onDraftChange,
  mode,
  onModeChange,
  onTestFlow,
  promptTargetPicker,
}: AssistantInputWithScrollProps) {
  const { scrollToBottom } = useStickToBottomContext();

  const handleSend = (content: string, model: AssistantModel | null) => {
    scrollToBottom({ animation: "smooth", duration: 300 });
    onSend(content, model);
  };

  return (
    <AssistantInput
      onSend={handleSend}
      onStop={onStop}
      disabled={disabled}
      isProcessing={isProcessing}
      currentStep={currentStep}
      autoFocus={autoFocus}
      draftMessage={draftMessage}
      onDraftChange={onDraftChange}
      mode={mode}
      onModeChange={onModeChange}
      onTestFlow={onTestFlow}
      promptTargetPicker={promptTargetPicker}
      compact
    />
  );
}

export function AssistantPanel({ isOpen, onClose }: AssistantPanelProps) {
  const { hasEnabledModels, isCatalogReady, isModelEnabled } =
    useEnabledModels();
  const agenticExperienceEnabled = useUtilityStore(
    (state) => state.agenticExperienceEnabled,
  );
  const panelRef = useRef<HTMLDivElement>(null);
  const currentFlowId = useFlowStore((state) => state.currentFlow?.id);
  const isReadOnly = useIsFlowReadOnly(currentFlowId);
  const [mode, setMode] = useAssistantMode();
  const promptTarget = usePromptTarget(mode === "prompt");
  const promptTargetChoice = useMemo<PromptTargetChoice>(
    () => ({
      targets: promptTarget.targets,
      selected: promptTarget.selected,
      onSelect: promptTarget.select,
    }),
    [promptTarget.targets, promptTarget.selected, promptTarget.select],
  );
  const { isDocked, canDock, toggleDock, dockWidth, handleDockResize } =
    useAssistantDock();
  // The expanded sidebar offsets the canvas 280px, so the panel shifts right
  // by half that (140px) to stay centered on the canvas.
  const isSidebarOpen = useSidebar().open;

  useEffect(() => {
    if (isOpen && isReadOnly) onClose();
  }, [isOpen, isReadOnly, onClose]);

  useEffect(() => {
    purgeLegacyAssistantStorage();
  }, []);

  const canSendWithModel = useCallback(
    (model: AssistantModel | null) => isCatalogReady && isModelEnabled(model),
    [isCatalogReady, isModelEnabled],
  );
  const {
    messages,
    sessionId,
    isProcessing,
    currentStep,
    handleSend,
    handleTestFlow,
    handleApprove,
    handleAcknowledgeValidation,
    handleRetry,
    handleStopGeneration,
    handleClearHistory,
    loadSession,
  } = useAssistantChat({ canUseModel: canSendWithModel });

  useEffect(() => {
    // Docked, the panel sits beside the canvas: working on the canvas is the
    // point, not a reason to close it.
    if (!isOpen || isDocked) return;

    const handleClickOutside = (e: PointerEvent) => {
      // Keep a running turn in view: a stray click on the canvas while the
      // reply streams would hide it. The toggle button still closes the panel.
      if (isProcessing) return;
      const target = e.target as Node;
      // Don't close if clicking inside the panel
      if (panelRef.current && panelRef.current.contains(target)) return;
      // Don't close if clicking inside a dropdown portal, popover, or dialog
      const el = e.target as HTMLElement;
      if (
        el.closest?.("[role='menu']") ||
        el.closest?.("[data-radix-popper-content-wrapper]")
      )
        return;
      if (
        el.closest?.("[role='dialog']") ||
        el.closest?.("[data-radix-dialog-overlay]")
      )
        return;
      // Don't close if any panel dropdown or dialog is currently open (portals render outside panelRef)
      if (document.querySelector("[data-radix-popper-content-wrapper]")) return;
      if (document.querySelector("[role='dialog']")) return;
      // Don't close if clicking the canvas controls (let the toggle button handle it)
      if (el.closest?.("[data-testid='main_canvas_controls']")) return;
      // Don't close if interacting with a resize handle
      if (el.closest?.("[data-resize-handle]")) return;
      onClose();
    };

    document.addEventListener("pointerdown", handleClickOutside, true);
    return () =>
      document.removeEventListener("pointerdown", handleClickOutside, true);
  }, [isOpen, isDocked, isProcessing, onClose]);
  const selectedPromptTarget = promptTarget.selected;
  const handleAuthorizedSend = useCallback(
    (content: string, model: AssistantModel | null) => {
      if (!canSendWithModel(model)) return;
      void handleSend(content, model, {
        mode,
        ...(mode === "prompt" && selectedPromptTarget
          ? {
              promptTarget: {
                componentId: selectedPromptTarget.componentId,
                fieldName: selectedPromptTarget.fieldName,
                label: selectedPromptTarget.label,
              },
            }
          : {}),
      });
    },
    [canSendWithModel, handleSend, mode, selectedPromptTarget],
  );
  const handleAuthorizedTest = useCallback(
    (model: AssistantModel | null) => {
      if (!canSendWithModel(model)) return;
      void handleTestFlow(model);
    },
    [canSendWithModel, handleTestFlow],
  );
  const handleAuthorizedRetry = useCallback(
    (messageId: string) => {
      if (!isCatalogReady) return;
      handleRetry(messageId, canSendWithModel);
    },
    [canSendWithModel, handleRetry, isCatalogReady],
  );

  // Only the latest result card gets actions: "Test again" on an older card
  // would read as testing that older state.
  const latestTestResultId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant" && messages[i].testResult) {
        return messages[i].id;
      }
    }
    return undefined;
  }, [messages]);

  // The Playground only chats: it needs a Chat Input or a Chat Output.
  const hasChatIO = useFlowStore(
    (state) =>
      (state.inputs ?? []).some((input) => input.type === "ChatInput") ||
      (state.outputs ?? []).some((output) => output.type === "ChatOutput"),
  );
  const handleOpenPlayground = useCallback(() => {
    // Set the store directly: the toolbar's own trigger forces fullscreen,
    // which makes the rest of the page, this panel included, inert.
    const playground = usePlaygroundStore.getState();
    playground.setIsFullscreen(false);
    playground.setIsOpen(true);
    // A floating panel would sit on top of it and close on the next click anyway.
    if (!isDocked) onClose();
  }, [isDocked, onClose]);

  const canRunActions = isCatalogReady && hasEnabledModels && !isProcessing;

  const { sessions, saveCurrentSession, switchSession, deleteSession } =
    useSessionHistory(sessionId, messages, loadSession);

  const handleNewSession = useCallback(() => {
    handleStopGeneration();
    saveCurrentSession();
    draftMessageCache = "";
    handleClearHistory();
  }, [handleStopGeneration, saveCurrentSession, handleClearHistory]);

  const handleApproveAndClose = (messageId: string, componentCode?: string) => {
    if (isReadOnly) return;
    handleApprove(messageId, componentCode);
    // A floating panel covers the canvas, so it gets out of the way to reveal
    // the new component. A docked one covers nothing.
    if (!isDocked) onClose();
  };

  const hasMessages = messages.length > 0;
  const [hasExpandedOnce, setHasExpandedOnce] = useState(false);
  const [hasUserResized, setHasUserResized] = useState(false);
  const [isMentionOpen, setIsMentionOpen] = useState(false);
  // Starter prompts: what was picked, and whether the user has started typing.
  const [prefill, setPrefill] = useState<{ text: string; nonce: number }>();
  const [hasDraft, setHasDraft] = useState(draftMessageCache.length > 0);

  // Track if panel has ever shown messages (to keep expanded size after new session)
  useEffect(() => {
    if (hasMessages) setHasExpandedOnce(true);
  }, [hasMessages]);

  // Reset when panel is closed
  useEffect(() => {
    if (!isOpen) {
      setHasExpandedOnce(false);
      setHasUserResized(false);
    }
  }, [isOpen]);

  // A grab in the empty state flips the panel to panelSize-driven dimensions
  // instead of auto-fitting to the input height.
  // Docked is always full height: there is no compact form to grow out of.
  const useExpandedSize =
    isDocked || hasMessages || hasExpandedOnce || hasUserResized;
  const [panelSize, setPanelSize] = useState(getStoredSize);
  const resizeCleanupRef = useRef<(() => void) | null>(null);

  // Clean up resize listeners if the component unmounts mid-drag
  useEffect(() => {
    return () => {
      resizeCleanupRef.current?.();
    };
  }, []);

  const handleEdgeResize = useCallback(
    (e: React.MouseEvent, edges: { x?: "left" | "right"; y?: "top" }) => {
      e.preventDefault();
      e.stopPropagation();
      // Seed startH from the rendered height when promoting from compact mode —
      // seeding from panelSize.height would snap ~200px→600px on the first drag pixel.
      const startX = e.clientX;
      const startY = e.clientY;
      const startW = panelSize.width;
      let startH = panelSize.height;

      if (edges.y === "top") {
        if (!useExpandedSize && panelRef.current) {
          const measuredH = panelRef.current.getBoundingClientRect().height;
          if (measuredH > 0) {
            startH = measuredH;
            // Push the measured height into state before the flip so the first
            // expanded frame renders at it instead of the stored default.
            setPanelSize((prev) => ({ ...prev, height: measuredH }));
          }
        }
        setHasUserResized(true);
      }

      // Per-drag floor: clamping a compact panel to MIN_SIZE.height on the first
      // mousemove would snap ~200px→400px in one frame.
      const effectiveMinH = Math.min(MIN_SIZE.height, startH);

      const handleMouseMove = (ev: MouseEvent) => {
        let newW = startW;
        let newH = startH;

        if (edges.x === "right") {
          newW = startW + (ev.clientX - startX);
        } else if (edges.x === "left") {
          newW = startW - (ev.clientX - startX);
        }

        if (edges.y === "top") {
          newH = startH - (ev.clientY - startY);
        }

        setPanelSize({
          width: Math.min(MAX_SIZE.width, Math.max(MIN_SIZE.width, newW)),
          height: Math.min(MAX_SIZE.height, Math.max(effectiveMinH, newH)),
        });
      };

      const cleanup = () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        resizeCleanupRef.current = null;
      };

      const handleMouseUp = () => {
        cleanup();
        setPanelSize((prev) => {
          // On release, commit at least the floor (state + localStorage) so a later
          // expanded transition doesn't render the panel uncomfortably small.
          const committed = {
            ...prev,
            height: Math.max(MIN_SIZE.height, prev.height),
          };
          try {
            localStorage.setItem(PANEL_SIZE_KEY, JSON.stringify(committed));
          } catch {
            // localStorage may be unavailable (private browsing)
          }
          return committed;
        });
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      resizeCleanupRef.current = cleanup;
    },
    [panelSize, useExpandedSize],
  );

  if (!isOpen || isReadOnly) return null;

  const containerClasses = isDocked
    ? // In the page's flex row, after <main>: the canvas shrinks to make room
      // instead of being covered.
      "relative z-10 flex h-full shrink-0 flex-col border-l border-border bg-background"
    : cn(
        "flex flex-col transition-[opacity,transform] duration-200 fixed shadow-xl will-change-[opacity,transform]",
        "z-50 bottom-16 -translate-x-1/2 rounded-2xl border border-border",
        isSidebarOpen ? "left-[calc(50%+140px)]" : "left-1/2",
        "opacity-100 translate-y-0 max-w-[calc(100vw-2rem)]",
      );

  const containerStyle = isDocked
    ? { width: dockWidth, minWidth: "28.5rem", maxWidth: "50vw" }
    : useExpandedSize
      ? {
          width: panelSize.width,
          height: panelSize.height,
          minWidth: "28.5rem",
        }
      : {
          width: panelSize.width,
          minWidth: "28.5rem",
          // Definite height (not just min-height) so the inner ``h-full`` column
          // can bottom-anchor the input, leaving room for the upward popover.
          ...(isMentionOpen ? { height: MENTION_PANEL_HEIGHT } : {}),
        };

  return (
    <div
      ref={panelRef}
      data-testid="assistant-panel"
      data-docked={isDocked ? "true" : "false"}
      className={containerClasses}
      style={containerStyle}
    >
      <div
        className={cn(
          "absolute inset-0 bg-background",
          !isDocked && "rounded-2xl",
        )}
      />

      <div className="relative z-10 flex h-full min-h-0 flex-col overflow-hidden">
        <AssistantHeader
          onClose={onClose}
          onNewSession={handleNewSession}
          hasMessages={hasMessages}
          sessions={sessions}
          activeSessionId={sessionId}
          onSelectSession={switchSession}
          onDeleteSession={deleteSession}
          isExpanded={useExpandedSize}
          isDocked={isDocked}
          canDock={canDock}
          onToggleDock={toggleDock}
        />
        {!agenticExperienceEnabled ? (
          <AssistantDisabledState />
        ) : isCatalogReady && !hasEnabledModels && !hasMessages ? (
          <AssistantNoModelsState />
        ) : hasMessages ? (
          <StickToBottom
            className="flex flex-1 flex-col overflow-hidden"
            resize="smooth"
            initial="instant"
          >
            <StickToBottom.Content className="flex min-h-full flex-col justify-end px-4 pt-4 pb-0">
              {messages.map((msg) => (
                <AssistantMessageItem
                  key={msg.id}
                  message={msg}
                  onApprove={handleApproveAndClose}
                  onRetry={
                    isCatalogReady && hasEnabledModels
                      ? handleAuthorizedRetry
                      : undefined
                  }
                  onAcknowledgeValidation={handleAcknowledgeValidation}
                  onTestFlow={
                    msg.id === latestTestResultId && canRunActions
                      ? () => void handleTestFlow(null)
                      : undefined
                  }
                  onOpenPlayground={
                    msg.id === latestTestResultId && hasChatIO
                      ? handleOpenPlayground
                      : undefined
                  }
                />
              ))}
            </StickToBottom.Content>
            <AssistantInputWithScroll
              onSend={handleAuthorizedSend}
              onStop={handleStopGeneration}
              disabled={!isCatalogReady || !hasEnabledModels || isProcessing}
              isProcessing={isProcessing}
              currentStep={currentStep}
              autoFocus={isOpen && isCatalogReady && hasEnabledModels}
              draftMessage={draftMessageCache}
              onDraftChange={(draft) => {
                draftMessageCache = draft;
              }}
              mode={mode}
              onModeChange={setMode}
              onTestFlow={handleAuthorizedTest}
              promptTargetPicker={promptTargetChoice}
            />
          </StickToBottom>
        ) : (
          <>
            {/* Examples until the first keystroke; the mention list needs the room. */}
            {!hasDraft && !isMentionOpen ? (
              <AssistantStarterPrompts
                mode={mode}
                variant={useExpandedSize ? "expanded" : "compact"}
                disabled={!isCatalogReady || !hasEnabledModels}
                onSelect={(text) =>
                  setPrefill((prev) => ({
                    text,
                    nonce: (prev?.nonce ?? 0) + 1,
                  }))
                }
              />
            ) : (
              (useExpandedSize || isMentionOpen) && <div className="flex-1" />
            )}
            <AssistantInput
              onSend={handleAuthorizedSend}
              onStop={handleStopGeneration}
              disabled={!isCatalogReady || !hasEnabledModels}
              isProcessing={isProcessing}
              currentStep={currentStep}
              compact={hasExpandedOnce}
              autoFocus={isOpen && isCatalogReady && hasEnabledModels}
              draftMessage={draftMessageCache}
              onDraftChange={(draft) => {
                draftMessageCache = draft;
                setHasDraft(draft.length > 0);
              }}
              prefill={prefill}
              onMentionOpenChange={setIsMentionOpen}
              mode={mode}
              onModeChange={setMode}
              onTestFlow={handleAuthorizedTest}
              promptTargetPicker={promptTargetChoice}
            />
          </>
        )}
      </div>

      {isDocked ? (
        // Docked: the width is the only free dimension, dragged from the edge
        // that faces the canvas.
        <div
          data-resize-handle
          data-testid="assistant-dock-resize-handle"
          className="absolute top-0 bottom-0 -left-[5px] z-30 w-[10px] cursor-ew-resize transition-colors hover:bg-primary/20"
          onMouseDown={handleDockResize}
        />
      ) : (
        <>
          {/* Edge resize handles — invisible hitboxes with hover highlight.
              Always rendered: the empty state needs them too so the user can
              widen the panel before sending the first message. First drag flips
              hasUserResized → panel transitions from auto-height to
              panelSize-driven dimensions. */}
          {/* Left edge */}
          <div
            data-resize-handle
            className="absolute top-3 bottom-3 -left-[5px] z-30 w-[10px] cursor-ew-resize rounded-full transition-colors hover:bg-primary/20"
            onMouseDown={(e) => handleEdgeResize(e, { x: "left" })}
          />
          {/* Right edge */}
          <div
            data-resize-handle
            className="absolute top-3 bottom-3 -right-[5px] z-30 w-[10px] cursor-ew-resize rounded-full transition-colors hover:bg-primary/20"
            onMouseDown={(e) => handleEdgeResize(e, { x: "right" })}
          />
          {/* Top edge */}
          <div
            data-resize-handle
            className="absolute -top-[5px] right-3 left-3 z-30 h-[10px] cursor-ns-resize rounded-full transition-colors hover:bg-primary/20"
            onMouseDown={(e) => handleEdgeResize(e, { y: "top" })}
          />
          {/* Top-left corner */}
          <div
            data-resize-handle
            className="absolute -top-[5px] -left-[5px] z-30 h-[14px] w-[14px] cursor-nw-resize rounded-full transition-colors hover:bg-primary/30"
            onMouseDown={(e) => handleEdgeResize(e, { x: "left", y: "top" })}
          />
          {/* Top-right corner */}
          <div
            data-resize-handle
            className="absolute -top-[5px] -right-[5px] z-30 h-[14px] w-[14px] cursor-ne-resize rounded-full transition-colors hover:bg-primary/30"
            onMouseDown={(e) => handleEdgeResize(e, { x: "right", y: "top" })}
          />
        </>
      )}
    </div>
  );
}

export default AssistantPanel;
