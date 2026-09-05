"use client";

/**
 * Master-only FS-002 season/event declaration manager.
 * MASTER_ADMIN_DECLARED only — no company source masquerading.
 */

import { useEffect, useMemo, useState } from "react";
import {
  createOperationalContext,
  deleteOperationalContext,
  fetchOperationalContextsList,
  setOperationalContextRelevance,
  updateOperationalContext,
  type OperationalContextClient,
  type OperationalContextRelevanceClient,
} from "@/lib/store-ops/client";
import { STORE_DEPARTMENT_TEMPLATES } from "@/lib/store-ops/stores";
import { isMasterAdmin } from "@/lib/rbac";
import { readableError } from "@/lib/store-ops/errors";
import type { StoreSpecialist } from "@/lib/types";

type Props = {
  specialist: StoreSpecialist;
};

type RelevanceChoice = "UNSET" | "NONE" | "LOW" | "MEDIUM" | "HIGH";

const RELEVANCE_OPTIONS: RelevanceChoice[] = [
  "UNSET",
  "NONE",
  "LOW",
  "MEDIUM",
  "HIGH",
];

export function OperationalContextCard({ specialist }: Props) {
  const master = isMasterAdmin(specialist);
  const [contexts, setContexts] = useState<OperationalContextClient[]>([]);
  const [relevance, setRelevance] = useState<
    OperationalContextRelevanceClient[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [kind, setKind] = useState<"SEASON" | "EVENT">("SEASON");
  const [title, setTitle] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const declaredOnly = useMemo(
    () =>
      contexts.filter(
        (c) =>
          c.source_type === "MASTER_ADMIN_DECLARED" &&
          c.store_id != null
      ),
    [contexts]
  );

  useEffect(() => {
    if (!master) return;
    let cancelled = false;
    async function load() {
      try {
        const next = await fetchOperationalContextsList(specialist);
        if (cancelled) return;
        setContexts(next.contexts);
        setRelevance(next.relevance);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(readableError(err, "Could not load operational contexts"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [master, specialist]);

  if (!master) return null;

  function relevanceFor(
    contextId: string,
    departmentCode: string
  ): RelevanceChoice {
    const row = relevance.find(
      (r) =>
        r.context_id === contextId && r.department_code === departmentCode
    );
    return row?.relevance ?? "UNSET";
  }

  async function reload() {
    const next = await fetchOperationalContextsList(specialist);
    setContexts(next.contexts);
    setRelevance(next.relevance);
  }

  async function onSave() {
    setBusy(true);
    setError(null);
    try {
      if (editingId) {
        await updateOperationalContext(specialist, editingId, {
          kind,
          title,
          start_date: startDate,
          end_date: endDate,
        });
      } else {
        await createOperationalContext(specialist, {
          kind,
          title,
          start_date: startDate,
          end_date: endDate,
        });
      }
      setEditingId(null);
      setTitle("");
      setStartDate("");
      setEndDate("");
      setKind("SEASON");
      await reload();
    } catch (err) {
      setError(readableError(err, "Save failed"));
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id: string) {
    if (!window.confirm("Delete this declared context?")) return;
    setBusy(true);
    setError(null);
    try {
      await deleteOperationalContext(specialist, id);
      if (editingId === id) setEditingId(null);
      await reload();
    } catch (err) {
      setError(readableError(err, "Delete failed"));
    } finally {
      setBusy(false);
    }
  }

  async function onRelevance(
    contextId: string,
    departmentCode: string,
    value: RelevanceChoice
  ) {
    setBusy(true);
    setError(null);
    try {
      await setOperationalContextRelevance(specialist, contextId, {
        department_code: departmentCode,
        relevance: value,
      });
      await reload();
    } catch (err) {
      setError(readableError(err, "Relevance update failed"));
    } finally {
      setBusy(false);
    }
  }

  function beginEdit(c: OperationalContextClient) {
    setEditingId(c.id);
    setKind(c.kind);
    setTitle(c.title);
    setStartDate(c.start_date);
    setEndDate(c.end_date);
  }

  return (
    <section className="rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-3">
      <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
        Seasonal Context
      </p>
      <p className="mt-1 text-xs text-slate-500">
        Master-declared seasons and events for this store. Source is always
        MASTER_ADMIN_DECLARED.
      </p>

      {loading ? (
        <p className="mt-2 text-sm text-slate-500">Loading…</p>
      ) : null}
      {error ? (
        <p className="mt-2 text-sm font-medium text-rose-300" role="alert">
          {error}
        </p>
      ) : null}

      <div className="mt-3 space-y-2">
        {declaredOnly.length === 0 && !loading ? (
          <p className="text-sm text-slate-500">
            No declared contexts yet. Empty is valid.
          </p>
        ) : null}
        {declaredOnly.map((c) => (
          <div
            key={c.id}
            className="rounded-lg border border-slate-800 bg-slate-900/60 px-2.5 py-2"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-slate-100">
                  {c.title}
                </p>
                <p className="font-mono text-[11px] text-slate-500">
                  {c.kind} · {c.start_date} → {c.end_date}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => beginEdit(c)}
                  className="min-h-9 rounded-lg border border-slate-600 px-2 text-xs font-semibold text-slate-200"
                >
                  Edit
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void onDelete(c.id)}
                  className="min-h-9 rounded-lg border border-rose-500/40 px-2 text-xs font-semibold text-rose-300"
                >
                  Delete
                </button>
              </div>
            </div>
            <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {STORE_DEPARTMENT_TEMPLATES.map((dept) => {
                const value = relevanceFor(c.id, dept.code);
                return (
                  <label
                    key={`${c.id}-${dept.code}`}
                    className="flex min-h-10 items-center justify-between gap-2 rounded-md border border-slate-800 px-2 text-xs"
                  >
                    <span className="truncate text-slate-300">{dept.name}</span>
                    <select
                      value={value}
                      disabled={busy}
                      onChange={(e) =>
                        void onRelevance(
                          c.id,
                          dept.code,
                          e.target.value as RelevanceChoice
                        )
                      }
                      className={`min-h-8 rounded border border-slate-700 bg-slate-950 px-1 font-mono text-[11px] ${
                        value === "UNSET"
                          ? "text-slate-500 italic"
                          : value === "NONE"
                            ? "text-slate-400"
                            : "text-emerald-300"
                      }`}
                    >
                      {RELEVANCE_OPTIONS.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt === "UNSET" ? "UNSET (no row)" : opt}
                        </option>
                      ))}
                    </select>
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 space-y-2 border-t border-slate-800 pt-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          {editingId ? "Edit context" : "Create context"}
        </p>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-slate-400">
            Kind
            <select
              value={kind}
              onChange={(e) =>
                setKind(e.target.value === "EVENT" ? "EVENT" : "SEASON")
              }
              className="mt-1 flex min-h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 text-sm text-slate-100"
            >
              <option value="SEASON">Season</option>
              <option value="EVENT">Event</option>
            </select>
          </label>
          <label className="col-span-2 text-xs text-slate-400 sm:col-span-1">
            Title
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Late Summer Transition"
              className="mt-1 flex min-h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 text-sm text-slate-100"
            />
          </label>
          <label className="text-xs text-slate-400">
            Start
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="mt-1 flex min-h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 text-sm text-slate-100"
            />
          </label>
          <label className="text-xs text-slate-400">
            End
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="mt-1 flex min-h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 text-sm text-slate-100"
            />
          </label>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={busy || !title.trim() || !startDate || !endDate}
            onClick={() => void onSave()}
            className="flex min-h-11 flex-1 items-center justify-center rounded-xl border border-emerald-500/40 text-sm font-semibold text-emerald-300 disabled:opacity-40"
          >
            {editingId ? "Save changes" : "Create declaration"}
          </button>
          {editingId ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setEditingId(null);
                setTitle("");
                setStartDate("");
                setEndDate("");
              }}
              className="min-h-11 rounded-xl border border-slate-600 px-3 text-sm text-slate-300"
            >
              Cancel
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
