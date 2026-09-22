import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AllNodeType, FlowType } from "@/types/flow";
import { postInterview } from "../interview-api";
import type { WorkInterviewMetadata } from "../types";
import { WorkInterviewGuide } from "../work-interview-guide";

const save = jest.fn().mockResolvedValue(undefined);
const fitView = jest.fn();
const openPlayground = jest.fn();
const setNodes = jest.fn();
const setCurrentFlow = jest.fn();
const metadata: WorkInterviewMetadata = {
  version: 1,
  answers: {
    role: "품질",
    task: "보고",
    sources: [],
    process: "검토",
    output: "표",
  },
  summary: "검사 보고",
  follow_up_answers: [],
  confirmed_suggested_rules: [],
  opportunity: {
    id: "report",
    title: "검사 보고",
    description: "보고 정리",
    input: "메일",
    output: "표",
    review: "직접 확인",
    rules: [],
    steps: [
      {
        id: "read",
        label: "자료 읽기",
        description: "항목 찾기",
        kind: "input",
        actor: "ai",
        node_ids: ["real", "deleted"],
      },
      {
        id: "review",
        label: "직접 확인",
        description: "내가 판단해요",
        kind: "human",
        actor: "user",
        node_ids: ["real"],
      },
    ],
    edges: [{ source: "read", target: "review", label: "" }],
  },
};
let state: {
  currentFlow: FlowType;
  nodes: AllNodeType[];
  edges: [];
  setNodes: typeof setNodes;
  setCurrentFlow: typeof setCurrentFlow;
  reactFlowInstance: { fitView: typeof fitView };
};
jest.mock("@/stores/flowStore", () => ({
  __esModule: true,
  default: Object.assign(
    (selector: (s: typeof state) => unknown) => selector(state),
    { getState: () => state },
  ),
}));
jest.mock("@/stores/authStore", () => ({
  __esModule: true,
  default: () => "user",
}));
jest.mock("@/stores/assistantManagerStore", () => ({
  __esModule: true,
  default: Object.assign(() => false, {
    getState: () => ({ setAssistantSidebarOpen: jest.fn() }),
  }),
}));
jest.mock("@/stores/flowBuilderWelcomeStore", () => ({
  __esModule: true,
  default: () => false,
}));
jest.mock("@/stores/playgroundStore", () => ({
  usePlaygroundStore: Object.assign(() => false, {
    getState: () => ({ setIsFullscreen: jest.fn(), setIsOpen: openPlayground }),
  }),
}));
jest.mock("@/hooks/flows/use-save-flow", () => ({
  __esModule: true,
  default: () => save,
}));
jest.mock("../../assistantPanel/hooks/use-assistant-selected-model", () => ({
  useAssistantSelectedModel: () => [{ provider: "OpenAI", name: "gpt-5.4" }],
}));
jest.mock("../interview-api", () => ({
  postInterview: jest.fn(),
  interviewError: () => "설명을 연결하지 못했어요.",
}));

beforeEach(() => {
  jest.clearAllMocks();
  state = {
    currentFlow: {
      id: "flow",
      name: "검사",
      description: "",
      data: {
        nodes: [],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        work_interview: metadata,
      },
    },
    nodes: [
      {
        id: "real",
        type: "genericNode",
        position: { x: 0, y: 0 },
        data: { type: "ChatInput" },
      } as AllNodeType,
    ],
    edges: [],
    setNodes,
    setCurrentFlow,
    reactFlowInstance: { fitView },
  };
  (postInterview as jest.Mock).mockResolvedValue({
    summary: "검사 보고",
    examples: [],
    follow_up_questions: [],
    opportunities: [metadata.opportunity],
  });
});

it("highlights only real nodes, keeps human steps manual, and opens sample input without running", async () => {
  render(<WorkInterviewGuide />);
  await waitFor(() => expect(setCurrentFlow).toHaveBeenCalled());
  fireEvent.click(
    screen.getByRole("button", { name: /자료 읽기.*AI가 돕는 일/ }),
  );
  expect(fitView).toHaveBeenCalledWith(
    expect.objectContaining({ nodes: [{ id: "real" }] }),
  );
  fitView.mockClear();
  fireEvent.click(
    screen.getByRole("button", { name: /직접 확인.*내가 하는 일/ }),
  );
  expect(fitView).not.toHaveBeenCalled();
  expect(setNodes.mock.calls.at(-1)?.[0][0].selected).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "예시로 사용해보기" }));
  expect(openPlayground).toHaveBeenCalledWith(true);
});

it("does not repeat a completed model request when the guide is reopened", async () => {
  render(<WorkInterviewGuide />);
  await waitFor(() => expect(setCurrentFlow).toHaveBeenCalled());
  fireEvent.click(screen.getByRole("button", { name: "업무 설명 접기" }));
  fireEvent.click(screen.getByRole("button", { name: "내 업무 설명" }));
  expect(
    screen.getByRole("complementary", { name: "내 업무 설명" }),
  ).toBeInTheDocument();
  expect(postInterview).toHaveBeenCalledTimes(1);
});

it("reveals linked nodes on narrow screens without padding away the whole canvas", async () => {
  const original = window.matchMedia("");
  const query = jest
    .spyOn(window, "matchMedia")
    .mockImplementation((media) => ({
      ...original,
      matches: media === "(max-width: 760px)",
    }));
  render(<WorkInterviewGuide />);
  await waitFor(() => expect(setCurrentFlow).toHaveBeenCalled());
  fireEvent.click(
    screen.getByRole("button", { name: /자료 읽기.*AI가 돕는 일/ }),
  );
  expect(fitView).toHaveBeenCalledWith(
    expect.objectContaining({
      padding: expect.objectContaining({ left: "24px", right: "24px" }),
    }),
  );
  expect(
    screen.queryByRole("complementary", { name: "내 업무 설명" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "내 업무 설명" }),
  ).toBeInTheDocument();
  query.mockRestore();
});

it("discards an explanation when the user has moved to a different flow", async () => {
  let resolveResponse!: (value: unknown) => void;
  (postInterview as jest.Mock).mockReturnValue(
    new Promise((resolve) => {
      resolveResponse = resolve;
    }),
  );
  render(<WorkInterviewGuide />);
  await waitFor(() => expect(postInterview).toHaveBeenCalled());
  state.currentFlow = { ...state.currentFlow, id: "another" };
  resolveResponse({ opportunities: [metadata.opportunity] });
  await waitFor(() =>
    expect(screen.queryByRole("status")).not.toBeInTheDocument(),
  );
  expect(setCurrentFlow).not.toHaveBeenCalled();
});
