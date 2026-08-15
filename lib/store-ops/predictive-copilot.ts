/**
 * Predictive Shift Copilot — local pattern detection for Floor intelligence.
 * Composes bay_service_logs, sunday_bay_assignments, downstock_queue, and
 * store_locations. Does not generate rotations or invent bays.
 */

import { normalizeAisle } from "@/lib/store-ops/aisle";
import { daysSinceIso } from "@/lib/store-ops/bay-health";
import {
  assignLocationsToWeek,
  fetchStoreLocationsDetailed,
  fetchThisWeekRotations,
} from "@/lib/store-ops/client";
import {
  flagForDownstock,
  fetchDownstockQueue,
  type DownstockMap,
} from "@/lib/store-ops/downstock";
import { getSupabase } from "@/lib/supabase";
import { fetchSpecialists } from "@/lib/specialists";
import {
  fetchSundayAssignments,
  setSundayBayAssignment,
  type SundayAssignmentMap,
} from "@/lib/store-ops/sunday-audit";
import {
  composeShiftBoard,
  fetchShiftDays,
  isOnDutyToday,
  localWorkDate,
  type AssociateShiftDay,
} from "@/lib/store-ops/shift-status";
import {
  formatBayTag,
  type BayServiceIntensity,
  type StoreLocation,
  type WeeklyRotationWithLocation,
} from "@/lib/store-ops/types";
import { isHotServiceIntensity } from "@/lib/store-ops/velocity";
import type { StoreSpecialist } from "@/lib/types";

export const COPILOT_DECAY_DAYS = 14;
export const COPILOT_LOG_WINDOW_DAYS = 56;
export const COPILOT_HOT_WEEKDAY_MIN = 2;

export type CopilotPattern = "velocity" | "decay" | "pace" | "carry";
export type CopilotActionKind = "downstock" | "stage" | "stage_assign";

export type CopilotRecommendation = {
  id: string;
  pattern: CopilotPattern;
  title: string;
  detail: string;
  actionLabel: string;
  action: CopilotActionKind;
  locationIds: string[];
  rotationId?: string;
  departmentId?: string;
  specialistId?: string;
  specialistName?: string;
  note?: string;
};

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

function isMissingRelation(error: unknown): boolean {
  const msg = String(
    (error as { message?: string } | null)?.message ?? error ?? ""
  ).toLowerCase();
  return (
    msg.includes("does not exist") ||
    msg.includes("schema cache") ||
    msg.includes("could not find the table")
  );
}

function faceLabel(loc: StoreLocation): string {
  if (loc.type === "TOPSTOCK") return "Topstock";
  if (loc.type === "SELLING") return "Selling";
  return "Bay";
}

function adjacent(
  a: Pick<StoreLocation, "aisle" | "bay">,
  b: Pick<StoreLocation, "aisle" | "bay">
): boolean {
  if (normalizeAisle(a.aisle) !== normalizeAisle(b.aisle)) return false;
  const delta = Math.abs(Number(a.bay) - Number(b.bay));
  return delta > 0 && delta <= 2;
}

async function loadServiceLogs(
  storeId: string,
  sinceIso: string
): Promise<Array<{
  location_id: string;
  intensity: BayServiceIntensity;
  notes: string | null;
  created_at: string;
}>> {
  const supabase = getSupabase();
  if (!supabase || !storeId) return [];
  try {
    const { data, error } = await supabase
      .from("bay_service_logs")
      .select("location_id, intensity, notes, created_at")
      .eq("store_id", storeId)
      .gte("created_at", sinceIso)
      .in("intensity", ["heavy_packdown", "critical_hole"]);
    if (error) {
      if (isMissingRelation(error)) return [];
      return [];
    }
    return (data ?? []).flatMap((row) => {
      const intensity = row.intensity as BayServiceIntensity;
      if (!isHotServiceIntensity(intensity)) return [];
      return [
        {
          location_id: String(row.location_id),
          intensity,
          notes: row.notes == null ? null : String(row.notes),
          created_at: String(row.created_at),
        },
      ];
    });
  } catch {
    return [];
  }
}

/**
 * Build 2–3 high-impact recommendations from live store records.
 */
export async function composePredictiveCopilot(input: {
  specialist: StoreSpecialist;
  week: string;
  rotations: WeeklyRotationWithLocation[];
  departmentId: string | null;
}): Promise<CopilotRecommendation[]> {
  const week = String(input.week ?? "").trim();
  const departmentId = input.departmentId;
  const locResult = await fetchStoreLocationsDetailed(
    input.specialist,
    departmentId ?? undefined
  ).catch(() => ({ items: [] as StoreLocation[] }));
  const locations = locResult.items.filter(
    (loc) => loc.is_active !== false
  );
  const byId = new Map(locations.map((loc) => [loc.id, loc]));
  const weekLocationIds = new Set(
    input.rotations
      .map((row) => row.location_id || row.store_locations?.id || "")
      .filter(Boolean)
  );
  const downstock: DownstockMap = week
    ? await fetchDownstockQueue(week).catch(() => ({}))
    : {};
  const downstockLocationIds = new Set(
    Object.values(downstock)
      .map((flag) => flag.location_id)
      .filter(Boolean)
  );
  const downstockRotationIds = new Set(Object.keys(downstock));
  const openZones = input.rotations
    .filter((row) => !row.is_completed)
    .map((row) => row.store_locations)
    .filter((loc): loc is StoreLocation => Boolean(loc));

  const recs: CopilotRecommendation[] = [];

  const carryLocs = locations.filter(
    (loc) =>
      (loc.carried_over === true || loc.status === "CARRIED_OVER") &&
      !weekLocationIds.has(loc.id)
  );
  if (carryLocs.length > 0 && departmentId) {
    const sample = carryLocs.slice(0, 2).map((loc) => formatBayTag(loc));
    recs.push({
      id: `carry:${carryLocs.map((l) => l.id).join(",")}`,
      pattern: "carry",
      title: `${carryLocs.length} carry-over bay${
        carryLocs.length === 1 ? "" : "s"
      } from a call-out ready for staging`,
      detail: `${sample.join(" · ")}${
        carryLocs.length > 2 ? "…" : ""
      }`,
      actionLabel: "Stage to Shift",
      action: "stage",
      locationIds: carryLocs.slice(0, 6).map((loc) => loc.id),
      departmentId,
    });
  }

  const storeId = locations[0]?.store_id || input.rotations[0]?.store_id || "";
  const since = new Date();
  since.setDate(since.getDate() - COPILOT_LOG_WINDOW_DAYS);
  const logs = await loadServiceLogs(storeId, since.toISOString());
  const todayWeekday = new Date().getDay();
  const weekdayCounts = new Map<
    string,
    { locationId: string; weekday: number; count: number; note: string | null }
  >();
  for (const log of logs) {
    const d = new Date(log.created_at);
    if (Number.isNaN(d.getTime())) continue;
    const weekday = d.getDay();
    const key = `${log.location_id}:${weekday}`;
    const prev = weekdayCounts.get(key);
    if (prev) {
      prev.count += 1;
      if (!prev.note && log.notes) prev.note = log.notes;
    } else {
      weekdayCounts.set(key, {
        locationId: log.location_id,
        weekday,
        count: 1,
        note: log.notes,
      });
    }
  }
  const hotToday = [...weekdayCounts.values()]
    .filter(
      (row) =>
        row.weekday === todayWeekday && row.count >= COPILOT_HOT_WEEKDAY_MIN
    )
    .sort((a, b) => b.count - a.count);
  const hot = hotToday[0];
  if (hot) {
    const loc = byId.get(hot.locationId);
    if (loc) {
      const weekday = WEEKDAYS[todayWeekday] ?? "today";
      const hint = (hot.note || faceLabel(loc)).slice(0, 40);
      const already = input.rotations.find(
        (row) => (row.location_id || row.store_locations?.id) === loc.id
      );
      const alreadyQueued =
        (already && downstockRotationIds.has(already.id)) ||
        downstockLocationIds.has(loc.id);
      if (!alreadyQueued) {
        recs.push({
          id: `velocity:${loc.id}:${todayWeekday}`,
          pattern: "velocity",
          title: `${formatBayTag(loc)} (${hint}) usually depletes by ${weekday} afternoon`,
          detail: `${hot.count} heavy packdown / true-hole logs on ${weekday}s`,
          actionLabel: "Add to Today's Downstock",
          action: "downstock",
          locationIds: [loc.id],
          rotationId: already?.id,
          departmentId: loc.department_id,
          note: `Weekend/weekday hotspot · ${hint}`,
        });
      }
    }
  }

  const decaying = locations.filter((loc) => {
    if (weekLocationIds.has(loc.id)) return false;
    const age =
      daysSinceIso(loc.last_serviced_at) ??
      daysSinceIso(loc.last_completed_at);
    if (age == null) return true;
    return age > COPILOT_DECAY_DAYS;
  });
  const adjacentDecay = decaying.filter((loc) =>
    openZones.some((zone) => adjacent(loc, zone))
  );
  if (adjacentDecay.length > 0 && departmentId) {
    const pick = adjacentDecay.slice(0, 2);
    recs.push({
      id: `decay:${pick.map((l) => l.id).join(",")}`,
      pattern: "decay",
      title: `${pick.length} unserviced bay${
        pick.length === 1 ? "" : "s"
      } next to today's rotation (${COPILOT_DECAY_DAYS}+ days)`,
      detail: pick.map((loc) => formatBayTag(loc)).join(" · "),
      actionLabel: "Stage to Shift",
      action: "stage",
      locationIds: pick.map((loc) => loc.id),
      departmentId,
    });
  }

  if (week && departmentId) {
    const [roster, days, assignments] = await Promise.all([
      fetchSpecialists().catch(() => [] as StoreSpecialist[]),
      fetchShiftDays().catch(() => ({} as Record<string, AssociateShiftDay>)),
      fetchSundayAssignments(week).catch(() => ({} as SundayAssignmentMap)),
    ]);
    const board = composeShiftBoard(roster, days, localWorkDate());
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const completions = new Map<string, number>();
    const assignedCount = new Map<string, number>();
    for (const row of input.rotations) {
      const assignment = assignments[row.id];
      if (!assignment) continue;
      assignedCount.set(
        assignment.specialist_id,
        (assignedCount.get(assignment.specialist_id) ?? 0) + 1
      );
      if (!row.is_completed || !row.completed_at) continue;
      const doneAt = Date.parse(row.completed_at);
      if (!Number.isFinite(doneAt) || doneAt < todayStart.getTime()) continue;
      completions.set(
        assignment.specialist_id,
        (completions.get(assignment.specialist_id) ?? 0) + 1
      );
    }
    const fast = roster
      .filter((member) => {
        if (member.role === "MasterAdmin") return false;
        const day = board.find((d) => d.specialist_id === String(member.id));
        return isOnDutyToday(day);
      })
      .map((member) => {
        const done = completions.get(String(member.id)) ?? 0;
        const assigned = assignedCount.get(String(member.id)) ?? 0;
        return { member, done, assigned };
      })
      .filter(
        (row) => row.done >= 3 || (row.assigned > 0 && row.done / row.assigned >= 0.6)
      )
      .sort((a, b) => b.done - a.done)[0];

    const unusedDecay = adjacentDecay.filter(
      (loc) => !recs.some((rec) => rec.locationIds.includes(loc.id))
    );
    if (fast && unusedDecay.length > 0) {
      const pull = unusedDecay.slice(0, 2);
      recs.push({
        id: `pace:${fast.member.id}:${pull.map((l) => l.id).join(",")}`,
        pattern: "pace",
        title: `${fast.member.name} is ahead (${fast.done} done today) — pull ${pull.length} adjacent decaying bay${
          pull.length === 1 ? "" : "s"
        }`,
        detail: pull.map((loc) => formatBayTag(loc)).join(" · "),
        actionLabel: `Add to ${fast.member.name.split(" ")[0]}'s queue`,
        action: "stage_assign",
        locationIds: pull.map((loc) => loc.id),
        departmentId,
        specialistId: String(fast.member.id),
        specialistName: fast.member.name,
      });
    }

  }

  const seen = new Set<string>();
  const unique: CopilotRecommendation[] = [];
  for (const rec of recs) {
    if (seen.has(rec.id)) continue;
    seen.add(rec.id);
    unique.push(rec);
    if (unique.length >= 3) break;
  }
  return unique;
}

export async function applyCopilotAction(
  specialist: StoreSpecialist,
  week: string,
  rec: CopilotRecommendation
): Promise<string> {
  const departmentId = rec.departmentId;
  if (rec.action === "downstock") {
    let rotationId = rec.rotationId;
    const locationId = rec.locationIds[0];
    if (!rotationId && locationId && departmentId) {
      await assignLocationsToWeek(specialist, [locationId], departmentId);
      const weekData = await fetchThisWeekRotations(specialist, departmentId);
      rotationId =
        weekData.rotations.find(
          (row) => (row.location_id || row.store_locations?.id) === locationId
        )?.id ?? "";
    }
    if (!rotationId) {
      throw new Error("Could not stage that bay onto today's downstock queue");
    }
    await flagForDownstock({
      week,
      rotationId,
      locationId,
      note: rec.note || "Copilot hotspot",
      flaggedBy: specialist.name,
    });
    return `Added ${formatBayTagFromRec(rec)} to today's downstock`;
  }

  if (!departmentId) {
    throw new Error("Department context is required to stage bays");
  }
  await assignLocationsToWeek(specialist, rec.locationIds, departmentId);

  if (rec.action === "stage_assign" && rec.specialistId && week) {
    const weekData = await fetchThisWeekRotations(specialist, departmentId);
    const stamp = new Date().toISOString();
    for (const locId of rec.locationIds) {
      const rotation = weekData.rotations.find(
        (row) => (row.location_id || row.store_locations?.id) === locId
      );
      if (!rotation) continue;
      await setSundayBayAssignment(week, rotation.id, {
        specialist_id: rec.specialistId,
        specialist_name: rec.specialistName || "Associate",
        assigned_at: stamp,
        status: "assigned",
      });
    }
  }

  const tags = rec.detail || `${rec.locationIds.length} bay(s)`;
  return `Staged ${tags} onto this week's shift`;
}

function formatBayTagFromRec(rec: CopilotRecommendation): string {
  const m = /([A-Z0-9]+-B\d+)/.exec(rec.title);
  return m?.[1] ?? "bay";
}
