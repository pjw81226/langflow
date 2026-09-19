import { useCallback, useState } from "react";
import type { AssistantMode } from "../assistant-panel.types";
import { readAssistantMode, writeAssistantMode } from "./mode-storage";
import { useComponentModeBlockedReason } from "./use-component-mode-blocked-reason";

/**
 * The panel mode, persisted so the panel reopens in the mode it was left in.
 *
 * Where the server does not let this user create custom components, a stored
 * Component choice reads as Prompt. It stays stored, so it comes back once
 * the server allows it.
 */
export function useAssistantMode(): [
  AssistantMode,
  (mode: AssistantMode) => void,
] {
  const [mode, setModeState] = useState<AssistantMode>(readAssistantMode);
  const componentBlocked = useComponentModeBlockedReason() !== null;

  const setMode = useCallback((next: AssistantMode) => {
    setModeState(next);
    writeAssistantMode(next);
  }, []);

  return [mode === "component" && componentBlocked ? "prompt" : mode, setMode];
}
