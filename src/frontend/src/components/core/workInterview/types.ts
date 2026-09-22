export type InterviewAnswers = {
  role: string;
  task: string;
  sources: string[];
  process: string;
  output: string;
  frequency?: string;
};

export type InterviewRule = { text: string; source: "user" | "suggested" };
export type InterviewStep = {
  id: string;
  label: string;
  description: string;
  kind: "input" | "action" | "decision" | "output" | "human";
  actor: "user" | "ai";
  node_ids: string[];
};
export type InterviewEdge = { source: string; target: string; label: string };
export type WorkOpportunity = {
  id: string;
  title: string;
  description: string;
  input: string;
  output: string;
  review: string;
  rules: InterviewRule[];
  steps: InterviewStep[];
  edges: InterviewEdge[];
};
export type FollowUpAnswer = { question: string; answer: string };
export type InterviewRequest = {
  flow_id: string;
  stage: "examples" | "recommend" | "refine" | "explain";
  answers: InterviewAnswers;
  follow_up_answers?: FollowUpAnswer[];
  opportunity?: WorkOpportunity;
  feedback?: string;
  provider?: string;
  model_name?: string;
};
export type InterviewResponse = {
  summary: string;
  examples: string[];
  follow_up_questions: string[];
  opportunities: WorkOpportunity[];
};
export type WorkInterviewMetadata = {
  version: 1;
  answers: InterviewAnswers;
  follow_up_answers: FollowUpAnswer[];
  summary: string;
  opportunity: WorkOpportunity;
  confirmed_suggested_rules: string[];
};
export type InterviewDraft = {
  version: 1;
  answers: InterviewAnswers;
  question: number;
  screen: "questions" | "follow-up" | "opportunities" | "diagram";
  response: InterviewResponse | null;
  follow_up_answers: FollowUpAnswer[];
  selectedId: string | null;
  confirmed_suggested_rules: string[];
};
