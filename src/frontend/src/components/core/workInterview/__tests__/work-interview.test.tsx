import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { postInterview } from "../interview-api";
import { createDraft, draftKey } from "../interview-state";
import { WorkInterview } from "../work-interview";

jest.mock("../interview-api", () => ({
  postInterview: jest.fn(),
  interviewError: () => "AI와 연결하지 못했어요. 다시 시도해 주세요.",
}));
jest.mock("../../assistantPanel/hooks/use-assistant-selected-model", () => ({
  useAssistantSelectedModel: () => [
    { id: "gpt", name: "gpt-5.4", provider: "OpenAI", displayName: "GPT" },
    jest.fn(),
  ],
}));
jest.mock("../../assistantPanel/hooks/use-enabled-models", () => ({
  useEnabledModels: () => ({
    isCatalogReady: true,
    hasEnabledModels: true,
    isModelEnabled: () => true,
  }),
}));
jest.mock("../../assistantPanel/components/model-selector", () => ({
  ModelSelector: () => <span>GPT</span>,
}));
jest.mock("@/modals/modelProviderModal", () => ({
  __esModule: true,
  default: () => null,
}));

const recommendation = {
  summary: "매일 메일 내용을 표로 정리해요.",
  examples: [],
  follow_up_questions: [],
  opportunities: [
    {
      id: "mail",
      title: "메일 확인 목록",
      description: "필요한 항목을 모아요.",
      input: "메일 내용",
      output: "확인 목록",
      review: "결과를 확인해요.",
      rules: [{ text: "날짜가 없으면 직접 확인", source: "suggested" }],
      steps: [
        {
          id: "input",
          label: "메일 내용 넣기",
          description: "메일을 붙여넣어요.",
          kind: "input",
          actor: "user",
          node_ids: [],
        },
        {
          id: "review",
          label: "직접 확인",
          description: "빠진 내용을 살펴봐요.",
          kind: "human",
          actor: "user",
          node_ids: [],
        },
      ],
      edges: [{ source: "input", target: "review", label: "" }],
    },
  ],
};

function mount() {
  const onBuild = jest.fn().mockResolvedValue(undefined);
  render(
    <WorkInterview
      flowId="flow"
      userId="user"
      onBuild={onBuild}
      onClose={jest.fn()}
      onBrowseTemplates={jest.fn()}
    />,
  );
  return { onBuild };
}

describe("work interview", () => {
  beforeEach(() => {
    sessionStorage.clear();
    jest.clearAllMocks();
  });

  it("starts with one easy question and retains selected answers when going back", () => {
    mount();
    expect(
      screen.getByRole("heading", {
        name: "어떤 팀에서 어떤 일을 맡고 계세요?",
      }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "품질·검사 결과를 확인해요" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "다음" }));
    expect(
      screen.getByRole("heading", {
        name: "평소 하시는 일 중 어떤 것을 함께 만들어볼까요?",
      }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "이전" }));
    expect(screen.getByRole("textbox")).toHaveValue(
      "품질·검사 결과를 확인해요",
    );
  });

  it("offers a concrete memory prompt when the user does not know how to answer", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "잘 모르겠어요" }));
    expect(screen.getByText(/오늘 출근해서 처음 한 일/)).toBeInTheDocument();
  });

  it("keeps answers after an API failure and retries the same interview", async () => {
    const draft = createDraft();
    draft.question = 4;
    draft.answers.task = "메일 확인";
    draft.answers.output = "정리된 표";
    sessionStorage.setItem(draftKey("user", "flow"), JSON.stringify(draft));
    (postInterview as jest.Mock)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(recommendation);
    mount();
    fireEvent.click(
      screen.getByRole("button", { name: "함께 만들 일 찾아보기" }),
    );
    await screen.findByRole("alert");
    expect(screen.getByRole("textbox")).toHaveValue("정리된 표");
    fireEvent.click(
      screen.getByRole("button", { name: "함께 만들 일 찾아보기" }),
    );
    await screen.findByRole("heading", { name: "메일 확인 목록" });
    expect(
      screen.getByText("매일 메일 내용을 표로 정리해요."),
    ).toBeInTheDocument();
  });

  it("lets users inspect steps and requires suggested-rule confirmation before handoff", async () => {
    const draft = {
      ...createDraft(),
      screen: "opportunities",
      response: recommendation,
    };
    sessionStorage.setItem(draftKey("user", "flow"), JSON.stringify(draft));
    const { onBuild } = mount();
    fireEvent.click(screen.getByRole("button", { name: /이 일 함께 만들기/ }));
    fireEvent.click(
      screen.getByRole("button", { name: /직접 확인.*내가 하는 일/ }),
    );
    expect(screen.getByText("빠진 내용을 살펴봐요.")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "이 내용으로 초안 만들기" }),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole("checkbox", { name: /날짜가 없으면 직접 확인/ }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "이 내용으로 초안 만들기" }),
    );
    await waitFor(() =>
      expect(onBuild).toHaveBeenCalledWith(
        expect.objectContaining({
          confirmed_suggested_rules: ["날짜가 없으면 직접 확인"],
        }),
      ),
    );
  });

  it("offers clearly labelled examples after clarification is exhausted", async () => {
    const draft = createDraft();
    draft.question = 4;
    draft.follow_up_answers = [
      { question: "어떤 자료인가요?", answer: "잘 모르겠어요" },
      { question: "어떤 결과인가요?", answer: "잘 모르겠어요" },
    ];
    sessionStorage.setItem(draftKey("user", "flow"), JSON.stringify(draft));
    (postInterview as jest.Mock).mockResolvedValueOnce({
      summary: "예시 중 익숙한 일을 골라보세요.",
      examples: ["예시: 메일에서 필요한 항목 모으기"],
      follow_up_questions: [],
      opportunities: [],
    });
    mount();
    fireEvent.click(
      screen.getByRole("button", { name: "함께 만들 일 찾아보기" }),
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: "예시: 메일에서 필요한 항목 모으기",
      }),
    );
    expect(screen.getByRole("textbox")).toHaveValue(
      "메일에서 필요한 항목 모으기",
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("discards a late recommendation when the user changes an earlier answer", async () => {
    const draft = createDraft();
    draft.question = 4;
    sessionStorage.setItem(draftKey("user", "flow"), JSON.stringify(draft));
    let resolveResponse!: (value: unknown) => void;
    (postInterview as jest.Mock).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveResponse = resolve;
      }),
    );
    mount();
    fireEvent.click(
      screen.getByRole("button", { name: "함께 만들 일 찾아보기" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "함께 만들 일 답변 수정" }),
    );
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "내 점검 순서 정리" },
    });
    await act(async () => resolveResponse(recommendation));
    expect(screen.getByRole("textbox")).toHaveValue("내 점검 순서 정리");
    expect(
      screen.queryByRole("heading", { name: "메일 확인 목록" }),
    ).not.toBeInTheDocument();
  });

  it("collects two clarifications once and forwards both answers together", async () => {
    const draft = {
      ...createDraft(),
      screen: "follow-up",
      response: {
        summary: "메일 확인",
        examples: [],
        opportunities: [],
        follow_up_questions: [
          "무엇을 먼저 보세요?",
          "빠진 내용은 어떻게 하나요?",
        ],
      },
    };
    sessionStorage.setItem(draftKey("user", "flow"), JSON.stringify(draft));
    (postInterview as jest.Mock).mockResolvedValueOnce(recommendation);
    mount();
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "날짜" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "함께 만들 일 찾아보기" }),
    );
    expect(postInterview).not.toHaveBeenCalled();
    expect(
      screen.getByRole("heading", { name: "빠진 내용은 어떻게 하나요?" }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "제가 확인해요" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "함께 만들 일 찾아보기" }),
    );
    await screen.findByRole("heading", { name: "메일 확인 목록" });
    expect(postInterview).toHaveBeenCalledWith(
      expect.objectContaining({
        follow_up_answers: [
          { question: "무엇을 먼저 보세요?", answer: "날짜" },
          { question: "빠진 내용은 어떻게 하나요?", answer: "제가 확인해요" },
        ],
      }),
      expect.any(AbortSignal),
    );
  });
});
