import i18n from "@/i18n";
import { formatRelativeTime, uiLocale } from "../format-date";

describe("uiLocale", () => {
  const original = i18n.language;

  afterEach(() => {
    i18n.language = original;
  });

  it("should report the language the UI is rendered in", () => {
    i18n.language = "pt";

    expect(uiLocale()).toBe("pt");
  });

  // Intl treats `undefined` as "use the runtime's locale", which is a better
  // guess than pinning a language the user never chose.
  it("should defer to the runtime before i18n resolves a language", () => {
    i18n.language = "" as unknown as string;

    expect(uiLocale()).toBeUndefined();
  });

  // The formatting the modal was getting wrong: same instant, two languages.
  it("should drive Intl formatting per language", () => {
    const instant = new Date("2026-08-27T16:45:21Z");
    const options: Intl.DateTimeFormatOptions = {
      month: "numeric",
      day: "numeric",
      timeZone: "UTC",
    };

    i18n.language = "en";
    const english = instant.toLocaleString(uiLocale(), options);
    i18n.language = "pt";
    const portuguese = instant.toLocaleString(uiLocale(), options);

    expect(english).toBe("8/27");
    expect(portuguese).toBe("27/08");
  });
});

describe("formatRelativeTime", () => {
  const original = i18n.language;
  const now = new Date("2026-08-27T12:00:00Z");

  afterEach(() => {
    i18n.language = original;
  });

  it("should pick the largest unit that fits", () => {
    i18n.language = "en";

    expect(formatRelativeTime("2026-08-27T11:57:00Z", now)).toBe(
      "3 minutes ago",
    );
    expect(formatRelativeTime("2026-08-27T07:00:00Z", now)).toBe("5 hours ago");
    expect(formatRelativeTime("2026-08-25T12:00:00Z", now)).toBe("2 days ago");
  });

  it("should follow the UI language", () => {
    i18n.language = "ko";

    expect(formatRelativeTime("2026-08-27T11:57:00Z", now)).toBe("3분 전");
  });

  it("should not report a bare zero for something that just happened", () => {
    i18n.language = "en";

    expect(formatRelativeTime(now, now)).toBe("now");
  });
});
