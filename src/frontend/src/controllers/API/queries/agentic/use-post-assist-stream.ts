import i18n from "@/i18n";
import { getURL } from "../../helpers/constants";
import type {
  AgenticAssistRequest,
  AgenticCancelledEvent,
  AgenticCompleteEvent,
  AgenticErrorEvent,
  AgenticProgressEvent,
  AgenticSSEEvent,
  AgenticTokenEvent,
} from "./types";

interface StreamCallbacks {
  onProgress?: (event: AgenticProgressEvent) => void;
  onToken?: (event: AgenticTokenEvent) => void;
  onComplete?: (event: AgenticCompleteEvent) => void;
  onError?: (event: AgenticErrorEvent) => void;
  onCancelled?: (event: AgenticCancelledEvent) => void;
}

function parseSSEEvent(data: string): AgenticSSEEvent | null {
  try {
    return JSON.parse(data) as AgenticSSEEvent;
  } catch {
    // Malformed JSON from SSE stream - skip this event
    return null;
  }
}

function processSSELine(
  line: string,
  callbacks: StreamCallbacks,
): { done: boolean } {
  if (!line.startsWith("data: ")) {
    return { done: false };
  }

  const data = line.slice(6);
  const event = parseSSEEvent(data);

  if (!event) {
    callbacks.onError?.({
      event: "error",
      message: i18n.t("assistant.error.malformedEvent"),
    });
    return { done: false };
  }

  switch (event.event) {
    case "progress":
      callbacks.onProgress?.(event);
      break;
    case "token":
      callbacks.onToken?.(event);
      break;
    case "complete":
      callbacks.onComplete?.(event);
      return { done: true };
    case "error":
      callbacks.onError?.(event);
      return { done: true };
    case "cancelled":
      callbacks.onCancelled?.(event);
      return { done: true };
    // Anything else (flow_update, tool_start, ... from an older backend) is
    // ignored: the panel has nothing to show for it.
  }

  return { done: false };
}

/**
 * The message to show for a non-2xx response. FastAPI puts it in ``detail``:
 * a string (e.g. the 403 when custom components are turned off), or an object
 * or a list for structured errors, which must not reach the UI as
 * "[object Object]".
 */
function errorMessageFromBody(body: string, fallback: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    // Error response is plain text, not JSON - use as-is
    return body || fallback;
  }
  const { detail, message } = (parsed ?? {}) as {
    detail?: unknown;
    message?: unknown;
  };
  for (const candidate of [detail, message]) {
    if (typeof candidate === "string" && candidate) return candidate;
    if (candidate && typeof candidate === "object") {
      const text = (Array.isArray(candidate) ? candidate : [candidate])
        .map((item) => {
          const entry = item as { message?: unknown; msg?: unknown } | null;
          return entry?.message ?? entry?.msg;
        })
        .filter((part): part is string => typeof part === "string" && !!part)
        .join(" ");
      if (text) return text;
    }
  }
  return fallback;
}

export async function postAssistStream(
  request: AgenticAssistRequest,
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  const url = getURL("AGENTIC_ASSIST_STREAM");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify(request),
    credentials: "include",
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text();
    callbacks.onError?.({
      event: "error",
      message: errorMessageFromBody(
        errorText,
        i18n.t("assistant.error.requestFailed"),
      ),
    });
    return;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    callbacks.onError?.({
      event: "error",
      message: i18n.t("assistant.error.noResponseBody"),
    });
    return;
  }

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");

      // Keep the last incomplete line in the buffer
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmedLine = line.trim();
        if (trimmedLine) {
          const result = processSSELine(trimmedLine, callbacks);
          if (result.done) {
            return;
          }
        }
      }
    }

    // Process any remaining data in the buffer
    if (buffer.trim()) {
      const result = processSSELine(buffer.trim(), callbacks);
      if (result.done) {
        return;
      }
    }

    // Reader ended without a terminal event (dropped connection, server crash):
    // surface a terminal error so the caller clears the spinner instead of hanging.
    callbacks.onError?.({
      event: "error",
      message: i18n.t("assistant.error.connectionEnded"),
    });
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}
