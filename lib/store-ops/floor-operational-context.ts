/**
 * FS-002B Floor operational context presentation composition.
 * Pure display helpers — does not fetch, persist, or mutate rotation engines.
 */

import type { OperationalContextRelevance } from "./operational-context";

export const FLOOR_OPERATIONAL_CONTEXT_METHOD = "floor-operational-context-v1";

export type FloorFiscalSnippet = {
  status: "ok";
  fiscal_year: number;
  fiscal_week: number;
  fiscal_period: number;
  fiscal_quarter: number;
  operational_date: string;
};

export type FloorFiscalUnavailable = {
  status: "calendar_unavailable";
  operational_date?: string;
  reason?: string;
};

export type FloorContextItem = {
  id: string;
  kind: "SEASON" | "EVENT";
  title: string;
  start_date: string;
  end_date: string;
  source_type: string;
  department_relevance: OperationalContextRelevance | null;
};

export type FloorOperationalContextInput = {
  fiscal: FloorFiscalSnippet | FloorFiscalUnavailable | null;
  active_seasons: FloorContextItem[];
  active_events: FloorContextItem[];
  department_code: string | null;
  department_label: string | null;
};

export type FloorOperationalContextView = {
  method: typeof FLOOR_OPERATIONAL_CONTEXT_METHOD;
  visible: boolean;
  fiscal_label: string | null;
  season_label: string | null;
  event_label: string | null;
  relevance_label: string | null;
  /** Compact primary lines for the strip (0–3). */
  lines: string[];
};

/** FY26 · W32 · P8 · Q3 */
export function formatFiscalContextLabel(
  fiscal: Pick<
    FloorFiscalSnippet,
    "fiscal_year" | "fiscal_week" | "fiscal_period" | "fiscal_quarter"
  >
): string {
  const yy = String(fiscal.fiscal_year).slice(-2);
  return `FY${yy} · W${fiscal.fiscal_week} · P${fiscal.fiscal_period} · Q${fiscal.fiscal_quarter}`;
}

/**
 * Overlapping seasons: first title, or "Title +N" for extras.
 * No invented precedence — array order from resolver (start ASC, title ASC).
 */
export function formatActiveSeasonLabel(
  seasons: Array<{ title: string }>
): string | null {
  if (seasons.length === 0) return null;
  const first = String(seasons[0]!.title ?? "").trim();
  if (!first) return null;
  if (seasons.length === 1) return first;
  return `${first} +${seasons.length - 1}`;
}

export function formatActiveEventLabel(
  events: Array<{ title: string }>
): string | null {
  if (events.length === 0) return null;
  const first = String(events[0]!.title ?? "").trim();
  if (!first) return null;
  if (events.length === 1) return first;
  return `${first} +${events.length - 1}`;
}

/**
 * Relevance display policy:
 * - UNSET/null → omit (not an error)
 * - NONE → omit (explicit none is noise on Floor; Master Settings retains it)
 * - LOW/MEDIUM/HIGH → "Flooring · HIGH"
 */
export function formatDepartmentRelevanceLabel(input: {
  department_label: string | null;
  relevance: OperationalContextRelevance | null | undefined;
}): string | null {
  const relevance = input.relevance ?? null;
  if (relevance == null || relevance === "NONE") return null;
  const label = String(input.department_label ?? "").trim() || "Dept";
  return `${label} · ${relevance}`;
}

/**
 * Pick relevance for the current department from the first season that has
 * a declared value, else first event. Does not invent UNSET as NONE.
 */
export function pickCurrentDepartmentRelevance(
  seasons: FloorContextItem[],
  events: FloorContextItem[]
): OperationalContextRelevance | null {
  for (const item of [...seasons, ...events]) {
    if (item.department_relevance != null) {
      return item.department_relevance;
    }
  }
  return null;
}

/**
 * Compose Floor strip view model from fiscal + resolved contexts.
 * Returns visible:false when there is nothing useful to show.
 */
export function composeFloorOperationalContextView(
  input: FloorOperationalContextInput
): FloorOperationalContextView {
  const fiscal_label =
    input.fiscal && input.fiscal.status === "ok"
      ? formatFiscalContextLabel(input.fiscal)
      : null;

  const season_label = formatActiveSeasonLabel(input.active_seasons);
  const event_label = formatActiveEventLabel(input.active_events);

  const relevance = pickCurrentDepartmentRelevance(
    input.active_seasons,
    input.active_events
  );
  const relevance_label = formatDepartmentRelevanceLabel({
    department_label: input.department_label,
    relevance,
  });

  const lines: string[] = [];
  if (fiscal_label) lines.push(fiscal_label);

  if (season_label && event_label) {
    lines.push(`${season_label} · ${event_label}`);
  } else if (season_label) {
    lines.push(season_label);
  } else if (event_label) {
    lines.push(event_label);
  }

  if (relevance_label) lines.push(relevance_label);

  return {
    method: FLOOR_OPERATIONAL_CONTEXT_METHOD,
    visible: lines.length > 0,
    fiscal_label,
    season_label,
    event_label,
    relevance_label,
    lines,
  };
}
