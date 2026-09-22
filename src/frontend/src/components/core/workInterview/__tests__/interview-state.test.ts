import {
  buildInterviewInstruction,
  canBuildOpportunity,
  createDraft,
  draftKey,
  readDraft,
  updateAnswer,
} from "../interview-state";
import type { WorkOpportunity } from "../types";

const opportunity: WorkOpportunity = {
  id: "mail",
  title: "메일 확인 목록",
  description: "메일에서 확인할 내용을 모아요.",
  input: "메일 내용",
  output: "확인 목록",
  review: "마지막에 직접 확인해요.",
  rules: [{ text: "날짜가 없으면 직접 확인", source: "suggested" }],
  steps: [
    {
      id: "input",
      label: "메일 내용 넣기",
      description: "메일을 붙여넣어요.",
      kind: "input",
      actor: "user",
      node_ids: [],
    },
    {
      id: "review",
      label: "직접 확인",
      description: "결과를 확인해요.",
      kind: "human",
      actor: "user",
      node_ids: [],
    },
  ],
  edges: [{ source: "input", target: "review", label: "" }],
};

describe("work interview drafts", () => {
  beforeEach(() => sessionStorage.clear());

  it("scopes saved answers to the signed-in user and flow", () => {
    const draft = updateAnswer(createDraft(), "task", "매일 메일을 읽어요");
    sessionStorage.setItem(draftKey("one", "flow-a"), JSON.stringify(draft));
    expect(readDraft("one", "flow-a").answers.task).toBe("매일 메일을 읽어요");
    expect(readDraft("two", "flow-a").answers.task).toBe("");
    expect(readDraft("one", "flow-b").answers.task).toBe("");
  });

  it("invalidates recommendations and confirmations when an earlier answer changes", () => {
    const draft = {
      ...createDraft(),
      screen: "diagram" as const,
      selectedId: opportunity.id,
      response: {
        summary: "요약",
        examples: [],
        follow_up_questions: [],
        opportunities: [opportunity],
      },
      follow_up_answers: [{ question: "언제?", answer: "매일" }],
      confirmed_suggested_rules: [opportunity.rules[0].text],
    };
    const changed = updateAnswer(draft, "task", "매주 보고서를 써요");
    expect(changed.response).toBeNull();
    expect(changed.selectedId).toBeNull();
    expect(changed.confirmed_suggested_rules).toEqual([]);
    expect(changed.follow_up_answers).toEqual([]);
    expect(changed.answers.task).toBe("매주 보고서를 써요");
  });

  it("recovers from malformed or outdated tab storage", () => {
    for (const payload of [
      "not-json",
      '{"version":0}',
      '{"version":1,"answers":null}',
    ]) {
      sessionStorage.setItem(draftKey("one", "flow-a"), payload);
      expect(readDraft("one", "flow-a")).toEqual(createDraft());
    }
  });

  it("requires explicit confirmation of suggested criteria before generating", () => {
    expect(canBuildOpportunity(opportunity, [])).toBe(false);
    expect(canBuildOpportunity(opportunity, ["날짜가 없으면 직접 확인"])).toBe(
      true,
    );
    expect(
      canBuildOpportunity(
        { ...opportunity, rules: [{ text: "내 기준", source: "user" }] },
        [],
      ),
    ).toBe(true);
  });

  it("hands confirmed requirements to the builder without requesting email ingestion or execution", () => {
    const instruction = buildInterviewInstruction();
    expect(instruction.length).toBeLessThan(1000);
    expect(instruction).toContain("저장된 업무 인터뷰");
    expect(instruction).toContain("자동 실행하지 마세요");
    expect(instruction).toContain("자료를 붙여넣으면");
    expect(instruction).toContain("메일이나 사내 시스템에 연결하지 말고");
  });
});
