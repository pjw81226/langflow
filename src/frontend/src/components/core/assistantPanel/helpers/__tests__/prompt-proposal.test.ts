import type { AllNodeType, EdgeType } from "@/types/flow";
import type { PromptProposal } from "../../assistant-panel.types";
import {
  applyPromptProposal,
  getPromptApplyState,
  promptProposalFromComplete,
  undoPromptProposal,
} from "../prompt-proposal";

type CanvasNode = {
  id: string;
  type: string;
  data: {
    node: { template: Record<string, { show?: boolean; value?: unknown }> };
  };
};

const mockCanvas: {
  nodes: CanvasNode[];
  edges: EdgeType[];
  currentFlow: { locked?: boolean } | undefined;
} = { nodes: [], edges: [], currentFlow: undefined };
const mockSetNode = jest.fn(
  (id: string, update: (old: CanvasNode) => CanvasNode) => {
    mockCanvas.nodes = mockCanvas.nodes.map((node) =>
      node.id === id ? update(node) : node,
    );
  },
);
jest.mock("@/stores/flowStore", () => ({
  __esModule: true,
  default: {
    getState: () => ({ ...mockCanvas, setNode: mockSetNode }),
  },
}));

const mockTakeSnapshot = jest.fn();
jest.mock("@/stores/flowsManagerStore", () => ({
  __esModule: true,
  default: { getState: () => ({ takeSnapshot: mockTakeSnapshot }) },
}));

function agent(value: unknown, show = true): CanvasNode {
  return {
    id: "Agent-1",
    type: "genericNode",
    data: { node: { template: { system_prompt: { show, value } } } },
  };
}

const PROPOSAL: PromptProposal = {
  newValue: "Answer in three bullet points.",
  oldValue: "Be helpful.",
  componentId: "Agent-1",
  componentName: "Agent",
  field: "system_prompt",
  fieldLabel: "Agent Instructions",
};

function stateOf(
  proposal: PromptProposal,
  {
    nodes = [agent("Be helpful.")],
    edges = [],
    locked = false,
  }: { nodes?: CanvasNode[]; edges?: EdgeType[]; locked?: boolean } = {},
) {
  return getPromptApplyState(proposal, {
    nodes: nodes as unknown as AllNodeType[],
    edges,
    locked,
  });
}

const CONNECTED: EdgeType = {
  id: "edge-1",
  source: "Prompt-1",
  target: "Agent-1",
  targetHandle: "{œfieldNameœ:œsystem_promptœ,œidœ:œAgent-1œ}",
} as EdgeType;

function fieldValue() {
  return mockCanvas.nodes[0]?.data.node.template.system_prompt.value;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCanvas.nodes = [agent("Be helpful.")];
  mockCanvas.edges = [];
  mockCanvas.currentFlow = { locked: false };
});

describe("promptProposalFromComplete", () => {
  it("should_read_the_proposal_in_camel_case", () => {
    expect(
      promptProposalFromComplete({
        prompt_proposal: {
          new_value: "Be brief.",
          old_value: "",
          component_id: "Agent-1",
          component_name: "Agent",
          field: "system_prompt",
          field_label: "Agent Instructions",
        },
      }),
    ).toEqual({
      newValue: "Be brief.",
      oldValue: "",
      componentId: "Agent-1",
      componentName: "Agent",
      field: "system_prompt",
      fieldLabel: "Agent Instructions",
    });
  });

  it("should_report_nothing_without_a_proposal", () => {
    expect(
      promptProposalFromComplete({ prompt_proposal: null }),
    ).toBeUndefined();
    expect(promptProposalFromComplete({})).toBeUndefined();
  });
});

describe("getPromptApplyState", () => {
  it("should_be_copy_only_without_a_component", () => {
    expect(
      stateOf({ ...PROPOSAL, componentId: null, field: null, oldValue: null }),
    ).toBe("copy_only");
  });

  it("should_notice_a_removed_component", () => {
    expect(stateOf(PROPOSAL, { nodes: [] })).toBe("node_missing");
  });

  it("should_notice_a_removed_or_hidden_field", () => {
    expect(stateOf({ ...PROPOSAL, field: "system_message" })).toBe(
      "field_missing",
    );
    expect(stateOf(PROPOSAL, { nodes: [agent("x", false)] })).toBe(
      "field_missing",
    );
  });

  it("should_notice_a_connection_into_the_field", () => {
    expect(stateOf(PROPOSAL, { edges: [CONNECTED] })).toBe("field_connected");
  });

  it("should_notice_a_locked_flow", () => {
    expect(stateOf(PROPOSAL, { locked: true })).toBe("flow_locked");
  });

  it("should_be_ready_until_applied", () => {
    expect(stateOf(PROPOSAL)).toBe("ready");
  });

  it("should_be_applied_while_the_field_holds_the_proposed_text", () => {
    const applied = { ...PROPOSAL, replacedValue: "Be helpful." };

    expect(stateOf(applied, { nodes: [agent(PROPOSAL.newValue)] })).toBe(
      "applied",
    );
  });

  it("should_offer_apply_again_after_the_field_changed_back", () => {
    // Ctrl+Z on the canvas, or an edit by hand.
    const applied = { ...PROPOSAL, replacedValue: "Be helpful." };

    expect(stateOf(applied, { nodes: [agent("Be helpful.")] })).toBe("ready");
  });
});

describe("applyPromptProposal", () => {
  it("should_write_the_prompt_after_a_snapshot_and_return_what_it_replaced", () => {
    const before = mockCanvas.nodes[0];

    expect(applyPromptProposal(PROPOSAL)).toBe("Be helpful.");

    expect(fieldValue()).toBe(PROPOSAL.newValue);
    expect(mockTakeSnapshot).toHaveBeenCalledTimes(1);
    expect(mockTakeSnapshot.mock.invocationCallOrder[0]).toBeLessThan(
      mockSetNode.mock.invocationCallOrder[0],
    );
    // The old node is left untouched: the store gets a new one.
    expect(before.data.node.template.system_prompt.value).toBe("Be helpful.");
  });

  it("should_return_an_empty_string_for_an_empty_field", () => {
    mockCanvas.nodes = [agent(null)];

    expect(applyPromptProposal(PROPOSAL)).toBe("");
  });

  it.each([
    [
      "connected",
      () => {
        mockCanvas.edges = [CONNECTED];
      },
    ],
    [
      "locked",
      () => {
        mockCanvas.currentFlow = { locked: true };
      },
    ],
    [
      "removed",
      () => {
        mockCanvas.nodes = [];
      },
    ],
  ])("should_refuse_when_the_field_is_%s", (_name, arrange) => {
    arrange();

    expect(applyPromptProposal(PROPOSAL)).toBeNull();
    expect(mockSetNode).not.toHaveBeenCalled();
    expect(mockTakeSnapshot).not.toHaveBeenCalled();
  });

  it("should_refuse_a_copy_only_proposal", () => {
    expect(
      applyPromptProposal({ ...PROPOSAL, componentId: null, field: null }),
    ).toBeNull();
    expect(mockSetNode).not.toHaveBeenCalled();
  });
});

describe("undoPromptProposal", () => {
  it("should_put_back_the_replaced_text_after_a_snapshot", () => {
    mockCanvas.nodes = [agent(PROPOSAL.newValue)];

    expect(
      undoPromptProposal({ ...PROPOSAL, replacedValue: "Be helpful." }),
    ).toBe(true);

    expect(fieldValue()).toBe("Be helpful.");
    expect(mockTakeSnapshot).toHaveBeenCalledTimes(1);
  });

  it("should_do_nothing_when_the_prompt_was_not_applied", () => {
    expect(undoPromptProposal(PROPOSAL)).toBe(false);
    expect(mockSetNode).not.toHaveBeenCalled();
  });

  it("should_do_nothing_once_the_field_was_changed_again", () => {
    mockCanvas.nodes = [agent("Edited by hand.")];

    expect(
      undoPromptProposal({ ...PROPOSAL, replacedValue: "Be helpful." }),
    ).toBe(false);
    expect(fieldValue()).toBe("Edited by hand.");
  });
});
