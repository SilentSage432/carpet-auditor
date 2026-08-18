"use client";

/**
 * Zebra floor checklist — optimistic bay complete, next-bay pulse,
 * Selling/Topstock filter, Sunday assignment handoff, one-tap barriers.
 * Completions owned by /api/rotations/complete; assignments by sunday-audit.
 * Quick Touch is a one-tap facing/readiness complete (same completeRotation path).
 */

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import {
  ChevronDown,
  ChevronUp,
  Clock,
  Construction,
  Flag,
  FlagOff,
  Hand,
} from "lucide-react";
import { AuditLocationModeToggle } from "@/components/store-ops/AuditLocationModeToggle";
import { BarrierReasonChips } from "@/components/store-ops/BarrierReasonChips";
import { BayHealthScorecard } from "@/components/store-ops/BayHealthScorecard";
import { CarryOverPriorityBadge } from "@/components/store-ops/CarryOverPriorityBadge";
import { formatAuditLocationBadge } from "@/lib/store-ops/audit-location-mode";
import { diagnoseBayHealth } from "@/lib/store-ops/bay-health";
import {
  BayCompleteGatedError,
  completeRotation,
  reportRotationBarriers,
} from "@/lib/store-ops/client";
import {
  clearDownstockFlag,
  DOWNSTOCK_EVENT,
  fetchDownstockQueue,
  flagForDownstock,
  type DownstockFlag,
  type DownstockMap,
} from "@/lib/store-ops/downstock";
import { emitBayReadiness } from "@/lib/store-ops/map-readiness";
import { effectiveDepartment, isAssociate, isMasterAdmin } from "@/lib/rbac";
import {
  fetchSundayAssignments,
  isSundayAssignmentForSpecialist,
  partitionRotationsBySundayAssignment,
  setSundayBayAssignment,
  subscribeSundayBayAssignments,
  SUNDAY_AUDIT_EVENT,
  SUNDAY_DEPARTMENT,
  type SundayAssignmentMap,
  type SundayBayAssignment,
} from "@/lib/store-ops/sunday-audit";
import {
  composeOnDutyBayWorkload,
  hoursBySpecialistId,
  readShiftRoster,
  type OnDutyWorkloadMember,
  type ShiftRosterMember,
} from "@/lib/store-ops/weekly-rotations";
import { forecastWeeklyPace } from "@/lib/store-ops/week";
import { getStoreNumber } from "@/lib/store";
import { fetchAudits, getLocalAudits } from "@/lib/storage";
import {
  formatBayTag,
  resolveVerificationStatus,
  type ExceptionReason,
  type StoreLocationType,
  type WeeklyRotationWithLocation,
} from "@/lib/store-ops/types";
import type { CarpetAudit, StoreSpecialist } from "@/lib/types";
import { playErrorTone, playSuccessTone } from "@/lib/ui/feedback";
import { hapticPulse } from "@/utils/haptics";
import { recordBayTouch } from "@/lib/heatmap/bay-tracker";

const ICON_STROKE = 1.75;

type TypeFilter = StoreLocationType | "all";
type AssociateFilter = "all" | "mine" | string;
type QueueFilter = "all" | "downstock";

export type ZebraChecklistProps = {
  specialist: StoreSpecialist;
  assignedWeek: string;
  rotations: WeeklyRotationWithLocation[];
  onRefresh: () => void;
  /** Lock the queue to downstock (Stock tab). */
  lockedQueue?: QueueFilter;
  /** Hide pace / health chrome when composed into Stock. */
  compact?: boolean;
  /** Hide week banner, health, and associate chips (Floor owns those). */
  hideChrome?: boolean;
  /** sunday_bay_assignments department key (flooring / appliances / …). */
  assignmentDepartment?: string;
  /** Filter to one on-duty specialist, or all. */
  focusSpecialistId?: string | "all";
  /** Today's on-duty roster used to group unassigned bays in-place. */
  onDutyMembers?: OnDutyWorkloadMember[];
  /** Audits captured by Snap Bay elsewhere on the Floor. */
  externalAudits?: Record<
    string,
    {
      audit_log_id: string;
      audit_verdict: "PASS" | "CONDITIONAL" | "FAIL";
    }
  >;
};

export function ZebraChecklist({
  specialist,
  assignedWeek,
  rotations,
  onRefresh,
  lockedQueue,
  compact = false,
  hideChrome = false,
  assignmentDepartment = SUNDAY_DEPARTMENT,
  focusSpecialistId = "all",
  onDutyMembers,
  externalAudits,
}: ZebraChecklistProps) {
  const [error, setError] = useState<string | null>(null);
  const [doneOpen, setDoneOpen] = useState(false);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [associateFilter, setAssociateFilter] = useState<AssociateFilter>(
    () => (isAssociate(specialist) ? "mine" : "all")
  );
  const [queueFilter, setQueueFilter] = useState<QueueFilter>(
    lockedQueue ?? "all"
  );
  const [shiftHours, setShiftHours] = useState<Record<string, number>>({});
  const [shiftRoster, setShiftRoster] = useState<ShiftRosterMember[]>([]);
  const [assignments, setAssignments] = useState<SundayAssignmentMap>({});
  const [downstock, setDownstock] = useState<DownstockMap>({});
  const [downstockNoteId, setDownstockNoteId] = useState<string | null>(null);
  const [downstockNote, setDownstockNote] = useState("");
  const [downstockBusy, setDownstockBusy] = useState(false);
  const [completedOverlay, setCompletedOverlay] = useState<Set<string>>(
    () => new Set()
  );
  const [pulseId, setPulseId] = useState<string | null>(null);
  const [barrierId, setBarrierId] = useState<string | null>(null);
  const [barrierBusy, setBarrierBusy] = useState(false);
  const [barrierOverlay, setBarrierOverlay] = useState<Set<string>>(
    () => new Set()
  );
  const [audits, setAudits] = useState<CarpetAudit[]>(() => getLocalAudits());
  const [auditByRotation, setAuditByRotation] = useState<
    Record<
      string,
      {
        audit_log_id: string;
        audit_verdict: "PASS" | "CONDITIONAL" | "FAIL";
      }
    >
  >({});
  const [gatedRotationId, setGatedRotationId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const associateView = isAssociate(specialist);

  useEffect(() => {
    setAssociateFilter(isAssociate(specialist) ? "mine" : "all");
  }, [specialist]);

  const loadAssignments = useCallback(async () => {
    if (!assignedWeek) {
      setAssignments({});
      return;
    }
    try {
      const map = await fetchSundayAssignments(
        assignedWeek,
        getStoreNumber(),
        assignmentDepartment
      );
      setAssignments(map);
    } catch {
      /* Keep last known assignments when the floor is offline. */
    }
  }, [assignedWeek, assignmentDepartment]);

  const downstockDept = useMemo(() => {
    const dept = effectiveDepartment(specialist);
    return dept === "all" ? "flooring" : dept;
  }, [specialist]);

  const loadDownstock = useCallback(async () => {
    if (!assignedWeek) {
      setDownstock({});
      return;
    }
    try {
      const map = await fetchDownstockQueue(
        assignedWeek,
        getStoreNumber(),
        downstockDept
      );
      setDownstock(map);
    } catch {
      /* Keep last known downstock flags when the floor is offline. */
    }
  }, [assignedWeek, downstockDept]);

  useEffect(() => {
    void loadAssignments();
    void loadDownstock();
    if (assignedWeek) {
      const roster = readShiftRoster(assignedWeek, getStoreNumber());
      setShiftRoster(roster.filter((row) => row.active));
      setShiftHours(hoursBySpecialistId(roster));
    } else {
      setShiftRoster([]);
      setShiftHours({});
    }
  }, [loadAssignments, loadDownstock, assignedWeek]);

  useEffect(() => {
    let cancelled = false;
    void fetchAudits()
      .then((rows) => {
        if (cancelled) return;
        const local = getLocalAudits();
        const ids = new Set(rows.map((r) => r.id));
        setAudits([...rows, ...local.filter((r) => !ids.has(r.id))]);
      })
      .catch(() => {
        if (!cancelled) setAudits(getLocalAudits());
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function onSunday() {
      void loadAssignments();
      void loadDownstock();
      if (assignedWeek) {
        const roster = readShiftRoster(assignedWeek, getStoreNumber());
        setShiftRoster(roster.filter((row) => row.active));
        setShiftHours(hoursBySpecialistId(roster));
      }
      onRefresh();
    }
    window.addEventListener(SUNDAY_AUDIT_EVENT, onSunday);
    window.addEventListener(DOWNSTOCK_EVENT, onSunday);
    const store = getStoreNumber();
    const unsub = subscribeSundayBayAssignments(store, assignedWeek, () => {
      void loadAssignments();
      onRefresh();
    });
    return () => {
      window.removeEventListener(SUNDAY_AUDIT_EVENT, onSunday);
      window.removeEventListener(DOWNSTOCK_EVENT, onSunday);
      unsub();
    };
  }, [assignedWeek, loadAssignments, loadDownstock, onRefresh]);

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

  const workload = useMemo(
    () =>
      composeOnDutyBayWorkload({
        bays: open.map((row) => ({
          rotationId: row.id,
          aisle: row.store_locations?.aisle ?? "",
          bay: row.store_locations?.bay ?? 0,
          type: row.store_locations?.type,
          riskScore: 0,
        })),
        assignments,
        onDuty: onDutyMembers ?? [],
      }),
    [open, assignments, onDutyMembers]
  );

  const associateOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const assignment of Object.values(assignments)) {
      if (!assignment?.specialist_id) continue;
      if (!seen.has(assignment.specialist_id)) {
        seen.set(assignment.specialist_id, assignment.specialist_name);
      }
    }
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  }, [assignments]);

  const orderedOpen = useMemo(() => {
    const base = partition.hasPersonalQueue
      ? [
          ...partition.assignedToMe,
          ...partition.unassigned,
          ...partition.assignedToOthers,
        ]
      : open;
    const focus = hideChrome ? focusSpecialistId : associateFilter;
    if (focus === "all") return base;
    if (focus === "mine") {
      const mineId = String(specialist.id);
      return base.filter(
        (r) =>
          isSundayAssignmentForSpecialist(assignments[r.id], specialist) ||
          workload.assigneeByRotationId[r.id] === mineId
      );
    }
    return base.filter(
      (r) =>
        assignments[r.id]?.specialist_id === focus ||
        workload.assigneeByRotationId[r.id] === focus
    );
  }, [
    open,
    partition,
    associateFilter,
    assignments,
    specialist,
    hideChrome,
    focusSpecialistId,
    workload,
  ]);

  const downstockOpen = useMemo(
    () => orderedOpen.filter((r) => Boolean(downstock[r.id])),
    [orderedOpen, downstock]
  );

  const queueOpen = queueFilter === "downstock" ? downstockOpen : orderedOpen;

  const bayHealth = useMemo(
    () => diagnoseBayHealth({ rotations: visible, audits }),
    [visible, audits]
  );
  const flaggedIds = useMemo(
    () => new Set(bayHealth.findings.map((f) => f.rotationId)),
    [bayHealth]
  );

  const weeklyPace = useMemo(() => {
    const completedCount = rotations.filter(
      (r) => r.is_completed || completedOverlay.has(r.id)
    ).length;
    return forecastWeeklyPace({
      assigned: rotations.length,
      completed: completedCount,
    });
  }, [rotations, completedOverlay]);

  function handleSupervisorOverrideComplete(rotationId: string) {
    const rotation = rotations.find((r) => r.id === rotationId);
    const locationId =
      rotation?.location_id || rotation?.store_locations?.id || "";
    const pending =
      auditByRotation[rotationId] ?? externalAudits?.[rotationId];
    setError(null);
    startTransition(async () => {
      try {
        await completeRotation(specialist, rotationId, {
          bay_id: locationId,
          audit_verdict: pending?.audit_verdict ?? "FAIL",
          audit_log_id: pending?.audit_log_id,
          supervisor_override: true,
        });
        setCompletedOverlay((prev) => new Set(prev).add(rotationId));
        setAuditByRotation((prev) => {
          const next = { ...prev };
          delete next[rotationId];
          return next;
        });
        setGatedRotationId(null);
        onRefresh();
        playSuccessTone();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Supervisor override failed"
        );
        playErrorTone();
      }
    });
  }

  function handleCheck(rotationId: string) {
    setError(null);
    const remaining = queueOpen.filter((r) => r.id !== rotationId);
    const nextBay = remaining[0]?.id ?? null;
    const rotation = rotations.find((r) => r.id === rotationId);
    const locationId =
      rotation?.location_id || rotation?.store_locations?.id || "";
    setCompletedOverlay((prev) => {
      const next = new Set(prev);
      next.add(rotationId);
      return next;
    });
    setPulseId(nextBay);
    setBarrierId((id) => (id === rotationId ? null : id));
    if (locationId) {
      emitBayReadiness({ locationIds: [locationId], tone: "verified" });
      recordBayTouch({
        location_id: locationId,
        aisle: rotation?.store_locations?.aisle,
        bay: rotation?.store_locations?.bay,
        location_tag: rotation?.store_locations
          ? formatBayTag(rotation.store_locations)
          : undefined,
        source: "checkoff",
      });
    }
    hapticPulse("success");
    playSuccessTone();
    startTransition(async () => {
      try {
        const pending =
          auditByRotation[rotationId] ?? externalAudits?.[rotationId];
        const outcome = await completeRotation(specialist, rotationId, {
          bay_id: locationId,
          audit_verdict: pending?.audit_verdict,
          audit_log_id: pending?.audit_log_id,
        });
        if (outcome === "executed") {
          setAuditByRotation((prev) => {
            const next = { ...prev };
            delete next[rotationId];
            return next;
          });
          setGatedRotationId(null);
          onRefresh();
        }
      } catch (err) {
        setCompletedOverlay((prev) => {
          const next = new Set(prev);
          next.delete(rotationId);
          return next;
        });
        setPulseId(null);
        if (err instanceof BayCompleteGatedError) {
          setGatedRotationId(rotationId);
          const issueLines = err.issues
            .slice(0, 3)
            .map((i) => i.issue)
            .filter(Boolean);
          setError(
            issueLines.length > 0
              ? `Audit gate: ${issueLines.join(" · ")}`
              : err.message
          );
        } else {
          setError(err instanceof Error ? err.message : "Could not complete bay");
        }
        playErrorTone();
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
      playErrorTone();
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

  async function submitDownstock(rotation: WeeklyRotationWithLocation) {
    const locationId =
      rotation.location_id || rotation.store_locations?.id || "";
    setDownstockBusy(true);
    setError(null);
    const optimistic: DownstockFlag = {
      rotation_id: rotation.id,
      location_id: locationId,
      note: downstockNoteId === rotation.id ? downstockNote : "",
      flagged_by: specialist.name,
      flagged_at: new Date().toISOString(),
      resolved_at: null,
    };
    setDownstock((prev) => ({ ...prev, [rotation.id]: optimistic }));
    try {
      const flag = await flagForDownstock({
        week: assignedWeek,
        rotationId: rotation.id,
        locationId,
        note: optimistic.note,
        flaggedBy: specialist.name,
        department: downstockDept,
      });
      setDownstock((prev) => ({ ...prev, [rotation.id]: flag }));
      setDownstockNoteId(null);
      setDownstockNote("");
      hapticPulse("medium");
      playSuccessTone();
    } catch (err) {
      setDownstock((prev) => {
        const next = { ...prev };
        delete next[rotation.id];
        return next;
      });
      setError(err instanceof Error ? err.message : "Could not flag downstock");
    } finally {
      setDownstockBusy(false);
    }
  }

  async function resolveDownstock(rotationId: string) {
    setDownstockBusy(true);
    setError(null);
    try {
      await clearDownstockFlag({
        week: assignedWeek,
        rotationId,
        department: downstockDept,
      });
      setDownstock((prev) => {
        const next = { ...prev };
        delete next[rotationId];
        return next;
      });
      playSuccessTone();
      hapticPulse("success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not clear downstock");
    } finally {
      setDownstockBusy(false);
    }
  }

  async function assignDownstockPull(
    rotationId: string,
    specialistId: string
  ) {
    const member = shiftRoster.find((row) => row.specialist_id === specialistId);
    if (!member || !assignedWeek) return;
    setError(null);
    const previous = assignments[rotationId];
    setAssignments((prev) => ({
      ...prev,
      [rotationId]: {
        specialist_id: member.specialist_id,
        specialist_name: member.specialist_name,
        assigned_at: new Date().toISOString(),
        status: "assigned",
      },
    }));
    try {
      await setSundayBayAssignment(
        assignedWeek,
        rotationId,
        {
          specialist_id: member.specialist_id,
          specialist_name: member.specialist_name,
          assigned_at: new Date().toISOString(),
          status: "assigned",
        },
        getStoreNumber(),
        assignmentDepartment
      );
      await loadAssignments();
    } catch (err) {
      setAssignments((prev) => {
        const next = { ...prev };
        if (previous) next[rotationId] = previous;
        else delete next[rotationId];
        return next;
      });
      setError(err instanceof Error ? err.message : "Could not assign pull");
    }
  }

  const rotationById = useMemo(() => {
    const map = new Map(queueOpen.map((row) => [row.id, row]));
    return map;
  }, [queueOpen]);

  const groupedQueue =
    hideChrome &&
    queueFilter !== "downstock" &&
    focusSpecialistId === "all" &&
    (onDutyMembers?.length ?? 0) > 0;

  const leftoverOpen = groupedQueue
    ? queueOpen.filter((row) => {
        const grouped = workload.groups.some((group) =>
          group.rotationIds.includes(row.id)
        );
        return !grouped && !workload.unassignedIds.includes(row.id);
      })
    : [];

  function renderBayRow(rotation: WeeklyRotationWithLocation) {
    return (
      <ZebraBayRow
        key={rotation.id}
        rotation={rotation}
        assignmentLabel={assignmentCaption(
          assignments[rotation.id],
          specialist,
          shiftHours
        )}
        assignment={assignments[rotation.id] ?? null}
        assignedToMe={isSundayAssignmentForSpecialist(
          assignments[rotation.id],
          specialist
        )}
        pulsing={pulseId === rotation.id}
        flagged={flaggedIds.has(rotation.id)}
        downstock={downstock[rotation.id] ?? null}
        downstockNoteOpen={downstockNoteId === rotation.id}
        downstockNote={downstockNote}
        downstockBusy={downstockBusy}
        assignOptions={queueFilter === "downstock" ? shiftRoster : []}
        barrierOpen={barrierId === rotation.id}
        barrierBusy={barrierBusy}
        onToggleBarrier={() =>
          setBarrierId((id) => (id === rotation.id ? null : rotation.id))
        }
        onToggleDownstock={() => {
          if (downstock[rotation.id]) {
            void resolveDownstock(rotation.id);
            return;
          }
          setDownstockNoteId((id) =>
            id === rotation.id ? null : rotation.id
          );
          setDownstockNote("");
        }}
        onDownstockNoteChange={setDownstockNote}
        onFlagDownstock={() => void submitDownstock(rotation)}
        onAssign={(specialistId) =>
          void assignDownstockPull(rotation.id, specialistId)
        }
        onComplete={() => handleCheck(rotation.id)}
        onBarrier={(reason) => void handleBarrier(rotation, reason)}
      />
    );
  }

  return (
    <div className="theme-density-stack space-y-2">
      {!compact && !hideChrome ? (
        <div className="theme-accent-surface flex items-center gap-2 rounded-xl border px-3 py-2">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-accent">
              This Week&apos;s Assigned Rotation
            </p>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-sm font-bold text-slate-50">
              <span>{assignedWeek || "No week assigned"}</span>
              <span className="text-xs font-semibold text-slate-400">
                {open.length} remaining · {done.length} complete
                {partition.hasPersonalQueue
                  ? ` · ${partition.assignedToMe.length} yours`
                  : ""}
                {Object.keys(downstock).length > 0
                  ? ` · ${Object.keys(downstock).length} downstock`
                  : ""}
              </span>
            </p>
          </div>
          <p
            className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-wide ${
              weeklyPace.tone === "ahead"
                ? "border-success/50 bg-success/10 text-success"
                : weeklyPace.tone === "behind"
                  ? "border-danger/50 bg-danger/10 text-danger"
                  : "border-warning/45 bg-warning/10 text-warning"
            }`}
            title={weeklyPace.label}
          >
            <Clock className="h-3.5 w-3.5" strokeWidth={ICON_STROKE} aria-hidden />
            {weeklyPace.tone === "ahead"
              ? "Ahead"
              : weeklyPace.tone === "behind"
                ? "Behind"
                : "On Track"}{" "}
            · {weeklyPace.actual_pct}%
          </p>
        </div>
      ) : null}

      {!compact && !hideChrome && !associateView ? <BayHealthScorecard card={bayHealth} /> : null}

      {!lockedQueue && !hideChrome ? (
      <div
        role="tablist"
        aria-label="Bay checklist"
        className="grid grid-cols-2 gap-2"
      >
        <button
          type="button"
          role="tab"
          aria-selected={queueFilter === "all"}
          onClick={() => setQueueFilter("all")}
          className={`chip-filter w-full rounded-xl ${
            queueFilter === "all"
              ? "theme-accent-surface border"
              : "border-zinc-800/80 bg-zinc-950/50 text-zinc-400"
          }`}
        >
          Rotation
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={queueFilter === "downstock"}
          onClick={() => setQueueFilter("downstock")}
          className={`chip-filter w-full rounded-xl ${
            queueFilter === "downstock"
              ? "border-cyan-500/50 bg-cyan-950/40 text-cyan-200"
              : "border-zinc-800/80 bg-zinc-950/50 text-zinc-400"
          }`}
        >
          Downstock Queue
          {downstockOpen.length > 0 ? ` (${downstockOpen.length})` : ""}
        </button>
      </div>
      ) : null}

      <AuditLocationModeToggle
        value={typeFilter}
        onChange={setTypeFilter}
        includeAll
        legend="Selling vs Topstock"
      />

      {associateOptions.length > 0 && !associateView && !hideChrome ? (
        <div className="flex gap-1.5 overflow-x-auto pb-0.5 no-scrollbar">
          {(
            [
              { id: "all" as const, label: "All shifts" },
              { id: "mine" as const, label: "Mine" },
              ...associateOptions.map((opt) => ({
                id: opt.id,
                label: opt.name.split(" · ")[0] ?? opt.name,
              })),
            ] as Array<{ id: AssociateFilter; label: string }>
          ).map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setAssociateFilter(opt.id)}
              className={`chip-filter rounded-full ${
                associateFilter === opt.id
                  ? "border-cyan-400/55 bg-cyan-950/45 text-cyan-100"
                  : "border-slate-700 text-slate-300"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      ) : null}

      {error ? (
        <div className="space-y-2">
          <p className="rounded-xl border border-red-500/40 bg-red-950/40 px-3 py-2 text-sm text-red-200">
            {error}
          </p>
          {gatedRotationId &&
          (isMasterAdmin(specialist) || specialist.role === "Supervisor") ? (
            <button
              type="button"
              onClick={() => handleSupervisorOverrideComplete(gatedRotationId)}
              className="flex min-h-11 w-full items-center justify-center rounded-xl border border-amber-400/50 bg-amber-500/20 text-sm font-bold text-amber-100"
            >
              Supervisor override — complete bay anyway
            </button>
          ) : null}
        </div>
      ) : null}

      {lockedQueue !== "downstock" && open.length === 0 && done.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-700 px-4 py-4 text-center text-sm text-slate-400">
          {isAssociate(specialist)
            ? "No bays scheduled on your rotation — see your supervisor"
            : isMasterAdmin(specialist)
              ? "No bays scheduled this week. Open Settings → Trigger weekly rotation."
              : "No bays scheduled this week — ask Master Admin to set the rotation."}
        </p>
      ) : null}

      {queueFilter === "downstock" && queueOpen.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-700 px-4 py-4 text-center text-sm text-slate-400">
          <p>
            No overhead pulls yet. On Floor, open a bay and tap Flag for
            Downstock.
          </p>
          {lockedQueue === "downstock" ? (
            <Link
              href="/dashboard"
              className="mt-3 inline-flex min-h-11 items-center justify-center rounded-xl border border-accent/40 px-3 text-sm font-semibold text-accent"
            >
              Go to Floor checklist
            </Link>
          ) : null}
        </div>
      ) : null}

      {partition.hasPersonalQueue && queueFilter !== "downstock" && !hideChrome ? (
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-300">
          Your Sunday bays first · live handoff
        </p>
      ) : null}

      {queueFilter === "downstock" ? (
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-300">
          Overhead pulls · assign an associate from today&apos;s roster
        </p>
      ) : null}

      {groupedQueue ? (
        <div className="space-y-2">
          {workload.groups.map((group) => {
            const rows = group.rotationIds
              .map((id) => rotationById.get(id))
              .filter((row): row is WeeklyRotationWithLocation => Boolean(row));
            if (rows.length === 0) return null;
            return (
              <section key={group.specialist_id}>
                <p className="mb-1 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                  {group.specialist_name.split(" · ")[0]} · {rows.length}{" "}
                  {rows.length === 1 ? "bay" : "bays"}
                </p>
                <ul className="divide-y divide-slate-800 overflow-hidden rounded-xl border border-slate-700 bg-slate-900/90">
                  {rows.map((rotation) => renderBayRow(rotation))}
                </ul>
              </section>
            );
          })}
          {workload.unassignedIds.length > 0 ? (
            <section>
              <p className="mb-1 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                Unassigned · {workload.unassignedIds.length}{" "}
                {workload.unassignedIds.length === 1 ? "bay" : "bays"}
              </p>
              <ul className="divide-y divide-slate-800 overflow-hidden rounded-xl border border-slate-700 bg-slate-900/90">
                {workload.unassignedIds.map((id) => {
                  const rotation = rotationById.get(id);
                  return rotation ? renderBayRow(rotation) : null;
                })}
              </ul>
            </section>
          ) : null}
          {leftoverOpen.length > 0 ? (
            <section>
              <p className="mb-1 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                Other assignments · {leftoverOpen.length}{" "}
                {leftoverOpen.length === 1 ? "bay" : "bays"}
              </p>
              <ul className="divide-y divide-slate-800 overflow-hidden rounded-xl border border-slate-700 bg-slate-900/90">
                {leftoverOpen.map((rotation) => renderBayRow(rotation))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : (
        <ul className="divide-y divide-slate-800 overflow-hidden rounded-xl border border-slate-700 bg-slate-900/90">
          {queueOpen.map((rotation) => renderBayRow(rotation))}
        </ul>
      )}

      {done.length > 0 ? (
        <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950/50">
          <button
            type="button"
            aria-expanded={doneOpen}
            onClick={() => setDoneOpen((o) => !o)}
            className="flex min-h-11 w-full items-center justify-between px-3 text-left font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500"
          >
            Completed ({done.length}) · associate done / DS verified
            {doneOpen ? (
              <ChevronUp className="h-4 w-4" strokeWidth={ICON_STROKE} aria-hidden />
            ) : (
              <ChevronDown className="h-4 w-4" strokeWidth={ICON_STROKE} aria-hidden />
            )}
          </button>
          {doneOpen ? (
            <ul className="divide-y divide-slate-800 border-t border-slate-800 opacity-60">
              {done.map((rotation) => {
                const loc = rotation.store_locations;
                const label = loc
                  ? formatBayTag(loc)
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
                      className="h-4 w-4"
                      style={{ accentColor: "var(--accent)" }}
                    />
                    <span className="min-w-0 flex-1 truncate font-mono text-sm tracking-tight tabular-nums text-slate-400 line-through">
                      {label}
                    </span>
                    <CarryOverPriorityBadge location={loc} />
                    {resolveVerificationStatus(rotation) ===
                    "PENDING_VERIFICATION" ? (
                      <span className="shrink-0 rounded-full border border-amber-400/40 bg-amber-950/40 px-2 font-mono text-[10px] font-bold uppercase tracking-wide text-amber-200">
                        Awaiting DS
                      </span>
                    ) : (
                      <span className="shrink-0 rounded-full border border-emerald-400/30 bg-emerald-950/30 px-2 font-mono text-[10px] font-bold uppercase tracking-wide text-emerald-200">
                        Verified
                      </span>
                    )}
                    <span className="shrink-0 font-mono text-[10px] tracking-tight tabular-nums text-slate-500">
                      {formatTouchTime(rotation.completed_at)}
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

function formatTouchTime(iso: string | null | undefined): string {
  if (!iso) return "Touched";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Touched";
  return `Touched ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

function assignmentCaption(
  assignment: SundayBayAssignment | null | undefined,
  specialist: StoreSpecialist,
  hoursById: Record<string, number>
): string | null {
  if (!assignment) return null;
  const hours = hoursById[assignment.specialist_id];
  const alreadyTagged = /·\s*\d/.test(assignment.specialist_name);
  const name = alreadyTagged
    ? assignment.specialist_name
    : hours
      ? `${assignment.specialist_name.split(" · ")[0]} · ${hours}h`
      : assignment.specialist_name;
  if (isSundayAssignmentForSpecialist(assignment, specialist)) {
    return `You · ${name}`;
  }
  return name;
}

function ZebraBayRow({
  rotation,
  assignmentLabel,
  assignment,
  assignedToMe,
  pulsing,
  flagged,
  downstock,
  downstockNoteOpen,
  downstockNote,
  downstockBusy,
  assignOptions,
  barrierOpen,
  barrierBusy,
  onToggleBarrier,
  onToggleDownstock,
  onDownstockNoteChange,
  onFlagDownstock,
  onAssign,
  onComplete,
  onBarrier,
}: {
  rotation: WeeklyRotationWithLocation;
  assignmentLabel: string | null;
  assignment: SundayBayAssignment | null;
  assignedToMe: boolean;
  pulsing: boolean;
  flagged: boolean;
  downstock: DownstockFlag | null;
  downstockNoteOpen: boolean;
  downstockNote: string;
  downstockBusy: boolean;
  assignOptions: ShiftRosterMember[];
  barrierOpen: boolean;
  barrierBusy: boolean;
  onToggleBarrier: () => void;
  onToggleDownstock: () => void;
  onDownstockNoteChange: (value: string) => void;
  onFlagDownstock: () => void;
  onAssign: (specialistId: string) => void;
  onComplete: () => void;
  onBarrier: (reason: ExceptionReason) => void;
}) {
  const loc = rotation.store_locations;
  const label = loc
    ? formatBayTag(loc)
    : `Location ${rotation.location_id.slice(0, 8)}`;
  const typeBadge = loc?.type ? formatAuditLocationBadge(loc.type) : null;

  return (
    <li
      className={`${pulsing ? "bay-advance-pulse" : ""} ${
        assignedToMe ? "bg-cyan-950/20" : ""
      }`}
    >
      <div className="theme-density-row flex items-start gap-1.5 px-2 py-1.5">
        <label className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-2.5 active:bg-slate-800/60">
          <input
            type="checkbox"
            checked={false}
            onChange={onComplete}
            className="h-6 w-6 shrink-0"
            style={{ accentColor: "var(--accent)" }}
            aria-label={`Mark complete: ${label}`}
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-mono text-sm font-bold tracking-tight tabular-nums text-slate-50">
              {label}
            </span>
            <span className="mt-0.5 flex flex-wrap items-center gap-1">
              <CarryOverPriorityBadge
                location={loc}
                assignment={assignment}
              />
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
              {flagged ? (
                <span className="glass-pill-rose">Health</span>
              ) : null}
              {downstock ? (
                <span className="glass-pill-cyan">
                  Downstock{downstock.note ? ` · ${downstock.note}` : ""}
                </span>
              ) : null}
            </span>
            {rotation.review_note ? (
              <span className="mt-1 block text-xs text-amber-200">
                Send back: {rotation.review_note}
              </span>
            ) : null}
          </span>
        </label>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onComplete}
            className={`btn-quick-touch ${
              assignedToMe
                ? "border-cyan-400/50 bg-cyan-950/40 text-cyan-100"
                : "theme-accent-surface border"
            }`}
            aria-label={`Quick Touch facing check: ${label}`}
            title="Quick Touch"
          >
            <Hand className="h-4 w-4" strokeWidth={ICON_STROKE} aria-hidden />
            <span className="hidden min-[380px]:inline">Touch</span>
          </button>
          <button
            type="button"
            disabled={downstockBusy}
            onClick={onToggleDownstock}
            className={`btn-quick-touch ${
              downstock
                ? "border-cyan-400/55 bg-cyan-950/50 text-cyan-100"
                : "border-cyan-500/35 bg-cyan-950/25 text-cyan-200"
            }`}
            aria-label={
              downstock
                ? `Clear downstock pull: ${label}`
                : `Flag for downstock: ${label}`
            }
            title={downstock ? "Clear pull" : "Flag for Downstock"}
          >
            {downstock ? (
              <FlagOff className="h-4 w-4" strokeWidth={ICON_STROKE} aria-hidden />
            ) : (
              <Flag className="h-4 w-4" strokeWidth={ICON_STROKE} aria-hidden />
            )}
            <span className="hidden min-[380px]:inline">
              {downstock ? "Clear" : "Pull"}
            </span>
          </button>
          <button
            type="button"
            onClick={onToggleBarrier}
            className="btn-quick-touch border-amber-500/40 bg-amber-950/30 text-amber-200"
            aria-label={`Log barrier: ${label}`}
            title="Barrier"
          >
            <Construction className="h-4 w-4" strokeWidth={ICON_STROKE} aria-hidden />
            <span className="hidden min-[420px]:inline">Barrier</span>
          </button>
        </div>
      </div>
      {downstockNoteOpen && !downstock ? (
        <div className="border-t border-slate-800 px-3 py-2">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-cyan-200/90">
            Optional pallet / SKU note
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={downstockNote}
              onChange={(e) => onDownstockNoteChange(e.target.value)}
              placeholder="e.g. pallet 4 · SKU 12345"
              className="glass-input min-h-11 flex-1 py-2 text-sm"
            />
            <button
              type="button"
              disabled={downstockBusy}
              onClick={onFlagDownstock}
              className="flex min-h-11 shrink-0 items-center rounded-xl border border-cyan-500/45 bg-cyan-950/40 px-3 text-xs font-bold uppercase tracking-wide text-cyan-100"
            >
              Flag
            </button>
          </div>
        </div>
      ) : null}
      {assignOptions.length > 0 && downstock ? (
        <div className="border-t border-slate-800 px-3 py-2">
          <label className="block text-[11px] font-semibold uppercase tracking-wide text-cyan-200/90">
            Assign overhead pull
            <select
              value=""
              onChange={(e) => {
                const id = e.target.value;
                if (id) onAssign(id);
              }}
              className="glass-input mt-1 min-h-11 py-2 text-sm"
            >
              <option value="">Choose CSA…</option>
              {assignOptions.map((row) => (
                <option key={row.specialist_id} value={row.specialist_id}>
                  {row.specialist_name} · {row.hours}h
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}
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
