import { act, renderHook } from "@testing-library/react";
import useFlowStore from "@/stores/flowStore";
import type { AllNodeType } from "@/types/flow";
import { usePromptTarget } from "../use-prompt-target";

function agent(id: string, selected = false): AllNodeType {
  return {
    id,
    type: "genericNode",
    position: { x: 0, y: 0 },
    selected,
    data: {
      id,
      type: "Agent",
      node: {
        display_name: "Agent",
        template: {
          system_prompt: {
            show: true,
            value: "",
            display_name: "Agent Instructions",
          },
        },
      },
    },
  } as unknown as AllNodeType;
}

function setCanvas(nodes: AllNodeType[]) {
  act(() => {
    useFlowStore.setState({ nodes, edges: [] });
  });
}

describe("usePromptTarget", () => {
  beforeEach(() => {
    useFlowStore.setState({ nodes: [], edges: [] });
  });

  it("should_list_nothing_while_disabled", () => {
    useFlowStore.setState({ nodes: [agent("Agent-1")], edges: [] });

    const { result } = renderHook(() => usePromptTarget(false));

    expect(result.current.targets).toEqual([]);
    expect(result.current.selected).toBeNull();
  });

  it("should_default_to_the_first_target", () => {
    useFlowStore.setState({
      nodes: [agent("Agent-1"), agent("Agent-2")],
      edges: [],
    });

    const { result } = renderHook(() => usePromptTarget(true));

    expect(result.current.targets.map((t) => t.label)).toEqual([
      "Agent 1",
      "Agent 2",
    ]);
    expect(result.current.selected?.componentId).toBe("Agent-1");
  });

  it("should_prefer_the_component_selected_on_the_canvas", () => {
    useFlowStore.setState({
      nodes: [agent("Agent-1"), agent("Agent-2", true)],
      edges: [],
    });

    const { result } = renderHook(() => usePromptTarget(true));

    expect(result.current.selected?.componentId).toBe("Agent-2");
  });

  it("should_keep_the_users_pick_over_the_canvas_selection", () => {
    useFlowStore.setState({
      nodes: [agent("Agent-1"), agent("Agent-2", true)],
      edges: [],
    });
    const { result } = renderHook(() => usePromptTarget(true));

    act(() => {
      result.current.select(result.current.targets[0]);
    });

    expect(result.current.selected?.componentId).toBe("Agent-1");
  });

  it("should_fall_back_when_the_pick_leaves_the_canvas", () => {
    useFlowStore.setState({
      nodes: [agent("Agent-1"), agent("Agent-2")],
      edges: [],
    });
    const { result } = renderHook(() => usePromptTarget(true));
    act(() => {
      result.current.select(result.current.targets[1]);
    });

    setCanvas([agent("Agent-1")]);

    expect(result.current.selected?.componentId).toBe("Agent-1");
  });

  it("should_keep_the_same_list_while_unrelated_state_changes", () => {
    useFlowStore.setState({ nodes: [agent("Agent-1")], edges: [] });
    const { result } = renderHook(() => usePromptTarget(true));
    const before = result.current.targets;

    act(() => {
      useFlowStore.setState({ isBuilding: true });
    });

    expect(result.current.targets).toBe(before);
  });
});
