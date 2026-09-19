import i18n from "@/i18n";

/**
 * The language the UI is rendered in, as a BCP 47 tag for `Intl`.
 *
 * Dates shown next to translated labels have to follow the language the user
 * picked, not the one the code was written in: `8/27, 4:45:21 PM` reads as a
 * different date to a reader of `27/08, 16:45:21`, and a hardcoded `"en-US"`
 * gives every non-English locale the American reading.
 *
 * Returns `undefined` when i18n has not resolved a language yet, which makes
 * `Intl` fall back to the browser's locale rather than to a language nobody
 * chose.
 */
export function uiLocale(): string | undefined {
  return i18n.language || undefined;
}

const RELATIVE_TIME_STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 60 * 60],
  ["month", 30 * 24 * 60 * 60],
  ["day", 24 * 60 * 60],
  ["hour", 60 * 60],
  ["minute", 60],
];

/**
 * "3 minutes ago" in the UI language.
 *
 * `moment().fromNow()` stays English unless a moment locale is loaded and
 * selected, which this app never does, so relative times were the one part of
 * a translated row that never changed language.
 */
export function formatRelativeTime(
  date: Date | string | number,
  now: Date = new Date(),
): string {
  const seconds = Math.round((new Date(date).getTime() - now.getTime()) / 1000);
  const formatter = new Intl.RelativeTimeFormat(uiLocale(), {
    numeric: "auto",
  });
  for (const [unit, unitSeconds] of RELATIVE_TIME_STEPS) {
    if (Math.abs(seconds) >= unitSeconds) {
      return formatter.format(Math.trunc(seconds / unitSeconds), unit);
    }
  }
  return formatter.format(Math.trunc(seconds), "second");
}
