/**
 * Store Health Scorecard — weekly pace + bottleneck aggregation.
 * Composes weekly_rotations + rotation_exceptions for the current ISO week.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveDepartmentIdByCode } from "./rotations";
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
  };

  if (deptIds.length === 0) return empty;

  let rotQuery = supabase
    .from("weekly_rotations")
    .select("id, department_id, is_completed, assigned_week")
    .eq("store_id", opts.storeId)
    .eq("assigned_week", week)
    .in("department_id", deptIds);

  const { data: rotations, error: rotError } = await rotQuery;
  if (rotError) {
    // Missing store_id column / empty — try without store filter
    const fallback = await supabase
      .from("weekly_rotations")
      .select("id, department_id, is_completed, assigned_week")
      .eq("assigned_week", week)
      .in("department_id", deptIds);
    if (fallback.error) throw new Error(fallback.error.message);
    return composeSnapshot(
      week,
      opts.storeId,
      scope,
      deptList,
      fallback.data ?? [],
      await loadExceptions(supabase, week, deptIds, deptList)
    );
  }

  const exceptions = await loadExceptions(supabase, week, deptIds, deptList);
  return composeSnapshot(
    week,
    opts.storeId,
    scope,
    deptList,
    rotations ?? [],
    exceptions
  );
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
  };
}
