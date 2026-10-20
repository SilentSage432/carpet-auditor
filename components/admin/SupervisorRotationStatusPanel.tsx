"use client";

/**
 * DEPTSYNC-SECTION-OWNERSHIP-005 — automatic rotation status for focused view.
 * Reuses 004 composition; does not publish or mutate capacity.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { StoreSpecialist } from "@/lib/types";
import { fetchStandingCapacityPolicy } from "@/lib/store-ops/client";
import { fetchSundayAssignments } from "@/lib/store-ops/sunday-audit";
import {
  DEFAULT_STORE_TIMEZONE,
  sundayStagingWeekLabel,
} from "@/lib/store-ops/sunday-schedule";
import {
  composeRotationVisibilityStatus,
  type RotationVisibilityStatus,
} from "@/lib/store-ops/supervisor-ownership-workflow";
import { isMasterAdmin } from "@/lib/rbac";

type Props = {
  specialist: StoreSpecialist;
};

export function SupervisorRotationStatusPanel({ specialist }: Props) {
  const router = useRouter();
  const master = isMasterAdmin(specialist);
  const [status, setStatus] = useState<RotationVisibilityStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const week = sundayStagingWeekLabel(new Date(), DEFAULT_STORE_TIMEZONE);
        let standing: {
          schema_ready: boolean;
          policy: Parameters<
            typeof composeRotationVisibilityStatus
          >[0]["standing"]["policy"];
        } = { schema_ready: false, policy: null };
        if (isMasterAdmin(specialist)) {
          try {
            const result = await fetchStandingCapacityPolicy(specialist);
            standing = {
              schema_ready: result.schema_ready,
              policy: result.policy,
            };
          } catch {
            standing = { schema_ready: false, policy: null };
          }
        }
        let publishedCount: number | null = null;
        try {
          const map = await fetchSundayAssignments(
            week,
            specialist.store_number
          );
          publishedCount = Object.values(map ?? {}).filter(
            (row) =>
              row &&
              String(row.status ?? "").toLowerCase() !== "cleared" &&
              String(row.specialist_id ?? "").trim()
          ).length;
        } catch {
          publishedCount = null;
        }
        if (cancelled) return;
        const next = composeRotationVisibilityStatus({
          upcoming_operational_week: week,
          standing,
          published_assignment_count: publishedCount,
        });
        if (!isMasterAdmin(specialist)) {
          next.summary_lines = next.summary_lines.map((line) =>
            /Standing capacity/i.test(line)
              ? "Standing capacity status is visible to MasterAdmin."
              : line
          );
        }
        setStatus(next);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof Error ? err.message : "Could not load rotation status"
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [specialist]);

  return (
    <div
      data-testid="supervisor-rotation-focused"
      className="space-y-3"
    >
      <div
        data-testid="workflow-rotation-status"
        className="space-y-1 rounded-xl border border-zinc-800 bg-zinc-950/50 px-3 py-2.5"
      >
        <p className="font-mono text-[10px] font-bold uppercase tracking-wide text-zinc-500">
          Rotation status
        </p>
        {error ? (
          <p className="text-[11px] text-rose-300" role="alert">
            {error}
          </p>
        ) : !status ? (
          <p className="text-[11px] text-zinc-500">Loading…</p>
        ) : (
          <ul className="space-y-1">
            {status.summary_lines.map((line) => (
              <li key={line} className="text-[11px] leading-snug text-zinc-300">
                {line}
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="text-[11px] leading-snug text-zinc-500">
        Scheduler enabled is not proof this week was published. This Week shows
        authoritative published work only.
      </p>

      <button
        type="button"
        data-testid="rotation-open-this-week"
        onClick={() => router.push("/dashboard")}
        className="flex min-h-11 w-full items-center justify-center rounded-xl border border-sky-500/40 bg-sky-950/30 px-3 text-sm font-semibold text-sky-100"
      >
        Open This Week
      </button>

      {master ? (
        <div className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2.5">
          <p className="text-[11px] leading-snug text-zinc-400">
            Standing capacity is established in the Sunday assignment drawer
            (MasterAdmin). It is not changed from this status view.
          </p>
          <button
            type="button"
            data-testid="rotation-open-sunday-audit"
            onClick={() => router.push("/sunday-audit")}
            className="flex min-h-11 w-full items-center justify-center rounded-xl border border-zinc-600/50 bg-zinc-900/70 px-3 text-sm font-semibold text-zinc-100"
          >
            Open Sunday assignment
          </button>
        </div>
      ) : null}
    </div>
  );
}
