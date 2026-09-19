import i18n from "@/i18n";
import en from "@/locales/en.json";
import {
  ASSISTANT_PLACEHOLDER_KEYS,
  ASSISTANT_TITLE,
  getAssistantPlaceholder,
  getAssistantPlaceholderKey,
} from "../assistant-panel.constants";

const englishPlaceholders = ASSISTANT_PLACEHOLDER_KEYS.map(
  (key) => (en as Record<string, string>)[key],
);

describe("assistant-panel.constants", () => {
  describe("ASSISTANT_TITLE", () => {
    it("should be Langflow Assistant", () => {
      expect(ASSISTANT_TITLE).toBe("Langflow Assistant");
    });
  });

  describe("ASSISTANT_PLACEHOLDER_KEYS", () => {
    it("should have at least 2 options for randomization", () => {
      expect(ASSISTANT_PLACEHOLDER_KEYS.length).toBeGreaterThanOrEqual(2);
    });

    it("should point at non-empty English strings", () => {
      for (const placeholder of englishPlaceholders) {
        expect(typeof placeholder).toBe("string");
        expect(placeholder.length).toBeGreaterThan(0);
      }
    });
  });

  describe("getAssistantPlaceholderKey", () => {
    it("should return one of the placeholder keys", () => {
      const results = Array.from({ length: 10 }, () =>
        getAssistantPlaceholderKey(),
      );

      for (const result of results) {
        expect(ASSISTANT_PLACEHOLDER_KEYS).toContain(result);
      }
    });
  });

  describe("getAssistantPlaceholder", () => {
    it("should return a non-empty string", () => {
      const result = getAssistantPlaceholder();

      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    });

    it("should return one of the translated placeholders", () => {
      const results = Array.from({ length: 10 }, () =>
        getAssistantPlaceholder(),
      );

      for (const result of results) {
        expect(englishPlaceholders).toContain(result);
      }
    });

    it("should translate when called, not when the module is imported", async () => {
      // The saved language bundle loads after this module is imported, so a
      // bundle added later must still be picked up.
      const previousLanguage = i18n.language;
      const translated = Object.fromEntries(
        ASSISTANT_PLACEHOLDER_KEYS.map((key, index) => [key, `late-${index}`]),
      );
      i18n.addResourceBundle("xx", "translation", translated);
      await i18n.changeLanguage("xx");

      try {
        expect(Object.values(translated)).toContain(getAssistantPlaceholder());
      } finally {
        await i18n.changeLanguage(previousLanguage);
        i18n.removeResourceBundle("xx", "translation");
      }
    });
  });
});
