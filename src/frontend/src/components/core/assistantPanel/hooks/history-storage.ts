/**
 * localStorage primitives for the Assistant's `/history N` memory-window
 * preference — how many prior messages the assistant's Agent keeps in memory
 * (the `n_messages` lever) plus the injected-history cap.
 *
 * `null` means "unset" — the backend falls back to its defaults
 * (LANGFLOW_ASSISTANT_HISTORY_TURNS for injection, the flow's n_messages for the
 * Agent). The preference persists across sessions like `/skip-all`.
 *
 * Defensive: localStorage can throw in private browsing; a corrupted value
 * degrades to `null` (defaults) rather than a bogus limit.
 */

import i18n from "@/i18n";

const STORAGE_KEY = "langflow-assistant-history-limit";
export const MAX_HISTORY_LIMIT = 100;

export function readHistoryLimit(): number | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const n = Number.parseInt(raw, 10);
    if (Number.isNaN(n) || n < 0 || n > MAX_HISTORY_LIMIT) return null;
    return n;
  } catch {
    return null;
  }
}

export interface HistoryCommandResult {
  limit: number | null;
  announcement: string;
  /** False when the input was `/history` (report only) or invalid. */
  changed: boolean;
}

/**
 * Parse a `/history` command. Returns null when `input` is not a `/history`
 * command (so the caller sends it as a normal prompt). Pure — the caller
 * persists `limit` and renders `announcement`.
 */
export function parseHistoryCommand(
  input: string,
  current: number | null,
): HistoryCommandResult | null {
  const trimmed = input.trim();
  if (trimmed !== "/history" && !trimmed.startsWith("/history ")) return null;
  const arg = trimmed.slice("/history".length).trim().toLowerCase();
  if (arg === "") {
    return {
      limit: current,
      changed: false,
      announcement:
        current === null
          ? i18n.t("assistant.command.history.statusDefault", {
              max: MAX_HISTORY_LIMIT,
            })
          : i18n.t("assistant.command.history.statusCurrent", { current }),
    };
  }
  if (arg === "off" || arg === "all" || arg === "clear") {
    return {
      limit: null,
      changed: true,
      announcement: i18n.t("assistant.command.history.cleared"),
    };
  }
  const n = Number.parseInt(arg, 10);
  if (Number.isNaN(n) || n < 0 || n > MAX_HISTORY_LIMIT) {
    return {
      limit: current,
      changed: false,
      announcement: i18n.t("assistant.command.history.invalid", {
        max: MAX_HISTORY_LIMIT,
      }),
    };
  }
  return {
    limit: n,
    changed: true,
    announcement: i18n.t("assistant.command.history.set", { n }),
  };
}

export function writeHistoryLimit(value: number | null): void {
  try {
    if (value === null) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, String(value));
    }
  } catch {
    // localStorage unavailable (private browsing) — the limit just won't
    // survive a reload; the user can re-issue /history.
  }
}
