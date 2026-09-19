import { fireEvent, render, screen } from "@testing-library/react";
import { AssistantStarterPrompts } from "../assistant-starter-prompts";

describe("AssistantStarterPrompts", () => {
  it("should_offer_things_to_build_in_build_mode", () => {
    render(
      <AssistantStarterPrompts
        mode="build"
        variant="expanded"
        onSelect={jest.fn()}
      />,
    );

    expect(screen.getByText("What do you want to build?")).toBeInTheDocument();
    expect(
      screen.getByRole("list", { name: "Example prompts" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(3);
    expect(
      screen.getByText("Build a chatbot that answers questions from my PDF"),
    ).toBeInTheDocument();
  });

  it("should_offer_things_to_ask_in_ask_mode", () => {
    render(
      <AssistantStarterPrompts
        mode="ask"
        variant="expanded"
        onSelect={jest.fn()}
      />,
    );

    expect(screen.getByText("What do you want to know?")).toBeInTheDocument();
    expect(screen.getByText("What does this flow do?")).toBeInTheDocument();
    expect(
      screen.queryByText("Build a chatbot that answers questions from my PDF"),
    ).toBeNull();
  });

  it("should_hand_over_the_translated_example_when_one_is_picked", () => {
    const onSelect = jest.fn();
    render(
      <AssistantStarterPrompts
        mode="ask"
        variant="compact"
        onSelect={onSelect}
      />,
    );

    fireEvent.click(screen.getByTestId("assistant-starter-ask-1"));

    expect(onSelect).toHaveBeenCalledWith(
      "How do I connect a file to the agent?",
    );
  });

  it("should_leave_the_title_out_of_the_compact_panel", () => {
    render(
      <AssistantStarterPrompts
        mode="build"
        variant="compact"
        onSelect={jest.fn()}
      />,
    );

    expect(screen.queryByText("What do you want to build?")).toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(3);
  });

  it("should_disable_the_examples_when_nothing_can_be_sent", () => {
    render(
      <AssistantStarterPrompts
        mode="build"
        variant="compact"
        disabled
        onSelect={jest.fn()}
      />,
    );

    for (const button of screen.getAllByRole("button")) {
      expect(button).toBeDisabled();
    }
  });
});
