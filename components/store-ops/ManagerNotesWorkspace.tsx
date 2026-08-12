"use client";

/**
 * Manager Notes & S Pen Canvas workspace — presentation + local note list.
 * Synthesis owned by POST /api/store-ops/ai-note-summary + lib/store-ops/ai-note-summary.
 */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  synthesizeManagerNote,
  type NoteSummaryClientResult,
} from "@/lib/store-ops/client";
import type { NoteActionPriority } from "@/lib/store-ops/ai-note-summary";
import {
  createManagerNoteId,
  deleteManagerNote,
  emptyDraft,
  listManagerNotes,
  saveManagerNote,
  type ManagerNote,
  type ManagerNoteDraft,
} from "@/lib/store-ops/manager-notes";
import { workingDepartment } from "@/lib/admin-department-context";
import { readableError } from "@/lib/store-ops/errors";
import { selectOnFocus } from "@/lib/number-input";
import type { StoreSpecialist } from "@/lib/types";

const PEN_COLORS = [
  { id: "emerald", hex: "#34d399", label: "Emerald" },
  { id: "cyan", hex: "#22d3ee", label: "Cyan" },
  { id: "amber", hex: "#fbbf24", label: "Amber" },
  { id: "rose", hex: "#fb7185", label: "Rose" },
  { id: "white", hex: "#f4f4f5", label: "White" },
] as const;

type Props = {
  open: boolean;
  onClose: () => void;
  specialist: StoreSpecialist;
  storeNumber: string;
  /** Optional bay context when opened from Store Map / audit. */
  initialAisle?: string;
  initialBay?: number;
  initialDepartmentCode?: string;
};

function priorityPill(priority: NoteActionPriority): string {
  if (priority === "HIGH") return "glass-pill-rose";
  if (priority === "MEDIUM") return "glass-pill-amber";
  return "glass-pill-cyan";
}

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

export function ManagerNotesWorkspace({
  open,
  onClose,
  specialist,
  storeNumber,
  initialAisle,
  initialBay,
  initialDepartmentCode,
}: Props) {
  const titleId = useId();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const undoStackRef = useRef<ImageData[]>([]);

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
  const [penColor, setPenColor] = useState<string>(PEN_COLORS[0].hex);
  const [penWidth, setPenWidth] = useState(2.5);
  const [hasInk, setHasInk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [synthesis, setSynthesis] = useState<NoteSummaryClientResult | null>(
    null
  );
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [status, setStatus] = useState<string | null>(null);

  const reloadNotes = useCallback(() => {
    setNotes(listManagerNotes(storeNumber));
  }, [storeNumber]);

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = Math.max(280, parent.clientWidth);
    const cssH = Math.max(220, Math.round(cssW * 0.62));
    const prev = canvas.toDataURL("image/png");
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.fillStyle = "#09090b";
    ctx.fillRect(0, 0, cssW, cssH);
    if (prev && prev.length > 100) {
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0, cssW, cssH);
      };
      img.src = prev;
    }
  }, []);

  const pushUndo = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    try {
      const snap = ctx.getImageData(0, 0, canvas.width, canvas.height);
      undoStackRef.current = [...undoStackRef.current.slice(-24), snap];
    } catch {
      /* tainted / size */
    }
  }, []);

  const clearCanvas = useCallback(
    (recordUndo = true) => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;
      if (recordUndo) pushUndo();
      ctx.fillStyle = "#09090b";
      ctx.fillRect(0, 0, w, h);
      setHasInk(false);
      setDraft((d) => ({ ...d, canvas_data_url: null }));
    },
    [pushUndo]
  );

  const undoStroke = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const prev = undoStackRef.current.pop();
    if (!canvas || !ctx || !prev) return;
    ctx.putImageData(prev, 0, 0);
    setHasInk(true);
  }, []);

  const exportCanvas = useCallback((): string | null => {
    const canvas = canvasRef.current;
    if (!canvas || !hasInk) return null;
    try {
      return canvas.toDataURL("image/png");
    } catch {
      return null;
    }
  }, [hasInk]);

  const resetDraft = useCallback(() => {
    setSelectedId(null);
    setDraft({
      ...emptyDraft(defaultDept),
      aisle: initialAisle?.trim() || "",
      bay:
        initialBay != null && Number.isFinite(Number(initialBay))
          ? Math.floor(Number(initialBay))
          : null,
    });
    setSynthesis(null);
    setChecked(new Set());
    setError(null);
    setStatus(null);
    undoStackRef.current = [];
    window.setTimeout(() => {
      resizeCanvas();
      clearCanvas(false);
      undoStackRef.current = [];
    }, 50);
  }, [clearCanvas, defaultDept, initialAisle, initialBay, resizeCanvas]);

  useEffect(() => {
    if (!open) return;
    reloadNotes();
    resetDraft();
    document.body.style.overflow = "hidden";
    const onResize = () => resizeCanvas();
    window.addEventListener("resize", onResize);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("resize", onResize);
    };
  }, [open, reloadNotes, resetDraft, resizeCanvas]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  function pointerPos(e: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }

  function onPointerDown(e: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const pt = pointerPos(e);
    if (!canvas || !ctx || !pt) return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    pushUndo();
    drawingRef.current = true;
    lastPointRef.current = pt;
    const pressure =
      e.pointerType === "pen" && e.pressure > 0 ? e.pressure : 0.5;
    ctx.strokeStyle = penColor;
    ctx.lineWidth = Math.max(1.2, penWidth * (0.55 + pressure));
    ctx.beginPath();
    ctx.moveTo(pt.x, pt.y);
    ctx.lineTo(pt.x + 0.01, pt.y);
    ctx.stroke();
    setHasInk(true);
  }

  function onPointerMove(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    const pt = pointerPos(e);
    const last = lastPointRef.current;
    if (!ctx || !pt || !last) return;
    e.preventDefault();
    const pressure =
      e.pointerType === "pen" && e.pressure > 0 ? e.pressure : 0.5;
    ctx.strokeStyle = penColor;
    ctx.lineWidth = Math.max(1.2, penWidth * (0.55 + pressure));
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(pt.x, pt.y);
    ctx.stroke();
    lastPointRef.current = pt;
    setHasInk(true);
  }

  function onPointerUp(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    lastPointRef.current = null;
    try {
      canvasRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    const dataUrl = exportCanvas();
    if (dataUrl) {
      setDraft((d) => ({ ...d, canvas_data_url: dataUrl }));
    }
  }

  function loadNote(note: ManagerNote) {
    setSelectedId(note.id);
    setDraft({
      title: note.title,
      content: note.content,
      department_code: note.department_code,
      aisle: note.aisle ?? "",
      bay: note.bay,
      canvas_data_url: note.canvas_data_url,
    });
    setChecked(new Set(note.completed_task_indexes ?? []));
    setSynthesis(
      note.ai_summary
        ? {
            executive_summary: note.ai_summary,
            action_items: note.action_items ?? [],
            referenced: { skus: [], aisles: [], bay_exceptions: [] },
            source: "local",
          }
        : null
    );
    setError(null);
    setStatus(null);
    window.setTimeout(() => {
      resizeCanvas();
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;
      ctx.fillStyle = "#09090b";
      ctx.fillRect(0, 0, w, h);
      if (note.canvas_data_url) {
        const img = new Image();
        img.onload = () => {
          ctx.drawImage(img, 0, 0, w, h);
          setHasInk(true);
        };
        img.src = note.canvas_data_url;
      } else {
        setHasInk(false);
      }
      undoStackRef.current = [];
    }, 50);
  }

  async function onSynthesize() {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const canvasUrl = exportCanvas() ?? draft.canvas_data_url ?? undefined;
      const bayNum =
        draft.bay != null && Number.isFinite(Number(draft.bay))
          ? Math.floor(Number(draft.bay))
          : undefined;
      const result = await synthesizeManagerNote(specialist, {
        title: draft.title,
        content: draft.content,
        canvas_data_url: canvasUrl || undefined,
        department_code: draft.department_code,
        aisle: draft.aisle?.trim() || undefined,
        bay: bayNum,
      });
      setSynthesis(result);
      setChecked(new Set());

      const note: ManagerNote = {
        id: selectedId ?? createManagerNoteId(),
        store_id: null,
        store_number: storeNumber,
        department_code: draft.department_code || defaultDept,
        aisle: draft.aisle?.trim() || null,
        bay: bayNum ?? null,
        title: draft.title.trim() || "Untitled note",
        content: draft.content.trim(),
        canvas_data_url: canvasUrl || null,
        ai_summary: result.executive_summary,
        action_items: result.action_items,
        created_by: specialist.username || specialist.name || specialist.id,
        created_at: new Date().toISOString(),
        completed_task_indexes: [],
      };
      saveManagerNote(note);
      setSelectedId(note.id);
      setDraft((d) => ({ ...d, canvas_data_url: canvasUrl || null }));
      reloadNotes();
      setStatus(
        result.source === "gemini"
          ? "Synthesized with Gemini Flash"
          : "Local synthesis (Gemini key missing)"
      );
    } catch (err) {
      setError(readableError(err, "Could not synthesize action items"));
    } finally {
      setBusy(false);
    }
  }

  function toggleTask(index: number) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      if (selectedId) {
        const existing = notes.find((n) => n.id === selectedId);
        if (existing) {
          saveManagerNote({
            ...existing,
            completed_task_indexes: [...next],
          });
        }
      }
      return next;
    });
  }

  function onDeleteSelected() {
    if (!selectedId) return;
    deleteManagerNote(selectedId);
    reloadNotes();
    resetDraft();
  }

  if (!open) return null;

  const contextChip = [
    draft.department_code,
    draft.aisle?.trim() && `Aisle ${draft.aisle.trim()}`,
    draft.bay != null && Number.isFinite(Number(draft.bay))
      ? `Bay ${Math.floor(Number(draft.bay))}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center sm:p-4">
      <button
        type="button"
        aria-label="Close manager notes"
        className="absolute inset-0 bg-black/60 backdrop-blur-md"
        onClick={onClose}
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="glass-card relative z-10 flex max-h-[96dvh] w-full max-w-2xl flex-col overflow-hidden !rounded-t-2xl !rounded-b-none border-t-2 border-cyan-500/40 shadow-[0_0_50px_-12px_rgba(34,211,238,0.45)] sm:!rounded-2xl sm:border"
      >
        <header className="flex shrink-0 items-start gap-3 border-b border-zinc-800/80 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-300">
              Manager Notes
            </p>
            <h2 id={titleId} className="text-lg font-bold text-zinc-50">
              Notes &amp; S Pen Canvas
            </h2>
            {contextChip ? (
              <p className="mt-0.5 truncate text-xs text-zinc-400">
                Auto-context: {contextChip}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-zinc-700 text-zinc-200"
            aria-label="Close"
          >
            ✕
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {/* Notes list */}
          <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
            <button
              type="button"
              onClick={resetDraft}
              className="min-h-11 shrink-0 rounded-xl border border-emerald-500/40 bg-emerald-950/40 px-3 text-xs font-semibold text-emerald-200"
            >
              + New note
            </button>
            {notes.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => loadNote(n)}
                className={`min-h-11 max-w-[10rem] shrink-0 truncate rounded-xl border px-3 text-left text-xs font-semibold ${
                  selectedId === n.id
                    ? "border-cyan-400/60 bg-cyan-950/50 text-cyan-100"
                    : "border-zinc-700 bg-zinc-950/60 text-zinc-300"
                }`}
              >
                {n.title || "Untitled"}
                <span className="mt-0.5 block truncate font-normal text-[10px] text-zinc-500">
                  {formatWhen(n.created_at)}
                </span>
              </button>
            ))}
          </div>

          {/* Editor */}
          <div className="glass-card space-y-3 border-zinc-700/60 p-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <label className="col-span-2 block sm:col-span-2">
                <span className="glass-label mb-1 block text-[10px] uppercase tracking-wider text-zinc-500">
                  Title
                </span>
                <input
                  className="glass-input min-h-11"
                  value={draft.title}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, title: e.target.value }))
                  }
                  placeholder="Bay face / exception title"
                  onFocus={selectOnFocus}
                />
              </label>
              <label className="block">
                <span className="glass-label mb-1 block text-[10px] uppercase tracking-wider text-zinc-500">
                  Dept
                </span>
                <input
                  className="glass-input min-h-11 font-mono text-sm"
                  value={draft.department_code}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      department_code: e.target.value.trim().toLowerCase(),
                    }))
                  }
                  onFocus={selectOnFocus}
                />
              </label>
              <label className="block">
                <span className="glass-label mb-1 block text-[10px] uppercase tracking-wider text-zinc-500">
                  Aisle
                </span>
                <input
                  className="glass-input min-h-11 font-mono text-sm uppercase"
                  value={draft.aisle ?? ""}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      aisle: e.target.value.toUpperCase(),
                    }))
                  }
                  placeholder="BW"
                  onFocus={selectOnFocus}
                />
              </label>
              <label className="block">
                <span className="glass-label mb-1 block text-[10px] uppercase tracking-wider text-zinc-500">
                  Bay
                </span>
                <input
                  className="glass-input min-h-11 font-mono text-sm"
                  inputMode="numeric"
                  value={draft.bay ?? ""}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/\D/g, "");
                    setDraft((d) => ({
                      ...d,
                      bay: raw ? Number(raw) : null,
                    }));
                  }}
                  placeholder="4"
                  onFocus={selectOnFocus}
                />
              </label>
            </div>

            <label className="block">
              <span className="glass-label mb-1 block text-[10px] uppercase tracking-wider text-zinc-500">
                Note
              </span>
              <textarea
                className="glass-input min-h-24 resize-y text-sm leading-relaxed"
                value={draft.content}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, content: e.target.value }))
                }
                placeholder="What needs attention on the floor?"
              />
            </label>
          </div>

          {/* S Pen canvas */}
          <div className="mt-3 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-cyan-300">
                S Pen Canvas
              </p>
              <div className="flex flex-wrap gap-1.5">
                {PEN_COLORS.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    aria-label={c.label}
                    title={c.label}
                    onClick={() => setPenColor(c.hex)}
                    className={`h-9 w-9 rounded-full border-2 ${
                      penColor === c.hex
                        ? "border-white scale-105"
                        : "border-zinc-700"
                    }`}
                    style={{ backgroundColor: c.hex }}
                  />
                ))}
                <button
                  type="button"
                  onClick={() => setPenWidth((w) => (w < 4 ? 4.5 : 2.5))}
                  className="min-h-9 rounded-lg border border-zinc-700 px-2 text-[10px] font-semibold text-zinc-300"
                >
                  {penWidth < 4 ? "Fine" : "Bold"}
                </button>
                <button
                  type="button"
                  onClick={undoStroke}
                  className="min-h-9 rounded-lg border border-zinc-700 px-2 text-[10px] font-semibold text-zinc-300"
                >
                  Undo
                </button>
                <button
                  type="button"
                  onClick={() => clearCanvas()}
                  className="min-h-9 rounded-lg border border-rose-500/40 px-2 text-[10px] font-semibold text-rose-200"
                >
                  Clear
                </button>
              </div>
            </div>
            <div className="overflow-hidden rounded-xl border border-cyan-500/30 bg-zinc-950 touch-none">
              <canvas
                ref={canvasRef}
                className="block w-full touch-none cursor-crosshair"
                style={{ touchAction: "none" }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
              />
            </div>
            <p className="text-[11px] text-zinc-500">
              Optimized for S Pen / stylus — pressure-aware strokes, PNG export
              on synthesize.
            </p>
          </div>

          <button
            type="button"
            disabled={busy || (!draft.title.trim() && !draft.content.trim() && !hasInk)}
            onClick={() => void onSynthesize()}
            className="btn-primary-glow mt-4 flex min-h-14 w-full items-center justify-center gap-2 rounded-xl text-base shadow-[0_0_30px_-6px_rgba(16,185,129,0.65)]"
          >
            {busy ? "Synthesizing…" : "✨ Synthesize Action Items"}
          </button>

          {error ? (
            <p className="mt-2 rounded-xl border border-rose-500/40 bg-rose-950/40 px-3 py-2 text-sm text-rose-200">
              {error}
            </p>
          ) : null}
          {status ? (
            <p className="mt-2 text-xs text-emerald-300">{status}</p>
          ) : null}

          {synthesis ? (
            <div className="mt-4 space-y-3">
              <div className="glass-card border-cyan-500/30 p-3 shadow-[0_0_28px_-10px_rgba(34,211,238,0.4)]">
                <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-cyan-300">
                  Executive summary
                </p>
                <p className="mt-1 text-sm leading-relaxed text-zinc-100">
                  {synthesis.executive_summary}
                </p>
                {(synthesis.referenced.skus.length > 0 ||
                  synthesis.referenced.aisles.length > 0 ||
                  synthesis.referenced.bay_exceptions.length > 0) && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {synthesis.referenced.skus.map((s) => (
                      <span key={`sku-${s}`} className="glass-pill-emerald">
                        SKU {s}
                      </span>
                    ))}
                    {synthesis.referenced.aisles.map((a) => (
                      <span key={`aisle-${a}`} className="glass-pill-cyan">
                        Aisle {a}
                      </span>
                    ))}
                    {synthesis.referenced.bay_exceptions.map((b) => (
                      <span key={`ex-${b}`} className="glass-pill-amber">
                        {b}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <ul className="space-y-2">
                {synthesis.action_items.map((item, idx) => {
                  const done = checked.has(idx);
                  return (
                    <li
                      key={`${item.task}-${idx}`}
                      className={`glass-card flex gap-3 border p-3 shadow-[0_0_24px_-8px_rgba(16,185,129,0.35)] ${
                        item.priority === "HIGH"
                          ? "border-rose-500/45"
                          : item.priority === "MEDIUM"
                            ? "border-amber-500/40"
                            : "border-cyan-500/35"
                      } ${done ? "opacity-60" : ""}`}
                    >
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={done}
                        onClick={() => toggleTask(idx)}
                        className={`mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border text-lg ${
                          done
                            ? "border-emerald-400 bg-emerald-600 text-white"
                            : "border-zinc-600 bg-zinc-950 text-zinc-400"
                        }`}
                      >
                        {done ? "✓" : ""}
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className={priorityPill(item.priority)}>
                            {item.priority}
                          </span>
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                            {item.assignee_role}
                          </span>
                        </div>
                        <p
                          className={`mt-1 text-sm text-zinc-100 ${
                            done ? "line-through" : ""
                          }`}
                        >
                          {item.task}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          {selectedId ? (
            <button
              type="button"
              onClick={onDeleteSelected}
              className="mt-4 min-h-11 w-full rounded-xl border border-zinc-700 text-sm font-semibold text-zinc-400"
            >
              Delete this note
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );
}
