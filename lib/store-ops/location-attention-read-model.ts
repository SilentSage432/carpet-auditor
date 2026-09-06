/**
 * SI-001A Attention read model — authorized evidence resolution + normalization.
 *
 * Owns: IO, availability truth, hybrid degradation metadata, generated_at stamp.
 * Does NOT own: pressure / confidence / actionability / seasonal strength (SI-001).
 *
 * Constitutional posture: complies with Arts VII–IX, XIII, XVIII, XIX, XX
 * (extends SI-001 with a Supervisor+ read boundary; no amendment).
 *
 * Bounded read skew across batched queries is accepted — one request as_of /
 * operational_date; no multi-table transaction.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { operationalDateFromInstant } from "./fiscal-calendar";
import { isEligibleRotationLocation } from "./location-eligibility";
import {
  LOCATION_ATTENTION_PRESSURE_METHOD,
  LOCATION_ATTENTION_PRESSURE_VERSION,
  attachAttentionGeneratedAt,
  composeLocationAttentionPressure,
  type ActiveDepartmentRelevanceClaim,
  type ActiveLocationRelevanceClaim,
  type AttentionBarrierEvidence,
  type LocationAttentionAssessment,
  type LocationAttentionInput,
  type LocationAttentionSignal,
  type OperationalContextKind,
  type OperationalContextRelevanceLevel,
} from "./location-attention-pressure";
import {
  listOperationalContextsForStore,
  resolveLocationContextRelevanceFromRows,
  resolveOperationalContextsFromRows,
  type OperationalContext,
  type OperationalContextDepartmentRelevance,
  type OperationalContextLocationRelevance,
} from "./operational-context";
import { normalizeStoreTimezone } from "./sunday-schedule";
import { readableError } from "./errors";
import { isoWeekLabel } from "./week";

/** Degradable evidence dimensions (deterministic unavailable list order). */
export const ATTENTION_EVIDENCE_DIMENSIONS = [
  "current_rotation",
  "barriers",
  "seasonal_context",
] as const;

export type AttentionEvidenceDimension =
  (typeof ATTENTION_EVIDENCE_DIMENSIONS)[number];

export type EvidenceStatus = "AVAILABLE" | "UNAVAILABLE";

/**
 * Explicit success vs failure — never coerce failure to empty arrays.
 * available=true means the source was positively resolved for authorized scope.
 */
export type EvidenceResolution<T> =
  | { available: true; value: T }
  | {
      available: false;
      error_kind:
        | "query_failed"
        | "conflict"
        | "missing_relation"
        | "derivation_blocked";
    };

export type AttentionLocationRow = {
  id: string;
  aisle: string;
  bay: number;
  location_type: string | null;
  is_active: boolean;
  last_completed_at: string | null;
  velocity_tier: string | null;
  custom_decay_days: number | null;
  carried_over: boolean;
  status: string | null;
};

export type AttentionRotationRow = {
  location_id: string;
  verification_status: string | null;
};

export type AttentionExceptionRow = {
  bay_id: string;
  reason: string;
  created_at: string;
  assigned_week: string | null;
};

export type AttentionDepartmentMeta = {
  id: string;
  code: string;
  name: string;
};

export type AttentionReadScope = {
  storeId: string;
  storeTimezone: string;
  department: AttentionDepartmentMeta;
  /** Request instant — single clock for as_of / generated_at / week label. */
  asOf: Date;
};

export type AttentionEvidenceBundle = {
  scope: AttentionReadScope;
  operational_date: string;
  assigned_week: string;
  locations: AttentionLocationRow[];
  rotations: EvidenceResolution<AttentionRotationRow[]>;
  /** Raw week exceptions when query succeeds; open set derived later. */
  exceptions: EvidenceResolution<AttentionExceptionRow[]>;
  seasonal: EvidenceResolution<{
    department_claims: ActiveDepartmentRelevanceClaim[];
    location_claims_by_id: Map<string, ActiveLocationRelevanceClaim[]>;
  }>;
};

export type LocationAttentionResponse = {
  operational_date: string;
  generated_at: string;
  department: AttentionDepartmentMeta;
  method: typeof LOCATION_ATTENTION_PRESSURE_METHOD;
  method_version: typeof LOCATION_ATTENTION_PRESSURE_VERSION;
  degraded: boolean;
  unavailable_evidence: AttentionEvidenceDimension[];
  evidence_status: Record<AttentionEvidenceDimension, EvidenceStatus>;
  signals: LocationAttentionSignal[];
};

export type AttentionFoundationalError = {
  kind: "foundational";
  message: string;
};

const LOCATION_SELECT =
  "id, aisle, bay, location_type, is_active, last_completed_at, velocity_tier, custom_decay_days, carried_over, status";

const ROTATION_SELECT =
  "location_id, verification_status, superseded_at";

const EXCEPTION_SELECT =
  "bay_id, reason, created_at, assigned_week";

function compareAisleBay(
  a: Pick<AttentionLocationRow, "aisle" | "bay" | "id">,
  b: Pick<AttentionLocationRow, "aisle" | "bay" | "id">
): number {
  const aisle = String(a.aisle ?? "").localeCompare(String(b.aisle ?? ""), undefined, {
    numeric: true,
  });
  if (aisle !== 0) return aisle;
  const bay = (Number(a.bay) || 0) - (Number(b.bay) || 0);
  if (bay !== 0) return bay;
  return String(a.id).localeCompare(String(b.id));
}

export function sortAttentionLocations<
  T extends Pick<AttentionLocationRow, "aisle" | "bay" | "id">,
>(rows: T[]): T[] {
  return [...rows].sort(compareAisleBay);
}

/** Exclude inactive + non-aisle-eligible (showroom) from API output. */
export function filterAttentionApiLocations(
  rows: AttentionLocationRow[]
): AttentionLocationRow[] {
  return rows.filter((loc) =>
    isEligibleRotationLocation({
      is_active: loc.is_active,
      location_type: loc.location_type,
    })
  );
}

function mapLocationRow(row: Record<string, unknown>): AttentionLocationRow {
  return {
    id: String(row.id),
    aisle: String(row.aisle ?? ""),
    bay: Math.floor(Number(row.bay) || 0),
    location_type:
      row.location_type == null ? null : String(row.location_type),
    is_active: row.is_active !== false,
    last_completed_at:
      row.last_completed_at == null || row.last_completed_at === ""
        ? null
        : String(row.last_completed_at),
    velocity_tier:
      row.velocity_tier == null ? null : String(row.velocity_tier),
    custom_decay_days:
      row.custom_decay_days == null || row.custom_decay_days === ""
        ? null
        : Math.floor(Number(row.custom_decay_days)),
    carried_over: row.carried_over === true,
    status: row.status == null ? null : String(row.status),
  };
}

/**
 * If multiple active rows share a location_id → conflict (do not invent authority).
 */
export function resolveRotationEvidence(
  rows: AttentionRotationRow[]
): EvidenceResolution<Map<string, string | null>> {
  const byLoc = new Map<string, Array<string | null>>();
  for (const row of rows) {
    const id = String(row.location_id);
    const list = byLoc.get(id) ?? [];
    list.push(row.verification_status);
    byLoc.set(id, list);
  }
  const map = new Map<string, string | null>();
  for (const [id, statuses] of byLoc) {
    if (statuses.length > 1) {
      return { available: false, error_kind: "conflict" };
    }
    map.set(id, statuses[0] ?? null);
  }
  return { available: true, value: map };
}

/**
 * Open barriers = week exceptions whose bay_id is not VERIFIED_COMPLETE.
 * bay_id is store_locations.id (schema FK).
 */
export function deriveOpenBarriersByLocation(input: {
  exceptions: AttentionExceptionRow[];
  verificationByLocation: Map<string, string | null>;
}): Map<string, AttentionBarrierEvidence[]> {
  const out = new Map<string, AttentionBarrierEvidence[]>();
  for (const ex of input.exceptions) {
    const locId = String(ex.bay_id);
    const status = String(
      input.verificationByLocation.get(locId) ?? ""
    ).toUpperCase();
    if (status === "VERIFIED_COMPLETE") continue;
    const list = out.get(locId) ?? [];
    list.push({
      reason: String(ex.reason ?? "Other"),
      created_at: String(ex.created_at ?? ""),
    });
    out.set(locId, list);
  }
  return out;
}

/**
 * Barrier READ is independent of rotation.
 * Open/closed CLASSIFICATION depends on rotation only when exception rows exist.
 *
 * SUCCESS + zero rows → available [] (even if rotation unavailable).
 * SUCCESS + rows + rotation unavailable → derivation_blocked.
 */
export function composeBarrierEvidenceResolution(input: {
  exceptions: EvidenceResolution<AttentionExceptionRow[]>;
  rotations: EvidenceResolution<Map<string, string | null>>;
}): EvidenceResolution<Map<string, AttentionBarrierEvidence[]>> {
  if (!input.exceptions.available) {
    return { available: false, error_kind: input.exceptions.error_kind };
  }
  if (input.exceptions.value.length === 0) {
    return { available: true, value: new Map() };
  }
  if (!input.rotations.available) {
    return { available: false, error_kind: "derivation_blocked" };
  }
  return {
    available: true,
    value: deriveOpenBarriersByLocation({
      exceptions: input.exceptions.value,
      verificationByLocation: input.rotations.value,
    }),
  };
}

function toDeptClaims(
  resolved: ReturnType<typeof resolveOperationalContextsFromRows>
): ActiveDepartmentRelevanceClaim[] {
  const claims: ActiveDepartmentRelevanceClaim[] = [];
  for (const ctx of [...resolved.active_seasons, ...resolved.active_events]) {
    if (ctx.department_relevance == null) continue;
    claims.push({
      context_id: ctx.id,
      context_kind: ctx.kind as OperationalContextKind,
      relevance: ctx.department_relevance as OperationalContextRelevanceLevel,
    });
  }
  claims.sort((a, b) => {
    const c = a.context_id.localeCompare(b.context_id);
    if (c !== 0) return c;
    return a.relevance.localeCompare(b.relevance);
  });
  return claims;
}

function toLocClaimsById(
  items: Array<{
    location_id: string;
    context_id: string;
    kind: OperationalContextKind;
    location_relevance: OperationalContextRelevanceLevel;
  }>
): Map<string, ActiveLocationRelevanceClaim[]> {
  const map = new Map<string, ActiveLocationRelevanceClaim[]>();
  for (const item of items) {
    const list = map.get(item.location_id) ?? [];
    list.push({
      context_id: item.context_id,
      context_kind: item.kind,
      relevance: item.location_relevance,
    });
    map.set(item.location_id, list);
  }
  for (const [, list] of map) {
    list.sort((a, b) => {
      const c = a.context_id.localeCompare(b.context_id);
      if (c !== 0) return c;
      return a.relevance.localeCompare(b.relevance);
    });
  }
  return map;
}

export async function fetchAttentionLocations(
  client: SupabaseClient,
  storeId: string,
  departmentId: string
): Promise<AttentionLocationRow[]> {
  const { data, error } = await client
    .from("store_locations")
    .select(LOCATION_SELECT)
    .eq("store_id", storeId)
    .eq("department_id", departmentId)
    .order("aisle", { ascending: true })
    .order("bay", { ascending: true });
  if (error) throw new Error(readableError(error, "Failed to load locations"));
  return (data ?? []).map((row) =>
    mapLocationRow(row as Record<string, unknown>)
  );
}

export async function fetchAttentionRotations(
  client: SupabaseClient,
  storeId: string,
  departmentId: string,
  assignedWeek: string
): Promise<EvidenceResolution<AttentionRotationRow[]>> {
  const { data, error } = await client
    .from("weekly_rotations")
    .select(ROTATION_SELECT)
    .eq("store_id", storeId)
    .eq("department_id", departmentId)
    .eq("assigned_week", assignedWeek)
    .is("superseded_at", null);
  if (error) {
    return { available: false, error_kind: "query_failed" };
  }
  const rows = (data ?? []).map((row) => {
    const r = row as Record<string, unknown>;
    return {
      location_id: String(r.location_id),
      verification_status:
        r.verification_status == null
          ? null
          : String(r.verification_status),
    };
  });
  return { available: true, value: rows };
}

export async function fetchAttentionExceptions(
  client: SupabaseClient,
  departmentId: string,
  assignedWeek: string
): Promise<EvidenceResolution<AttentionExceptionRow[]>> {
  const { data, error } = await client
    .from("rotation_exceptions")
    .select(EXCEPTION_SELECT)
    .eq("department_id", departmentId)
    .eq("assigned_week", assignedWeek);
  if (error) {
    return { available: false, error_kind: "query_failed" };
  }
  const rows = (data ?? []).map((row) => {
    const r = row as Record<string, unknown>;
    return {
      bay_id: String(r.bay_id),
      reason: String(r.reason ?? "Other"),
      created_at: String(r.created_at ?? ""),
      assigned_week:
        r.assigned_week == null ? null : String(r.assigned_week),
    };
  });
  return { available: true, value: rows };
}

export async function resolveSeasonalAttentionEvidence(
  client: SupabaseClient,
  input: {
    storeId: string;
    departmentCode: string;
    operationalDate: string;
    locationIds: string[];
    locations: Array<{ id: string; store_id: string; is_active: boolean }>;
  }
): Promise<
  EvidenceResolution<{
    department_claims: ActiveDepartmentRelevanceClaim[];
    location_claims_by_id: Map<string, ActiveLocationRelevanceClaim[]>;
  }>
> {
  const listed = await listOperationalContextsForStore(client, input.storeId);
  if (!listed.ok) {
    if ("missingRelation" in listed && listed.missingRelation) {
      return { available: false, error_kind: "missing_relation" };
    }
    return { available: false, error_kind: "query_failed" };
  }

  const contexts: OperationalContext[] = listed.contexts;
  const relevance: OperationalContextDepartmentRelevance[] = listed.relevance;
  const location_relevance: OperationalContextLocationRelevance[] =
    listed.location_relevance;

  const resolved = resolveOperationalContextsFromRows({
    operationalDate: input.operationalDate,
    storeId: input.storeId,
    departmentCode: input.departmentCode,
    contexts,
    relevance,
  });
  const department_claims = toDeptClaims(resolved);

  const locResolved = resolveLocationContextRelevanceFromRows({
    operationalDate: input.operationalDate,
    storeId: input.storeId,
    contexts,
    location_relevance,
    locations: input.locations,
    locationIds: input.locationIds,
    includeInactive: false,
  });

  const location_claims_by_id = toLocClaimsById(
    locResolved.items.map((item) => ({
      location_id: item.location_id,
      context_id: item.context_id,
      kind: item.kind,
      location_relevance: item.location_relevance,
    }))
  );

  return {
    available: true,
    value: { department_claims, location_claims_by_id },
  };
}

/**
 * Batch evidence resolution for one authorized department.
 * Foundational location fetch throws; degradable sources return EvidenceResolution.
 */
export async function resolveAttentionEvidence(
  client: SupabaseClient,
  scope: AttentionReadScope
): Promise<AttentionEvidenceBundle> {
  const operational_date = operationalDateFromInstant(
    scope.asOf,
    normalizeStoreTimezone(scope.storeTimezone)
  );
  const assigned_week = isoWeekLabel(scope.asOf);

  const locationsRaw = await fetchAttentionLocations(
    client,
    scope.storeId,
    scope.department.id
  );
  const locations = sortAttentionLocations(
    filterAttentionApiLocations(locationsRaw)
  );

  const [rotationsRaw, exceptions, seasonal] = await Promise.all([
    fetchAttentionRotations(
      client,
      scope.storeId,
      scope.department.id,
      assigned_week
    ),
    fetchAttentionExceptions(client, scope.department.id, assigned_week),
    resolveSeasonalAttentionEvidence(client, {
      storeId: scope.storeId,
      departmentCode: scope.department.code,
      operationalDate: operational_date,
      locationIds: locations.map((l) => l.id),
      locations: locations.map((l) => ({
        id: l.id,
        store_id: scope.storeId,
        is_active: l.is_active,
      })),
    }),
  ]);

  let rotations: EvidenceResolution<AttentionRotationRow[]> = rotationsRaw;
  if (rotationsRaw.available) {
    const mapped = resolveRotationEvidence(rotationsRaw.value);
    if (!mapped.available) {
      rotations = { available: false, error_kind: mapped.error_kind };
    }
  }

  return {
    scope,
    operational_date,
    assigned_week,
    locations,
    rotations,
    exceptions,
    seasonal,
  };
}

/**
 * Pure normalization from a resolved evidence bundle.
 * Does not invent empty resolved evidence from failed resolutions.
 */
export function composeLocationAttentionInputs(
  bundle: AttentionEvidenceBundle
): LocationAttentionInput[] {
  const as_of = bundle.scope.asOf.toISOString();
  const operational_date = bundle.operational_date;

  const rotationsFinal: EvidenceResolution<Map<string, string | null>> =
    !bundle.rotations.available
      ? { available: false, error_kind: bundle.rotations.error_kind }
      : resolveRotationEvidence(bundle.rotations.value);

  const barriers = composeBarrierEvidenceResolution({
    exceptions: bundle.exceptions,
    rotations: rotationsFinal,
  });

  const deptClaims = bundle.seasonal.available
    ? bundle.seasonal.value.department_claims
    : [];
  const locClaimsById = bundle.seasonal.available
    ? bundle.seasonal.value.location_claims_by_id
    : new Map<string, ActiveLocationRelevanceClaim[]>();

  const locations = sortAttentionLocations(bundle.locations);

  return locations.map((loc) => {
    const verification_status =
      rotationsFinal.available
        ? (rotationsFinal.value.get(loc.id) ?? null)
        : null;
    const open_barriers =
      barriers.available ? (barriers.value.get(loc.id) ?? []) : [];

    return {
      location_id: loc.id,
      is_active: loc.is_active,
      location_type: loc.location_type,
      last_completed_at: loc.last_completed_at,
      velocity_tier: loc.velocity_tier,
      custom_decay_days: loc.custom_decay_days,
      carried_over: loc.carried_over,
      location_status: loc.status,
      verification_status,
      open_barriers,
      department_relevance_claims: deptClaims,
      location_relevance_claims: locClaimsById.get(loc.id) ?? [],
      operational_date,
      as_of,
      current_rotation_evidence_available: rotationsFinal.available,
      barrier_evidence_available: barriers.available,
      seasonal_context_evidence_available: bundle.seasonal.available,
    };
  });
}

export function composeEvidenceStatus(
  bundle: AttentionEvidenceBundle
): {
  evidence_status: Record<AttentionEvidenceDimension, EvidenceStatus>;
  unavailable_evidence: AttentionEvidenceDimension[];
  degraded: boolean;
} {
  const rotationsFinal: EvidenceResolution<Map<string, string | null>> =
    !bundle.rotations.available
      ? { available: false, error_kind: bundle.rotations.error_kind }
      : resolveRotationEvidence(bundle.rotations.value);

  const barriers = composeBarrierEvidenceResolution({
    exceptions: bundle.exceptions,
    rotations: rotationsFinal,
  });

  const evidence_status: Record<AttentionEvidenceDimension, EvidenceStatus> = {
    current_rotation: rotationsFinal.available ? "AVAILABLE" : "UNAVAILABLE",
    barriers: barriers.available ? "AVAILABLE" : "UNAVAILABLE",
    seasonal_context: bundle.seasonal.available ? "AVAILABLE" : "UNAVAILABLE",
  };

  const unavailable_evidence = ATTENTION_EVIDENCE_DIMENSIONS.filter(
    (d) => evidence_status[d] === "UNAVAILABLE"
  );

  return {
    evidence_status,
    unavailable_evidence,
    degraded: unavailable_evidence.length > 0,
  };
}

/** Assess + stamp — does not mutate SI semantics. */
export function assessLocationAttentionSignals(
  inputs: LocationAttentionInput[],
  generated_at: string
): LocationAttentionSignal[] {
  return inputs.map((input) => {
    const assessment: LocationAttentionAssessment =
      composeLocationAttentionPressure(input);
    const signal = attachAttentionGeneratedAt(assessment, generated_at);
    // Strip any accidental rank_key if present on future types
    const { ...rest } = signal as LocationAttentionSignal & {
      rank_key?: unknown;
    };
    if ("rank_key" in rest) {
      delete (rest as { rank_key?: unknown }).rank_key;
    }
    return rest;
  });
}

export function buildLocationAttentionResponse(
  bundle: AttentionEvidenceBundle,
  generated_at: string
): LocationAttentionResponse {
  const inputs = composeLocationAttentionInputs(bundle);
  const signals = assessLocationAttentionSignals(inputs, generated_at);
  const meta = composeEvidenceStatus(bundle);

  return {
    operational_date: bundle.operational_date,
    generated_at,
    department: bundle.scope.department,
    method: LOCATION_ATTENTION_PRESSURE_METHOD,
    method_version: LOCATION_ATTENTION_PRESSURE_VERSION,
    degraded: meta.degraded,
    unavailable_evidence: meta.unavailable_evidence,
    evidence_status: meta.evidence_status,
    signals,
  };
}

/**
 * End-to-end composition for route after auth/scope.
 * Throws on foundational location failure.
 */
export async function composeLocationAttentionRead(
  client: SupabaseClient,
  scope: AttentionReadScope
): Promise<LocationAttentionResponse> {
  const bundle = await resolveAttentionEvidence(client, scope);
  const generated_at = scope.asOf.toISOString();
  return buildLocationAttentionResponse(bundle, generated_at);
}
