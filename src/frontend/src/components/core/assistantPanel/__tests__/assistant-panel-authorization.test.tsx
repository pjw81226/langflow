import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AssistantPanel } from "../assistant-panel";
import type { AssistantModel } from "../assistant-panel.types";

const SAVED_MODEL: AssistantModel = {
  id: "OpenAI-gpt-4o",
  name: "gpt-4o",
  provider: "OpenAI",
  displayName: "gpt-4o",
};

const mockHandleSend = jest.fn();
let mockCatalogReady = true;
let mockHasEnabledModels = true;
let mockModelAllowed = true;
let mockAllowCustomComponents = true;

const mockIsModelEnabled = (model: AssistantModel | null) =>
  mockModelAllowed &&
  model?.provider === SAVED_MODEL.provider &&
  model.name === SAVED_MODEL.name;

jest.mock("@/components/ui/sidebar", () => ({
  useSidebar: () => ({ open: false }),
}));

jest.mock("@/contexts/permissionsContext", () => ({
  useIsFlowReadOnly: () => false,
}));

jest.mock("@/stores/assistantManagerStore", () => ({
  __esModule: true,
  default: (selector: (state: { setAssistantDocked: jest.Mock }) => unknown) =>
    selector({ setAssistantDocked: jest.fn() }),
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
      allowCustomComponents: boolean;
      customComponentAdminOnly: boolean;
    }) => unknown,
  ) =>
    selector({
      agenticExperienceEnabled: true,
      assistantDockDefault: false,
      allowCustomComponents: mockAllowCustomComponents,
      customComponentAdminOnly: false,
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
  AssistantInput: ({
    onSend,
    disabled,
  }: {
    onSend: (content: string, model: AssistantModel | null) => void;
    disabled: boolean;
  }) => (
    <button
      type="button"
      data-testid="mock-assistant-send"
      disabled={disabled}
      onClick={() => onSend("direct message", SAVED_MODEL)}
    >
      Send
    </button>
  ),
}));

jest.mock("../hooks", () => ({
  useEnabledModels: () => ({
    hasEnabledModels: mockHasEnabledModels,
    isCatalogReady: mockCatalogReady,
    isLoading: !mockCatalogReady,
    isError: false,
    isModelEnabled: (model: AssistantModel | null) => mockIsModelEnabled(model),
  }),
  useAssistantChat: () => ({
    messages: [],
    sessionId: "session-1",
    isProcessing: false,
    currentStep: null,
    handleSend: mockHandleSend,
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

describe("AssistantPanel scoped model authorization", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    localStorage.setItem(
      "langflow-assistant-selected-model",
      JSON.stringify(SAVED_MODEL),
    );
    mockCatalogReady = true;
    mockHasEnabledModels = true;
    mockModelAllowed = true;
    mockAllowCustomComponents = true;
  });

  it("guards direct panel sends with current catalog membership", async () => {
    mockModelAllowed = false;
    const user = userEvent.setup();

    render(<AssistantPanel isOpen onClose={jest.fn()} />);

    // The real AssistantInput disables its own send button from the same
    // catalog hook. Invoke the mocked child anyway to verify the panel keeps
    // an independent authorization boundary around the callback.
    await user.click(screen.getByTestId("mock-assistant-send"));
    expect(mockHandleSend).not.toHaveBeenCalled();
  });

  it("renders the composer disabled while scoped policy is still loading", () => {
    mockCatalogReady = false;
    mockHasEnabledModels = false;

    render(<AssistantPanel isOpen onClose={jest.fn()} />);

    expect(screen.getByTestId("mock-assistant-send")).toBeDisabled();
    expect(screen.queryByTestId("assistant-no-models-state")).toBeNull();
  });

  describe("panel mode", () => {
    it("sends a typed message in the mode the panel was left in", async () => {
      localStorage.setItem("langflow-assistant-mode", "ask");
      const user = userEvent.setup();

      render(<AssistantPanel isOpen onClose={jest.fn()} />);
      await user.click(screen.getByTestId("mock-assistant-send"));

      expect(mockHandleSend).toHaveBeenCalledWith(
        "direct message",
        SAVED_MODEL,
        { mode: "ask" },
      );
    });

    it("defaults to a component turn when no mode was ever chosen", async () => {
      const user = userEvent.setup();

      render(<AssistantPanel isOpen onClose={jest.fn()} />);
      await user.click(screen.getByTestId("mock-assistant-send"));

      expect(mockHandleSend).toHaveBeenCalledWith(
        "direct message",
        SAVED_MODEL,
        { mode: "component" },
      );
    });

    it("sends a prompt turn instead where custom components are turned off", async () => {
      // The server would refuse a component turn; the stored choice stays.
      localStorage.setItem("langflow-assistant-mode", "component");
      mockAllowCustomComponents = false;
      const user = userEvent.setup();

      render(<AssistantPanel isOpen onClose={jest.fn()} />);
      await user.click(screen.getByTestId("mock-assistant-send"));

      expect(mockHandleSend).toHaveBeenCalledWith(
        "direct message",
        SAVED_MODEL,
        { mode: "prompt" },
      );
      expect(localStorage.getItem("langflow-assistant-mode")).toBe("component");
    });
  });

  describe("starter prompts", () => {
    it("shows examples for the current mode in an empty panel", () => {
      localStorage.setItem("langflow-assistant-mode", "ask");

      render(<AssistantPanel isOpen onClose={jest.fn()} />);

      expect(
        screen.getByTestId("assistant-starter-prompts"),
      ).toBeInTheDocument();
      expect(screen.getByText("What does this flow do?")).toBeInTheDocument();
    });

    it("disables the examples while nothing can be sent", () => {
      mockCatalogReady = false;

      render(<AssistantPanel isOpen onClose={jest.fn()} />);

      expect(
        screen.getByTestId("assistant-starter-component-0"),
      ).toBeDisabled();
    });
  });
});
