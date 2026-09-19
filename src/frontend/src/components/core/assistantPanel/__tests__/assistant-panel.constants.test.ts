import i18n from "@/i18n";
import en from "@/locales/en.json";
import { ASSISTANT_MODES } from "../assistant-modes";
import {
  ASSISTANT_PLACEHOLDER_KEYS,
  ASSISTANT_TITLE,
  getAssistantPlaceholder,
  getAssistantPlaceholderKey,
} from "../assistant-panel.constants";

const english = en as Record<string, string>;

describe("assistant-panel.constants", () => {
  describe("ASSISTANT_TITLE", () => {
    it("should be Langflow Assistant", () => {
      expect(ASSISTANT_TITLE).toBe("Langflow Assistant");
    });
  });

  describe("ASSISTANT_PLACEHOLDER_KEYS", () => {
    it.each(ASSISTANT_MODES)(
      "should_offer_several_%s_placeholders_with_english_text",
      (mode) => {
        const keys = ASSISTANT_PLACEHOLDER_KEYS[mode];

        expect(keys.length).toBeGreaterThanOrEqual(2);
        for (const key of keys) {
          expect(key.startsWith(`assistant.placeholder.${mode}.`)).toBe(true);
          expect(english[key]?.length).toBeGreaterThan(0);
        }
      },
    );
  });

  describe("getAssistantPlaceholderKey", () => {
    it("should_default_to_the_component_placeholders", () => {
      const results = Array.from({ length: 10 }, () =>
        getAssistantPlaceholderKey(),
      );

      for (const result of results) {
        expect(ASSISTANT_PLACEHOLDER_KEYS.component).toContain(result);
      }
    });

    it.each(ASSISTANT_MODES)("should_pick_a_%s_placeholder", (mode) => {
      expect(ASSISTANT_PLACEHOLDER_KEYS[mode]).toContain(
        getAssistantPlaceholderKey(mode),
      );
    });
  });

  describe("getAssistantPlaceholder", () => {
    it("should return a non-empty string", () => {
      const result = getAssistantPlaceholder();

      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    });

    it("should return one of the translated placeholders of the mode", () => {
      const askPlaceholders = ASSISTANT_PLACEHOLDER_KEYS.ask.map(
        (key) => english[key],
      );
      const results = Array.from({ length: 10 }, () =>
        getAssistantPlaceholder("ask"),
      );

      for (const result of results) {
        expect(askPlaceholders).toContain(result);
      }
    });

    it("should translate when called, not when the module is imported", async () => {
      // The saved language bundle loads after this module is imported, so a
      // bundle added later must still be picked up.
      const previousLanguage = i18n.language;
      const translated = Object.fromEntries(
        ASSISTANT_PLACEHOLDER_KEYS.component.map((key, index) => [
          key,
          `late-${index}`,
        ]),
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
