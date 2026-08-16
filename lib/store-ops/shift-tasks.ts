/**
 * Shift-board walk tasks — dispatched floor-walk Copilot items.
 * Persistence owner: shift_walk_tasks (Supabase). localStorage caches live rows.
 * Bay freshness is stamped via lib/heatmap/bay-tracker; this module owns tasks.
 * DOWNSTOCK compose downstock.ts when a weekly rotation can be matched.
 */

import { getStoreNumber, storeNumberQueryValues } from "@/lib/store";
import { getSupabase } from "@/lib/supabase";
import { liveWriteError } from "@/lib/store-ops/errors";
import { isoWeekLabel } from "@/lib/store-ops/week";
import {
  matchLocationForTag,
  recordBayTouch,
} from "@/lib/heatmap/bay-tracker";
import {
  createWalkTaskId,
  parseWalkTaskCategory,
  parseWalkTaskPriority,
  parseWalkTaskWindow,
  type ParsedWalkTask,
  type WalkTaskCategory,
  type WalkTaskPriority,
  type WalkTaskWindow,
} from "@/lib/store-ops/ai-walk-parse";
import { flagForDownstock } from "@/lib/store-ops/downstock";
import type { StoreLocation, WeeklyRotationWithLocation } from "@/lib/store-ops/types";

export const SHIFT_TASKS_EVENT = "deptsync:shift-walk-tasks";

export type ShiftWalkTaskStatus = "open" | "dispatched" | "resolved";

export type ShiftWalkTask = {
  id: string;
  title: string;
  location_tag: string;
  category: WalkTaskCategory;
  priority: WalkTaskPriority;
  target_window: WalkTaskWindow;
  suggested_assignee?: string;
  assignee_id: string | null;
  assignee_name: string | null;
  status: ShiftWalkTaskStatus;
  department: string;
  store_number: string;
  assigned_week: string;
  location_id: string | null;
  rotation_id: string | null;
  created_at: string;
  dispatched_at: string | null;
  resolved_at: string | null;
  source: "voice_walk" | "scratchpad";
  transcript: string | null;
};

const STORAGE_PREFIX = "deptsync_shift_walk_tasks";

function storageKey(week: string, store = getStoreNumber()): string {
  return `${STORAGE_PREFIX}:${store}:${week}`;
}

function emitShiftTasks() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(SHIFT_TASKS_EVENT));
}

function requireClient() {
  const supabase = getSupabase();
  if (!supabase) {
    throw new Error("Database not configured — cannot read or write shift_walk_tasks");
  }
  return supabase;
}

function normalizeStatus(raw: unknown): ShiftWalkTaskStatus {
  if (raw === "dispatched" || raw === "resolved" || raw === "open") return raw;
  return "open";
}

function normalizeTask(raw: unknown): ShiftWalkTask | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const id = String(rec.id ?? "").trim();
  const title = String(rec.title ?? "").trim();
  if (!id || !title) return null;
  return {
    id,
    title: title.slice(0, 240),
    location_tag: String(rec.location_tag ?? "General").trim() || "General",
    category: parseWalkTaskCategory(rec.category),
    priority: parseWalkTaskPriority(rec.priority),
    target_window: parseWalkTaskWindow(rec.target_window),
    suggested_assignee: String(rec.suggested_assignee ?? "").trim() || undefined,
    assignee_id: String(rec.assignee_id ?? "").trim() || null,
    assignee_name: String(rec.assignee_name ?? "").trim() || null,
    status: normalizeStatus(rec.status),
    department: String(rec.department ?? "flooring").trim() || "flooring",
    store_number: String(rec.store_number ?? "").trim(),
    assigned_week: String(rec.assigned_week ?? "").trim(),
    location_id: String(rec.location_id ?? "").trim() || null,
    rotation_id: String(rec.rotation_id ?? "").trim() || null,
    created_at: String(rec.created_at ?? new Date().toISOString()),
    dispatched_at: rec.dispatched_at ? String(rec.dispatched_at) : null,
    resolved_at: rec.resolved_at ? String(rec.resolved_at) : null,
    source: rec.source === "scratchpad" ? "scratchpad" : "voice_walk",
    transcript: rec.transcript ? String(rec.transcript) : null,
  };
}

function readLocal(week: string, store = getStoreNumber()): ShiftWalkTask[] {
  if (typeof window === "undefined" || !week) return [];
  try {
    const raw = window.localStorage.getItem(storageKey(week, store));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeTask).filter((row): row is ShiftWalkTask => Boolean(row));
  } catch {
    return [];
  }
}

function writeLocal(
  week: string,
  rows: ShiftWalkTask[],
  store = getStoreNumber()
): void {
  if (typeof window === "undefined" || !week) return;
  window.localStorage.setItem(storageKey(week, store), JSON.stringify(rows));
}

function persistLocal(task: ShiftWalkTask): void {
  const rows = readLocal(task.assigned_week, task.store_number);
  const idx = rows.findIndex((row) => row.id === task.id);
  if (idx >= 0) rows[idx] = task;
  else rows.unshift(task);
  writeLocal(task.assigned_week, rows, task.store_number);
}

export function subscribeShiftTasks(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => onChange();
  window.addEventListener(SHIFT_TASKS_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(SHIFT_TASKS_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

export async function fetchShiftWalkTasks(
  week = isoWeekLabel(),
  storeNumber = getStoreNumber(),
  department = "flooring"
): Promise<ShiftWalkTask[]> {
  const store = String(storeNumber ?? "").trim();
  if (!store || !week) return [];

  const supabase = requireClient();
  const keys = storeNumberQueryValues(store);
  const { data, error } = await supabase
    .from("shift_walk_tasks")
    .select(
      "id, title, location_tag, category, priority, target_window, suggested_assignee, assignee_id, assignee_name, status, department, store_number, assigned_week, location_id, rotation_id, created_at, dispatched_at, resolved_at, source, transcript"
    )
    .in("store_number", keys.length ? keys : [store])
    .eq("assigned_week", week)
    .eq("department", department);

  if (error) {
    throw liveWriteError(error, "shift_walk_tasks", "Could not load shift walk tasks");
  }

  const remote = (data ?? [])
    .map(normalizeTask)
    .filter((row): row is ShiftWalkTask => Boolean(row));
  writeLocal(week, remote, store);
  return remote;
}

export function parsedToDraftTask(
  parsed: ParsedWalkTask,
  input: {
    department: string;
    storeNumber: string;
    week: string;
    source: "voice_walk" | "scratchpad";
    transcript?: string | null;
    assignee_id?: string | null;
    assignee_name?: string | null;
  }
): ShiftWalkTask {
  const now = new Date().toISOString();
  return {
    id: parsed.id || createWalkTaskId(),
    title: parsed.title,
    location_tag: parsed.location_tag,
    category: parsed.category,
    priority: parsed.priority,
    target_window: parsed.target_window,
    suggested_assignee: parsed.suggested_assignee,
    assignee_id: input.assignee_id ?? null,
    assignee_name:
      input.assignee_name ?? parsed.suggested_assignee ?? null,
    status: "open",
    department: input.department,
    store_number: input.storeNumber,
    assigned_week: input.week,
    location_id: null,
    rotation_id: null,
    created_at: now,
    dispatched_at: null,
    resolved_at: null,
    source: input.source,
    transcript: input.transcript ?? null,
  };
}

async function upsertRemote(task: ShiftWalkTask): Promise<void> {
  const supabase = requireClient();
  const { error } = await supabase.from("shift_walk_tasks").upsert(
    {
      id: task.id,
      title: task.title,
      location_tag: task.location_tag,
      category: task.category,
      priority: task.priority,
      target_window: task.target_window,
      suggested_assignee: task.suggested_assignee ?? null,
      assignee_id: task.assignee_id,
      assignee_name: task.assignee_name,
      status: task.status,
      department: task.department,
      store_number: task.store_number,
      assigned_week: task.assigned_week,
      location_id: task.location_id,
      rotation_id: task.rotation_id,
      created_at: task.created_at,
      dispatched_at: task.dispatched_at,
      resolved_at: task.resolved_at,
      source: task.source,
      transcript: task.transcript,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" }
  );
  if (error) {
    throw liveWriteError(error, "shift_walk_tasks", "Could not sync shift walk task");
  }
}

export function matchRotationForTag(
  tag: string,
  rotations: WeeklyRotationWithLocation[]
): WeeklyRotationWithLocation | null {
  const locations = rotations
    .map((row) => row.store_locations)
    .filter((loc): loc is StoreLocation => Boolean(loc));
  const matched = matchLocationForTag(tag, locations);
  if (!matched) return null;
  return (
    rotations.find(
      (row) =>
        row.store_locations?.id === matched.id || row.location_id === matched.id
    ) ?? null
  );
}

export async function dispatchShiftWalkTasks(input: {
  tasks: ShiftWalkTask[];
  rotations?: WeeklyRotationWithLocation[];
  flaggedBy?: string;
}): Promise<ShiftWalkTask[]> {
  const now = new Date().toISOString();
  const dispatched: ShiftWalkTask[] = [];

  for (const draft of input.tasks) {
    const rotation = matchRotationForTag(draft.location_tag, input.rotations ?? []);
    const loc = rotation?.store_locations ?? null;
    const task: ShiftWalkTask = {
      ...draft,
      status: "dispatched",
      dispatched_at: now,
      location_id: loc?.id ?? draft.location_id,
      rotation_id: rotation?.id ?? draft.rotation_id,
    };
    await upsertRemote(task);
    persistLocal(task);
    recordBayTouch({
      location_id: task.location_id,
      location_tag: task.location_tag,
      aisle: loc?.aisle ?? null,
      bay: loc?.bay ?? null,
      source: "dispatch",
      at: now,
      storeNumber: task.store_number,
    });

    if (task.category === "DOWNSTOCK" && task.rotation_id && task.assigned_week) {
      await flagForDownstock({
        week: task.assigned_week,
        rotationId: task.rotation_id,
        locationId: task.location_id ?? undefined,
        note: task.title,
        flaggedBy: input.flaggedBy,
        department: task.department,
        storeNumber: task.store_number,
      });
    }

    dispatched.push(task);
  }

  emitShiftTasks();
  return dispatched;
}

export async function resolveShiftWalkTask(
  task: ShiftWalkTask
): Promise<ShiftWalkTask> {
  const now = new Date().toISOString();
  const next: ShiftWalkTask = {
    ...task,
    status: "resolved",
    resolved_at: now,
  };
  persistLocal(next);
  await upsertRemote(next);
  recordBayTouch({
    location_id: next.location_id,
    location_tag: next.location_tag,
    source: "resolve",
    at: now,
    storeNumber: next.store_number,
  });
  emitShiftTasks();
  return next;
}

export function openShiftWalkTasks(rows: ShiftWalkTask[]): ShiftWalkTask[] {
  return rows.filter((row) => row.status !== "resolved");
}
