"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { NavigationHub } from "@/components/hub/NavigationHub";
import { SessionGate } from "@/components/hub/SessionGate";
import { isMasterAdmin } from "@/lib/rbac";
import { fetchExceptionSummary } from "@/lib/store-ops/client";
import type { StoreSpecialist } from "@/lib/types";

type SummaryRow = Awaited<
  ReturnType<typeof fetchExceptionSummary>
>["summary"][number];
type ExceptionRow = Awaited<
  ReturnType<typeof fetchExceptionSummary>
>["exceptions"][number];

type Tab = "pending" | "verified" | "bottlenecks" | "all";

export default function ExceptionsAdminPage() {
  return (
    <SessionGate
      allow={isMasterAdmin}
      denyMessage="Exception log is restricted to Super Admin / Master Admin."
      denyHref="/dashboard"
      denyLinkLabel="Open Zebra dashboard"
    >
      {({ specialist, storeNumber, logout }) => (
        <ExceptionsBody
          specialist={specialist}
          storeNumber={storeNumber}
          logout={logout}
        />
      )}
    </SessionGate>
  );
}

function ExceptionsBody({
  specialist,
  storeNumber,
  logout,
}: {
  specialist: StoreSpecialist;
  storeNumber: string;
  logout: () => void;
}) {
  const [week, setWeek] = useState("");
  const [summary, setSummary] = useState<SummaryRow[]>([]);
  const [exceptions, setExceptions] = useState<ExceptionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("pending");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchExceptionSummary(specialist);
      setWeek(data.assigned_week || "");
      setSummary(data.summary ?? []);
      setExceptions(data.exceptions ?? []);
      if ((data.exceptions ?? []).length > 0) {
        setTab("bottlenecks");
      }
    } catch {
      setWeek("");
      setSummary([]);
      setExceptions([]);
      setError(null);
    } finally {
      setLoading(false);
    }
  }, [specialist]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const verified = summary.filter((s) => s.verified_this_week).length;
  const withExceptions = summary.filter((s) => s.exception_count > 0).length;
  const pendingRows = useMemo(
    () => summary.filter((s) => !s.verified_this_week),
    [summary]
  );
  const verifiedRows = useMemo(
    () => summary.filter((s) => s.verified_this_week),
    [summary]
  );

  const statusRows =
    tab === "pending"
      ? pendingRows
      : tab === "verified"
        ? verifiedRows
        : tab === "all"
          ? summary
          : [];

  return (
    <div className="flex min-h-dvh flex-col">
      <NavigationHub
        title="Exception Log"
        specialist={specialist}
        storeNumber={storeNumber}
        onLogout={logout}
      />

      <main className="mx-auto w-full max-w-lg flex-1 px-3 pb-28 pt-4">
        <section className="mb-3 rounded-2xl border-2 border-amber-400/50 bg-amber-950/30 px-4 py-3">
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-amber-300">
            Super Admin · Weekly verification
          </p>
          <p className="mt-1 text-lg font-bold text-slate-50">{week || "…"}</p>
          <p className="mt-1 text-sm text-slate-300">
            {verified}/{summary.length} verified · {withExceptions} with
            bottlenecks · {exceptions.length} rows
          </p>
        </section>

        {error ? (
          <p className="mb-3 rounded-xl border border-red-500/40 bg-red-950/40 px-3 py-2 text-sm text-red-200">
            {error}
          </p>
        ) : null}

        {loading ? (
          <p className="text-sm text-slate-400">Loading verification status…</p>
        ) : (
          <>
            <div
              role="tablist"
              aria-label="Exception views"
              className="mb-3 grid grid-cols-4 gap-1 rounded-xl border border-slate-700 bg-slate-950 p-1"
            >
              {(
                [
                  ["pending", `Pending (${pendingRows.length})`],
                  ["verified", `Verified (${verifiedRows.length})`],
                  ["bottlenecks", `Barriers (${exceptions.length})`],
                  ["all", "All"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={tab === id}
                  onClick={() => setTab(id)}
                  className={`min-h-10 rounded-lg px-1 text-[10px] font-bold uppercase tracking-wide ${
                    tab === id
                      ? "bg-amber-500/20 text-amber-100"
                      : "text-slate-400"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {tab === "bottlenecks" ? (
              exceptions.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-slate-700 px-4 py-6 text-center text-sm text-slate-400">
                  No exceptions logged for {week}.
                </p>
              ) : (
                <ul className="space-y-2">
                  {exceptions.map((ex) => (
                    <li
                      key={ex.id}
                      className="rounded-xl border border-amber-500/30 bg-slate-900/90 px-3 py-2.5"
                    >
                      <p className="text-sm font-bold text-slate-50">
                        {ex.departments?.name ?? "Department"}
                        {ex.store_locations
                          ? ` · A${ex.store_locations.aisle} B${ex.store_locations.bay}`
                          : ""}
                      </p>
                      <p className="mt-1 text-sm text-amber-200">{ex.reason}</p>
                      <p className="mt-1 font-mono text-[10px] text-slate-500">
                        Cycle {ex.cycle_number} ·{" "}
                        {new Date(ex.created_at).toLocaleString()}
                      </p>
                    </li>
                  ))}
                </ul>
              )
            ) : (
              <ul className="divide-y divide-slate-800 overflow-hidden rounded-xl border border-slate-700 bg-slate-900/80">
                {statusRows.length === 0 ? (
                  <li className="px-3 py-6 text-center text-sm text-slate-400">
                    No departments in this view.
                  </li>
                ) : (
                  statusRows.map((row) => {
                    const open = expandedId === row.department_id;
                    return (
                      <li key={row.department_id}>
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedId(open ? null : row.department_id)
                          }
                          className="flex min-h-12 w-full items-center gap-2 px-3 py-2 text-left"
                        >
                          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-50">
                            {row.department_name}
                          </span>
                          <span
                            className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[9px] font-bold ${
                              row.verified_this_week
                                ? "bg-emerald-500/20 text-emerald-300"
                                : "bg-slate-700 text-slate-300"
                            }`}
                          >
                            {row.verified_this_week ? "OK" : "PEND"}
                          </span>
                          {row.exception_count > 0 ? (
                            <span className="font-mono text-[10px] font-bold text-amber-300">
                              {row.exception_count}
                            </span>
                          ) : null}
                        </button>
                        {open ? (
                          <p className="border-t border-slate-800 px-3 py-2 text-xs text-slate-400">
                            {row.department_code} · target{" "}
                            {row.weekly_bay_target} · {row.total_rotations}{" "}
                            assigned
                            {row.exception_count > 0
                              ? ` · ${row.exception_count} bottleneck(s) · ${row.incomplete_rotations} open`
                              : row.verified_this_week
                                ? " · All clear"
                                : " · Awaiting verification"}
                          </p>
                        ) : null}
                      </li>
                    );
                  })
                )}
              </ul>
            )}
          </>
        )}
      </main>
    </div>
  );
}
