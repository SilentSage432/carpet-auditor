/**
 * RD-3 Operational Sections — stewardship overlay of physical bays.
 *
 * Presentation + persistence helpers. Does not select rotations, mutate
 * weekly capacity, or invent membership from aisle/department labels.
 */

import { normalizeAisle } from "./aisle";
import { physicalBayKey } from "./physical-bay";
import type { SupabaseClient } from "@supabase/supabase-js";

export type OperationalSectionRow = {
  id: string;
  store_id: string;
  department_id: string;
  name: string;
  description: string | null;
  primary_owner_specialist_id: string | null;
  is_active: boolean;
  retired_at: string | null;
  created_at: string;
  updated_at: string;
};

export type OperationalSectionMemberRow = {
  id: string;
  section_id: string;
  store_id: string;
  department_id: string;
  aisle: string;
  bay: number;
  created_at: string;
};

export type OperationalSectionEventType =
  | "created"
  | "renamed"
  | "owner_changed"
  | "member_added"
  | "member_removed"
  | "retired"
  | "reactivated";

export type OperationalSectionBayRef = {
  department_id: string;
  aisle: string;
  bay: number;
};

export type OperationalSectionView = OperationalSectionRow & {
  member_count: number;
  members?: OperationalSectionMemberRow[];
  primary_owner_name?: string | null;
};

export type BaySectionLookup = {
  section_id: string;
  section_name: string;
  department_id: string;
  primary_owner_specialist_id: string | null;
  primary_owner_name: string | null;
  is_active: boolean;
};

export type SectionMutationResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: string; message: string; details?: unknown };

/**
 * Resolve a section only within the authorized store.
 * Callers must pass store_id from the authenticated actor — never from the client body.
 */
export async function loadOperationalSectionForStore(
  supabase: SupabaseClient,
  input: { section_id: string; store_id: string }
): Promise<SectionMutationResult<OperationalSectionRow>> {
  const sectionId = String(input.section_id ?? "").trim();
  const storeId = String(input.store_id ?? "").trim();
  if (!sectionId || !storeId) {
    return { ok: false, code: "not_found", message: "Section not found" };
  }
  const { data, error } = await supabase
    .from("operational_sections")
    .select("*")
    .eq("id", sectionId)
    .eq("store_id", storeId)
    .maybeSingle();
  if (error || !data) {
    return {
      ok: false,
      code: "not_found",
      message: "Section not found",
      details: error,
    };
  }
  return { ok: true, value: data as OperationalSectionRow };
}

export function normalizeSectionName(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeSectionBayRef(
  ref: OperationalSectionBayRef
): OperationalSectionBayRef {
  return {
    department_id: String(ref.department_id ?? "").trim(),
    aisle: normalizeAisle(ref.aisle),
    bay: Number(ref.bay) || 0,
  };
}

export function sectionBayKey(ref: OperationalSectionBayRef): string {
  const n = normalizeSectionBayRef(ref);
  return physicalBayKey(n);
}

/** Pure: reject empty name / invalid bay refs before persistence. */
export function validateSectionCreateInput(input: {
  name: unknown;
  department_id: unknown;
  description?: unknown;
  members?: OperationalSectionBayRef[];
}): { ok: true } | { ok: false; message: string } {
  const name = normalizeSectionName(input.name);
  if (!name) return { ok: false, message: "Section name is required" };
  if (!String(input.department_id ?? "").trim()) {
    return { ok: false, message: "department_id is required" };
  }
  for (const raw of input.members ?? []) {
    const bay = normalizeSectionBayRef(raw);
    if (!bay.department_id || !bay.aisle || bay.bay < 0) {
      return { ok: false, message: "Invalid member bay" };
    }
    if (bay.department_id !== String(input.department_id).trim()) {
      return {
        ok: false,
        message: "Member bays must match the section department",
      };
    }
  }
  return { ok: true };
}

/**
 * Pure: among candidate memberships, detect physical bays claimed by more
 * than one active section (invariant preview for tests / UI).
 */
export function findActiveBayMembershipConflicts(
  memberships: Array<{
    section_id: string;
    section_is_active: boolean;
    department_id: string;
    aisle: string;
    bay: number;
  }>
): string[] {
  const seen = new Map<string, string>();
  const conflicts: string[] = [];
  for (const row of memberships) {
    if (!row.section_is_active) continue;
    const key = sectionBayKey(row);
    const prior = seen.get(key);
    if (prior && prior !== row.section_id) {
      conflicts.push(key);
    } else {
      seen.set(key, row.section_id);
    }
  }
  return [...new Set(conflicts)];
}

export function indexBaySectionLookups(
  sections: OperationalSectionView[]
): Map<string, BaySectionLookup> {
  const map = new Map<string, BaySectionLookup>();
  for (const section of sections) {
    if (!section.is_active) continue;
    for (const member of section.members ?? []) {
      const key = sectionBayKey(member);
      map.set(key, {
        section_id: section.id,
        section_name: section.name,
        department_id: section.department_id,
        primary_owner_specialist_id: section.primary_owner_specialist_id,
        primary_owner_name: section.primary_owner_name ?? null,
        is_active: true,
      });
    }
  }
  return map;
}

export function formatUnsectionedLabel(): string {
  return "Unsectioned";
}

async function appendSectionEvent(
  supabase: SupabaseClient,
  input: {
    section_id: string;
    store_id: string;
    event_type: OperationalSectionEventType;
    department_id?: string | null;
    aisle?: string | null;
    bay?: number | null;
    previous_owner_specialist_id?: string | null;
    next_owner_specialist_id?: string | null;
    acted_by_specialist_id?: string | null;
    detail?: string | null;
  }
): Promise<void> {
  const { error } = await supabase.from("operational_section_events").insert({
    section_id: input.section_id,
    store_id: input.store_id,
    event_type: input.event_type,
    department_id: input.department_id ?? null,
    aisle: input.aisle ?? null,
    bay: input.bay ?? null,
    previous_owner_specialist_id: input.previous_owner_specialist_id ?? null,
    next_owner_specialist_id: input.next_owner_specialist_id ?? null,
    acted_by_specialist_id: input.acted_by_specialist_id ?? null,
    detail: input.detail ?? null,
  });
  if (error) {
    console.error("[operational-sections] event append failed", error);
  }
}

function isMissingRelation(err: { message?: string; code?: string } | null): boolean {
  if (!err) return false;
  const msg = String(err.message ?? "");
  return (
    err.code === "42P01" ||
    /relation .* does not exist|Could not find the table/i.test(msg)
  );
}

export async function listOperationalSections(
  supabase: SupabaseClient,
  input: {
    store_id: string;
    department_id?: string | null;
    includeRetired?: boolean;
    includeMembers?: boolean;
  }
): Promise<SectionMutationResult<OperationalSectionView[]>> {
  let query = supabase
    .from("operational_sections")
    .select("*")
    .eq("store_id", input.store_id)
    .order("name", { ascending: true });
  if (!input.includeRetired) query = query.eq("is_active", true);
  if (input.department_id) {
    query = query.eq("department_id", input.department_id);
  }
  const { data, error } = await query;
  if (error) {
    if (isMissingRelation(error)) {
      return {
        ok: false,
        code: "missing_relation",
        message:
          "Operational sections tables are not migrated yet on this database.",
        details: error,
      };
    }
    return {
      ok: false,
      code: "list_failed",
      message: error.message,
      details: error,
    };
  }

  const rows = (data ?? []) as OperationalSectionRow[];
  const ownerIds = [
    ...new Set(
      rows
        .map((r) => r.primary_owner_specialist_id)
        .filter((id): id is string => Boolean(id))
    ),
  ];
  const ownerNameById = new Map<string, string>();
  if (ownerIds.length > 0) {
    const { data: owners } = await supabase
      .from("store_specialists")
      .select("id, name")
      .in("id", ownerIds);
    for (const owner of owners ?? []) {
      ownerNameById.set(String(owner.id), String(owner.name));
    }
  }

  const membersBySection = new Map<string, OperationalSectionMemberRow[]>();
  const memberCountBySection = new Map<string, number>();
  if (rows.length > 0) {
    const ids = rows.map((r) => r.id);
    const { data: members, error: memberErr } = await supabase
      .from("operational_section_members")
      .select(input.includeMembers ? "*" : "section_id")
      .in("section_id", ids)
      .order("aisle", { ascending: true })
      .order("bay", { ascending: true });
    if (memberErr) {
      return {
        ok: false,
        code: "list_members_failed",
        message: memberErr.message,
        details: memberErr,
      };
    }
    for (const raw of members ?? []) {
      const sectionId = String(
        (raw as { section_id: string }).section_id
      );
      memberCountBySection.set(
        sectionId,
        (memberCountBySection.get(sectionId) ?? 0) + 1
      );
      if (input.includeMembers) {
        const list = membersBySection.get(sectionId) ?? [];
        list.push(raw as OperationalSectionMemberRow);
        membersBySection.set(sectionId, list);
      }
    }
  }

  const views: OperationalSectionView[] = rows.map((row) => ({
    ...row,
    member_count: memberCountBySection.get(row.id) ?? 0,
    members: input.includeMembers
      ? membersBySection.get(row.id) ?? []
      : undefined,
    primary_owner_name: row.primary_owner_specialist_id
      ? ownerNameById.get(row.primary_owner_specialist_id) ?? null
      : null,
  }));

  return { ok: true, value: views };
}

export async function createOperationalSection(
  supabase: SupabaseClient,
  input: {
    store_id: string;
    department_id: string;
    name: string;
    description?: string | null;
    primary_owner_specialist_id?: string | null;
    members?: OperationalSectionBayRef[];
    acted_by_specialist_id?: string | null;
  }
): Promise<SectionMutationResult<OperationalSectionView>> {
  const validated = validateSectionCreateInput(input);
  if (!validated.ok) {
    return { ok: false, code: "validation_failed", message: validated.message };
  }
  const name = normalizeSectionName(input.name);
  const members = (input.members ?? []).map(normalizeSectionBayRef);

  const { data: section, error } = await supabase
    .from("operational_sections")
    .insert({
      store_id: input.store_id,
      department_id: input.department_id,
      name,
      description: input.description?.trim() || null,
      primary_owner_specialist_id: input.primary_owner_specialist_id || null,
      is_active: true,
      retired_at: null,
    })
    .select("*")
    .single();

  if (error || !section) {
    if (isMissingRelation(error)) {
      return {
        ok: false,
        code: "missing_relation",
        message:
          "Operational sections tables are not migrated yet on this database.",
        details: error,
      };
    }
    if (error?.code === "23505") {
      return {
        ok: false,
        code: "duplicate_name",
        message: "An active section with this name already exists",
        details: error,
      };
    }
    return {
      ok: false,
      code: "create_failed",
      message: error?.message ?? "Create failed",
      details: error,
    };
  }

  const row = section as OperationalSectionRow;
  await appendSectionEvent(supabase, {
    section_id: row.id,
    store_id: input.store_id,
    event_type: "created",
    acted_by_specialist_id: input.acted_by_specialist_id,
    detail: name,
    next_owner_specialist_id: input.primary_owner_specialist_id || null,
  });

  if (members.length > 0) {
    const add = await addOperationalSectionMembers(supabase, {
      section_id: row.id,
      store_id: input.store_id,
      department_id: input.department_id,
      members,
      acted_by_specialist_id: input.acted_by_specialist_id,
    });
    if (!add.ok) {
      await supabase.from("operational_sections").delete().eq("id", row.id);
      return add as SectionMutationResult<OperationalSectionView>;
    }
  }

  const listed = await listOperationalSections(supabase, {
    store_id: input.store_id,
    includeMembers: true,
    includeRetired: true,
  });
  if (!listed.ok) return listed as SectionMutationResult<OperationalSectionView>;
  const view = listed.value.find((s) => s.id === row.id);
  if (!view) {
    return { ok: false, code: "create_failed", message: "Created but not found" };
  }
  return { ok: true, value: view };
}

export async function updateOperationalSection(
  supabase: SupabaseClient,
  input: {
    section_id: string;
    store_id: string;
    name?: string;
    description?: string | null;
    primary_owner_specialist_id?: string | null;
    acted_by_specialist_id?: string | null;
  }
): Promise<SectionMutationResult<OperationalSectionRow>> {
  const loaded = await loadOperationalSectionForStore(supabase, {
    section_id: input.section_id,
    store_id: input.store_id,
  });
  if (!loaded.ok) return loaded;
  const prior = loaded.value;
  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (input.name !== undefined) {
    const name = normalizeSectionName(input.name);
    if (!name) {
      return { ok: false, code: "validation_failed", message: "Name required" };
    }
    patch.name = name;
  }
  if (input.description !== undefined) {
    patch.description = input.description?.trim() || null;
  }
  if (input.primary_owner_specialist_id !== undefined) {
    patch.primary_owner_specialist_id =
      input.primary_owner_specialist_id || null;
  }

  const { data: updated, error } = await supabase
    .from("operational_sections")
    .update(patch)
    .eq("id", input.section_id)
    .eq("store_id", input.store_id)
    .select("*")
    .single();
  if (error || !updated) {
    if (error?.code === "23505") {
      return {
        ok: false,
        code: "duplicate_name",
        message: "An active section with this name already exists",
        details: error,
      };
    }
    return {
      ok: false,
      code: "update_failed",
      message: error?.message ?? "Update failed",
      details: error,
    };
  }

  if (input.name !== undefined && normalizeSectionName(input.name) !== prior.name) {
    await appendSectionEvent(supabase, {
      section_id: input.section_id,
      store_id: input.store_id,
      event_type: "renamed",
      acted_by_specialist_id: input.acted_by_specialist_id,
      detail: `${prior.name} → ${normalizeSectionName(input.name)}`,
    });
  }
  if (
    input.primary_owner_specialist_id !== undefined &&
    (input.primary_owner_specialist_id || null) !==
      (prior.primary_owner_specialist_id || null)
  ) {
    await appendSectionEvent(supabase, {
      section_id: input.section_id,
      store_id: input.store_id,
      event_type: "owner_changed",
      previous_owner_specialist_id: prior.primary_owner_specialist_id,
      next_owner_specialist_id: input.primary_owner_specialist_id || null,
      acted_by_specialist_id: input.acted_by_specialist_id,
    });
  }

  return { ok: true, value: updated as OperationalSectionRow };
}

export async function retireOperationalSection(
  supabase: SupabaseClient,
  input: {
    section_id: string;
    store_id: string;
    acted_by_specialist_id?: string | null;
  }
): Promise<SectionMutationResult<OperationalSectionRow>> {
  const loaded = await loadOperationalSectionForStore(supabase, {
    section_id: input.section_id,
    store_id: input.store_id,
  });
  if (!loaded.ok) return loaded;

  const { data: members } = await supabase
    .from("operational_section_members")
    .select("*")
    .eq("section_id", input.section_id)
    .eq("store_id", input.store_id);

  for (const member of (members ?? []) as OperationalSectionMemberRow[]) {
    await appendSectionEvent(supabase, {
      section_id: input.section_id,
      store_id: input.store_id,
      event_type: "member_removed",
      department_id: member.department_id,
      aisle: member.aisle,
      bay: member.bay,
      acted_by_specialist_id: input.acted_by_specialist_id,
      detail: "section_retired",
    });
  }

  if ((members ?? []).length > 0) {
    const { error: delErr } = await supabase
      .from("operational_section_members")
      .delete()
      .eq("section_id", input.section_id)
      .eq("store_id", input.store_id);
    if (delErr) {
      return {
        ok: false,
        code: "retire_failed",
        message: delErr.message,
        details: delErr,
      };
    }
  }

  const retiredAt = new Date().toISOString();
  const { data: updated, error } = await supabase
    .from("operational_sections")
    .update({
      is_active: false,
      retired_at: retiredAt,
      updated_at: retiredAt,
    })
    .eq("id", input.section_id)
    .eq("store_id", input.store_id)
    .select("*")
    .single();
  if (error || !updated) {
    return {
      ok: false,
      code: "retire_failed",
      message: error?.message ?? "Retire failed",
      details: error,
    };
  }

  await appendSectionEvent(supabase, {
    section_id: input.section_id,
    store_id: input.store_id,
    event_type: "retired",
    acted_by_specialist_id: input.acted_by_specialist_id,
  });

  return { ok: true, value: updated as OperationalSectionRow };
}

export async function reactivateOperationalSection(
  supabase: SupabaseClient,
  input: {
    section_id: string;
    store_id: string;
    acted_by_specialist_id?: string | null;
  }
): Promise<SectionMutationResult<OperationalSectionRow>> {
  const loaded = await loadOperationalSectionForStore(supabase, {
    section_id: input.section_id,
    store_id: input.store_id,
  });
  if (!loaded.ok) return loaded;

  const { data: updated, error } = await supabase
    .from("operational_sections")
    .update({
      is_active: true,
      retired_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.section_id)
    .eq("store_id", input.store_id)
    .select("*")
    .single();
  if (error || !updated) {
    if (error?.code === "23505") {
      return {
        ok: false,
        code: "duplicate_name",
        message:
          "Cannot reactivate — an active section already uses this name",
        details: error,
      };
    }
    return {
      ok: false,
      code: "reactivate_failed",
      message: error?.message ?? "Reactivate failed",
      details: error,
    };
  }
  await appendSectionEvent(supabase, {
    section_id: input.section_id,
    store_id: input.store_id,
    event_type: "reactivated",
    acted_by_specialist_id: input.acted_by_specialist_id,
  });
  return { ok: true, value: updated as OperationalSectionRow };
}

export async function addOperationalSectionMembers(
  supabase: SupabaseClient,
  input: {
    section_id: string;
    store_id: string;
    department_id: string;
    members: OperationalSectionBayRef[];
    acted_by_specialist_id?: string | null;
  }
): Promise<SectionMutationResult<{ added: number }>> {
  const loaded = await loadOperationalSectionForStore(supabase, {
    section_id: input.section_id,
    store_id: input.store_id,
  });
  if (!loaded.ok) return loaded;
  const sec = loaded.value;
  if (!sec.is_active) {
    return {
      ok: false,
      code: "section_retired",
      message: "Reactivate the section before adding bays",
    };
  }
  if (sec.department_id !== input.department_id) {
    return {
      ok: false,
      code: "department_mismatch",
      message: "Members must match the section department",
    };
  }

  const rows = input.members.map((raw) => {
    const bay = normalizeSectionBayRef(raw);
    return {
      section_id: input.section_id,
      store_id: input.store_id,
      department_id: bay.department_id,
      aisle: bay.aisle,
      bay: bay.bay,
    };
  });

  for (const row of rows) {
    if (row.department_id !== sec.department_id) {
      return {
        ok: false,
        code: "department_mismatch",
        message: "Members must match the section department",
      };
    }
  }

  if (rows.length === 0) {
    return { ok: true, value: { added: 0 } };
  }

  const { error } = await supabase
    .from("operational_section_members")
    .upsert(rows, {
      onConflict: "section_id,department_id,aisle,bay",
      ignoreDuplicates: true,
    });

  if (error) {
    if (error.code === "23505") {
      return {
        ok: false,
        code: "bay_conflict",
        message:
          "One or more bays already belong to another active Operational Section",
        details: error,
      };
    }
    return {
      ok: false,
      code: "add_failed",
      message: error.message,
      details: error,
    };
  }

  for (const row of rows) {
    await appendSectionEvent(supabase, {
      section_id: input.section_id,
      store_id: input.store_id,
      event_type: "member_added",
      department_id: row.department_id,
      aisle: row.aisle,
      bay: row.bay,
      acted_by_specialist_id: input.acted_by_specialist_id,
    });
  }

  return { ok: true, value: { added: rows.length } };
}

export async function removeOperationalSectionMembers(
  supabase: SupabaseClient,
  input: {
    section_id: string;
    store_id: string;
    members: OperationalSectionBayRef[];
    acted_by_specialist_id?: string | null;
  }
): Promise<SectionMutationResult<{ removed: number }>> {
  const loaded = await loadOperationalSectionForStore(supabase, {
    section_id: input.section_id,
    store_id: input.store_id,
  });
  if (!loaded.ok) return loaded;

  let removed = 0;
  for (const raw of input.members) {
    const bay = normalizeSectionBayRef(raw);
    const { error, count } = await supabase
      .from("operational_section_members")
      .delete({ count: "exact" })
      .eq("section_id", input.section_id)
      .eq("store_id", input.store_id)
      .eq("department_id", bay.department_id)
      .eq("aisle", bay.aisle)
      .eq("bay", bay.bay);
    if (error) {
      return {
        ok: false,
        code: "remove_failed",
        message: error.message,
        details: error,
      };
    }
    if ((count ?? 0) > 0) {
      removed += count ?? 0;
      await appendSectionEvent(supabase, {
        section_id: input.section_id,
        store_id: input.store_id,
        event_type: "member_removed",
        department_id: bay.department_id,
        aisle: bay.aisle,
        bay: bay.bay,
        acted_by_specialist_id: input.acted_by_specialist_id,
      });
    }
  }
  return { ok: true, value: { removed } };
}
