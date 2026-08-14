"use client";

/**
 * Zebra floor checklist — optimistic bay complete, next-bay pulse,
 * Selling/Topstock filter, Sunday assignment handoff, one-tap barriers.
 * Completions owned by /api/rotations/complete; assignments by sunday-audit.
 */

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { AuditLocationModeToggle } from "@/components/store-ops/AuditLocationModeToggle";
import { BarrierReasonChips } from "@/components/store-ops/BarrierReasonChips";
import { formatAuditLocationBadge } from "@/lib/store-ops/audit-location-mode";
import {
  completeRotation,
  reportRotationBarriers,
} from "@/lib/store-ops/client";
import {
  fetchSundayAssignments,
  isSundayAssignmentForSpecialist,
  partitionRotationsBySundayAssignment,
  subscribeSundayBayAssignments,
  SUNDAY_AUDIT_EVENT,
  type SundayAssignmentMap,
} from "@/lib/store-ops/sunday-audit";
import { getStoreNumber } from "@/lib/store";
import {
  formatLocationLabel,
  type ExceptionReason,
  type StoreLocationType,
  type WeeklyRotationWithLocation,
} from "@/lib/store-ops/types";
import type { StoreSpecialist } from "@/lib/types";
import { hapticPulse } from "@/utils/haptics";

export type ZebraChecklistProps = {
  specialist: StoreSpecialist;
  assignedWeek: string;
  rotations: WeeklyRotationWithLocation[];
  onRefresh: () => void;
};

type TypeFilter = StoreLocationType | "all";

export function ZebraChecklist({
  specialist,
  assignedWeek,
  rotations,
  onRefresh,
}: ZebraChecklistProps) {
  const [error, setError] = useState<string | null>(null);
  const [doneOpen, setDoneOpen] = useState(false);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [assignments, setAssignments] = useState<SundayAssignmentMap>({});
  const [completedOverlay, setCompletedOverlay] = useState<Set<string>>(
    () => new Set()
  );
  const [pulseId, setPulseId] = useState<string | null>(null);
  const [barrierId, setBarrierId] = useState<string | null>(null);
  const [barrierBusy, setBarrierBusy] = useState(false);
  const [barrierOverlay, setBarrierOverlay] = useState<Set<string>>(
    () => new Set()
  );
  const [, startTransition] = useTransition();

  const loadAssignments = useCallback(async () => {
    if (!assignedWeek) {
      setAssignments({});
      return;
    }
    try {
      const map = await fetchSundayAssignments(assignedWeek, getStoreNumber());
      setAssignments(map);
    } catch {
      setAssignments({});
    }
  }, [assignedWeek]);

  useEffect(() => {
    void loadAssignments();
  }, [loadAssignments]);

  useEffect(() => {
    function onSunday() {
      void loadAssignments();
      onRefresh();
    }
    window.addEventListener(SUNDAY_AUDIT_EVENT, onSunday);
    const store = getStoreNumber();
    const unsub = subscribeSundayBayAssignments(store, assignedWeek, () => {
      void loadAssignments();
      onRefresh();
    });
    return () => {
      window.removeEventListener(SUNDAY_AUDIT_EVENT, onSunday);
      unsub();
    };
  }, [assignedWeek, loadAssignments, onRefresh]);

  useEffect(() => {
    setCompletedOverlay((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set<string>();
      for (const id of prev) {
        const row = rotations.find((r) => r.id === id);
        if (row && !row.is_completed) next.add(id);
      }
      return next.size === prev.size ? prev : next;
    });
  }, [rotations]);

  const visible = useMemo(() => {
    const overlayed = rotations
      .filter((r) => !barrierOverlay.has(r.id))
      .map((r) =>
        completedOverlay.has(r.id)
          ? {
              ...r,
              is_completed: true,
              completed_at: r.completed_at ?? new Date().toISOString(),
            }
          : r
      );
    if (typeFilter === "all") return overlayed;
    return overlayed.filter(
      (r) => (r.store_locations?.type ?? "SELLING") === typeFilter
    );
  }, [rotations, completedOverlay, barrierOverlay, typeFilter]);

  const open = useMemo(
    () => visible.filter((r) => !r.is_completed),
    [visible]
  );
  const done = useMemo(
    () => visible.filter((r) => r.is_completed),
    [visible]
  );

  const partition = useMemo(
    () => partitionRotationsBySundayAssignment(open, assignments, specialist),
    [open, assignments, specialist]
  );

  const orderedOpen = useMemo(() => {
    if (!partition.hasPersonalQueue) return open;
    return [
      ...partition.assignedToMe,
      ...partition.unassigned,
      ...partition.assignedToOthers,
    ];
  }, [open, partition]);

  function handleCheck(rotationId: string) {
    setError(null);
    const remaining = orderedOpen.filter((r) => r.id !== rotationId);
    const nextBay = remaining[0]?.id ?? null;
    setCompletedOverlay((prev) => {
      const next = new Set(prev);
      next.add(rotationId);
      return next;
    });
    setPulseId(nextBay);
    setBarrierId((id) => (id === rotationId ? null : id));
    hapticPulse("success");
    startTransition(async () => {
      try {
        await completeRotation(specialist, rotationId);
        onRefresh();
      } catch (err) {
        setCompletedOverlay((prev) => {
          const next = new Set(prev);
          next.delete(rotationId);
          return next;
        });
        setPulseId(null);
        setError(err instanceof Error ? err.message : "Could not complete bay");
        onRefresh();
      }
    });
  }

  async function handleBarrier(
    rotation: WeeklyRotationWithLocation,
    reason: ExceptionReason
  ) {
    const locationId =
      rotation.location_id || rotation.store_locations?.id || "";
    if (!locationId) {
      setError("Bay location is missing");
      return;
    }
    setBarrierBusy(true);
    setError(null);
    try {
      await reportRotationBarriers(specialist, {
        department_id: rotation.department_id,
        assigned_week: assignedWeek,
        incomplete: [
          {
            rotation_id: rotation.id,
            location_id: locationId,
            reason,
            cycle_number: rotation.store_locations?.cycle_number ?? 1,
          },
        ],
      });
      hapticPulse("medium");
      setBarrierOverlay((prev) => {
        const next = new Set(prev);
        next.add(rotation.id);
        return next;
      });
      setBarrierId(null);
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not log barrier");
    } finally {
      setBarrierBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-emerald-500/30 bg-emerald-950/30 px-4 py-3">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-400">
          This Week&apos;s Assigned Rotation
        </p>
        <p className="mt-1 font-mono text-lg font-bold text-slate-50">
          {assignedWeek || "No week assigned"}
        </p>
        <p className="text-sm text-slate-400">
          {open.length} remaining · {done.length} complete
          {partition.hasPersonalQueue
            ? ` · ${partition.assignedToMe.length} assigned to you`
            : ""}
        </p>
      </div>

      <AuditLocationModeToggle
        value={typeFilter}
        onChange={setTypeFilter}
        includeAll
        legend="Selling vs Topstock"
      />

      {error ? (
        <p className="rounded-xl border border-red-500/40 bg-red-950/40 px-3 py-2 text-sm text-red-200">
          {error}
        </p>
      ) : null}

      {open.length === 0 && done.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-700 px-4 py-8 text-center text-sm text-slate-400">
          No bays assigned this week. Ask Master Admin to generate the weekly
          rotation.
        </p>
      ) : null}

      {partition.hasPersonalQueue ? (
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-300">
          Your Sunday bays first · live handoff
        </p>
      ) : null}

      <ul className="divide-y divide-slate-800 overflow-hidden rounded-xl border border-slate-700 bg-slate-900/90">
        {orderedOpen.map((rotation) => (
          <ZebraBayRow
            key={rotation.id}
            rotation={rotation}
            assignmentLabel={assignmentCaption(
              assignments[rotation.id],
              specialist
            )}
            assignedToMe={isSundayAssignmentForSpecialist(
              assignments[rotation.id],
              specialist
            )}
            pulsing={pulseId === rotation.id}
            barrierOpen={barrierId === rotation.id}
            barrierBusy={barrierBusy}
            onToggleBarrier={() =>
              setBarrierId((id) => (id === rotation.id ? null : rotation.id))
            }
            onComplete={() => handleCheck(rotation.id)}
            onBarrier={(reason) => void handleBarrier(rotation, reason)}
          />
        ))}
      </ul>

      {done.length > 0 ? (
        <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950/50">
          <button
            type="button"
            aria-expanded={doneOpen}
            onClick={() => setDoneOpen((o) => !o)}
            className="flex min-h-11 w-full items-center justify-between px-3 text-left font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500"
          >
            Completed ({done.length}) · cool-down locked
            <span aria-hidden>{doneOpen ? "▲" : "▼"}</span>
          </button>
          {doneOpen ? (
            <ul className="divide-y divide-slate-800 border-t border-slate-800 opacity-60">
              {done.map((rotation) => {
                const loc = rotation.store_locations;
                const label = loc
                  ? formatLocationLabel(loc)
                  : rotation.location_id.slice(0, 8);
                return (
                  <li
                    key={rotation.id}
                    className="flex min-h-10 items-center gap-3 px-3 py-1.5"
                  >
                    <input
                      type="checkbox"
                      checked
                      disabled
                      readOnly
                      className="h-4 w-4 accent-emerald-600"
                    />
                    <span className="truncate font-mono text-sm text-slate-400 line-through">
                      {label}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function assignmentCaption(
  assignment: SundayAssignmentMap[string] | undefined,
  specialist: StoreSpecialist
): string | null {
  if (!assignment) return null;
  if (isSundayAssignmentForSpecialist(assignment, specialist)) {
    return "Assigned to you";
  }
  return assignment.specialist_name || "Assigned";
}

function ZebraBayRow({
  rotation,
  assignmentLabel,
  assignedToMe,
  pulsing,
  barrierOpen,
  barrierBusy,
  onToggleBarrier,
  onComplete,
  onBarrier,
}: {
  rotation: WeeklyRotationWithLocation;
  assignmentLabel: string | null;
  assignedToMe: boolean;
  pulsing: boolean;
  barrierOpen: boolean;
  barrierBusy: boolean;
  onToggleBarrier: () => void;
  onComplete: () => void;
  onBarrier: (reason: ExceptionReason) => void;
}) {
  const loc = rotation.store_locations;
  const label = loc
    ? formatLocationLabel(loc)
    : `Location ${rotation.location_id.slice(0, 8)}`;
  const typeBadge = loc?.type ? formatAuditLocationBadge(loc.type) : null;

  return (
    <li
      className={`${pulsing ? "bay-advance-pulse" : ""} ${
        assignedToMe ? "bg-cyan-950/20" : ""
      }`}
    >
      <div className="flex min-h-12 items-center gap-3 px-3 py-2">
        <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 active:bg-slate-800/60">
          <input
            type="checkbox"
            checked={false}
            onChange={onComplete}
            className="h-6 w-6 shrink-0 accent-emerald-500"
            aria-label={`Mark complete: ${label}`}
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-mono text-sm font-bold text-slate-50">
              {label}
            </span>
            <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
              {typeBadge ? (
                <span
                  className={
                    loc?.type === "TOPSTOCK"
                      ? "glass-pill-cyan"
                      : "glass-pill-emerald"
                  }
                >
                  {typeBadge}
                </span>
              ) : null}
              {assignmentLabel ? (
                <span className="glass-pill-amber">{assignmentLabel}</span>
              ) : null}
            </span>
          </span>
        </label>
        <button
          type="button"
          onClick={onToggleBarrier}
          className="shrink-0 rounded-lg border border-amber-500/40 bg-amber-950/30 px-2 py-1.5 text-[10px] font-bold uppercase tracking-wide text-amber-200"
        >
          Barrier
        </button>
      </div>
      {barrierOpen ? (
        <div className="border-t border-slate-800 px-3 py-2">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-200/90">
            Tap a reason · {typeBadge ?? "bay"} context saved
          </p>
          <BarrierReasonChips
            disabled={barrierBusy}
            onSelect={onBarrier}
          />
        </div>
      ) : null}
    </li>
  );
}
