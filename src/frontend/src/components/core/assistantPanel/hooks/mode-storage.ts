/**
 * localStorage primitives for the Assistant's panel mode.
 *
 * The last mode the user picked is remembered across sessions: it is a
 * working habit, not a per-conversation choice.
 *
 * Defensive like the other assistant storage helpers: localStorage can throw
 * in private browsing, and an unknown stored value (including "build" from
 * before the modes were split) degrades to the default mode.
 */

import { DEFAULT_ASSISTANT_MODE, isAssistantMode } from "../assistant-modes";
import type { AssistantMode } from "../assistant-panel.types";

const STORAGE_KEY = "langflow-assistant-mode";

export function readAssistantMode(): AssistantMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return isAssistantMode(raw) ? raw : DEFAULT_ASSISTANT_MODE;
  } catch {
    return DEFAULT_ASSISTANT_MODE;
  }
}

export function writeAssistantMode(mode: AssistantMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // localStorage unavailable (private browsing) — the mode just won't
    // survive a reload; the switch is one click away.
  }
}
