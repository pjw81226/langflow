import { fireEvent, render, screen } from "@testing-library/react";
import { AssistantModeSwitch } from "../assistant-mode-switch";

jest.mock("@/components/common/shadTooltipComponent", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

describe("AssistantModeSwitch", () => {
  it("should_render_a_labelled_radio_group_with_both_modes", () => {
    render(<AssistantModeSwitch mode="build" onChange={jest.fn()} />);

    expect(
      screen.getByRole("radiogroup", { name: "Assistant mode" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Build" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Ask" })).not.toBeChecked();
  });

  it("should_report_the_other_mode_when_it_is_clicked", () => {
    const onChange = jest.fn();
    render(<AssistantModeSwitch mode="build" onChange={onChange} />);

    fireEvent.click(screen.getByTestId("assistant-mode-ask"));

    expect(onChange).toHaveBeenCalledWith("ask");
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
      // biome-ignore lint/a11y/useKeyWithClickEvents: test-only wrapper
      <div onClick={onComposerClick}>
        <AssistantModeSwitch mode="build" onChange={jest.fn()} />
      </div>,
    );

    fireEvent.click(screen.getByTestId("assistant-mode-ask"));

    expect(onComposerClick).not.toHaveBeenCalled();
  });

  it("should_switch_with_the_arrow_keys_and_be_one_tab_stop", () => {
    const onChange = jest.fn();
    render(<AssistantModeSwitch mode="build" onChange={onChange} />);

    expect(screen.getByTestId("assistant-mode-build")).toHaveAttribute(
      "tabindex",
      "0",
    );
    expect(screen.getByTestId("assistant-mode-ask")).toHaveAttribute(
      "tabindex",
      "-1",
    );

    fireEvent.keyDown(screen.getByTestId("assistant-mode-build"), {
      key: "ArrowRight",
    });

    expect(onChange).toHaveBeenCalledWith("ask");
  });

  it("should_disable_both_options_when_disabled", () => {
    render(<AssistantModeSwitch mode="build" onChange={jest.fn()} disabled />);

    expect(screen.getByTestId("assistant-mode-build")).toBeDisabled();
    expect(screen.getByTestId("assistant-mode-ask")).toBeDisabled();
  });
});
