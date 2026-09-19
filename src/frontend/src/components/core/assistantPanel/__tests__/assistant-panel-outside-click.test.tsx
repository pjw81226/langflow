import { fireEvent, render } from "@testing-library/react";
import { AssistantPanel } from "../assistant-panel";

let mockIsProcessing = false;

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
  ) => selector({ setAssistantProcessing: jest.fn() }),
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
    messages: [],
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

describe("AssistantPanel outside click", () => {
  beforeEach(() => {
    mockIsProcessing = false;
  });

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
