import { act, renderHook } from "@testing-library/react";

import { useAssistantChat } from "../use-assistant-chat";

/**
 * Panel modes. "build" is the existing behaviour. "ask" is a read-only help
 * turn: the request says so, the messages remember it, and nothing that
 * arrives on that turn may change the canvas.
 */

jest.mock("@xyflow/react", () => ({
  useUpdateNodeInternals: () => () => {},
}));

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

jest.mock("@/hooks/flows/use-save-flow", () => ({
  __esModule: true,
  default: () => jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/stores/flowsManagerStore", () => {
  const fn = (selector: (state: { currentFlowId: string }) => unknown) =>
    selector({ currentFlowId: "test-flow-id" });
  fn.getState = () => ({ currentFlowId: "test-flow-id" });
  return { __esModule: true, default: fn };
});

const mockSetNodes = jest.fn();
const mockSetEdges = jest.fn();
const mockSetNodesAndEdges = jest.fn();
jest.mock("@/stores/flowStore", () => {
  const state = {
    nodes: [],
    edges: [],
    setNodes: (...args: unknown[]) => mockSetNodes(...args),
    setEdges: (...args: unknown[]) => mockSetEdges(...args),
    setNodesAndEdges: (...args: unknown[]) => mockSetNodesAndEdges(...args),
    paste: jest.fn(),
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

const SAMPLE_FLOW = {
  data: {
    nodes: [{ id: "ChatInput-1", data: { type: "ChatInput" } }],
    edges: [],
  },
};

type StreamCallbacks = Record<string, (event: unknown) => void>;

function streamOnce(emit: (callbacks: StreamCallbacks) => void) {
  mockPostAssistStream.mockImplementationOnce(
    async (_req: unknown, callbacks: StreamCallbacks) => emit(callbacks),
  );
}

function requestAt(index: number) {
  return mockPostAssistStream.mock.calls[index][0];
}

describe("useAssistantChat — panel mode", () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    mockPostAssistStream.mockResolvedValue(undefined);
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  describe("request and message tagging", () => {
    it("should_send_build_when_no_mode_is_given", async () => {
      const { result } = renderHook(() => useAssistantChat());

      await act(async () => {
        await result.current.handleSend("build a chatbot", TEST_MODEL);
      });

      expect(requestAt(0).mode).toBe("build");
      expect(result.current.messages.map((m) => m.mode)).toEqual([
        "build",
        "build",
      ]);
    });

    it("should_send_ask_and_tag_both_messages_of_the_turn", async () => {
      const { result } = renderHook(() => useAssistantChat());

      await act(async () => {
        await result.current.handleSend("what is an Agent?", TEST_MODEL, {
          mode: "ask",
        });
      });

      expect(requestAt(0).mode).toBe("ask");
      expect(result.current.messages.map((m) => [m.role, m.mode])).toEqual([
        ["user", "ask"],
        ["assistant", "ask"],
      ]);
    });

    it("should_retry_an_ask_turn_as_an_ask_turn", async () => {
      streamOnce((callbacks) =>
        callbacks.onError({ event: "error", message: "boom" }),
      );
      const { result } = renderHook(() => useAssistantChat());
      await act(async () => {
        await result.current.handleSend("what is an Agent?", TEST_MODEL, {
          mode: "ask",
        });
      });

      const failed = result.current.messages.find(
        (m) => m.role === "assistant",
      );
      await act(async () => {
        result.current.handleRetry(failed?.id ?? "", () => true);
      });

      expect(mockPostAssistStream).toHaveBeenCalledTimes(2);
      expect(requestAt(1).mode).toBe("ask");
    });
  });

  describe("an ask turn never changes the canvas", () => {
    it("should_ignore_a_flow_preview_event", async () => {
      streamOnce((callbacks) =>
        callbacks.onFlowPreview({
          event: "flow_preview",
          flow: SAMPLE_FLOW,
          name: "Sample",
          node_count: 1,
          edge_count: 0,
          graph: "",
        }),
      );
      const { result } = renderHook(() => useAssistantChat());

      await act(async () => {
        await result.current.handleSend("show me a flow", TEST_MODEL, {
          mode: "ask",
        });
      });

      expect(mockSetNodesAndEdges).not.toHaveBeenCalled();
      expect(mockSetNodes).not.toHaveBeenCalled();
      expect(
        result.current.messages.find((m) => m.role === "assistant")
          ?.flowPreview,
      ).toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(
        "[assistant] ignored flow_preview in ask mode",
      );
    });

    it.each([
      ["set_flow", { action: "set_flow", flow: SAMPLE_FLOW }],
      ["propose_plan", { action: "propose_plan", markdown: "Plan body" }],
      [
        "edit_field",
        {
          action: "edit_field",
          id: "edit-1",
          component_id: "Agent-1",
          field: "system_prompt",
          old_value: "a",
          new_value: "b",
        },
      ],
    ])("should_ignore_a_%s_flow_update", async (action, payload) => {
      streamOnce((callbacks) =>
        callbacks.onFlowUpdate({ event: "flow_update", ...payload }),
      );
      const { result } = renderHook(() => useAssistantChat());

      await act(async () => {
        await result.current.handleSend("what does this do?", TEST_MODEL, {
          mode: "ask",
        });
      });

      const assistant = result.current.messages.find(
        (m) => m.role === "assistant",
      );
      expect(mockSetNodesAndEdges).not.toHaveBeenCalled();
      expect(assistant?.pendingFlowProposal).toBeUndefined();
      expect(assistant?.pendingPlanProposal).toBeUndefined();
      expect(assistant?.flowActions).toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(
        `[assistant] ignored flow_update:${action} in ask mode`,
      );
    });

    it("should_ignore_a_tool_start_event", async () => {
      streamOnce((callbacks) =>
        callbacks.onToolStart({
          event: "tool_start",
          tool: "add_component",
          component_type: "ChatInput",
        }),
      );
      const { result } = renderHook(() => useAssistantChat());

      await act(async () => {
        await result.current.handleSend("what does this do?", TEST_MODEL, {
          mode: "ask",
        });
      });

      expect(
        result.current.messages.find((m) => m.role === "assistant")
          ?.inProgressTask,
      ).toBeUndefined();
    });

    it("should_not_offer_a_continuation", async () => {
      streamOnce((callbacks) =>
        callbacks.onComplete({
          event: "complete",
          data: {
            result: "An Agent picks tools.",
            validated: false,
            mode: "ask",
            continuation_expected: true,
          },
        }),
      );
      const { result } = renderHook(() => useAssistantChat());

      await act(async () => {
        await result.current.handleSend("what is an Agent?", TEST_MODEL, {
          mode: "ask",
        });
      });

      const assistant = result.current.messages.find(
        (m) => m.role === "assistant",
      );
      expect(assistant?.content).toBe("An Agent picks tools.");
      expect(assistant?.continuationExpected).toBe(false);
    });

    it("should_still_apply_the_same_events_on_a_build_turn", async () => {
      streamOnce((callbacks) =>
        callbacks.onFlowUpdate({
          event: "flow_update",
          action: "propose_plan",
          markdown: "Plan body",
        }),
      );
      const { result } = renderHook(() => useAssistantChat());

      await act(async () => {
        await result.current.handleSend("build a chatbot", TEST_MODEL, {
          mode: "build",
        });
      });

      expect(
        result.current.messages.find((m) => m.pendingPlanProposal),
      ).toBeDefined();
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });

  describe("plan refinement", () => {
    it("should_keep_a_dismissed_plan_for_the_next_build_turn_across_an_ask_turn", async () => {
      streamOnce((callbacks) => {
        callbacks.onFlowUpdate({
          event: "flow_update",
          action: "propose_plan",
          markdown: "Plan body",
        });
        callbacks.onComplete({
          event: "complete",
          data: { result: "", validated: true },
        });
      });
      const { result } = renderHook(() => useAssistantChat());
      await act(async () => {
        await result.current.handleSend("build a chatbot", TEST_MODEL);
      });
      const planMessage = result.current.messages.find(
        (m) => m.pendingPlanProposal,
      );
      act(() => {
        result.current.handleDismissPlan(planMessage?.id ?? "");
      });

      streamOnce((callbacks) =>
        callbacks.onComplete({
          event: "complete",
          data: { result: "It stores chat history.", validated: false },
        }),
      );
      await act(async () => {
        await result.current.handleSend("what is Memory?", TEST_MODEL, {
          mode: "ask",
        });
      });
      // The question goes out as typed; the plan is not spent on it.
      expect(requestAt(1).input_value).toBe("what is Memory?");

      await act(async () => {
        await result.current.handleSend("use Claude instead", TEST_MODEL);
      });
      expect(requestAt(2).input_value).toContain("Plan body");
      expect(requestAt(2).input_value).toContain("use Claude instead");
    });
  });
});
