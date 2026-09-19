import { act, renderHook } from "@testing-library/react";

import { useAssistantChat } from "../use-assistant-chat";

/**
 * Prompt turns: the request names the field the prompt is for and carries the
 * field's text as it is when the turn is sent. The proposed prompt lands in
 * the field only through Apply, and Undo puts the old text back.
 */

const mockPostAssistStream = jest.fn();
jest.mock("@/controllers/API/queries/agentic", () => ({
  postAssistStream: (...args: unknown[]) => mockPostAssistStream(...args),
}));

jest.mock(
  "@/controllers/API/queries/nodes/use-post-validate-component-code",
  () => ({
    usePostValidateComponentCode: () => ({ mutateAsync: jest.fn() }),
  }),
);

jest.mock("@/hooks/use-add-component", () => ({
  useAddComponent: () => jest.fn(),
}));

const mockSaveFlow = jest.fn();
jest.mock("@/hooks/flows/use-save-flow", () => ({
  __esModule: true,
  default: () => mockSaveFlow,
}));

const mockTakeSnapshot = jest.fn();
jest.mock("@/stores/flowsManagerStore", () => {
  const fn = (selector: (state: { currentFlowId: string }) => unknown) =>
    selector({ currentFlowId: "test-flow-id" });
  fn.getState = () => ({
    currentFlowId: "test-flow-id",
    takeSnapshot: mockTakeSnapshot,
  });
  return { __esModule: true, default: fn };
});

type MockNode = { id: string };
let mockNodes: MockNode[] = [];
let mockEdges: unknown[] = [];
const mockSetNode = jest.fn(
  (id: string, update: (old: MockNode) => MockNode) => {
    mockNodes = mockNodes.map((node) => (node.id === id ? update(node) : node));
  },
);
jest.mock("@/stores/flowStore", () => {
  const state = {
    get nodes() {
      return mockNodes;
    },
    get edges() {
      return mockEdges;
    },
    currentFlow: { id: "test-flow-id", locked: false },
    setNode: (...args: Parameters<typeof mockSetNode>) => mockSetNode(...args),
  };
  const fn = (selector?: (s: typeof state) => unknown) =>
    selector ? selector(state) : state;
  fn.getState = () => state;
  return { __esModule: true, default: fn };
});

jest.mock("short-unique-id", () => {
  let counter = 0;
  return class ShortUniqueId {
    randomUUID() {
      counter += 1;
      return `mock-uid-${counter}`;
    }
  };
});

const TEST_MODEL = {
  id: "openai/gpt-4",
  name: "gpt-4",
  provider: "openai",
  displayName: "GPT-4",
};

const TARGET = {
  componentId: "Agent-1",
  fieldName: "system_prompt",
  label: "Agent",
};

function agentWithPrompt(value: string | null) {
  return {
    id: "Agent-1",
    type: "genericNode",
    data: {
      id: "Agent-1",
      type: "Agent",
      node: {
        display_name: "Agent",
        template: { system_prompt: { show: true, value } },
      },
    },
  };
}

function promptValue(): unknown {
  const node = mockNodes[0] as ReturnType<typeof agentWithPrompt>;
  return node.data.node.template.system_prompt.value;
}

function requestAt(index: number) {
  return mockPostAssistStream.mock.calls[index][0];
}

type StreamCallbacks = Record<string, (event: unknown) => void>;

describe("useAssistantChat — prompt turns", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockNodes = [agentWithPrompt("You are a helpful assistant.")];
    mockEdges = [];
    mockSaveFlow.mockResolvedValue(undefined);
    mockPostAssistStream.mockResolvedValue(undefined);
  });

  it("should_send_the_target_and_the_fields_current_text", async () => {
    const { result } = renderHook(() => useAssistantChat());

    await act(async () => {
      await result.current.handleSend("be friendlier", TEST_MODEL, {
        mode: "prompt",
        promptTarget: TARGET,
      });
    });

    expect(requestAt(0)).toMatchObject({
      mode: "prompt",
      input_value: "be friendlier",
      component_id: "Agent-1",
      field_name: "system_prompt",
      field_value: "You are a helpful assistant.",
    });
    expect(result.current.messages.map((m) => m.promptTarget)).toEqual([
      TARGET,
      TARGET,
    ]);
  });

  it("should_send_an_empty_field_as_an_empty_string", async () => {
    mockNodes = [agentWithPrompt(null)];
    const { result } = renderHook(() => useAssistantChat());

    await act(async () => {
      await result.current.handleSend("write one", TEST_MODEL, {
        mode: "prompt",
        promptTarget: TARGET,
      });
    });

    expect(requestAt(0).field_value).toBe("");
  });

  it("should_send_no_target_when_nothing_was_chosen", async () => {
    const { result } = renderHook(() => useAssistantChat());

    await act(async () => {
      await result.current.handleSend("write a prompt", TEST_MODEL, {
        mode: "prompt",
      });
    });

    expect(requestAt(0).mode).toBe("prompt");
    expect(requestAt(0)).not.toHaveProperty("component_id");
    expect(requestAt(0)).not.toHaveProperty("field_name");
    expect(requestAt(0)).not.toHaveProperty("field_value");
    expect(mockSaveFlow).not.toHaveBeenCalled();
  });

  it("should_send_no_target_once_the_component_left_the_canvas", async () => {
    mockNodes = [];
    const { result } = renderHook(() => useAssistantChat());

    await act(async () => {
      await result.current.handleSend("be friendlier", TEST_MODEL, {
        mode: "prompt",
        promptTarget: TARGET,
      });
    });

    expect(requestAt(0)).not.toHaveProperty("component_id");
    expect(result.current.messages[0]).not.toHaveProperty("promptTarget");
  });

  it("should_ignore_a_target_on_other_turns", async () => {
    const { result } = renderHook(() => useAssistantChat());

    await act(async () => {
      await result.current.handleSend("what is an Agent?", TEST_MODEL, {
        mode: "ask",
        promptTarget: TARGET,
      });
    });

    expect(requestAt(0)).not.toHaveProperty("component_id");
    expect(mockSaveFlow).not.toHaveBeenCalled();
  });

  it("should_save_the_flow_before_sending", async () => {
    // The backend reads the rest of the flow from the database.
    const { result } = renderHook(() => useAssistantChat());

    await act(async () => {
      await result.current.handleSend("be friendlier", TEST_MODEL, {
        mode: "prompt",
        promptTarget: TARGET,
      });
    });

    expect(mockSaveFlow).toHaveBeenCalledTimes(1);
    expect(mockSaveFlow.mock.invocationCallOrder[0]).toBeLessThan(
      mockPostAssistStream.mock.invocationCallOrder[0],
    );
  });

  it("should_end_the_turn_when_the_flow_cannot_be_saved", async () => {
    mockSaveFlow.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useAssistantChat());

    await act(async () => {
      await result.current.handleSend("be friendlier", TEST_MODEL, {
        mode: "prompt",
        promptTarget: TARGET,
      });
    });

    expect(mockPostAssistStream).not.toHaveBeenCalled();
    expect(result.current.isProcessing).toBe(false);
    expect(result.current.messages[1]).toMatchObject({
      status: "error",
      error: "Failed to save flow",
    });
  });

  it("should_not_send_a_turn_stopped_while_the_flow_was_saving", async () => {
    let finishSave = () => {};
    mockSaveFlow.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishSave = resolve;
        }),
    );
    const { result } = renderHook(() => useAssistantChat());

    let sending: Promise<void> = Promise.resolve();
    await act(async () => {
      sending = result.current.handleSend("be friendlier", TEST_MODEL, {
        mode: "prompt",
        promptTarget: TARGET,
      });
    });
    act(() => {
      result.current.handleStopGeneration();
    });
    await act(async () => {
      finishSave();
      await sending;
    });

    expect(mockPostAssistStream).not.toHaveBeenCalled();
    expect(result.current.messages[1].status).toBe("cancelled");
    expect(result.current.isProcessing).toBe(false);
  });

  it("should_retry_for_the_same_target_with_the_text_it_has_now", async () => {
    mockPostAssistStream.mockImplementationOnce(
      async (_req: unknown, callbacks: StreamCallbacks) =>
        callbacks.onError({ event: "error", message: "boom" }),
    );
    const { result } = renderHook(() => useAssistantChat());
    await act(async () => {
      await result.current.handleSend("be friendlier", TEST_MODEL, {
        mode: "prompt",
        promptTarget: TARGET,
      });
    });
    mockNodes = [agentWithPrompt("Edited by hand.")];

    const failed = result.current.messages.find((m) => m.role === "assistant");
    await act(async () => {
      result.current.handleRetry(failed?.id ?? "", () => true);
    });

    expect(requestAt(1)).toMatchObject({
      mode: "prompt",
      input_value: "be friendlier",
      component_id: "Agent-1",
      field_name: "system_prompt",
      field_value: "Edited by hand.",
    });
  });
});

describe("useAssistantChat — proposed prompts", () => {
  const PROPOSAL = {
    new_value: "Answer in three bullet points.",
    old_value: "You are a helpful assistant.",
    component_id: "Agent-1",
    component_name: "Agent",
    field: "system_prompt",
    field_label: "Agent Instructions",
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockNodes = [agentWithPrompt("You are a helpful assistant.")];
    mockEdges = [];
    mockSaveFlow.mockResolvedValue(undefined);
    mockPostAssistStream.mockImplementation(
      async (_req: unknown, callbacks: StreamCallbacks) =>
        callbacks.onComplete({
          event: "complete",
          data: {
            result: "Here is a shorter prompt.",
            mode: "prompt",
            notices: [],
            prompt_proposal: PROPOSAL,
          },
        }),
    );
  });

  async function sendPromptTurn() {
    const rendered = renderHook(() => useAssistantChat());
    await act(async () => {
      await rendered.result.current.handleSend("be brief", TEST_MODEL, {
        mode: "prompt",
        promptTarget: TARGET,
      });
    });
    return rendered;
  }

  function reply(result: { current: ReturnType<typeof useAssistantChat> }) {
    return result.current.messages.find((m) => m.role === "assistant");
  }

  it("should_keep_the_proposal_on_the_reply_without_touching_the_canvas", async () => {
    const { result } = await sendPromptTurn();

    expect(reply(result)).toMatchObject({
      status: "complete",
      content: "Here is a shorter prompt.",
      promptProposal: {
        newValue: "Answer in three bullet points.",
        oldValue: "You are a helpful assistant.",
        componentId: "Agent-1",
        componentName: "Agent",
        field: "system_prompt",
        fieldLabel: "Agent Instructions",
      },
    });
    expect(mockSetNode).not.toHaveBeenCalled();
  });

  it("should_ignore_a_proposal_on_other_turns", async () => {
    const { result } = renderHook(() => useAssistantChat());
    await act(async () => {
      await result.current.handleSend("what is an Agent?", TEST_MODEL, {
        mode: "ask",
      });
    });

    expect(reply(result)?.promptProposal).toBeUndefined();
  });

  it("should_apply_after_a_snapshot_and_remember_what_it_replaced", async () => {
    const { result } = await sendPromptTurn();

    act(() => {
      result.current.handleApplyPrompt(reply(result)?.id ?? "");
    });

    expect(mockTakeSnapshot).toHaveBeenCalledTimes(1);
    expect(mockSetNode).toHaveBeenCalledWith("Agent-1", expect.any(Function));
    expect(promptValue()).toBe("Answer in three bullet points.");
    expect(reply(result)?.promptProposal?.replacedValue).toBe(
      "You are a helpful assistant.",
    );
  });

  it("should_undo_back_to_the_replaced_text", async () => {
    const { result } = await sendPromptTurn();
    act(() => {
      result.current.handleApplyPrompt(reply(result)?.id ?? "");
    });

    act(() => {
      result.current.handleUndoPrompt(reply(result)?.id ?? "");
    });

    expect(promptValue()).toBe("You are a helpful assistant.");
    expect(mockTakeSnapshot).toHaveBeenCalledTimes(2);
    expect(reply(result)?.promptProposal?.replacedValue).toBeUndefined();
  });

  it("should_refuse_to_apply_once_the_field_gets_a_connection", async () => {
    const { result } = await sendPromptTurn();
    mockEdges = [
      {
        id: "edge-1",
        source: "Prompt-1",
        target: "Agent-1",
        targetHandle: "{œfieldNameœ:œsystem_promptœ,œidœ:œAgent-1œ}",
      },
    ];

    act(() => {
      result.current.handleApplyPrompt(reply(result)?.id ?? "");
    });

    expect(mockSetNode).not.toHaveBeenCalled();
    expect(mockTakeSnapshot).not.toHaveBeenCalled();
    expect(promptValue()).toBe("You are a helpful assistant.");
    expect(reply(result)?.promptProposal?.replacedValue).toBeUndefined();
  });
});
