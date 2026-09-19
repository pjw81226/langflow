import { act, renderHook } from "@testing-library/react";
import useAssistantManagerStore from "@/stores/assistantManagerStore";
import { useUtilityStore } from "@/stores/utilityStore";
import { useAssistantDock } from "../use-assistant-dock";

const mockFitView = jest.fn();
jest.mock("@/stores/flowStore", () => ({
  __esModule: true,
  default: {
    getState: () => ({ reactFlowInstance: { fitView: mockFitView } }),
  },
}));

function setViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });
}

describe("useAssistantDock", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    setViewportWidth(1440);
    useUtilityStore.setState({ assistantDockDefault: false });
    useAssistantManagerStore.setState({ assistantDocked: false });
  });

  it("should_float_until_the_user_docks_it", () => {
    const { result } = renderHook(() => useAssistantDock());
    expect(result.current.isDocked).toBe(false);

    act(() => result.current.toggleDock());

    expect(result.current.isDocked).toBe(true);
    expect(localStorage.getItem("langflow-assistant-docked")).toBe("true");
  });

  it("should_follow_a_deployment_default_that_arrives_after_mount", () => {
    // /config can land after the always-mounted panel has rendered.
    const { result } = renderHook(() => useAssistantDock());
    expect(result.current.isDocked).toBe(false);

    act(() => useUtilityStore.setState({ assistantDockDefault: true }));

    expect(result.current.isDocked).toBe(true);
  });

  it("should_remember_an_explicit_undock_over_the_deployment_default", () => {
    useUtilityStore.setState({ assistantDockDefault: true });
    const { result } = renderHook(() => useAssistantDock());
    expect(result.current.isDocked).toBe(true);

    act(() => result.current.toggleDock());

    expect(result.current.isDocked).toBe(false);
    expect(localStorage.getItem("langflow-assistant-docked")).toBe("false");
  });

  it("should_tell_the_rest_of_the_page_whether_the_panel_is_docked", () => {
    const { result, unmount } = renderHook(() => useAssistantDock());

    act(() => result.current.toggleDock());
    expect(useAssistantManagerStore.getState().assistantDocked).toBe(true);

    unmount();
    expect(useAssistantManagerStore.getState().assistantDocked).toBe(false);
  });

  it("should_not_dock_where_the_canvas_would_be_left_too_narrow", () => {
    localStorage.setItem("langflow-assistant-docked", "true");
    setViewportWidth(900);

    const { result } = renderHook(() => useAssistantDock());

    expect(result.current.canDock).toBe(false);
    expect(result.current.isDocked).toBe(false);
  });

  it("should_widen_when_its_left_edge_is_dragged_towards_the_canvas", () => {
    const { result } = renderHook(() => useAssistantDock());
    const start = result.current.dockWidth;

    act(() => {
      result.current.handleDockResize({
        clientX: 1000,
        preventDefault: jest.fn(),
        stopPropagation: jest.fn(),
      } as unknown as React.MouseEvent);
    });
    act(() => {
      document.dispatchEvent(new MouseEvent("mousemove", { clientX: 900 }));
    });
    expect(result.current.dockWidth).toBe(start + 100);

    act(() => {
      document.dispatchEvent(new MouseEvent("mouseup"));
    });
    expect(localStorage.getItem("langflow-assistant-panel-dock-width")).toBe(
      String(start + 100),
    );
  });

  it("should_refit_the_canvas_when_the_user_changes_the_layout", () => {
    jest.useFakeTimers();
    try {
      const { result } = renderHook(() => useAssistantDock());
      // Mounting and re-rendering never move the user's view.
      jest.runOnlyPendingTimers();
      expect(mockFitView).not.toHaveBeenCalled();

      act(() => result.current.toggleDock());
      jest.runOnlyPendingTimers();

      expect(mockFitView).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
});
