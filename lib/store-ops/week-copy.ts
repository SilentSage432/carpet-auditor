/**
 * Presentation-only week chrome copy.
 * Does not compute ISO or staging weeks — callers pass already-resolved labels.
 */

/** Map Master/locator header: calendar ISO week of the device-local date. */
export function formatMapCalendarWeekChrome(
  currentWeek: string,
  mode: "master" | "locator"
): string {
  const week = String(currentWeek ?? "").trim();
  if (mode === "locator") {
    return week
      ? `Bay locator · Calendar week · ${week}`
      : "Bay locator";
  }
  return week ? `Calendar week · ${week}` : "Calendar week";
}
