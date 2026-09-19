import { fireEvent, render } from "@testing-library/react";
import { AssistantPanel } from "../assistant-panel";
import type { AssistantMessage } from "../assistant-panel.types";

let mockIsProcessing = false;
let mockMessages: AssistantMessage[] = [];
const mockSetAssistantProcessing = jest.fn();

jest.mock("@/components/ui/sidebar", () => ({
  useSidebar: () => ({ open: false }),
}));

jest.mock("@/contexts/permissionsContext", () => ({
  useIsFlowReadOnly: () => false,
}));

jest.mock("@/stores/assistantManagerStore", () => ({
  __esModule: true,
  default: (
    selector: (state: { setAssistantProcessing: jest.Mock }) => unknown,
  ) => selector({ setAssistantProcessing: mockSetAssistantProcessing }),
}));

jest.mock("@/stores/flowBuilderWelcomeStore", () => ({
  __esModule: true,
  default: (
    selector: (state: {
      pendingMessage: string | null;
      clearPendingMessage: jest.Mock;
    }) => unknown,
  ) => selector({ pendingMessage: null, clearPendingMessage: jest.fn() }),
}));

jest.mock("@/stores/flowStore", () => ({
  __esModule: true,
  default: (selector: (state: { currentFlow: { id: string } }) => unknown) =>
    selector({ currentFlow: { id: "flow-1" } }),
}));

jest.mock("@/stores/utilityStore", () => ({
  useUtilityStore: (
    selector: (state: { agenticExperienceEnabled: boolean }) => unknown,
  ) => selector({ agenticExperienceEnabled: true }),
}));

jest.mock("use-stick-to-bottom", () => {
  const StickToBottom = ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  );
  StickToBottom.Content = ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  );
  return {
    StickToBottom,
    useStickToBottomContext: () => ({ scrollToBottom: jest.fn() }),
  };
});

jest.mock("../components/assistant-header", () => ({
  AssistantHeader: () => <div data-testid="assistant-header" />,
}));

jest.mock("../components/assistant-message", () => ({
  AssistantMessageItem: () => null,
}));

jest.mock("../components/assistant-disabled-state", () => ({
  AssistantDisabledState: () => <div data-testid="assistant-disabled-state" />,
}));

jest.mock("../components/assistant-no-models-state", () => ({
  AssistantNoModelsState: () => <div data-testid="assistant-no-models-state" />,
}));

jest.mock("../components/assistant-input", () => ({
  AssistantInput: () => <div data-testid="mock-assistant-input" />,
}));

jest.mock("../hooks", () => ({
  useEnabledModels: () => ({
    hasEnabledModels: true,
    isCatalogReady: true,
    isLoading: false,
    isError: false,
    isModelEnabled: () => true,
  }),
  useAssistantChat: () => ({
    messages: mockMessages,
    sessionId: "session-1",
    isProcessing: mockIsProcessing,
    currentStep: null,
    handleSend: jest.fn(),
    handleApprove: jest.fn(),
    handleUpdateFlowAction: jest.fn(),
    handleApplyFlowProposal: jest.fn(),
    handleRevertFlowProposal: jest.fn(),
    handleDismissFlowProposal: jest.fn(),
    handleApprovePlan: jest.fn(),
    handleDismissPlan: jest.fn(),
    handleResetPlan: jest.fn(),
    handleAcknowledgeValidation: jest.fn(),
    isRefiningPlan: false,
    skipAll: false,
    handleRetry: jest.fn(),
    handleMarkReverted: jest.fn(),
    handleStopGeneration: jest.fn(),
    handleClearHistory: jest.fn(),
    loadSession: jest.fn(),
  }),
  useSessionHistory: () => ({
    sessions: [],
    saveCurrentSession: jest.fn(),
    switchSession: jest.fn(),
    deleteSession: jest.fn(),
  }),
}));

function streamingReply(mode?: "build" | "ask"): AssistantMessage[] {
  return [
    {
      id: "user-1",
      role: "user",
      content: "hello",
      timestamp: new Date(),
      status: "complete",
      mode,
    },
    {
      id: "assistant-1",
      role: "assistant",
      content: "",
      timestamp: new Date(),
      status: "streaming",
      mode,
    },
  ];
}

beforeEach(() => {
  jest.clearAllMocks();
  mockIsProcessing = false;
  mockMessages = [];
});

describe("AssistantPanel canvas lock", () => {
  it("should_lock_the_canvas_while_a_build_turn_streams", () => {
    mockIsProcessing = true;
    mockMessages = streamingReply("build");

    render(<AssistantPanel isOpen onClose={jest.fn()} />);

    expect(mockSetAssistantProcessing).toHaveBeenLastCalledWith(true);
  });

  it("should_leave_the_canvas_editable_while_an_ask_turn_streams", () => {
    mockIsProcessing = true;
    mockMessages = streamingReply("ask");

    render(<AssistantPanel isOpen onClose={jest.fn()} />);

    expect(mockSetAssistantProcessing).toHaveBeenLastCalledWith(false);
    expect(mockSetAssistantProcessing).not.toHaveBeenCalledWith(true);
  });

  it("should_treat_a_turn_without_a_mode_as_a_build_turn", () => {
    // Sessions saved before modes existed.
    mockIsProcessing = true;
    mockMessages = streamingReply(undefined);

    render(<AssistantPanel isOpen onClose={jest.fn()} />);

    expect(mockSetAssistantProcessing).toHaveBeenLastCalledWith(true);
  });

  it("should_release_the_lock_when_the_panel_unmounts_mid_turn", () => {
    mockIsProcessing = true;
    mockMessages = streamingReply("build");

    const { unmount } = render(<AssistantPanel isOpen onClose={jest.fn()} />);
    unmount();

    expect(mockSetAssistantProcessing).toHaveBeenLastCalledWith(false);
  });
});

describe("AssistantPanel outside click", () => {
  it("should_close_when_the_canvas_is_clicked_while_idle", () => {
    const onClose = jest.fn();
    render(<AssistantPanel isOpen onClose={onClose} />);

    fireEvent.pointerDown(document.body);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("should_stay_open_when_the_canvas_is_clicked_during_a_turn", () => {
    // The canvas toggle is disabled while a turn runs, so closing here would
    // leave the hotkey as the only way back to the streaming reply.
    mockIsProcessing = true;
    const onClose = jest.fn();
    render(<AssistantPanel isOpen onClose={onClose} />);

    fireEvent.pointerDown(document.body);

    expect(onClose).not.toHaveBeenCalled();
  });

  it("should_stay_open_when_the_click_lands_inside_the_panel", () => {
    const onClose = jest.fn();
    const { getByTestId } = render(<AssistantPanel isOpen onClose={onClose} />);

    fireEvent.pointerDown(getByTestId("assistant-panel"));

    expect(onClose).not.toHaveBeenCalled();
  });
});
