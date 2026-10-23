/**
 * RD-5 Collaborative Walkthroughs — observations + optional follow-ups.
 *
 * Own authoritative records. Do not mutate weekly rotations, verification,
 * section ownership, or capacity. Floor Pad (`manager_notes`) remains freeform
 * capture; this domain owns walkthrough inbox truth.
 */

import { normalizeAisle } from "./aisle";
import { storeNumberQueryValues } from "@/lib/store";
import { loadOperationalSectionForStore } from "./operational-sections";
import type { SupabaseClient } from "@supabase/supabase-js";

export type WalkthroughSessionStatus = "active" | "ended";
export type WalkthroughObservationType =
  | "positive"
  | "opportunity"
  | "general";
export type WalkthroughFollowUpStatus = "open" | "done";

export type WalkthroughSessionRow = {
  id: string;
  store_id: string;
  department_id: string | null;
  companion_specialist_id: string | null;
  focus_section_id: string | null;
  status: WalkthroughSessionStatus;
  notes: string | null;
  started_at: string;
  ended_at: string | null;
  created_by_specialist_id: string | null;
  created_at: string;
  updated_at: string;
};

export type WalkthroughObservationRow = {
  id: string;
  store_id: string;
  session_id: string;
  observation_type: WalkthroughObservationType;
  body: string;
  associate_specialist_id: string | null;
  section_id: string | null;
  department_id: string | null;
  aisle: string | null;
  bay: number | null;
  observed_at: string;
  created_by_specialist_id: string | null;
  created_at: string;
  updated_at: string;
};

export type WalkthroughFollowUpRow = {
  id: string;
  store_id: string;
  observation_id: string;
  session_id: string;
  action_text: string;
  responsible_specialist_id: string | null;
  due_on: string | null;
  status: WalkthroughFollowUpStatus;
  completion_evidence: string | null;
  resolution_notes: string | null;
  completed_at: string | null;
  completed_by_specialist_id: string | null;
  created_by_specialist_id: string | null;
  created_at: string;
  updated_at: string;
};

export type WalkthroughObservationView = WalkthroughObservationRow & {
  associate_name?: string | null;
  section_name?: string | null;
  place_label?: string | null;
  type_label?: string;
  /**
   * Derived from linked follow-up rows. Observations themselves have no
   * open/resolved lifecycle — only follow-ups do.
   */
  open_follow_up_count?: number;
  done_follow_up_count?: number;
  has_open_follow_up?: boolean;
  /**
   * Opportunity with no follow-up rows yet — discoverable for a supervisor
   * decision, not fabricated "unresolved work".
   */
  awaiting_follow_up_decision?: boolean;
};

export type WalkthroughFollowUpView = WalkthroughFollowUpRow & {
  responsible_name?: string | null;
  observation_body?: string | null;
  observation_type?: WalkthroughObservationType | null;
  needs_attention?: boolean;
  place_label?: string | null;
  section_name?: string | null;
  /** Place keys from the linked observation (OPS-OVERVIEW / Map deep-links). */
  section_id?: string | null;
  department_id?: string | null;
  aisle?: string | null;
  bay?: number | null;
};

export type WalkthroughInbox = {
  active_session: WalkthroughSessionRow | null;
  recent_observations: WalkthroughObservationView[];
  /**
   * Opportunities without an open follow-up. Review/decide surface only —
   * not counted as open follow-up work and never includes positives.
   */
  review_observations: WalkthroughObservationView[];
  open_follow_ups: WalkthroughFollowUpView[];
  attention_follow_ups: WalkthroughFollowUpView[];
  completed_follow_ups: WalkthroughFollowUpView[];
  open_count: number;
  attention_count: number;
  review_count: number;
};

/** Trusted place → Operational Section ownership (context only; not assignment). */
export type WalkthroughPlaceOwnershipStatus =
  | "owned"
  | "unsectioned"
  | "ambiguous"
  | "owner_missing";

export type WalkthroughPlaceOwnership = {
  status: WalkthroughPlaceOwnershipStatus;
  section_id: string | null;
  section_name: string | null;
  primary_owner_specialist_id: string | null;
  primary_owner_name: string | null;
  /** Operator-facing line, e.g. "Section owner: Nate". */
  label: string;
};

export type WalkthroughMutationResult<T> =
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

export function normalizeObservationBody(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeFollowUpAction(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

export function observationTypeLabel(
  type: WalkthroughObservationType
): string {
  if (type === "positive") return "Positive";
  if (type === "opportunity") return "Opportunity";
  return "General";
}

export function formatWalkthroughPlaceLabel(input: {
  aisle?: string | null;
  bay?: number | null;
}): string | null {
  const aisle = normalizeAisle(input.aisle ?? "");
  if (!aisle) return null;
  const bay = input.bay;
  if (bay == null || !Number.isFinite(Number(bay))) {
    return `Aisle ${aisle}`;
  }
  return `Aisle ${aisle} · Bay ${Number(bay)}`;
}

/**
 * Pure: compose honest ownership context from active section membership matches.
 * Does not transfer ownership or invent a steward.
 */
export function composeWalkthroughPlaceOwnership(
  matches: ReadonlyArray<{
    section_id: string;
    section_name: string;
    primary_owner_specialist_id: string | null;
    primary_owner_name: string | null;
  }>
): WalkthroughPlaceOwnership {
  const uniqueSections = new Map<string, (typeof matches)[number]>();
  for (const row of matches) {
    const id = String(row.section_id ?? "").trim();
    if (!id) continue;
    if (!uniqueSections.has(id)) uniqueSections.set(id, row);
  }

  if (uniqueSections.size === 0) {
    return {
      status: "unsectioned",
      section_id: null,
      section_name: null,
      primary_owner_specialist_id: null,
      primary_owner_name: null,
      label: "Unsectioned — no section owner",
    };
  }

  if (uniqueSections.size > 1) {
    return {
      status: "ambiguous",
      section_id: null,
      section_name: null,
      primary_owner_specialist_id: null,
      primary_owner_name: null,
      label: "Ownership ambiguous",
    };
  }

  const only = [...uniqueSections.values()][0];
  const ownerId = only.primary_owner_specialist_id
    ? String(only.primary_owner_specialist_id).trim() || null
    : null;
  const ownerName = only.primary_owner_name
    ? String(only.primary_owner_name).trim() || null
    : null;

  if (!ownerId) {
    return {
      status: "owner_missing",
      section_id: only.section_id,
      section_name: only.section_name,
      primary_owner_specialist_id: null,
      primary_owner_name: null,
      label: "Section owner: none assigned",
    };
  }

  return {
    status: "owned",
    section_id: only.section_id,
    section_name: only.section_name,
    primary_owner_specialist_id: ownerId,
    primary_owner_name: ownerName,
    label: `Section owner: ${ownerName || "Assigned"}`,
  };
}

/** Pure: overdue open follow-up needs attention — not a performance grade. */
export function isFollowUpNeedingAttention(
  followUp: { status: string; due_on: string | null },
  todayIsoDate: string
): boolean {
  if (followUp.status !== "open") return false;
  const due = String(followUp.due_on ?? "").trim();
  if (!due) return false;
  return due < todayIsoDate;
}

/**
 * Pure: annotate an observation with linked follow-up counts.
 * Does not invent observation resolution — only summarizes follow-ups.
 */
export function annotateObservationFollowUpState(
  observation: WalkthroughObservationView,
  followUps: ReadonlyArray<{ observation_id: string; status: string }>
): WalkthroughObservationView {
  let openCount = 0;
  let doneCount = 0;
  for (const fu of followUps) {
    if (fu.observation_id !== observation.id) continue;
    if (fu.status === "open") openCount += 1;
    else if (fu.status === "done") doneCount += 1;
  }
  const annotated: WalkthroughObservationView = {
    ...observation,
    type_label:
      observation.type_label ??
      observationTypeLabel(observation.observation_type),
    place_label:
      observation.place_label ??
      formatWalkthroughPlaceLabel({
        aisle: observation.aisle,
        bay: observation.bay,
      }),
    open_follow_up_count: openCount,
    done_follow_up_count: doneCount,
    has_open_follow_up: openCount > 0,
  };
  annotated.awaiting_follow_up_decision =
    isObservationAwaitingFollowUpDecision(annotated);
  return annotated;
}

/**
 * Pure: opportunities with no follow-up rows stay discoverable for a
 * supervisor decision. Positives and generals are never auto-outstanding.
 * Once any follow-up exists (open or done), this leaves the review queue —
 * open work lives on the follow-up inbox; completed work is not reopened.
 * Observations are not tasks — this is not an open/resolved state.
 */
export function isObservationAwaitingFollowUpDecision(observation: {
  observation_type: string;
  has_open_follow_up?: boolean;
  open_follow_up_count?: number;
  done_follow_up_count?: number;
}): boolean {
  if (observation.observation_type !== "opportunity") return false;
  if (observation.has_open_follow_up) return false;
  if ((observation.open_follow_up_count ?? 0) > 0) return false;
  if ((observation.done_follow_up_count ?? 0) > 0) return false;
  return true;
}

export function composeWalkthroughInbox(input: {
  sessions: WalkthroughSessionRow[];
  observations: WalkthroughObservationView[];
  followUps: WalkthroughFollowUpView[];
  todayIsoDate: string;
  recentLimit?: number;
  completedLimit?: number;
  reviewLimit?: number;
}): WalkthroughInbox {
  const recentLimit = input.recentLimit ?? 12;
  const completedLimit = input.completedLimit ?? 8;
  const reviewLimit = input.reviewLimit ?? 12;
  const active =
    input.sessions.find((s) => s.status === "active") ?? null;
  const open = input.followUps
    .filter((f) => f.status === "open")
    .map((f) => ({
      ...f,
      needs_attention: isFollowUpNeedingAttention(f, input.todayIsoDate),
    }))
    .sort((a, b) => {
      if (a.needs_attention !== b.needs_attention) {
        return a.needs_attention ? -1 : 1;
      }
      const ad = a.due_on ?? "9999-99-99";
      const bd = b.due_on ?? "9999-99-99";
      return ad.localeCompare(bd);
    });
  const attention = open.filter((f) => f.needs_attention);
  const completed = input.followUps
    .filter((f) => f.status === "done")
    .sort((a, b) =>
      String(b.completed_at ?? b.updated_at).localeCompare(
        String(a.completed_at ?? a.updated_at)
      )
    )
    .slice(0, completedLimit);
  const annotated = input.observations.map((o) =>
    annotateObservationFollowUpState(o, input.followUps)
  );
  const recent = [...annotated]
    .sort((a, b) => b.observed_at.localeCompare(a.observed_at))
    .slice(0, recentLimit);
  const review = annotated
    .filter((o) => o.awaiting_follow_up_decision)
    .sort((a, b) => b.observed_at.localeCompare(a.observed_at))
    .slice(0, reviewLimit);

  return {
    active_session: active,
    recent_observations: recent,
    review_observations: review,
    open_follow_ups: open,
    attention_follow_ups: attention,
    completed_follow_ups: completed,
    open_count: open.length,
    attention_count: attention.length,
    review_count: review.length,
  };
}

export function validateObservationCreateInput(input: {
  observation_type: unknown;
  body: unknown;
  aisle?: unknown;
  bay?: unknown;
}): { ok: true } | { ok: false; message: string } {
  const type = String(input.observation_type ?? "").trim();
  if (
    type !== "positive" &&
    type !== "opportunity" &&
    type !== "general"
  ) {
    return { ok: false, message: "observation_type is required" };
  }
  if (!normalizeObservationBody(input.body)) {
    return { ok: false, message: "Description is required" };
  }
  const aisleRaw = input.aisle;
  if (aisleRaw != null && String(aisleRaw).trim()) {
    const aisle = normalizeAisle(String(aisleRaw));
    if (!aisle) {
      return { ok: false, message: "Aisle is invalid" };
    }
  }
  if (input.bay != null && String(input.bay) !== "") {
    const bay = Number(input.bay);
    if (!Number.isFinite(bay) || bay < 0) {
      return { ok: false, message: "Bay is invalid" };
    }
  }
  return { ok: true };
}

export function validateFollowUpCreateInput(input: {
  action_text: unknown;
  observation_id: unknown;
}): { ok: true } | { ok: false; message: string } {
  if (!String(input.observation_id ?? "").trim()) {
    return { ok: false, message: "observation_id is required" };
  }
  if (!normalizeFollowUpAction(input.action_text)) {
    return { ok: false, message: "Follow-up action is required" };
  }
  return { ok: true };
}

export function validateFollowUpCompleteInput(input: {
  completion_evidence?: unknown;
  resolution_notes?: unknown;
}): { ok: true } | { ok: false; message: string } {
  const evidence = String(input.completion_evidence ?? "").trim();
  const notes = String(input.resolution_notes ?? "").trim();
  if (!evidence && !notes) {
    return {
      ok: false,
      message: "Add completion evidence or a short resolution note",
    };
  }
  return { ok: true };
}

async function loadSpecialistNames(
  supabase: SupabaseClient,
  ids: string[]
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const map = new Map<string, string>();
  if (unique.length === 0) return map;
  const { data } = await supabase
    .from("store_specialists")
    .select("id, name")
    .in("id", unique);
  for (const row of data ?? []) {
    map.set(String(row.id), String(row.name));
  }
  return map;
}

async function loadSectionNames(
  supabase: SupabaseClient,
  ids: string[]
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const map = new Map<string, string>();
  if (unique.length === 0) return map;
  const { data } = await supabase
    .from("operational_sections")
    .select("id, name")
    .in("id", unique);
  for (const row of data ?? []) {
    map.set(String(row.id), String(row.name));
  }
  return map;
}

/**
 * RD-5-FIX — roster members are scoped by store_specialists.store_number.
 * Foreign / missing IDs return a generic not_found (no cross-store disclosure).
 * Null/empty IDs are optional and succeed.
 */
export async function assertRosterSpecialistForStore(
  supabase: SupabaseClient,
  input: {
    specialist_id: string | null | undefined;
    store_number: string;
  }
): Promise<WalkthroughMutationResult<true>> {
  const specialistId = String(input.specialist_id ?? "").trim();
  if (!specialistId) return { ok: true, value: true };

  const storeValues = storeNumberQueryValues(input.store_number);
  if (storeValues.length === 0) {
    return {
      ok: false,
      code: "invalid",
      message: "Store number is required",
    };
  }

  const { data, error } = await supabase
    .from("store_specialists")
    .select("id")
    .eq("id", specialistId)
    .in("store_number", storeValues)
    .maybeSingle();

  if (error || !data) {
    return {
      ok: false,
      code: "not_found",
      message: "Team member not found",
      details: error,
    };
  }
  return { ok: true, value: true };
}

/**
 * RD-5-FIX — Operational Sections via store-scoped load (same pattern as RD-3).
 * Foreign / missing IDs → generic not_found. Null/empty succeed.
 */
export async function assertOperationalSectionForStore(
  supabase: SupabaseClient,
  input: {
    section_id: string | null | undefined;
    store_id: string;
  }
): Promise<WalkthroughMutationResult<true>> {
  const sectionId = String(input.section_id ?? "").trim();
  if (!sectionId) return { ok: true, value: true };

  const loaded = await loadOperationalSectionForStore(supabase, {
    section_id: sectionId,
    store_id: input.store_id,
  });
  if (!loaded.ok) {
    return {
      ok: false,
      code: "not_found",
      message: "Section not found",
      details: loaded.details,
    };
  }
  return { ok: true, value: true };
}

/**
 * WALK-002 — resolve place ownership from persisted Operational Section memberships.
 * Store-scoped. Never trusts client-provided owner fields.
 */
export async function resolveWalkthroughPlaceOwnership(
  supabase: SupabaseClient,
  input: {
    store_id: string;
    department_id: string;
    aisle: string;
    bay: number;
  }
): Promise<WalkthroughMutationResult<WalkthroughPlaceOwnership>> {
  const storeId = String(input.store_id ?? "").trim();
  const departmentId = String(input.department_id ?? "").trim();
  const aisle = normalizeAisle(input.aisle);
  const bay = Number(input.bay);
  if (!storeId || !departmentId || !aisle || !Number.isFinite(bay) || bay < 0) {
    return { ok: false, code: "invalid", message: "Place is required" };
  }

  const { data: members, error: memberErr } = await supabase
    .from("operational_section_members")
    .select("section_id, department_id, aisle, bay")
    .eq("department_id", departmentId)
    .eq("aisle", aisle)
    .eq("bay", bay);

  if (memberErr) {
    if (isMissingRelation(memberErr)) {
      return {
        ok: false,
        code: "missing_relation",
        message:
          "Operational sections tables are not migrated yet on this database.",
        details: memberErr,
      };
    }
    return {
      ok: false,
      code: "list_failed",
      message: memberErr.message,
      details: memberErr,
    };
  }

  const sectionIds = [
    ...new Set(
      (members ?? [])
        .map((row) => String((row as { section_id: string }).section_id ?? ""))
        .filter(Boolean)
    ),
  ];

  if (sectionIds.length === 0) {
    return { ok: true, value: composeWalkthroughPlaceOwnership([]) };
  }

  const { data: sections, error: sectionErr } = await supabase
    .from("operational_sections")
    .select("id, name, primary_owner_specialist_id, is_active, store_id")
    .eq("store_id", storeId)
    .eq("is_active", true)
    .in("id", sectionIds);

  if (sectionErr) {
    return {
      ok: false,
      code: "list_failed",
      message: sectionErr.message,
      details: sectionErr,
    };
  }

  const activeSections = (sections ?? []) as Array<{
    id: string;
    name: string;
    primary_owner_specialist_id: string | null;
  }>;
  const ownerIds = [
    ...new Set(
      activeSections
        .map((s) => s.primary_owner_specialist_id)
        .filter((id): id is string => Boolean(id))
    ),
  ];
  const names = await loadSpecialistNames(supabase, ownerIds);

  return {
    ok: true,
    value: composeWalkthroughPlaceOwnership(
      activeSections.map((s) => ({
        section_id: s.id,
        section_name: s.name,
        primary_owner_specialist_id: s.primary_owner_specialist_id,
        primary_owner_name: s.primary_owner_specialist_id
          ? names.get(s.primary_owner_specialist_id) ?? null
          : null,
      }))
    ),
  };
}

/**
 * When department + aisle + bay are all present, require a real store_locations row.
 * Prevents inventing places that the Map does not know.
 */
export async function assertCanonicalWalkthroughPlace(
  supabase: SupabaseClient,
  input: {
    department_id: string;
    aisle: string;
    bay: number;
  }
): Promise<WalkthroughMutationResult<true>> {
  const departmentId = String(input.department_id ?? "").trim();
  const aisle = normalizeAisle(input.aisle);
  const bay = Number(input.bay);
  if (!departmentId || !aisle || !Number.isFinite(bay) || bay < 0) {
    return { ok: false, code: "invalid", message: "Place is required" };
  }

  const { data, error } = await supabase
    .from("store_locations")
    .select("id")
    .eq("department_id", departmentId)
    .eq("aisle", aisle)
    .eq("bay", bay)
    .limit(1)
    .maybeSingle();

  if (error) {
    return {
      ok: false,
      code: "list_failed",
      message: error.message,
      details: error,
    };
  }
  if (!data) {
    return {
      ok: false,
      code: "not_found",
      message: "Location not found on the store map",
    };
  }
  return { ok: true, value: true };
}

export async function findActiveWalkthroughSessionForStore(
  supabase: SupabaseClient,
  input: { store_id: string }
): Promise<WalkthroughMutationResult<WalkthroughSessionRow | null>> {
  const storeId = String(input.store_id ?? "").trim();
  if (!storeId) {
    return { ok: false, code: "invalid", message: "store_id is required" };
  }
  const { data, error } = await supabase
    .from("walkthrough_sessions")
    .select("*")
    .eq("store_id", storeId)
    .eq("status", "active")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    if (isMissingRelation(error)) {
      return {
        ok: false,
        code: "missing_relation",
        message:
          "Walkthrough tables are not migrated yet on this database.",
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
  return {
    ok: true,
    value: data ? (data as WalkthroughSessionRow) : null,
  };
}

/**
 * Reuse the newest active session for the store, or start one.
 * Prevents silent duplicate actives from Map / tab capture races.
 */
export async function ensureActiveWalkthroughSession(
  supabase: SupabaseClient,
  input: {
    store_id: string;
    store_number: string;
    department_id?: string | null;
    companion_specialist_id?: string | null;
    focus_section_id?: string | null;
    notes?: string | null;
    created_by_specialist_id?: string | null;
  }
): Promise<
  WalkthroughMutationResult<WalkthroughSessionRow> & {
    created?: boolean;
  }
> {
  const existing = await findActiveWalkthroughSessionForStore(supabase, {
    store_id: input.store_id,
  });
  if (!existing.ok) return existing;
  if (existing.value) {
    return { ok: true, value: existing.value, created: false };
  }
  const started = await startWalkthroughSession(supabase, input);
  if (!started.ok) return started;
  return { ok: true, value: started.value, created: true };
}

export async function loadWalkthroughSessionForStore(
  supabase: SupabaseClient,
  input: { session_id: string; store_id: string }
): Promise<WalkthroughMutationResult<WalkthroughSessionRow>> {
  const sessionId = String(input.session_id ?? "").trim();
  const storeId = String(input.store_id ?? "").trim();
  if (!sessionId || !storeId) {
    return { ok: false, code: "not_found", message: "Session not found" };
  }
  const { data, error } = await supabase
    .from("walkthrough_sessions")
    .select("*")
    .eq("id", sessionId)
    .eq("store_id", storeId)
    .maybeSingle();
  if (error || !data) {
    return {
      ok: false,
      code: "not_found",
      message: "Session not found",
      details: error,
    };
  }
  return { ok: true, value: data as WalkthroughSessionRow };
}

export async function loadWalkthroughObservationForStore(
  supabase: SupabaseClient,
  input: { observation_id: string; store_id: string }
): Promise<WalkthroughMutationResult<WalkthroughObservationRow>> {
  const id = String(input.observation_id ?? "").trim();
  const storeId = String(input.store_id ?? "").trim();
  if (!id || !storeId) {
    return { ok: false, code: "not_found", message: "Observation not found" };
  }
  const { data, error } = await supabase
    .from("walkthrough_observations")
    .select("*")
    .eq("id", id)
    .eq("store_id", storeId)
    .maybeSingle();
  if (error || !data) {
    return {
      ok: false,
      code: "not_found",
      message: "Observation not found",
      details: error,
    };
  }
  return { ok: true, value: data as WalkthroughObservationRow };
}

export async function loadWalkthroughFollowUpForStore(
  supabase: SupabaseClient,
  input: { follow_up_id: string; store_id: string }
): Promise<WalkthroughMutationResult<WalkthroughFollowUpRow>> {
  const id = String(input.follow_up_id ?? "").trim();
  const storeId = String(input.store_id ?? "").trim();
  if (!id || !storeId) {
    return { ok: false, code: "not_found", message: "Follow-up not found" };
  }
  const { data, error } = await supabase
    .from("walkthrough_follow_ups")
    .select("*")
    .eq("id", id)
    .eq("store_id", storeId)
    .maybeSingle();
  if (error || !data) {
    return {
      ok: false,
      code: "not_found",
      message: "Follow-up not found",
      details: error,
    };
  }
  return { ok: true, value: data as WalkthroughFollowUpRow };
}

export async function startWalkthroughSession(
  supabase: SupabaseClient,
  input: {
    store_id: string;
    store_number: string;
    department_id?: string | null;
    companion_specialist_id?: string | null;
    focus_section_id?: string | null;
    notes?: string | null;
    created_by_specialist_id?: string | null;
  }
): Promise<WalkthroughMutationResult<WalkthroughSessionRow>> {
  const companionOk = await assertRosterSpecialistForStore(supabase, {
    specialist_id: input.companion_specialist_id,
    store_number: input.store_number,
  });
  if (!companionOk.ok) return companionOk;

  const sectionOk = await assertOperationalSectionForStore(supabase, {
    section_id: input.focus_section_id,
    store_id: input.store_id,
  });
  if (!sectionOk.ok) return sectionOk;

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("walkthrough_sessions")
    .insert({
      store_id: input.store_id,
      department_id: input.department_id ?? null,
      companion_specialist_id:
        String(input.companion_specialist_id ?? "").trim() || null,
      focus_section_id:
        String(input.focus_section_id ?? "").trim() || null,
      notes: input.notes ? String(input.notes).trim() || null : null,
      status: "active",
      started_at: now,
      ended_at: null,
      created_by_specialist_id: input.created_by_specialist_id ?? null,
      created_at: now,
      updated_at: now,
    })
    .select("*")
    .single();
  if (error || !data) {
    if (isMissingRelation(error)) {
      return {
        ok: false,
        code: "missing_relation",
        message:
          "Walkthrough tables are not migrated yet on this database.",
        details: error,
      };
    }
    return {
      ok: false,
      code: "create_failed",
      message: error?.message ?? "Could not start walkthrough",
      details: error,
    };
  }
  return { ok: true, value: data as WalkthroughSessionRow };
}

export async function endWalkthroughSession(
  supabase: SupabaseClient,
  input: { store_id: string; session_id: string }
): Promise<WalkthroughMutationResult<WalkthroughSessionRow>> {
  const loaded = await loadWalkthroughSessionForStore(supabase, input);
  if (!loaded.ok) return loaded;
  if (loaded.value.status === "ended") {
    return { ok: true, value: loaded.value };
  }
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("walkthrough_sessions")
    .update({ status: "ended", ended_at: now, updated_at: now })
    .eq("id", input.session_id)
    .eq("store_id", input.store_id)
    .select("*")
    .single();
  if (error || !data) {
    return {
      ok: false,
      code: "update_failed",
      message: error?.message ?? "Could not end walkthrough",
      details: error,
    };
  }
  return { ok: true, value: data as WalkthroughSessionRow };
}

export async function createWalkthroughObservation(
  supabase: SupabaseClient,
  input: {
    store_id: string;
    store_number: string;
    session_id: string;
    observation_type: WalkthroughObservationType;
    body: string;
    associate_specialist_id?: string | null;
    section_id?: string | null;
    department_id?: string | null;
    aisle?: string | null;
    bay?: number | null;
    observed_at?: string | null;
    created_by_specialist_id?: string | null;
  }
): Promise<WalkthroughMutationResult<WalkthroughObservationRow>> {
  const valid = validateObservationCreateInput(input);
  if (!valid.ok) {
    return { ok: false, code: "invalid", message: valid.message };
  }
  const session = await loadWalkthroughSessionForStore(supabase, {
    store_id: input.store_id,
    session_id: input.session_id,
  });
  if (!session.ok) return session;

  const associateOk = await assertRosterSpecialistForStore(supabase, {
    specialist_id: input.associate_specialist_id,
    store_number: input.store_number,
  });
  if (!associateOk.ok) return associateOk;

  const aisle = input.aisle ? normalizeAisle(input.aisle) || null : null;
  const bay =
    input.bay == null || String(input.bay) === ""
      ? null
      : Number(input.bay);
  const departmentId = String(input.department_id ?? "").trim() || null;

  /**
   * Full place → trusted section bind from memberships.
   * Client section_id is not authoritative when place is complete.
   * Never auto-sets associate / follow-up from ownership.
   */
  let sectionId = String(input.section_id ?? "").trim() || null;
  if (departmentId && aisle && bay != null && Number.isFinite(bay)) {
    const placeOk = await assertCanonicalWalkthroughPlace(supabase, {
      department_id: departmentId,
      aisle,
      bay,
    });
    if (!placeOk.ok) return placeOk;

    const ownership = await resolveWalkthroughPlaceOwnership(supabase, {
      store_id: input.store_id,
      department_id: departmentId,
      aisle,
      bay,
    });
    if (!ownership.ok) return ownership;

    if (
      ownership.value.status === "owned" ||
      ownership.value.status === "owner_missing"
    ) {
      sectionId = ownership.value.section_id;
    } else {
      // unsectioned / ambiguous — do not guess a section
      sectionId = null;
    }
  } else {
    const sectionOk = await assertOperationalSectionForStore(supabase, {
      section_id: sectionId,
      store_id: input.store_id,
    });
    if (!sectionOk.ok) return sectionOk;
  }

  if (sectionId) {
    const sectionOk = await assertOperationalSectionForStore(supabase, {
      section_id: sectionId,
      store_id: input.store_id,
    });
    if (!sectionOk.ok) return sectionOk;
  }

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("walkthrough_observations")
    .insert({
      store_id: input.store_id,
      session_id: input.session_id,
      observation_type: input.observation_type,
      body: normalizeObservationBody(input.body),
      associate_specialist_id:
        String(input.associate_specialist_id ?? "").trim() || null,
      section_id: sectionId,
      department_id: departmentId,
      aisle,
      bay,
      observed_at: input.observed_at?.trim() || now,
      created_by_specialist_id: input.created_by_specialist_id ?? null,
      created_at: now,
      updated_at: now,
    })
    .select("*")
    .single();
  if (error || !data) {
    if (isMissingRelation(error)) {
      return {
        ok: false,
        code: "missing_relation",
        message:
          "Walkthrough tables are not migrated yet on this database.",
        details: error,
      };
    }
    return {
      ok: false,
      code: "create_failed",
      message: error?.message ?? "Could not save observation",
      details: error,
    };
  }
  return { ok: true, value: data as WalkthroughObservationRow };
}

export async function createWalkthroughFollowUp(
  supabase: SupabaseClient,
  input: {
    store_id: string;
    store_number: string;
    observation_id: string;
    action_text: string;
    responsible_specialist_id?: string | null;
    due_on?: string | null;
    created_by_specialist_id?: string | null;
  }
): Promise<WalkthroughMutationResult<WalkthroughFollowUpRow>> {
  const valid = validateFollowUpCreateInput(input);
  if (!valid.ok) {
    return { ok: false, code: "invalid", message: valid.message };
  }
  const observation = await loadWalkthroughObservationForStore(supabase, {
    store_id: input.store_id,
    observation_id: input.observation_id,
  });
  if (!observation.ok) return observation;

  const responsibleOk = await assertRosterSpecialistForStore(supabase, {
    specialist_id: input.responsible_specialist_id,
    store_number: input.store_number,
  });
  if (!responsibleOk.ok) return responsibleOk;

  const due = String(input.due_on ?? "").trim() || null;
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("walkthrough_follow_ups")
    .insert({
      store_id: input.store_id,
      observation_id: input.observation_id,
      session_id: observation.value.session_id,
      action_text: normalizeFollowUpAction(input.action_text),
      responsible_specialist_id:
        String(input.responsible_specialist_id ?? "").trim() || null,
      due_on: due,
      status: "open",
      completion_evidence: null,
      resolution_notes: null,
      completed_at: null,
      completed_by_specialist_id: null,
      created_by_specialist_id: input.created_by_specialist_id ?? null,
      created_at: now,
      updated_at: now,
    })
    .select("*")
    .single();
  if (error || !data) {
    if (isMissingRelation(error)) {
      return {
        ok: false,
        code: "missing_relation",
        message:
          "Walkthrough tables are not migrated yet on this database.",
        details: error,
      };
    }
    return {
      ok: false,
      code: "create_failed",
      message: error?.message ?? "Could not create follow-up",
      details: error,
    };
  }
  return { ok: true, value: data as WalkthroughFollowUpRow };
}

export async function completeWalkthroughFollowUp(
  supabase: SupabaseClient,
  input: {
    store_id: string;
    follow_up_id: string;
    completion_evidence?: string | null;
    resolution_notes?: string | null;
    completed_by_specialist_id?: string | null;
  }
): Promise<WalkthroughMutationResult<WalkthroughFollowUpRow>> {
  const valid = validateFollowUpCompleteInput(input);
  if (!valid.ok) {
    return { ok: false, code: "invalid", message: valid.message };
  }
  const loaded = await loadWalkthroughFollowUpForStore(supabase, input);
  if (!loaded.ok) return loaded;
  if (loaded.value.status === "done") {
    return { ok: true, value: loaded.value };
  }
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("walkthrough_follow_ups")
    .update({
      status: "done",
      completion_evidence:
        String(input.completion_evidence ?? "").trim() || null,
      resolution_notes:
        String(input.resolution_notes ?? "").trim() || null,
      completed_at: now,
      completed_by_specialist_id: input.completed_by_specialist_id ?? null,
      updated_at: now,
    })
    .eq("id", input.follow_up_id)
    .eq("store_id", input.store_id)
    .select("*")
    .single();
  if (error || !data) {
    return {
      ok: false,
      code: "update_failed",
      message: error?.message ?? "Could not complete follow-up",
      details: error,
    };
  }
  return { ok: true, value: data as WalkthroughFollowUpRow };
}

export type OpenFollowUpPlace = {
  department_id: string;
  aisle: string;
  bay: number;
  open_count: number;
};

/**
 * Open follow-up places for one store.
 * Two queries: open follow-up ids, then place columns on those observations.
 * Does not load observation bodies, sessions, or closed follow-ups.
 */
export async function listOpenFollowUpPlaces(
  supabase: SupabaseClient,
  input: { store_id: string }
): Promise<WalkthroughMutationResult<OpenFollowUpPlace[]>> {
  const storeId = String(input.store_id ?? "").trim();
  if (!storeId) {
    return { ok: false, code: "invalid", message: "store_id is required" };
  }

  const { data: followUps, error: followError } = await supabase
    .from("walkthrough_follow_ups")
    .select("observation_id, status")
    .eq("store_id", storeId)
    .eq("status", "open");

  if (followError) {
    if (isMissingRelation(followError)) {
      return { ok: true, value: [] };
    }
    return {
      ok: false,
      code: "list_failed",
      message: followError.message,
      details: followError,
    };
  }

  const observationIds = [
    ...new Set(
      (followUps ?? [])
        .map((row) => String(row.observation_id ?? "").trim())
        .filter(Boolean)
    ),
  ];
  if (observationIds.length === 0) return { ok: true, value: [] };

  const openCountByObservation = new Map<string, number>();
  for (const follow of followUps ?? []) {
    if (String(follow.status ?? "") !== "open") continue;
    const observationId = String(follow.observation_id ?? "").trim();
    if (!observationId) continue;
    openCountByObservation.set(
      observationId,
      (openCountByObservation.get(observationId) ?? 0) + 1
    );
  }

  const places = new Map<string, OpenFollowUpPlace>();
  const chunkSize = 100;
  for (let offset = 0; offset < observationIds.length; offset += chunkSize) {
    const chunk = observationIds.slice(offset, offset + chunkSize);
    const { data: observations, error: obsError } = await supabase
      .from("walkthrough_observations")
      .select("id, department_id, aisle, bay")
      .eq("store_id", storeId)
      .in("id", chunk);
    if (obsError) {
      if (isMissingRelation(obsError)) return { ok: true, value: [] };
      return {
        ok: false,
        code: "list_failed",
        message: obsError.message,
        details: obsError,
      };
    }
    for (const obs of observations ?? []) {
      const openCount = openCountByObservation.get(String(obs.id)) ?? 0;
      if (openCount < 1) continue;
      const departmentId = String(obs.department_id ?? "").trim();
      const aisle = normalizeAisle(obs.aisle);
      const bay = Number(obs.bay);
      if (!departmentId || !aisle || !Number.isFinite(bay)) continue;
      const key = `${departmentId}|${aisle}|${bay}`;
      const existing = places.get(key);
      if (existing) existing.open_count += openCount;
      else {
        places.set(key, {
          department_id: departmentId,
          aisle,
          bay,
          open_count: openCount,
        });
      }
    }
  }

  return { ok: true, value: [...places.values()] };
}

export async function listWalkthroughInbox(
  supabase: SupabaseClient,
  input: { store_id: string; todayIsoDate: string }
): Promise<WalkthroughMutationResult<WalkthroughInbox>> {
  const storeId = String(input.store_id ?? "").trim();
  if (!storeId) {
    return { ok: false, code: "invalid", message: "store_id is required" };
  }

  const [sessionsRes, obsRes, fuRes] = await Promise.all([
    supabase
      .from("walkthrough_sessions")
      .select("*")
      .eq("store_id", storeId)
      .order("started_at", { ascending: false })
      .limit(20),
    supabase
      .from("walkthrough_observations")
      .select("*")
      .eq("store_id", storeId)
      .order("observed_at", { ascending: false })
      .limit(40),
    supabase
      .from("walkthrough_follow_ups")
      .select("*")
      .eq("store_id", storeId)
      .order("created_at", { ascending: false })
      .limit(60),
  ]);

  if (sessionsRes.error || obsRes.error || fuRes.error) {
    const err = sessionsRes.error || obsRes.error || fuRes.error;
    if (isMissingRelation(err)) {
      return {
        ok: false,
        code: "missing_relation",
        message:
          "Walkthrough tables are not migrated yet on this database.",
        details: err,
      };
    }
    return {
      ok: false,
      code: "list_failed",
      message: err?.message ?? "Could not load walkthroughs",
      details: err,
    };
  }

  const sessions = (sessionsRes.data ?? []) as WalkthroughSessionRow[];
  const observations = (obsRes.data ?? []) as WalkthroughObservationRow[];
  const followUps = (fuRes.data ?? []) as WalkthroughFollowUpRow[];

  const nameIds = [
    ...observations.map((o) => o.associate_specialist_id ?? ""),
    ...followUps.map((f) => f.responsible_specialist_id ?? ""),
    ...sessions.map((s) => s.companion_specialist_id ?? ""),
  ];
  const sectionIds = [
    ...observations.map((o) => o.section_id ?? ""),
    ...sessions.map((s) => s.focus_section_id ?? ""),
  ];
  const [names, sections] = await Promise.all([
    loadSpecialistNames(supabase, nameIds),
    loadSectionNames(supabase, sectionIds),
  ]);

  const obsById = new Map(observations.map((o) => [o.id, o]));
  const observationViews: WalkthroughObservationView[] = observations.map(
    (o) => ({
      ...o,
      associate_name: o.associate_specialist_id
        ? names.get(o.associate_specialist_id) ?? null
        : null,
      section_name: o.section_id ? sections.get(o.section_id) ?? null : null,
      place_label: formatWalkthroughPlaceLabel({
        aisle: o.aisle,
        bay: o.bay,
      }),
      type_label: observationTypeLabel(o.observation_type),
    })
  );
  const followUpViews: WalkthroughFollowUpView[] = followUps.map((f) => {
    const obs = obsById.get(f.observation_id);
    return {
      ...f,
      responsible_name: f.responsible_specialist_id
        ? names.get(f.responsible_specialist_id) ?? null
        : null,
      observation_body: obs?.body ?? null,
      observation_type: obs?.observation_type ?? null,
      place_label: obs
        ? formatWalkthroughPlaceLabel({ aisle: obs.aisle, bay: obs.bay })
        : null,
      section_id: obs?.section_id ?? null,
      section_name: obs?.section_id
        ? sections.get(obs.section_id) ?? null
        : null,
      department_id: obs?.department_id ?? null,
      aisle: obs?.aisle ?? null,
      bay: obs?.bay ?? null,
    };
  });

  return {
    ok: true,
    value: composeWalkthroughInbox({
      sessions,
      observations: observationViews,
      followUps: followUpViews,
      todayIsoDate: input.todayIsoDate,
    }),
  };
}

export async function listWalkthroughPlaceHistory(
  supabase: SupabaseClient,
  input: {
    store_id: string;
    department_id: string;
    aisle: string;
    bay: number;
    limit?: number;
  }
): Promise<WalkthroughMutationResult<WalkthroughObservationView[]>> {
  const storeId = String(input.store_id ?? "").trim();
  const departmentId = String(input.department_id ?? "").trim();
  const aisle = normalizeAisle(input.aisle);
  const bay = Number(input.bay);
  if (!storeId || !departmentId || !aisle || !Number.isFinite(bay)) {
    return { ok: false, code: "invalid", message: "Place is required" };
  }
  const limit = input.limit ?? 8;
  const { data, error } = await supabase
    .from("walkthrough_observations")
    .select("*")
    .eq("store_id", storeId)
    .eq("department_id", departmentId)
    .eq("aisle", aisle)
    .eq("bay", bay)
    .order("observed_at", { ascending: false })
    .limit(limit);
  if (error) {
    if (isMissingRelation(error)) {
      return {
        ok: false,
        code: "missing_relation",
        message:
          "Walkthrough tables are not migrated yet on this database.",
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
  const rows = (data ?? []) as WalkthroughObservationRow[];
  const names = await loadSpecialistNames(
    supabase,
    rows.map((r) => r.associate_specialist_id ?? "")
  );
  const sections = await loadSectionNames(
    supabase,
    rows.map((r) => r.section_id ?? "")
  );
  return {
    ok: true,
    value: rows.map((o) => ({
      ...o,
      associate_name: o.associate_specialist_id
        ? names.get(o.associate_specialist_id) ?? null
        : null,
      section_name: o.section_id ? sections.get(o.section_id) ?? null : null,
      place_label: formatWalkthroughPlaceLabel({
        aisle: o.aisle,
        bay: o.bay,
      }),
      type_label: observationTypeLabel(o.observation_type),
    })),
  };
}

/** ISO date YYYY-MM-DD in a timezone (defaults UTC). */
export function todayIsoDateInTimeZone(
  now: Date = new Date(),
  timeZone = "UTC"
): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
    const y = parts.find((p) => p.type === "year")?.value;
    const m = parts.find((p) => p.type === "month")?.value;
    const d = parts.find((p) => p.type === "day")?.value;
    if (y && m && d) return `${y}-${m}-${d}`;
  } catch {
    /* fall through */
  }
  return now.toISOString().slice(0, 10);
}
