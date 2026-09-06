/**
 * FS-003B Map location seasonal context — presentation composition only.
 * Does not fetch, mutate priority, or invent department→location inheritance.
 */

export const MAP_LOCATION_CONTEXT_METHOD = "map-location-context-v1" as const;

export type MapLocationContextRelevance = "NONE" | "LOW" | "MEDIUM" | "HIGH";

export type MapLocationContextItem = {
  location_id: string;
  context_id: string;
  kind: "SEASON" | "EVENT";
  title: string;
  start_date: string;
  end_date: string;
  source_type: string;
  location_relevance: MapLocationContextRelevance;
  location_is_active?: boolean;
};

export type MapLocationContextDetailLine = {
  context_id: string;
  title: string;
  relevance: MapLocationContextRelevance;
  provenance_label: string;
  kind: "SEASON" | "EVENT";
};

export type MapLocationSeasonalView = {
  method: typeof MAP_LOCATION_CONTEXT_METHOD;
  location_id: string;
  /** Compact cell badge; null when no LOW/MEDIUM/HIGH to show. */
  cell_badge: string | null;
  primary_relevance: "LOW" | "MEDIUM" | "HIGH" | null;
  /** Extra emphasis contexts beyond the primary (LOW+ only). */
  emphasis_extra: number;
  /** Detail sheet lines — may include NONE; never invents scores. */
  detail_lines: MapLocationContextDetailLine[];
};

const RANK: Record<MapLocationContextRelevance, number> = {
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
  NONE: 0,
};

/** Honest provenance label — never implies Lowe's corporate unless COMPANY_PUBLISHED. */
export function provenanceLabelForSourceType(sourceType: string): string {
  const raw = String(sourceType ?? "").trim().toUpperCase();
  if (raw === "COMPANY_PUBLISHED") return "Company-published";
  if (raw === "PUBLIC_CALENDAR") return "Public calendar";
  if (raw === "MASTER_ADMIN_DECLARED") return "Store-declared";
  return "Declared context";
}

function sortItems(a: MapLocationContextItem, b: MapLocationContextItem): number {
  const rd = RANK[b.location_relevance] - RANK[a.location_relevance];
  if (rd !== 0) return rd;
  const sd = String(a.start_date).localeCompare(String(b.start_date));
  if (sd !== 0) return sd;
  return String(a.title).localeCompare(String(b.title));
}

/**
 * Compose one location's Map view from resolved FS-003 items.
 *
 * UNSET = no rows → no badge
 * NONE → detail only (not cell emphasis)
 * LOW/MEDIUM/HIGH → cell badge + detail
 * Multiple contexts → independent lines; badge uses highest + extras count
 * No merged numeric score
 */
export function composeMapLocationSeasonalView(
  locationId: string,
  items: MapLocationContextItem[]
): MapLocationSeasonalView {
  const forLoc = items
    .filter((row) => row.location_id === locationId)
    .filter((row) => row.location_is_active !== false)
    .slice()
    .sort(sortItems);

  const detail_lines: MapLocationContextDetailLine[] = forLoc.map((row) => ({
    context_id: row.context_id,
    title: row.title,
    relevance: row.location_relevance,
    provenance_label: provenanceLabelForSourceType(row.source_type),
    kind: row.kind,
  }));

  const emphasis = forLoc.filter((row) => row.location_relevance !== "NONE");
  if (emphasis.length === 0) {
    return {
      method: MAP_LOCATION_CONTEXT_METHOD,
      location_id: locationId,
      cell_badge: null,
      primary_relevance: null,
      emphasis_extra: 0,
      detail_lines,
    };
  }

  const primary = emphasis[0]!;
  const primary_relevance = primary.location_relevance as
    | "LOW"
    | "MEDIUM"
    | "HIGH";
  const emphasis_extra = Math.max(0, emphasis.length - 1);
  const cell_badge =
    emphasis_extra > 0
      ? `Seasonal ${primary_relevance} +${emphasis_extra}`
      : `Seasonal ${primary_relevance}`;

  return {
    method: MAP_LOCATION_CONTEXT_METHOD,
    location_id: locationId,
    cell_badge,
    primary_relevance,
    emphasis_extra,
    detail_lines,
  };
}

/** Index views by location_id from a batched resolve payload. */
export function indexMapLocationSeasonalViews(
  items: MapLocationContextItem[]
): Map<string, MapLocationSeasonalView> {
  const byLoc = new Map<string, MapLocationContextItem[]>();
  for (const item of items) {
    const list = byLoc.get(item.location_id) ?? [];
    list.push(item);
    byLoc.set(item.location_id, list);
  }
  const out = new Map<string, MapLocationSeasonalView>();
  for (const [locationId, rows] of byLoc) {
    out.set(locationId, composeMapLocationSeasonalView(locationId, rows));
  }
  return out;
}

/**
 * Bay-pair cell badge: prefer highest emphasis across selling + topstock faces.
 * Presentation only — does not merge into a score.
 */
export function composeBayPairSeasonalBadge(
  views: Array<MapLocationSeasonalView | null | undefined>
): string | null {
  let best: MapLocationSeasonalView | null = null;
  let bestRank = 0;
  let extras = 0;
  for (const view of views) {
    if (!view?.primary_relevance) continue;
    const rank = RANK[view.primary_relevance];
    extras += 1 + view.emphasis_extra;
    if (rank > bestRank) {
      bestRank = rank;
      best = view;
    }
  }
  if (!best?.primary_relevance) return null;
  const extraBeyondPrimary = Math.max(0, extras - 1);
  return extraBeyondPrimary > 0
    ? `Seasonal ${best.primary_relevance} +${extraBeyondPrimary}`
    : `Seasonal ${best.primary_relevance}`;
}
