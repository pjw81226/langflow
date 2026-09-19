/**
 * The assistant panel's own labels, as {English: shown in the UI language}.
 *
 * Sent with Ask turns when the UI is not in English. The documentation the Ask
 * agent searches is English, so a label the user quotes in their language ("값을
 * 넣어야 실행됩니다") means nothing to it unless it can map it back to the label
 * the docs describe ("Needs your input to run"), and the other way round when it
 * tells the user what to click.
 *
 * Only labels the docs mention by name belong here. It is a lookup table, not a
 * copy of the locale file.
 */

import i18n from "@/i18n";

const GLOSSARY_KEYS = [
  "assistant.mode.component",
  "assistant.mode.prompt",
  "assistant.mode.ask",
  "assistant.test.action",
  "assistant.test.testAgain",
  "assistant.test.openPlayground",
  "assistant.test.passed",
  "assistant.test.failed",
  "assistant.test.needsAttention",
  "assistant.test.notTested",
  "assistant.test.details",
  "assistant.dock.dock",
  "assistant.dock.undock",
  "assistant.close",
  "assistant.newSession",
  "assistant.continue",
  "assistant.componentResult.approve",
] as const;

export function buildUiGlossary(): Record<string, string> | undefined {
  const language = i18n.language;
  if (!language || language === "en") return undefined;

  const english = i18n.getFixedT("en");
  const glossary: Record<string, string> = {};
  for (const key of GLOSSARY_KEYS) {
    const source = english(key);
    const shown = i18n.t(key);
    // Untranslated (or missing) labels tell the agent nothing.
    if (source && shown && source !== shown && source !== key) {
      glossary[source] = shown;
    }
  }
  return Object.keys(glossary).length > 0 ? glossary : undefined;
}
