"use client";

/**
 * Floor exception feed — presentation of this week's barriers.
 * Knowledge stays in GET /api/rotations/exceptions via fetchExceptionSummary.
 * Barriers are logged inline on the Floor checklist.
 */

import { useCallback, useEffect, useState } from "react";
import { HubIcon } from "@/components/hub/NavIcons";
import { formatBayTag } from "@/lib/store-ops/types";
import { fetchExceptionSummary } from "@/lib/store-ops/client";
import type { StoreSpecialist } from "@/lib/types";

type ExceptionRow = Awaited<
  ReturnType<typeof fetchExceptionSummary>
>["exceptions"][number];

type Props = {
  specialist: StoreSpecialist;
  refreshKey?: number;
};

export function ExceptionFeed({ specialist, refreshKey = 0 }: Props) {
  const [rows, setRows] = useState<ExceptionRow[]>([]);
  const [week, setWeek] = useState("");
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchExceptionSummary(specialist);
      setWeek(data.assigned_week || "");
      setRows(data.exceptions ?? []);
    } catch (err) {
      console.error("[ExceptionFeed] live exceptions failed", err);
    } finally {
      setLoading(false);
    }
  }, [specialist]);

  useEffect(() => {
    void reload();
  }, [reload, refreshKey]);

  return (
    <section className="glass-card mb-3 !p-3">
      <div className="mb-2">
        <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-accent">
          Exception feed
        </p>
        <p className="mt-0.5 text-[11px] text-zinc-500">
          {week ? `Week ${week}` : "This week"} · log a barrier on a bay above
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-zinc-400">Loading exceptions…</p>
      ) : rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-zinc-700 px-3 py-3 text-center text-sm text-zinc-500">
          No floor exceptions this week.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((row) => {
            const aisle = row.store_locations?.aisle ?? "—";
            const bay = row.store_locations?.bay;
            const dept =
              row.departments?.name ??
              row.departments?.code ??
              "Department";
            return (
              <li
                key={row.id}
                className="flex items-start gap-2 rounded-xl border border-rose-500/25 bg-rose-950/20 px-2.5 py-2"
              >
                <HubIcon
                  id="alert"
                  className="mt-0.5 h-4 w-4 shrink-0 text-rose-300"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-xs font-bold tracking-tight tabular-nums text-zinc-100">
                    {bay != null
                      ? formatBayTag({ aisle, bay })
                      : String(aisle)}
                  </p>
                  <p className="truncate text-[11px] text-rose-100/90">
                    {row.reason}
                    <span className="text-zinc-500"> · {dept}</span>
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
