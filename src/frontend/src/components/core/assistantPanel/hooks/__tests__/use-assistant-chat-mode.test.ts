import { act, renderHook } from "@testing-library/react";

import { useAssistantChat } from "../use-assistant-chat";

/**
 * Panel modes: the request says which mode a turn was sent in, and both of
 * its messages remember it.
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

function streamOnce(emit: (callbacks: StreamCallbacks) => void) {
  mockPostAssistStream.mockImplementationOnce(
    async (_req: unknown, callbacks: StreamCallbacks) => emit(callbacks),
  );
}

function requestAt(index: number) {
  return mockPostAssistStream.mock.calls[index][0];
}

describe("useAssistantChat — panel mode", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    mockPostAssistStream.mockResolvedValue(undefined);
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
});
