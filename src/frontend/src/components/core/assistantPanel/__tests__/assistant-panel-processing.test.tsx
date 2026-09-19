import { fireEvent, render } from "@testing-library/react";
import { AssistantPanel } from "../assistant-panel";
import type { AssistantMessage } from "../assistant-panel.types";

let mockIsProcessing = false;
let mockMessages: AssistantMessage[] = [];
const mockSetAssistantDocked = jest.fn();
let mockDockDefault = false;

jest.mock("@/components/ui/sidebar", () => ({
  useSidebar: () => ({ open: false }),
}));

jest.mock("@/contexts/permissionsContext", () => ({
  useIsFlowReadOnly: () => false,
}));

jest.mock("@/stores/assistantManagerStore", () => ({
  __esModule: true,
  default: (selector: (state: { setAssistantDocked: jest.Mock }) => unknown) =>
    selector({ setAssistantDocked: mockSetAssistantDocked }),
}));

jest.mock("@/stores/flowStore", () => ({
  __esModule: true,
  default: (selector: (state: { currentFlow: { id: string } }) => unknown) =>
    selector({ currentFlow: { id: "flow-1" } }),
}));

jest.mock("@/stores/utilityStore", () => ({
  useUtilityStore: (
    selector: (state: {
      agenticExperienceEnabled: boolean;
      assistantDockDefault: boolean;
    }) => unknown,
  ) =>
    selector({
      agenticExperienceEnabled: true,
      assistantDockDefault: mockDockDefault,
    }),
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
    handleTestFlow: jest.fn(),
    handleApprove: jest.fn(),
    handleAcknowledgeValidation: jest.fn(),
    handleRetry: jest.fn(),
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

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  mockIsProcessing = false;
  mockMessages = [];
  mockDockDefault = false;
  // The dock is only offered on a wide viewport.
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: 1440,
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
    // A stray click on the canvas must not hide the reply the user is waiting
    // on. The toggle button still closes the panel.
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

describe("AssistantPanel legacy settings", () => {
  it("should_clear_the_settings_of_removed_features_on_mount", () => {
    localStorage.setItem("langflow-assistant-skip-all", "true");
    localStorage.setItem("langflow-assistant-history-limit", "10");

    render(<AssistantPanel isOpen onClose={jest.fn()} />);

    expect(localStorage.getItem("langflow-assistant-skip-all")).toBeNull();
    expect(localStorage.getItem("langflow-assistant-history-limit")).toBeNull();
  });
});

describe("AssistantPanel docked layout", () => {
  it("should_float_by_default", () => {
    const { getByTestId } = render(
      <AssistantPanel isOpen onClose={jest.fn()} />,
    );

    expect(getByTestId("assistant-panel")).toHaveAttribute(
      "data-docked",
      "false",
    );
    expect(mockSetAssistantDocked).toHaveBeenLastCalledWith(false);
  });

  it("should_dock_when_the_user_chose_to", () => {
    localStorage.setItem("langflow-assistant-docked", "true");

    const { getByTestId } = render(
      <AssistantPanel isOpen onClose={jest.fn()} />,
    );

    const panel = getByTestId("assistant-panel");
    expect(panel).toHaveAttribute("data-docked", "true");
    // Part of the page layout, not an overlay.
    expect(panel.className).not.toContain("fixed");
    expect(mockSetAssistantDocked).toHaveBeenLastCalledWith(true);
  });

  it("should_dock_by_deployment_default_until_the_user_chooses", () => {
    mockDockDefault = true;

    const { getByTestId } = render(
      <AssistantPanel isOpen onClose={jest.fn()} />,
    );

    expect(getByTestId("assistant-panel")).toHaveAttribute(
      "data-docked",
      "true",
    );
  });

  it("should_let_the_users_choice_override_the_deployment_default", () => {
    mockDockDefault = true;
    localStorage.setItem("langflow-assistant-docked", "false");

    const { getByTestId } = render(
      <AssistantPanel isOpen onClose={jest.fn()} />,
    );

    expect(getByTestId("assistant-panel")).toHaveAttribute(
      "data-docked",
      "false",
    );
  });

  it("should_stay_open_when_the_canvas_is_clicked_while_docked", () => {
    localStorage.setItem("langflow-assistant-docked", "true");
    const onClose = jest.fn();
    render(<AssistantPanel isOpen onClose={onClose} />);

    fireEvent.pointerDown(document.body);

    expect(onClose).not.toHaveBeenCalled();
  });

  it("should_not_dock_on_a_narrow_viewport", () => {
    localStorage.setItem("langflow-assistant-docked", "true");
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 900,
    });

    const { getByTestId } = render(
      <AssistantPanel isOpen onClose={jest.fn()} />,
    );

    expect(getByTestId("assistant-panel")).toHaveAttribute(
      "data-docked",
      "false",
    );
  });

  it("should_offer_a_single_width_handle_while_docked", () => {
    localStorage.setItem("langflow-assistant-docked", "true");

    const { getByTestId, container } = render(
      <AssistantPanel isOpen onClose={jest.fn()} />,
    );

    expect(getByTestId("assistant-dock-resize-handle")).toBeInTheDocument();
    expect(container.querySelectorAll("[data-resize-handle]")).toHaveLength(1);
  });
});
