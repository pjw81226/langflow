/**
 * localStorage keys left behind by assistant features that no longer exist
 * (the auto-apply toggle and the /history and /iterations commands). Nothing
 * reads them any more; removing them keeps the browser's storage tidy.
 */
const LEGACY_KEYS = [
  "langflow-assistant-skip-all",
  "langflow-assistant-skip-all-set",
  "langflow-assistant-history-limit",
  "langflow-assistant-iterations-limit",
] as const;

export function purgeLegacyAssistantStorage(): void {
  try {
    for (const key of LEGACY_KEYS) {
      localStorage.removeItem(key);
    }
  } catch {
    // localStorage unavailable (private browsing) — nothing to clean up.
  }
}
