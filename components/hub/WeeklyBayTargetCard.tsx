"use client";

import { useCallback, useEffect, useState } from "react";
import {
  fetchDepartments,
  updateDepartmentWeeklyTarget,
} from "@/lib/store-ops/client";
import { readableError } from "@/lib/store-ops/errors";
import type { Department } from "@/lib/store-ops/types";
import { isMasterAdmin } from "@/lib/rbac";
import type { StoreSpecialist } from "@/lib/types";

type Props = {
  specialist: StoreSpecialist | null;
};

/** Supervisor setting — weekly bay count used by Sunday rotation cron. */
export function WeeklyBayTargetCard({ specialist }: Props) {
  const [dept, setDept] = useState<Department | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [value, setValue] = useState("10");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canEdit =
    specialist?.role === "Supervisor" || isMasterAdmin(specialist);

  const reload = useCallback(async () => {
    if (!specialist || !canEdit) return;
    try {
      const list = await fetchDepartments(specialist);
      setDepartments(list);
      const first = list[0] ?? null;
      setDept(first);
      if (first) setValue(String(first.weekly_bay_target ?? 10));
    } catch (err) {
      setError(readableError(err, "Failed to load department"));
    }
  }, [specialist, canEdit]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (!canEdit) return null;

  async function save() {
    if (!specialist || !dept) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const updated = await updateDepartmentWeeklyTarget(
        specialist,
        Number(value),
        isMasterAdmin(specialist) ? dept.id : undefined
      );
      setDept(updated);
      setValue(String(updated.weekly_bay_target));
      setMessage(
        `Saved — ${updated.name} will queue ${updated.weekly_bay_target} bays each Sunday.`
      );
    } catch (err) {
      setError(readableError(err, "Save failed — could not update weekly bay target"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3 rounded-2xl border border-emerald-500/25 bg-slate-900/90 p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
        Weekly bay target
      </h2>
      <p className="text-sm text-slate-300">
        How many bays the Sunday rotation cron should assign for your department
        each week.
      </p>

      {isMasterAdmin(specialist) && departments.length > 1 ? (
        <label className="block text-sm">
          <span className="mb-1 block text-slate-400">Department</span>
          <select
            value={dept?.id ?? ""}
            onChange={(e) => {
              const next = departments.find((d) => d.id === e.target.value) ?? null;
              setDept(next);
              if (next) setValue(String(next.weekly_bay_target ?? 10));
            }}
            className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 text-slate-100"
          >
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} ({d.code})
              </option>
            ))}
          </select>
        </label>
      ) : dept ? (
        <p className="font-mono text-xs text-emerald-400/90">
          {dept.name} · {dept.code}
        </p>
      ) : (
        <p className="text-sm text-slate-400">Loading department…</p>
      )}

      <label className="block text-sm">
        <span className="mb-1 block text-slate-400">Bays per week</span>
        <input
          type="number"
          min={1}
          max={500}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 font-mono text-slate-100"
        />
      </label>

      <button
        type="button"
        disabled={busy || !dept}
        onClick={() => void save()}
        className="flex min-h-12 w-full items-center justify-center rounded-xl border border-emerald-500/40 text-sm font-semibold text-emerald-300 disabled:opacity-50"
      >
        {busy ? "Saving…" : "Save weekly target"}
      </button>

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
