import { useCallback, useMemo, useState } from "react";
import useFlowStore from "@/stores/flowStore";
import {
  getPromptTargets,
  type PromptTarget,
  promptTargetKey,
} from "../helpers/prompt-targets";

interface UsePromptTargetReturn {
  targets: PromptTarget[];
  selected: PromptTarget | null;
  select: (target: PromptTarget) => void;
}

/**
 * The agents and models a Prompt turn can write for, and the one it is for.
 *
 * Until the user picks one, the component selected on the canvas wins, then
 * the first one. A pick that leaves the canvas falls back the same way.
 */
export function usePromptTarget(enabled: boolean): UsePromptTargetReturn {
  // A selector must return a primitive: a fresh array on every store update
  // would make useSyncExternalStore loop. The JSON string only changes when
  // the targets do.
  const serialized = useFlowStore((state) =>
    enabled
      ? JSON.stringify(getPromptTargets(state.nodes ?? [], state.edges ?? []))
      : "[]",
  );
  const targets = useMemo<PromptTarget[]>(
    () => JSON.parse(serialized),
    [serialized],
  );
  const [chosenKey, setChosenKey] = useState<string | null>(null);

  const selected =
    targets.find((target) => promptTargetKey(target) === chosenKey) ??
    targets.find((target) => target.selectedOnCanvas) ??
    targets[0] ??
    null;

  const select = useCallback((target: PromptTarget) => {
    setChosenKey(promptTargetKey(target));
  }, []);

  return { targets, selected, select };
}
