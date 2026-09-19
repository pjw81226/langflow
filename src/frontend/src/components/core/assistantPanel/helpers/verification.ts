/**
 * Reading a turn's test outcome off the `complete` event.
 *
 * Newer servers send a structured `test_result`. Older ones only send the
 * `verified` boolean and a caveat sentence that is also appended to the answer
 * text; both are still understood so the panel works against either.
 */

import type {
  AgenticCompleteData,
  AgenticTestResult,
} from "@/controllers/API/queries/agentic";

const NOT_FIXABLE_KINDS = new Set(["external_resource", "timeout"]);

export function testResultFromComplete(
  data: Pick<
    AgenticCompleteData,
    "test_result" | "verified" | "verification_caveat"
  >,
): AgenticTestResult | undefined {
  if (data.test_result?.status) return data.test_result;
  if (data.verified === true) return { status: "passed", trigger: "build" };
  if (data.verified === false) {
    // The boolean cannot tell "needs your API key" from "broken". Claiming a
    // failure the assistant could fix would be a guess, so stay on the side
    // that never offers a fix that cannot work.
    return {
      status: "needs_attention",
      trigger: "build",
      error: { kind: "unknown", message: data.verification_caveat },
    };
  }
  return undefined;
}

/**
 * The backend appends the caveat to the answer as "\n\n⚠️ <caveat>". Once a
 * result card shows it, the sentence in the text is a duplicate. More text can
 * follow the caveat, so remove that exact piece rather than cutting a suffix.
 */
export function stripVerificationCaveat(
  text: string,
  caveat: string | undefined,
): string {
  if (!caveat) return text;
  return text.replace(`\n\n⚠️ ${caveat}`, "").trim();
}

/** "Fix it" is only honest when the assistant can actually change the outcome. */
export function canOfferFix(result: AgenticTestResult | undefined): boolean {
  if (result?.status !== "failed") return false;
  return !NOT_FIXABLE_KINDS.has(result.error?.kind ?? "unknown");
}
