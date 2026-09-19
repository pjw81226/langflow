import type { AssistantMode } from "@/controllers/API/queries/agentic";

/**
 * The panel's modes, in the order the switch shows them. Component writes a
 * custom component, Prompt writes instructions for an agent or model on the
 * canvas, Ask answers questions about Langflow.
 */
export const ASSISTANT_MODES: readonly AssistantMode[] = [
  "component",
  "prompt",
  "ask",
];

export const DEFAULT_ASSISTANT_MODE: AssistantMode = "component";

export function isAssistantMode(value: unknown): value is AssistantMode {
  return (
    typeof value === "string" &&
    (ASSISTANT_MODES as readonly string[]).includes(value)
  );
}
