import { useEffect, useRef, useState } from "react";
import type { AssistantModel } from "../assistantPanel/assistant-panel.types";
import { interviewError, postInterview } from "./interview-api";
import { draftKey, readDraft, updateAnswer } from "./interview-state";
import type {
  InterviewAnswers,
  InterviewDraft,
  InterviewRequest,
  WorkOpportunity,
} from "./types";

export function useWorkInterview(
  flowId: string,
  userId: string,
  model: AssistantModel | null,
  canUseModel: boolean,
) {
  const [draft, setDraft] = useState(() => readDraft(userId, flowId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [examples, setExamples] = useState<string[]>([]);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const exampleController = useRef<AbortController | null>(null);

  useEffect(() => {
    try {
      sessionStorage.setItem(draftKey(userId, flowId), JSON.stringify(draft));
    } catch {
      /* The interview also works when tab storage is unavailable. */
    }
  }, [draft, userId, flowId]);

  useEffect(
    () => () => {
      generation.current += 1;
      controller.current?.abort();
      exampleController.current?.abort();
    },
    [],
  );

  function cancel() {
    generation.current += 1;
    controller.current?.abort();
    exampleController.current?.abort();
    setBusy(false);
    setError("");
  }

  function answer<K extends keyof InterviewAnswers>(
    field: K,
    value: InterviewAnswers[K],
  ) {
    cancel();
    if (field === "role") setExamples([]);
    setDraft((current) => updateAnswer(current, field, value));
  }

  async function loadExamples() {
    if (!canUseModel || !model || !draft.answers.role.trim()) return;
    exampleController.current?.abort();
    const requestController = new AbortController();
    exampleController.current = requestController;
    const version = generation.current;
    try {
      const result = await postInterview(
        {
          flow_id: flowId,
          stage: "examples",
          answers: draft.answers,
          provider: model.provider,
          model_name: model.name,
        },
        requestController.signal,
      );
      if (version === generation.current && !requestController.signal.aborted)
        setExamples(result.examples.slice(0, 5));
    } catch {
      /* Local examples remain available without an AI connection. */
    }
  }

  async function request(
    stage: "recommend" | "refine",
    current = draft,
    feedback?: string,
  ) {
    cancel();
    if (!canUseModel || !model) {
      setError(
        "답변은 저장했어요. AI 연결을 설정하면 이어서 함께 만들 수 있어요.",
      );
      return;
    }
    const version = generation.current;
    const requestController = new AbortController();
    controller.current = requestController;
    setBusy(true);
    const opportunity = current.response?.opportunities.find(
      (o) => o.id === current.selectedId,
    );
    const payload: InterviewRequest = {
      flow_id: flowId,
      stage,
      answers: current.answers,
      follow_up_answers: current.follow_up_answers,
      provider: model.provider,
      model_name: model.name,
      ...(opportunity && { opportunity }),
      ...(feedback && { feedback }),
    };
    try {
      const result = await postInterview(payload, requestController.signal);
      if (version !== generation.current || requestController.signal.aborted)
        return;
      const remaining = Math.max(0, 2 - current.follow_up_answers.length);
      result.follow_up_questions = result.follow_up_questions.slice(
        0,
        remaining,
      );
      if (
        !result.follow_up_questions.length &&
        !result.opportunities.length &&
        !result.examples.length
      ) {
        setError(
          "어떤 일을 만들지 아직 정하지 못했어요. 앞에서 함께 만들 일을 조금 더 알려주세요.",
        );
        return;
      }
      setDraft({
        ...current,
        response: result,
        screen:
          stage === "refine" && result.opportunities.length
            ? "diagram"
            : result.follow_up_questions.length
              ? "follow-up"
              : "opportunities",
        selectedId:
          stage === "refine" ? (result.opportunities[0]?.id ?? null) : null,
        confirmed_suggested_rules: [],
      });
    } catch (caught) {
      if (version === generation.current && !requestController.signal.aborted)
        setError(interviewError(caught));
    } finally {
      if (version === generation.current) setBusy(false);
    }
  }

  function goToQuestion(question: number) {
    cancel();
    setDraft((d) => ({ ...d, question, screen: "questions" }));
  }

  function select(opportunity: WorkOpportunity) {
    setError("");
    setDraft((d) => ({
      ...d,
      selectedId: opportunity.id,
      screen: "diagram",
      confirmed_suggested_rules: [],
    }));
  }

  async function submitFollowUp(value: string) {
    const question = draft.response?.follow_up_questions[0];
    if (!question || draft.follow_up_answers.length >= 2) return;
    const updated: InterviewDraft = {
      ...draft,
      follow_up_answers: [
        ...draft.follow_up_answers,
        { question, answer: value.trim() || "잘 모르겠어요" },
      ],
      response: draft.response && {
        ...draft.response,
        follow_up_questions: draft.response.follow_up_questions.slice(1),
      },
    };
    setDraft(updated);
    if (!updated.response?.follow_up_questions.length)
      await request("recommend", updated);
  }

  return {
    draft,
    setDraft,
    busy,
    error,
    setError,
    examples,
    answer,
    loadExamples,
    request,
    goToQuestion,
    select,
    submitFollowUp,
  };
}
