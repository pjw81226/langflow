# Work interview implementation plan

## Goal and agreed design

Replace upstream's “What can I help you with?” welcome with a Korean, one-question-at-a-time interview for nondevelopers. Discover both recurring tasks (daily reports, structured emails, recurring document reviews) and personal know-how (inspection order, decision criteria, exception handling). Then offer 1–3 grounded opportunities, a human-readable diagram, an actual flow draft via the upstream Assistant, and an explorable explanation linked to real canvas nodes. One fully specified job may yield one opportunity; never invent alternatives or business rules.

Start from upstream/main 5621dcfd84e11108e4cc1ecb0c51f41053c4211c in feat/work-interview. Do not merge earlier assistant/i18n branches. Preserve existing models, authorization, templates, manual creation, and editing existing flows. Initial execution takes pasted text or supplied files. No email ingestion, scheduling, internal connectors, custom code generator or global UI translation in this change.

## Questions and visual direction

1. 어떤 팀에서 어떤 일을 맡고 계세요? Team/category examples and optional direct entry; exact organization name not required.
2. 평소 하시는 일 중 어떤 것을 함께 만들어볼까요? Examples: 매일 비슷한 보고를 작성해요 / 같은 형식의 메일을 확인해요 / 자료를 정기적으로 모아요 / 제가 확인하는 순서나 기준이 있어요. Frequency optional.
3. 가장 최근에 그 일을 했을 때, 무엇부터 열어보셨나요? Multiple choice: 엑셀·CSV / 문서·PDF / 메일·메신저 / 사내 화면 / 직접 적은 내용.
4. 그 자료를 보고 보통 무엇을 하세요? Find items, compare, check criteria, calculate, summarize, copy; free text captures personal know-how. Examples adapt to task.
5. 마지막에는 무엇을 만들거나 확인하고 끝내세요? Report/table/message/checklist/judgment. AI may ask at most two concrete follow-ups after these, avoiding already supplied information.

Offer choices + short free text, 모르겠어요 with concrete examples, previous/edit controls, retained answers on API errors. No technical jargon in feature copy. If answers cannot support a real proposal, offer explicitly labelled examples instead of fabricating a role or rule.

Calm, crisp two-column interface: large question left, live summary right becoming the diagram. White/cool light background, ink text and restrained teal; support existing dark theme and 375px mobile. Heading “평소 하시는 일부터 알려주세요.” Supporting “늘 반복하는 일도, 나만의 처리 방법도 좋아요.” 28–32px titles, 16px body, existing/system Korean fonts, no external fonts or decorative AI gradients. Keyboard accessibility and reduced motion. Diagram has 3–6 labelled steps with optional branches, clickable descriptions, textual human/AI ownership. Suggested criteria must be acknowledged before generation.

## Shared API contract

POST /api/v1/agentic/interview (authenticated, existing agentic/model-policy gates).

Request:
```ts
type InterviewAnswers = {
  role: string; task: string; sources: string[]; process: string;
  output: string; frequency?: string;
};
type InterviewRule = { text: string; source: "user" | "suggested" };
type InterviewStep = {
  id: string; label: string; description: string;
  kind: "input" | "action" | "decision" | "output" | "human";
  actor: "user" | "ai"; node_ids: string[];
};
type InterviewEdge = { source: string; target: string; label: string };
type WorkOpportunity = {
  id: string; title: string; description: string; input: string;
  output: string; review: string; rules: InterviewRule[];
  steps: InterviewStep[]; edges: InterviewEdge[];
};
type InterviewRequest = {
  flow_id: string; stage: "examples" | "recommend" | "refine" | "explain";
  answers: InterviewAnswers;
  follow_up_answers?: { question: string; answer: string }[];
  opportunity?: WorkOpportunity; feedback?: string;
  provider?: string; model_name?: string;
};
type InterviewResponse = {
  summary: string; examples: string[]; follow_up_questions: string[];
  opportunities: WorkOpportunity[];
};
```

`examples` personalizes task choices from role without blocking core form. `recommend` returns grounded opportunities or at most the remaining two clarifying questions. `refine` revises selected opportunity using feedback. `explain` receives chosen opportunity and reads actual stored graph server-side; returns its steps with validated node_ids and explanations. No flow execution or mutation in this endpoint. Empty arrays are explicit. Validate graph references, limits and responses; never render model HTML. Human steps have no node_ids. The explain stage must not invent IDs or change confirmed business rules. No client graph or credentials are accepted. Failed AI requests return concise safe errors and leave input intact.

## Task 1: Interview backend

Add Pydantic contracts, interview service and authenticated endpoint in existing agentic router using the existing provider resolver, per-flow model policy and model abstraction. Use a simple no-tools structured model call; reuse provider metadata, context and credentials, do not hardcode OpenAI API calls. Bound inputs/output, model timeout and clarification budget; don't hold DB transaction during model generation. Tests for contracts, authorization before model calls, model-policy gating, recommendations/refinement, invalid JSON/edges, follow-up limits, no secret exposure and explain filtering against actual stored IDs. Own backend files only. Commit tested units.

## Task 2: Interview UI and state

Implement typed API client, Korean copy, five questions, live summary, candidate selection, up to two follow-ups, edit/refine, interactive business diagram and selected-rule confirmation. Keep reusable feature files in components/core/workInterview. Draft sessionStorage scoped to user+flow; stale async results cannot overwrite edited answers/new flows. Export WorkInterview props {flowId, userId, onBuild(metadata), onClose, onBrowseTemplates}; metadata includes version:1, answers, follow_up_answers, summary, opportunity, confirmed_suggested_rules:string[]. Tests cover answer editing invalidation, storage scoping/recovery, follow-up budget, candidate/rule gating, errors, business diagram interaction and keyboard navigation. Main controller wires welcome and persistence/integration. Commit tested units.

## Task 3: Canvas handoff and teaching

Replace old welcome UI with WorkInterview while preserving manual/templates exit and flow lifecycle. Persist confirmed metadata as data.work_interview and preserve it on saves, assistant proposal application and reload/import/export. Pass a plain-language but explicit build instruction via existing pendingMessage handoff and assist stream: use confirmed criteria, files/pasted inputs, no live email/scheduling, no invented rules, do not execute automatically. Reuse existing Add-to-canvas gating. Provide a compact canvas-side work guide with diagram, real-node highlight and explanation loaded using explain stage after save; human steps stay manual and stale IDs are excluded. Sample action opens the existing Playground without automatic run. A saved flow can reopen this guide; old flows have no interview prompt. Meaningful state/persistence/handoff tests.

## Task 4: Verification and finish

Run focused backend and frontend suites, frontend type check/build, existing welcome/handoff regression tests. Run isolated dev servers on 7861/3001 with their own local DB; use original .env key server-side without printing/copying it into tracked files. Use /browse exclusively for web/browser QA, test realistic interview through live GPT, draft generation/application and sample output. Test bright/dark, mobile, keyboard, long Korean text, reload and existing flows. Record concrete results and known limitations. Review branch, fix material findings and commit all completed work. Do not push or merge unless requested.

## Implemented integration decisions

- The upstream Assistant caps user messages at 2,000 characters. The handoff uses a short Korean request; the existing ownership-checked canvas context loader adds the validated, confirmed interview from stored flow data. Business criteria are kept outside the canvas-summary truncation so none are silently lost.
- Interview flows skip automatic execution verification before delivery. The user applies the proposal and starts a sample run explicitly.
- Server-side provenance checks retain `source=user` only for verbatim user text or already grounded rules; rewritten/new criteria require confirmation.
- Small screens collapse the guide on a real-node selection and use 24px horizontal fit padding.
- Final evidence and local startup instructions: [work-interview-verification.md](../../work-interview-verification.md).
