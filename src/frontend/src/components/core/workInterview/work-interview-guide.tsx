import { BookOpen, Loader2, MessageSquare, RefreshCw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import useSaveFlow from "@/hooks/flows/use-save-flow";
import useAssistantManagerStore from "@/stores/assistantManagerStore";
import useAuthStore from "@/stores/authStore";
import useFlowBuilderWelcomeStore from "@/stores/flowBuilderWelcomeStore";
import useFlowStore from "@/stores/flowStore";
import { usePlaygroundStore } from "@/stores/playgroundStore";
import { useAssistantSelectedModel } from "../assistantPanel/hooks/use-assistant-selected-model";
import { BusinessDiagram } from "./business-diagram";
import { interviewError, postInterview } from "./interview-api";
import {
  buildInterviewInstruction,
  draftKey,
  isInterviewMetadata,
  readDraft,
} from "./interview-state";
import type { InterviewStep, WorkInterviewMetadata } from "./types";
import "./work-interview.css";

/** Restore only this user's in-progress blank-flow interview after a reload. */
export function WorkInterviewRestore() {
  const flow = useFlowStore((s) => s.currentFlow);
  const userId = useAuthStore((s) => s.userData?.id);
  const isOpen = useFlowBuilderWelcomeStore((s) => s.isOpen);
  const open = useFlowBuilderWelcomeStore((s) => s.open);
  useEffect(() => {
    if (
      !flow ||
      !userId ||
      isOpen ||
      flow.locked ||
      flow.data?.nodes.length ||
      flow.data?.work_interview
    )
      return;
    try {
      if (sessionStorage.getItem(draftKey(userId, flow.id))) {
        const draft = readDraft(userId, flow.id);
        if (draft.answers.role || draft.answers.task || draft.question > 0)
          open(flow.id);
      }
    } catch {
      /* Tab storage is optional. */
    }
  }, [flow, userId, isOpen, open]);
  return null;
}

export function WorkInterviewGuide() {
  const flow = useFlowStore((s) => s.currentFlow);
  const welcome = useFlowBuilderWelcomeStore((s) => s.isOpen);
  const playground = usePlaygroundStore((s) => s.isOpen);
  const assistant = useAssistantManagerStore((s) => s.assistantSidebarOpen);
  const candidate = flow?.data?.work_interview;
  if (!flow || welcome || playground || !isInterviewMetadata(candidate))
    return null;
  return (
    <WorkGuide
      key={flow.id}
      flowId={flow.id}
      metadata={candidate}
      assistantOpen={assistant}
    />
  );
}

function WorkGuide({
  flowId,
  metadata,
  assistantOpen,
}: {
  flowId: string;
  metadata: WorkInterviewMetadata;
  assistantOpen: boolean;
}) {
  const [open, setOpen] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const attempted = useRef("");
  const [model] = useAssistantSelectedModel();
  const nodes = useFlowStore((s) => s.nodes);
  const edges = useFlowStore((s) => s.edges);
  const saveFlow = useSaveFlow();
  const signature = JSON.stringify([
    nodes.map((n) => [n.id, n.data.type]),
    edges.map((e) => [e.source, e.target]),
  ]);
  const signatureRef = useRef(signature);
  signatureRef.current = signature;
  const selected = metadata.opportunity.steps.find((s) => s.id === selectedId);

  useEffect(() => {
    const attempt = `${model?.provider}:${model?.name}:${signature}:${retry}`;
    if (
      !open ||
      assistantOpen ||
      !model ||
      !nodes.length ||
      attempted.current === attempt
    )
      return;
    attempted.current = attempt;
    const controller = new AbortController();
    let completed = false;
    setBusy(true);
    setError("");
    void (async () => {
      try {
        await saveFlow(undefined, { suppressErrorToast: true });
        if (controller.signal.aborted) return;
        const result = await postInterview(
          {
            flow_id: flowId,
            stage: "explain",
            answers: metadata.answers,
            follow_up_answers: metadata.follow_up_answers,
            opportunity: metadata.opportunity,
            provider: model.provider,
            model_name: model.name,
          },
          controller.signal,
        );
        const opportunity = result.opportunities[0];
        const state = useFlowStore.getState();
        if (
          controller.signal.aborted ||
          !opportunity ||
          state.currentFlow?.id !== flowId ||
          signatureRef.current !== signature
        )
          return;
        const current = state.currentFlow;
        const validIds = new Set(state.nodes.map((n) => n.id));
        // Keep the approved business specification; explain may only add node links/descriptions.
        const updated = {
          ...metadata,
          opportunity: {
            ...metadata.opportunity,
            steps: metadata.opportunity.steps.map((step) => {
              const explained = opportunity.steps.find((s) => s.id === step.id);
              return {
                ...step,
                description: explained?.description ?? step.description,
                node_ids:
                  step.kind === "human"
                    ? []
                    : (explained?.node_ids ?? []).filter((id) =>
                        validIds.has(id),
                      ),
              };
            }),
          },
        };
        state.setCurrentFlow({
          ...current,
          data: { ...current.data!, work_interview: updated },
        });
        await saveFlow(undefined, { suppressErrorToast: true });
      } catch (caught) {
        if (!controller.signal.aborted) setError(interviewError(caught));
      } finally {
        if (!controller.signal.aborted) {
          completed = true;
          setBusy(false);
        }
      }
    })();
    return () => {
      controller.abort();
      if (!completed) attempted.current = "";
    };
    // Metadata updates from this request must not start another paid model call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    signature,
    flowId,
    model?.name,
    model?.provider,
    open,
    assistantOpen,
    retry,
  ]);

  function select(step: InterviewStep) {
    setSelectedId(step.id);
    const store = useFlowStore.getState();
    const ids = new Set(step.kind === "human" ? [] : step.node_ids);
    const realNodes = store.nodes.filter((n) => ids.has(n.id));
    store.setNodes(store.nodes.map((n) => ({ ...n, selected: ids.has(n.id) })));
    if (realNodes.length) {
      const narrow = window.matchMedia("(max-width: 760px)").matches;
      if (narrow) setOpen(false);
      void store.reactFlowInstance?.fitView({
        nodes: realNodes.map((n) => ({ id: n.id })),
        padding: {
          left: narrow ? "24px" : "360px",
          right: narrow ? "24px" : "60px",
          top: "80px",
          bottom: "60px",
        },
        maxZoom: 1,
        duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? 0
          : 250,
      });
    }
  }

  if (!open || assistantOpen)
    return (
      <div className="wi-guide wi-guide-toggle">
        <button
          type="button"
          onClick={() => {
            useAssistantManagerStore.getState().setAssistantSidebarOpen(false);
            setOpen(true);
          }}
        >
          <BookOpen size={16} />내 업무 설명
        </button>
      </div>
    );
  return (
    <aside className="wi-guide wi-guide-panel" aria-label="내 업무 설명">
      <header>
        <div>
          <span>함께 이해하며 만들어요</span>
          <h2>{metadata.opportunity.title}</h2>
        </div>
        <button
          type="button"
          aria-label="업무 설명 접기"
          onClick={() => setOpen(false)}
        >
          <X size={17} />
        </button>
      </header>
      <p className="wi-guide-intro">
        {nodes.length
          ? "단계를 누르면 해당 구성을 함께 볼 수 있어요."
          : "확인한 업무 내용을 저장했어요. 초안 만들기를 이어갈 수 있어요."}
      </p>
      {busy && (
        <p className="wi-guide-status" role="status">
          <Loader2 size={14} className="wi-spin" />
          실제 구성과 설명을 연결하고 있어요.
        </p>
      )}
      <BusinessDiagram
        opportunity={metadata.opportunity}
        selectedId={selectedId ?? undefined}
        onSelect={select}
        compact
      />
      <div className="wi-step-detail" aria-live="polite">
        {selected ? (
          <>
            <span>
              {selected.actor === "user" ? "내가 하는 일" : "AI가 돕는 일"}
            </span>
            <h3>{selected.label}</h3>
            <p>{selected.description}</p>
            {selected.kind !== "human" &&
              !selected.node_ids.some((id) =>
                nodes.some((n) => n.id === id),
              ) && <p>이 단계에 연결된 구성은 아직 확인되지 않았어요.</p>}
          </>
        ) : (
          <p>{metadata.opportunity.review}</p>
        )}
      </div>
      {error && (
        <div className="wi-error" role="alert">
          {error}
          <button type="button" onClick={() => setRetry((r) => r + 1)}>
            설명 다시 연결하기
          </button>
        </div>
      )}
      <footer>
        <button
          type="button"
          className="wi-primary"
          onClick={() => {
            if (!nodes.length) {
              useFlowBuilderWelcomeStore
                .getState()
                .setPendingMessage(buildInterviewInstruction());
              useAssistantManagerStore.getState().setAssistantSidebarOpen(true);
              return;
            }
            usePlaygroundStore.getState().setIsFullscreen(false);
            usePlaygroundStore.getState().setIsOpen(true);
          }}
        >
          <MessageSquare size={16} />
          {nodes.length ? "예시로 사용해보기" : "초안 다시 만들기"}
        </button>
        <button
          type="button"
          className="wi-guide-refresh"
          aria-label="구성 설명 새로 연결하기"
          disabled={busy}
          onClick={() => setRetry((r) => r + 1)}
        >
          <RefreshCw size={15} />
        </button>
      </footer>
      <p className="wi-scope-note">
        자료를 넣은 뒤 실행해 보세요. 메일 수신이나 정해진 시간 실행은 아직
        연결되지 않았어요.
      </p>
    </aside>
  );
}
