import { useEffect, useState } from "react";
import type { AssistantModel } from "../assistant-panel.types";

/**
 * Shared source of truth for the AssistantPanel's selected model:
 *   - On mount, hydrates from ``localStorage`` (validated shape).
 *   - On change, persists back to ``localStorage`` so the choice survives
 *     across page reloads and across surfaces that select a model.
 *
 * The panel swaps between two AssistantInput instances (empty state and
 * conversation), so the choice lives in storage rather than component state:
 * whichever one mounts next shows the model picked in the other.
 */
export const ASSISTANT_MODEL_STORAGE_KEY = "langflow-assistant-selected-model";

function readStoredModel(): AssistantModel | null {
  try {
    const saved = localStorage.getItem(ASSISTANT_MODEL_STORAGE_KEY);
    if (!saved) return null;
    const parsed = JSON.parse(saved);
    if (parsed && parsed.provider && parsed.name) {
      return parsed as AssistantModel;
    }
    // Wrong shape — clear so subsequent reads start fresh.
    localStorage.removeItem(ASSISTANT_MODEL_STORAGE_KEY);
    return null;
  } catch {
    // localStorage may be unavailable (private browsing) or corrupted.
    try {
      localStorage.removeItem(ASSISTANT_MODEL_STORAGE_KEY);
    } catch {
      // ignore
    }
    return null;
  }
}

export function useAssistantSelectedModel(): [
  AssistantModel | null,
  (model: AssistantModel | null) => void,
] {
  const [selectedModel, setSelectedModel] = useState<AssistantModel | null>(
    readStoredModel,
  );

  useEffect(() => {
    if (!selectedModel) return;
    try {
      localStorage.setItem(
        ASSISTANT_MODEL_STORAGE_KEY,
        JSON.stringify(selectedModel),
      );
    } catch {
      // ignore — private browsing / quota / etc.
    }
  }, [selectedModel]);

  return [selectedModel, setSelectedModel];
}
