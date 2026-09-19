import i18n from "@/i18n";
import { buildUiGlossary } from "../ui-glossary";

describe("buildUiGlossary", () => {
  const original = i18n.language;

  afterEach(async () => {
    await i18n.changeLanguage(original);
    if (i18n.hasResourceBundle("xx", "translation")) {
      i18n.removeResourceBundle("xx", "translation");
    }
  });

  it("should_send_nothing_when_the_ui_is_english", async () => {
    await i18n.changeLanguage("en");

    expect(buildUiGlossary()).toBeUndefined();
  });

  it("should_map_english_labels_to_the_labels_the_user_sees", async () => {
    i18n.addResourceBundle("xx", "translation", {
      "assistant.mode.ask": "Preguntar",
      "assistant.test.needsAttention": "Necesita un dato tuyo",
    });
    await i18n.changeLanguage("xx");

    const glossary = buildUiGlossary();

    expect(glossary?.Ask).toBe("Preguntar");
    expect(glossary?.["Needs your input to run"]).toBe("Necesita un dato tuyo");
  });

  it("should_leave_out_labels_the_locale_has_not_translated", async () => {
    // fallbackLng renders them in English: nothing to map.
    i18n.addResourceBundle("xx", "translation", {
      "assistant.mode.ask": "Preguntar",
    });
    await i18n.changeLanguage("xx");

    const glossary = buildUiGlossary();

    expect(Object.keys(glossary ?? {})).toEqual(["Ask"]);
  });

  it("should_send_nothing_when_the_locale_translates_none_of_them", async () => {
    i18n.addResourceBundle("xx", "translation", {});
    await i18n.changeLanguage("xx");

    expect(buildUiGlossary()).toBeUndefined();
  });
});
