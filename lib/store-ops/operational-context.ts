/**
 * FS-002 Operational seasons & events foundation.
 * FS-003 Location seasonal relevance (declared only; no rotation/priority mutation).
 * Declared context occurrences + department / location relevance.
 * Does not invent company events. Does not mutate rotations or bay priority.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { readableError } from "./errors";
import {
  compareOperationalDates,
  parseOperationalDate,
  operationalDateFromInstant,
} from "./fiscal-calendar";

export const OPERATIONAL_CONTEXTS_TABLE = "operational_contexts" as const;
export const OPERATIONAL_CONTEXT_RELEVANCE_TABLE =
  "operational_context_department_relevance" as const;
export const OPERATIONAL_CONTEXT_LOCATION_RELEVANCE_TABLE =
  "operational_context_location_relevance" as const;

export type OperationalContextKind = "SEASON" | "EVENT";

export type OperationalContextSourceType =
  | "COMPANY_PUBLISHED"
  | "PUBLIC_CALENDAR"
  | "MASTER_ADMIN_DECLARED";

export type OperationalContextRelevance =
  | "NONE"
  | "LOW"
  | "MEDIUM"
  | "HIGH";

export type OperationalContext = {
  id: string;
  kind: OperationalContextKind;
  store_id: string | null;
  title: string;
  concept_key: string | null;
  start_date: string;
  end_date: string;
  source_type: OperationalContextSourceType;
  source_reference: string | null;
  source_year: number | null;
  declared_by: string | null;
  created_at: string;
  updated_at: string;
};

export type OperationalContextDepartmentRelevance = {
  id: string;
  context_id: string;
  department_code: string;
  relevance: OperationalContextRelevance;
  created_at: string;
  updated_at: string;
};

/** FS-003 declared location relevance. Missing row = UNSET. */
export type OperationalContextLocationRelevance = {
  id: string;
  context_id: string;
  location_id: string;
  relevance: OperationalContextRelevance;
  declared_by: string | null;
  created_at: string;
  updated_at: string;
};

/** Resolved item for a date — relevance null = UNSET (missing row). */
export type ResolvedOperationalContext = {
  id: string;
  kind: OperationalContextKind;
  title: string;
  start_date: string;
  end_date: string;
  source_type: OperationalContextSourceType;
  source_reference: string | null;
  source_year: number | null;
  store_id: string | null;
  concept_key: string | null;
  /** null = UNSET; NONE/LOW/MEDIUM/HIGH = declared. */
  department_relevance: OperationalContextRelevance | null;
};

export type ResolveOperationalContextsResult = {
  operational_date: string;
  store_id: string | null;
  department_code: string | null;
  active_seasons: ResolvedOperationalContext[];
  active_events: ResolvedOperationalContext[];
};

export type OperationalContextValidationIssue = {
  code: string;
  message: string;
};

const CONTEXT_SELECT =
  "id, kind, store_id, title, concept_key, start_date, end_date, source_type, source_reference, source_year, declared_by, created_at, updated_at";
const RELEVANCE_SELECT =
  "id, context_id, department_code, relevance, created_at, updated_at";
const LOCATION_RELEVANCE_SELECT =
  "id, context_id, location_id, relevance, declared_by, created_at, updated_at";

export function isOperationalContextKind(
  raw: unknown
): raw is OperationalContextKind {
  return raw === "SEASON" || raw === "EVENT";
}

export function isOperationalContextSourceType(
  raw: unknown
): raw is OperationalContextSourceType {
  return (
    raw === "COMPANY_PUBLISHED" ||
    raw === "PUBLIC_CALENDAR" ||
    raw === "MASTER_ADMIN_DECLARED"
  );
}

export function isOperationalContextRelevance(
  raw: unknown
): raw is OperationalContextRelevance {
  return (
    raw === "NONE" || raw === "LOW" || raw === "MEDIUM" || raw === "HIGH"
  );
}

export function normalizeDepartmentCode(raw: unknown): string | null {
  const code = String(raw ?? "").trim();
  if (!code) return null;
  if (code.length > 64) return null;
  if (!/^[A-Za-z0-9_./· -]+$/.test(code)) return null;
  return code;
}

function errorCode(error: unknown): string {
  return String((error as { code?: unknown } | null)?.code ?? "");
}

function errorMessageLower(error: unknown): string {
  return readableError(error, "").toLowerCase();
}

function messageNamesContextTable(msg: string): boolean {
  return (
    msg.includes(OPERATIONAL_CONTEXTS_TABLE) ||
    msg.includes(OPERATIONAL_CONTEXT_RELEVANCE_TABLE) ||
    msg.includes(OPERATIONAL_CONTEXT_LOCATION_RELEVANCE_TABLE) ||
    msg.includes(`public.${OPERATIONAL_CONTEXTS_TABLE}`) ||
    msg.includes(`public.${OPERATIONAL_CONTEXT_RELEVANCE_TABLE}`) ||
    msg.includes(`public.${OPERATIONAL_CONTEXT_LOCATION_RELEVANCE_TABLE}`)
  );
}

/** True only when PostgREST/Postgres reports these tables absent. */
export function isOperationalContextUnavailable(error: unknown): boolean {
  const code = errorCode(error);
  const msg = errorMessageLower(error);
  if (code === "42703" || code === "PGRST204") return false;
  if (/\bcolumn\b/.test(msg) && msg.includes("does not exist")) return false;
  const namesTable = messageNamesContextTable(msg);
  if (code === "42P01" || code === "PGRST205") return namesTable;
  if (
    namesTable &&
    (msg.includes("could not find the table") ||
      (msg.includes("schema cache") && msg.includes("could not find")))
  ) {
    return true;
  }
  return false;
}

function mapContextRow(row: Record<string, unknown>): OperationalContext {
  const kind = String(row.kind ?? "");
  const source = String(row.source_type ?? "");
  return {
    id: String(row.id),
    kind: isOperationalContextKind(kind) ? kind : "EVENT",
    store_id: row.store_id == null ? null : String(row.store_id),
    title: String(row.title ?? "").trim(),
    concept_key:
      row.concept_key == null || row.concept_key === ""
        ? null
        : String(row.concept_key),
    start_date: String(row.start_date).slice(0, 10),
    end_date: String(row.end_date).slice(0, 10),
    source_type: isOperationalContextSourceType(source)
      ? source
      : "MASTER_ADMIN_DECLARED",
    source_reference:
      row.source_reference == null ? null : String(row.source_reference),
    source_year:
      row.source_year == null || row.source_year === ""
        ? null
        : Number(row.source_year),
    declared_by: row.declared_by == null ? null : String(row.declared_by),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function mapRelevanceRow(
  row: Record<string, unknown>
): OperationalContextDepartmentRelevance {
  const relevance = String(row.relevance ?? "");
  return {
    id: String(row.id),
    context_id: String(row.context_id),
    department_code: String(row.department_code),
    relevance: isOperationalContextRelevance(relevance) ? relevance : "NONE",
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function mapLocationRelevanceRow(
  row: Record<string, unknown>
): OperationalContextLocationRelevance {
  const relevance = String(row.relevance ?? "");
  return {
    id: String(row.id),
    context_id: String(row.context_id),
    location_id: String(row.location_id),
    relevance: isOperationalContextRelevance(relevance) ? relevance : "NONE",
    declared_by: row.declared_by == null ? null : String(row.declared_by),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export type MasterDeclaredContextInput = {
  kind: OperationalContextKind;
  title: string;
  start_date: string;
  end_date: string;
  concept_key?: string | null;
  source_reference?: string | null;
  source_year?: number | null;
};

export function validateMasterDeclaredContextInput(
  input: MasterDeclaredContextInput
): OperationalContextValidationIssue[] {
  const issues: OperationalContextValidationIssue[] = [];
  if (!isOperationalContextKind(input.kind)) {
    issues.push({ code: "invalid_kind", message: "kind must be SEASON or EVENT" });
  }
  const title = String(input.title ?? "").trim();
  if (!title) {
    issues.push({ code: "title_required", message: "title is required" });
  }
  const start = parseOperationalDate(input.start_date);
  const end = parseOperationalDate(input.end_date);
  if (!start) {
    issues.push({
      code: "invalid_start_date",
      message: `Invalid start_date: ${input.start_date}`,
    });
  }
  if (!end) {
    issues.push({
      code: "invalid_end_date",
      message: `Invalid end_date: ${input.end_date}`,
    });
  }
  if (start && end && compareOperationalDates(start, end) > 0) {
    issues.push({
      code: "date_order",
      message: "start_date must be <= end_date",
    });
  }
  return issues;
}

/**
 * Create a Master-declared store-scoped context.
 * Server assigns source_type, store_id, declared_by — never from client trust.
 */
export async function createMasterDeclaredOperationalContext(
  client: SupabaseClient,
  input: MasterDeclaredContextInput & {
    store_id: string;
    declared_by: string;
  }
): Promise<
  | { ok: true; context: OperationalContext }
  | {
      ok: false;
      code: "validation_failed" | "missing_relation" | "write_failed";
      message: string;
      details?: string[];
    }
> {
  const issues = validateMasterDeclaredContextInput(input);
  if (issues.length > 0) {
    return {
      ok: false,
      code: "validation_failed",
      message: "Operational context validation failed",
      details: issues.map((i) => `${i.code}: ${i.message}`),
    };
  }

  const now = new Date().toISOString();
  const { data, error } = await client
    .from(OPERATIONAL_CONTEXTS_TABLE)
    .insert({
      kind: input.kind,
      store_id: input.store_id,
      title: String(input.title).trim(),
      concept_key: input.concept_key?.trim() || null,
      start_date: parseOperationalDate(input.start_date)!,
      end_date: parseOperationalDate(input.end_date)!,
      source_type: "MASTER_ADMIN_DECLARED",
      source_reference: input.source_reference?.trim() || null,
      source_year: input.source_year ?? null,
      declared_by: input.declared_by,
      created_at: now,
      updated_at: now,
    })
    .select(CONTEXT_SELECT)
    .single();

  if (error || !data) {
    if (isOperationalContextUnavailable(error)) {
      return {
        ok: false,
        code: "missing_relation",
        message: "Operational context tables are not available",
      };
    }
    return {
      ok: false,
      code: "write_failed",
      message: readableError(error, "Failed to create operational context"),
    };
  }

  return { ok: true, context: mapContextRow(data as Record<string, unknown>) };
}

export async function updateMasterDeclaredOperationalContext(
  client: SupabaseClient,
  input: {
    id: string;
    store_id: string;
    kind?: OperationalContextKind;
    title?: string;
    start_date?: string;
    end_date?: string;
    concept_key?: string | null;
    source_reference?: string | null;
  }
): Promise<
  | { ok: true; context: OperationalContext }
  | {
      ok: false;
      code:
        | "validation_failed"
        | "not_found"
        | "forbidden"
        | "missing_relation"
        | "write_failed";
      message: string;
      details?: string[];
    }
> {
  const existing = await fetchOperationalContextById(client, input.id);
  if (!existing.ok) {
    if ("missingRelation" in existing && existing.missingRelation) {
      return {
        ok: false,
        code: "missing_relation",
        message: "Operational context tables are not available",
      };
    }
    return {
      ok: false,
      code: "write_failed",
      message: "error" in existing ? existing.error : "Failed to load context",
    };
  }
  if (!existing.context) {
    return { ok: false, code: "not_found", message: "Context not found" };
  }
  if (existing.context.store_id !== input.store_id) {
    return {
      ok: false,
      code: "forbidden",
      message: "Context is outside actor store scope",
    };
  }
  if (existing.context.source_type !== "MASTER_ADMIN_DECLARED") {
    return {
      ok: false,
      code: "forbidden",
      message: "Only MASTER_ADMIN_DECLARED contexts can be edited via this path",
    };
  }

  const merged: MasterDeclaredContextInput = {
    kind: input.kind ?? existing.context.kind,
    title: input.title ?? existing.context.title,
    start_date: input.start_date ?? existing.context.start_date,
    end_date: input.end_date ?? existing.context.end_date,
    concept_key:
      input.concept_key !== undefined
        ? input.concept_key
        : existing.context.concept_key,
    source_reference:
      input.source_reference !== undefined
        ? input.source_reference
        : existing.context.source_reference,
  };
  const issues = validateMasterDeclaredContextInput(merged);
  if (issues.length > 0) {
    return {
      ok: false,
      code: "validation_failed",
      message: "Operational context validation failed",
      details: issues.map((i) => `${i.code}: ${i.message}`),
    };
  }

  const { data, error } = await client
    .from(OPERATIONAL_CONTEXTS_TABLE)
    .update({
      kind: merged.kind,
      title: String(merged.title).trim(),
      start_date: parseOperationalDate(merged.start_date)!,
      end_date: parseOperationalDate(merged.end_date)!,
      concept_key: merged.concept_key?.trim() || null,
      source_reference: merged.source_reference?.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.id)
    .eq("store_id", input.store_id)
    .select(CONTEXT_SELECT)
    .maybeSingle();

  if (error) {
    if (isOperationalContextUnavailable(error)) {
      return {
        ok: false,
        code: "missing_relation",
        message: "Operational context tables are not available",
      };
    }
    return {
      ok: false,
      code: "write_failed",
      message: readableError(error, "Failed to update operational context"),
    };
  }
  if (!data) {
    return { ok: false, code: "not_found", message: "Context not found" };
  }
  return { ok: true, context: mapContextRow(data as Record<string, unknown>) };
}

export async function deleteMasterDeclaredOperationalContext(
  client: SupabaseClient,
  input: { id: string; store_id: string }
): Promise<
  | { ok: true }
  | {
      ok: false;
      code: "not_found" | "forbidden" | "missing_relation" | "write_failed";
      message: string;
    }
> {
  const existing = await fetchOperationalContextById(client, input.id);
  if (!existing.ok) {
    if ("missingRelation" in existing && existing.missingRelation) {
      return {
        ok: false,
        code: "missing_relation",
        message: "Operational context tables are not available",
      };
    }
    return {
      ok: false,
      code: "write_failed",
      message: "error" in existing ? existing.error : "Failed to load context",
    };
  }
  if (!existing.context) {
    return { ok: false, code: "not_found", message: "Context not found" };
  }
  if (existing.context.store_id !== input.store_id) {
    return {
      ok: false,
      code: "forbidden",
      message: "Context is outside actor store scope",
    };
  }
  if (existing.context.source_type !== "MASTER_ADMIN_DECLARED") {
    return {
      ok: false,
      code: "forbidden",
      message: "Only MASTER_ADMIN_DECLARED contexts can be deleted via this path",
    };
  }

  const { error } = await client
    .from(OPERATIONAL_CONTEXTS_TABLE)
    .delete()
    .eq("id", input.id)
    .eq("store_id", input.store_id);

  if (error) {
    if (isOperationalContextUnavailable(error)) {
      return {
        ok: false,
        code: "missing_relation",
        message: "Operational context tables are not available",
      };
    }
    return {
      ok: false,
      code: "write_failed",
      message: readableError(error, "Failed to delete operational context"),
    };
  }
  return { ok: true };
}

/**
 * Upsert or clear department relevance.
 * Pass relevance null to delete the row (restore UNSET).
 */
export async function setOperationalContextDepartmentRelevance(
  client: SupabaseClient,
  input: {
    context_id: string;
    store_id: string;
    department_code: string;
    relevance: OperationalContextRelevance | null;
  }
): Promise<
  | { ok: true; relevance: OperationalContextDepartmentRelevance | null }
  | {
      ok: false;
      code:
        | "validation_failed"
        | "not_found"
        | "forbidden"
        | "missing_relation"
        | "write_failed";
      message: string;
    }
> {
  const code = normalizeDepartmentCode(input.department_code);
  if (!code) {
    return {
      ok: false,
      code: "validation_failed",
      message: "Invalid department_code",
    };
  }
  if (input.relevance != null && !isOperationalContextRelevance(input.relevance)) {
    return {
      ok: false,
      code: "validation_failed",
      message: "relevance must be NONE, LOW, MEDIUM, or HIGH",
    };
  }

  const existing = await fetchOperationalContextById(client, input.context_id);
  if (!existing.ok) {
    if ("missingRelation" in existing && existing.missingRelation) {
      return {
        ok: false,
        code: "missing_relation",
        message: "Operational context tables are not available",
      };
    }
    return {
      ok: false,
      code: "write_failed",
      message: "error" in existing ? existing.error : "Failed to load context",
    };
  }
  if (!existing.context) {
    return { ok: false, code: "not_found", message: "Context not found" };
  }
  if (existing.context.store_id !== input.store_id) {
    return {
      ok: false,
      code: "forbidden",
      message: "Context is outside actor store scope",
    };
  }
  if (existing.context.source_type !== "MASTER_ADMIN_DECLARED") {
    return {
      ok: false,
      code: "forbidden",
      message: "Only MASTER_ADMIN_DECLARED contexts accept relevance edits here",
    };
  }

  if (input.relevance == null) {
    const { error } = await client
      .from(OPERATIONAL_CONTEXT_RELEVANCE_TABLE)
      .delete()
      .eq("context_id", input.context_id)
      .eq("department_code", code);
    if (error) {
      if (isOperationalContextUnavailable(error)) {
        return {
          ok: false,
          code: "missing_relation",
          message: "Operational context tables are not available",
        };
      }
      return {
        ok: false,
        code: "write_failed",
        message: readableError(error, "Failed to clear relevance"),
      };
    }
    return { ok: true, relevance: null };
  }

  const now = new Date().toISOString();
  const { data, error } = await client
    .from(OPERATIONAL_CONTEXT_RELEVANCE_TABLE)
    .upsert(
      {
        context_id: input.context_id,
        department_code: code,
        relevance: input.relevance,
        updated_at: now,
      },
      { onConflict: "context_id,department_code" }
    )
    .select(RELEVANCE_SELECT)
    .single();

  if (error || !data) {
    if (isOperationalContextUnavailable(error)) {
      return {
        ok: false,
        code: "missing_relation",
        message: "Operational context tables are not available",
      };
    }
    return {
      ok: false,
      code: "write_failed",
      message: readableError(error, "Failed to set relevance"),
    };
  }
  return {
    ok: true,
    relevance: mapRelevanceRow(data as Record<string, unknown>),
  };
}

export async function fetchOperationalContextById(
  client: SupabaseClient,
  id: string
): Promise<
  | { ok: true; context: OperationalContext | null }
  | { ok: false; missingRelation: true }
  | { ok: false; error: string }
> {
  const { data, error } = await client
    .from(OPERATIONAL_CONTEXTS_TABLE)
    .select(CONTEXT_SELECT)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    if (isOperationalContextUnavailable(error)) {
      return { ok: false, missingRelation: true };
    }
    return { ok: false, error: readableError(error) };
  }
  if (!data) return { ok: true, context: null };
  return { ok: true, context: mapContextRow(data as Record<string, unknown>) };
}

export async function listOperationalContextsForStore(
  client: SupabaseClient,
  storeId: string
): Promise<
  | {
      ok: true;
      contexts: OperationalContext[];
      relevance: OperationalContextDepartmentRelevance[];
      location_relevance: OperationalContextLocationRelevance[];
    }
  | { ok: false; missingRelation: true }
  | { ok: false; error: string }
> {
  const { data, error } = await client
    .from(OPERATIONAL_CONTEXTS_TABLE)
    .select(CONTEXT_SELECT)
    .or(`store_id.is.null,store_id.eq.${storeId}`)
    .order("start_date", { ascending: true })
    .order("title", { ascending: true });

  if (error) {
    if (isOperationalContextUnavailable(error)) {
      return { ok: false, missingRelation: true };
    }
    return { ok: false, error: readableError(error) };
  }

  const contexts = (data ?? []).map((row) =>
    mapContextRow(row as Record<string, unknown>)
  );
  const ids = contexts.map((c) => c.id);
  if (ids.length === 0) {
    return { ok: true, contexts: [], relevance: [], location_relevance: [] };
  }

  const { data: relRows, error: relError } = await client
    .from(OPERATIONAL_CONTEXT_RELEVANCE_TABLE)
    .select(RELEVANCE_SELECT)
    .in("context_id", ids);

  if (relError) {
    if (isOperationalContextUnavailable(relError)) {
      return { ok: false, missingRelation: true };
    }
    return { ok: false, error: readableError(relError) };
  }

  const { data: locIds, error: locIdsError } = await client
    .from("store_locations")
    .select("id")
    .eq("store_id", storeId);

  if (locIdsError) {
    return { ok: false, error: readableError(locIdsError) };
  }

  const locationIds = (locIds ?? []).map((row) => String(row.id));
  let location_relevance: OperationalContextLocationRelevance[] = [];
  if (locationIds.length > 0) {
    const { data: locRelRows, error: locRelError } = await client
      .from(OPERATIONAL_CONTEXT_LOCATION_RELEVANCE_TABLE)
      .select(LOCATION_RELEVANCE_SELECT)
      .in("context_id", ids)
      .in("location_id", locationIds);

    if (locRelError) {
      if (isOperationalContextUnavailable(locRelError)) {
        return { ok: false, missingRelation: true };
      }
      return { ok: false, error: readableError(locRelError) };
    }
    location_relevance = (locRelRows ?? []).map((row) =>
      mapLocationRelevanceRow(row as Record<string, unknown>)
    );
  }

  return {
    ok: true,
    contexts,
    relevance: (relRows ?? []).map((row) =>
      mapRelevanceRow(row as Record<string, unknown>)
    ),
    location_relevance,
  };
}

function sortResolved(
  a: ResolvedOperationalContext,
  b: ResolvedOperationalContext
): number {
  const d = compareOperationalDates(a.start_date, b.start_date);
  if (d !== 0) return d;
  return a.title.localeCompare(b.title);
}

/**
 * Pure resolution over already-loaded rows (test-friendly).
 * Includes global + matching store contexts active on the date.
 */
export function resolveOperationalContextsFromRows(input: {
  operationalDate: string;
  storeId: string | null;
  departmentCode?: string | null;
  contexts: OperationalContext[];
  relevance: OperationalContextDepartmentRelevance[];
}): ResolveOperationalContextsResult {
  const op = parseOperationalDate(input.operationalDate);
  const department_code = input.departmentCode
    ? normalizeDepartmentCode(input.departmentCode)
    : null;

  if (!op) {
    return {
      operational_date: String(input.operationalDate),
      store_id: input.storeId,
      department_code,
      active_seasons: [],
      active_events: [],
    };
  }

  const relByContextDept = new Map<string, OperationalContextRelevance>();
  for (const r of input.relevance) {
    relByContextDept.set(`${r.context_id}::${r.department_code}`, r.relevance);
  }

  const active: ResolvedOperationalContext[] = [];
  for (const c of input.contexts) {
    if (c.store_id != null && c.store_id !== input.storeId) continue;
    if (compareOperationalDates(c.start_date, op) > 0) continue;
    if (compareOperationalDates(op, c.end_date) > 0) continue;

    let department_relevance: OperationalContextRelevance | null = null;
    if (department_code) {
      department_relevance =
        relByContextDept.get(`${c.id}::${department_code}`) ?? null;
    }

    active.push({
      id: c.id,
      kind: c.kind,
      title: c.title,
      start_date: c.start_date,
      end_date: c.end_date,
      source_type: c.source_type,
      source_reference: c.source_reference,
      source_year: c.source_year,
      store_id: c.store_id,
      concept_key: c.concept_key,
      department_relevance,
    });
  }

  active.sort(sortResolved);
  return {
    operational_date: op,
    store_id: input.storeId,
    department_code,
    active_seasons: active.filter((c) => c.kind === "SEASON"),
    active_events: active.filter((c) => c.kind === "EVENT"),
  };
}

export type ResolveOperationalContextsInput = {
  operationalDate?: string;
  instant?: Date | string;
  timeZone?: string;
  storeId: string;
  departmentCode?: string | null;
};

export async function resolveOperationalContextsForDate(
  client: SupabaseClient,
  input: ResolveOperationalContextsInput
): Promise<
  | { ok: true; result: ResolveOperationalContextsResult }
  | { ok: false; missingRelation: true; result: ResolveOperationalContextsResult }
  | { ok: false; error: string }
> {
  let operationalDate: string;
  if (input.operationalDate) {
    const parsed = parseOperationalDate(input.operationalDate);
    if (!parsed) {
      return { ok: false, error: `Invalid operational date: ${input.operationalDate}` };
    }
    operationalDate = parsed;
  } else if (input.instant != null) {
    try {
      operationalDate = operationalDateFromInstant(
        input.instant,
        input.timeZone ?? "America/Denver"
      );
    } catch {
      return { ok: false, error: "Invalid instant for store-local date" };
    }
  } else {
    return { ok: false, error: "operationalDate or instant is required" };
  }

  const listed = await listOperationalContextsForStore(client, input.storeId);
  if (!listed.ok) {
    if ("missingRelation" in listed && listed.missingRelation) {
      return {
        ok: false,
        missingRelation: true,
        result: {
          operational_date: operationalDate,
          store_id: input.storeId,
          department_code: input.departmentCode
            ? normalizeDepartmentCode(input.departmentCode)
            : null,
          active_seasons: [],
          active_events: [],
        },
      };
    }
    return {
      ok: false,
      error: "error" in listed ? listed.error : "Failed to load contexts",
    };
  }

  return {
    ok: true,
    result: resolveOperationalContextsFromRows({
      operationalDate,
      storeId: input.storeId,
      departmentCode: input.departmentCode,
      contexts: listed.contexts,
      relevance: listed.relevance,
    }),
  };
}

/**
 * Upsert or clear location relevance (FS-003).
 * Pass relevance null to delete the row (restore UNSET).
 * Never mutates store_locations priority / velocity fields.
 */
export async function setOperationalContextLocationRelevance(
  client: SupabaseClient,
  input: {
    context_id: string;
    store_id: string;
    location_id: string;
    relevance: OperationalContextRelevance | null;
    declared_by?: string | null;
  }
): Promise<
  | { ok: true; relevance: OperationalContextLocationRelevance | null }
  | {
      ok: false;
      code:
        | "validation_failed"
        | "not_found"
        | "forbidden"
        | "missing_relation"
        | "write_failed";
      message: string;
    }
> {
  const locationId = String(input.location_id ?? "").trim();
  if (!locationId) {
    return {
      ok: false,
      code: "validation_failed",
      message: "location_id is required",
    };
  }
  if (input.relevance != null && !isOperationalContextRelevance(input.relevance)) {
    return {
      ok: false,
      code: "validation_failed",
      message: "relevance must be NONE, LOW, MEDIUM, or HIGH",
    };
  }

  const existing = await fetchOperationalContextById(client, input.context_id);
  if (!existing.ok) {
    if ("missingRelation" in existing && existing.missingRelation) {
      return {
        ok: false,
        code: "missing_relation",
        message: "Operational context tables are not available",
      };
    }
    return {
      ok: false,
      code: "write_failed",
      message: "error" in existing ? existing.error : "Failed to load context",
    };
  }
  if (!existing.context) {
    return { ok: false, code: "not_found", message: "Context not found" };
  }
  if (existing.context.store_id !== input.store_id) {
    return {
      ok: false,
      code: "forbidden",
      message: "Context is outside actor store scope",
    };
  }
  if (existing.context.source_type !== "MASTER_ADMIN_DECLARED") {
    return {
      ok: false,
      code: "forbidden",
      message: "Only MASTER_ADMIN_DECLARED contexts accept location relevance edits",
    };
  }

  const { data: loc, error: locError } = await client
    .from("store_locations")
    .select("id, store_id, is_active")
    .eq("id", locationId)
    .maybeSingle();

  if (locError) {
    return {
      ok: false,
      code: "write_failed",
      message: readableError(locError, "Failed to load location"),
    };
  }
  if (!loc) {
    return { ok: false, code: "not_found", message: "Location not found" };
  }
  if (String(loc.store_id) !== input.store_id) {
    return {
      ok: false,
      code: "forbidden",
      message: "Location is outside actor store scope",
    };
  }

  if (input.relevance == null) {
    const { error } = await client
      .from(OPERATIONAL_CONTEXT_LOCATION_RELEVANCE_TABLE)
      .delete()
      .eq("context_id", input.context_id)
      .eq("location_id", locationId);
    if (error) {
      if (isOperationalContextUnavailable(error)) {
        return {
          ok: false,
          code: "missing_relation",
          message: "Location relevance table is not available",
        };
      }
      return {
        ok: false,
        code: "write_failed",
        message: readableError(error, "Failed to clear location relevance"),
      };
    }
    return { ok: true, relevance: null };
  }

  const now = new Date().toISOString();
  const { data, error } = await client
    .from(OPERATIONAL_CONTEXT_LOCATION_RELEVANCE_TABLE)
    .upsert(
      {
        context_id: input.context_id,
        location_id: locationId,
        relevance: input.relevance,
        declared_by: input.declared_by ?? null,
        updated_at: now,
      },
      { onConflict: "context_id,location_id" }
    )
    .select(LOCATION_RELEVANCE_SELECT)
    .single();

  if (error || !data) {
    if (isOperationalContextUnavailable(error)) {
      return {
        ok: false,
        code: "missing_relation",
        message: "Location relevance table is not available",
      };
    }
    return {
      ok: false,
      code: "write_failed",
      message: readableError(error, "Failed to set location relevance"),
    };
  }
  return {
    ok: true,
    relevance: mapLocationRelevanceRow(data as Record<string, unknown>),
  };
}

export type ResolvedLocationContextRelevance = {
  location_id: string;
  context_id: string;
  kind: OperationalContextKind;
  title: string;
  start_date: string;
  end_date: string;
  source_type: OperationalContextSourceType;
  /** Declared location relevance — never fabricated from department. */
  location_relevance: OperationalContextRelevance;
  location_is_active: boolean;
};

export type ResolveLocationContextRelevanceResult = {
  operational_date: string;
  store_id: string;
  items: ResolvedLocationContextRelevance[];
};

/**
 * Pure resolve: active contexts × explicit location relevance rows.
 * Does not inherit department relevance. Inactive locations stay in history
 * lists when includeInactive=true; default active resolve omits them.
 */
export function resolveLocationContextRelevanceFromRows(input: {
  operationalDate: string;
  storeId: string;
  contexts: OperationalContext[];
  location_relevance: OperationalContextLocationRelevance[];
  locations: Array<{ id: string; store_id: string; is_active: boolean }>;
  locationIds?: string[] | null;
  includeInactive?: boolean;
}): ResolveLocationContextRelevanceResult {
  const op = parseOperationalDate(input.operationalDate);
  const filterIds =
    input.locationIds && input.locationIds.length > 0
      ? new Set(input.locationIds.map(String))
      : null;

  if (!op) {
    return {
      operational_date: String(input.operationalDate),
      store_id: input.storeId,
      items: [],
    };
  }

  const locById = new Map(
    input.locations
      .filter((l) => String(l.store_id) === input.storeId)
      .map((l) => [String(l.id), l] as const)
  );

  const activeContexts = input.contexts.filter((c) => {
    if (c.store_id != null && c.store_id !== input.storeId) return false;
    if (compareOperationalDates(c.start_date, op) > 0) return false;
    if (compareOperationalDates(op, c.end_date) > 0) return false;
    return true;
  });
  const activeById = new Map(activeContexts.map((c) => [c.id, c] as const));

  const items: ResolvedLocationContextRelevance[] = [];
  for (const row of input.location_relevance) {
    const context = activeById.get(row.context_id);
    if (!context) continue;
    if (filterIds && !filterIds.has(row.location_id)) continue;
    const loc = locById.get(row.location_id);
    if (!loc) continue;
    if (!input.includeInactive && loc.is_active === false) continue;
    items.push({
      location_id: row.location_id,
      context_id: context.id,
      kind: context.kind,
      title: context.title,
      start_date: context.start_date,
      end_date: context.end_date,
      source_type: context.source_type,
      location_relevance: row.relevance,
      location_is_active: loc.is_active !== false,
    });
  }

  items.sort((a, b) => {
    const loc = a.location_id.localeCompare(b.location_id);
    if (loc !== 0) return loc;
    const d = compareOperationalDates(a.start_date, b.start_date);
    if (d !== 0) return d;
    return a.title.localeCompare(b.title);
  });

  return {
    operational_date: op,
    store_id: input.storeId,
    items,
  };
}

export async function resolveLocationContextRelevanceForDate(
  client: SupabaseClient,
  input: {
    storeId: string;
    operationalDate?: string;
    instant?: Date | string;
    timeZone?: string;
    locationIds?: string[] | null;
    includeInactive?: boolean;
  }
): Promise<
  | { ok: true; result: ResolveLocationContextRelevanceResult }
  | {
      ok: false;
      missingRelation: true;
      result: ResolveLocationContextRelevanceResult;
    }
  | { ok: false; error: string }
> {
  let operationalDate: string;
  if (input.operationalDate) {
    const parsed = parseOperationalDate(input.operationalDate);
    if (!parsed) {
      return {
        ok: false,
        error: `Invalid operational date: ${input.operationalDate}`,
      };
    }
    operationalDate = parsed;
  } else if (input.instant != null) {
    try {
      operationalDate = operationalDateFromInstant(
        input.instant,
        input.timeZone ?? "America/Denver"
      );
    } catch {
      return { ok: false, error: "Invalid instant for store-local date" };
    }
  } else {
    return { ok: false, error: "operationalDate or instant is required" };
  }

  const listed = await listOperationalContextsForStore(client, input.storeId);
  if (!listed.ok) {
    if ("missingRelation" in listed && listed.missingRelation) {
      return {
        ok: false,
        missingRelation: true,
        result: {
          operational_date: operationalDate,
          store_id: input.storeId,
          items: [],
        },
      };
    }
    return {
      ok: false,
      error: "error" in listed ? listed.error : "Failed to load contexts",
    };
  }

  let locQuery = client
    .from("store_locations")
    .select("id, store_id, is_active")
    .eq("store_id", input.storeId);
  if (input.locationIds && input.locationIds.length > 0) {
    locQuery = locQuery.in("id", input.locationIds);
  }
  const { data: locs, error: locError } = await locQuery;
  if (locError) {
    return { ok: false, error: readableError(locError) };
  }

  return {
    ok: true,
    result: resolveLocationContextRelevanceFromRows({
      operationalDate,
      storeId: input.storeId,
      contexts: listed.contexts,
      location_relevance: listed.location_relevance,
      locations: (locs ?? []).map((row) => ({
        id: String(row.id),
        store_id: String(row.store_id),
        is_active: row.is_active !== false,
      })),
      locationIds: input.locationIds,
      includeInactive: input.includeInactive,
    }),
  };
}
