import { act, renderHook } from "@testing-library/react";

import { useAssistantChat } from "../use-assistant-chat";

/**
 * A manual click on the plan card's Continue sends a backend protocol string.
 * That string must reach the server unchanged, but the chat must not show it:
 * it is English-only and was never typed by the user.
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
const APPROVAL_SIGNAL = "User approved the plan. Proceed with the build.";
const APPROVAL_BUBBLE = "Plan approved. Go ahead and build it.";

type StreamCallbacks = Record<string, (event: unknown) => void>;

function proposePlanOnce() {
  mockPostAssistStream.mockImplementationOnce(
    async (_req: unknown, callbacks: StreamCallbacks) => {
      callbacks.onFlowUpdate({
        event: "flow_update",
        action: "propose_plan",
        markdown: "Plan body",
      });
      callbacks.onComplete({
        event: "complete",
        data: { result: "", validated: true },
      });
    },
  );
}

async function sendAndApprovePlan() {
  const hook = renderHook(() => useAssistantChat());
  await act(async () => {
    await hook.result.current.handleSend("build a chatbot", TEST_MODEL);
  });
  const planMessage = hook.result.current.messages.find(
    (m) => m.pendingPlanProposal,
  );
  await act(async () => {
    await hook.result.current.handleApprovePlan(planMessage?.id ?? "");
  });
  return hook;
}

describe("useAssistantChat — manual plan approval", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    mockPostAssistStream.mockResolvedValue(undefined);
  });

  it("should_show_a_localized_bubble_instead_of_the_protocol_string", async () => {
    proposePlanOnce();
    const { result } = await sendAndApprovePlan();

    const userContents = result.current.messages
      .filter((m) => m.role === "user")
      .map((m) => m.content);
    expect(userContents).toEqual(["build a chatbot", APPROVAL_BUBBLE]);
  });

  it("should_send_the_protocol_string_to_the_backend_unchanged", async () => {
    proposePlanOnce();
    await sendAndApprovePlan();

    expect(mockPostAssistStream).toHaveBeenCalledTimes(2);
    expect(mockPostAssistStream.mock.calls[1][0].input_value).toBe(
      APPROVAL_SIGNAL,
    );
  });

  it("should_resend_the_protocol_string_when_the_approved_turn_is_retried", async () => {
    proposePlanOnce();
    // The approved turn fails, which is what surfaces the Retry action.
    mockPostAssistStream.mockImplementationOnce(
      async (_req: unknown, callbacks: StreamCallbacks) => {
        callbacks.onError({ event: "error", message: "boom" });
      },
    );
    const { result } = await sendAndApprovePlan();

    const lastAssistant = [...result.current.messages]
      .reverse()
      .find((m) => m.role === "assistant");
    await act(async () => {
      result.current.handleRetry(lastAssistant?.id ?? "", () => true);
    });

    expect(mockPostAssistStream).toHaveBeenCalledTimes(3);
    expect(mockPostAssistStream.mock.calls[2][0].input_value).toBe(
      APPROVAL_SIGNAL,
    );
    const userContents = result.current.messages
      .filter((m) => m.role === "user")
      .map((m) => m.content);
    expect(userContents).not.toContain(APPROVAL_SIGNAL);
  });
});
