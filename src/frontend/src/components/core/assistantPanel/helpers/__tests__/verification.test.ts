import {
  canOfferFix,
  stripVerificationCaveat,
  testResultFromComplete,
} from "../verification";

describe("testResultFromComplete", () => {
  it("should_prefer_the_structured_result", () => {
    const structured = {
      status: "failed" as const,
      error: { kind: "fixable", component_name: "Parser" },
    };

    expect(
      testResultFromComplete({ test_result: structured, verified: false }),
    ).toBe(structured);
  });

  it("should_read_a_pass_from_an_older_server", () => {
    expect(testResultFromComplete({ verified: true })).toEqual({
      status: "passed",
      trigger: "build",
    });
  });

  it("should_not_call_an_older_servers_failure_fixable", () => {
    // verified:false covers both "needs your API key" and "broken".
    const result = testResultFromComplete({
      verified: false,
      verification_caveat: "I couldn't fully run it here.",
    });

    expect(result?.status).toBe("needs_attention");
    expect(result?.error?.message).toBe("I couldn't fully run it here.");
    expect(canOfferFix(result)).toBe(false);
  });

  it("should_report_nothing_when_the_turn_ran_no_test", () => {
    expect(testResultFromComplete({})).toBeUndefined();
  });
});

describe("stripVerificationCaveat", () => {
  it("should_remove_the_caveat_the_card_now_shows", () => {
    expect(
      stripVerificationCaveat(
        "Built the flow.\n\n⚠️ I couldn't fully run it here.",
        "I couldn't fully run it here.",
      ),
    ).toBe("Built the flow.");
  });

  it("should_keep_text_that_follows_the_caveat", () => {
    expect(
      stripVerificationCaveat(
        "Built the flow.\n\n⚠️ It failed.\n\nI rebuilt the canvas while fixing it.",
        "It failed.",
      ),
    ).toBe("Built the flow.\n\nI rebuilt the canvas while fixing it.");
  });

  it("should_leave_the_text_alone_without_a_caveat", () => {
    expect(stripVerificationCaveat("Built the flow.", undefined)).toBe(
      "Built the flow.",
    );
  });
});

describe("canOfferFix", () => {
  it("should_offer_a_fix_for_a_failure_the_assistant_can_change", () => {
    expect(canOfferFix({ status: "failed", error: { kind: "fixable" } })).toBe(
      true,
    );
    expect(canOfferFix({ status: "failed", error: { kind: "unknown" } })).toBe(
      true,
    );
    expect(canOfferFix({ status: "failed" })).toBe(true);
  });

  it.each(["external_resource", "timeout"])(
    "should_not_offer_a_fix_for_%s",
    (kind) => {
      expect(canOfferFix({ status: "failed", error: { kind } })).toBe(false);
    },
  );

  it.each(["passed", "needs_attention", "skipped"] as const)(
    "should_not_offer_a_fix_when_the_status_is_%s",
    (status) => {
      expect(canOfferFix({ status })).toBe(false);
    },
  );

  it("should_not_offer_a_fix_without_a_result", () => {
    expect(canOfferFix(undefined)).toBe(false);
  });
});
