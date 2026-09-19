/**
 * The components on the canvas a Prompt turn can write instructions for:
 * agents and language models, through their system prompt field.
 */

import type { AllNodeType, EdgeType } from "@/types/flow";
import { scapeJSONParse } from "@/utils/reactflowUtils";
import type { PromptTargetRef } from "../assistant-panel.types";

/** Agents call it system_prompt, language models system_message. */
export const PROMPT_FIELD_NAMES = ["system_prompt", "system_message"] as const;

export interface PromptTarget {
  componentId: string;
  fieldName: string;
  /** The component's name on the canvas, numbered when several share it. */
  label: string;
  /** The field's name as the component shows it. */
  fieldLabel: string;
  selectedOnCanvas: boolean;
}

/** Same check as the inspection panel: a connected input takes its value
 * from the edge, so writing into the field would change nothing. */
export function isFieldFedByEdge(
  edges: EdgeType[],
  nodeId: string,
  fieldName: string,
): boolean {
  return edges.some((edge) => {
    if (edge.target !== nodeId || !edge.targetHandle) return false;
    try {
      return scapeJSONParse(edge.targetHandle)?.fieldName === fieldName;
    } catch {
      return false;
    }
  });
}

export function getPromptTargets(
  nodes: AllNodeType[],
  edges: EdgeType[],
): PromptTarget[] {
  const found: Omit<PromptTarget, "label">[] = [];
  const names: string[] = [];

  for (const node of nodes) {
    if (node.type !== "genericNode") continue;
    const apiNode = node.data.node;
    const template = apiNode?.template;
    if (!template) continue;
    const fieldName = PROMPT_FIELD_NAMES.find(
      (name) => template[name] && template[name].show !== false,
    );
    if (!fieldName) continue;
    const field = template[fieldName];
    // Tool mode hands the field to the calling agent.
    if (apiNode.tool_mode && field.tool_mode) continue;
    if (isFieldFedByEdge(edges, node.id, fieldName)) continue;

    names.push(apiNode.display_name || node.data.type);
    found.push({
      componentId: node.id,
      fieldName,
      fieldLabel: field.display_name || fieldName,
      selectedOnCanvas: Boolean(node.selected),
    });
  }

  // Two Agents read as "Agent 1" and "Agent 2", in canvas order.
  const counts = new Map<string, number>();
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  const seen = new Map<string, number>();
  return found.map((target, index) => {
    const name = names[index];
    if ((counts.get(name) ?? 0) < 2) return { ...target, label: name };
    const nth = (seen.get(name) ?? 0) + 1;
    seen.set(name, nth);
    return { ...target, label: `${name} ${nth}` };
  });
}

export function promptTargetKey(
  target: Pick<PromptTarget, "componentId" | "fieldName">,
): string {
  return `${target.componentId}:${target.fieldName}`;
}

/**
 * The field's current text ("" when empty), or undefined when the component
 * or the field is no longer on the canvas.
 */
export function readPromptFieldValue(
  nodes: AllNodeType[],
  target: Pick<PromptTargetRef, "componentId" | "fieldName">,
): string | undefined {
  const node = nodes.find((candidate) => candidate.id === target.componentId);
  if (!node || node.type !== "genericNode") return undefined;
  const field = node.data.node?.template?.[target.fieldName];
  if (!field) return undefined;
  const value = field.value;
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value : String(value);
}
