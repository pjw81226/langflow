import { fireEvent, render, screen } from "@testing-library/react";
import useAuthStore from "@/stores/authStore";
import { useUtilityStore } from "@/stores/utilityStore";
import { AssistantModeSwitch } from "../assistant-mode-switch";

jest.mock("@/components/common/shadTooltipComponent", () => ({
  __esModule: true,
  default: ({
    children,
    content,
  }: {
    children: React.ReactNode;
    content: string;
  }) => <span data-tooltip={content}>{children}</span>,
}));

function setServer({
  allowCustomComponents = true,
  customComponentAdminOnly = false,
  isAdmin = false,
} = {}) {
  useUtilityStore.setState({ allowCustomComponents, customComponentAdminOnly });
  useAuthStore.setState({ isAdmin });
}

describe("AssistantModeSwitch", () => {
  beforeEach(() => {
    setServer();
  });

  it("should_render_a_labelled_radio_group_with_the_three_modes", () => {
    render(<AssistantModeSwitch mode="component" onChange={jest.fn()} />);

    expect(
      screen.getByRole("radiogroup", { name: "Assistant mode" }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("radio").map((radio) => radio.textContent),
    ).toEqual(["Component", "Prompt", "Ask"]);
    expect(screen.getByRole("radio", { name: "Component" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Prompt" })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "Ask" })).not.toBeChecked();
  });

  it("should_report_the_mode_that_is_clicked", () => {
    const onChange = jest.fn();
    render(<AssistantModeSwitch mode="component" onChange={onChange} />);

    fireEvent.click(screen.getByTestId("assistant-mode-prompt"));

    expect(onChange).toHaveBeenCalledWith("prompt");
  });

  it("should_not_report_a_click_on_the_mode_already_selected", () => {
    const onChange = jest.fn();
    render(<AssistantModeSwitch mode="ask" onChange={onChange} />);

    fireEvent.click(screen.getByTestId("assistant-mode-ask"));

    expect(onChange).not.toHaveBeenCalled();
  });

  it("should_keep_the_click_from_reaching_the_composer", () => {
    // The composer focuses its textarea on any click inside it.
    const onComposerClick = jest.fn();
    render(
      // biome-ignore lint/a11y/noStaticElementInteractions: test-only wrapper
      <div onClick={onComposerClick}>
        <AssistantModeSwitch mode="component" onChange={jest.fn()} />
      </div>,
    );

    fireEvent.click(screen.getByTestId("assistant-mode-ask"));

    expect(onComposerClick).not.toHaveBeenCalled();
  });

  it("should_be_one_tab_stop", () => {
    render(<AssistantModeSwitch mode="prompt" onChange={jest.fn()} />);

    expect(screen.getByTestId("assistant-mode-prompt")).toHaveAttribute(
      "tabindex",
      "0",
    );
    expect(screen.getByTestId("assistant-mode-component")).toHaveAttribute(
      "tabindex",
      "-1",
    );
    expect(screen.getByTestId("assistant-mode-ask")).toHaveAttribute(
      "tabindex",
      "-1",
    );
  });

  it.each([
    ["ArrowRight", "prompt"],
    ["ArrowDown", "prompt"],
    ["ArrowLeft", "ask"],
    ["ArrowUp", "ask"],
  ])("should_move_with_%s_and_wrap_around", (key, expected) => {
    const onChange = jest.fn();
    render(<AssistantModeSwitch mode="component" onChange={onChange} />);

    fireEvent.keyDown(screen.getByTestId("assistant-mode-component"), { key });

    expect(onChange).toHaveBeenCalledWith(expected);
  });

  it("should_wrap_from_the_last_mode_to_the_first", () => {
    const onChange = jest.fn();
    render(<AssistantModeSwitch mode="ask" onChange={onChange} />);

    fireEvent.keyDown(screen.getByTestId("assistant-mode-ask"), {
      key: "ArrowRight",
    });

    expect(onChange).toHaveBeenCalledWith("component");
  });

  it("should_move_the_focus_with_the_selection", () => {
    render(<AssistantModeSwitch mode="component" onChange={jest.fn()} />);
    screen.getByTestId("assistant-mode-component").focus();

    fireEvent.keyDown(screen.getByTestId("assistant-mode-component"), {
      key: "ArrowRight",
    });

    expect(screen.getByTestId("assistant-mode-prompt")).toHaveFocus();
  });

  it("should_disable_every_option_when_disabled", () => {
    const onChange = jest.fn();
    render(
      <AssistantModeSwitch mode="component" onChange={onChange} disabled />,
    );

    for (const radio of screen.getAllByRole("radio")) {
      expect(radio).toBeDisabled();
    }
    fireEvent.keyDown(screen.getByTestId("assistant-mode-component"), {
      key: "ArrowRight",
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  describe("when custom components are not allowed", () => {
    it("should_disable_component_and_say_they_are_turned_off", () => {
      setServer({ allowCustomComponents: false });
      render(<AssistantModeSwitch mode="prompt" onChange={jest.fn()} />);

      expect(screen.getByTestId("assistant-mode-component")).toBeDisabled();
      expect(screen.getByTestId("assistant-mode-prompt")).toBeEnabled();
      expect(
        screen.getByTestId("assistant-mode-component-blocked").parentElement,
      ).toHaveAttribute(
        "data-tooltip",
        "Custom components are turned off on this server.",
      );
    });

    it("should_say_only_administrators_can_create_them", () => {
      setServer({ customComponentAdminOnly: true, isAdmin: false });
      render(<AssistantModeSwitch mode="prompt" onChange={jest.fn()} />);

      expect(screen.getByTestId("assistant-mode-component")).toBeDisabled();
      expect(
        screen.getByTestId("assistant-mode-component-blocked").parentElement,
      ).toHaveAttribute(
        "data-tooltip",
        "Only administrators can create custom components on this server.",
      );
    });

    it("should_let_an_administrator_use_it_on_an_admin_only_server", () => {
      setServer({ customComponentAdminOnly: true, isAdmin: true });
      render(<AssistantModeSwitch mode="prompt" onChange={jest.fn()} />);

      expect(screen.getByTestId("assistant-mode-component")).toBeEnabled();
    });

    it("should_skip_it_in_arrow_key_navigation", () => {
      setServer({ allowCustomComponents: false });
      const onChange = jest.fn();
      render(<AssistantModeSwitch mode="ask" onChange={onChange} />);

      fireEvent.keyDown(screen.getByTestId("assistant-mode-ask"), {
        key: "ArrowRight",
      });

      expect(onChange).toHaveBeenCalledWith("prompt");
    });
  });
});
