import { useCallback, useState } from "react";
import type { AssistantMode } from "../assistant-panel.types";
import { readAssistantMode, writeAssistantMode } from "./mode-storage";

/** The panel mode, persisted so the panel reopens in the mode it was left in. */
export function useAssistantMode(): [
  AssistantMode,
  (mode: AssistantMode) => void,
] {
  const [mode, setModeState] = useState<AssistantMode>(readAssistantMode);

  const setMode = useCallback((next: AssistantMode) => {
    setModeState(next);
    writeAssistantMode(next);
  }, []);

  return [mode, setMode];
}
