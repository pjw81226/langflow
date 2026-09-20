import type { AssistantMessage } from "../../assistant-panel.types";
import { getNextSteps } from "../next-steps";

// The panel passes i18next's t; here the key plus its interpolation is
// enough to assert which sentence lands in the composer.
const t = ((key: string, vars?: Record<string, unknown>) =>
  vars ? `${key}:${Object.values(vars).join(",")}` : key) as never;

function message(overrides: Partial<AssistantMessage>): AssistantMessage {
  return {
    id: "m1",
    role: "assistant",
    content: "",
    timestamp: new Date(),
    status: "complete",
    ...overrides,
  };
}

describe("getNextSteps", () => {
  it("offers nothing while a turn is still streaming", () => {
    expect(
      getNextSteps(message({ status: "streaming", mode: "component" }), t),
    ).toEqual([]);
  });

  it("offers nothing for a user message", () => {
    expect(getNextSteps(message({ role: "user", mode: "ask" }), t)).toEqual([]);
  });

  it("asks how to wire a written component to an agent", () => {
    const steps = getNextSteps(
      message({
        mode: "component",
        result: {
          content: "",
          validated: true,
          className: "EmailExtractorComponent",
        },
      }),
      t,
    );
    expect(steps).toHaveLength(1);
    expect(steps[0].action).toEqual({
      type: "prefill",
      mode: "ask",
      text: "assistant.nextSteps.connectAsToolText:EmailExtractorComponent",
    });
  });

  it("falls back to the generic sentence when the class name is missing", () => {
    const steps = getNextSteps(
      message({
        mode: "component",
        result: { content: "", validated: true },
      }),
      t,
    );
    expect(steps[0].action).toEqual({
      type: "prefill",
      mode: "ask",
      text: "assistant.nextSteps.connectAsToolTextGeneric",
    });
  });

  it("offers nothing for a component that failed validation", () => {
    expect(
      getNextSteps(
        message({
          mode: "component",
          result: { content: "", validated: false },
        }),
        t,
      ),
    ).toEqual([]);
  });

  it("offers a test run only once the prompt is applied", () => {
    const proposal = {
      newValue: "new",
      oldValue: "old",
      componentId: "Agent-1",
      componentName: "Agent",
      field: "system_prompt",
      fieldLabel: "Agent Instructions",
    };
    const pending = getNextSteps(
      message({ mode: "prompt", promptProposal: proposal }),
      t,
    );
    expect(pending.map((step) => step.id)).toEqual(["shorter"]);

    const applied = getNextSteps(
      message({
        mode: "prompt",
        promptProposal: { ...proposal, replacedValue: "old" },
      }),
      t,
    );
    expect(applied.map((step) => step.id)).toEqual(["shorter", "test-flow"]);
    expect(applied[1].action).toEqual({ type: "test_flow" });
  });

  it("asks where to paste a prompt that has no target", () => {
    const steps = getNextSteps(
      message({
        mode: "prompt",
        promptProposal: {
          newValue: "new",
          oldValue: null,
          componentId: null,
          componentName: null,
          field: null,
          fieldLabel: null,
        },
      }),
      t,
    );
    expect(steps.map((step) => step.id)).toEqual(["where-to-paste"]);
  });

  it("names the failing component when a test fails", () => {
    const steps = getNextSteps(
      message({
        action: "test_flow",
        testResult: {
          status: "failed",
          error: { component_name: "Agent" },
        },
      }),
      t,
    );
    expect(steps[0].action).toEqual({
      type: "prefill",
      mode: "ask",
      text: "assistant.nextSteps.whyFailedText:Agent",
    });
  });

  it("asks what to fill in when the test needs input", () => {
    const steps = getNextSteps(
      message({
        action: "test_flow",
        testResult: { status: "needs_attention" },
      }),
      t,
    );
    expect(steps.map((step) => step.id)).toEqual(["what-to-fill"]);
  });

  it("offers nothing after a passing test", () => {
    expect(
      getNextSteps(
        message({ action: "test_flow", testResult: { status: "passed" } }),
        t,
      ),
    ).toEqual([]);
  });

  it("offers nothing after an answer", () => {
    expect(getNextSteps(message({ mode: "ask" }), t)).toEqual([]);
  });
});
