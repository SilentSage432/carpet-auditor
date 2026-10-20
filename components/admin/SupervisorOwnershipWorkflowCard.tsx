"use client";

/**
 * DEPTSYNC-SECTION-OWNERSHIP-004/005 — schedule-free supervisor workflow hub.
 * Open actions navigate to focused manage views (005) — never page-anchor scrolling.
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
  COVERAGE_CAPACITY_EXPLAINER,
  composeRotationVisibilityStatus,
  type RotationVisibilityStatus,
} from "@/lib/store-ops/supervisor-ownership-workflow";
import {
  supervisorManageHref,
  type SupervisorManageView,
} from "@/lib/store-ops/supervisor-management-nav";
import { canManageOperationalSections, isMasterAdmin } from "@/lib/rbac";

type Props = {
  specialist: StoreSpecialist;
  /** Optional override (tests). Default navigates via /settings?manage=. */
  onOpenManage?: (view: SupervisorManageView) => void;
};

export function SupervisorOwnershipWorkflowCard({
  specialist,
  onOpenManage,
}: Props) {
  const router = useRouter();
  const canSections = canManageOperationalSections(specialist);
  const master = isMasterAdmin(specialist);
  const [status, setStatus] = useState<RotationVisibilityStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  function openManage(view: SupervisorManageView) {
    if (onOpenManage) {
      onOpenManage(view);
      return;
    }
    router.push(supervisorManageHref(view));
  }

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

  const isPreview =
    String(process.env.NEXT_PUBLIC_VERCEL_ENV ?? "").toLowerCase() ===
    "preview";

  return (
    <section
      data-testid="supervisor-ownership-workflow"
      className="space-y-3 rounded-2xl border border-sky-500/25 bg-slate-900/90 p-4"
    >
      {isPreview ? (
        <p
          data-testid="preview-read-only-banner"
          className="rounded-lg border border-amber-500/40 bg-amber-950/40 px-2.5 py-2 text-[11px] leading-snug text-amber-100"
        >
          Preview is read-only against production data. You can review Team,
          ownership, coverage UI, and rotation status — saves and publication
          actions are blocked.
        </p>
      ) : null}
      <div>
        <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-sky-300">
          Supervisor workflow
        </p>
        <p className="mt-1 text-[11px] leading-snug text-zinc-400">
          Team → permanent ownership → temporary weekly coverage → automatic
          rotation. Each Open opens a focused view. Shifts are not required.
        </p>
      </div>

      <ol className="space-y-2">
        <li>
          <button
            type="button"
            data-testid="workflow-open-team"
            onClick={() => openManage("team")}
            className="flex min-h-11 w-full items-center justify-between gap-2 rounded-xl border border-zinc-700/80 bg-zinc-950/60 px-3 text-left"
          >
            <span>
              <span className="block text-sm font-semibold text-zinc-100">
                1. Team
              </span>
              <span className="block text-[11px] text-zinc-500">
                {master
                  ? "Active / inactive associates · schedule-free lifecycle"
                  : "People roster · lifecycle changes need MasterAdmin"}
              </span>
            </span>
            <span className="font-mono text-[10px] text-sky-300">Open</span>
          </button>
        </li>
        <li>
          <button
            type="button"
            data-testid="workflow-open-sections"
            disabled={!canSections}
            onClick={() => openManage("ownership")}
            className="flex min-h-11 w-full items-center justify-between gap-2 rounded-xl border border-zinc-700/80 bg-zinc-950/60 px-3 text-left disabled:opacity-40"
          >
            <span>
              <span className="block text-sm font-semibold text-zinc-100">
                2. Permanent ownership
              </span>
              <span className="block text-[11px] text-zinc-500">
                Who owns each Operational Section
              </span>
            </span>
            <span className="font-mono text-[10px] text-sky-300">Open</span>
          </button>
        </li>
        <li>
          <button
            type="button"
            data-testid="workflow-open-coverage"
            disabled={!canSections}
            onClick={() => openManage("coverage")}
            className="flex min-h-11 w-full items-center justify-between gap-2 rounded-xl border border-amber-500/30 bg-amber-950/20 px-3 text-left disabled:opacity-40"
          >
            <span>
              <span className="block text-sm font-semibold text-amber-50">
                3. Temporary weekly coverage
              </span>
              <span className="block text-[11px] leading-snug text-amber-100/70">
                {COVERAGE_CAPACITY_EXPLAINER}
              </span>
            </span>
            <span className="font-mono text-[10px] text-amber-200">Open</span>
          </button>
        </li>
        <li>
          <button
            type="button"
            data-testid="workflow-open-this-week"
            onClick={() => openManage("rotation")}
            className="flex min-h-11 w-full items-center justify-between gap-2 rounded-xl border border-zinc-700/80 bg-zinc-950/60 px-3 text-left"
          >
            <span>
              <span className="block text-sm font-semibold text-zinc-100">
                4. Automatic rotation
              </span>
              <span className="block text-[11px] text-zinc-500">
                Status, standing capacity, and This Week
              </span>
            </span>
            <span className="font-mono text-[10px] text-sky-300">Open</span>
          </button>
        </li>
      </ol>

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
    </section>
  );
}
