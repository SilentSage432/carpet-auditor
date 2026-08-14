/**
 * Store Health Scorecard — weekly pace + bottleneck aggregation.
 * Composes weekly_rotations + rotation_exceptions for the current ISO week.
 * Shift velocity telemetry is composed via lib/store-ops/telemetry (does not own chart UI).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  compactBayHealthForPrompt,
  diagnoseBayHealth,
  type BayHealthBriefingContext,
} from "./bay-health";
import { resolveDepartmentIdByCode } from "./rotations";
import {
  buildStoreAuditTelemetry,
  type StoreAuditTelemetry,
  type TelemetryCompletionEvent,
} from "./telemetry";
import type {
  StoreLocation,
  WeeklyRotationWithLocation,
} from "./types";
import { isoWeekLabel } from "./week";

export type DepartmentHealthRow = {
  department_id: string;
  department_name: string;
  department_code: string;
  weekly_bay_target: number;
  assigned: number;
  completed: number;
  open: number;
  exception_count: number;
  completion_pct: number;
};

export type BarrierRow = {
  id: string;
  department_id: string;
  department_name: string;
  reason: string;
  created_at: string;
};

export type BottleneckBucket = {
  label: string;
  count: number;
};

export type StoreHealthSnapshot = {
  assigned_week: string;
  store_id: string;
  scope: "store" | "department";
  department: DepartmentHealthRow | null;
  departments: DepartmentHealthRow[];
  barriers: BarrierRow[];
  bottleneck_summary: BottleneckBucket[];
  totals: {
    assigned: number;
    completed: number;
    open: number;
    exceptions: number;
    completion_pct: number;
  };
  /** Active-shift hourly velocity (06:00–22:00). */
  telemetry: StoreAuditTelemetry | null;
  /** Compact bay-health flags for shift briefing (diagnostics owned by bay-health.ts). */
  bay_health: BayHealthBriefingContext | null;
};

function completionPct(completed: number, assigned: number): number {
  if (assigned <= 0) return 0;
  return Math.round((completed / assigned) * 100);
}

function bucketReason(reason: string): string {
  const r = reason.toLowerCase();
  if (r.includes("freight") || r.includes("pallet")) return "Freight";
  if (r.includes("staff")) return "Staffing";
  if (r.includes("customer") || r.includes("traffic") || r.includes("volume")) {
    return "Traffic";
  }
  return "Other";
}

/**
 * Aggregate this week's rotation pace + unresolved exceptions.
 * Super admin: all departments for the store.
 * Supervisor: own department only.
 */
export async function buildStoreHealthSnapshot(
  supabase: SupabaseClient,
  opts: {
    storeId: string;
    departmentId?: string | null;
    departmentCode?: string | null;
    weekLabel?: string;
  }
): Promise<StoreHealthSnapshot> {
  const week = opts.weekLabel?.trim() || isoWeekLabel();
  let departmentId = opts.departmentId?.trim() || "";

  if (!departmentId && opts.departmentCode) {
    departmentId =
      (await resolveDepartmentIdByCode(
        supabase,
        opts.departmentCode,
        opts.storeId
      )) ?? "";
  }

  const scope: "store" | "department" = departmentId ? "department" : "store";

  let deptQuery = supabase
    .from("departments")
    .select("id, name, code, weekly_bay_target")
    .eq("store_id", opts.storeId)
    .eq("is_active", true)
    .order("name");

  if (departmentId) {
    deptQuery = deptQuery.eq("id", departmentId);
  }

  const { data: departments, error: deptError } = await deptQuery;
  if (deptError) throw new Error(deptError.message);

  const deptList = departments ?? [];
  const deptIds = deptList.map((d) => d.id as string);

  const empty: StoreHealthSnapshot = {
    assigned_week: week,
    store_id: opts.storeId,
    scope,
    department: null,
    departments: [],
    barriers: [],
    bottleneck_summary: [],
    totals: {
      assigned: 0,
      completed: 0,
      open: 0,
      exceptions: 0,
      completion_pct: 0,
    },
    telemetry: null,
    bay_health: compactBayHealthForPrompt(
      diagnoseBayHealth({ rotations: [] })
    ),
  };

  if (deptIds.length === 0) return empty;

  let rotQuery = supabase
    .from("weekly_rotations")
    .select("id, department_id, is_completed, completed_at, assigned_week")
    .eq("store_id", opts.storeId)
    .eq("assigned_week", week)
    .in("department_id", deptIds);

  const { data: rotations, error: rotError } = await rotQuery;
  if (rotError) {
    // Missing store_id column / empty — try without store filter
    const fallback = await supabase
      .from("weekly_rotations")
      .select("id, department_id, is_completed, completed_at, assigned_week")
      .eq("assigned_week", week)
      .in("department_id", deptIds);
    if (fallback.error) throw new Error(fallback.error.message);
    const snapshot = composeSnapshot(
      week,
      opts.storeId,
      scope,
      deptList,
      fallback.data ?? [],
      await loadExceptions(supabase, week, deptIds, deptList)
    );
    return enrichSnapshotBayHealth(supabase, snapshot, deptIds);
  }

  const exceptions = await loadExceptions(supabase, week, deptIds, deptList);
  const snapshot = composeSnapshot(
    week,
    opts.storeId,
    scope,
    deptList,
    rotations ?? [],
    exceptions
  );
  return enrichSnapshotBayHealth(supabase, snapshot, deptIds);
}

const BAY_HEALTH_SELECT =
  "id, department_id, location_id, is_completed, completed_at, assigned_week, store_locations(id, aisle, bay, type, last_completed_at, status, cycle_number)";
const BAY_HEALTH_SELECT_NO_LAST =
  "id, department_id, location_id, is_completed, completed_at, assigned_week, store_locations(id, aisle, bay, type, status, cycle_number)";

/**
 * Attach compact bay-health context when the client snapshot omitted it.
 * Diagnostics stay in bay-health.ts; this only loads weekly rows and composes.
 */
export async function enrichSnapshotBayHealth(
  supabase: SupabaseClient,
  snapshot: StoreHealthSnapshot,
  departmentIds?: string[]
): Promise<StoreHealthSnapshot> {
  if (snapshot.bay_health != null) {
    return snapshot;
  }
  const deptIds =
    departmentIds && departmentIds.length > 0
      ? departmentIds
      : snapshot.departments.map((d) => d.department_id);
  const bay_health = await loadBayHealthBriefingContext(supabase, {
    storeId: snapshot.store_id,
    week: snapshot.assigned_week,
    departmentIds: deptIds,
  });
  return { ...snapshot, bay_health };
}

async function loadBayHealthBriefingContext(
  supabase: SupabaseClient,
  opts: { storeId: string; week: string; departmentIds: string[] }
): Promise<BayHealthBriefingContext | null> {
  if (!opts.week || opts.departmentIds.length === 0) {
    return compactBayHealthForPrompt(diagnoseBayHealth({ rotations: [] }));
  }

  const rows = await loadBayHealthRotations(supabase, opts);
  const rotations: WeeklyRotationWithLocation[] = rows.map((row) => ({
    id: String(row.id ?? ""),
    store_id: opts.storeId,
    department_id: String(row.department_id ?? ""),
    location_id: String(row.location_id ?? ""),
    assigned_week: String(row.assigned_week ?? opts.week),
    is_completed: Boolean(row.is_completed),
    completed_at: row.completed_at ? String(row.completed_at) : null,
    store_locations: nestLocation(row.store_locations, row.department_id, opts.storeId),
  }));

  return compactBayHealthForPrompt(diagnoseBayHealth({ rotations }));
}

async function loadBayHealthRotations(
  supabase: SupabaseClient,
  opts: { storeId: string; week: string; departmentIds: string[] }
): Promise<Array<Record<string, unknown>>> {
  const attempts: Array<{ select: string; withStore: boolean }> = [
    { select: BAY_HEALTH_SELECT, withStore: true },
    { select: BAY_HEALTH_SELECT_NO_LAST, withStore: true },
    { select: BAY_HEALTH_SELECT, withStore: false },
    { select: BAY_HEALTH_SELECT_NO_LAST, withStore: false },
  ];

  for (const attempt of attempts) {
    let query = supabase
      .from("weekly_rotations")
      .select(attempt.select)
      .eq("assigned_week", opts.week)
      .in("department_id", opts.departmentIds);
    if (attempt.withStore && opts.storeId) {
      query = query.eq("store_id", opts.storeId);
    }
    const { data, error } = await query;
    if (!error) return ((data ?? []) as unknown) as Array<Record<string, unknown>>;
  }
  return [];
}

function nestLocation(
  raw: unknown,
  departmentId: unknown,
  storeId: string
): StoreLocation | null {
  const loc = Array.isArray(raw) ? raw[0] : raw;
  if (!loc || typeof loc !== "object") return null;
  const row = loc as Record<string, unknown>;
  return {
    id: String(row.id ?? ""),
    store_id: storeId,
    department_id: String(departmentId ?? ""),
    aisle: String(row.aisle ?? ""),
    bay: Number(row.bay) || 0,
    type: row.type === "TOPSTOCK" ? "TOPSTOCK" : "SELLING",
    status:
      row.status === "ASSIGNED" ||
      row.status === "COMPLETED" ||
      row.status === "CARRIED_OVER"
        ? row.status
        : "PENDING",
    last_completed_at:
      row.last_completed_at == null || row.last_completed_at === ""
        ? null
        : String(row.last_completed_at),
    cycle_number: Number(row.cycle_number) || 1,
    is_active: true,
  };
}

async function loadExceptions(
  supabase: SupabaseClient,
  week: string,
  deptIds: string[],
  deptList: Array<{ id: string; name: string; code: string }>
): Promise<BarrierRow[]> {
  const { data, error } = await supabase
    .from("rotation_exceptions")
    .select("id, department_id, reason, created_at, assigned_week")
    .eq("assigned_week", week)
    .in("department_id", deptIds)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) return [];

  const nameById = new Map(deptList.map((d) => [d.id, d.name]));
  return (data ?? []).map((row) => ({
    id: row.id as string,
    department_id: row.department_id as string,
    department_name: nameById.get(row.department_id as string) ?? "Department",
    reason: String(row.reason ?? "Other"),
    created_at: String(row.created_at ?? ""),
  }));
}

function composeSnapshot(
  week: string,
  storeId: string,
  scope: "store" | "department",
  deptList: Array<{
    id: string;
    name: string;
    code: string;
    weekly_bay_target?: number | null;
  }>,
  rotations: Array<{
    department_id: string;
    is_completed: boolean;
    completed_at?: string | null;
  }>,
  barriers: BarrierRow[]
): StoreHealthSnapshot {
  const rows: DepartmentHealthRow[] = deptList.map((dept) => {
    const mine = rotations.filter((r) => r.department_id === dept.id);
    const assigned = mine.length;
    const completed = mine.filter((r) => r.is_completed).length;
    const open = assigned - completed;
    const exception_count = barriers.filter(
      (b) => b.department_id === dept.id
    ).length;
    return {
      department_id: dept.id,
      department_name: dept.name,
      department_code: dept.code,
      weekly_bay_target: Number(dept.weekly_bay_target) > 0
        ? Math.floor(Number(dept.weekly_bay_target))
        : 10,
      assigned,
      completed,
      open,
      exception_count,
      completion_pct: completionPct(completed, assigned),
    };
  });

  const bucketMap = new Map<string, number>();
  for (const b of barriers) {
    const label = bucketReason(b.reason);
    bucketMap.set(label, (bucketMap.get(label) ?? 0) + 1);
  }
  const bottleneck_summary = [...bucketMap.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);

  const assigned = rows.reduce((s, r) => s + r.assigned, 0);
  const completed = rows.reduce((s, r) => s + r.completed, 0);
  const open = assigned - completed;
  const exceptions = barriers.length;

  const codeById = new Map(rows.map((r) => [r.department_id, r] as const));
  const completionEvents: TelemetryCompletionEvent[] = rotations.map((r) => {
    const meta = codeById.get(r.department_id);
    return {
      completed_at: r.completed_at ?? null,
      department_id: r.department_id,
      department_code: meta?.department_code,
      department_name: meta?.department_name,
      is_completed: Boolean(r.is_completed),
    };
  });

  const telemetry = buildStoreAuditTelemetry({
    completions: completionEvents,
    exceptions: barriers.map((b) => ({
      created_at: b.created_at,
      department_id: b.department_id,
      department_code: codeById.get(b.department_id)?.department_code,
    })),
    departments: rows.map((r) => ({
      department_id: r.department_id,
      department_code: r.department_code,
      department_name: r.department_name,
      weekly_bay_target: r.weekly_bay_target,
      assigned: r.assigned,
    })),
  });

  return {
    assigned_week: week,
    store_id: storeId,
    scope,
    department: scope === "department" ? rows[0] ?? null : null,
    departments: rows,
    barriers,
    bottleneck_summary,
    totals: {
      assigned,
      completed,
      open,
      exceptions,
      completion_pct: completionPct(completed, assigned),
    },
    telemetry,
    bay_health: null,
  };
}
