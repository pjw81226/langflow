/**
 * Serialization and deserialization of assistant sessions for localStorage.
 */

import { isAssistantMode } from "../assistant-modes";
import type {
  AssistantMessage,
  SerializedAssistantMessage,
  SessionHistoryEntry,
} from "../assistant-panel.types";

/** Fields of removed features (plans, flow proposals, build tasks, file cards,
 * restore points) that sessions saved by older versions still carry. */
const LEGACY_MESSAGE_KEYS = [
  "flowPreview",
  "flowActions",
  "continuationExpected",
  "pendingFlowProposal",
  "autoAppliedFlow",
  "flowProposalStatus",
  "flowProposalSnapshot",
  "pendingPlanProposal",
  "planProposalStatus",
  "writtenFiles",
  "buildTasks",
  "inProgressTask",
  "hidden",
  "restoreVersionId",
  "reverted",
  "wireContent",
] as const;

export function loadSessionsFromStorage(
  storageKey: string,
): SessionHistoryEntry[] {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

export function saveSessionsToStorage(
  storageKey: string,
  sessions: SessionHistoryEntry[],
): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(sessions));
  } catch {
    // localStorage may be full or unavailable
  }
}

export function serializeMessages(
  messages: AssistantMessage[],
): SerializedAssistantMessage[] {
  return messages.map((msg) => {
    // Progress only drives the live loader; a saved turn has none.
    const { timestamp, progress: _progress, ...rest } = msg;
    return {
      ...rest,
      timestamp: timestamp.toISOString(),
      // Streaming/pending messages become cancelled when session is saved
      status:
        msg.status === "streaming" || msg.status === "pending"
          ? "cancelled"
          : msg.status,
    };
  });
}

export function deserializeMessages(
  serialized: SerializedAssistantMessage[],
): AssistantMessage[] {
  return serialized.map((msg) => {
    const restored: AssistantMessage & Record<string, unknown> = {
      ...msg,
      timestamp: new Date(msg.timestamp),
    };
    for (const key of LEGACY_MESSAGE_KEYS) {
      delete restored[key];
    }
    // "build" turns from before the modes were split match no mode today.
    if (!isAssistantMode(restored.mode)) delete restored.mode;
    return restored;
  });
}
