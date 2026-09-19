import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PromptTarget } from "../../helpers/prompt-targets";
import { AssistantPromptTargetPicker } from "../assistant-prompt-target-picker";

jest.mock("@/components/common/genericIconComponent", () => {
  return function MockIcon({ name }: { name: string }) {
    return <span data-testid={`icon-${name}`} />;
  };
});

const AGENT: PromptTarget = {
  componentId: "Agent-1",
  fieldName: "system_prompt",
  label: "Agent",
  fieldLabel: "Agent Instructions",
  selectedOnCanvas: false,
};

const MODEL: PromptTarget = {
  componentId: "LM-1",
  fieldName: "system_message",
  label: "Language Model",
  fieldLabel: "System Message",
  selectedOnCanvas: false,
};

describe("AssistantPromptTargetPicker", () => {
  it("should_show_the_chosen_component_after_the_label", () => {
    render(
      <AssistantPromptTargetPicker
        targets={[AGENT, MODEL]}
        selected={MODEL}
        onSelect={jest.fn()}
      />,
    );

    expect(screen.getByTestId("assistant-prompt-target")).toHaveTextContent(
      "Apply to:",
    );
    expect(
      screen.getByRole("button", { name: "Component to apply the prompt to" }),
    ).toHaveTextContent("Language Model");
  });

  it("should_list_every_target_with_its_field_and_report_a_pick", async () => {
    const onSelect = jest.fn();
    render(
      <AssistantPromptTargetPicker
        targets={[AGENT, MODEL]}
        selected={AGENT}
        onSelect={onSelect}
      />,
    );

    await userEvent.click(
      screen.getByTestId("assistant-prompt-target-trigger"),
    );

    expect(
      screen.getByTestId("assistant-prompt-target-option-Agent-1"),
    ).toHaveTextContent("AgentAgent Instructions");
    expect(
      screen.getByTestId("assistant-prompt-target-option-Agent-1"),
    ).toHaveAttribute("aria-checked", "true");
    await userEvent.click(
      screen.getByTestId("assistant-prompt-target-option-LM-1"),
    );

    expect(onSelect).toHaveBeenCalledWith(MODEL);
  });

  it("should_keep_the_click_from_reaching_the_composer", () => {
    // The composer focuses its textarea on any click inside it.
    const onComposerClick = jest.fn();
    render(
      // biome-ignore lint/a11y/noStaticElementInteractions: test-only wrapper
      <div onClick={onComposerClick}>
        <AssistantPromptTargetPicker
          targets={[AGENT]}
          selected={AGENT}
          onSelect={jest.fn()}
        />
      </div>,
    );

    fireEvent.click(screen.getByTestId("assistant-prompt-target-trigger"));

    expect(onComposerClick).not.toHaveBeenCalled();
  });

  it("should_say_so_when_nothing_on_the_canvas_takes_a_prompt", () => {
    render(
      <AssistantPromptTargetPicker
        targets={[]}
        selected={null}
        onSelect={jest.fn()}
      />,
    );

    expect(
      screen.getByTestId("assistant-prompt-target-empty"),
    ).toHaveTextContent(
      "No agent or model on the canvas can take this prompt. You can still copy it.",
    );
    expect(screen.queryByTestId("assistant-prompt-target-trigger")).toBeNull();
  });

  it("should_disable_the_choice_when_asked_to", () => {
    render(
      <AssistantPromptTargetPicker
        targets={[AGENT]}
        selected={AGENT}
        onSelect={jest.fn()}
        disabled
      />,
    );

    expect(
      screen.getByTestId("assistant-prompt-target-trigger"),
    ).toBeDisabled();
  });
});
