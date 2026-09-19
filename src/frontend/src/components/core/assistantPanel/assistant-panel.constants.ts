import i18n from "@/i18n";
import type { AssistantMode } from "./assistant-panel.types";

export const ASSISTANT_TITLE = "Langflow Assistant";

export const ASSISTANT_PLACEHOLDER_KEYS = [
  "assistant.placeholder.0",
  "assistant.placeholder.1",
  "assistant.placeholder.2",
  "assistant.placeholder.3",
  "assistant.placeholder.4",
] as const;

// Ask mode invites questions, not build requests.
export const ASSISTANT_ASK_PLACEHOLDER_KEYS = [
  "assistant.placeholder.ask.0",
  "assistant.placeholder.ask.1",
  "assistant.placeholder.ask.2",
] as const;

// Keys, not translated strings: this module is imported before the saved
// language bundle finishes loading (see index.tsx), so translating here would
// pin every placeholder to the English fallback.
export function getAssistantPlaceholderKey(
  mode: AssistantMode = "build",
): string {
  const keys =
    mode === "ask"
      ? ASSISTANT_ASK_PLACEHOLDER_KEYS
      : ASSISTANT_PLACEHOLDER_KEYS;
  return keys[Math.floor(Math.random() * keys.length)];
}

export function getAssistantPlaceholder(mode: AssistantMode = "build"): string {
  return i18n.t(getAssistantPlaceholderKey(mode));
}

export const ASSISTANT_SESSIONS_STORAGE_KEY = "langflow-assistant-sessions";
export const ASSISTANT_MAX_SESSIONS = 10;
export const ASSISTANT_SESSION_PREVIEW_LENGTH = 80;
