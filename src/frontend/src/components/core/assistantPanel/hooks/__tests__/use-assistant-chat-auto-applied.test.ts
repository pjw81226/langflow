import { act, renderHook } from "@testing-library/react";
import { useUtilityStore } from "@/stores/utilityStore";

import { useAssistantChat } from "../use-assistant-chat";

/**
 * Auto-apply puts a flow on the canvas without asking. That is only acceptable
 * if the way back is one click away, including on an empty canvas, where the
 * server has no restore point to offer.
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

const PRE_APPLY_NODES = [{ id: "Existing-1" }];
const mockSetNodesAndEdges = jest.fn();
jest.mock("@/stores/flowStore", () => {
  const state = {
    nodes: [{ id: "Existing-1" }],
    edges: [],
    setNodes: jest.fn(),
    setEdges: jest.fn(),
    setNodesAndEdges: (...args: unknown[]) => mockSetNodesAndEdges(...args),
    paste: jest.fn(),
    reactFlowInstance: null,
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
const SKIP_ALL_KEY = "langflow-assistant-skip-all";
const BUILT_FLOW = {
  name: "PDF chatbot",
  data: {
    nodes: [
      { id: "ChatInput-1", data: { type: "ChatInput" } },
      { id: "ChatOutput-1", data: { type: "ChatOutput" } },
    ],
    edges: [{ id: "e1", source: "ChatInput-1", target: "ChatOutput-1" }],
  },
};

type StreamCallbacks = Record<string, (event: unknown) => void>;

function buildTurn(setFlowEvents = 1) {
  mockPostAssistStream.mockImplementationOnce(
    async (_req: unknown, callbacks: StreamCallbacks) => {
      for (let i = 0; i < setFlowEvents; i++) {
        callbacks.onFlowUpdate({
          event: "flow_update",
          action: "set_flow",
          flow: BUILT_FLOW,
        });
      }
      callbacks.onComplete({
        event: "complete",
        data: { result: "Built it.", validated: true, has_flow: true },
      });
    },
  );
}

describe("useAssistantChat — auto-applied flows", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    useUtilityStore.setState({ assistantAutoApplyDefault: false });
    mockPostAssistStream.mockResolvedValue(undefined);
  });

  describe("deployment default", () => {
    it("should_follow_the_deployment_default_until_the_user_chooses", () => {
      useUtilityStore.setState({ assistantAutoApplyDefault: true });

      const { result } = renderHook(() => useAssistantChat());

      expect(result.current.skipAll).toBe(true);
      // A default is not a choice: nothing is written for the user.
      expect(localStorage.getItem(SKIP_ALL_KEY)).toBeNull();
    });

    it("should_pick_up_a_default_that_arrives_after_mount", () => {
      const { result } = renderHook(() => useAssistantChat());
      expect(result.current.skipAll).toBe(false);

      act(() => useUtilityStore.setState({ assistantAutoApplyDefault: true }));

      expect(result.current.skipAll).toBe(true);
    });

    it("should_keep_an_explicit_off_against_a_default_of_on", () => {
      useUtilityStore.setState({ assistantAutoApplyDefault: true });
      const first = renderHook(() => useAssistantChat());
      act(() => first.result.current.toggleSkipAll());
      expect(first.result.current.skipAll).toBe(false);
      first.unmount();

      // Turning it off removes the stored value; the marker is what remembers.
      const second = renderHook(() => useAssistantChat());

      expect(second.result.current.skipAll).toBe(false);
    });

    it("should_treat_a_user_who_enabled_it_before_the_marker_existed_as_having_chosen", () => {
      localStorage.setItem(SKIP_ALL_KEY, "true");
      useUtilityStore.setState({ assistantAutoApplyDefault: false });

      const { result } = renderHook(() => useAssistantChat());

      expect(result.current.skipAll).toBe(true);
    });
  });

  describe("the way back", () => {
    it("should_keep_the_pre_apply_canvas_and_an_applied_card", async () => {
      localStorage.setItem(SKIP_ALL_KEY, "true");
      buildTurn();
      const { result } = renderHook(() => useAssistantChat());

      await act(async () => {
        await result.current.handleSend("build a PDF chatbot", TEST_MODEL);
      });

      const reply = result.current.messages.find((m) => m.role === "assistant");
      expect(reply?.autoAppliedFlow).toEqual({
        flow: BUILT_FLOW,
        name: "PDF chatbot",
        nodeCount: 2,
        edgeCount: 1,
      });
      expect(reply?.flowProposalSnapshot?.nodes).toEqual(PRE_APPLY_NODES);
      // It was applied, not proposed.
      expect(reply?.pendingFlowProposal).toBeUndefined();
    });

    it("should_snapshot_the_canvas_only_before_the_first_flow_of_the_turn", async () => {
      // A fix turn emits another set_flow; by then the canvas holds the first one.
      localStorage.setItem(SKIP_ALL_KEY, "true");
      buildTurn(2);
      const { result } = renderHook(() => useAssistantChat());

      await act(async () => {
        await result.current.handleSend("build a PDF chatbot", TEST_MODEL);
      });

      const reply = result.current.messages.find((m) => m.role === "assistant");
      expect(reply?.flowProposalSnapshot?.nodes).toEqual(PRE_APPLY_NODES);
    });

    it("should_restore_the_canvas_and_turn_the_flow_into_a_proposal_on_revert", async () => {
      localStorage.setItem(SKIP_ALL_KEY, "true");
      buildTurn();
      const { result } = renderHook(() => useAssistantChat());
      await act(async () => {
        await result.current.handleSend("build a PDF chatbot", TEST_MODEL);
      });
      const reply = result.current.messages.find((m) => m.role === "assistant");
      mockSetNodesAndEdges.mockClear();

      act(() => result.current.handleRevertAutoApplied(reply?.id ?? ""));

      expect(mockSetNodesAndEdges).toHaveBeenCalledWith(PRE_APPLY_NODES, []);
      const reverted = result.current.messages.find(
        (m) => m.role === "assistant",
      );
      expect(reverted?.autoAppliedFlow).toBeUndefined();
      expect(reverted?.flowProposalSnapshot).toBeUndefined();
      // Still there for the taking, this time by choice.
      expect(reverted?.flowProposalStatus).toBe("pending");
      expect(reverted?.pendingFlowProposal?.flow).toEqual(BUILT_FLOW);
    });

    it("should_do_the_same_for_a_flow_the_backend_marked_auto_apply", async () => {
      mockPostAssistStream.mockImplementationOnce(
        async (_req: unknown, callbacks: StreamCallbacks) => {
          callbacks.onFlowUpdate({
            event: "flow_update",
            action: "set_flow",
            flow: BUILT_FLOW,
            auto_apply: true,
          });
        },
      );
      const { result } = renderHook(() => useAssistantChat());

      await act(async () => {
        await result.current.handleSend("build it and run it", TEST_MODEL);
      });

      const reply = result.current.messages.find((m) => m.role === "assistant");
      expect(reply?.autoAppliedFlow?.nodeCount).toBe(2);
      expect(reply?.flowProposalSnapshot).toBeDefined();
    });

    it("should_tell_the_backend_that_flows_are_applied_without_asking", async () => {
      // Otherwise the agent narrates the flow as "proposed, awaiting approval".
      localStorage.setItem(SKIP_ALL_KEY, "true");
      const { result } = renderHook(() => useAssistantChat());

      await act(async () => {
        await result.current.handleSend("build a PDF chatbot", TEST_MODEL);
      });

      expect(mockPostAssistStream.mock.calls[0][0].auto_apply).toBe(true);
    });

    it("should_not_claim_auto_apply_when_the_panel_still_asks", async () => {
      const { result } = renderHook(() => useAssistantChat());

      await act(async () => {
        await result.current.handleSend("build a PDF chatbot", TEST_MODEL);
      });

      expect(mockPostAssistStream.mock.calls[0][0].auto_apply).toBeUndefined();
    });

    it("should_still_propose_instead_of_applying_when_auto_apply_is_off", async () => {
      buildTurn();
      const { result } = renderHook(() => useAssistantChat());

      await act(async () => {
        await result.current.handleSend("build a PDF chatbot", TEST_MODEL);
      });

      const reply = result.current.messages.find((m) => m.role === "assistant");
      expect(reply?.autoAppliedFlow).toBeUndefined();
      expect(reply?.pendingFlowProposal).toBeDefined();
    });
  });
});
