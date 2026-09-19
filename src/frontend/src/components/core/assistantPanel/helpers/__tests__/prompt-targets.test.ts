import type { AllNodeType, EdgeType } from "@/types/flow";
import {
  getPromptTargets,
  isFieldFedByEdge,
  promptTargetKey,
  readPromptFieldValue,
} from "../prompt-targets";

interface NodeOptions {
  displayName?: string;
  field?: "system_prompt" | "system_message";
  fieldLabel?: string;
  value?: unknown;
  show?: boolean;
  selected?: boolean;
  toolMode?: boolean;
  fieldToolMode?: boolean;
  extraFields?: Record<string, unknown>;
}

function promptNode(
  id: string,
  type: string,
  {
    displayName = type,
    field = "system_prompt",
    fieldLabel = "Agent Instructions",
    value = "",
    show = true,
    selected = false,
    toolMode = false,
    fieldToolMode = false,
    extraFields = {},
  }: NodeOptions = {},
): AllNodeType {
  return {
    id,
    type: "genericNode",
    position: { x: 0, y: 0 },
    selected,
    data: {
      id,
      type,
      node: {
        display_name: displayName,
        tool_mode: toolMode,
        template: {
          ...extraFields,
          [field]: {
            show,
            value,
            display_name: fieldLabel,
            tool_mode: fieldToolMode,
          },
        },
      },
    },
  } as unknown as AllNodeType;
}

function edgeInto(nodeId: string, fieldName: string): EdgeType {
  return {
    id: `edge-${nodeId}-${fieldName}`,
    source: "Prompt-1",
    target: nodeId,
    targetHandle: `{œfieldNameœ:œ${fieldName}œ,œidœ:œ${nodeId}œ}`,
  } as EdgeType;
}

describe("getPromptTargets", () => {
  it("should_offer_agents_and_language_models_by_their_prompt_field", () => {
    const targets = getPromptTargets(
      [
        promptNode("Agent-1", "Agent"),
        promptNode("LM-1", "LanguageModelComponent", {
          displayName: "Language Model",
          field: "system_message",
          fieldLabel: "System Message",
        }),
      ],
      [],
    );

    expect(targets).toEqual([
      {
        componentId: "Agent-1",
        fieldName: "system_prompt",
        label: "Agent",
        fieldLabel: "Agent Instructions",
        selectedOnCanvas: false,
      },
      {
        componentId: "LM-1",
        fieldName: "system_message",
        label: "Language Model",
        fieldLabel: "System Message",
        selectedOnCanvas: false,
      },
    ]);
  });

  it("should_skip_components_without_a_prompt_field_and_note_nodes", () => {
    const chatInput = {
      id: "ChatInput-1",
      type: "genericNode",
      position: { x: 0, y: 0 },
      data: {
        id: "ChatInput-1",
        type: "ChatInput",
        node: { display_name: "Chat Input", template: { input_value: {} } },
      },
    } as unknown as AllNodeType;
    const note = {
      id: "note-1",
      type: "noteNode",
      position: { x: 0, y: 0 },
      data: { id: "note-1", type: "note", node: { template: {} } },
    } as unknown as AllNodeType;

    expect(getPromptTargets([chatInput, note], [])).toEqual([]);
  });

  it("should_skip_a_hidden_prompt_field", () => {
    expect(
      getPromptTargets([promptNode("Agent-1", "Agent", { show: false })], []),
    ).toEqual([]);
  });

  it("should_skip_a_field_handed_to_a_calling_agent_in_tool_mode", () => {
    expect(
      getPromptTargets(
        [
          promptNode("Agent-1", "Agent", {
            toolMode: true,
            fieldToolMode: true,
          }),
        ],
        [],
      ),
    ).toEqual([]);
    // Tool mode on the component alone leaves the field in place.
    expect(
      getPromptTargets(
        [promptNode("Agent-1", "Agent", { toolMode: true })],
        [],
      ),
    ).toHaveLength(1);
  });

  it("should_skip_a_field_fed_by_a_connection", () => {
    // Basic Prompting: the Prompt Template feeds the model's system message.
    const model = promptNode("LM-1", "LanguageModelComponent", {
      field: "system_message",
    });

    expect(
      getPromptTargets([model], [edgeInto("LM-1", "system_message")]),
    ).toEqual([]);
    expect(
      getPromptTargets([model], [edgeInto("LM-1", "input_value")]),
    ).toHaveLength(1);
  });

  it("should_number_components_that_share_a_name_in_canvas_order", () => {
    const targets = getPromptTargets(
      [
        promptNode("Agent-b", "Agent"),
        promptNode("LM-1", "LanguageModelComponent", {
          displayName: "Language Model",
          field: "system_message",
        }),
        promptNode("Agent-a", "Agent"),
      ],
      [],
    );

    expect(targets.map((target) => target.label)).toEqual([
      "Agent 1",
      "Language Model",
      "Agent 2",
    ]);
  });

  it("should_fall_back_to_the_component_type_without_a_display_name", () => {
    const [target] = getPromptTargets(
      [promptNode("Agent-1", "Agent", { displayName: "" })],
      [],
    );

    expect(target.label).toBe("Agent");
  });

  it("should_report_the_component_selected_on_the_canvas", () => {
    const targets = getPromptTargets(
      [
        promptNode("Agent-1", "Agent"),
        promptNode("Agent-2", "Agent", { selected: true }),
      ],
      [],
    );

    expect(targets.map((target) => target.selectedOnCanvas)).toEqual([
      false,
      true,
    ]);
  });
});

describe("isFieldFedByEdge", () => {
  it("should_ignore_edges_whose_handle_cannot_be_read", () => {
    const broken = {
      id: "edge-1",
      source: "a",
      target: "Agent-1",
      targetHandle: "{not json",
    } as EdgeType;

    expect(isFieldFedByEdge([broken], "Agent-1", "system_prompt")).toBe(false);
  });

  it("should_only_match_edges_into_that_component", () => {
    expect(
      isFieldFedByEdge(
        [edgeInto("Agent-2", "system_prompt")],
        "Agent-1",
        "system_prompt",
      ),
    ).toBe(false);
  });
});

describe("promptTargetKey", () => {
  it("should_join_the_component_and_the_field", () => {
    expect(
      promptTargetKey({ componentId: "Agent-1", fieldName: "system_prompt" }),
    ).toBe("Agent-1:system_prompt");
  });
});

describe("readPromptFieldValue", () => {
  const ref = { componentId: "Agent-1", fieldName: "system_prompt" };

  it("should_read_the_current_text", () => {
    expect(
      readPromptFieldValue(
        [promptNode("Agent-1", "Agent", { value: "Be brief." })],
        ref,
      ),
    ).toBe("Be brief.");
  });

  it("should_read_an_empty_field_as_an_empty_string", () => {
    expect(
      readPromptFieldValue(
        [promptNode("Agent-1", "Agent", { value: null })],
        ref,
      ),
    ).toBe("");
  });

  it("should_report_a_component_or_field_that_is_gone", () => {
    expect(readPromptFieldValue([], ref)).toBeUndefined();
    expect(
      readPromptFieldValue(
        [promptNode("Agent-1", "Agent", { field: "system_message" })],
        ref,
      ),
    ).toBeUndefined();
  });
});
