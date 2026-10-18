/**
 * DEPTSYNC-SECTION-OWNERSHIP-003 — temporary weekly section coverage.
 *
 * Permanent primary_owner_specialist_id is never overwritten here.
 * Effective owner for week W = active coverage(cover) ?? permanent.
 *
 * Capacity remains per-associate: multi-section cover expands the bay pool
 * under one specialist's approved capacity (never multiplies the budget).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { BaySectionLookup } from "./operational-sections";
import { storeNumberQueryValues } from "@/lib/store";

export type SectionWeekCoverageRow = {
  id: string;
  store_id: string;
  section_id: string;
  week_label: string;
  covering_specialist_id: string;
  covering_specialist_name?: string | null;
  established_by_specialist_id: string;
  established_at: string;
  revoked_at: string | null;
  note: string | null;
};

const WEEK_RE = /^[0-9]{4}-W[0-9]{2}$/;

export function isValidCoverageWeekLabel(weekLabel: string): boolean {
  return WEEK_RE.test(String(weekLabel ?? "").trim());
}

/** Pure: overlay week coverage onto permanent bay→section lookups. */
export function applyWeekCoverageToBaySectionLookups(
  baySectionByKey: ReadonlyMap<string, BaySectionLookup>,
  coverageBySectionId: ReadonlyMap<string, string>
): Map<string, BaySectionLookup> {
  if (coverageBySectionId.size === 0) {
    return new Map(baySectionByKey);
  }
  const next = new Map<string, BaySectionLookup>();
  for (const [key, lookup] of baySectionByKey) {
    const cover = coverageBySectionId.get(String(lookup.section_id));
    if (cover) {
      next.set(key, {
        ...lookup,
        primary_owner_specialist_id: cover,
      });
    } else {
      next.set(key, lookup);
    }
  }
  return next;
}

/**
 * Pure: classify whether establishing coverage for a week that already has
 * Sunday Bay Assignments requires an explicit supervisor acknowledgment.
 * Coverage itself never rewrites rows — this only surfaces conflict risk.
 */
export function classifyPublishedWeekCoverageRisk(input: {
  existing_assignments: readonly {
    roster_specialist_id: string | null;
    status: string | null;
    supervisor_locked?: boolean | null;
  }[];
  previous_effective_owner_id: string | null;
  next_covering_specialist_id: string;
}): {
  has_published_assignments: boolean;
  requires_explicit_ack: boolean;
  protected_count: number;
  conflicting_open_count: number;
  note: string;
} {
  const rows = input.existing_assignments ?? [];
  const has_published_assignments = rows.length > 0;
  let protected_count = 0;
  let conflicting_open_count = 0;
  const prev = String(input.previous_effective_owner_id ?? "").trim();
  const next = String(input.next_covering_specialist_id ?? "").trim();

  for (const row of rows) {
    const status = String(row.status ?? "").toLowerCase();
    const roster = String(row.roster_specialist_id ?? "").trim();
    const locked = row.supervisor_locked === true;
    const completed =
      status === "completed" || status === "verified" || status === "done";
    if (locked || completed) {
      protected_count += 1;
      continue;
    }
    if (
      status !== "cleared" &&
      roster &&
      prev &&
      roster === prev &&
      next &&
      roster !== next
    ) {
      conflicting_open_count += 1;
    }
  }

  const requires_explicit_ack =
    has_published_assignments &&
    (protected_count > 0 || conflicting_open_count > 0 || prev !== next);

  return {
    has_published_assignments,
    requires_explicit_ack,
    protected_count,
    conflicting_open_count,
    note: !has_published_assignments
      ? "No published assignments for this week — coverage applies to future planning only."
      : requires_explicit_ack
        ? `Week already has assignments (${protected_count} protected, ${conflicting_open_count} open attribution conflict(s)). Coverage will not rewrite history; acknowledge before saving, then reassign unfinished work explicitly if needed.`
        : "Week has assignments; coverage does not rewrite existing rows.",
  };
}

/**
 * Pure capacity preview for UI: covering associate keeps one personal budget.
 * Does not invent section targets.
 */
export function previewCoverageCapacityImpact(input: {
  covering_specialist_id: string;
  covering_specialist_name: string;
  approved_capacity: number;
  permanent_section_ids: readonly string[];
  covered_section_ids: readonly string[];
}): {
  specialist_id: string;
  specialist_name: string;
  approved_capacity: number;
  section_pool_count: number;
  note: string;
} {
  const permanent = new Set(
    input.permanent_section_ids.map((id) => String(id).trim()).filter(Boolean)
  );
  const covered = input.covered_section_ids
    .map((id) => String(id).trim())
    .filter(Boolean);
  for (const id of covered) permanent.add(id);
  const cap = Math.max(0, Math.min(3, Math.floor(Number(input.approved_capacity) || 0)));
  return {
    specialist_id: input.covering_specialist_id,
    specialist_name: input.covering_specialist_name,
    approved_capacity: cap,
    section_pool_count: permanent.size,
    note:
      permanent.size <= 1
        ? `Authorized ${cap} bay(s) for this week.`
        : `Authorized ${cap} bay(s) total across ${permanent.size} sections — coverage does not multiply capacity.`,
  };
}

export async function listActiveSectionWeekCoverage(
  supabase: SupabaseClient,
  input: { store_id: string; week_label: string; section_id?: string }
): Promise<SectionWeekCoverageRow[]> {
  const week = String(input.week_label).trim();
  if (!isValidCoverageWeekLabel(week)) return [];

  let query = supabase
    .from("operational_section_week_coverage")
    .select(
      "id, store_id, section_id, week_label, covering_specialist_id, established_by_specialist_id, established_at, revoked_at, note"
    )
    .eq("store_id", input.store_id)
    .eq("week_label", week)
    .is("revoked_at", null);
  if (input.section_id) {
    query = query.eq("section_id", input.section_id);
  }
  const { data, error } = await query;
  if (error) {
    if (/does not exist|schema cache|42P01/i.test(error.message)) {
      return [];
    }
    throw new Error(error.message);
  }

  const rows = (data ?? []) as SectionWeekCoverageRow[];
  const coverIds = [...new Set(rows.map((r) => r.covering_specialist_id))];
  const nameById = new Map<string, string>();
  if (coverIds.length > 0) {
    const { data: people } = await supabase
      .from("store_specialists")
      .select("id, name")
      .in("id", coverIds);
    for (const p of people ?? []) {
      nameById.set(String(p.id), String(p.name ?? ""));
    }
  }
  return rows.map((row) => ({
    ...row,
    covering_specialist_name: nameById.get(row.covering_specialist_id) ?? null,
  }));
}

export async function loadCoverageOwnerBySectionId(
  supabase: SupabaseClient,
  input: { store_id: string; week_label: string }
): Promise<Map<string, string>> {
  const rows = await listActiveSectionWeekCoverage(supabase, input);
  const map = new Map<string, string>();
  for (const row of rows) {
    map.set(String(row.section_id), String(row.covering_specialist_id));
  }
  return map;
}

export async function establishSectionWeekCoverage(
  supabase: SupabaseClient,
  input: {
    store_id: string;
    store_number: string;
    section_id: string;
    week_label: string;
    covering_specialist_id: string;
    established_by_specialist_id: string;
    note?: string | null;
  }
): Promise<SectionWeekCoverageRow> {
  const week = String(input.week_label).trim();
  const sectionId = String(input.section_id).trim();
  const coverId = String(input.covering_specialist_id).trim();
  if (!isValidCoverageWeekLabel(week)) {
    throw Object.assign(new Error("Invalid operational week label"), {
      status: 400,
      code: "invalid_week",
    });
  }

  const { data: section, error: sectionError } = await supabase
    .from("operational_sections")
    .select("id, store_id, is_active, primary_owner_specialist_id")
    .eq("id", sectionId)
    .eq("store_id", input.store_id)
    .maybeSingle();
  if (sectionError) throw new Error(sectionError.message);
  if (!section || section.is_active === false) {
    throw Object.assign(new Error("Operational Section not found or inactive"), {
      status: 404,
      code: "section_missing",
    });
  }

  const keys = storeNumberQueryValues(input.store_number);
  const { data: cover, error: coverError } = await supabase
    .from("store_specialists")
    .select("id, is_active, role, name")
    .eq("id", coverId)
    .in("store_number", keys)
    .maybeSingle();
  if (coverError) throw new Error(coverError.message);
  if (!cover || cover.is_active === false) {
    throw Object.assign(
      new Error("Covering associate must be an active roster member in this store"),
      { status: 400, code: "inactive_cover" }
    );
  }
  if (String(cover.role) === "MasterAdmin") {
    throw Object.assign(
      new Error("MasterAdmin cannot be assigned as temporary section coverage"),
      { status: 400, code: "protected_role" }
    );
  }

  const now = new Date().toISOString();
  // Revoke any active row for this section+week, then insert.
  await supabase
    .from("operational_section_week_coverage")
    .update({ revoked_at: now, updated_at: now })
    .eq("section_id", sectionId)
    .eq("week_label", week)
    .is("revoked_at", null);

  const { data: created, error: insertError } = await supabase
    .from("operational_section_week_coverage")
    .insert({
      store_id: input.store_id,
      section_id: sectionId,
      week_label: week,
      covering_specialist_id: coverId,
      established_by_specialist_id: input.established_by_specialist_id,
      note: input.note?.trim() || null,
      revoked_at: null,
    })
    .select(
      "id, store_id, section_id, week_label, covering_specialist_id, established_by_specialist_id, established_at, revoked_at, note"
    )
    .single();

  if (insertError || !created) {
    throw new Error(insertError?.message || "Could not establish weekly coverage");
  }

  return {
    ...(created as SectionWeekCoverageRow),
    covering_specialist_name: String(cover.name ?? ""),
  };
}

export async function revokeSectionWeekCoverage(
  supabase: SupabaseClient,
  input: {
    store_id: string;
    section_id: string;
    week_label: string;
  }
): Promise<{ revoked: boolean }> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("operational_section_week_coverage")
    .update({ revoked_at: now, updated_at: now })
    .eq("store_id", input.store_id)
    .eq("section_id", input.section_id)
    .eq("week_label", String(input.week_label).trim())
    .is("revoked_at", null)
    .select("id");
  if (error) {
    if (/does not exist|schema cache|42P01/i.test(error.message)) {
      return { revoked: false };
    }
    throw new Error(error.message);
  }
  return { revoked: (data ?? []).length > 0 };
}

/** Future active coverage rows for an associate (roster deactivate impact). */
export async function listFutureCoverageForSpecialist(
  supabase: SupabaseClient,
  input: {
    store_id: string;
    specialist_id: string;
    from_week_label: string;
  }
): Promise<SectionWeekCoverageRow[]> {
  const { data, error } = await supabase
    .from("operational_section_week_coverage")
    .select(
      "id, store_id, section_id, week_label, covering_specialist_id, established_by_specialist_id, established_at, revoked_at, note"
    )
    .eq("store_id", input.store_id)
    .eq("covering_specialist_id", input.specialist_id)
    .is("revoked_at", null)
    .gte("week_label", input.from_week_label);
  if (error) {
    if (/does not exist|schema cache|42P01/i.test(error.message)) {
      return [];
    }
    throw new Error(error.message);
  }
  return (data ?? []) as SectionWeekCoverageRow[];
}
