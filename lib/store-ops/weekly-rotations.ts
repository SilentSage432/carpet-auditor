/**
 * Proportional clustered assignment of this week's rotation bays.
 * Does not generate rotations (rotations.ts) or persist assignments (sunday-audit.ts).
 * Persist goes through setSundayBayAssignment → enqueueOrExecute (STORE_OPS_SUNDAY_ASSIGN).
 * Composes aisle clustering + bay-health risk scores; presentation only renders.
 */

import { compareAisles, normalizeAisle } from "./aisle";
import type { BayHealthFinding } from "./bay-health";
import { getStoreNumber } from "@/lib/store";
import type { StoreSpecialist } from "@/lib/types";

export const SHIFT_HOUR_PRESETS = [4, 6, 8] as const;
export const DEFAULT_SHIFT_HOURS = 8;

export type ShiftRosterMember = {
  specialist_id: string;
  specialist_name: string;
  active: boolean;
  hours: number;
  start?: string;
  end?: string;
};

export type RotationBayRef = {
  rotationId: string;
  aisle: string;
  bay: number;
  type?: string | null;
  riskScore: number;
};

export type BayAssignmentPlanItem = {
  rotationId: string;
  specialist_id: string;
  specialist_name: string;
  hours: number;
  shift_tag: string;
  aisle: string;
  bay: number;
  riskScore: number;
};

export type AssociateLoadPreview = {
  specialist_id: string;
  specialist_name: string;
  hours: number;
  quota: number;
  weight_pct: number;
  aisles: string[];
  high_risk: number;
};

export type ProportionalAssignmentPlan = {
  total_hours: number;
  items: BayAssignmentPlanItem[];
  loads: AssociateLoadPreview[];
};

/** v3: Sunday seed is department-aware; v1/v2 caches had everyone on. */
const SHIFT_ROSTER_PREFIX = "deptsync_shift_roster_v3";

function storageKey(week: string, store = getStoreNumber()): string {
  return `${SHIFT_ROSTER_PREFIX}:${store}:${week}`;
}

/** Parse "08:00" / "8:00" / "16:30" → minutes from midnight, or null. */
export function parseClockMinutes(raw: string | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(raw ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || h < 0 || h > 23) return null;
  if (!Number.isFinite(min) || min < 0 || min > 59) return null;
  return h * 60 + min;
}

/** Hours from start/end clock times. Overnight ranges wrap past midnight. */
export function hoursBetween(start?: string, end?: string): number | null {
  const a = parseClockMinutes(start);
  const b = parseClockMinutes(end);
  if (a == null || b == null) return null;
  let delta = b - a;
  if (delta <= 0) delta += 24 * 60;
  return Math.round((delta / 60) * 10) / 10;
}

export function clampShiftHours(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_SHIFT_HOURS;
  return Math.min(16, Math.max(1, Math.round(n * 10) / 10));
}

export function formatShiftTag(hours: number): string {
  const h = clampShiftHours(hours);
  return Number.isInteger(h) ? `${h}h` : `${h}h`;
}

export function formatSpecialistShiftLabel(
  name: string,
  hours?: number | null
): string {
  const base = String(name ?? "").trim() || "Associate";
  if (hours == null || hours <= 0) return base;
  return `${base} · ${formatShiftTag(hours)}`;
}

export function riskScoreFromFinding(
  finding: BayHealthFinding | undefined
): number {
  if (!finding) return 0;
  let score = 0;
  for (const flag of finding.flags) {
    if (flag === "never_audited") score += 28;
    else if (flag === "stale") score += 18;
    else if (flag === "topstock_uninventoried") score += 16;
    else score += 12;
  }
  return score;
}

export function defaultShiftRoster(
  roster: StoreSpecialist[],
  seedActive?: (member: StoreSpecialist) => boolean
): ShiftRosterMember[] {
  return roster.map((m) => ({
    specialist_id: String(m.id),
    specialist_name: m.name,
    active: seedActive ? seedActive(m) : m.role !== "MasterAdmin",
    hours: DEFAULT_SHIFT_HOURS,
  }));
}

export function mergeShiftRoster(
  roster: StoreSpecialist[],
  saved: ShiftRosterMember[] | null | undefined,
  seedActive?: (member: StoreSpecialist) => boolean
): ShiftRosterMember[] {
  const byId = new Map((saved ?? []).map((row) => [row.specialist_id, row]));
  return roster.map((m) => {
    const prev = byId.get(String(m.id));
    if (!prev) {
      return {
        specialist_id: String(m.id),
        specialist_name: m.name,
        active: seedActive ? seedActive(m) : m.role !== "MasterAdmin",
        hours: DEFAULT_SHIFT_HOURS,
      };
    }
    const fromRange = hoursBetween(prev.start, prev.end);
    return {
      specialist_id: String(m.id),
      specialist_name: m.name,
      active: prev.active,
      hours: clampShiftHours(fromRange ?? prev.hours),
      start: prev.start,
      end: prev.end,
    };
  });
}

export function readShiftRoster(
  week: string,
  store = getStoreNumber()
): ShiftRosterMember[] {
  if (typeof window === "undefined" || !week) return [];
  try {
    const raw = window.localStorage.getItem(storageKey(week, store));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((row): ShiftRosterMember | null => {
        if (!row || typeof row !== "object") return null;
        const rec = row as Record<string, unknown>;
        const id = String(rec.specialist_id ?? "").trim();
        if (!id) return null;
        const member: ShiftRosterMember = {
          specialist_id: id,
          specialist_name: String(rec.specialist_name ?? "").trim() || "Associate",
          active: rec.active !== false,
          hours: clampShiftHours(rec.hours),
        };
        if (rec.start) member.start = String(rec.start);
        if (rec.end) member.end = String(rec.end);
        return member;
      })
      .filter((row): row is ShiftRosterMember => row != null);
  } catch {
    return [];
  }
}

export function writeShiftRoster(
  week: string,
  members: ShiftRosterMember[],
  store = getStoreNumber()
): void {
  if (typeof window === "undefined" || !week) return;
  window.localStorage.setItem(storageKey(week, store), JSON.stringify(members));
}

export function hoursBySpecialistId(
  members: ShiftRosterMember[]
): Record<string, number> {
  const next: Record<string, number> = {};
  for (const m of members) {
    if (!m.active) continue;
    next[m.specialist_id] = clampShiftHours(m.hours);
  }
  return next;
}

/**
 * Largest-remainder quotas so floor(hours/total × n) + leftovers = n.
 */
export function proportionalQuotas(
  hours: number[],
  bayCount: number
): number[] {
  const n = Math.max(0, Math.floor(bayCount));
  if (hours.length === 0 || n <= 0) return hours.map(() => 0);
  const total = hours.reduce((sum, h) => sum + Math.max(0, h), 0);
  if (total <= 0) {
    const even = Math.floor(n / hours.length);
    const rem = n - even * hours.length;
    return hours.map((_, i) => even + (i < rem ? 1 : 0));
  }
  const raw = hours.map((h) => (Math.max(0, h) / total) * n);
  const floors = raw.map((x) => Math.floor(x));
  let leftover = n - floors.reduce((sum, x) => sum + x, 0);
  const order = raw
    .map((x, i) => ({ i, frac: x - Math.floor(x), hours: hours[i] ?? 0 }))
    .sort((a, b) => {
      if (b.frac !== a.frac) return b.frac - a.frac;
      return b.hours - a.hours;
    });
  const next = [...floors];
  for (let k = 0; k < leftover; k += 1) {
    const slot = order[k];
    if (!slot) break;
    next[slot.i] = (next[slot.i] ?? 0) + 1;
  }
  return next;
}

function bayFace(bay: number): "odd" | "even" {
  return bay % 2 === 0 ? "even" : "odd";
}

type GeoCluster = {
  aisle: string;
  face: "odd" | "even";
  risk: number;
  bays: RotationBayRef[];
};

function clusterBays(bays: RotationBayRef[]): GeoCluster[] {
  const groups = new Map<string, GeoCluster>();
  for (const bay of bays) {
    const aisle = normalizeAisle(bay.aisle) || "—";
    const face = bayFace(bay.bay);
    const key = `${aisle}|${face}`;
    let cluster = groups.get(key);
    if (!cluster) {
      cluster = { aisle, face, risk: 0, bays: [] };
      groups.set(key, cluster);
    }
    cluster.bays.push(bay);
    cluster.risk += bay.riskScore;
  }
  for (const cluster of groups.values()) {
    cluster.bays.sort((a, b) => {
      if (b.riskScore !== a.riskScore) return b.riskScore - a.riskScore;
      return a.bay - b.bay;
    });
  }
  return [...groups.values()].sort((a, b) => {
    if (b.risk !== a.risk) return b.risk - a.risk;
    const aisleCmp = compareAisles(a.aisle, b.aisle);
    if (aisleCmp !== 0) return aisleCmp;
    return a.face === b.face ? 0 : a.face === "odd" ? -1 : 1;
  });
}

/**
 * Distribute open weekly bays by scheduled hours, keeping aisle/face clusters
 * together and feeding high-risk (stale / never / unworked top-stock) clusters
 * into the longest (primary) shifts first.
 */
export function planProportionalBayAssignments(
  bays: RotationBayRef[],
  members: ShiftRosterMember[]
): ProportionalAssignmentPlan {
  const active = members.filter((m) => m.active && clampShiftHours(m.hours) > 0);
  const empty: ProportionalAssignmentPlan = {
    total_hours: 0,
    items: [],
    loads: [],
  };
  if (bays.length === 0 || active.length === 0) return empty;

  const hours = active.map((m) => clampShiftHours(m.hours));
  const totalHours = hours.reduce((sum, h) => sum + h, 0);
  const quotas = proportionalQuotas(hours, bays.length);
  const remaining = [...quotas];
  const lastAisle = active.map(() => "");
  const items: BayAssignmentPlanItem[] = [];

  const queue = clusterBays(bays).flatMap((c) => c.bays);

  for (const bay of queue) {
    let pick = -1;
    let best = -1;
    for (let i = 0; i < active.length; i += 1) {
      if ((remaining[i] ?? 0) <= 0) continue;
      const sameAisle = lastAisle[i] === normalizeAisle(bay.aisle) ? 2 : 0;
      const score = sameAisle * 1000 + (remaining[i] ?? 0) * 10 + hours[i];
      if (score > best) {
        best = score;
        pick = i;
      }
    }
    if (pick < 0) {
      pick = remaining.findIndex((q) => q > 0);
    }
    if (pick < 0) break;
    const member = active[pick]!;
    remaining[pick] = (remaining[pick] ?? 0) - 1;
    lastAisle[pick] = normalizeAisle(bay.aisle);
    items.push({
      rotationId: bay.rotationId,
      specialist_id: member.specialist_id,
      specialist_name: member.specialist_name,
      hours: clampShiftHours(member.hours),
      shift_tag: formatShiftTag(member.hours),
      aisle: bay.aisle,
      bay: bay.bay,
      riskScore: bay.riskScore,
    });
  }

  const loads: AssociateLoadPreview[] = active.map((member, i) => {
    const mine = items.filter((row) => row.specialist_id === member.specialist_id);
    const aisles = [
      ...new Set(mine.map((row) => normalizeAisle(row.aisle)).filter(Boolean)),
    ].sort(compareAisles);
    return {
      specialist_id: member.specialist_id,
      specialist_name: member.specialist_name,
      hours: clampShiftHours(member.hours),
      quota: quotas[i] ?? 0,
      weight_pct:
        totalHours > 0
          ? Math.round((clampShiftHours(member.hours) / totalHours) * 100)
          : 0,
      aisles,
      high_risk: mine.filter((row) => row.riskScore > 0).length,
    };
  });

  return { total_hours: totalHours, items, loads };
}
