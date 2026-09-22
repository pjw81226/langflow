import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  CircleHelp,
  FileText,
  Loader2,
  Pencil,
  Settings2,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import ModelProviderModal from "@/modals/modelProviderModal";
import { ModelSelector } from "../assistantPanel/components/model-selector";
import { useAssistantSelectedModel } from "../assistantPanel/hooks/use-assistant-selected-model";
import { useEnabledModels } from "../assistantPanel/hooks/use-enabled-models";
import { BusinessDiagram } from "./business-diagram";
import { interviewCopy, processExample } from "./copy";
import { canBuildOpportunity } from "./interview-state";
import type { InterviewStep, WorkInterviewMetadata } from "./types";
import { useWorkInterview } from "./use-work-interview";
import "./work-interview.css";

export interface WorkInterviewProps {
  flowId: string;
  userId: string;
  onBuild: (metadata: WorkInterviewMetadata) => Promise<void> | void;
  onClose: () => void;
  onBrowseTemplates: () => void;
}

export function WorkInterview({
  flowId,
  userId,
  onBuild,
  onClose,
  onBrowseTemplates,
}: WorkInterviewProps) {
  const [model, setModel] = useAssistantSelectedModel();
  const { isCatalogReady, hasEnabledModels, isModelEnabled } =
    useEnabledModels();
  const connected = isCatalogReady && hasEnabledModels && isModelEnabled(model);
  const interview = useWorkInterview(flowId, userId, model, connected);
  const { draft, setDraft, busy, error, answer, request, goToQuestion } =
    interview;
  const [help, setHelp] = useState(false);
  const [followUp, setFollowUp] = useState("");
  const [feedback, setFeedback] = useState("");
  const [editing, setEditing] = useState(false);
  const [selectedStep, setSelectedStep] = useState<InterviewStep | null>(null);
  const [providerOpen, setProviderOpen] = useState(false);
  const [building, setBuilding] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const question = interviewCopy.questions[draft.question];
  const opportunity = draft.response?.opportunities.find(
    (o) => o.id === draft.selectedId,
  );
  const isQuestions = draft.screen === "questions";
  const isDiagram = draft.screen === "diagram" && !!opportunity;
  const working = busy || building;

  useEffect(() => {
    setHelp(false);
    setFollowUp("");
    setSelectedStep(null);
    titleRef.current?.focus();
  }, [
    draft.screen,
    draft.question,
    draft.response?.follow_up_questions[0],
    draft.selectedId,
  ]);

  async function next() {
    if (draft.question === 0) void interview.loadExamples();
    if (draft.question < 4)
      setDraft((d) => ({ ...d, question: d.question + 1 }));
    else await request("recommend");
  }

  function choose(value: string) {
    if (question.field === "sources") {
      const sources = draft.answers.sources;
      answer(
        "sources",
        sources.includes(value)
          ? sources.filter((s) => s !== value)
          : [...sources, value],
      );
    } else if (question.field === "process") {
      const parts = draft.answers.process.split(" → ").filter(Boolean);
      answer(
        "process",
        (parts.includes(value)
          ? parts.filter((p) => p !== value)
          : [...parts, value]
        ).join(" → "),
      );
    } else answer(question.field, value);
  }

  async function build() {
    if (
      !opportunity ||
      !canBuildOpportunity(opportunity, draft.confirmed_suggested_rules)
    )
      return;
    setBuilding(true);
    interview.setError("");
    try {
      await onBuild({
        version: 1,
        answers: draft.answers,
        follow_up_answers: draft.follow_up_answers,
        summary: draft.response!.summary,
        opportunity,
        confirmed_suggested_rules: draft.confirmed_suggested_rules,
      });
    } catch {
      interview.setError(
        "초안을 시작하지 못했어요. 답변은 그대로 있으니 다시 시도해 주세요.",
      );
    } finally {
      setBuilding(false);
    }
  }

  const choices =
    draft.question === 1 && interview.examples.length
      ? [...interview.examples, "제가 확인하는 순서나 기준이 있어요"]
      : question.choices;
  const value =
    question.field === "sources"
      ? draft.answers.sources
          .filter((s) => !question.choices.includes(s))
          .join(", ")
      : (draft.answers[question.field] ?? "");

  return (
    <section
      className="work-interview"
      aria-label="업무 인터뷰"
      data-testid="work-interview"
    >
      <header className="wi-topbar">
        <span className="wi-brand">
          <span className="wi-brand-symbol">
            <Sparkles size={17} />
          </span>
          내 일에서 시작하기
        </span>
        <div className="wi-top-actions">
          <button type="button" onClick={onBrowseTemplates}>
            템플릿 보기
          </button>
          <button
            type="button"
            onClick={onClose}
            className="wi-close"
            aria-label="인터뷰 닫고 직접 만들기"
          >
            <X size={19} />
          </button>
        </div>
      </header>

      <div className="wi-layout">
        <main className="wi-main">
          <div className="wi-intro">
            <p>{interviewCopy.title}</p>
            <span>{interviewCopy.subtitle}</span>
          </div>
          <nav className="wi-progress" aria-label="인터뷰 진행">
            {interviewCopy.questions.map((q, index) => (
              <button
                key={q.field}
                type="button"
                onClick={() => goToQuestion(index)}
                aria-current={
                  isQuestions && draft.question === index ? "step" : undefined
                }
                className={`${draft.question > index || !isQuestions ? "is-done" : ""} ${isQuestions && draft.question === index ? "is-current" : ""}`}
              >
                <span>
                  {draft.question > index || !isQuestions ? (
                    <Check size={12} />
                  ) : (
                    index + 1
                  )}
                </span>
                <small>{q.short}</small>
              </button>
            ))}
          </nav>

          {isQuestions && (
            <div className="wi-question" key={draft.question}>
              <span className="wi-position">{draft.question + 1} / 5</span>
              <h1 ref={titleRef} tabIndex={-1}>
                {question.title}
              </h1>
              <p className="wi-hint">{question.hint}</p>
              <div className="wi-choices" aria-label="답변 예시">
                {choices.map((choice) => {
                  const selected =
                    question.field === "sources"
                      ? draft.answers.sources.includes(choice)
                      : question.field === "process"
                        ? draft.answers.process.split(" → ").includes(choice)
                        : value === choice;
                  return (
                    <button
                      type="button"
                      key={choice}
                      onClick={() => choose(choice)}
                      aria-pressed={selected}
                      className={selected ? "is-selected" : ""}
                    >
                      <span>{choice}</span>
                      {selected ? (
                        <Check size={16} />
                      ) : (
                        <span className="wi-choice-dot" />
                      )}
                    </button>
                  );
                })}
              </div>
              <label className="wi-input-label" htmlFor="wi-answer">
                내 말로 적어도 좋아요
              </label>
              <textarea
                id="wi-answer"
                value={value}
                maxLength={
                  question.field === "role"
                    ? 500
                    : question.field === "process"
                      ? 4000
                      : question.field === "sources"
                        ? 200
                        : 1000
                }
                rows={3}
                placeholder={
                  question.field === "process"
                    ? processExample(draft.answers.task)
                    : question.placeholder
                }
                onChange={(e) => {
                  if (question.field === "sources")
                    answer("sources", [
                      ...draft.answers.sources.filter((s) =>
                        question.choices.includes(s),
                      ),
                      ...(e.target.value ? [e.target.value] : []),
                    ]);
                  else answer(question.field, e.target.value);
                }}
              />
              {draft.question === 1 && (
                <div className="wi-frequency">
                  <span>
                    얼마나 자주 하나요? <small>선택</small>
                  </span>
                  {["매일", "매주", "필요할 때"].map((frequency) => (
                    <button
                      key={frequency}
                      type="button"
                      aria-pressed={draft.answers.frequency === frequency}
                      onClick={() =>
                        answer(
                          "frequency",
                          draft.answers.frequency === frequency
                            ? ""
                            : frequency,
                        )
                      }
                    >
                      {frequency}
                    </button>
                  ))}
                </div>
              )}
              <button
                type="button"
                className="wi-help-button"
                aria-expanded={help}
                onClick={() => setHelp(!help)}
              >
                <CircleHelp size={16} />잘 모르겠어요
              </button>
              {help && (
                <p className="wi-help" role="status">
                  {question.help}
                  <br />
                  지금 떠오르지 않으면 비워 두고 다음으로 가도 괜찮아요.
                </p>
              )}
            </div>
          )}

          {draft.screen === "follow-up" && (
            <div className="wi-question">
              <span className="wi-position">
                조금만 더 알려주세요 · {draft.follow_up_answers.length + 1} / 2
              </span>
              <h1 ref={titleRef} tabIndex={-1}>
                {draft.response?.follow_up_questions[0] ??
                  "답변을 바탕으로 정리하고 있어요."}
              </h1>
              <p className="wi-hint">
                최근에 처리한 한 번의 일을 떠올려보세요. 짧게 적어도 좋아요.
              </p>
              <textarea
                aria-label="추가 질문 답변"
                rows={4}
                maxLength={2000}
                placeholder="예: 날짜가 빠진 건은 담당자에게 다시 확인해요."
                value={followUp}
                onChange={(e) => setFollowUp(e.target.value)}
              />
              <button
                type="button"
                className="wi-help-button"
                onClick={() =>
                  setFollowUp("잘 모르겠어요. 이 부분은 제가 직접 확인할게요.")
                }
              >
                <CircleHelp size={16} />이 부분은 직접 확인할게요
              </button>
            </div>
          )}

          {draft.screen === "opportunities" && (
            <div className="wi-question">
              <span className="wi-position">이제 함께 만들어볼까요</span>
              <h1 ref={titleRef} tabIndex={-1}>
                {draft.response?.opportunities.length
                  ? "이런 일부터 줄여볼 수 있어요."
                  : "익숙한 예시부터 골라볼까요?"}
              </h1>
              <p className="wi-hint">
                {draft.response?.opportunities.length
                  ? "말씀해주신 일을 바탕으로 정리했어요. 먼저 해볼 일을 하나 골라주세요."
                  : "아직 업무를 정하기 어려우면 예시를 골라 내 일에 맞게 바꿔보세요. 실제 하시는 일로 가정하지 않아요."}
              </p>
              <div className="wi-opportunities">
                {draft.response?.examples.map((example) => (
                  <button
                    key={example}
                    type="button"
                    className="wi-choice"
                    onClick={() => {
                      answer("task", example.replace(/^예시\s*:\s*/, ""));
                      goToQuestion(1);
                    }}
                  >
                    {example}
                  </button>
                ))}
                {draft.response?.opportunities.map((item, index) => (
                  <article key={item.id} className="wi-opportunity">
                    <div className="wi-opportunity-heading">
                      <span className="wi-opportunity-number">{index + 1}</span>
                      <h2>{item.title}</h2>
                    </div>
                    <p>{item.description}</p>
                    <dl>
                      <div>
                        <dt>보는 자료</dt>
                        <dd>{item.input}</dd>
                      </div>
                      <div>
                        <dt>나오는 결과</dt>
                        <dd>{item.output}</dd>
                      </div>
                      <div>
                        <dt>내가 확인할 것</dt>
                        <dd>{item.review}</dd>
                      </div>
                    </dl>
                    <button
                      type="button"
                      className="wi-text-action"
                      onClick={() => interview.select(item)}
                    >
                      이 일 함께 만들기 <ArrowRight size={16} />
                    </button>
                  </article>
                ))}
              </div>
            </div>
          )}

          {isDiagram && (
            <div className="wi-question">
              <span className="wi-position">일의 순서를 함께 확인해요</span>
              <h1 ref={titleRef} tabIndex={-1}>
                {opportunity.title}
              </h1>
              <p className="wi-hint">{opportunity.description}</p>
              <div className="wi-outcome">
                <FileText size={21} />
                <div>
                  <span>이렇게 시작해서</span>
                  <strong>{opportunity.input}</strong>
                </div>
                <ArrowRight size={18} />
                <div>
                  <span>이 결과를 만들어요</span>
                  <strong>{opportunity.output}</strong>
                </div>
              </div>
              {opportunity.rules.length > 0 && (
                <div className="wi-rules">
                  <h2>확인하는 기준</h2>
                  {opportunity.rules.map((rule, index) =>
                    rule.source === "suggested" ? (
                      <label key={`${rule.text}-${index}`} className="wi-rule">
                        <input
                          type="checkbox"
                          checked={draft.confirmed_suggested_rules.includes(
                            rule.text,
                          )}
                          onChange={(e) =>
                            setDraft((d) => ({
                              ...d,
                              confirmed_suggested_rules: e.target.checked
                                ? [...d.confirmed_suggested_rules, rule.text]
                                : d.confirmed_suggested_rules.filter(
                                    (r) => r !== rule.text,
                                  ),
                            }))
                          }
                        />
                        <span>
                          <small>AI가 제안했어요 · 맞다면 선택해 주세요</small>
                          {rule.text}
                        </span>
                      </label>
                    ) : (
                      <div key={`${rule.text}-${index}`} className="wi-rule">
                        <Check size={17} />
                        <span>
                          <small>알려주신 기준</small>
                          {rule.text}
                        </span>
                      </div>
                    ),
                  )}
                </div>
              )}
              <div className="wi-human-note">
                <span>마지막 확인은 내가</span>
                <p>{opportunity.review}</p>
              </div>
              <button
                type="button"
                className="wi-help-button"
                onClick={() => setEditing(!editing)}
                aria-expanded={editing}
              >
                <Pencil size={15} />이 내용 바꾸기
              </button>
              {editing && (
                <div className="wi-refine">
                  <textarea
                    aria-label="바꾸고 싶은 내용"
                    rows={3}
                    maxLength={2000}
                    placeholder="예: 완료된 건은 빼고 장비별로 묶어주세요."
                    value={feedback}
                    onChange={(e) => setFeedback(e.target.value)}
                  />
                  <button
                    type="button"
                    className="wi-secondary"
                    disabled={!feedback.trim() || working}
                    onClick={() => {
                      setSelectedStep(null);
                      void request("refine", draft, feedback);
                    }}
                  >
                    그림과 내용 다시 정리하기
                  </button>
                </div>
              )}
              <p className="wi-scope-note">
                먼저 파일이나 붙여넣은 내용으로 만들어봐요. 메일 자동 수신이나
                정해진 시간 실행은 연결하지 않아요.
              </p>
            </div>
          )}

          {error && (
            <div className="wi-error" role="alert">
              {error}
              {!connected && (
                <button type="button" onClick={() => setProviderOpen(true)}>
                  AI 연결 설정
                </button>
              )}
            </div>
          )}
          <footer className="wi-navigation">
            <button
              type="button"
              className="wi-back"
              disabled={working || (isQuestions && draft.question === 0)}
              onClick={() => {
                if (isQuestions) goToQuestion(draft.question - 1);
                else if (isDiagram) {
                  setSelectedStep(null);
                  setDraft((d) => ({ ...d, screen: "opportunities" }));
                } else goToQuestion(4);
              }}
            >
              <ArrowLeft size={17} />
              이전
            </button>
            <button
              type="button"
              className="wi-primary"
              disabled={
                working ||
                (isDiagram &&
                  !canBuildOpportunity(
                    opportunity,
                    draft.confirmed_suggested_rules,
                  )) ||
                draft.screen === "opportunities"
              }
              onClick={() => {
                if (isQuestions) void next();
                else if (draft.screen === "follow-up") {
                  if (draft.response?.follow_up_questions.length)
                    void interview.submitFollowUp(followUp);
                  else void request("recommend");
                } else if (isDiagram) void build();
              }}
            >
              {working ? (
                <>
                  <Loader2 size={17} className="wi-spin" />
                  {building ? "초안 시작하는 중" : "답변을 정리하고 있어요"}
                </>
              ) : (
                <>
                  {isDiagram
                    ? "이 내용으로 초안 만들기"
                    : draft.screen === "opportunities"
                      ? "위에서 하나 골라주세요"
                      : isQuestions && draft.question < 4
                        ? "다음"
                        : "함께 만들 일 찾아보기"}
                  <ArrowRight size={17} />
                </>
              )}
            </button>
          </footer>
          <div className="wi-bottom">
            <button type="button" onClick={onClose}>
              직접 만들기
            </button>
            <details>
              <summary>
                <Settings2 size={13} />
                AI 연결
              </summary>
              <div>
                <ModelSelector selectedModel={model} onModelChange={setModel} />
                <button type="button" onClick={() => setProviderOpen(true)}>
                  연결 설정
                </button>
              </div>
            </details>
          </div>
        </main>

        <aside
          className="wi-aside"
          aria-label={isDiagram ? "업무 그림" : "지금까지 알려주신 일"}
        >
          <div className="wi-aside-heading">
            <span className="wi-aside-line" />
            <h2>
              {isDiagram ? "한눈에 보는 일의 순서" : "내 일이 이렇게 정리돼요"}
            </h2>
            <span className="wi-aside-line" />
          </div>
          {isDiagram ? (
            <>
              <p className="wi-aside-hint">궁금한 단계를 눌러보세요.</p>
              <BusinessDiagram
                opportunity={opportunity}
                selectedId={selectedStep?.id}
                onSelect={setSelectedStep}
              />
              <div className="wi-step-detail" aria-live="polite">
                {selectedStep ? (
                  <>
                    <span>
                      {selectedStep.actor === "user"
                        ? "내가 하는 일"
                        : "AI가 돕는 일"}
                    </span>
                    <h3>{selectedStep.label}</h3>
                    <p>{selectedStep.description}</p>
                  </>
                ) : (
                  <>
                    <span>함께 이해하며 만들어요</span>
                    <p>
                      각 단계에서 무엇을 보고, 어떤 결과를 만드는지 확인할 수
                      있어요.
                    </p>
                  </>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="wi-paper">
                <div className="wi-paper-top">
                  <FileText size={22} />
                  <span>내 업무 메모</span>
                  <span className="wi-paper-dot" />
                </div>
                {interviewCopy.questions.map((q, index) => {
                  const content =
                    q.field === "sources"
                      ? draft.answers.sources.join(", ")
                      : draft.answers[q.field];
                  return (
                    <div
                      key={q.field}
                      className={`wi-summary-row ${content ? "is-filled" : ""}`}
                    >
                      <button
                        type="button"
                        onClick={() => goToQuestion(index)}
                        aria-label={`${q.short} 답변 수정`}
                      >
                        <span>{q.short}</span>
                        {content && <Pencil size={12} />}
                      </button>
                      {content ? (
                        <p>{content}</p>
                      ) : (
                        <span className="wi-placeholder-line" />
                      )}
                    </div>
                  );
                })}
              </div>
              {draft.response?.summary ? (
                <p className="wi-summary-text">{draft.response.summary}</p>
              ) : (
                <div className="wi-aside-note">
                  <span className="wi-note-symbol">
                    <Sparkles size={17} />
                  </span>
                  <p>
                    익숙한 일을 알려주시면,
                    <br />
                    AI가 도울 부분을 함께 찾아요.
                  </p>
                </div>
              )}
              <div className="wi-journey">
                <span className="is-active">내 일 이야기하기</span>
                <ChevronRight size={14} />
                <span>그림으로 확인</span>
                <ChevronRight size={14} />
                <span>함께 만들기</span>
              </div>
            </>
          )}
        </aside>
      </div>
      {providerOpen && (
        <ModelProviderModal
          open={providerOpen}
          onClose={() => setProviderOpen(false)}
          modelType="llm"
          flowId={flowId}
        />
      )}
    </section>
  );
}
