import { act, fireEvent, render, screen } from "@testing-library/react";
import useFlowStore from "@/stores/flowStore";
import type { AllNodeType, EdgeType, FlowType } from "@/types/flow";
import type { PromptProposal } from "../../assistant-panel.types";
import { AssistantPromptProposal } from "../assistant-prompt-proposal";

const PROPOSAL: PromptProposal = {
  newValue: "Answer in three bullet points.",
  oldValue: "Be helpful.",
  componentId: "Agent-1",
  componentName: "Agent",
  field: "system_prompt",
  fieldLabel: "Agent Instructions",
};

function agent(value: string): AllNodeType {
  return {
    id: "Agent-1",
    type: "genericNode",
    position: { x: 0, y: 0 },
    data: {
      id: "Agent-1",
      type: "Agent",
      node: {
        display_name: "Agent",
        template: { system_prompt: { show: true, value } },
      },
    },
  } as unknown as AllNodeType;
}

function setCanvas({
  nodes = [agent("Be helpful.")],
  edges = [],
  locked = false,
}: {
  nodes?: AllNodeType[];
  edges?: EdgeType[];
  locked?: boolean;
} = {}) {
  act(() => {
    useFlowStore.setState({
      nodes,
      edges,
      currentFlow: { id: "flow-1", locked } as FlowType,
    });
  });
}

describe("AssistantPromptProposal", () => {
  beforeEach(() => {
    setCanvas();
  });

  it("should_show_the_prompt_and_offer_apply_when_it_can_be_applied", () => {
    const onApply = jest.fn();
    render(<AssistantPromptProposal proposal={PROPOSAL} onApply={onApply} />);

    expect(screen.getByText("Proposed prompt")).toBeInTheDocument();
    expect(
      screen.getByText("For Agent (Agent Instructions)"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Answer in three bullet points."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("assistant-prompt-proposal-reason")).toBeNull();

    fireEvent.click(screen.getByTestId("assistant-prompt-proposal-apply"));

    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it("should_name_the_component_as_the_picker_showed_it", () => {
    render(
      <AssistantPromptProposal proposal={PROPOSAL} targetLabel="Agent 2" />,
    );

    expect(
      screen.getByText("For Agent 2 (Agent Instructions)"),
    ).toBeInTheDocument();
  });

  it("should_show_applied_and_offer_undo_once_applied", () => {
    setCanvas({ nodes: [agent(PROPOSAL.newValue)] });
    const onUndo = jest.fn();
    render(
      <AssistantPromptProposal
        proposal={{ ...PROPOSAL, replacedValue: "Be helpful." }}
        onUndo={onUndo}
      />,
    );

    expect(
      screen.getByTestId("assistant-prompt-proposal-applied"),
    ).toHaveTextContent("Applied");
    expect(screen.queryByTestId("assistant-prompt-proposal-apply")).toBeNull();

    fireEvent.click(screen.getByTestId("assistant-prompt-proposal-undo"));

    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it("should_offer_apply_again_when_the_field_changed_after_applying", () => {
    render(
      <AssistantPromptProposal
        proposal={{ ...PROPOSAL, replacedValue: "Be helpful." }}
      />,
    );

    expect(
      screen.getByTestId("assistant-prompt-proposal-apply"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("assistant-prompt-proposal-undo")).toBeNull();
  });

  it.each([
    [
      "copy only",
      { ...PROPOSAL, componentId: null, field: null, oldValue: null },
      {},
      "No component was chosen. Copy the prompt and paste it where you need it.",
    ],
    [
      "a removed component",
      PROPOSAL,
      { nodes: [] },
      "This component is no longer on the canvas. Copy the prompt instead.",
    ],
    [
      "a connected field",
      PROPOSAL,
      {
        edges: [
          {
            id: "edge-1",
            source: "Prompt-1",
            target: "Agent-1",
            targetHandle: "{œfieldNameœ:œsystem_promptœ,œidœ:œAgent-1œ}",
          } as EdgeType,
        ],
      },
      "This field now gets its value from a connection, so the prompt can't be applied.",
    ],
    [
      "a locked flow",
      PROPOSAL,
      { locked: true },
      "This flow is locked. Unlock it to apply the prompt.",
    ],
  ])(
    "should_explain_why_it_cannot_apply_%s",
    (_name, proposal, canvas, text) => {
      setCanvas(canvas);
      render(<AssistantPromptProposal proposal={proposal} />);

      expect(
        screen.getByTestId("assistant-prompt-proposal-reason"),
      ).toHaveTextContent(text);
      expect(
        screen.queryByTestId("assistant-prompt-proposal-apply"),
      ).toBeNull();
      expect(
        screen.getByTestId("assistant-prompt-proposal-copy"),
      ).toBeInTheDocument();
    },
  );

  it("should_react_when_the_field_gets_a_connection_after_the_turn", () => {
    render(<AssistantPromptProposal proposal={PROPOSAL} />);
    expect(
      screen.getByTestId("assistant-prompt-proposal-apply"),
    ).toBeInTheDocument();

    setCanvas({
      edges: [
        {
          id: "edge-1",
          source: "Prompt-1",
          target: "Agent-1",
          targetHandle: "{œfieldNameœ:œsystem_promptœ,œidœ:œAgent-1œ}",
        } as EdgeType,
      ],
    });

    expect(screen.queryByTestId("assistant-prompt-proposal-apply")).toBeNull();
  });

  it("should_tuck_the_current_prompt_behind_a_toggle", () => {
    render(<AssistantPromptProposal proposal={PROPOSAL} />);

    expect(screen.queryByText("Be helpful.")).toBeNull();
    fireEvent.click(screen.getByTestId("assistant-prompt-proposal-old-toggle"));

    expect(screen.getByText("Be helpful.")).toBeInTheDocument();
    expect(
      screen.getByTestId("assistant-prompt-proposal-old-toggle"),
    ).toHaveTextContent("Hide current prompt");
  });

  it("should_leave_the_toggle_out_when_the_field_was_empty", () => {
    render(
      <AssistantPromptProposal proposal={{ ...PROPOSAL, oldValue: "" }} />,
    );

    expect(
      screen.queryByTestId("assistant-prompt-proposal-old-toggle"),
    ).toBeNull();
  });

  describe("copy", () => {
    const originalClipboard = navigator.clipboard;

    afterEach(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: originalClipboard,
      });
      jest.useRealTimers();
    });

    it("should_copy_the_prompt_and_say_so_for_two_seconds", async () => {
      jest.useFakeTimers();
      const writeText = jest.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText },
      });
      render(<AssistantPromptProposal proposal={PROPOSAL} />);

      await act(async () => {
        fireEvent.click(screen.getByTestId("assistant-prompt-proposal-copy"));
      });

      expect(writeText).toHaveBeenCalledWith("Answer in three bullet points.");
      expect(
        screen.getByTestId("assistant-prompt-proposal-copy"),
      ).toHaveTextContent("Copied");

      act(() => {
        jest.advanceTimersByTime(2000);
      });

      expect(
        screen.getByTestId("assistant-prompt-proposal-copy"),
      ).toHaveTextContent("Copy");
    });

    it("should_not_break_where_the_clipboard_api_is_missing", async () => {
      // Plain-HTTP origins have no clipboard API.
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: undefined,
      });
      render(<AssistantPromptProposal proposal={PROPOSAL} />);

      await act(async () => {
        fireEvent.click(screen.getByTestId("assistant-prompt-proposal-copy"));
      });

      expect(
        screen.getByTestId("assistant-prompt-proposal-copy"),
      ).toHaveTextContent("Copy");
    });
  });
});
