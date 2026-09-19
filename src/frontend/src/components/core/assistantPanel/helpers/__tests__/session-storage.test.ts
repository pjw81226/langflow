import type {
  AssistantMessage,
  SerializedAssistantMessage,
} from "../../assistant-panel.types";
import { deserializeMessages, serializeMessages } from "../session-storage";

function makeMessage(
  overrides: Partial<AssistantMessage> = {},
): AssistantMessage {
  return {
    id: "msg-1",
    role: "assistant",
    content: "working on it",
    timestamp: new Date("2026-07-08T12:00:00.000Z"),
    ...overrides,
  };
}

describe("serializeMessages", () => {
  it("should strip the transient progress and cancel a streaming message", () => {
    const serialized = serializeMessages([
      makeMessage({
        status: "streaming",
        progress: { step: "generating_component", attempt: 1, maxAttempts: 3 },
      }),
    ]);

    expect(serialized[0]).not.toHaveProperty("progress");
    expect(serialized[0].status).toBe("cancelled");
  });

  it("should keep everything else a finished turn shows", () => {
    const message = makeMessage({
      status: "complete",
      mode: "ask",
      notices: [{ type: "model_fallback", reason: "quota" }],
      usage: { total_tokens: 12 },
      validationAcknowledged: true,
    });

    const [serialized] = serializeMessages([message]);

    expect(serialized).toMatchObject({
      status: "complete",
      mode: "ask",
      notices: [{ type: "model_fallback", reason: "quota" }],
      usage: { total_tokens: 12 },
      validationAcknowledged: true,
      timestamp: "2026-07-08T12:00:00.000Z",
    });
  });
});

describe("deserializeMessages", () => {
  it("should drop the fields of removed features from an old session", () => {
    // Sessions saved before plans, flow proposals, build tasks, file cards
    // and restore points were removed still carry their fields.
    const legacy = {
      id: "msg-1",
      role: "assistant",
      content: "Built the flow.",
      status: "complete",
      timestamp: "2026-07-08T12:00:00.000Z",
      flowPreview: { flow: {}, name: "Flow", nodeCount: 1, edgeCount: 0 },
      flowActions: [{ id: "edit-1" }],
      continuationExpected: true,
      pendingFlowProposal: { flow: {}, nodeCount: 1, edgeCount: 0 },
      autoAppliedFlow: { flow: {}, nodeCount: 1, edgeCount: 0 },
      flowProposalStatus: "applied",
      flowProposalSnapshot: { nodes: [], edges: [] },
      pendingPlanProposal: { markdown: "## Plan" },
      planProposalStatus: "pending",
      writtenFiles: [{ path: "DOCS.md" }],
      buildTasks: [{ action: "add_component" }],
      inProgressTask: { tool: "add_component" },
      hidden: true,
      restoreVersionId: "ver-1",
      reverted: false,
      wireContent: "User approved the plan.",
    } as unknown as SerializedAssistantMessage;

    const [restored] = deserializeMessages([legacy]);

    expect(Object.keys(restored).sort()).toEqual(
      ["content", "id", "role", "status", "timestamp"].sort(),
    );
    expect(restored.timestamp).toEqual(new Date("2026-07-08T12:00:00.000Z"));
  });

  it("should_drop_the_build_mode_of_a_turn_from_before_the_mode_split", () => {
    const legacy = {
      id: "msg-1",
      role: "user",
      content: "Build a chatbot",
      status: "complete",
      mode: "build",
      timestamp: "2026-07-08T12:00:00.000Z",
    } as unknown as SerializedAssistantMessage;

    const [restored] = deserializeMessages([legacy]);

    expect(restored).not.toHaveProperty("mode");
    expect(restored.content).toBe("Build a chatbot");
  });

  it.each(["component", "prompt", "ask"] as const)(
    "should_keep_the_%s_mode",
    (mode) => {
      const [restored] = deserializeMessages(
        serializeMessages([makeMessage({ mode })]),
      );

      expect(restored.mode).toBe(mode);
    },
  );

  it("round-trips a current message unchanged", () => {
    const message = makeMessage({ status: "complete", mode: "prompt" });

    const [restored] = deserializeMessages(serializeMessages([message]));

    expect(restored).toEqual(message);
  });
});
