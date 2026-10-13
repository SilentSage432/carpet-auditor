/**
 * DEPTSYNC-MAP-003 — week-scoped supervisory bay priority.
 *
 * Supervisor intent that a physical bay receive preferential consideration
 * in an ownership-bound weekly rotation proposal for one target week.
 *
 * Not an assignment. Does not increase capacity, transfer section ownership,
 * create Zebra tasks, or silently carry into other weeks.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeAisle } from "./aisle";
import {
  indexBaySectionLookups,
  listOperationalSections,
  type BaySectionLookup,
} from "./operational-sections";
import {
  lookupBaySection,
  sectionAwarePhysicalKey,
} from "./section-aware-rotation";
import {
  parseIsoWeekLabel,
  resolveNextRotationWeekLabel,
  isoWeekToMondayDate,
} from "./week";

export { resolveNextRotationWeekLabel };

export type WeekBayPriorityRow = {
  id: string;
  store_id: string;
  store_number: string;
  week_label: string;
  week_starting: string;
  department_id: string;
  aisle: string;
  bay: number;
  section_id: string | null;
  section_name: string | null;
  owner_specialist_id: string | null;
  prioritized_by_specialist_id: string;
  created_at: string;
  revoked_at: string | null;
  revoked_by_specialist_id: string | null;
};

export type WeekBayPriorityView = WeekBayPriorityRow & {
  physical_key: string;
  active: boolean;
};

export type WeekBayPriorityOutcomeStatus =
  | "priority_requested"
  | "included_in_proposal"
  | "not_included"
  | "already_assigned";

export type WeekBayPriorityOutcomeReasonCode =
  | "included"
  | "already_assigned"
  | "not_staged"
  | "ownership_missing"
  | "ownership_ambiguous"
  | "owner_changed"
  | "owner_not_eligible"
  | "capacity_exhausted"
  | "not_selected";

export type WeekBayPriorityOutcome = {
  priority_id: string | null;
  department_id: string;
  aisle: string;
  bay: number;
  physical_key: string;
  week_label: string;
  status: WeekBayPriorityOutcomeStatus;
  reason_code: WeekBayPriorityOutcomeReasonCode;
  reason: string;
  section_id: string | null;
  section_name: string | null;
  owner_specialist_id: string | null;
  owner_name: string | null;
  prioritized_by_specialist_id: string | null;
};

export type WeekBayPriorityMutationResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: string; message: string; details?: unknown };

function isMissingRelation(
  err: { message?: string; code?: string } | null
): boolean {
  if (!err) return false;
  const msg = String(err.message ?? "");
  return (
    err.code === "42P01" ||
    /relation .* does not exist|Could not find the table/i.test(msg)
  );
}

function normalizeBayNumber(raw: unknown): number | null {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

export function weekBayPriorityPhysicalKey(input: {
  department_id: string;
  aisle: string | number;
  bay: number | string;
}): string {
  return sectionAwarePhysicalKey(input);
}

export function buildWeekBayPriorityDigest(
  priorities: ReadonlyArray<{
    department_id: string;
    aisle: string | number;
    bay: number | string;
    id?: string | null;
  }>
): string {
  return priorities
    .map((p) => {
      const key = weekBayPriorityPhysicalKey(p);
      const id = String(p.id ?? "").trim();
      return id ? `${key}:${id}` : key;
    })
    .sort()
    .join("|");
}

function toView(row: WeekBayPriorityRow): WeekBayPriorityView {
  return {
    ...row,
    aisle: normalizeAisle(row.aisle),
    bay: Number(row.bay),
    physical_key: weekBayPriorityPhysicalKey(row),
    active: row.revoked_at == null,
  };
}

async function resolveLiveOwnership(
  supabase: SupabaseClient,
  input: { store_id: string; department_id: string; aisle: string; bay: number }
): Promise<{
  section: BaySectionLookup | null;
  conflict: boolean;
}> {
  const listed = await listOperationalSections(supabase, {
    store_id: input.store_id,
    department_id: input.department_id,
    includeMembers: true,
    includeRetired: false,
  });
  if (!listed.ok) {
    return { section: null, conflict: false };
  }
  const map = indexBaySectionLookups(listed.value);
  const key = weekBayPriorityPhysicalKey(input);
  // Detect ambiguous membership by scanning raw members for duplicate keys.
  let hits = 0;
  for (const section of listed.value) {
    for (const member of section.members ?? []) {
      if (weekBayPriorityPhysicalKey(member) === key) hits += 1;
    }
  }
  if (hits > 1) return { section: null, conflict: true };
  return { section: map.get(key) ?? null, conflict: false };
}

export async function listWeekBayPriorities(
  supabase: SupabaseClient,
  input: {
    store_number: string;
    week_label: string;
    department_id?: string | null;
    activeOnly?: boolean;
  }
): Promise<WeekBayPriorityMutationResult<WeekBayPriorityView[]>> {
  const storeNumber = String(input.store_number ?? "").trim();
  const weekLabel = String(input.week_label ?? "").trim();
  try {
    parseIsoWeekLabel(weekLabel);
  } catch {
    return {
      ok: false,
      code: "invalid_week",
      message: "week_label must be an ISO week like 2026-W42",
    };
  }
  if (!storeNumber) {
    return { ok: false, code: "invalid_store", message: "store_number required" };
  }

  let query = supabase
    .from("store_week_bay_priorities")
    .select("*")
    .eq("store_number", storeNumber)
    .eq("week_label", weekLabel)
    .order("created_at", { ascending: true });

  if (input.activeOnly !== false) {
    query = query.is("revoked_at", null);
  }
  const departmentId = String(input.department_id ?? "").trim();
  if (departmentId) {
    query = query.eq("department_id", departmentId);
  }

  const { data, error } = await query;
  if (error) {
    if (isMissingRelation(error)) {
      return { ok: true, value: [] };
    }
    return {
      ok: false,
      code: "query_failed",
      message: "Could not load week bay priorities",
      details: error,
    };
  }
  return {
    ok: true,
    value: ((data ?? []) as WeekBayPriorityRow[]).map(toView),
  };
}

export async function getActiveWeekBayPriorityForBay(
  supabase: SupabaseClient,
  input: {
    store_number: string;
    week_label: string;
    department_id: string;
    aisle: string;
    bay: number | string;
  }
): Promise<WeekBayPriorityMutationResult<WeekBayPriorityView | null>> {
  const listed = await listWeekBayPriorities(supabase, {
    store_number: input.store_number,
    week_label: input.week_label,
    department_id: input.department_id,
    activeOnly: true,
  });
  if (!listed.ok) return listed;
  const key = weekBayPriorityPhysicalKey({
    department_id: input.department_id,
    aisle: input.aisle,
    bay: input.bay,
  });
  return {
    ok: true,
    value: listed.value.find((row) => row.physical_key === key) ?? null,
  };
}

/**
 * Create or keep an active week-scoped priority for one physical bay.
 * Deduplicates: existing active row for the same bay/week is returned.
 */
export async function prioritizeBayForWeek(
  supabase: SupabaseClient,
  input: {
    store_id: string;
    store_number: string;
    week_label: string;
    department_id: string;
    aisle: string;
    bay: number | string;
    prioritized_by_specialist_id: string;
  }
): Promise<WeekBayPriorityMutationResult<WeekBayPriorityView>> {
  const storeId = String(input.store_id ?? "").trim();
  const storeNumber = String(input.store_number ?? "").trim();
  const weekLabel = String(input.week_label ?? "").trim();
  const departmentId = String(input.department_id ?? "").trim();
  const aisle = normalizeAisle(input.aisle);
  const bay = normalizeBayNumber(input.bay);
  const actorId = String(input.prioritized_by_specialist_id ?? "").trim();

  try {
    parseIsoWeekLabel(weekLabel);
  } catch {
    return {
      ok: false,
      code: "invalid_week",
      message: "week_label must be an ISO week like 2026-W42",
    };
  }
  if (!storeId || !storeNumber || !departmentId || !aisle || bay == null || !actorId) {
    return {
      ok: false,
      code: "invalid_input",
      message: "store, week, department, aisle, bay, and actor are required",
    };
  }

  const existing = await getActiveWeekBayPriorityForBay(supabase, {
    store_number: storeNumber,
    week_label: weekLabel,
    department_id: departmentId,
    aisle,
    bay,
  });
  if (!existing.ok) return existing;
  if (existing.value) {
    return { ok: true, value: existing.value };
  }

  const ownership = await resolveLiveOwnership(supabase, {
    store_id: storeId,
    department_id: departmentId,
    aisle,
    bay,
  });
  if (ownership.conflict) {
    return {
      ok: false,
      code: "ownership_ambiguous",
      message:
        "Bay has ambiguous Operational Section ownership — priority refused.",
    };
  }
  if (!ownership.section) {
    return {
      ok: false,
      code: "ownership_missing",
      message:
        "Bay has no Operational Section membership — resolve ownership before prioritizing.",
    };
  }
  const owner = String(
    ownership.section.primary_owner_specialist_id ?? ""
  ).trim();
  if (!owner) {
    return {
      ok: false,
      code: "ownership_missing",
      message:
        "Operational Section has no primary owner — priority refused.",
    };
  }

  const weekStarting = isoWeekToMondayDate(weekLabel);
  const { data, error } = await supabase
    .from("store_week_bay_priorities")
    .insert({
      store_id: storeId,
      store_number: storeNumber,
      week_label: weekLabel,
      week_starting: weekStarting,
      department_id: departmentId,
      aisle,
      bay,
      section_id: ownership.section.section_id,
      section_name: ownership.section.section_name,
      owner_specialist_id: owner,
      prioritized_by_specialist_id: actorId,
    })
    .select("*")
    .maybeSingle();

  if (error) {
    if (isMissingRelation(error)) {
      return {
        ok: false,
        code: "schema_missing",
        message:
          "Week bay priorities table is not available. Apply local MAP-003 migration.",
        details: error,
      };
    }
    // Unique race — reload active row.
    if (error.code === "23505") {
      const again = await getActiveWeekBayPriorityForBay(supabase, {
        store_number: storeNumber,
        week_label: weekLabel,
        department_id: departmentId,
        aisle,
        bay,
      });
      if (again.ok && again.value) return { ok: true, value: again.value };
    }
    return {
      ok: false,
      code: "insert_failed",
      message: "Could not prioritize bay for week",
      details: error,
    };
  }
  if (!data) {
    return {
      ok: false,
      code: "insert_failed",
      message: "Could not prioritize bay for week",
    };
  }
  return { ok: true, value: toView(data as WeekBayPriorityRow) };
}

export async function revokeWeekBayPriority(
  supabase: SupabaseClient,
  input: {
    store_number: string;
    priority_id?: string | null;
    week_label?: string | null;
    department_id?: string | null;
    aisle?: string | null;
    bay?: number | string | null;
    revoked_by_specialist_id: string;
  }
): Promise<WeekBayPriorityMutationResult<WeekBayPriorityView>> {
  const actorId = String(input.revoked_by_specialist_id ?? "").trim();
  if (!actorId) {
    return {
      ok: false,
      code: "invalid_input",
      message: "revoked_by_specialist_id is required",
    };
  }

  let target: WeekBayPriorityView | null = null;
  const priorityId = String(input.priority_id ?? "").trim();
  if (priorityId) {
    const { data, error } = await supabase
      .from("store_week_bay_priorities")
      .select("*")
      .eq("id", priorityId)
      .eq("store_number", String(input.store_number ?? "").trim())
      .maybeSingle();
    if (error) {
      if (isMissingRelation(error)) {
        return {
          ok: false,
          code: "schema_missing",
          message: "Week bay priorities table is not available.",
        };
      }
      return {
        ok: false,
        code: "query_failed",
        message: "Could not load priority",
        details: error,
      };
    }
    if (data) target = toView(data as WeekBayPriorityRow);
  } else {
    const weekLabel = String(input.week_label ?? "").trim();
    const departmentId = String(input.department_id ?? "").trim();
    const aisle = normalizeAisle(input.aisle ?? "");
    const bay = normalizeBayNumber(input.bay);
    if (!weekLabel || !departmentId || !aisle || bay == null) {
      return {
        ok: false,
        code: "invalid_input",
        message: "priority_id or week/department/aisle/bay required",
      };
    }
    const found = await getActiveWeekBayPriorityForBay(supabase, {
      store_number: String(input.store_number ?? "").trim(),
      week_label: weekLabel,
      department_id: departmentId,
      aisle,
      bay,
    });
    if (!found.ok) return found;
    target = found.value;
  }

  if (!target) {
    return { ok: false, code: "not_found", message: "Active priority not found" };
  }
  if (target.revoked_at) {
    return { ok: true, value: target };
  }

  const { data, error } = await supabase
    .from("store_week_bay_priorities")
    .update({
      revoked_at: new Date().toISOString(),
      revoked_by_specialist_id: actorId,
    })
    .eq("id", target.id)
    .eq("store_number", target.store_number)
    .is("revoked_at", null)
    .select("*")
    .maybeSingle();

  if (error) {
    return {
      ok: false,
      code: "revoke_failed",
      message: "Could not revoke priority",
      details: error,
    };
  }
  if (!data) {
    return { ok: false, code: "not_found", message: "Active priority not found" };
  }
  return { ok: true, value: toView(data as WeekBayPriorityRow) };
}

/**
 * Explain how week-scoped priorities fared against a composed proposal.
 * Pure — does not persist or invent assignments.
 */
export function evaluateWeekBayPriorityOutcomes(input: {
  week_label: string;
  priorities: ReadonlyArray<WeekBayPriorityView>;
  baySectionByKey: ReadonlyMap<string, BaySectionLookup>;
  /** Physical keys present in the staged/candidate pool for this week. */
  stagedPhysicalKeys: ReadonlySet<string> | readonly string[];
  /** Physical keys already owned for the week. */
  assignedPhysicalKeys?: ReadonlySet<string> | readonly string[];
  /** Physical keys included in the proposal items. */
  proposedPhysicalKeys: ReadonlySet<string> | readonly string[];
  /** Remaining capacity before proposal (approved − already owned). */
  remainingBySpecialist: ReadonlyMap<string, number> | Record<string, number>;
  /** Proposed counts by specialist (consumed from remaining when explaining). */
  proposedBySpecialist?: ReadonlyMap<string, number> | Record<string, number>;
  /** Eligible associate ids for the week. */
  eligibleSpecialistIds: ReadonlySet<string> | readonly string[];
  memberNamesById?: ReadonlyMap<string, string> | Record<string, string>;
}): WeekBayPriorityOutcome[] {
  const staged = new Set(
    [...input.stagedPhysicalKeys].map((k) => String(k).trim()).filter(Boolean)
  );
  const assigned = new Set(
    [...(input.assignedPhysicalKeys ?? [])]
      .map((k) => String(k).trim())
      .filter(Boolean)
  );
  const proposed = new Set(
    [...input.proposedPhysicalKeys].map((k) => String(k).trim()).filter(Boolean)
  );
  const remainingBefore =
    input.remainingBySpecialist instanceof Map
      ? input.remainingBySpecialist
      : new Map(
          Object.entries(input.remainingBySpecialist).map(([k, v]) => [
            k,
            Math.max(0, Math.floor(Number(v) || 0)),
          ])
        );
  const proposedCounts =
    input.proposedBySpecialist instanceof Map
      ? input.proposedBySpecialist
      : new Map(
          Object.entries(input.proposedBySpecialist ?? {}).map(([k, v]) => [
            k,
            Math.max(0, Math.floor(Number(v) || 0)),
          ])
        );
  const remainingAfter = new Map<string, number>();
  for (const [id, n] of remainingBefore) {
    remainingAfter.set(
      id,
      Math.max(0, n - (proposedCounts.get(id) ?? 0))
    );
  }
  const eligible = new Set(
    [...input.eligibleSpecialistIds].map((id) => String(id).trim()).filter(Boolean)
  );
  const names =
    input.memberNamesById instanceof Map
      ? input.memberNamesById
      : new Map(Object.entries(input.memberNamesById ?? {}));

  const active = input.priorities.filter((p) => p.active);
  return active
    .slice()
    .sort((a, b) => a.physical_key.localeCompare(b.physical_key))
    .map((priority) => {
      const key = priority.physical_key;
      const live = lookupBaySection(priority, input.baySectionByKey);
      const ownerId = String(live?.primary_owner_specialist_id ?? "").trim();
      const ownerName = ownerId
        ? names.get(ownerId) ?? live?.primary_owner_name ?? null
        : null;
      const base = {
        priority_id: priority.id,
        department_id: priority.department_id,
        aisle: normalizeAisle(priority.aisle),
        bay: Number(priority.bay),
        physical_key: key,
        week_label: input.week_label,
        section_id: live?.section_id ?? priority.section_id,
        section_name: live?.section_name ?? priority.section_name,
        owner_specialist_id: ownerId || priority.owner_specialist_id,
        owner_name: ownerName,
        prioritized_by_specialist_id: priority.prioritized_by_specialist_id,
      };

      if (assigned.has(key)) {
        return {
          ...base,
          status: "already_assigned" as const,
          reason_code: "already_assigned" as const,
          reason: "Bay is already assigned this week — priority did not create a second assignment.",
        };
      }
      if (proposed.has(key)) {
        return {
          ...base,
          status: "included_in_proposal" as const,
          reason_code: "included" as const,
          reason:
            "Priority requested — included in the ownership proposal (not assigned until confirmed).",
        };
      }
      if (!live) {
        return {
          ...base,
          status: "not_included" as const,
          reason_code: "ownership_missing" as const,
          reason:
            "Bay has no live Operational Section membership — cannot be auto-proposed.",
        };
      }
      if (!ownerId) {
        return {
          ...base,
          status: "not_included" as const,
          reason_code: "ownership_missing" as const,
          reason:
            "Operational Section has no primary owner — cannot be auto-proposed.",
        };
      }
      const snapOwner = String(priority.owner_specialist_id ?? "").trim();
      if (snapOwner && snapOwner !== ownerId) {
        return {
          ...base,
          status: "not_included" as const,
          reason_code: "owner_changed" as const,
          reason:
            "Section ownership changed after the priority was set — proposal uses live ownership only.",
        };
      }
      if (!eligible.has(ownerId)) {
        return {
          ...base,
          status: "not_included" as const,
          reason_code: "owner_not_eligible" as const,
          reason:
            "Section owner is not eligible for this week’s capacity plan.",
        };
      }
      const remainingForOwner =
        remainingAfter.get(ownerId) ??
        Math.max(
          0,
          (remainingBefore.get(ownerId) ?? 0) - (proposedCounts.get(ownerId) ?? 0)
        );
      if (remainingForOwner <= 0) {
        return {
          ...base,
          status: "not_included" as const,
          reason_code: "capacity_exhausted" as const,
          reason:
            "Approved remaining capacity for the section owner is already full — priority does not increase capacity.",
        };
      }
      if (!staged.has(key)) {
        return {
          ...base,
          status: "not_included" as const,
          reason_code: "not_staged" as const,
          reason:
            "Bay is not in this week’s staged candidate pool — priority cannot invent a rotation.",
        };
      }
      return {
        ...base,
        status: "not_included" as const,
        reason_code: "not_selected" as const,
        reason:
          "Priority requested but not selected after ownership, capacity, and tier rules.",
      };
    });
}
