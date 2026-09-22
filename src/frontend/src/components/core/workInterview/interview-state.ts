import type {
  InterviewAnswers,
  InterviewDraft,
  InterviewResponse,
  WorkInterviewMetadata,
  WorkOpportunity,
} from "./types";

export const createDraft = (): InterviewDraft => ({
  version: 1,
  answers: { role: "", task: "", sources: [], process: "", output: "" },
  question: 0,
  screen: "questions",
  response: null,
  follow_up_answers: [],
  selectedId: null,
  confirmed_suggested_rules: [],
});

export const draftKey = (userId: string, flowId: string) =>
  `work-interview:v1:${encodeURIComponent(userId)}:${encodeURIComponent(flowId)}`;

export function isOpportunity(value: unknown): value is WorkOpportunity {
  if (!value || typeof value !== "object") return false;
  const v = value as WorkOpportunity;
  return (
    [v.id, v.title, v.description, v.input, v.output, v.review].every(
      (s) => typeof s === "string",
    ) &&
    Array.isArray(v.rules) &&
    v.rules.every(
      (r) =>
        r &&
        typeof r.text === "string" &&
        ["user", "suggested"].includes(r.source),
    ) &&
    Array.isArray(v.steps) &&
    v.steps.length > 0 &&
    v.steps.every(
      (s) =>
        s &&
        [s.id, s.label, s.description].every((t) => typeof t === "string") &&
        ["input", "action", "decision", "output", "human"].includes(s.kind) &&
        ["user", "ai"].includes(s.actor) &&
        Array.isArray(s.node_ids) &&
        s.node_ids.every((id) => typeof id === "string"),
    ) &&
    Array.isArray(v.edges) &&
    v.edges.every(
      (e) =>
        e && [e.source, e.target, e.label].every((s) => typeof s === "string"),
    )
  );
}

export function isInterviewResponse(
  value: unknown,
): value is InterviewResponse {
  if (!value || typeof value !== "object") return false;
  const v = value as InterviewResponse;
  return (
    typeof v.summary === "string" &&
    Array.isArray(v.examples) &&
    v.examples.every((s) => typeof s === "string") &&
    Array.isArray(v.follow_up_questions) &&
    v.follow_up_questions.length <= 2 &&
    v.follow_up_questions.every((s) => typeof s === "string") &&
    Array.isArray(v.opportunities) &&
    v.opportunities.length <= 3 &&
    v.opportunities.every(isOpportunity)
  );
}

export function isInterviewMetadata(
  value: unknown,
): value is WorkInterviewMetadata {
  if (!value || typeof value !== "object") return false;
  const v = value as WorkInterviewMetadata;
  return (
    v.version === 1 &&
    isAnswers(v.answers) &&
    typeof v.summary === "string" &&
    isOpportunity(v.opportunity) &&
    isFollowUps(v.follow_up_answers) &&
    Array.isArray(v.confirmed_suggested_rules) &&
    v.confirmed_suggested_rules.every((s) => typeof s === "string")
  );
}

function isAnswers(v: InterviewAnswers): boolean {
  return (
    !!v &&
    [v.role, v.task, v.process, v.output].every((s) => typeof s === "string") &&
    Array.isArray(v.sources) &&
    v.sources.every((s) => typeof s === "string")
  );
}

function isFollowUps(v: InterviewDraft["follow_up_answers"]): boolean {
  return (
    Array.isArray(v) &&
    v.length <= 2 &&
    v.every(
      (a) =>
        a && typeof a.question === "string" && typeof a.answer === "string",
    )
  );
}

export function readDraft(userId: string, flowId: string): InterviewDraft {
  try {
    const v = JSON.parse(
      sessionStorage.getItem(draftKey(userId, flowId)) ?? "null",
    ) as InterviewDraft | null;
    if (
      v?.version === 1 &&
      isAnswers(v.answers) &&
      Number.isInteger(v.question) &&
      v.question >= 0 &&
      v.question < 5 &&
      ["questions", "follow-up", "opportunities", "diagram"].includes(
        v.screen,
      ) &&
      (v.response === null || isInterviewResponse(v.response)) &&
      isFollowUps(v.follow_up_answers) &&
      (v.selectedId === null || typeof v.selectedId === "string") &&
      Array.isArray(v.confirmed_suggested_rules) &&
      v.confirmed_suggested_rules.every((s) => typeof s === "string")
    ) {
      if (v.screen !== "questions" && !v.response)
        return { ...v, screen: "questions" };
      if (
        v.screen === "diagram" &&
        !v.response?.opportunities.some((o) => o.id === v.selectedId)
      )
        return { ...v, screen: "opportunities" };
      return v;
    }
  } catch {
    // Storage may be unavailable or contain a draft from an older build.
  }
  return createDraft();
}

export function updateAnswer<K extends keyof InterviewAnswers>(
  draft: InterviewDraft,
  field: K,
  value: InterviewAnswers[K],
): InterviewDraft {
  return {
    ...draft,
    answers: { ...draft.answers, [field]: value },
    response: null,
    selectedId: null,
    follow_up_answers: [],
    confirmed_suggested_rules: [],
  };
}

export const canBuildOpportunity = (
  opportunity: WorkOpportunity,
  confirmed: string[],
) =>
  opportunity.rules
    .filter((r) => r.source === "suggested")
    .every((r) => confirmed.includes(r.text));

export function buildInterviewInstruction(): string {
  return "저장된 업무 인터뷰를 바탕으로 검토할 수 있는 초안을 만들어주세요. 확인한 내용이 없으면 먼저 알려주세요. 제가 알려드린 기준과 예외 처리를 그대로 반영하고, 마지막 확인은 제가 하겠습니다. 기본 제공 구성과 선택한 AI로 자료를 붙여넣으면 결과를 받을 수 있게 만들어주세요. 메일이나 사내 시스템에 연결하지 말고, 자동 실행하지 마세요. 사용 방법과 결과를 확인하는 방법도 쉬운 한국어로 보여주세요.";
}
