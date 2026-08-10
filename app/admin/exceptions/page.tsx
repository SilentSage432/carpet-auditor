"use client";

import { useCallback, useEffect, useState } from "react";
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

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchExceptionSummary(specialist);
      setWeek(data.assigned_week || "");
      setSummary(data.summary ?? []);
      setExceptions(data.exceptions ?? []);
    } catch {
      // No entries yet / fetch failure → show empty log (0/0 verified, 0 rows)
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

  return (
    <div className="flex min-h-dvh flex-col">
      <NavigationHub
        title="Exception Log"
        specialist={specialist}
        storeNumber={storeNumber}
        onLogout={logout}
      />

      <main className="mx-auto w-full max-w-lg flex-1 px-3 pb-28 pt-4">
        <section className="mb-4 rounded-2xl border-2 border-amber-400/50 bg-amber-950/30 px-4 py-3">
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-amber-300">
            Super Admin · Weekly verification
          </p>
          <p className="mt-1 text-lg font-bold text-slate-50">{week || "…"}</p>
          <p className="mt-1 text-sm text-slate-300">
            {verified}/{summary.length} departments verified · {withExceptions}{" "}
            with bottlenecks · {exceptions.length} exception rows
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
            <h2 className="mb-2 font-mono text-xs font-bold uppercase tracking-[0.14em] text-emerald-400">
              Department status
            </h2>
            <ul className="mb-6 space-y-2">
              {summary.map((row) => (
                <li
                  key={row.department_id}
                  className="rounded-2xl border border-slate-700 bg-slate-900/80 px-4 py-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-slate-50">
                        {row.department_name}
                      </p>
                      <p className="font-mono text-[11px] text-slate-400">
                        {row.department_code} · target {row.weekly_bay_target} ·{" "}
                        {row.total_rotations} assigned
                      </p>
                    </div>
                    <span
                      className={`shrink-0 rounded-lg px-2 py-1 font-mono text-[10px] font-bold ${
                        row.verified_this_week
                          ? "bg-emerald-500/20 text-emerald-300"
                          : "bg-slate-700 text-slate-300"
                      }`}
                    >
                      {row.verified_this_week ? "VERIFIED" : "PENDING"}
                    </span>
                  </div>
                  {row.exception_count > 0 ? (
                    <p className="mt-2 text-sm font-medium text-amber-300">
                      {row.exception_count} bottleneck
                      {row.exception_count === 1 ? "" : "s"} reported ·{" "}
                      {row.incomplete_rotations} still open
                    </p>
                  ) : row.verified_this_week ? (
                    <p className="mt-2 text-sm text-emerald-300/80">
                      All clear for this week
                    </p>
                  ) : (
                    <p className="mt-2 text-sm text-slate-500">
                      Awaiting supervisor verification
                    </p>
                  )}
                </li>
              ))}
            </ul>

            <h2 className="mb-2 font-mono text-xs font-bold uppercase tracking-[0.14em] text-amber-300">
              Reported bottlenecks
            </h2>
            {exceptions.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-slate-700 px-4 py-6 text-center text-sm text-slate-400">
                No exceptions logged for {week}.
              </p>
            ) : (
              <ul className="space-y-2">
                {exceptions.map((ex) => (
                  <li
                    key={ex.id}
                    className="rounded-2xl border border-amber-500/30 bg-slate-900/90 px-4 py-3"
                  >
                    <p className="text-sm font-bold text-slate-50">
                      {ex.departments?.name ?? "Department"}
                      {ex.store_locations
                        ? ` · Aisle ${ex.store_locations.aisle} Bay ${ex.store_locations.bay}`
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
            )}
          </>
        )}
      </main>
    </div>
  );
}
