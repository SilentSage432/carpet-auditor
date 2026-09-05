"use client";

/**
 * Master-only fiscal calendar coverage signal (FS-001A).
 * Presentation only — does not discover, import, or promote calendars.
 */

import { useEffect, useState } from "react";
import {
  fetchFiscalCoverage,
  type FiscalCoverageClient,
} from "@/lib/store-ops/client";
import { isMasterAdmin } from "@/lib/rbac";
import { readableError } from "@/lib/store-ops/errors";
import type { StoreSpecialist } from "@/lib/types";

type Props = {
  specialist: StoreSpecialist;
};

function formatDisplayDate(ymd: string | null | undefined): string {
  if (!ymd) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return ymd;
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const mo = Number(m[2]);
  const day = Number(m[3]);
  return `${months[mo - 1] ?? m[2]} ${day}, ${m[1]}`;
}

function statusTone(status: FiscalCoverageClient["status"]): string {
  if (status === "HEALTHY") return "text-emerald-300";
  if (status === "ATTENTION") return "text-amber-300";
  if (status === "URGENT") return "text-orange-300";
  return "text-rose-300";
}

export function FiscalCoverageCard({ specialist }: Props) {
  const master = isMasterAdmin(specialist);
  const [data, setData] = useState<FiscalCoverageClient | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!master) return;
    let cancelled = false;

    async function load() {
      try {
        const next = await fetchFiscalCoverage(specialist);
        if (cancelled) return;
        setData(next);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setData(null);
        setError(readableError(err, "Could not load fiscal coverage"));
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

  return (
    <section className="rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-3">
      <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
        Fiscal Calendar Coverage
      </p>

      {loading && !data ? (
        <p className="mt-2 text-sm text-slate-500">Loading coverage…</p>
      ) : null}

      {error ? (
        <p className="mt-2 text-sm font-medium text-rose-300" role="alert">
          {error}
        </p>
      ) : null}

      {data ? <CoverageBody data={data} /> : null}
    </section>
  );
}

function CoverageBody({ data }: { data: FiscalCoverageClient }) {
  const nextLabel = data.next_fiscal_year != null ? `FY${data.next_fiscal_year}` : "Next year";

  if (data.status === "EXPIRED") {
    return (
      <div className="mt-2 space-y-1.5">
        <p className={`text-sm font-semibold ${statusTone("EXPIRED")}`}>
          Fiscal calendar coverage expired
        </p>
        <p className="text-sm text-slate-300">
          Current fiscal context unavailable
        </p>
        <p className="text-xs text-slate-500">
          ISO rotation operations remain active
        </p>
        {data.next_fiscal_year != null && !data.next_fiscal_year_loaded ? (
          <p className="text-sm text-slate-400">
            {nextLabel} not loaded
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-1.5">
      {data.current_fiscal_year != null ? (
        <p className="text-base font-semibold text-slate-100">
          FY{data.current_fiscal_year}
        </p>
      ) : null}
      {data.coverage_end_date ? (
        <p className="text-sm text-slate-300">
          Authoritative through {formatDisplayDate(data.coverage_end_date)}
        </p>
      ) : null}

      {data.next_fiscal_year_loaded ? (
        <p className="text-sm text-emerald-300/90">
          {nextLabel} loaded
        </p>
      ) : (
        <p className="text-sm text-slate-400">
          {nextLabel} not loaded
        </p>
      )}

      {data.status === "ATTENTION" && data.days_remaining != null ? (
        <>
          <p className="text-sm text-amber-200">
            Coverage ends in {data.days_remaining} days
          </p>
          <p className="text-sm font-medium text-amber-300">
            Master review recommended
          </p>
        </>
      ) : null}

      {data.status === "URGENT" && data.days_remaining != null ? (
        <>
          <p className="text-sm text-orange-200">
            Coverage ends in {data.days_remaining} days
          </p>
          <p className="text-sm font-medium text-orange-300">
            Master action required
          </p>
        </>
      ) : null}

      <p className={`text-sm font-semibold ${statusTone(data.status)}`}>
        Coverage status: {data.status}
      </p>

      {data.current_source_type ? (
        <p className="text-xs text-slate-500">
          Current authority: {data.current_source_type}
        </p>
      ) : null}
    </div>
  );
}
