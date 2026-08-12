/**
 * Manager notes — local persistence + types aligned to manager_notes table.
 * Owns offline note list for the S Pen workspace; does not own Gemini synthesis.
 */

import type { NoteActionItem } from "./ai-note-summary";

const STORAGE_KEY = "deptsync_manager_notes";

export type ManagerNote = {
  id: string;
  store_id: string | null;
  store_number: string;
  department_code: string;
  aisle: string | null;
  bay: number | null;
  title: string;
  content: string;
  canvas_data_url: string | null;
  ai_summary: string | null;
  action_items: NoteActionItem[] | null;
  created_by: string;
  created_at: string;
  /** Local checkbox state for synthesized action items (presentation only). */
  completed_task_indexes?: number[];
};

export type ManagerNoteDraft = {
  title: string;
  content: string;
  department_code: string;
  aisle?: string;
  bay?: number | null;
  canvas_data_url?: string | null;
};

function safeParse(raw: string | null): ManagerNote[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (row): row is ManagerNote =>
        Boolean(row) &&
        typeof row === "object" &&
        typeof (row as ManagerNote).id === "string"
    );
  } catch {
    return [];
  }
}

function writeAll(notes: ManagerNote[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(notes.slice(0, 200)));
  } catch {
    /* quota / private mode */
  }
}

export function listManagerNotes(storeNumber?: string): ManagerNote[] {
  if (typeof window === "undefined") return [];
  const all = safeParse(window.localStorage.getItem(STORAGE_KEY));
  const store = String(storeNumber ?? "").trim();
  const filtered = store
    ? all.filter((n) => !n.store_number || n.store_number === store)
    : all;
  return filtered.sort((a, b) =>
    String(b.created_at).localeCompare(String(a.created_at))
  );
}

export function saveManagerNote(note: ManagerNote): ManagerNote {
  const all = safeParse(
    typeof window !== "undefined"
      ? window.localStorage.getItem(STORAGE_KEY)
      : null
  );
  const idx = all.findIndex((n) => n.id === note.id);
  if (idx >= 0) all[idx] = note;
  else all.unshift(note);
  writeAll(all);
  return note;
}

export function deleteManagerNote(id: string): void {
  const all = safeParse(
    typeof window !== "undefined"
      ? window.localStorage.getItem(STORAGE_KEY)
      : null
  );
  writeAll(all.filter((n) => n.id !== id));
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
  };
}
