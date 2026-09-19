import { fireEvent, render, screen } from "@testing-library/react";
import type { AgenticTestResult } from "@/controllers/API/queries/agentic";
import { AssistantTestResult } from "../assistant-test-result";

const FAILED: AgenticTestResult = {
  status: "failed",
  trigger: "build",
  duration_seconds: 3.24,
  error: {
    kind: "fixable",
    message: "NameError: name 'x' is not defined",
    component_name: "Parser",
  },
};

describe("AssistantTestResult", () => {
  it("should_say_a_passed_test_passed_and_how_long_it_ran", () => {
    render(
      <AssistantTestResult
        result={{ status: "passed", duration_seconds: 3.24 }}
        onTestAgain={jest.fn()}
      />,
    );

    expect(screen.getByText("Test passed")).toBeInTheDocument();
    expect(screen.getByText("Ran in 3.2s")).toBeInTheDocument();
    expect(screen.getByTestId("assistant-test-result")).toHaveAttribute(
      "data-status",
      "passed",
    );
  });

  it("should_say_when_a_fix_turn_made_it_pass", () => {
    render(<AssistantTestResult result={{ status: "passed", fixed: true }} />);

    expect(screen.getByText("Test passed after a fix")).toBeInTheDocument();
  });

  it("should_name_the_component_a_failure_happened_in", () => {
    render(<AssistantTestResult result={FAILED} />);

    expect(screen.getByText("Test failed")).toBeInTheDocument();
    expect(screen.getByText("Failed at: Parser")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Something in the flow is set up wrong. The assistant can try to fix it.",
      ),
    ).toBeInTheDocument();
  });

  it("should_keep_the_servers_english_message_under_details", () => {
    render(<AssistantTestResult result={FAILED} />);

    expect(screen.queryByText(/NameError/)).toBeNull();

    fireEvent.click(screen.getByTestId("assistant-test-result-details-toggle"));

    expect(screen.getByText(/NameError/)).toBeInTheDocument();
  });

  it("should_show_the_test_input_and_output_under_details", () => {
    render(
      <AssistantTestResult
        result={{
          status: "passed",
          probe_input: "Hello",
          output_preview: "Hi there!",
        }}
      />,
    );

    fireEvent.click(screen.getByTestId("assistant-test-result-details-toggle"));

    expect(screen.getByText("Test input")).toBeInTheDocument();
    expect(screen.getByText("Hello")).toBeInTheDocument();
    expect(screen.getByText("Hi there!")).toBeInTheDocument();
  });

  it("should_offer_a_fix_only_for_a_failure_the_assistant_can_change", () => {
    const onFix = jest.fn();
    const { rerender } = render(
      <AssistantTestResult result={FAILED} onFix={onFix} />,
    );
    fireEvent.click(screen.getByTestId("assistant-test-fix-button"));
    expect(onFix).toHaveBeenCalledTimes(1);

    rerender(
      <AssistantTestResult
        result={{
          status: "needs_attention",
          error: { kind: "external_resource", message: "Check your API key." },
        }}
        onFix={onFix}
      />,
    );

    expect(screen.queryByTestId("assistant-test-fix-button")).toBeNull();
    expect(screen.getByText("Needs your input to run")).toBeInTheDocument();
    expect(
      screen.getByText(/needs something only you can provide/),
    ).toBeInTheDocument();
  });

  it("should_fall_back_to_a_generic_explanation_for_an_unknown_error_kind", () => {
    render(
      <AssistantTestResult
        result={{ status: "failed", error: { kind: "quota_exceeded" } }}
      />,
    );

    expect(
      screen.getByText("The flow stopped with an error."),
    ).toBeInTheDocument();
  });

  it("should_invite_a_first_test_when_the_flow_was_not_run", () => {
    const onTestAgain = jest.fn();
    render(
      <AssistantTestResult
        result={{ status: "skipped", skipped_reason: "edit_not_verified" }}
        onTestAgain={onTestAgain}
      />,
    );

    expect(screen.getByText("Not tested yet")).toBeInTheDocument();
    expect(
      screen.getByText("This change has not been run yet."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Test flow" }));
    expect(onTestAgain).toHaveBeenCalledTimes(1);
  });

  it("should_offer_test_again_after_a_run", () => {
    render(<AssistantTestResult result={FAILED} onTestAgain={jest.fn()} />);

    expect(screen.getByRole("button", { name: "Test again" })).toBeEnabled();
  });

  it("should_disable_testing_and_say_why_when_the_flow_is_not_on_the_canvas", () => {
    render(
      <AssistantTestResult
        result={{ status: "skipped" }}
        onTestAgain={jest.fn()}
        testBlockedReason="Add the flow to the canvas before testing."
      />,
    );

    const button = screen.getByTestId("assistant-test-again-button");
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute(
      "title",
      "Add the flow to the canvas before testing.",
    );
  });

  it("should_disable_testing_on_a_card_that_is_no_longer_the_latest", () => {
    render(<AssistantTestResult result={FAILED} />);

    expect(screen.getByTestId("assistant-test-again-button")).toBeDisabled();
  });

  it("should_offer_the_playground_only_when_given_a_way_to_open_it", () => {
    const onOpenPlayground = jest.fn();
    const { rerender } = render(
      <AssistantTestResult result={{ status: "passed" }} />,
    );
    expect(screen.queryByTestId("assistant-test-playground-button")).toBeNull();

    rerender(
      <AssistantTestResult
        result={{ status: "passed" }}
        onOpenPlayground={onOpenPlayground}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open Playground" }));

    expect(onOpenPlayground).toHaveBeenCalledTimes(1);
  });
});
