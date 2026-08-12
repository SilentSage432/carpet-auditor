/**
 * Manager notes — Supabase persistence + types aligned to manager_notes table.
 * Owns durable note CRUD / realtime; does not own Gemini synthesis.
 */

import { getSupabase } from "@/lib/supabase";
import type { NoteActionItem } from "./ai-note-summary";

export type ManagerNoteCategory = "shift_handover" | "audit" | "general";

export type ManagerNote = {
  id: string;
  store_number: string;
  department: string;
  /** Alias of department for S Pen workspace / legacy callers. */
  department_code: string;
  author_id: string | null;
  content: string;
  category: ManagerNoteCategory;
  created_at: string;
  updated_at: string;
  store_id: string | null;
  aisle: string | null;
  bay: number | null;
  title: string;
  canvas_data_url: string | null;
  ai_summary: string | null;
  action_items: NoteActionItem[] | null;
  created_by: string;
  completed_task_indexes?: number[];
};

export type ManagerNoteDraft = {
  title: string;
  content: string;
  department_code: string;
  aisle?: string;
  bay?: number | null;
  canvas_data_url?: string | null;
  category?: ManagerNoteCategory;
};

type ManagerNoteRow = {
  id: string;
  store_number: string;
  department: string;
  department_code?: string | null;
  author_id?: string | null;
  content: string;
  category?: string | null;
  created_at: string;
  updated_at?: string | null;
  store_id?: string | null;
  aisle?: string | null;
  bay?: number | null;
  title?: string | null;
  canvas_data_url?: string | null;
  ai_summary?: string | null;
  action_items?: NoteActionItem[] | null;
  created_by?: string | null;
  completed_task_indexes?: number[] | null;
};

function requireClient() {
  const supabase = getSupabase();
  if (!supabase) {
    throw new Error("Database not configured");
  }
  return supabase;
}

function normalizeCategory(raw: unknown): ManagerNoteCategory {
  if (raw === "shift_handover" || raw === "audit" || raw === "general") {
    return raw;
  }
  return "general";
}

export function mapManagerNoteRow(row: ManagerNoteRow): ManagerNote {
  const department = String(row.department || row.department_code || "").trim();
  return {
    id: String(row.id),
    store_number: String(row.store_number ?? ""),
    department,
    department_code: department,
    author_id: row.author_id ? String(row.author_id) : null,
    content: String(row.content ?? ""),
    category: normalizeCategory(row.category),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at ?? row.created_at),
    store_id: row.store_id ? String(row.store_id) : null,
    aisle: row.aisle != null ? String(row.aisle) : null,
    bay: row.bay == null ? null : Number(row.bay),
    title: String(row.title ?? ""),
    canvas_data_url: row.canvas_data_url ? String(row.canvas_data_url) : null,
    ai_summary: row.ai_summary ? String(row.ai_summary) : null,
    action_items: Array.isArray(row.action_items) ? row.action_items : null,
    created_by: String(row.created_by ?? ""),
    completed_task_indexes: Array.isArray(row.completed_task_indexes)
      ? row.completed_task_indexes
      : [],
  };
}

export function createManagerNoteId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `note_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function emptyDraft(departmentCode: string): ManagerNoteDraft {
  return {
    title: "",
    content: "",
    department_code: departmentCode || "flooring",
    aisle: "",
    bay: null,
    canvas_data_url: null,
    category: "general",
  };
}

export async function listManagerNotes(
  storeNumber: string,
  department?: string | null
): Promise<ManagerNote[]> {
  const supabase = requireClient();
  const store = String(storeNumber ?? "").trim();
  if (!store) return [];

  let query = supabase
    .from("manager_notes")
    .select("*")
    .eq("store_number", store)
    .order("created_at", { ascending: false })
    .limit(200);

  const dept = String(department ?? "").trim();
  if (dept && dept !== "all") {
    query = query.eq("department", dept);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message || "Could not load manager notes");
  return (data as ManagerNoteRow[] | null)?.map(mapManagerNoteRow) ?? [];
}

export async function saveManagerNote(
  note: ManagerNote
): Promise<ManagerNote> {
  const supabase = requireClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const department = String(note.department || note.department_code || "").trim();
  const payload = {
    id: note.id,
    store_number: String(note.store_number).trim(),
    department,
    department_code: department,
    author_id: note.author_id || user?.id || null,
    content: note.content ?? "",
    category: normalizeCategory(note.category),
    store_id: note.store_id,
    aisle: note.aisle,
    bay: note.bay,
    title: note.title ?? "",
    canvas_data_url: note.canvas_data_url,
    ai_summary: note.ai_summary,
    action_items: note.action_items,
    created_by: note.created_by,
    completed_task_indexes: note.completed_task_indexes ?? [],
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("manager_notes")
    .upsert(payload, { onConflict: "id" })
    .select("*")
    .single();

  if (error) throw new Error(error.message || "Could not save manager note");
  return mapManagerNoteRow(data as ManagerNoteRow);
}

export async function deleteManagerNote(id: string): Promise<void> {
  const supabase = requireClient();
  const { error } = await supabase.from("manager_notes").delete().eq("id", id);
  if (error) throw new Error(error.message || "Could not delete manager note");
}

/**
 * Subscribe to manager_notes changes for a store (and optional department).
 * Returns an unsubscribe function.
 */
export function subscribeManagerNotes(
  storeNumber: string,
  onChange: () => void,
  department?: string | null
): () => void {
  const supabase = getSupabase();
  if (!supabase) return () => undefined;

  const store = String(storeNumber ?? "").trim();
  const channelName = `manager_notes:${store}:${department || "all"}`;
  const channel = supabase
    .channel(channelName)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "manager_notes",
        filter: `store_number=eq.${store}`,
      },
      () => {
        onChange();
      }
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}
