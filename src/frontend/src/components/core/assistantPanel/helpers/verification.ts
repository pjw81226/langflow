/**
 * Reading a test turn's outcome off the `complete` event.
 */

import type {
  AgenticCompleteData,
  AgenticTestResult,
} from "@/controllers/API/queries/agentic";

export const testResultFromComplete = (
  data: Pick<AgenticCompleteData, "test_result">,
): AgenticTestResult | undefined =>
  data.test_result?.status ? data.test_result : undefined;
