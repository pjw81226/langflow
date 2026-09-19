import { useCallback, useEffect, useRef, useState } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import useAssistantManagerStore from "@/stores/assistantManagerStore";
import useFlowStore from "@/stores/flowStore";
import { useUtilityStore } from "@/stores/utilityStore";
import {
  clampDockWidth,
  readDockPreference,
  readDockWidth,
  writeDockPreference,
  writeDockWidth,
} from "./dock-storage";

// Below this the canvas and a docked panel cannot both be usable.
const DOCK_MIN_VIEWPORT = 1024;
// Long enough for React Flow to measure the resized canvas before it refits.
const REFIT_DELAY_MS = 60;

/**
 * Docking takes a column off the canvas (and undocking gives it back), which
 * leaves part of the flow out of view. Refit once, on the user's own layout
 * action, never on a mere re-render.
 */
function refitCanvas() {
  window.setTimeout(() => {
    useFlowStore.getState().reactFlowInstance?.fitView({
      padding: { left: "20px", right: "20px", top: "80px" },
      minZoom: 0.25,
      maxZoom: 2,
      duration: 250,
    });
  }, REFIT_DELAY_MS);
}

interface UseAssistantDockReturn {
  /** Docked right now: the preference (or the deployment default) AND enough room. */
  isDocked: boolean;
  /** Whether the viewport is wide enough to offer docking at all. */
  canDock: boolean;
  toggleDock: () => void;
  dockWidth: number;
  /** mousedown handler for the docked panel's left edge. */
  handleDockResize: (e: React.MouseEvent) => void;
}

export function useAssistantDock(): UseAssistantDockReturn {
  const dockDefault = useUtilityStore((state) => state.assistantDockDefault);
  const setAssistantDocked = useAssistantManagerStore(
    (state) => state.setAssistantDocked,
  );
  const [preference, setPreference] = useState<boolean | null>(
    readDockPreference,
  );
  const [dockWidth, setDockWidth] = useState<number>(readDockWidth);
  const canDock = !useIsMobile({ maxWidth: DOCK_MIN_VIEWPORT });
  const cleanupRef = useRef<(() => void) | null>(null);

  // The user's own choice wins; the deployment default only fills the gap.
  // It is read on render, not copied into state, because /config can land
  // after the panel has mounted.
  const isDocked = canDock && (preference ?? dockDefault);

  // Code outside the panel (the Escape hotkey, the apply handlers) needs to
  // know whether minimizing the panel makes sense.
  useEffect(() => {
    setAssistantDocked(isDocked);
    return () => setAssistantDocked(false);
  }, [isDocked, setAssistantDocked]);

  useEffect(() => () => cleanupRef.current?.(), []);

  const toggleDock = useCallback(() => {
    const next = !isDocked;
    setPreference(next);
    writeDockPreference(next);
    refitCanvas();
  }, [isDocked]);

  const handleDockResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startWidth = dockWidth;
      let latest = startWidth;

      const handleMouseMove = (ev: MouseEvent) => {
        // The panel is on the right: dragging its left edge leftwards widens it.
        latest = clampDockWidth(startWidth - (ev.clientX - startX));
        setDockWidth(latest);
      };
      const cleanup = () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        cleanupRef.current = null;
      };
      const handleMouseUp = () => {
        cleanup();
        writeDockWidth(latest);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      cleanupRef.current = cleanup;
    },
    [dockWidth],
  );

  return { isDocked, canDock, toggleDock, dockWidth, handleDockResize };
}
