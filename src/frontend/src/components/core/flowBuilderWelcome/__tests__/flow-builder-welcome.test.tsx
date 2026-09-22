import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Edge } from "@xyflow/react";
import type { WorkInterviewMetadata } from "@/components/core/workInterview/types";
import type { WorkInterviewProps } from "@/components/core/workInterview/work-interview";
import type { AllNodeType, FlowType } from "@/types/flow";
import { FlowBuilderWelcome } from "../flow-builder-welcome";

const metadata: WorkInterviewMetadata = {
  version: 1,
  answers: {
    role: "품질",
    task: "보고 정리",
    sources: [],
    process: "확인",
    output: "표",
  },
  follow_up_answers: [],
  summary: "매일 보고",
  confirmed_suggested_rules: [],
  opportunity: {
    id: "report",
    title: "보고 정리",
    description: "정리",
    input: "텍스트",
    output: "표",
    review: "확인",
    steps: [],
    edges: [],
    rules: [],
  },
};
const save = jest.fn().mockResolvedValue(undefined);
const setCurrentFlow = jest.fn((flow: FlowType) => {
  state.currentFlow = flow;
});
let state: {
  currentFlow: FlowType;
  nodes: AllNodeType[];
  edges: Edge[];
  setCurrentFlow: typeof setCurrentFlow;
};
jest.mock("@/hooks/flows/use-save-flow", () => ({
  __esModule: true,
  default: () => save,
}));
jest.mock("@/stores/flowStore", () => ({
  __esModule: true,
  default: { getState: () => state },
}));
jest.mock("@/stores/flowsManagerStore", () => ({
  __esModule: true,
  default: (selector: (s: { currentFlowId: string }) => unknown) =>
    selector({ currentFlowId: "flow" }),
}));
jest.mock("@/stores/authStore", () => ({
  __esModule: true,
  default: (selector: (s: { userData: { id: string } }) => unknown) =>
    selector({ userData: { id: "user" } }),
}));
jest.mock("@/components/core/workInterview/work-interview", () => ({
  WorkInterview: ({
    onBuild,
    onClose,
    onBrowseTemplates,
  }: WorkInterviewProps) => (
    <div aria-label="업무 인터뷰">
      <button
        onClick={() => {
          void Promise.resolve(onBuild(metadata)).catch(() => {});
        }}
      >
        초안 만들기
      </button>
      <button onClick={onClose}>직접 만들기</button>
      <button onClick={onBrowseTemplates}>템플릿 보기</button>
    </div>
  ),
}));

function mount() {
  const props = {
    onSubmit: jest.fn(),
    onClose: jest.fn(),
    onBrowseMore: jest.fn(),
    onSelectTemplate: jest.fn(),
    onSelectRailItem: jest.fn(),
  };
  render(<FlowBuilderWelcome {...props} />);
  return props;
}

beforeEach(() => {
  jest.clearAllMocks();
  sessionStorage.clear();
  save.mockResolvedValue(undefined);
  state = {
    currentFlow: {
      id: "flow",
      name: "Untitled",
      description: "",
      data: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
    },
    nodes: [],
    edges: [],
    setCurrentFlow,
  };
});

it("replaces the old empty composer with the work interview", () => {
  mount();
  expect(screen.getByLabelText("업무 인터뷰")).toBeInTheDocument();
  expect(
    screen.queryByTestId("flow-builder-welcome-textarea"),
  ).not.toBeInTheDocument();
});

it("persists the approved context before handing it to the existing assistant", async () => {
  const props = mount();
  fireEvent.click(screen.getByText("초안 만들기"));
  await waitFor(() => expect(props.onSubmit).toHaveBeenCalled());
  expect(state.currentFlow.data!.work_interview).toEqual(metadata);
  expect(state.currentFlow.name).toBe("보고 정리");
  expect(save.mock.invocationCallOrder[0]).toBeLessThan(
    props.onSubmit.mock.invocationCallOrder[0],
  );
  expect(props.onSubmit.mock.calls[0][0]).toContain("자동 실행하지 마세요");
});

it("does not start generation if saving the interview fails", async () => {
  save.mockRejectedValue(new Error("save failed"));
  const props = mount();
  fireEvent.click(screen.getByText("초안 만들기"));
  await waitFor(() => expect(save).toHaveBeenCalled());
  expect(props.onSubmit).not.toHaveBeenCalled();
});

it("keeps manual and template exits and clears only this draft on explicit close", () => {
  sessionStorage.setItem("work-interview:v1:user:flow", "draft");
  sessionStorage.setItem("work-interview:v1:other:flow", "other draft");
  const props = mount();
  fireEvent.click(screen.getByText("템플릿 보기"));
  expect(props.onBrowseMore).toHaveBeenCalled();
  fireEvent.click(screen.getByText("직접 만들기"));
  expect(props.onClose).toHaveBeenCalled();
  expect(sessionStorage.getItem("work-interview:v1:user:flow")).toBeNull();
  expect(sessionStorage.getItem("work-interview:v1:other:flow")).toBe(
    "other draft",
  );
});
