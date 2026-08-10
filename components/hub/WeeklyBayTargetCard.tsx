"use client";

import { useCallback, useEffect, useState } from "react";
import {
  fetchDepartments,
  updateDepartmentActive,
  updateDepartmentWeeklyTarget,
} from "@/lib/store-ops/client";
import { readableError } from "@/lib/store-ops/errors";
import { resolveWeeklyBayTarget } from "@/lib/store-ops/week";
import type { Department } from "@/lib/store-ops/types";
import { isMasterAdmin } from "@/lib/rbac";
import type { StoreSpecialist } from "@/lib/types";

type Props = {
  specialist: StoreSpecialist | null;
};

const DEFAULT_TARGET = 10;

/** Settings — per-department weekly bay count + Super Admin master toggles. */
export function WeeklyBayTargetCard({ specialist }: Props) {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const master = isMasterAdmin(specialist);
  const canEdit =
    specialist?.role === "Supervisor" || master;

  const reload = useCallback(async () => {
    if (!specialist || !canEdit) return;
    try {
      const list = await fetchDepartments(specialist);
      setDepartments(list);
      const nextDrafts: Record<string, string> = {};
      for (const d of list) {
        nextDrafts[d.id] = String(
          resolveWeeklyBayTarget(d.weekly_bay_target ?? DEFAULT_TARGET)
        );
      }
      setDrafts(nextDrafts);
    } catch (err) {
      setError(readableError(err, "Failed to load department targets"));
    }
  }, [specialist, canEdit]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (!canEdit) return null;

  async function saveDepartment(dept: Department) {
    if (!specialist) return;
    const raw = drafts[dept.id] ?? String(DEFAULT_TARGET);
    const target = resolveWeeklyBayTarget(Number(raw));
    setBusyId(dept.id);
    setError(null);
    setMessage(null);
    try {
      const updated = await updateDepartmentWeeklyTarget(
        specialist,
        target,
        master ? dept.id : undefined
      );
      setDepartments((prev) =>
        prev.map((d) => (d.id === updated.id ? updated : d))
      );
      setDrafts((prev) => ({
        ...prev,
        [updated.id]: String(
          resolveWeeklyBayTarget(updated.weekly_bay_target)
        ),
      }));
      setMessage(
        `Saved — ${updated.name} will queue ${resolveWeeklyBayTarget(
          updated.weekly_bay_target
        )} bays each Sunday.`
      );
    } catch (err) {
      setError(
        readableError(err, "Save failed — could not update weekly bay target")
      );
    } finally {
      setBusyId(null);
    }
  }

  async function toggleActive(dept: Department) {
    if (!specialist || !master) return;
    setBusyId(dept.id);
    setError(null);
    setMessage(null);
    try {
      const updated = await updateDepartmentActive(
        specialist,
        dept.id,
        !dept.is_active
      );
      setDepartments((prev) =>
        prev.map((d) => (d.id === updated.id ? updated : d))
      );
      setMessage(
        updated.is_active
          ? `${updated.name} activated — Sunday cron will include it.`
          : `${updated.name} paused — Sunday cron will skip it.`
      );
    } catch (err) {
      setError(readableError(err, "Could not update department toggle"));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="space-y-3 rounded-2xl border border-emerald-500/25 bg-slate-900/90 p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
        {master ? "Department Overview" : "Department weekly bay targets"}
      </h2>
      <p className="text-sm text-slate-300">
        {master
          ? "Master toggles pause departments for Sunday cron and force draws. Weekly bay targets still drive adaptive aisle picks when a department is active."
          : "How many bays the Sunday rotation cron should assign for your department each week (default 10 if unset)."}
      </p>

      {departments.length === 0 ? (
        <p className="text-sm text-slate-400">Loading departments…</p>
      ) : (
        <ul className="space-y-3">
          {departments.map((dept) => {
            const draft = drafts[dept.id] ?? String(DEFAULT_TARGET);
            const current = resolveWeeklyBayTarget(dept.weekly_bay_target);
            const dirty = Number(draft) !== current;
            const active = dept.is_active !== false;
            return (
              <li
                key={dept.id}
                className={`rounded-xl border p-3 ${
                  active
                    ? "border-slate-800 bg-slate-950/60"
                    : "border-slate-800/80 bg-slate-950/40 opacity-80"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-50">
                      {dept.name}
                    </p>
                    <p className="font-mono text-[11px] text-slate-500">
                      {dept.code} · stored {current}/week
                      {master
                        ? active
                          ? " · active"
                          : " · paused"
                        : ""}
                    </p>
                  </div>
                  {master ? (
                    <button
                      type="button"
                      role="switch"
                      aria-checked={active}
                      aria-label={`${dept.name} ${active ? "active" : "paused"}`}
                      disabled={busyId === dept.id}
                      onClick={() => void toggleActive(dept)}
                      className={`relative h-7 w-12 shrink-0 rounded-full transition ${
                        active ? "bg-emerald-500" : "bg-slate-600"
                      } disabled:opacity-60`}
                    >
                      <span
                        className={`absolute top-0.5 h-6 w-6 rounded-full bg-white transition ${
                          active ? "left-[1.35rem]" : "left-0.5"
                        }`}
                      />
                    </button>
                  ) : null}
                </div>
                <div className="mt-3 flex gap-2">
                  <label className="min-w-0 flex-1 text-sm">
                    <span className="sr-only">Bays per week for {dept.name}</span>
                    <input
                      type="number"
                      min={1}
                      max={500}
                      inputMode="numeric"
                      value={draft}
                      onChange={(e) =>
                        setDrafts((prev) => ({
                          ...prev,
                          [dept.id]: e.target.value,
                        }))
                      }
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 font-mono text-slate-100"
                    />
                  </label>
                  <button
                    type="button"
                    disabled={busyId === dept.id || !dirty}
                    onClick={() => void saveDepartment(dept)}
                    className="min-h-12 shrink-0 rounded-xl border border-emerald-500/40 px-4 text-sm font-semibold text-emerald-300 disabled:opacity-50"
                  >
                    {busyId === dept.id ? "…" : "Save"}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {message ? (
        <p className="text-sm font-medium text-emerald-300" role="status">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="text-sm font-medium text-red-300" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
