import { api } from "@/controllers/API/api";
import { getURL } from "@/controllers/API/helpers/constants";
import { isInterviewResponse } from "./interview-state";
import type { InterviewRequest, InterviewResponse } from "./types";

export async function postInterview(
  request: InterviewRequest,
  signal?: AbortSignal,
): Promise<InterviewResponse> {
  const url = getURL("AGENTIC_ASSIST_STREAM").replace(
    /\/assist\/stream$/,
    "/interview",
  );
  const response = await api.post(url, request, { signal, timeout: 90000 });
  if (!isInterviewResponse(response.data)) {
    throw new Error(
      "답변을 정리하지 못했어요. 입력한 내용은 그대로 있으니 다시 시도해 주세요.",
    );
  }
  return response.data;
}

export function interviewError(error: unknown): string {
  const status = (error as { response?: { status?: number } })?.response
    ?.status;
  if (status === 401 || status === 403)
    return "이 작업에 접근할 수 없어요. 로그인과 사용 권한을 확인해 주세요.";
  if (status === 400 || status === 404)
    return "AI 연결을 확인해 주세요. 설정에서 사용할 모델을 연결할 수 있어요.";
  if (status === 429)
    return "AI가 잠시 바빠요. 답변은 저장되어 있으니 잠시 후 다시 시도해 주세요.";
  return "AI와 연결하지 못했어요. 답변은 그대로 있으니 잠시 후 다시 시도해 주세요.";
}
