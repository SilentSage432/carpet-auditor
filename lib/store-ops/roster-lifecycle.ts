/**
 * DEPTSYNC-SECTION-OWNERSHIP-002 — Associate roster lifecycle.
 *
 * Soft activate/deactivate with ownership guards and unfinished-work evidence.
 * Does not hard-delete history, reclaim ownership on reactivate, mutate standing
 * capacity, or implement temporary weekly coverage.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { updateOperationalSection } from "./operational-sections";
import { listFutureCoverageForSpecialist } from "./section-week-coverage";
import { isoWeekLabel } from "./week";
import { storeNumberQueryValues } from "@/lib/store";

export type RosterLifecycleMember = {
  id: string;
  name: string;
  role: string;
  is_active: boolean;
  status: string | null;
  home_department: string | null;
  assigned_department: string | null;
  store_number: string;
};

export type OwnedSectionImpact = {
  section_id: string;
  section_name: string;
  department_id: string;
};

export type OpenAssignmentImpact = {
  id: string;
  week_starting: string;
  bay_id: string | null;
  status: string;
};

export type StandingCapacityImpact = {
  policy_id: string;
  policy_version: number;
  approved_capacity: number;
};

export type DeactivateImpact = {
  specialist_id: string;
  specialist_name: string;
  role: string;
  is_active: boolean;
  owned_sections: OwnedSectionImpact[];
  open_assignments: OpenAssignmentImpact[];
  open_assignment_count: number;
  standing_capacity: StandingCapacityImpact | null;
  future_coverage_count: number;
  blocks_deactivation: boolean;
  block_reasons: string[];
  warnings: string[];
  can_deactivate: boolean;
};

export type SectionOwnerTransfer = {
  section_id: string;
  new_owner_specialist_id: string;
};

function isProtectedRole(role: string): boolean {
  return String(role).trim() === "MasterAdmin";
}

function isOpenAssignmentStatus(status: string): boolean {
  const s = String(status ?? "").trim().toLowerCase();
  if (!s) return true;
  if (s === "cleared" || s === "completed" || s === "verified") return false;
  if (s === "verified_complete") return false;
  return true;
}

/** Pure planner — decide whether deactivation is allowed given gathered impact. */
export function planDeactivateDecision(input: {
  role: string;
  owned_sections: readonly OwnedSectionImpact[];
  transfers: readonly SectionOwnerTransfer[];
  open_assignment_count: number;
  standing_capacity: StandingCapacityImpact | null;
  future_coverage_count?: number;
}): {
  blocks_deactivation: boolean;
  block_reasons: string[];
  warnings: string[];
  can_deactivate: boolean;
  missing_section_ids: string[];
} {
  const block_reasons: string[] = [];
  const warnings: string[] = [];

  if (isProtectedRole(input.role)) {
    block_reasons.push("MasterAdmin identity cannot be deactivated via roster lifecycle.");
  }

  const transferBySection = new Map(
    input.transfers.map((t) => [
      String(t.section_id).trim(),
      String(t.new_owner_specialist_id).trim(),
    ])
  );
  const missing_section_ids: string[] = [];
  for (const section of input.owned_sections) {
    const next = transferBySection.get(section.section_id);
    if (!next) {
      missing_section_ids.push(section.section_id);
    }
  }
  if (missing_section_ids.length > 0) {
    block_reasons.push(
      `Transfer permanent ownership for ${missing_section_ids.length} section(s) before deactivation, or automatic Sunday publication will lack a valid owner.`
    );
  }

  if (input.open_assignment_count > 0) {
    warnings.push(
      `${input.open_assignment_count} open assignment(s) remain attributed to this associate. History is preserved; reassign unfinished work separately.`
    );
  }
  if (input.standing_capacity) {
    warnings.push(
      `Standing capacity still lists this associate at ${input.standing_capacity.approved_capacity}. Inactive associates are excluded from materialization; MasterAdmin should update standing policy when ready.`
    );
  }
  const futureCoverage = Number(input.future_coverage_count ?? 0);
  if (futureCoverage > 0) {
    warnings.push(
      `${futureCoverage} future temporary coverage assignment(s) name this associate. Revoke or reassign coverage before Sunday runs that week.`
    );
  }

  const blocks_deactivation = block_reasons.length > 0;
  return {
    blocks_deactivation,
    block_reasons,
    warnings,
    can_deactivate: !blocks_deactivation,
    missing_section_ids,
  };
}

export async function listRosterLifecycleMembers(
  supabase: SupabaseClient,
  storeNumber: string
): Promise<RosterLifecycleMember[]> {
  const keys = storeNumberQueryValues(storeNumber);
  const { data, error } = await supabase
    .from("store_specialists")
    .select(
      "id, name, role, is_active, status, home_department, assigned_department, store_number"
    )
    .in("store_number", keys)
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: String(row.id),
    name: String(row.name ?? ""),
    role: String(row.role ?? "Associate"),
    is_active: row.is_active !== false,
    status: row.status == null ? null : String(row.status),
    home_department:
      row.home_department == null ? null : String(row.home_department),
    assigned_department:
      row.assigned_department == null
        ? null
        : String(row.assigned_department),
    store_number: String(row.store_number ?? storeNumber),
  }));
}

export async function loadDeactivateImpact(
  supabase: SupabaseClient,
  input: {
    store_number: string;
    store_id: string;
    specialist_id: string;
    transfers?: readonly SectionOwnerTransfer[];
  }
): Promise<DeactivateImpact> {
  const sid = String(input.specialist_id).trim();
  const keys = storeNumberQueryValues(input.store_number);

  const { data: member, error: memberError } = await supabase
    .from("store_specialists")
    .select("id, name, role, is_active, store_number")
    .eq("id", sid)
    .in("store_number", keys)
    .maybeSingle();
  if (memberError) throw new Error(memberError.message);
  if (!member) {
    throw new Error("Associate not found in this store");
  }

  const { data: sections, error: sectionError } = await supabase
    .from("operational_sections")
    .select("id, name, department_id, is_active, primary_owner_specialist_id")
    .eq("store_id", input.store_id)
    .eq("is_active", true)
    .eq("primary_owner_specialist_id", sid);
  if (sectionError) throw new Error(sectionError.message);

  const owned_sections: OwnedSectionImpact[] = (sections ?? []).map((row) => ({
    section_id: String(row.id),
    section_name: String(row.name ?? ""),
    department_id: String(row.department_id ?? ""),
  }));

  const { data: assignments, error: assignError } = await supabase
    .from("sunday_bay_assignments")
    .select("id, week_starting, bay_id, status, roster_specialist_id")
    .eq("store_number", input.store_number)
    .eq("roster_specialist_id", sid);
  if (assignError) throw new Error(assignError.message);

  const open_assignments: OpenAssignmentImpact[] = (assignments ?? [])
    .filter((row) => isOpenAssignmentStatus(String(row.status ?? "")))
    .map((row) => ({
      id: String(row.id),
      week_starting: String(row.week_starting ?? ""),
      bay_id: row.bay_id == null ? null : String(row.bay_id),
      status: String(row.status ?? ""),
    }));

  let standing_capacity: StandingCapacityImpact | null = null;
  const { data: policy, error: policyError } = await supabase
    .from("store_standing_capacity_policies")
    .select("id, policy_version")
    .eq("store_number", input.store_number)
    .eq("is_active", true)
    .maybeSingle();
  if (!policyError && policy?.id) {
    const { data: item } = await supabase
      .from("store_standing_capacity_policy_items")
      .select("approved_capacity")
      .eq("policy_id", policy.id)
      .eq("specialist_id", sid)
      .maybeSingle();
    if (item) {
      standing_capacity = {
        policy_id: String(policy.id),
        policy_version: Number(policy.policy_version) || 1,
        approved_capacity: Number(item.approved_capacity) || 0,
      };
    }
  }

  let future_coverage_count = 0;
  try {
    const future = await listFutureCoverageForSpecialist(supabase, {
      store_id: input.store_id,
      specialist_id: sid,
      from_week_label: isoWeekLabel(new Date()),
    });
    future_coverage_count = future.length;
  } catch {
    future_coverage_count = 0;
  }

  const decision = planDeactivateDecision({
    role: String(member.role ?? ""),
    owned_sections,
    transfers: input.transfers ?? [],
    open_assignment_count: open_assignments.length,
    standing_capacity,
    future_coverage_count,
  });

  return {
    specialist_id: sid,
    specialist_name: String(member.name ?? ""),
    role: String(member.role ?? ""),
    is_active: member.is_active !== false,
    owned_sections,
    open_assignments,
    open_assignment_count: open_assignments.length,
    standing_capacity,
    future_coverage_count,
    blocks_deactivation: decision.blocks_deactivation,
    block_reasons: decision.block_reasons,
    warnings: decision.warnings,
    can_deactivate: decision.can_deactivate && member.is_active !== false,
  };
}

export async function deactivateRosterAssociate(
  supabase: SupabaseClient,
  input: {
    store_number: string;
    store_id: string;
    specialist_id: string;
    acted_by_specialist_id: string;
    transfers?: readonly SectionOwnerTransfer[];
  }
): Promise<{
  ok: true;
  impact: DeactivateImpact;
  transferred_section_ids: string[];
}> {
  const impact = await loadDeactivateImpact(supabase, {
    store_number: input.store_number,
    store_id: input.store_id,
    specialist_id: input.specialist_id,
    transfers: input.transfers,
  });

  if (!impact.is_active) {
    throw Object.assign(new Error("Associate is already inactive"), {
      status: 409,
      code: "already_inactive",
      impact,
    });
  }
  if (!impact.can_deactivate) {
    throw Object.assign(
      new Error(impact.block_reasons[0] ?? "Deactivation blocked"),
      { status: 409, code: "deactivate_blocked", impact }
    );
  }

  const transfers = input.transfers ?? [];
  const transferred_section_ids: string[] = [];
  for (const transfer of transfers) {
    const sectionId = String(transfer.section_id).trim();
    const newOwner = String(transfer.new_owner_specialist_id).trim();
    if (!sectionId || !newOwner) continue;
    if (newOwner === input.specialist_id) {
      throw Object.assign(
        new Error("Cannot transfer section ownership to the associate being deactivated"),
        { status: 400, code: "invalid_transfer" }
      );
    }

    const keys = storeNumberQueryValues(input.store_number);
    const { data: ownerRow, error: ownerError } = await supabase
      .from("store_specialists")
      .select("id, is_active, role")
      .eq("id", newOwner)
      .in("store_number", keys)
      .maybeSingle();
    if (ownerError) throw new Error(ownerError.message);
    if (!ownerRow || ownerRow.is_active === false) {
      throw Object.assign(
        new Error("Replacement owner must be an active associate in this store"),
        { status: 400, code: "invalid_transfer_owner" }
      );
    }

    const updated = await updateOperationalSection(supabase, {
      section_id: sectionId,
      store_id: input.store_id,
      primary_owner_specialist_id: newOwner,
      acted_by_specialist_id: input.acted_by_specialist_id,
    });
    if (!updated.ok) {
      throw Object.assign(
        new Error(updated.message || "Could not transfer section ownership"),
        { status: 400, code: updated.code }
      );
    }
    transferred_section_ids.push(sectionId);
  }

  const { error: updateError } = await supabase
    .from("store_specialists")
    .update({ is_active: false, status: "suspended" })
    .eq("id", input.specialist_id)
    .eq("store_number", input.store_number)
    .neq("role", "MasterAdmin");

  if (updateError) {
    throw new Error(updateError.message || "Soft-deactivate failed");
  }

  return { ok: true, impact, transferred_section_ids };
}

export async function reactivateRosterAssociate(
  supabase: SupabaseClient,
  input: {
    store_number: string;
    specialist_id: string;
  }
): Promise<{ ok: true; specialist_id: string }> {
  const keys = storeNumberQueryValues(input.store_number);
  const { data: member, error: memberError } = await supabase
    .from("store_specialists")
    .select("id, role, is_active")
    .eq("id", input.specialist_id)
    .in("store_number", keys)
    .maybeSingle();
  if (memberError) throw new Error(memberError.message);
  if (!member) throw new Error("Associate not found in this store");
  if (isProtectedRole(String(member.role ?? ""))) {
    throw Object.assign(
      new Error("MasterAdmin identity is not managed via roster reactivate"),
      { status: 403, code: "protected_role" }
    );
  }
  if (member.is_active !== false) {
    return { ok: true, specialist_id: String(member.id) };
  }

  const { error: updateError } = await supabase
    .from("store_specialists")
    .update({ is_active: true, status: "active" })
    .eq("id", input.specialist_id)
    .eq("store_number", input.store_number)
    .neq("role", "MasterAdmin");

  if (updateError) {
    throw new Error(updateError.message || "Reactivate failed");
  }

  return { ok: true, specialist_id: String(member.id) };
}
