import i18n from "@/i18n";
import { DEFAULT_ASSISTANT_MODE } from "./assistant-modes";
import type { AssistantMode } from "./assistant-panel.types";

export const ASSISTANT_TITLE = "Langflow Assistant";

// Each mode invites its own kind of request.
export const ASSISTANT_PLACEHOLDER_KEYS: Record<
  AssistantMode,
  readonly string[]
> = {
  component: [
    "assistant.placeholder.component.0",
    "assistant.placeholder.component.1",
    "assistant.placeholder.component.2",
  ],
  prompt: [
    "assistant.placeholder.prompt.0",
    "assistant.placeholder.prompt.1",
    "assistant.placeholder.prompt.2",
  ],
  ask: [
    "assistant.placeholder.ask.0",
    "assistant.placeholder.ask.1",
    "assistant.placeholder.ask.2",
  ],
};

// Keys, not translated strings: this module is imported before the saved
// language bundle finishes loading (see index.tsx), so translating here would
// pin every placeholder to the English fallback.
export function getAssistantPlaceholderKey(
  mode: AssistantMode = DEFAULT_ASSISTANT_MODE,
): string {
  const keys = ASSISTANT_PLACEHOLDER_KEYS[mode];
  return keys[Math.floor(Math.random() * keys.length)];
}

export function getAssistantPlaceholder(
  mode: AssistantMode = DEFAULT_ASSISTANT_MODE,
): string {
  return i18n.t(getAssistantPlaceholderKey(mode));
}

export const ASSISTANT_SESSIONS_STORAGE_KEY = "langflow-assistant-sessions";
export const ASSISTANT_MAX_SESSIONS = 10;
export const ASSISTANT_SESSION_PREVIEW_LENGTH = 80;
