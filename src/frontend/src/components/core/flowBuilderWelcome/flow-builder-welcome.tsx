import { useCallback, useEffect } from "react";
import {
  buildInterviewInstruction,
  draftKey,
} from "@/components/core/workInterview/interview-state";
import type { WorkInterviewMetadata } from "@/components/core/workInterview/types";
import { WorkInterview } from "@/components/core/workInterview/work-interview";
import type { SidebarSection } from "@/components/ui/sidebar";
import useSaveFlow from "@/hooks/flows/use-save-flow";
import useAuthStore from "@/stores/authStore";
import useFlowStore from "@/stores/flowStore";
import useFlowsManagerStore from "@/stores/flowsManagerStore";
import type { StarterTemplateNameKey } from "./helpers/find-starter-template";

interface FlowBuilderWelcomeProps {
  onSubmit: (text: string) => void;
  onSelectTemplate: (nameKey: StarterTemplateNameKey) => void;
  onBrowseMore: () => void;
  onClose: () => void;
  onSelectRailItem: (section: SidebarSection) => void;
}

/** Keep the upstream entry/lifecycle contract, replacing only the empty composer. */
export function FlowBuilderWelcome({
  onSubmit,
  onBrowseMore,
  onClose,
}: FlowBuilderWelcomeProps) {
  const flowId = useFlowsManagerStore((state) => state.currentFlowId);
  const userId = useAuthStore((state) => state.userData?.id);
  const saveFlow = useSaveFlow();
  const dismiss = useCallback(() => {
    if (userId && flowId) {
      try {
        sessionStorage.removeItem(draftKey(userId, flowId));
      } catch {
        /* optional storage */
      }
    }
    onClose();
  }, [userId, flowId, onClose]);
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) dismiss();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [dismiss]);
  async function startBuild(metadata: WorkInterviewMetadata) {
    const state = useFlowStore.getState();
    const flow = state.currentFlow;
    if (!flow || flow.id !== flowId || flow.locked)
      throw new Error("Flow changed");
    state.setCurrentFlow({
      ...flow,
      name: metadata.opportunity.title,
      data: {
        ...flow.data,
        nodes: state.nodes,
        edges: state.edges,
        viewport: flow.data?.viewport ?? { x: 0, y: 0, zoom: 1 },
        work_interview: metadata,
      },
    });
    await saveFlow(undefined, { suppressErrorToast: true });
    if (useFlowStore.getState().currentFlow?.id !== flowId) return;
    if (userId && flowId) {
      try {
        sessionStorage.removeItem(draftKey(userId, flowId));
      } catch {
        /* optional storage */
      }
    }
    onSubmit(buildInterviewInstruction());
  }
  if (!flowId || !userId) return null;
  return (
    <WorkInterview
      key={`${userId}:${flowId}`}
      flowId={flowId}
      userId={userId}
      onBuild={startBuild}
      onClose={dismiss}
      onBrowseTemplates={onBrowseMore}
    />
  );
}
