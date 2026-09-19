import { act, renderHook } from "@testing-library/react";

import { useAssistantChat } from "../use-assistant-chat";

/**
 * The Test button. It is not a chat turn: the backend runs the canvas flow once
 * and answers with a structured result, which the panel renders as a card.
 */

jest.mock("@xyflow/react", () => ({
  useUpdateNodeInternals: () => () => {},
}));

const callOrder: string[] = [];
const mockPostAssistStream = jest.fn();
jest.mock("@/controllers/API/queries/agentic", () => ({
  postAssistStream: (...args: unknown[]) => {
    callOrder.push("send");
    return mockPostAssistStream(...args);
  },
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

jest.mock("@/stores/flowsManagerStore", () => {
  const fn = (selector: (state: { currentFlowId: string }) => unknown) =>
    selector({ currentFlowId: "test-flow-id" });
  fn.getState = () => ({ currentFlowId: "test-flow-id" });
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

type StreamCallbacks = Record<string, (event: unknown) => void>;

function completeWith(data: Record<string, unknown>) {
  mockPostAssistStream.mockImplementationOnce(
    async (_req: unknown, callbacks: StreamCallbacks) =>
      callbacks.onComplete({ event: "complete", data }),
  );
}

describe("useAssistantChat — test flow", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    callOrder.length = 0;
    localStorage.clear();
    mockPostAssistStream.mockResolvedValue(undefined);
    mockSaveFlow.mockImplementation(async () => {
      callOrder.push("save");
    });
  });

  it("should_save_the_flow_before_asking_the_backend_to_test_it", async () => {
    // The backend tests what it reads from the database.
    const { result } = renderHook(() => useAssistantChat());

    await act(async () => {
      await result.current.handleTestFlow(TEST_MODEL);
    });

    expect(callOrder).toEqual(["save", "send"]);
  });

  it("should_send_the_test_action_and_tag_the_turn", async () => {
    const { result } = renderHook(() => useAssistantChat());

    await act(async () => {
      await result.current.handleTestFlow(TEST_MODEL);
    });

    expect(mockPostAssistStream.mock.calls[0][0].action).toBe("test_flow");
    expect(result.current.messages.map((m) => [m.role, m.action])).toEqual([
      ["user", "test_flow"],
      ["assistant", "test_flow"],
    ]);
    expect(result.current.messages[0].content).toBe("Test flow");
  });

  it("should_show_the_result_as_a_card_instead_of_the_english_summary", async () => {
    const testResult = {
      status: "failed",
      trigger: "manual",
      error: {
        kind: "fixable",
        message: "NameError: x",
        component_name: "Parser",
      },
    };
    completeWith({
      result: "Flow test: failed in Parser. NameError: x",
      validated: false,
      test_result: testResult,
    });
    const { result } = renderHook(() => useAssistantChat());

    await act(async () => {
      await result.current.handleTestFlow(TEST_MODEL);
    });

    const reply = result.current.messages.find((m) => m.role === "assistant");
    expect(reply?.testResult).toEqual(testResult);
    expect(reply?.content).toBe("");
    expect(reply?.status).toBe("complete");
  });

  it("should_read_the_result_of_a_build_turn_and_drop_the_duplicate_caveat", async () => {
    completeWith({
      result: "Built the flow.\n\n⚠️ I couldn't fully run it here.",
      validated: false,
      has_flow: true,
      verified: false,
      verification_caveat: "I couldn't fully run it here.",
      test_result: {
        status: "needs_attention",
        error: { kind: "external_resource" },
      },
    });
    const { result } = renderHook(() => useAssistantChat());

    await act(async () => {
      await result.current.handleSend("build a chatbot", TEST_MODEL);
    });

    const reply = result.current.messages.find((m) => m.role === "assistant");
    expect(reply?.content).toBe("Built the flow.");
    expect(reply?.testResult?.status).toBe("needs_attention");
  });

  it("should_not_test_without_a_model_or_while_a_turn_is_running", async () => {
    const { result } = renderHook(() => useAssistantChat());

    await act(async () => {
      await result.current.handleTestFlow(null);
    });

    expect(mockSaveFlow).not.toHaveBeenCalled();
    expect(mockPostAssistStream).not.toHaveBeenCalled();
  });
});
