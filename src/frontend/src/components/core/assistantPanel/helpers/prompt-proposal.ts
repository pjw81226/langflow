/**
 * Putting a proposed prompt into the field it was written for, and taking it
 * back out.
 *
 * Nothing is written without a click on Apply, and every write checks the
 * canvas again first: the proposal can outlive the component, the field can
 * get a connection, and the flow can be locked.
 */

import { cloneDeep } from "lodash";
import type { AgenticCompleteData } from "@/controllers/API/queries/agentic";
import useFlowStore from "@/stores/flowStore";
import useFlowsManagerStore from "@/stores/flowsManagerStore";
import type { AllNodeType, EdgeType, GenericNodeType } from "@/types/flow";
import type { PromptProposal } from "../assistant-panel.types";
import { isFieldFedByEdge, readPromptFieldValue } from "./prompt-targets";

export type PromptApplyState =
  /** No component was chosen: the prompt can only be copied. */
  | "copy_only"
  | "node_missing"
  /** The field is gone or no longer shown on the component. */
  | "field_missing"
  | "field_connected"
  | "flow_locked"
  /** Applied, and the field still holds the proposed text. */
  | "applied"
  | "ready";

export function promptProposalFromComplete(
  data: Pick<AgenticCompleteData, "prompt_proposal">,
): PromptProposal | undefined {
  const proposal = data.prompt_proposal;
  if (!proposal || typeof proposal.new_value !== "string") return undefined;
  return {
    newValue: proposal.new_value,
    oldValue: proposal.old_value ?? null,
    componentId: proposal.component_id ?? null,
    componentName: proposal.component_name ?? null,
    field: proposal.field ?? null,
    fieldLabel: proposal.field_label ?? null,
  };
}

export function getPromptApplyState(
  proposal: PromptProposal,
  canvas: { nodes: AllNodeType[]; edges: EdgeType[]; locked: boolean },
): PromptApplyState {
  const { componentId, field } = proposal;
  if (!componentId || !field) return "copy_only";
  const node = canvas.nodes.find((candidate) => candidate.id === componentId);
  if (!node || node.type !== "genericNode") return "node_missing";
  const template = node.data.node?.template?.[field];
  if (!template || template.show === false) return "field_missing";
  if (isFieldFedByEdge(canvas.edges, componentId, field)) {
    return "field_connected";
  }
  if (canvas.locked) return "flow_locked";
  // Compared with the field every time: after an undo on the canvas or an
  // edit by hand, the card offers Apply again.
  if (
    proposal.replacedValue !== undefined &&
    readPromptFieldValue(canvas.nodes, { componentId, fieldName: field }) ===
      proposal.newValue
  ) {
    return "applied";
  }
  return "ready";
}

function currentApplyState(proposal: PromptProposal): PromptApplyState {
  const flow = useFlowStore.getState();
  return getPromptApplyState(proposal, {
    nodes: flow.nodes,
    edges: flow.edges,
    locked: Boolean(flow.currentFlow?.locked),
  });
}

function writeField(componentId: string, field: string, value: string) {
  // A snapshot first, so the canvas's own undo can take the change back.
  useFlowsManagerStore.getState().takeSnapshot();
  // The same write the field's own editor makes; it also triggers autosave.
  useFlowStore.getState().setNode(componentId, (oldNode) => {
    const data = cloneDeep(oldNode.data) as GenericNodeType["data"];
    data.node.template[field].value = value;
    return { ...oldNode, data } as AllNodeType;
  });
}

/**
 * Writes the proposed prompt into its field. Returns the text it replaced, or
 * null when the proposal cannot be applied right now.
 */
export function applyPromptProposal(proposal: PromptProposal): string | null {
  if (currentApplyState(proposal) !== "ready") return null;
  const componentId = proposal.componentId as string;
  const field = proposal.field as string;
  const replaced =
    readPromptFieldValue(useFlowStore.getState().nodes, {
      componentId,
      fieldName: field,
    }) ?? "";
  writeField(componentId, field, proposal.newValue);
  return replaced;
}

/** Puts back the text Apply replaced. False when there is nothing to undo. */
export function undoPromptProposal(proposal: PromptProposal): boolean {
  if (
    proposal.replacedValue === undefined ||
    currentApplyState(proposal) !== "applied"
  ) {
    return false;
  }
  writeField(
    proposal.componentId as string,
    proposal.field as string,
    proposal.replacedValue,
  );
  return true;
}
