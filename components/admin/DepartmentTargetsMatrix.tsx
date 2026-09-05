"use client";

/**
 * Compact department weekly-bay target matrix.
 * Persistence: PATCH /api/departments via lib/store-ops/client.
 * Presentation only — department knowledge stays on the departments table.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchDepartments,
  updateDepartmentActive,
  updateDepartmentWeeklyTarget,
} from "@/lib/store-ops/client";
import { readableError } from "@/lib/store-ops/errors";
import { resolveWeeklyBayTarget } from "@/lib/store-ops/week";
import type { Department } from "@/lib/store-ops/types";
import { isMasterAdmin } from "@/lib/rbac";
import {
  hubScopeFromDeptCode,
  storeOpsDepartmentSortIndex,
} from "@/lib/store-ops/department-codes";
import type { StoreSpecialist } from "@/lib/types";
import { DepartmentIcon } from "@/components/hub/NavIcons";

type Props = {
  specialist: StoreSpecialist | null;
};

const DEFAULT_TARGET = 10;

export function DepartmentTargetsMatrix({ specialist }: Props) {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const master = isMasterAdmin(specialist);
  const canEdit = specialist?.role === "Supervisor" || master;

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
      setError(null);
    } catch (err) {
      console.error("[DepartmentTargetsMatrix] load failed", err);
      setDepartments([]);
      setDrafts({});
      setError(readableError(err, "Could not load live departments"));
    }
  }, [specialist, canEdit]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const dirtyIds = useMemo(() => {
    return departments
      .filter((dept) => {
        const draft = Number(drafts[dept.id]);
        const current = resolveWeeklyBayTarget(dept.weekly_bay_target);
        return Number.isFinite(draft) && draft !== current;
      })
      .map((d) => d.id);
  }, [departments, drafts]);

  if (!canEdit) return null;

  async function saveDepartment(dept: Department) {
    if (!specialist) return;
    if (dept.id.startsWith("fallback:")) return;
    const raw = drafts[dept.id] ?? String(DEFAULT_TARGET);
    const target = resolveWeeklyBayTarget(Number(raw));
    const current = resolveWeeklyBayTarget(dept.weekly_bay_target);
    if (target === current) return;
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
        `${updated.name} → ${resolveWeeklyBayTarget(updated.weekly_bay_target)}/wk`
      );
    } catch (err) {
      setError(
        readableError(err, "Save failed — could not update weekly bay target")
      );
    } finally {
      setBusyId(null);
    }
  }

  async function saveAll() {
    if (!specialist || dirtyIds.length === 0) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const updates = departments.filter(
        (d) => dirtyIds.includes(d.id) && !d.id.startsWith("fallback:")
      );
      const saved: Department[] = [];
      for (const dept of updates) {
        const target = resolveWeeklyBayTarget(Number(drafts[dept.id]));
        const updated = await updateDepartmentWeeklyTarget(
          specialist,
          target,
          master ? dept.id : undefined
        );
        saved.push(updated);
      }
      setDepartments((prev) =>
        prev.map((d) => saved.find((s) => s.id === d.id) ?? d)
      );
      setDrafts((prev) => {
        const next = { ...prev };
        for (const updated of saved) {
          next[updated.id] = String(
            resolveWeeklyBayTarget(updated.weekly_bay_target)
          );
        }
        return next;
      });
      setMessage(
        `Saved ${saved.length} target${saved.length === 1 ? "" : "s"}.`
      );
    } catch (err) {
      setError(readableError(err, "Could not save all targets"));
    } finally {
      setBusy(false);
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
          ? `${updated.name} on for weekly auto-stage`
          : `${updated.name} paused`
      );
    } catch (err) {
      setError(readableError(err, "Could not update department toggle"));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-accent">
          Department targets
        </h2>
        <p className="mt-1 text-sm text-zinc-400">
          {master
            ? "Weekly bay quotas for weekly auto-stage. Toggle pauses a department. Changes save on blur or Save All."
            : "How many bays Sunday should assign for your department (default 10)."}
        </p>
      </div>

      {departments.length === 0 ? (
        <p className="text-sm text-zinc-400">Loading departments…</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-zinc-800">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-950/80 font-mono text-[10px] font-bold uppercase tracking-wide text-zinc-500">
                <th className="px-2 py-2">Department</th>
                <th className="w-[4.5rem] px-1 py-2 text-center">/wk</th>
                {master ? (
                  <th className="w-12 px-1 py-2 text-center">On</th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {[...departments]
                .sort(
                  (a, b) =>
                    storeOpsDepartmentSortIndex(a.code) -
                    storeOpsDepartmentSortIndex(b.code)
                )
                .map((dept) => {
                const draft = drafts[dept.id] ?? String(DEFAULT_TARGET);
                const current = resolveWeeklyBayTarget(dept.weekly_bay_target);
                const dirty = Number(draft) !== current;
                const active = dept.is_active !== false;
                return (
                  <tr
                    key={dept.id}
                    className={`border-b border-zinc-800/80 last:border-0 ${
                      active ? "bg-zinc-950/40" : "bg-zinc-950/20 opacity-70"
                    }`}
                  >
                    <td className="px-2 py-1.5">
                      <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-zinc-100">
                        <DepartmentIcon
                          department={hubScopeFromDeptCode(dept.code)}
                          className="h-4 w-4 shrink-0 text-accent"
                          strokeWidth={1.75}
                        />
                        {dept.name}
                      </p>
                      <p className="font-mono text-[10px] text-zinc-500">
                        {dept.code}
                        {dirty ? " · unsaved" : ""}
                      </p>
                    </td>
                    <td className="px-1 py-1.5">
                      <label className="block">
                        <span className="sr-only">
                          Bays per week for {dept.name}
                        </span>
                        <input
                          type="number"
                          min={1}
                          max={500}
                          inputMode="numeric"
                          value={draft}
                          disabled={busy || busyId === dept.id}
                          onChange={(e) =>
                            setDrafts((prev) => ({
                              ...prev,
                              [dept.id]: e.target.value,
                            }))
                          }
                          onBlur={() => void saveDepartment(dept)}
                          className={`h-11 w-full rounded-lg border bg-zinc-900 px-1.5 text-center font-mono text-sm text-zinc-100 ${
                            dirty
                              ? "border-accent/50"
                              : "border-zinc-700"
                          }`}
                        />
                      </label>
                    </td>
                    {master ? (
                      <td className="px-1 py-1.5 text-center">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={active}
                          aria-label={`${dept.name} ${active ? "active" : "paused"}`}
                          disabled={busyId === dept.id || busy}
                          onClick={() => void toggleActive(dept)}
                          className={`relative mx-auto h-6 w-10 rounded-full transition ${
                            active ? "bg-accent" : "bg-zinc-600"
                          } disabled:opacity-60`}
                        >
                          <span
                            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${
                              active ? "left-[1.15rem]" : "left-0.5"
                            }`}
                          />
                        </button>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {dirtyIds.length > 0 ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void saveAll()}
          className="btn-primary-glow flex min-h-12 w-full items-center justify-center rounded-xl text-sm disabled:opacity-50"
        >
          {busy
            ? "Saving…"
            : `Save All Targets (${dirtyIds.length})`}
        </button>
      ) : null}

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
