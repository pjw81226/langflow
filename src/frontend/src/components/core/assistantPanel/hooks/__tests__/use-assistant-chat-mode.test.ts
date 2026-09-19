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

// Stands in for a translated UI, where ask turns carry the glossary.
const GLOSSARY = { Ask: "Preguntar" };
jest.mock("../../helpers/ui-glossary", () => ({
  buildUiGlossary: () => GLOSSARY,
}));

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
    it("should_send_ask_when_no_mode_is_given", async () => {
      const { result } = renderHook(() => useAssistantChat());

      await act(async () => {
        await result.current.handleSend("what is an Agent?", TEST_MODEL);
      });

      expect(requestAt(0).mode).toBe("ask");
      expect(result.current.messages.map((m) => m.mode)).toEqual([
        "ask",
        "ask",
      ]);
    });

    it.each(["component", "prompt", "ask"] as const)(
      "should_send_%s_and_tag_both_messages_of_the_turn",
      async (mode) => {
        const { result } = renderHook(() => useAssistantChat());

        await act(async () => {
          await result.current.handleSend("hello", TEST_MODEL, { mode });
        });

        expect(requestAt(0).mode).toBe(mode);
        expect(result.current.messages.map((m) => [m.role, m.mode])).toEqual([
          ["user", mode],
          ["assistant", mode],
        ]);
      },
    );

    it("should_send_the_ui_glossary_with_ask_turns_only", async () => {
      // Each turn has to finish before the next one can start.
      mockPostAssistStream.mockImplementation(
        async (_req: unknown, callbacks: StreamCallbacks) =>
          callbacks.onComplete({ event: "complete", data: { result: "ok" } }),
      );
      const { result } = renderHook(() => useAssistantChat());

      for (const mode of ["ask", "component", "prompt"] as const) {
        await act(async () => {
          await result.current.handleSend("hello", TEST_MODEL, { mode });
        });
      }

      expect(requestAt(0).ui_glossary).toEqual(GLOSSARY);
      expect(requestAt(1)).not.toHaveProperty("ui_glossary");
      expect(requestAt(2)).not.toHaveProperty("ui_glossary");
    });

    it("should_send_no_mode_with_a_test_turn", async () => {
      const { result } = renderHook(() => useAssistantChat());

      await act(async () => {
        await result.current.handleSend("Test flow", TEST_MODEL, {
          mode: "component",
          action: "test_flow",
        });
      });

      expect(requestAt(0).action).toBe("test_flow");
      expect(requestAt(0)).not.toHaveProperty("mode");
      expect(requestAt(0)).not.toHaveProperty("ui_glossary");
      expect(
        result.current.messages.map((m) => [m.role, m.mode, m.action]),
      ).toEqual([
        ["user", undefined, "test_flow"],
        ["assistant", undefined, "test_flow"],
      ]);
    });

    it.each(["component", "prompt", "ask"] as const)(
      "should_retry_a_%s_turn_in_the_same_mode",
      async (mode) => {
        streamOnce((callbacks) =>
          callbacks.onError({ event: "error", message: "boom" }),
        );
        const { result } = renderHook(() => useAssistantChat());
        await act(async () => {
          await result.current.handleSend("hello", TEST_MODEL, { mode });
        });

        const failed = result.current.messages.find(
          (m) => m.role === "assistant",
        );
        await act(async () => {
          result.current.handleRetry(failed?.id ?? "", () => true);
        });

        expect(mockPostAssistStream).toHaveBeenCalledTimes(2);
        expect(requestAt(1).mode).toBe(mode);
        expect(requestAt(1).input_value).toBe("hello");
      },
    );

    it("should_retry_a_test_turn_as_a_test_turn", async () => {
      streamOnce((callbacks) =>
        callbacks.onError({ event: "error", message: "boom" }),
      );
      const { result } = renderHook(() => useAssistantChat());
      await act(async () => {
        await result.current.handleSend("Test flow", TEST_MODEL, {
          action: "test_flow",
        });
      });

      const failed = result.current.messages.find(
        (m) => m.role === "assistant",
      );
      await act(async () => {
        result.current.handleRetry(failed?.id ?? "", () => true);
      });

      expect(requestAt(1).action).toBe("test_flow");
      expect(requestAt(1)).not.toHaveProperty("mode");
    });
  });
});
