"use client";

/**
 * Executive Floor Pad — full-screen rich-text manager notes workspace.
 * Presentation owns UI; persistence in lib/store-ops/manager-notes;
 * Gemini Extract Tasks & Tag via app/actions/manager-notes.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Archive, Plus, Trash2, X } from "lucide-react";
import { extractTasksAndTag } from "@/app/actions/manager-notes";
import { workingDepartment } from "@/lib/admin-department-context";
import { appendTaskCheckboxesHtml } from "@/lib/store-ops/ai-note-extract";
import { readableError } from "@/lib/store-ops/errors";
import {
  archiveManagerNote,
  createManagerNoteId,
  deleteManagerNote,
  emptyDraft,
  listManagerNotes,
  saveManagerNote,
  subscribeManagerNotes,
  type ManagerNote,
  type ManagerNoteDraft,
} from "@/lib/store-ops/manager-notes";
import { getSupabaseAccessToken } from "@/lib/supabase/client";
import type { StoreSpecialist } from "@/lib/types";
import { FloorPadEditor } from "./FloorPadEditor";
import { FloorPadHeaderPills } from "./FloorPadHeaderPills";
import { loadFloorPadFonts } from "./fonts";

const AUTOSAVE_MS = 700;

type Props = {
  open: boolean;
  onClose: () => void;
  specialist: StoreSpecialist;
  storeNumber: string;
  initialAisle?: string;
  initialBay?: number;
  initialDepartmentCode?: string;
};

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function plainPreview(htmlOrText: string): string {
  return htmlOrText
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function ExecutiveFloorPad({
  open,
  onClose,
  specialist,
  storeNumber,
  initialAisle,
  initialBay,
  initialDepartmentCode,
}: Props) {
  const titleId = useId();
  const defaultDept =
    initialDepartmentCode?.trim() ||
    (workingDepartment(specialist) === "all"
      ? "flooring"
      : workingDepartment(specialist));

  const [notes, setNotes] = useState<ManagerNote[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ManagerNoteDraft>(() =>
    emptyDraft(defaultDept)
  );
  const [contentKey, setContentKey] = useState("new");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [summary, setSummary] = useState<string | null>(null);

  const draftRef = useRef(draft);
  const selectedIdRef = useRef(selectedId);
  const notesRef = useRef(notes);
  const summaryRef = useRef<string | null>(null);
  const metadataRef = useRef<Record<string, any>>({});
  const skipAutosaveRef = useRef(false);
  const createdAtRef = useRef<string | null>(null);

  draftRef.current = draft;
  selectedIdRef.current = selectedId;
  notesRef.current = notes;
  summaryRef.current = summary;

  const reloadNotes = useCallback(async () => {
    try {
      const rows = await listManagerNotes(storeNumber);
      setNotes(rows);
    } catch (err) {
      setError(readableError(err, "Could not load manager notes"));
    }
  }, [storeNumber]);

  useEffect(() => {
    if (!open) return;
    return subscribeManagerNotes(storeNumber, () => {
      void reloadNotes();
    });
  }, [open, storeNumber, reloadNotes]);

  const resetDraft = useCallback(() => {
    skipAutosaveRef.current = true;
    setSelectedId(null);
    createdAtRef.current = null;
    setDraft({
      ...emptyDraft(defaultDept),
      aisle: initialAisle?.trim() || "",
      bay:
        initialBay != null && Number.isFinite(Number(initialBay))
          ? Math.floor(Number(initialBay))
          : null,
    });
    setContentKey(`new-${Date.now()}`);
    setSummary(null);
    metadataRef.current = {};
    setError(null);
    setStatus(null);
    setSaveStatus("idle");
    window.setTimeout(() => {
      skipAutosaveRef.current = false;
    }, 50);
  }, [defaultDept, initialAisle, initialBay]);

  useEffect(() => {
    if (!open) return;
    loadFloorPadFonts();
    void reloadNotes();
    resetDraft();
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open, reloadNotes, resetDraft]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const persistDraft = useCallback(async () => {
    const d = draftRef.current;
    const hasBody =
      Boolean(d.title.trim()) || Boolean(plainPreview(d.content));
    if (!hasBody) return;

    const bayNum =
      d.bay != null && Number.isFinite(Number(d.bay))
        ? Math.floor(Number(d.bay))
        : null;
    const id = selectedIdRef.current ?? createManagerNoteId();
    const existing = notesRef.current.find((n) => n.id === id);
    const now = new Date().toISOString();

    const note: ManagerNote = {
      id,
      store_id: existing?.store_id ?? null,
      store_number: storeNumber,
      department: d.department_code || defaultDept,
      department_code: d.department_code || defaultDept,
      author_id: existing?.author_id ?? null,
      category: d.category ?? existing?.category ?? "general",
      aisle: d.aisle?.trim() || null,
      bay: bayNum,
      title: d.title.trim() || "Untitled note",
      content: d.content,
      canvas_data_url: null,
      ai_summary: summaryRef.current ?? existing?.ai_summary ?? null,
      action_items: existing?.action_items ?? null,
      metadata:
        Object.keys(metadataRef.current).length > 0
          ? metadataRef.current
          : existing?.metadata ?? {},
      created_by:
        existing?.created_by ||
        specialist.username ||
        specialist.name ||
        specialist.id,
      created_at: existing?.created_at || createdAtRef.current || now,
      updated_at: now,
      completed_task_indexes: existing?.completed_task_indexes ?? [],
      is_archived: false,
    };

    if (!selectedIdRef.current) {
      setSelectedId(id);
      createdAtRef.current = note.created_at;
    }

    setSaveStatus("saving");
    try {
      const saved = await saveManagerNote(note);
      setNotes((prev) => {
        const idx = prev.findIndex((n) => n.id === saved.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = saved;
          return next;
        }
        return [saved, ...prev];
      });
      setSaveStatus("saved");
    } catch (err) {
      setSaveStatus("error");
      setError(readableError(err, "Could not autosave note"));
    }
  }, [defaultDept, specialist, storeNumber]);

  useEffect(() => {
    if (!open || skipAutosaveRef.current) return;
    const hasBody =
      Boolean(draft.title.trim()) || Boolean(plainPreview(draft.content));
    if (!hasBody) return;

    const timer = window.setTimeout(() => {
      void persistDraft();
    }, AUTOSAVE_MS);

    return () => window.clearTimeout(timer);
  }, [draft, open, persistDraft]);

  function loadNote(note: ManagerNote) {
    skipAutosaveRef.current = true;
    setSelectedId(note.id);
    createdAtRef.current = note.created_at;
    setDraft({
      title: note.title,
      content: note.content,
      department_code: note.department_code,
      aisle: note.aisle ?? "",
      bay: note.bay,
      canvas_data_url: null,
      category: note.category,
      is_archived: note.is_archived,
    });
    setContentKey(note.id);
    setSummary(note.ai_summary);
    metadataRef.current = note.metadata ?? {};
    setError(null);
    setStatus(null);
    setSaveStatus("idle");
    window.setTimeout(() => {
      skipAutosaveRef.current = false;
    }, 50);
  }

  async function runGeminiCopilot(contentOverride?: string) {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const token = await getSupabaseAccessToken();
      if (!token) {
        throw new Error(
          "Sign in with phone OTP so Store Ops can call Gemini Copilot"
        );
      }

      const contentForExtract = contentOverride ?? draftRef.current.content;
      const draftSnap = draftRef.current;

      const result = await extractTasksAndTag({
        accessToken: token,
        title: draftSnap.title,
        content: contentForExtract,
        department_code: draftSnap.department_code,
        aisle: draftSnap.aisle?.trim() || undefined,
        bay: draftSnap.bay,
      });

      const nextHtml = appendTaskCheckboxesHtml(
        contentForExtract,
        result.tasks
      );
      skipAutosaveRef.current = true;
      summaryRef.current = result.executive_summary;
      metadataRef.current = result.metadata ?? {};
      setSummary(result.executive_summary);
      const nextDraft: ManagerNoteDraft = {
        ...draftSnap,
        content: nextHtml,
        aisle: result.aisle ?? draftSnap.aisle ?? "",
        bay: result.bay ?? draftSnap.bay ?? null,
        metadata: result.metadata ?? {},
      };
      draftRef.current = nextDraft;
      setDraft(nextDraft);
      setContentKey(`gemini-${Date.now()}`);
      const followUp =
        result.metadata?.follow_up_date != null
          ? ` · follow-up ${result.metadata.follow_up_date}`
          : "";
      setStatus(
        result.source === "gemini"
          ? `Gemini Copilot extracted tasks, tags & metadata${followUp}`
          : `Local extract (Gemini key missing)${followUp}`
      );
      window.setTimeout(() => {
        skipAutosaveRef.current = false;
        void persistDraft();
      }, 80);
    } catch (err) {
      setError(readableError(err, "Gemini Copilot failed"));
    } finally {
      setBusy(false);
    }
  }

  async function onGeminiCopilot() {
    await runGeminiCopilot();
  }

  async function onVoiceParse(htmlWithTranscript: string) {
    draftRef.current = {
      ...draftRef.current,
      content: htmlWithTranscript,
    };
    setDraft((d) => ({ ...d, content: htmlWithTranscript }));
    setStatus("Voice captured — parsing with Gemini Copilot…");
    await runGeminiCopilot(htmlWithTranscript);
  }

  async function onArchive() {
    if (!selectedId) return;
    const existing = notes.find((n) => n.id === selectedId);
    if (!existing) return;
    const previous = notes;
    setNotes((prev) => prev.filter((n) => n.id !== selectedId));
    resetDraft();
    try {
      await archiveManagerNote(existing, true);
      setStatus("Note archived");
    } catch (err) {
      setNotes(previous);
      setError(readableError(err, "Could not archive note"));
    }
  }

  async function onDeleteSelected() {
    if (!selectedId) return;
    const previous = notes;
    setNotes((prev) => prev.filter((n) => n.id !== selectedId));
    resetDraft();
    try {
      await deleteManagerNote(selectedId);
    } catch (err) {
      setNotes(previous);
      setError(readableError(err, "Could not delete note"));
    }
  }

  if (!open) return null;

  const hasFooterChrome = Boolean(error || status || summary || selectedId);

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-[#090d16]">
      <div
        className="pointer-events-none absolute inset-0 opacity-80"
        aria-hidden
        style={{
          background:
            "radial-gradient(ellipse 80% 50% at 20% -10%, rgba(16,185,129,0.18), transparent 55%), radial-gradient(ellipse 70% 45% at 100% 0%, rgba(34,211,238,0.12), transparent 50%), linear-gradient(180deg, #0c1220 0%, #090d16 45%, #071018 100%)",
        }}
      />

      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative z-10 flex h-dvh w-full flex-col"
      >
        <header className="shrink-0 border-b border-zinc-800/80 px-3 pb-1.5 pt-[max(0.45rem,env(safe-area-inset-top))] backdrop-blur-md">
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <h2
                id={titleId}
                className="truncate text-base font-bold tracking-tight text-zinc-50"
              >
                <span className="mr-2 font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-emerald-300/90">
                  Floor Pad
                </span>
                DeptSync Notes
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-700 text-zinc-200"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-1.5">
            <FloorPadHeaderPills
              department={draft.department_code}
              aisle={draft.aisle ?? ""}
              bay={draft.bay ?? null}
              onDepartmentChange={(department_code) =>
                setDraft((d) => ({ ...d, department_code }))
              }
              onAisleChange={(aisle) => setDraft((d) => ({ ...d, aisle }))}
              onBayChange={(bay) => setDraft((d) => ({ ...d, bay }))}
            />
          </div>
        </header>

        <div className="no-scrollbar flex shrink-0 gap-1.5 overflow-x-auto border-b border-zinc-800/50 px-2 py-1">
          <button
            type="button"
            onClick={resetDraft}
            className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-950/40 px-2.5 text-[11px] font-semibold text-emerald-200"
          >
            <Plus className="h-3 w-3" />
            New
          </button>
          {notes.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => loadNote(n)}
              className={`h-8 max-w-[9rem] shrink-0 truncate rounded-lg border px-2.5 text-left text-[11px] font-semibold ${
                selectedId === n.id
                  ? "border-cyan-400/60 bg-cyan-950/50 text-cyan-100"
                  : "border-zinc-700 bg-zinc-950/60 text-zinc-300"
              }`}
            >
              {n.title || "Untitled"}
              <span className="ml-1 font-normal text-[9px] text-zinc-500">
                {formatWhen(n.updated_at || n.created_at)}
              </span>
            </button>
          ))}
        </div>

        <FloorPadEditor
          content={draft.content}
          contentKey={contentKey}
          onChange={(html) => setDraft((d) => ({ ...d, content: html }))}
          busy={busy}
          onGemini={() => void onGeminiCopilot()}
          onVoiceParse={(html) => void onVoiceParse(html)}
          onSpeechError={(message) => setError(message)}
          saveStatus={saveStatus}
          title={draft.title}
          onTitleChange={(value) =>
            setDraft((d) => ({ ...d, title: value }))
          }
        />

        {hasFooterChrome ? (
          <footer className="shrink-0 space-y-1.5 border-t border-zinc-800/80 px-2 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur-md">
            {error ? (
              <p className="rounded-lg border border-rose-500/40 bg-rose-950/40 px-2.5 py-1.5 text-xs text-rose-200">
                {error}
              </p>
            ) : null}
            {status && !error ? (
              <p className="text-[11px] text-emerald-300">{status}</p>
            ) : null}
            {summary ? (
              <p className="line-clamp-2 rounded-lg border border-cyan-500/25 bg-cyan-950/20 px-2.5 py-1.5 text-xs leading-snug text-zinc-300">
                {summary}
              </p>
            ) : null}
            {selectedId ? (
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => void onArchive()}
                  className="inline-flex h-9 flex-1 items-center justify-center gap-1 rounded-lg border border-amber-500/40 bg-amber-950/30 text-xs font-semibold text-amber-100"
                >
                  <Archive className="h-3.5 w-3.5" />
                  Archive
                </button>
                <button
                  type="button"
                  onClick={() => void onDeleteSelected()}
                  className="inline-flex h-9 flex-1 items-center justify-center gap-1 rounded-lg border border-zinc-700 text-xs font-semibold text-zinc-400"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </button>
              </div>
            ) : null}
          </footer>
        ) : (
          <div className="pb-[max(0.25rem,env(safe-area-inset-bottom))]" />
        )}
      </section>
    </div>
  );
}

/** @deprecated Prefer ExecutiveFloorPad — alias for existing imports. */
export const ManagerNotesWorkspace = ExecutiveFloorPad;
