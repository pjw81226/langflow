import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AssistantHeader } from "../assistant-header";

jest.mock("@/components/common/genericIconComponent", () => {
  return function MockIcon({ name }: { name: string }) {
    return <span data-testid={`icon-${name}`} />;
  };
});

describe("AssistantHeader", () => {
  const defaultProps = {
    onClose: jest.fn(),
    onNewSession: jest.fn(),
    hasMessages: false,
    sessions: [],
    activeSessionId: "test-session",
    onSelectSession: jest.fn(),
    onDeleteSession: jest.fn(),
    isExpanded: false,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("rendering", () => {
    it("should display 'Langflow Assistant' title", () => {
      render(<AssistantHeader {...defaultProps} />);

      expect(screen.getByText("Langflow Assistant")).toBeInTheDocument();
    });

    it("should render New session button", () => {
      render(<AssistantHeader {...defaultProps} />);

      expect(
        screen.getByRole("button", { name: /new session/i }),
      ).toBeInTheDocument();
    });
  });

  describe("New session button", () => {
    it("should be disabled when hasMessages is false", () => {
      render(<AssistantHeader {...defaultProps} hasMessages={false} />);

      expect(
        screen.getByRole("button", { name: /new session/i }),
      ).toBeDisabled();
    });

    it("should be enabled when hasMessages is true", () => {
      render(<AssistantHeader {...defaultProps} hasMessages={true} />);

      expect(
        screen.getByRole("button", { name: /new session/i }),
      ).toBeEnabled();
    });

    it("should call onNewSession when clicked", async () => {
      const onNewSession = jest.fn();
      render(
        <AssistantHeader
          {...defaultProps}
          hasMessages={true}
          onNewSession={onNewSession}
        />,
      );

      await userEvent.click(
        screen.getByRole("button", { name: /new session/i }),
      );

      expect(onNewSession).toHaveBeenCalledTimes(1);
    });
  });

  describe("skip-all badge", () => {
    it("should_not_render_skip_all_badge_when_skipAll_is_false", () => {
      render(<AssistantHeader {...defaultProps} skipAll={false} />);
      expect(
        screen.queryByTestId("assistant-skip-all-badge"),
      ).not.toBeInTheDocument();
    });

    it("should_render_skip_all_badge_when_skipAll_is_true", () => {
      // Badge sits next to the title to remind the user that gates are
      // being auto-approved — without it, skip-all is invisible after the
      // toggle's inline message scrolls out of view.
      render(<AssistantHeader {...defaultProps} skipAll={true} />);
      expect(
        screen.getByTestId("assistant-skip-all-badge"),
      ).toBeInTheDocument();
    });
  });

  describe("dock controls", () => {
    it("should_not_offer_docking_when_the_viewport_cannot_fit_it", () => {
      render(
        <AssistantHeader
          {...defaultProps}
          canDock={false}
          onToggleDock={jest.fn()}
        />,
      );

      expect(screen.queryByTestId("assistant-dock-toggle")).toBeNull();
    });

    it("should_offer_to_dock_a_floating_panel", async () => {
      const onToggleDock = jest.fn();
      const user = userEvent.setup();
      render(
        <AssistantHeader
          {...defaultProps}
          canDock
          onToggleDock={onToggleDock}
        />,
      );

      const toggle = screen.getByRole("button", { name: "Dock to the side" });
      expect(toggle).toHaveAttribute("aria-pressed", "false");
      await user.click(toggle);

      expect(onToggleDock).toHaveBeenCalledTimes(1);
    });

    it("should_offer_to_float_a_docked_panel", () => {
      render(
        <AssistantHeader
          {...defaultProps}
          canDock
          isDocked
          onToggleDock={jest.fn()}
        />,
      );

      expect(
        screen.getByRole("button", { name: "Float over the canvas" }),
      ).toHaveAttribute("aria-pressed", "true");
    });

    it("should_show_a_close_button_only_while_docked", async () => {
      // A floating panel closes on an outside click; a docked one cannot.
      const onClose = jest.fn();
      const user = userEvent.setup();
      const { rerender } = render(
        <AssistantHeader {...defaultProps} onClose={onClose} canDock />,
      );
      expect(screen.queryByTestId("assistant-close")).toBeNull();

      rerender(
        <AssistantHeader
          {...defaultProps}
          onClose={onClose}
          canDock
          isDocked
        />,
      );
      await user.click(screen.getByRole("button", { name: "Close assistant" }));

      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });
});
