/**
 * Behavior-driven bay freshness — last-touch overlay for floor walks.
 * Composes store_locations last_serviced_at / last_completed_at + walk/dispatch
 * overlays. Does not own IRP velocity cadence (`velocity.ts`) or discrepancy
 * diagnostics (`bay-health.ts`).
 */

import { daysSinceIso, parseSimsAisleBay } from "@/lib/store-ops/bay-health";
import { getStoreNumber } from "@/lib/store";
import { formatBayTag, type StoreLocation } from "@/lib/store-ops/types";

export const BAY_FRESH_MAX_DAYS = 2;
export const BAY_WARM_MAX_DAYS = 4;

export type BayFreshnessTone = "fresh" | "warm" | "stale";

export type BayTouchSource =
  | "dispatch"
  | "resolve"
  | "audit"
  | "checkoff"
  | "walk";

export type ParsedLocationTag = {
  tag: string;
  aisle: string | null;
  bay: number | null;
};

export type BayTouch = {
  key: string;
  location_id: string | null;
  location_tag: string;
  aisle: string | null;
  bay: number | null;
  last_touched_at: string;
  source: BayTouchSource;
};

export type BayFreshnessCell = {
  key: string;
  location_id: string | null;
  location_tag: string;
  aisle: string | null;
  bay: number | null;
  last_touched_at: string | null;
  age_days: number | null;
  tone: BayFreshnessTone;
};

export type BayFreshnessSummary = {
  cells: BayFreshnessCell[];
  freshCount: number;
  warmCount: number;
  staleCount: number;
  staleTags: string[];
  focusToday: string;
  headline: string;
};

export const BAY_TOUCH_EVENT = "deptsync:bay-touches";
const STORAGE_PREFIX = "deptsync_bay_touches";

function storageKey(store = getStoreNumber()): string {
  return `${STORAGE_PREFIX}:${store}`;
}

function emitBayTouches() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(BAY_TOUCH_EVENT));
}

export function parseLocationTag(raw: string | null | undefined): ParsedLocationTag {
  const tag = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (!tag) {
    return { tag: "General", aisle: null, bay: null };
  }

  const sims = parseSimsAisleBay(tag);
  if (sims) {
    return { tag, aisle: sims.aisle, bay: sims.bay };
  }

  const compact = /^([A-Z]{1,4}|A\d{1,3})-B0*(\d{1,3})$/i.exec(tag);
  if (compact) {
    const aisleRaw = compact[1].toUpperCase().replace(/^A(?=\d)/, "");
    return { tag, aisle: aisleRaw, bay: Number(compact[2]) };
  }

  const aisleBay = /\b(?:aisle|ais)\s*([A-Za-z0-9-]{1,8})\b(?:[^.]{0,20}\bbay\s*(\d{1,4})\b)?/i.exec(
    tag
  );
  if (aisleBay) {
    return {
      tag,
      aisle: aisleBay[1].toUpperCase(),
      bay: aisleBay[2] ? Number(aisleBay[2]) : null,
    };
  }

  const bayOnly = /\bbay\s*(\d{1,4})\b/i.exec(tag);
  if (bayOnly) {
    return { tag: `Bay ${Number(bayOnly[1])}`, aisle: null, bay: Number(bayOnly[1]) };
  }

  const aisleOnly = /\b(?:aisle|ais)\s*([A-Za-z0-9-]{1,8})\b/i.exec(tag);
  if (aisleOnly) {
    return {
      tag: `Aisle ${aisleOnly[1].toUpperCase()}`,
      aisle: aisleOnly[1].toUpperCase(),
      bay: null,
    };
  }

  return { tag, aisle: null, bay: null };
}

export function bayTouchKey(input: {
  location_id?: string | null;
  location_tag?: string | null;
  aisle?: string | null;
  bay?: number | null;
}): string {
  const id = String(input.location_id ?? "").trim();
  if (id) return `id:${id}`;
  const aisle = String(input.aisle ?? "").trim().toUpperCase();
  const bay =
    input.bay != null && Number.isFinite(Number(input.bay))
      ? Math.floor(Number(input.bay))
      : null;
  if (aisle && bay != null) return `ab:${aisle}:${bay}`;
  if (bay != null) return `bay:${bay}`;
  if (aisle) return `aisle:${aisle}`;
  const parsed = parseLocationTag(input.location_tag);
  if (parsed.aisle && parsed.bay != null) {
    return `ab:${parsed.aisle}:${parsed.bay}`;
  }
  if (parsed.bay != null) return `bay:${parsed.bay}`;
  if (parsed.aisle) return `aisle:${parsed.aisle}`;
  return `tag:${parsed.tag.toLowerCase()}`;
}

export function freshnessTone(
  ageDays: number | null | undefined
): BayFreshnessTone {
  if (ageDays == null) return "stale";
  if (ageDays <= BAY_FRESH_MAX_DAYS) return "fresh";
  if (ageDays <= BAY_WARM_MAX_DAYS) return "warm";
  return "stale";
}

export function displayLocationTag(input: {
  location_tag?: string | null;
  aisle?: string | null;
  bay?: number | null;
}): string {
  const tagged = String(input.location_tag ?? "").trim();
  if (tagged && tagged.toLowerCase() !== "general") return tagged;
  const aisle = String(input.aisle ?? "").trim();
  const bay =
    input.bay != null && Number.isFinite(Number(input.bay))
      ? Math.floor(Number(input.bay))
      : null;
  if (aisle && bay != null) {
    return formatBayTag({ aisle, bay });
  }
  if (bay != null) return `Bay ${bay}`;
  if (aisle) return `Aisle ${aisle}`;
  return tagged || "General";
}

function laterIso(a: string | null | undefined, b: string | null | undefined): string | null {
  const ta = a ? Date.parse(a) : Number.NaN;
  const tb = b ? Date.parse(b) : Number.NaN;
  if (!Number.isFinite(ta) && !Number.isFinite(tb)) return null;
  if (!Number.isFinite(ta)) return b ?? null;
  if (!Number.isFinite(tb)) return a ?? null;
  return ta >= tb ? (a as string) : (b as string);
}

function normalizeTouch(raw: unknown): BayTouch | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const location_tag = String(rec.location_tag ?? "").trim();
  const location_id = String(rec.location_id ?? "").trim() || null;
  const aisle = String(rec.aisle ?? "").trim().toUpperCase() || null;
  const bay =
    rec.bay == null || rec.bay === ""
      ? null
      : Number.isFinite(Number(rec.bay))
        ? Math.floor(Number(rec.bay))
        : null;
  const last_touched_at = String(rec.last_touched_at ?? "").trim();
  if (!last_touched_at || (!location_tag && !location_id && bay == null && !aisle)) {
    return null;
  }
  const source: BayTouchSource =
    rec.source === "resolve" ||
    rec.source === "audit" ||
    rec.source === "checkoff" ||
    rec.source === "walk"
      ? rec.source
      : "dispatch";
  const parsed = parseLocationTag(location_tag);
  const next: BayTouch = {
    key: "",
    location_id,
    location_tag: location_tag || displayLocationTag({ aisle, bay }),
    aisle: aisle || parsed.aisle,
    bay: bay ?? parsed.bay,
    last_touched_at,
    source,
  };
  next.key = bayTouchKey(next);
  return next;
}

export function readBayTouches(store = getStoreNumber()): Record<string, BayTouch> {
  if (typeof window === "undefined" || !store) return {};
  try {
    const raw = window.localStorage.getItem(storageKey(store));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const map: Record<string, BayTouch> = {};
    for (const value of Object.values(parsed as Record<string, unknown>)) {
      const row = normalizeTouch(value);
      if (row) map[row.key] = row;
    }
    return map;
  } catch {
    return {};
  }
}

function writeBayTouches(
  map: Record<string, BayTouch>,
  store = getStoreNumber()
): void {
  if (typeof window === "undefined" || !store) return;
  window.localStorage.setItem(storageKey(store), JSON.stringify(map));
}

export function recordBayTouch(input: {
  location_id?: string | null;
  location_tag?: string | null;
  aisle?: string | null;
  bay?: number | null;
  source?: BayTouchSource;
  at?: string;
  storeNumber?: string;
}): BayTouch {
  const parsed = parseLocationTag(input.location_tag);
  const aisle =
    String(input.aisle ?? "").trim().toUpperCase() || parsed.aisle;
  const bay =
    input.bay != null && Number.isFinite(Number(input.bay))
      ? Math.floor(Number(input.bay))
      : parsed.bay;
  const touch: BayTouch = {
    key: "",
    location_id: String(input.location_id ?? "").trim() || null,
    location_tag: displayLocationTag({
      location_tag: input.location_tag,
      aisle,
      bay,
    }),
    aisle,
    bay,
    last_touched_at: input.at || new Date().toISOString(),
    source: input.source ?? "dispatch",
  };
  touch.key = bayTouchKey(touch);

  const store = String(input.storeNumber ?? getStoreNumber()).trim();
  const map = readBayTouches(store);
  const existing = map[touch.key];
  if (
    existing &&
    Date.parse(existing.last_touched_at) > Date.parse(touch.last_touched_at)
  ) {
    return existing;
  }
  map[touch.key] = touch;
  writeBayTouches(map, store);
  emitBayTouches();
  return touch;
}

export function subscribeBayTouches(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => onChange();
  window.addEventListener(BAY_TOUCH_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(BAY_TOUCH_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

export function matchLocationForTag(
  tag: string,
  locations: Array<
    Pick<StoreLocation, "id" | "aisle" | "bay"> & { location_id?: string }
  >
): (Pick<StoreLocation, "id" | "aisle" | "bay"> & { location_id?: string }) | null {
  const parsed = parseLocationTag(tag);
  if (locations.length === 0) return null;

  const exact = locations.filter((loc) => {
    const aisle = String(loc.aisle ?? "").trim().toUpperCase();
    const bay = Number(loc.bay);
    if (parsed.aisle && parsed.bay != null) {
      return aisle === parsed.aisle && bay === parsed.bay;
    }
    return false;
  });
  if (exact.length === 1) return exact[0] ?? null;
  if (exact.length > 1) {
    return exact.find((loc) => String(loc.id)) ?? exact[0] ?? null;
  }

  if (parsed.bay != null) {
    const byBay = locations.filter((loc) => Number(loc.bay) === parsed.bay);
    if (byBay.length === 1) return byBay[0] ?? null;
  }
  if (parsed.aisle) {
    const byAisle = locations.filter(
      (loc) => String(loc.aisle ?? "").trim().toUpperCase() === parsed.aisle
    );
    if (byAisle.length === 1) return byAisle[0] ?? null;
  }
  return null;
}

function cellFromParts(input: {
  location_id: string | null;
  location_tag: string;
  aisle: string | null;
  bay: number | null;
  last_touched_at: string | null;
  now: Date;
}): BayFreshnessCell {
  const age_days = daysSinceIso(input.last_touched_at, input.now);
  return {
    key: bayTouchKey(input),
    location_id: input.location_id,
    location_tag: displayLocationTag(input),
    aisle: input.aisle,
    bay: input.bay,
    last_touched_at: input.last_touched_at,
    age_days,
    tone: freshnessTone(age_days),
  };
}

export function composeBayFreshness(input: {
  locations?: Array<
    Pick<
      StoreLocation,
      "id" | "aisle" | "bay" | "last_serviced_at" | "last_completed_at"
    >
  >;
  overlay?: Record<string, BayTouch>;
  now?: Date;
}): BayFreshnessSummary {
  const now = input.now ?? new Date();
  const overlay = input.overlay ?? {};
  const byKey = new Map<string, BayFreshnessCell>();

  for (const loc of input.locations ?? []) {
    const aisle = String(loc.aisle ?? "").trim().toUpperCase() || null;
    const bay = Number.isFinite(Number(loc.bay))
      ? Math.floor(Number(loc.bay))
      : null;
    const stamp = laterIso(loc.last_serviced_at, loc.last_completed_at);
    const cell = cellFromParts({
      location_id: String(loc.id ?? "").trim() || null,
      location_tag: displayLocationTag({ aisle, bay }),
      aisle,
      bay,
      last_touched_at: stamp,
      now,
    });
    byKey.set(cell.key, cell);
  }

  for (const touch of Object.values(overlay)) {
    const existing = byKey.get(touch.key);
    const stamp = laterIso(existing?.last_touched_at, touch.last_touched_at);
    const cell = cellFromParts({
      location_id: touch.location_id || existing?.location_id || null,
      location_tag: touch.location_tag || existing?.location_tag || "General",
      aisle: touch.aisle || existing?.aisle || null,
      bay: touch.bay ?? existing?.bay ?? null,
      last_touched_at: stamp,
      now,
    });
    byKey.set(cell.key, cell);
  }

  const cells = [...byKey.values()].sort((a, b) => {
    const toneRank = { stale: 0, warm: 1, fresh: 2 };
    if (toneRank[a.tone] !== toneRank[b.tone]) {
      return toneRank[a.tone] - toneRank[b.tone];
    }
    const ageA = a.age_days ?? 999;
    const ageB = b.age_days ?? 999;
    if (ageA !== ageB) return ageB - ageA;
    return a.location_tag.localeCompare(b.location_tag, undefined, {
      numeric: true,
    });
  });

  const stale = cells.filter((c) => c.tone === "stale");
  const warm = cells.filter((c) => c.tone === "warm");
  const fresh = cells.filter((c) => c.tone === "fresh");
  const staleTags = stale
    .map((c) => c.location_tag)
    .filter((tag, i, arr) => arr.indexOf(tag) === i)
    .slice(0, 8);

  const aisleStale = new Map<string, number>();
  for (const cell of stale) {
    if (!cell.aisle) continue;
    aisleStale.set(cell.aisle, (aisleStale.get(cell.aisle) ?? 0) + 1);
  }
  let focusAisle: string | null = null;
  let focusCount = 0;
  for (const [aisle, count] of aisleStale) {
    if (count > focusCount) {
      focusAisle = aisle;
      focusCount = count;
    }
  }
  const focusToday = focusAisle
    ? `Packdown Aisle ${focusAisle}`
    : stale[0]
      ? `Touch ${stale[0].location_tag}`
      : "Bays current";

  const staleLabel =
    stale.length === 0
      ? "0 Bays Stale"
      : `${stale.length} Bay${stale.length === 1 ? "" : "s"} Stale${
          staleTags.length ? ` (${staleTags.slice(0, 3).join(", ")})` : ""
        }`;

  return {
    cells,
    freshCount: fresh.length,
    warmCount: warm.length,
    staleCount: stale.length,
    staleTags,
    focusToday,
    headline: `Bay Heatmap: ${staleLabel} • Focus Today: ${focusToday}`,
  };
}
