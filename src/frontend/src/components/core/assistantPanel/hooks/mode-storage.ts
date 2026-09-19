/**
 * localStorage primitives for the Assistant's panel mode.
 *
 * "build" lets the assistant change the canvas; "ask" is a read-only help
 * turn. The last mode the user picked is remembered across sessions, the same
 * way skip-all is: it is a working habit, not a per-conversation choice.
 *
 * Defensive like the other assistant storage helpers: localStorage can throw
 * in private browsing, and an unknown stored value degrades to "build", the
 * behaviour the panel had before modes existed.
 */

import type { AssistantMode } from "../assistant-panel.types";

const STORAGE_KEY = "langflow-assistant-mode";
export const DEFAULT_ASSISTANT_MODE: AssistantMode = "build";

export function readAssistantMode(): AssistantMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === "ask" || raw === "build" ? raw : DEFAULT_ASSISTANT_MODE;
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
