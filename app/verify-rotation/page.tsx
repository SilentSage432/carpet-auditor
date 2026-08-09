"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { NavigationHub } from "@/components/hub/NavigationHub";
import { SessionGate } from "@/components/hub/SessionGate";
import { actorFromSpecialist } from "@/lib/store-ops/auth";
import {
  fetchDepartments,
  fetchThisWeekRotations,
  verifyWeeklyRotationBatch,
} from "@/lib/store-ops/client";
import {
  formatLocationLabel,
  type Department,
  type WeeklyRotationWithLocation,
} from "@/lib/store-ops/types";
import { EXCEPTION_REASONS } from "@/lib/store-ops/verification";
import type { StoreSpecialist } from "@/lib/types";

export default function VerifyRotationPage() {
  return (
    <SessionGate
      allow={(m) => Boolean(actorFromSpecialist(m))}
      denyMessage="Verification is for department supervisors and Master Admin."
    >
      {({ specialist, storeNumber, logout }) => (
        <VerifyBody
          specialist={specialist}
          storeNumber={storeNumber}
          logout={logout}
        />
      )}
    </SessionGate>
  );
}

function VerifyBody({
  specialist,
  storeNumber,
  logout,
}: {
  specialist: StoreSpecialist;
  storeNumber: string;
  logout: () => void;
}) {
  const [week, setWeek] = useState("");
  const [rotations, setRotations] = useState<WeeklyRotationWithLocation[]>([]);
  const [department, setDepartment] = useState<Department | null>(null);
  const [loading, setLoading] = useState(true);
  const [reportMode, setReportMode] = useState(false);
  /** Rotation IDs treated as incomplete when reportMode is on (default: none) */
  const [incompleteIds, setIncompleteIds] = useState<Set<string>>(new Set());
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rotData, depts] = await Promise.all([
        fetchThisWeekRotations(specialist),
        fetchDepartments(specialist),
      ]);
      setWeek(rotData.assigned_week);
      setRotations(rotData.rotations);
      setDepartment(depts[0] ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load week");
    } finally {
      setLoading(false);
    }
  }, [specialist]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const openRotations = useMemo(
    () => rotations.filter((r) => !r.is_completed),
    [rotations]
  );
  const doneRotations = useMemo(
    () => rotations.filter((r) => r.is_completed),
    [rotations]
  );

  function toggleIncomplete(id: string) {
    setIncompleteIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit(confirmAll: boolean) {
    if (!department) {
      setError("Department not found");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      let completedIds: string[];
      let incomplete: Array<{
        rotation_id: string;
        location_id: string;
        reason: string;
        cycle_number: number;
      }>;

      if (confirmAll) {
        completedIds = openRotations.map((r) => r.id);
        incomplete = [];
      } else {
        incomplete = openRotations
          .filter((r) => incompleteIds.has(r.id))
          .map((r) => ({
            rotation_id: r.id,
            location_id: r.location_id,
            reason: reasons[r.id] || "Other",
            cycle_number: r.store_locations?.cycle_number ?? 1,
          }));
        completedIds = openRotations
          .filter((r) => !incompleteIds.has(r.id))
          .map((r) => r.id);
      }

      for (const item of incomplete) {
        if (!item.reason.trim()) {
          throw new Error("Choose a reason for each incomplete bay");
        }
      }

      const result = await verifyWeeklyRotationBatch(specialist, {
        department_id: department.id,
        assigned_week: week,
        completed_rotation_ids: completedIds,
        incomplete,
      });

      setMessage(
        `Verified — ${result.completed_count} completed, ${result.exception_count} carried over.`
      );
      setReportMode(false);
      setIncompleteIds(new Set());
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <NavigationHub
        title="Verify Rotation"
        specialist={specialist}
        storeNumber={storeNumber}
        onLogout={logout}
      />

      <main className="mx-auto w-full max-w-lg flex-1 px-3 pb-28 pt-4">
        <section className="mb-4 rounded-2xl border border-emerald-500/30 bg-emerald-950/30 px-4 py-3">
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-400">
            End-of-week verification
          </p>
          <p className="mt-1 text-lg font-bold text-slate-50">
            {department?.name ?? "Department"} · {week || "…"}
          </p>
          <p className="mt-1 text-sm text-slate-400">
            Weekly bay target:{" "}
            <span className="font-mono font-semibold text-amber-200">
              {department?.weekly_bay_target ?? "—"}
            </span>
            {" · "}
            {doneRotations.length}/{rotations.length} already checked on floor
          </p>
        </section>

        {error ? (
          <p className="mb-3 rounded-xl border border-red-500/40 bg-red-950/40 px-3 py-2 text-sm text-red-200">
            {error}
          </p>
        ) : null}
        {message ? (
          <p className="mb-3 rounded-xl border border-emerald-500/40 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-200">
            {message}
          </p>
        ) : null}

        {loading ? (
          <p className="text-sm text-slate-400">Loading this week&apos;s bays…</p>
        ) : openRotations.length === 0 && doneRotations.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-slate-700 px-4 py-8 text-center text-sm text-slate-400">
            No bays assigned this week yet.
          </p>
        ) : (
          <>
            <label className="mb-4 flex min-h-14 items-center justify-between gap-3 rounded-2xl border border-slate-700 bg-slate-900/80 px-4">
              <span className="text-sm font-semibold text-slate-100">
                Report Incomplete Bays
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={reportMode}
                onClick={() => {
                  setReportMode((v) => !v);
                  setIncompleteIds(new Set());
                }}
                className={`relative h-8 w-14 rounded-full transition ${
                  reportMode ? "bg-amber-500" : "bg-slate-600"
                }`}
              >
                <span
                  className={`absolute top-1 h-6 w-6 rounded-full bg-white transition ${
                    reportMode ? "left-7" : "left-1"
                  }`}
                />
              </button>
            </label>

            {reportMode ? (
              <p className="mb-3 text-sm text-amber-200/90">
                Uncheck any bay that was not finished, then pick a reason. Those
                bays are marked CARRIED_OVER and prioritized next week.
              </p>
            ) : null}

            <ul className="mb-4 space-y-2">
              {openRotations.map((rotation) => {
                const loc = rotation.store_locations;
                const label = loc
                  ? formatLocationLabel(loc)
                  : rotation.location_id.slice(0, 8);
                const markedIncomplete = incompleteIds.has(rotation.id);
                return (
                  <li
                    key={rotation.id}
                    className="rounded-2xl border border-slate-700 bg-slate-900/90 px-4 py-3"
                  >
                    {reportMode ? (
                      <>
                        <label className="flex min-h-12 items-center gap-3">
                          <input
                            type="checkbox"
                            checked={!markedIncomplete}
                            onChange={() => toggleIncomplete(rotation.id)}
                            className="h-6 w-6 accent-emerald-500"
                          />
                          <span className="font-mono text-sm font-bold text-slate-50">
                            {label}
                          </span>
                        </label>
                        {markedIncomplete ? (
                          <select
                            value={reasons[rotation.id] ?? ""}
                            onChange={(e) =>
                              setReasons((prev) => ({
                                ...prev,
                                [rotation.id]: e.target.value,
                              }))
                            }
                            className="mt-2 w-full rounded-xl border border-amber-500/40 bg-slate-950 px-3 py-3 text-sm text-slate-100"
                          >
                            <option value="">Select reason…</option>
                            {EXCEPTION_REASONS.map((r) => (
                              <option key={r} value={r}>
                                {r}
                              </option>
                            ))}
                          </select>
                        ) : null}
                      </>
                    ) : (
                      <p className="font-mono text-sm font-bold text-slate-50">
                        {label}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>

            {doneRotations.length > 0 ? (
              <div className="mb-4 opacity-60">
                <p className="mb-2 font-mono text-[10px] font-bold uppercase tracking-wide text-slate-500">
                  Already completed on floor
                </p>
                <ul className="space-y-1">
                  {doneRotations.map((r) => (
                    <li
                      key={r.id}
                      className="rounded-xl border border-slate-800 px-3 py-2 font-mono text-xs text-slate-400 line-through"
                    >
                      {r.store_locations
                        ? formatLocationLabel(r.store_locations)
                        : r.location_id.slice(0, 8)}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="grid gap-2">
              {!reportMode ? (
                <button
                  type="button"
                  disabled={busy || (openRotations.length === 0 && doneRotations.length === 0)}
                  onClick={() => void submit(true)}
                  className="flex min-h-14 items-center justify-center rounded-xl bg-emerald-500 px-4 text-base font-bold text-slate-950 disabled:opacity-50"
                >
                  {busy
                    ? "Saving…"
                    : openRotations.length === 0
                      ? "Confirm Week Verified"
                      : "Confirm All Completed"}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void submit(false)}
                  className="flex min-h-14 items-center justify-center rounded-xl bg-amber-500 px-4 text-base font-bold text-slate-950 disabled:opacity-50"
                >
                  {busy
                    ? "Saving…"
                    : `Submit Verification (${incompleteIds.size} incomplete)`}
                </button>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
