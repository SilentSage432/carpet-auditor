/**
 * DEPTSYNC-ROTATION-AUTO-008A — standing weekly capacity authorization.
 *
 * Owns: store-scoped standing capacity policy, prospective materialization into
 * existing store_week_capacity_approvals, and provenance (explicit vs standing).
 *
 * Does not: replace weekly approvals, redistribute sections, enable auto-publish,
 * or rewrite published weeks.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildAssociateWeekScheduleFingerprint,
  isApprovedCapacityValue,
  loadWeekCapacityApprovals,
  writeWeekCapacityApprovals,
  type ApprovedCapacityValue,
  type CapacityApprovalRow,
} from "@/lib/store-ops/approved-week-capacity";
import {
  composeWeekLaborAvailability,
} from "@/lib/store-ops/labor-availability";
import {
  loadStoreWeekAssignments,
  resolveCapacityOwnerId,
} from "@/lib/store-ops/shared-week-capacity";
import { storeNumberQueryValues } from "@/lib/store";
import { isoWeekCalendarRange, isoWeekToMondayDate } from "@/lib/store-ops/week";

export const STANDING_CAPACITY_SOURCE_EXPLICIT = "explicit" as const;
export const STANDING_CAPACITY_SOURCE_STANDING = "standing" as const;

export type StandingCapacitySource =
  | typeof STANDING_CAPACITY_SOURCE_EXPLICIT
  | typeof STANDING_CAPACITY_SOURCE_STANDING;

export type StandingCapacityPolicyItem = {
  specialist_id: string;
  approved_capacity: ApprovedCapacityValue;
};

export type StandingCapacityPolicy = {
  id: string;
  store_number: string;
  policy_version: number;
  is_active: boolean;
  effective_at: string;
  revoked_at: string | null;
  established_by_specialist_id: string;
  note: string | null;
  items: StandingCapacityPolicyItem[];
};

export type ApprovalProvenanceRow = {
  store_number: string;
  week_label: string;
  specialist_id: string;
  source: StandingCapacitySource;
  standing_policy_id: string | null;
  materialized_at: string | null;
};

export type StandingMaterializeWriteItem = {
  specialist_id: string;
  approved_capacity: ApprovedCapacityValue;
  schedule_fingerprint: string;
};

export type StandingMaterializePlan =
  | {
      action: "skip";
      reason: string;
      code:
        | "ALREADY_COMPLETE"
        | "PUBLISHED_WEEK_PROTECTED"
        | "NOTHING_TO_WRITE";
    }
  | {
      action: "fail";
      code:
        | "STANDING_CAPACITY_MISSING"
        | "STANDING_CAPACITY_EMPTY"
        | "STANDING_CAPACITY_INCOMPLETE"
        | "STANDING_CAPACITY_AMBIGUOUS"
        | "STANDING_CAPACITY_BELOW_OWNED"
        | "STANDING_CAPACITY_SCOPE";
      error: string;
    }
  | {
      action: "write";
      policy_id: string;
      policy_version: number;
      items: StandingMaterializeWriteItem[];
    };

/**
 * Pure planner — decide how to materialize standing capacity for one future week.
 * Never invents specialist ids or capacities outside the standing policy.
 */
export function planStandingCapacityMaterialization(input: {
  store_number: string;
  week_label: string;
  policy: StandingCapacityPolicy | null;
  eligible_specialist_ids: readonly string[];
  existing_approvals: readonly CapacityApprovalRow[];
  provenance_by_specialist: ReadonlyMap<string, ApprovalProvenanceRow>;
  live_fingerprints: Readonly<Record<string, string>>;
  owned_by_specialist: Readonly<Record<string, number>>;
  owned_total: number;
}): StandingMaterializePlan {
  const store = String(input.store_number ?? "").trim();
  const week = String(input.week_label ?? "").trim();
  if (!store || !week) {
    return {
      action: "fail",
      code: "STANDING_CAPACITY_SCOPE",
      error: "store_number and week_label are required",
    };
  }

  const policy = input.policy;
  if (!policy || policy.is_active !== true) {
    return {
      action: "fail",
      code: "STANDING_CAPACITY_MISSING",
      error:
        "No active standing weekly capacity policy for this store. MasterAdmin must establish standing capacity before automatic week materialization.",
    };
  }
  if (String(policy.store_number).trim() !== store) {
    return {
      action: "fail",
      code: "STANDING_CAPACITY_SCOPE",
      error: "Standing policy store_number does not match request store",
    };
  }
  if (!policy.items.length) {
    return {
      action: "fail",
      code: "STANDING_CAPACITY_EMPTY",
      error: "Standing capacity policy has no associate items",
    };
  }

  const eligible = [
    ...new Set(
      input.eligible_specialist_ids.map((id) => String(id).trim()).filter(Boolean)
    ),
  ].sort();
  if (eligible.length === 0) {
    return {
      action: "fail",
      code: "STANDING_CAPACITY_INCOMPLETE",
      error: "No eligible associates for standing capacity materialization",
    };
  }

  const policyById = new Map<string, ApprovedCapacityValue>();
  for (const item of policy.items) {
    const sid = String(item.specialist_id ?? "").trim();
    if (!sid) {
      return {
        action: "fail",
        code: "STANDING_CAPACITY_AMBIGUOUS",
        error: "Standing policy contains an empty specialist_id",
      };
    }
    if (policyById.has(sid)) {
      return {
        action: "fail",
        code: "STANDING_CAPACITY_AMBIGUOUS",
        error: `Standing policy lists specialist ${sid} more than once`,
      };
    }
    if (!isApprovedCapacityValue(item.approved_capacity)) {
      return {
        action: "fail",
        code: "STANDING_CAPACITY_AMBIGUOUS",
        error: `Standing policy capacity for ${sid} is not 0–3`,
      };
    }
    policyById.set(sid, item.approved_capacity);
  }

  for (const sid of eligible) {
    if (!policyById.has(sid)) {
      return {
        action: "fail",
        code: "STANDING_CAPACITY_INCOMPLETE",
        error: `Standing policy does not cover eligible associate ${sid}`,
      };
    }
  }

  // Published / in-progress weeks with ownership: never rewrite capacity from standing.
  if (input.owned_total > 0) {
    return {
      action: "skip",
      code: "PUBLISHED_WEEK_PROTECTED",
      reason:
        "Week already has owned assignments — standing materialization will not alter capacity",
    };
  }

  const approvalById = new Map(
    input.existing_approvals.map((row) => [
      String(row.specialist_id).trim(),
      row,
    ])
  );

  const writes: StandingMaterializeWriteItem[] = [];
  let allFreshStanding = true;

  for (const sid of eligible) {
    const standingCap = policyById.get(sid)!;
    const owned = Math.max(0, Math.floor(input.owned_by_specialist[sid] ?? 0));
    if (standingCap < owned) {
      return {
        action: "fail",
        code: "STANDING_CAPACITY_BELOW_OWNED",
        error: `Standing capacity ${standingCap} is below owned ${owned} for ${sid}`,
      };
    }

    const liveFp = String(input.live_fingerprints[sid] ?? "").trim();
    if (!liveFp) {
      return {
        action: "fail",
        code: "STANDING_CAPACITY_AMBIGUOUS",
        error: `Missing live schedule fingerprint for ${sid}`,
      };
    }

    const existing = approvalById.get(sid);
    const provenance = input.provenance_by_specialist.get(sid);
    const isExplicit =
      provenance?.source === STANDING_CAPACITY_SOURCE_EXPLICIT ||
      // Legacy rows without provenance are treated as explicit (do not overwrite).
      (existing != null && provenance == null);

    if (isExplicit && existing) {
      // Explicit weekly MasterAdmin decisions survive standing materialization.
      const fresh =
        existing.schedule_fingerprint === liveFp &&
        Number(existing.approved_capacity) === standingCap;
      if (!fresh) {
        // Explicit row present but stale/mismatch — leave it; do not silently replace.
        allFreshStanding = false;
      }
      continue;
    }

    const alreadyStandingFresh =
      existing != null &&
      provenance?.source === STANDING_CAPACITY_SOURCE_STANDING &&
      existing.schedule_fingerprint === liveFp &&
      Number(existing.approved_capacity) === standingCap &&
      String(provenance.standing_policy_id ?? "") === String(policy.id);

    if (alreadyStandingFresh) {
      continue;
    }

    allFreshStanding = false;
    writes.push({
      specialist_id: sid,
      approved_capacity: standingCap,
      schedule_fingerprint: liveFp,
    });
  }

  if (writes.length === 0) {
    if (allFreshStanding || eligible.every((sid) => approvalById.has(sid))) {
      return {
        action: "skip",
        code: "ALREADY_COMPLETE",
        reason: "Weekly approvals already match standing policy (or explicit overrides)",
      };
    }
    return {
      action: "skip",
      code: "NOTHING_TO_WRITE",
      reason: "No standing materialization writes required",
    };
  }

  return {
    action: "write",
    policy_id: policy.id,
    policy_version: policy.policy_version,
    items: writes,
  };
}

export function validateStandingPolicyItems(
  items: ReadonlyArray<{ specialist_id?: unknown; approved_capacity?: unknown }>
):
  | { ok: true; items: StandingCapacityPolicyItem[] }
  | { ok: false; error: string; code: string } {
  if (!Array.isArray(items) || items.length === 0) {
    return {
      ok: false,
      code: "STANDING_CAPACITY_EMPTY",
      error: "items[] with specialist_id and approved_capacity required",
    };
  }
  const seen = new Set<string>();
  const out: StandingCapacityPolicyItem[] = [];
  for (const raw of items) {
    const sid = String(raw?.specialist_id ?? "").trim();
    if (!sid) {
      return {
        ok: false,
        code: "STANDING_CAPACITY_AMBIGUOUS",
        error: "specialist_id is required",
      };
    }
    if (seen.has(sid)) {
      return {
        ok: false,
        code: "STANDING_CAPACITY_AMBIGUOUS",
        error: `Duplicate specialist_id ${sid}`,
      };
    }
    seen.add(sid);
    const capRaw =
      typeof raw.approved_capacity === "string" ||
      typeof raw.approved_capacity === "number"
        ? Number(raw.approved_capacity)
        : NaN;
    if (!isApprovedCapacityValue(capRaw)) {
      return {
        ok: false,
        code: "STANDING_CAPACITY_AMBIGUOUS",
        error: `approved_capacity for ${sid} must be 0–3`,
      };
    }
    out.push({ specialist_id: sid, approved_capacity: capRaw });
  }
  return { ok: true, items: out };
}

function isMissingRelation(message: string): boolean {
  return /store_standing_capacity|approval_provenance|PGRST|does not exist|42P01/i.test(
    message
  );
}

export async function loadActiveStandingCapacityPolicy(
  supabase: SupabaseClient,
  storeNumber: string
): Promise<
  | { ok: true; policy: StandingCapacityPolicy | null; schema_ready: true }
  | { ok: true; policy: null; schema_ready: false }
  | { ok: false; error: string }
> {
  const store = String(storeNumber ?? "").trim();
  if (!store) return { ok: false, error: "store_number required" };
  const keys = storeNumberQueryValues(store);

  const { data: policyRow, error } = await supabase
    .from("store_standing_capacity_policies")
    .select(
      "id, store_number, policy_version, is_active, effective_at, revoked_at, established_by_specialist_id, note"
    )
    .in("store_number", keys)
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    if (isMissingRelation(error.message)) {
      return { ok: true, policy: null, schema_ready: false };
    }
    return { ok: false, error: error.message };
  }
  if (!policyRow) {
    return { ok: true, policy: null, schema_ready: true };
  }

  const { data: items, error: itemsErr } = await supabase
    .from("store_standing_capacity_policy_items")
    .select("specialist_id, approved_capacity")
    .eq("policy_id", policyRow.id);
  if (itemsErr) {
    if (isMissingRelation(itemsErr.message)) {
      return { ok: true, policy: null, schema_ready: false };
    }
    return { ok: false, error: itemsErr.message };
  }

  const parsed: StandingCapacityPolicyItem[] = [];
  for (const row of items ?? []) {
    const sid = String(row.specialist_id ?? "").trim();
    const cap = Number(row.approved_capacity);
    if (!sid || !isApprovedCapacityValue(cap)) continue;
    parsed.push({ specialist_id: sid, approved_capacity: cap });
  }

  return {
    ok: true,
    schema_ready: true,
    policy: {
      id: String(policyRow.id),
      store_number: String(policyRow.store_number),
      policy_version: Number(policyRow.policy_version) || 1,
      is_active: policyRow.is_active === true,
      effective_at: String(policyRow.effective_at ?? ""),
      revoked_at: policyRow.revoked_at ? String(policyRow.revoked_at) : null,
      established_by_specialist_id: String(
        policyRow.established_by_specialist_id ?? ""
      ),
      note: policyRow.note != null ? String(policyRow.note) : null,
      items: parsed,
    },
  };
}

export async function loadWeekCapacityApprovalProvenance(
  supabase: SupabaseClient,
  storeNumber: string,
  weekLabel: string
): Promise<
  | { ok: true; rows: ApprovalProvenanceRow[]; schema_ready: true }
  | { ok: true; rows: []; schema_ready: false }
  | { ok: false; error: string }
> {
  const store = String(storeNumber ?? "").trim();
  const week = String(weekLabel ?? "").trim();
  const keys = storeNumberQueryValues(store);
  const { data, error } = await supabase
    .from("store_week_capacity_approval_provenance")
    .select(
      "store_number, week_label, specialist_id, source, standing_policy_id, materialized_at"
    )
    .in("store_number", keys)
    .eq("week_label", week);
  if (error) {
    if (isMissingRelation(error.message)) {
      return { ok: true, rows: [], schema_ready: false };
    }
    return { ok: false, error: error.message };
  }
  return {
    ok: true,
    schema_ready: true,
    rows: (data ?? []).map((row) => ({
      store_number: String(row.store_number),
      week_label: String(row.week_label),
      specialist_id: String(row.specialist_id),
      source:
        row.source === STANDING_CAPACITY_SOURCE_STANDING
          ? STANDING_CAPACITY_SOURCE_STANDING
          : STANDING_CAPACITY_SOURCE_EXPLICIT,
      standing_policy_id: row.standing_policy_id
        ? String(row.standing_policy_id)
        : null,
      materialized_at: row.materialized_at
        ? String(row.materialized_at)
        : null,
    })),
  };
}

export async function recordWeekCapacityApprovalProvenance(
  supabase: SupabaseClient,
  input: {
    store_number: string;
    week_label: string;
    specialist_ids: readonly string[];
    source: StandingCapacitySource;
    standing_policy_id?: string | null;
  }
): Promise<{ ok: boolean; skipped_schema?: boolean; error?: string }> {
  const store = String(input.store_number ?? "").trim();
  const week = String(input.week_label ?? "").trim();
  const ids = [
    ...new Set(input.specialist_ids.map((id) => String(id).trim()).filter(Boolean)),
  ];
  if (!store || !week || ids.length === 0) {
    return { ok: false, error: "store, week, and specialist_ids required" };
  }
  const now = new Date().toISOString();
  const rows = ids.map((specialist_id) => ({
    store_number: store,
    week_label: week,
    specialist_id,
    source: input.source,
    standing_policy_id:
      input.source === STANDING_CAPACITY_SOURCE_STANDING
        ? String(input.standing_policy_id ?? "").trim() || null
        : null,
    materialized_at:
      input.source === STANDING_CAPACITY_SOURCE_STANDING ? now : null,
    recorded_at: now,
  }));

  const { error } = await supabase
    .from("store_week_capacity_approval_provenance")
    .upsert(rows, { onConflict: "store_number,week_label,specialist_id" });
  if (error) {
    if (isMissingRelation(error.message)) {
      return { ok: true, skipped_schema: true };
    }
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

/**
 * Establish a new active standing policy (revokes prior active version).
 * MasterAdmin-only at the API boundary.
 */
export async function establishStandingCapacityPolicy(
  supabase: SupabaseClient,
  input: {
    store_number: string;
    established_by_specialist_id: string;
    items: StandingCapacityPolicyItem[];
    note?: string | null;
  }
): Promise<
  | { ok: true; policy: StandingCapacityPolicy }
  | { ok: false; error: string; code?: string }
> {
  const store = String(input.store_number ?? "").trim();
  const by = String(input.established_by_specialist_id ?? "").trim();
  if (!store || !by) {
    return {
      ok: false,
      code: "STANDING_CAPACITY_SCOPE",
      error: "store_number and established_by_specialist_id required",
    };
  }
  const validated = validateStandingPolicyItems(input.items);
  if (!validated.ok) {
    return { ok: false, code: validated.code, error: validated.error };
  }

  const keys = storeNumberQueryValues(store);
  const { data: prior, error: priorErr } = await supabase
    .from("store_standing_capacity_policies")
    .select("policy_version")
    .in("store_number", keys)
    .order("policy_version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (priorErr && !isMissingRelation(priorErr.message)) {
    return { ok: false, error: priorErr.message };
  }
  if (priorErr && isMissingRelation(priorErr.message)) {
    return {
      ok: false,
      code: "STANDING_CAPACITY_SCHEMA_MISSING",
      error: priorErr.message,
    };
  }

  const nextVersion = (Number(prior?.policy_version) || 0) + 1;
  const now = new Date().toISOString();

  // Revoke currently active (best-effort before insert).
  await supabase
    .from("store_standing_capacity_policies")
    .update({ is_active: false, revoked_at: now, updated_at: now })
    .in("store_number", keys)
    .eq("is_active", true);

  const { data: created, error: createErr } = await supabase
    .from("store_standing_capacity_policies")
    .insert({
      store_number: store,
      policy_version: nextVersion,
      is_active: true,
      effective_at: now,
      revoked_at: null,
      established_by_specialist_id: by,
      note: input.note != null ? String(input.note) : null,
      created_at: now,
      updated_at: now,
    })
    .select(
      "id, store_number, policy_version, is_active, effective_at, revoked_at, established_by_specialist_id, note"
    )
    .single();

  if (createErr || !created) {
    return {
      ok: false,
      code: isMissingRelation(String(createErr?.message ?? ""))
        ? "STANDING_CAPACITY_SCHEMA_MISSING"
        : "STANDING_CAPACITY_WRITE_FAILED",
      error: createErr?.message ?? "Failed to create standing policy",
    };
  }

  const { error: itemsErr } = await supabase
    .from("store_standing_capacity_policy_items")
    .insert(
      validated.items.map((item) => ({
        policy_id: created.id,
        specialist_id: item.specialist_id,
        approved_capacity: item.approved_capacity,
      }))
    );
  if (itemsErr) {
    return {
      ok: false,
      code: "STANDING_CAPACITY_WRITE_FAILED",
      error: itemsErr.message,
    };
  }

  return {
    ok: true,
    policy: {
      id: String(created.id),
      store_number: String(created.store_number),
      policy_version: Number(created.policy_version) || nextVersion,
      is_active: created.is_active === true,
      effective_at: String(created.effective_at ?? now),
      revoked_at: null,
      established_by_specialist_id: String(created.established_by_specialist_id),
      note: created.note != null ? String(created.note) : null,
      items: validated.items,
    },
  };
}

export async function revokeActiveStandingCapacityPolicy(
  supabase: SupabaseClient,
  input: { store_number: string }
): Promise<{ ok: boolean; error?: string; code?: string }> {
  const store = String(input.store_number ?? "").trim();
  if (!store) {
    return { ok: false, code: "STANDING_CAPACITY_SCOPE", error: "store required" };
  }
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("store_standing_capacity_policies")
    .update({ is_active: false, revoked_at: now, updated_at: now })
    .in("store_number", storeNumberQueryValues(store))
    .eq("is_active", true);
  if (error) {
    return {
      ok: false,
      code: isMissingRelation(error.message)
        ? "STANDING_CAPACITY_SCHEMA_MISSING"
        : "STANDING_CAPACITY_WRITE_FAILED",
      error: error.message,
    };
  }
  return { ok: true };
}

async function loadEligibleAndFingerprints(
  supabase: SupabaseClient,
  input: {
    store_number: string;
    week_label: string;
    department_codes: readonly string[];
  }
): Promise<{
  eligible_specialist_ids: string[];
  live_fingerprints: Record<string, string>;
  owned_by_specialist: Record<string, number>;
  owned_total: number;
}> {
  const store = String(input.store_number).trim();
  const week = String(input.week_label).trim();
  const range = isoWeekCalendarRange(week);
  const keys = storeNumberQueryValues(store);

  const [workforceRes, shiftsRes, assignments] = await Promise.all([
    supabase
      .from("store_specialists")
      .select("id, name, role, is_active, home_department, assigned_department")
      .in("store_number", keys)
      .eq("is_active", true),
    supabase
      .from("associate_shift_days")
      .select(
        "specialist_id, work_date, start_time, end_time, is_scheduled_today, is_call_out, status"
      )
      .in("store_number", keys)
      .gte("work_date", range.startDate)
      .lte("work_date", range.endDate),
    loadStoreWeekAssignments(supabase, store, week),
  ]);
  if (workforceRes.error) throw new Error(workforceRes.error.message);
  if (shiftsRes.error) throw new Error(shiftsRes.error.message);

  const workforce = (workforceRes.data ?? []).map((row) => ({
    id: String(row.id),
    name: String(row.name ?? ""),
    role: String(row.role ?? "Associate"),
    is_active: row.is_active !== false,
    home_department: row.home_department as string | null | undefined,
    assigned_department: row.assigned_department as string | null | undefined,
  }));
  const shifts = (shiftsRes.data ?? []).map((row) => ({
    specialist_id: String(row.specialist_id),
    work_date: String(row.work_date),
    start_time: row.start_time as string | null,
    end_time: row.end_time as string | null,
    is_scheduled_today: row.is_scheduled_today as boolean | null | undefined,
    is_call_out: row.is_call_out as boolean | null | undefined,
    status: row.status as string | null | undefined,
  }));

  const eligible = new Set<string>();
  for (const department of input.department_codes) {
    const labor = composeWeekLaborAvailability({
      department: String(department).trim().toLowerCase(),
      week_label: week,
      dates: range.dates,
      workforce,
      persisted_shift_days: shifts.map((row) => ({
        ...row,
        is_scheduled_today: row.is_scheduled_today !== false,
        is_call_out: row.is_call_out === true,
      })),
      workforce_evidence_available: true,
      schedule_evidence_available: true,
      as_of: new Date().toISOString(),
    });
    for (const member of labor.members) {
      eligible.add(String(member.specialist_id).trim());
    }
  }

  const live_fingerprints: Record<string, string> = {};
  for (const sid of eligible) {
    live_fingerprints[sid] = buildAssociateWeekScheduleFingerprint(
      shifts.filter((s) => s.specialist_id === sid),
      sid
    );
  }

  const owned_by_specialist: Record<string, number> = {};
  let owned_total = 0;
  for (const row of assignments) {
    const owner = resolveCapacityOwnerId(row);
    if (!owner) continue;
    owned_by_specialist[owner] = (owned_by_specialist[owner] ?? 0) + 1;
    owned_total += 1;
  }

  return {
    eligible_specialist_ids: [...eligible],
    live_fingerprints,
    owned_by_specialist,
    owned_total,
  };
}

/**
 * Materialize standing capacity into weekly approvals when safe.
 * Idempotent. Does not overwrite explicit weekly MasterAdmin approvals.
 * Does not rewrite weeks that already have owned assignments.
 */
export async function materializeStandingCapacityForWeek(
  supabase: SupabaseClient,
  input: {
    store_number: string;
    week_label: string;
    department_codes: readonly string[];
    /** Actor used as approved_by on materialized weekly rows (cron service / system). */
    approved_by_specialist_id: string;
  }
): Promise<{
  ok: boolean;
  skipped?: boolean;
  schema_ready?: boolean;
  code?: string;
  reason?: string;
  written?: number;
  policy_id?: string;
  policy_version?: number;
  error?: string;
}> {
  const store = String(input.store_number ?? "").trim();
  const week = String(input.week_label ?? "").trim();
  const by = String(input.approved_by_specialist_id ?? "").trim();
  if (!store || !week || !by) {
    return {
      ok: false,
      code: "STANDING_CAPACITY_SCOPE",
      error: "store_number, week_label, approved_by required",
    };
  }
  try {
    isoWeekToMondayDate(week);
  } catch (err) {
    return {
      ok: false,
      code: "STANDING_CAPACITY_SCOPE",
      error: err instanceof Error ? err.message : "Invalid week",
    };
  }

  const policyLoad = await loadActiveStandingCapacityPolicy(supabase, store);
  if (!policyLoad.ok) {
    return { ok: false, error: policyLoad.error };
  }
  if (!policyLoad.schema_ready) {
    return {
      ok: true,
      skipped: true,
      schema_ready: false,
      code: "STANDING_CAPACITY_SCHEMA_MISSING",
      reason: "Standing capacity schema not migrated — weekly approvals unchanged",
    };
  }

  const [evidence, approvals, provenanceLoad] = await Promise.all([
    loadEligibleAndFingerprints(supabase, {
      store_number: store,
      week_label: week,
      department_codes: input.department_codes,
    }),
    loadWeekCapacityApprovals(supabase, store, week),
    loadWeekCapacityApprovalProvenance(supabase, store, week),
  ]);
  if (!provenanceLoad.ok) {
    return { ok: false, error: provenanceLoad.error };
  }

  const provenance_by_specialist = new Map(
    provenanceLoad.rows.map((row) => [row.specialist_id, row])
  );

  const plan = planStandingCapacityMaterialization({
    store_number: store,
    week_label: week,
    policy: policyLoad.policy,
    eligible_specialist_ids: evidence.eligible_specialist_ids,
    existing_approvals: approvals,
    provenance_by_specialist,
    live_fingerprints: evidence.live_fingerprints,
    owned_by_specialist: evidence.owned_by_specialist,
    owned_total: evidence.owned_total,
  });

  if (plan.action === "fail") {
    return { ok: false, code: plan.code, error: plan.error, schema_ready: true };
  }
  if (plan.action === "skip") {
    return {
      ok: true,
      skipped: true,
      schema_ready: true,
      code: plan.code,
      reason: plan.reason,
      written: 0,
    };
  }

  const write = await writeWeekCapacityApprovals(supabase, {
    store_number: store,
    week_label: week,
    approved_by_specialist_id: by,
    items: plan.items,
  });
  if (!write.ok) {
    return {
      ok: false,
      code: write.code ?? "STANDING_CAPACITY_WRITE_FAILED",
      error: write.error,
      schema_ready: true,
    };
  }

  await recordWeekCapacityApprovalProvenance(supabase, {
    store_number: store,
    week_label: week,
    specialist_ids: plan.items.map((item) => item.specialist_id),
    source: STANDING_CAPACITY_SOURCE_STANDING,
    standing_policy_id: plan.policy_id,
  });

  return {
    ok: true,
    schema_ready: true,
    written: write.written,
    policy_id: plan.policy_id,
    policy_version: plan.policy_version,
  };
}
