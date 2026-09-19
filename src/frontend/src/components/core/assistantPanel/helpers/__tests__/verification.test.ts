import type { AgenticTestResult } from "@/controllers/API/queries/agentic";
import { testResultFromComplete } from "../verification";

describe("testResultFromComplete", () => {
  it("should_return_the_structured_result", () => {
    const structured: AgenticTestResult = {
      status: "failed",
      error: { kind: "fixable", component_name: "Parser" },
    };

    expect(testResultFromComplete({ test_result: structured })).toBe(
      structured,
    );
  });

  it("should_ignore_a_result_without_a_status", () => {
    expect(
      testResultFromComplete({ test_result: {} as AgenticTestResult }),
    ).toBeUndefined();
  });

  it("should_report_nothing_when_the_turn_ran_no_test", () => {
    expect(testResultFromComplete({})).toBeUndefined();
  });
});
