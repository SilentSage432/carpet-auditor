"use client";

/**
 * Sunday Flooring Cycle Audit assignment drawer — presentation + Supabase assignments.
 * Bay list composes weekly_rotations; generation stays in Force Rotation / cron.
 */

import { useCallback, useEffect, useMemo, useId, useState } from "react";
import {
  approveWeekCapacity,
  dispatchExtraBay,
  fetchDepartments,
  fetchOperationalSections,
  fetchThisWeekRotations,
  fetchWeekBayPriorities,
  fetchWeekCapacityBoard,
  generateRotations,
  suggestExtraBay,
} from "@/lib/store-ops/client";
import type { WeekBayPriorityView } from "@/lib/store-ops/week-bay-priority";
import type { WeekCapacityReviewBoard } from "@/lib/store-ops/approved-week-capacity";
import {
  findActiveBayMembershipConflicts,
  indexBaySectionLookups,
  type BaySectionLookup,
} from "@/lib/store-ops/operational-sections";
import {
  assertSectionAwarePreviewFresh,
  buildPreviewCapacityCaps,
  composeSectionAwareWeeklyPreview,
  isSectionAwarePreviewEnabled,
  type SectionAwareWeeklyPreview,
} from "@/lib/store-ops/section-aware-rotation";
import {
  assertStewardshipProposalFresh,
  classifyBayPriorityTier,
  composeStewardshipWeeklyProposal,
  type StewardshipWeeklyProposal,
} from "@/lib/store-ops/stewardship-week-distribution";
import { sectionAwarePhysicalKey } from "@/lib/store-ops/section-aware-rotation";
import { readableError } from "@/lib/store-ops/errors";
import { playErrorTone, playSuccessTone, playTapTone } from "@/lib/ui/feedback";
import { diagnoseBayHealth, type BayHealthFinding } from "@/lib/store-ops/bay-health";
import { CarryOverPriorityBadge } from "@/components/store-ops/CarryOverPriorityBadge";
import {
  autoAssignSundayBaysToSpecialist,
  applySundayAssignmentPlan,
  associateMatchesSundayDepartment,
  buildSundayStagedBays,
  clearSundayBayAssignment,
  fetchSundayAssignments,
  filterFlooringRotations,
  findFlooringDepartment,
  pendingSundayAssignmentCount,
  setSundayBayAssignment,
  subscribeSundayBayAssignments,
  SUNDAY_AUDIT_EVENT,
  sundayAssignableRoster,
  sundaySelectionSummary,
  sundayShiftSeedActive,
  sundayStagingHeadline,
  type SundayStagedBay,
} from "@/lib/store-ops/sunday-audit";
import {
  BASE_WEEKLY_BAY_QUOTA,
  SHIFT_HOUR_PRESETS,
  clampShiftHours,
  formatSpecialistShiftLabel,
  hoursBetween,
  mergeShiftRoster,
  planFlatBayAssignments,
  readShiftRoster,
  riskScoreFromFinding,
  writeShiftRoster,
  type ShiftRosterMember,
} from "@/lib/store-ops/weekly-rotations";
import {
  composeWeekLaborAvailability,
  weekLaborToAssignmentMembers,
  weekLaborToPlannerMembers,
  type LabPersistedShiftDayInput,
  type WeekLaborComposition,
} from "@/lib/store-ops/labor-availability";
import { isoWeekCalendarRange } from "@/lib/store-ops/week";
import { resolveWeeklyStageDrawCount } from "@/lib/store-ops/weekly-stage-draw";
import { fetchShiftDaysRange } from "@/lib/store-ops/shift-status";
import { getStoreNumber } from "@/lib/store";
import { fetchSpecialists } from "@/lib/specialists";
import { AssociateRosterPanel } from "@/components/admin/AssociateRosterPanel";
import { formatBayTag, type Department } from "@/lib/store-ops/types";
import { isMasterAdmin } from "@/lib/rbac";
import { useFocusedWorkspace } from "@/lib/ui/focused-workspace";
import { rosterJobTitleLabel, type StoreSpecialist } from "@/lib/types";

const FLOORING_STAGING_DEPT = "flooring" as const;
const EMPTY_BAY_SECTION_MAP: Map<string, BaySectionLookup> = new Map();

function shiftDaysToLabRows(
  days: Record<string, { specialist_id: string; work_date: string; start_time: string | null; end_time: string | null; is_scheduled_today: boolean; is_call_out: boolean; status?: string | null }>
): LabPersistedShiftDayInput[] {
  return Object.values(days).map((d) => ({
    specialist_id: d.specialist_id,
    work_date: d.work_date,
    start_time: d.start_time,
    end_time: d.end_time,
    is_scheduled_today: d.is_scheduled_today,
    is_call_out: d.is_call_out,
    status: d.status ?? null,
  }));
}

/** Recovery Assign this week — flat base quota (ENGINE-PROD-002), not proportional. */
function buildScheduleBalancePlan(
  bays: SundayStagedBay[],
  weekLabor: WeekLaborComposition | null,
  healthByRotation: Map<string, BayHealthFinding>
) {
  const bayRefs = bays.map((bay) => ({
    rotationId: bay.rotation.id,
    aisle: bay.aisle,
    bay: bay.bay,
    type: bay.rotation.store_locations?.type,
    riskScore: riskScoreFromFinding(healthByRotation.get(bay.rotation.id)),
  }));
  if (!weekLabor || weekLabor.processing_status === "UNAVAILABLE") {
    return planFlatBayAssignments(bayRefs, [], { knownHoursOnly: true });
  }
  const members = weekLaborToPlannerMembers(weekLabor.allocatable);
  return planFlatBayAssignments(bayRefs, members, {
    knownHoursOnly: true,
    quotaPerPerson: BASE_WEEKLY_BAY_QUOTA,
  });
}

type Props = {
  open: boolean;
  onClose: () => void;
  specialist: StoreSpecialist;
  onChanged?: () => void;
};

export function SundayAuditAssignmentModal({
  open,
  onClose,
  specialist,
  onChanged,
}: Props) {
  const titleId = useId();
  const [week, setWeek] = useState("");
  const [bays, setBays] = useState<SundayStagedBay[]>([]);
  const [roster, setRoster] = useState<StoreSpecialist[]>([]);
  const [flooringDept, setFlooringDept] = useState<Department | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [shiftRoster, setShiftRoster] = useState<ShiftRosterMember[]>([]);
  const [weekLabor, setWeekLabor] = useState<WeekLaborComposition | null>(null);
  const [extraBusyId, setExtraBusyId] = useState<string | null>(null);
  const [extraConfirm, setExtraConfirm] = useState<{
    specialistId: string;
    specialistName: string;
    locationId: string;
    label: string;
  } | null>(null);
  /** Opt-in SECTION-ROTATION-002 preview only (env flag; default off). */
  const sectionAwarePreviewOn = isSectionAwarePreviewEnabled();
  const [baySectionByKey, setBaySectionByKey] = useState<
    Map<string, BaySectionLookup>
  >(() => new Map());
  const [sectionConflictKeys, setSectionConflictKeys] = useState<string[]>([]);
  /** SECTION-ROTATION-005 — operator-approved weekly capacity review. */
  const [capacityBoard, setCapacityBoard] =
    useState<WeekCapacityReviewBoard | null>(null);
  const [capacityDraft, setCapacityDraft] = useState<Record<string, number>>(
    {}
  );
  const [capacityBusy, setCapacityBusy] = useState(false);
  const [capacityError, setCapacityError] = useState<string | null>(null);
  /** MAP-003 — week-scoped supervisory priorities for the planning week. */
  const [supervisorPriorities, setSupervisorPriorities] = useState<
    WeekBayPriorityView[]
  >([]);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rotData, depts, specialists] = await Promise.all([
        fetchThisWeekRotations(specialist),
        fetchDepartments(specialist).catch(() => [] as Department[]),
        fetchSpecialists(),
      ]);
      const flooring = findFlooringDepartment(depts);
      setFlooringDept(flooring);
      const flooringRots = filterFlooringRotations(
        rotData.rotations,
        flooring?.id
      );
      const assignments = await fetchSundayAssignments(
        rotData.assigned_week,
        getStoreNumber()
      );
      setWeek(rotData.assigned_week);
      setBays(buildSundayStagedBays(flooringRots, assignments));
      const assignable = sundayAssignableRoster(specialists);
      setRoster(assignable);
      setShiftRoster(
        mergeShiftRoster(
          assignable,
          readShiftRoster(rotData.assigned_week, getStoreNumber()),
          sundayShiftSeedActive(FLOORING_STAGING_DEPT)
        )
      );

      // Persisted whole-week schedule evidence for Balance Assign (not localStorage).
      const range = isoWeekCalendarRange(rotData.assigned_week);
      let labor: WeekLaborComposition | null = null;
      try {
        const days = await fetchShiftDaysRange(
          range.startDate,
          range.endDate,
          getStoreNumber()
        );
        labor = composeWeekLaborAvailability({
          department: FLOORING_STAGING_DEPT,
          week_label: rotData.assigned_week,
          dates: range.dates,
          workforce: assignable.map((m) => ({
            id: String(m.id),
            role: m.role,
            is_active: m.is_active,
            home_department: m.home_department,
            assigned_department: m.assigned_department,
            name: m.name,
          })),
          persisted_shift_days: shiftDaysToLabRows(days),
          workforce_evidence_available: true,
          schedule_evidence_available: true,
          as_of: new Date().toISOString(),
        });
      } catch (scheduleErr) {
        console.error(
          "[SundayAudit] week schedule labor unavailable",
          scheduleErr
        );
        labor = composeWeekLaborAvailability({
          department: FLOORING_STAGING_DEPT,
          week_label: rotData.assigned_week,
          dates: range.dates,
          workforce: [],
          persisted_shift_days: [],
          workforce_evidence_available: true,
          schedule_evidence_available: false,
          as_of: new Date().toISOString(),
        });
      }
      setWeekLabor(labor);

      // Capacity review board (ROTATION-005). Schema-missing → non-blocking null.
      try {
        const board = await fetchWeekCapacityBoard(
          specialist,
          rotData.assigned_week
        );
        setCapacityBoard(board);
        const draft: Record<string, number> = {};
        for (const row of board.associates) {
          draft[row.specialist_id] =
            row.approval_status === "approved" && row.approved_capacity != null
              ? row.approved_capacity
              : row.suggested_capacity;
        }
        setCapacityDraft(draft);
        setCapacityError(null);
      } catch (capErr) {
        console.error("[SundayAudit] week capacity board unavailable", capErr);
        setCapacityBoard(null);
        setCapacityDraft({});
        setCapacityError(
          readableError(
            capErr,
            "Weekly capacity approval is unavailable until the schema is migrated"
          )
        );
      }

      // MAP-003 supervisory priorities for this planning week (schema-missing → []).
      try {
        const pri = await fetchWeekBayPriorities(specialist, {
          week_label: rotData.assigned_week,
        });
        setSupervisorPriorities(pri.priorities.filter((p) => p.active));
      } catch (priErr) {
        console.error("[SundayAudit] week bay priorities unavailable", priErr);
        setSupervisorPriorities([]);
      }
    } catch (err) {
      setError(
        readableError(err, "Could not load Sunday Flooring cycle audits")
      );
      setBays([]);
      setWeekLabor(null);
      setCapacityBoard(null);
      setSupervisorPriorities([]);
    } finally {
      setLoading(false);
    }
  }, [specialist]);

  useEffect(() => {
    if (!open) return;
    void reload();
  }, [open, reload]);

  useEffect(() => {
    // Sections feed stewardship distribution (ROTATION-006) and opt-in preview.
    if (!open) return;
    let cancelled = false;
    void fetchOperationalSections(specialist, { includeMembers: true })
      .then((payload) => {
        if (cancelled) return;
        const sections = payload.sections ?? [];
        const membershipRows = sections.flatMap((section) =>
          (section.members ?? []).map((member) => ({
            section_id: section.id,
            section_is_active: section.is_active,
            department_id: member.department_id,
            aisle: member.aisle,
            bay: member.bay,
          }))
        );
        setSectionConflictKeys(findActiveBayMembershipConflicts(membershipRows));
        setBaySectionByKey(indexBaySectionLookups(sections));
      })
      .catch((err) => {
        console.error(
          "[SundayAudit] operational sections failed (non-blocking)",
          err
        );
        if (!cancelled) {
          setBaySectionByKey(new Map());
          setSectionConflictKeys([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, specialist]);

  const activeBaySectionByKey =
    sectionAwarePreviewOn || Boolean(capacityBoard?.approvals_complete)
      ? baySectionByKey
      : EMPTY_BAY_SECTION_MAP;

  useEffect(() => {
    if (!open || !week) return;
    return subscribeSundayBayAssignments(getStoreNumber(), week, () => {
      void reload();
    });
  }, [open, week, reload]);

  useEffect(() => {
    if (!open) return;
    function onAssignEvent() {
      void reload();
    }
    window.addEventListener(SUNDAY_AUDIT_EVENT, onAssignEvent);
    return () => window.removeEventListener(SUNDAY_AUDIT_EVENT, onAssignEvent);
  }, [open, reload]);

  useFocusedWorkspace(open);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const pending = useMemo(() => pendingSundayAssignmentCount(bays), [bays]);
  const headline = sundayStagingHeadline({
    openCount: bays.length,
    pendingAssignmentCount: pending,
    week,
  });

  const healthByRotation = useMemo(() => {
    const card = diagnoseBayHealth({
      rotations: bays.map((b) => b.rotation),
    });
    return new Map(card.findings.map((f) => [f.rotationId, f]));
  }, [bays]);

  const balancerPlan = useMemo(
    () => buildScheduleBalancePlan(bays, weekLabor, healthByRotation),
    [bays, weekLabor, healthByRotation]
  );

  const sectionAwarePreview: SectionAwareWeeklyPreview | null = useMemo(() => {
    if (!sectionAwarePreviewOn || !week || !weekLabor) return null;
    if (weekLabor.processing_status === "UNAVAILABLE") return null;
    // AUTO-005A: zero-shift active associates remain assignment-eligible.
    const members = weekLaborToAssignmentMembers(weekLabor.members);
    if (members.length === 0) return null;
    const ownedBySpecialist: Record<string, number> = {};
    let ownedTotal = 0;
    const ownedRotationIds: string[] = [];
    for (const row of bays) {
      const locked = row.assignment?.supervisor_locked === true;
      const owner = String(row.assignment?.specialist_id ?? "").trim();
      if (locked) ownedRotationIds.push(String(row.rotation.id));
      if (!owner) continue;
      ownedTotal += 1;
      ownedBySpecialist[owner] = (ownedBySpecialist[owner] ?? 0) + 1;
      if (!locked) ownedRotationIds.push(String(row.rotation.id));
    }
    const approvedBySpecialist: Record<string, number> = {};
    if (capacityBoard?.approvals_complete) {
      for (const row of capacityBoard.associates) {
        if (
          row.eligible &&
          row.approval_status === "approved" &&
          row.approved_capacity != null
        ) {
          approvedBySpecialist[row.specialist_id] = row.approved_capacity;
        }
      }
    }
    const capacity = buildPreviewCapacityCaps({
      eligibleSpecialistIds: members.map((m) => m.specialist_id),
      ownedBySpecialist,
      ownedTotal,
      ...(Object.keys(approvedBySpecialist).length > 0
        ? { approvedBySpecialist }
        : {}),
    });
    const bayRefs = bays.map((bay) => ({
      rotationId: bay.rotation.id,
      department_id: String(
        bay.rotation.store_locations?.department_id ?? flooringDept?.id ?? ""
      ).trim(),
      aisle: bay.aisle,
      bay: bay.bay,
      riskScore: riskScoreFromFinding(healthByRotation.get(bay.rotation.id)),
    }));
    return composeSectionAwareWeeklyPreview({
      store_number: getStoreNumber(),
      week_label: week,
      bays: bayRefs,
      members,
      baySectionByKey: activeBaySectionByKey,
      ownedRotationIds,
      capacity,
      knownHoursOnly: true,
    });
  }, [
    sectionAwarePreviewOn,
    week,
    weekLabor,
    bays,
    activeBaySectionByKey,
    healthByRotation,
    flooringDept?.id,
    capacityBoard,
  ]);

  /** ROTATION-006 / OPERATIONAL-009 — stewardship proposal when capacity approved. */
  const stewardshipProposal: StewardshipWeeklyProposal | null = useMemo(() => {
    if (!week || !weekLabor || !capacityBoard) return null;
    if (!capacityBoard.approvals_complete) return null;
    if (weekLabor.processing_status === "UNAVAILABLE") return null;
    // AUTO-005A: zero-shift active associates remain assignment-eligible.
    const members = weekLaborToAssignmentMembers(weekLabor.members);
    if (members.length === 0) return null;
    const ownedBySpecialist: Record<string, number> = {};
    let ownedTotal = 0;
    const ownedRotationIds: string[] = [];
    for (const row of bays) {
      const locked = row.assignment?.supervisor_locked === true;
      const owner = String(row.assignment?.specialist_id ?? "").trim();
      if (locked) ownedRotationIds.push(String(row.rotation.id));
      if (!owner) continue;
      ownedTotal += 1;
      ownedBySpecialist[owner] = (ownedBySpecialist[owner] ?? 0) + 1;
      if (!locked) ownedRotationIds.push(String(row.rotation.id));
    }
    const approvedBySpecialist: Record<string, number> = {};
    for (const row of capacityBoard.associates) {
      if (
        row.eligible &&
        row.approval_status === "approved" &&
        row.approved_capacity != null
      ) {
        approvedBySpecialist[row.specialist_id] = row.approved_capacity;
      }
    }
    const capacity = buildPreviewCapacityCaps({
      eligibleSpecialistIds: members.map((m) => m.specialist_id),
      ownedBySpecialist,
      ownedTotal,
      approvedBySpecialist,
    });
    const priorityKeys = new Set(
      supervisorPriorities.map((p) => p.physical_key)
    );
    const bayRefs = bays.map((bay) => {
      const department_id = String(
        bay.rotation.store_locations?.department_id ?? flooringDept?.id ?? ""
      ).trim();
      const ref = {
        rotationId: bay.rotation.id,
        department_id,
        aisle: bay.aisle,
        bay: bay.bay,
        riskScore: riskScoreFromFinding(healthByRotation.get(bay.rotation.id)),
        priority_tier: undefined as undefined,
        carried_over: Boolean(
          (bay.rotation as { carried_over?: boolean }).carried_over
        ),
        supervisor_priority: priorityKeys.has(
          sectionAwarePhysicalKey({
            department_id,
            aisle: bay.aisle,
            bay: bay.bay,
          })
        ),
      };
      return ref;
    });
    return composeStewardshipWeeklyProposal({
      store_number: getStoreNumber(),
      week_label: week,
      tiers: classifyBayPriorityTier(bayRefs),
      bays: bayRefs,
      members,
      baySectionByKey: baySectionByKey,
      conflictPhysicalKeys: sectionConflictKeys,
      ownedRotationIds,
      capacity,
      knownHoursOnly: true,
      supervisorPriorities,
    });
  }, [
    week,
    weekLabor,
    capacityBoard,
    bays,
    baySectionByKey,
    sectionConflictKeys,
    healthByRotation,
    flooringDept?.id,
    supervisorPriorities,
  ]);

  const selectionSummary = useMemo(
    () =>
      sundaySelectionSummary(roster, shiftRoster, FLOORING_STAGING_DEPT),
    [roster, shiftRoster]
  );

  /** Owners already in the complete base plan — candidates for manual +1. */
  const extraBayOwners = useMemo(() => {
    if (pending > 0 || bays.length === 0) return [];
    const counts = new Map<string, { name: string; count: number }>();
    for (const bay of bays) {
      const id = String(bay.assignment?.specialist_id ?? "").trim();
      if (!id) continue;
      const name = bay.assignment?.specialist_name ?? "Associate";
      const prev = counts.get(id);
      counts.set(id, {
        name: prev?.name ?? name,
        count: (prev?.count ?? 0) + 1,
      });
    }
    return [...counts.entries()]
      .filter(([, row]) => row.count >= BASE_WEEKLY_BAY_QUOTA)
      .map(([specialistId, row]) => ({
        specialistId,
        specialistName: row.name,
        count: row.count,
      }))
      .sort((a, b) => a.specialistName.localeCompare(b.specialistName));
  }, [bays, pending]);

  async function handleSuggestExtraBay(
    specialistId: string,
    specialistName: string
  ) {
    if (!flooringDept || busy || extraBusyId) return;
    playTapTone();
    setExtraBusyId(specialistId);
    setError(null);
    setStatus(null);
    setExtraConfirm(null);
    try {
      const suggestion = await suggestExtraBay(
        specialist,
        flooringDept.id,
        specialistId
      );
      if (!suggestion.ok || !suggestion.selection) {
        playErrorTone();
        setError(
          suggestion.reason ||
            suggestion.error ||
            "Could not find another owed bay"
        );
        return;
      }
      const sel = suggestion.selection;
      const aisle = String(sel.aisle ?? "");
      const bayNum = Number(sel.bay) || 0;
      setExtraConfirm({
        specialistId,
        specialistName,
        locationId: sel.location_id,
        label: formatBayTag({ aisle, bay: bayNum }),
      });
      setStatus(
        `Suggested ${formatBayTag({ aisle, bay: bayNum })} for ${specialistName}. Confirm to assign.`
      );
    } catch (err) {
      playErrorTone();
      setError(readableError(err, "Could not suggest another bay"));
    } finally {
      setExtraBusyId(null);
    }
  }

  async function handleConfirmExtraBay() {
    if (!flooringDept || !extraConfirm || busy || extraBusyId) return;
    playTapTone();
    setExtraBusyId(extraConfirm.specialistId);
    setError(null);
    try {
      const result = await dispatchExtraBay(specialist, {
        departmentId: flooringDept.id,
        specialistId: extraConfirm.specialistId,
        specialistName: extraConfirm.specialistName,
        locationId: extraConfirm.locationId,
      });
      if (!result.ok && result.status !== "ALREADY_COMPLETE") {
        playErrorTone();
        setError(result.reason || result.error || "Could not add another bay");
        return;
      }
      playSuccessTone();
      const after =
        typeof result.owner_count_after === "number"
          ? result.owner_count_after
          : null;
      setStatus(
        result.status === "ALREADY_COMPLETE"
          ? `${extraConfirm.specialistName} already owns ${extraConfirm.label}.`
          : after != null
            ? `Added ${extraConfirm.label} for ${extraConfirm.specialistName} (${after} this week).`
            : `Added ${extraConfirm.label} for ${extraConfirm.specialistName}.`
      );
      setExtraConfirm(null);
      await reload();
      onChanged?.();
    } catch (err) {
      playErrorTone();
      setError(readableError(err, "Could not add another bay"));
    } finally {
      setExtraBusyId(null);
    }
  }

  function persistRoster(next: ShiftRosterMember[]) {
    setShiftRoster(next);
    if (week) writeShiftRoster(week, next, getStoreNumber());
  }

  function patchMember(
    specialistId: string,
    patch: Partial<ShiftRosterMember>
  ) {
    persistRoster(
      shiftRoster.map((row) => {
        if (row.specialist_id !== specialistId) return row;
        const merged = { ...row, ...patch };
        const fromRange = hoursBetween(merged.start, merged.end);
        return {
          ...merged,
          hours: clampShiftHours(fromRange ?? merged.hours),
        };
      })
    );
  }

  async function handleAssign(rotationId: string, specialistId: string) {
    if (!week) return;
    const previous = bays;
    if (!specialistId) {
      setBays((prev) =>
        prev.map((b) =>
          b.rotation.id === rotationId ? { ...b, assignment: null } : b
        )
      );
      try {
        await clearSundayBayAssignment(week, rotationId);
        playTapTone();
        onChanged?.();
      } catch (err) {
        setBays(previous);
        setError(readableError(err, "Could not clear assignment"));
        playErrorTone();
      }
      return;
    }
    const member = roster.find((m) => String(m.id) === specialistId);
    if (!member) return;
    const assignment = {
      specialist_id: String(member.id),
      specialist_name: formatSpecialistShiftLabel(
        member.name,
        shiftRoster.find((r) => r.specialist_id === String(member.id))?.hours
      ),
      assigned_at: new Date().toISOString(),
    };
    setBays((prev) =>
      prev.map((b) =>
        b.rotation.id === rotationId ? { ...b, assignment } : b
      )
    );
    try {
      await setSundayBayAssignment(week, rotationId, assignment);
      playTapTone();
      onChanged?.();
    } catch (err) {
      setBays(previous);
      setError(readableError(err, "Could not save assignment"));
      playErrorTone();
    }
  }

  async function handleAutoAssignMe() {
    if (!week || bays.length === 0) return;
    const ids = bays.map((b) => b.rotation.id);
    setBusy(true);
    setError(null);
    try {
      const n = await autoAssignSundayBaysToSpecialist(week, ids, specialist);
      setStatus(
        `Auto-assigned ${n} bay${n === 1 ? "" : "s"} to you (Flooring DS).`
      );
      await reload();
      onChanged?.();
      playSuccessTone();
    } catch (err) {
      setError(readableError(err, "Could not auto-assign bays"));
      playErrorTone();
    } finally {
      setBusy(false);
    }
  }

  async function handleApproveWeekCapacity() {
    if (!week || !capacityBoard) return;
    if (!isMasterAdmin(specialist)) {
      setCapacityError("Only Master Admin can approve weekly bay capacity.");
      playErrorTone();
      return;
    }
    setCapacityBusy(true);
    setCapacityError(null);
    try {
      const items = capacityBoard.associates
        .filter((row) => row.eligible)
        .map((row) => ({
          specialist_id: row.specialist_id,
          approved_capacity: Math.max(
            0,
            Math.min(
              3,
              Math.floor(capacityDraft[row.specialist_id] ?? row.suggested_capacity)
            )
          ),
        }));
      const board = await approveWeekCapacity(specialist, { week, items });
      setCapacityBoard(board);
      const draft: Record<string, number> = {};
      for (const row of board.associates) {
        draft[row.specialist_id] =
          row.approved_capacity ?? row.suggested_capacity;
      }
      setCapacityDraft(draft);
      setStatus(
        `Approved weekly capacity · shared target ${board.shared_target_approved} bay${
          board.shared_target_approved === 1 ? "" : "s"
        }.`
      );
      playSuccessTone();
    } catch (err) {
      setCapacityError(
        readableError(err, "Could not approve weekly capacity")
      );
      playErrorTone();
    } finally {
      setCapacityBusy(false);
    }
  }

  async function handleBalanceAssign() {
    if (!week || bays.length === 0) return;
    // OPERATIONAL-009 — capacity board + stewardship required; legacy balancer
    // must not create new weekly ownership without approved capacity.
    if (!capacityBoard) {
      setError(
        "Weekly capacity board is required before assigning. Refresh and try again."
      );
      playErrorTone();
      return;
    }
    if (!capacityBoard.approvals_complete) {
      setError(
        "Approve weekly bay capacity for every eligible associate before assigning."
      );
      playErrorTone();
      return;
    }
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      // Recompose from persisted schedule at click time — never localStorage hours.
      const range = isoWeekCalendarRange(week);
      const days = await fetchShiftDaysRange(
        range.startDate,
        range.endDate,
        getStoreNumber()
      );
      const labor = composeWeekLaborAvailability({
        department: FLOORING_STAGING_DEPT,
        week_label: week,
        dates: range.dates,
        workforce: roster.map((m) => ({
          id: String(m.id),
          role: m.role,
          is_active: m.is_active,
          home_department: m.home_department,
          assigned_department: m.assigned_department,
          name: m.name,
        })),
        persisted_shift_days: shiftDaysToLabRows(days),
        workforce_evidence_available: true,
        schedule_evidence_available: true,
        as_of: new Date().toISOString(),
      });
      setWeekLabor(labor);

      if (labor.members.length === 0) {
        setError(
          "No active associates are available for weekly assignment (Master excluded; home department only)."
        );
        playErrorTone();
        return;
      }

      // AUTO-005A: shift rows are not required for weekly bay assignment.
      const members = weekLaborToAssignmentMembers(labor.members);
      const ownedBySpecialist: Record<string, number> = {};
      let ownedTotal = 0;
      const ownedRotationIds: string[] = [];
      for (const row of bays) {
        const locked = row.assignment?.supervisor_locked === true;
        const owner = String(row.assignment?.specialist_id ?? "").trim();
        if (locked) ownedRotationIds.push(String(row.rotation.id));
        if (!owner) continue;
        ownedTotal += 1;
        ownedBySpecialist[owner] = (ownedBySpecialist[owner] ?? 0) + 1;
        if (!locked) ownedRotationIds.push(String(row.rotation.id));
      }
      const approvedBySpecialist: Record<string, number> = {};
      for (const row of capacityBoard.associates) {
        if (
          row.eligible &&
          row.approval_status === "approved" &&
          row.approved_capacity != null
        ) {
          approvedBySpecialist[row.specialist_id] = row.approved_capacity;
        }
      }

      const capacity = buildPreviewCapacityCaps({
        eligibleSpecialistIds: members.map((m) => m.specialist_id),
        ownedBySpecialist,
        ownedTotal,
        approvedBySpecialist,
      });
      const priorityKeys = new Set(
        supervisorPriorities.map((p) => p.physical_key)
      );
      const bayRefs = bays.map((bayRow) => {
        const department_id = String(
          bayRow.rotation.store_locations?.department_id ??
            flooringDept?.id ??
            ""
        ).trim();
        return {
          rotationId: bayRow.rotation.id,
          department_id,
          aisle: bayRow.aisle,
          bay: bayRow.bay,
          riskScore: riskScoreFromFinding(
            healthByRotation.get(bayRow.rotation.id)
          ),
          carried_over: Boolean(
            (bayRow.rotation as { carried_over?: boolean }).carried_over
          ),
          supervisor_priority: priorityKeys.has(
            sectionAwarePhysicalKey({
              department_id,
              aisle: bayRow.aisle,
              bay: bayRow.bay,
            })
          ),
        };
      });
      const recomputed = composeStewardshipWeeklyProposal({
        store_number: getStoreNumber(),
        week_label: week,
        tiers: classifyBayPriorityTier(bayRefs),
        bays: bayRefs,
        members,
        baySectionByKey,
        conflictPhysicalKeys: sectionConflictKeys,
        ownedRotationIds,
        capacity,
        knownHoursOnly: true,
        supervisorPriorities,
      });
      if (!recomputed.actionable) {
        setError(
          recomputed.block_reason ||
            "Weekly capacity approvals are incomplete — cannot assign."
        );
        playErrorTone();
        return;
      }
      if (stewardshipProposal) {
        const freshness = assertStewardshipProposalFresh(
          stewardshipProposal.fingerprint,
          recomputed
        );
        if (!freshness.ok) {
          setError(freshness.message);
          playErrorTone();
          return;
        }
      }

      const planItems = recomputed.items.map((row) => ({
        rotationId: row.rotationId,
        specialist_id: row.specialist_id,
        specialist_name: formatSpecialistShiftLabel(
          row.specialist_name,
          row.hours
        ),
        hours: row.hours,
      }));

      if (planItems.length === 0) {
        const achievable = recomputed.shared_target;
        setError(
          recomputed.block_reason ||
            `Section ownership distributor could not allocate owners (achievable ${recomputed.owned_total}/${achievable} against approved capacity). Check schedules, owned sections, and remaining capacity.`
        );
        playErrorTone();
        return;
      }

      // Every persisted item must have an explicit owner (distributor contract).
      for (const item of planItems) {
        if (!String(item.specialist_id).trim()) {
          setError("Proposal contained an unowned bay — assignment aborted.");
          playErrorTone();
          return;
        }
      }

      const n = await applySundayAssignmentPlan(week, planItems);
      const partialNote =
        labor.processing_status === "PARTIAL"
          ? " Partial schedule evidence — only known hours were used."
          : "";
      const shortfall =
        pending > n
          ? ` ${pending - n} staged bay${pending - n === 1 ? "" : "s"} remain beyond approved capacity (${recomputed.shared_target}) and were not assigned.`
          : "";
      setStatus(
        `Assigned ${n} physical bay${n === 1 ? "" : "s"} with stewardship owners across ${recomputed.loads.length} eligible associate${
          recomputed.loads.length === 1 ? "" : "s"
        } (${recomputed.total_hours}h known).${partialNote}${shortfall}`
      );
      await reload();
      onChanged?.();
      playSuccessTone();
    } catch (err) {
      setError(readableError(err, "Could not apply stewardship assignment"));
      playErrorTone();
    } finally {
      setBusy(false);
    }
  }

  async function handleGenerateFlooring() {
    if (!flooringDept) {
      setError("Flooring department not found — seed store-ops departments first.");
      return;
    }
    if (!isMasterAdmin(specialist)) {
      setError("Master Admin is required to recalculate the Sunday rotation.");
      return;
    }
    const replacing = bays.length > 0;
    if (replacing) {
      const ok = window.confirm(
        `A Flooring rotation is already staged for ${week || "this week"}. Recalculate and replace incomplete bays? Specialist assignments on those bays will be cleared. Completed bays stay.`
      );
      if (!ok) return;
    }
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const eligible =
        weekLabor?.processing_status !== "UNAVAILABLE"
          ? weekLabor?.allocatable.length ?? 0
          : 0;
      const drawCount = resolveWeeklyStageDrawCount({
        eligibleAssociateCount: eligible,
        approvalsComplete: Boolean(capacityBoard?.approvals_complete),
        sharedTargetApproved: capacityBoard?.shared_target_approved,
        fallbackWhenUnknown: 12,
      });
      const result = await generateRotations(specialist, flooringDept.id, drawCount, {
        force: replacing,
      });
      if (result.skipped) {
        setStatus(result.reason || "Week already staged.");
      } else {
        const targetNote = capacityBoard?.approvals_complete
          ? `target ${drawCount} = approved shared capacity`
          : `target ${drawCount} = ${eligible || "?"} × ${BASE_WEEKLY_BAY_QUOTA}`;
        setStatus(
          `Staged week ${result.assigned_week}: ${result.created} Flooring physical bay${
            result.created === 1 ? "" : "s"
          } drawn (${targetNote})${
            result.replaced ? ` (replaced ${result.replaced})` : ""
          }. Review the stewardship proposal, then confirm Assign this week to persist owners.`
        );
      }
      await reload();
      onChanged?.();
      playSuccessTone();
    } catch (err) {
      setError(readableError(err, "Could not stage Sunday Flooring rotation"));
      playErrorTone();
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 backdrop-blur-md sm:items-center">
      <button
        type="button"
        aria-label="Close Sunday audit assignment"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="glass-card theme-modal relative z-10 flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden !rounded-b-none sm:!rounded-2xl"
      >
        <header className="flex shrink-0 items-start gap-3 border-b border-zinc-800/80 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-accent">
              Sunday Rotation Engine · D23 Flooring
            </p>
            <h2 id={titleId} className="glass-title mt-1 text-base leading-snug">
              {headline}
            </h2>
            {week ? (
              <p className="mt-0.5 font-mono text-[10px] text-zinc-500">
                Week {week}
                {flooringDept ? ` · ${flooringDept.name}` : ""}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-xl border border-zinc-700 text-zinc-200"
            aria-label="Close"
          >
            ✕
          </button>
        </header>

        <div className="hub-modal-sheet min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pt-4">
          <div className="rounded-xl border border-zinc-700/80 bg-zinc-950/60 px-3 py-2.5">
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-400">
              This week&apos;s staged work
            </p>
            <p className="mt-1 text-sm font-semibold text-zinc-50">
              {bays.length} Flooring bay{bays.length === 1 ? "" : "s"} staged
              {pending > 0
                ? ` · ${pending} still need a person`
                : bays.length > 0
                  ? " · owners set"
                  : ""}
            </p>
            <p className="mt-1.5 text-[11px] leading-snug text-zinc-400">
              {bays.length === 0
                ? "Sunday automatic dispatch should leave a complete person → bay plan. Use Stage only for recovery when the cron missed or failed."
                : pending > 0
                  ? "Staged but unowned — approve weekly capacity if needed, review the stewardship proposal (every bay has an owner), then confirm Assign this week once. One assignment covers the full physical bay."
                  : "Weekly ownership is set (approved capacity + stewardship). Recalculate only if you need a new bay set."}
            </p>
          </div>

          {status ? (
            <p
              role="status"
              className="rounded-xl border border-emerald-500/30 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-200"
            >
              {status}
            </p>
          ) : null}
          {error ? (
            <p
              role="alert"
              className="rounded-xl border border-rose-500/40 bg-rose-950/40 px-3 py-2 text-sm text-rose-200"
            >
              {error}
            </p>
          ) : null}

          {bays.length === 0 ? (
            <button
              type="button"
              disabled={busy || !flooringDept || !isMasterAdmin(specialist)}
              onClick={() => void handleGenerateFlooring()}
              className="flex min-h-[44px] w-full items-center justify-center rounded-xl border border-amber-400/45 bg-amber-950/35 px-3 text-sm font-bold text-amber-100 disabled:opacity-40"
            >
              {busy ? "Staging…" : "Stage / Draw 12 Flooring Bays"}
            </button>
          ) : null}

          {week && capacityBoard ? (
            <section
              data-testid="week-capacity-review"
              className="rounded-xl border border-amber-500/30 bg-amber-950/20 p-3"
            >
              <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-amber-300">
                Weekly bay capacity · {capacityBoard.week_label}
              </p>
              <p className="mt-1 text-[11px] leading-snug text-amber-100/75">
                Department schedule evidence only. Suggested {BASE_WEEKLY_BAY_QUOTA}{" "}
                is not an approval — confirm each eligible associate (0–3).
                Shared target{" "}
                {capacityBoard.approvals_complete
                  ? capacityBoard.shared_target_approved
                  : capacityBoard.shared_target_proposed}{" "}
                ·{" "}
                {capacityBoard.approvals_complete
                  ? "approved"
                  : "not approved yet"}
              </p>
              {capacityError ? (
                <p
                  role="alert"
                  className="mt-2 text-[12px] leading-snug text-rose-200"
                >
                  {capacityError}
                </p>
              ) : null}
              <ul className="mt-2 space-y-2">
                {capacityBoard.associates.map((row) => (
                  <li
                    key={row.specialist_id}
                    data-testid={`week-capacity-row-${row.specialist_id}`}
                    className="rounded-lg border border-amber-500/20 bg-zinc-950/40 px-2.5 py-2"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-sm font-semibold text-white">
                        {row.specialist_name}
                      </span>
                      <span className="font-mono text-[10px] uppercase text-amber-200/80">
                        {row.approval_status}
                        {row.approved_capacity != null
                          ? ` · ${row.approved_capacity}`
                          : ""}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-amber-100/65">
                      {row.scheduled_department_days} dept day
                      {row.scheduled_department_days === 1 ? "" : "s"} ·{" "}
                      {row.known_available_hours}h
                      {row.owned_count > 0
                        ? ` · ${row.owned_count} already assigned`
                        : ""}
                      {!row.eligible ? " · not eligible" : ""}
                    </p>
                    {row.eligible ? (
                      <label className="mt-1.5 flex items-center gap-2 text-[12px] text-amber-50">
                        <span className="shrink-0">Capacity</span>
                        <select
                          data-testid={`week-capacity-select-${row.specialist_id}`}
                          className="min-h-[40px] flex-1 rounded-lg border border-amber-400/30 bg-zinc-950 px-2 text-sm text-white"
                          value={
                            capacityDraft[row.specialist_id] ??
                            row.suggested_capacity
                          }
                          disabled={capacityBusy || !isMasterAdmin(specialist)}
                          onChange={(e) => {
                            const n = Number(e.target.value);
                            setCapacityDraft((prev) => ({
                              ...prev,
                              [row.specialist_id]: n,
                            }));
                          }}
                        >
                          {[0, 1, 2, 3].map((n) => (
                            <option key={n} value={n}>
                              {n}
                              {n === row.suggested_capacity ? " (suggested)" : ""}
                              {row.owned_count > n ? " — below owned" : ""}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                data-testid="week-capacity-approve"
                disabled={
                  capacityBusy ||
                  busy ||
                  !isMasterAdmin(specialist) ||
                  capacityBoard.associates.every((r) => !r.eligible)
                }
                onClick={() => void handleApproveWeekCapacity()}
                className="mt-3 flex min-h-[44px] w-full items-center justify-center rounded-xl border border-amber-400/50 bg-amber-950/50 px-3 text-sm font-bold text-amber-50 disabled:opacity-40"
              >
                {capacityBusy
                  ? "Approving…"
                  : capacityBoard.approvals_complete
                    ? "Re-approve weekly capacity"
                    : "Approve weekly capacity"}
              </button>
            </section>
          ) : null}

          {bays.length > 0 && pending > 0 ? (
            <section
              data-testid="week-assign-cue"
              className="rounded-xl border border-cyan-500/30 bg-cyan-950/20 p-3"
            >
              <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-cyan-300">
                Who owns these bays this week?
              </p>
              {!capacityBoard ? (
                <p
                  data-testid="week-assign-capacity-required"
                  className="mt-1.5 text-[13px] leading-snug text-amber-100"
                >
                  Weekly capacity board is required before ownership can be
                  proposed. Refresh this drawer and try again.
                </p>
              ) : weekLabor &&
                weekLabor.processing_status !== "UNAVAILABLE" &&
                weekLabor.allocatable.length > 0 ? (
                <>
                  <p className="mt-1 text-[11px] text-cyan-100/70">
                    Floor Command prepares full ownership from approved capacity
                    inside each associate&apos;s Operational Section
                    {` across ${bays.length} staged bay${
                      bays.length === 1 ? "" : "s"
                    }`}
                    . Confirm once to persist — no manual owner picking or
                    cross-section balancing.
                  </p>
                  {stewardshipProposal ? (
                    <div
                      data-testid="stewardship-week-proposal"
                      className="mt-3 rounded-lg border border-teal-500/30 bg-teal-950/25 p-2.5"
                    >
                      <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-teal-300">
                        {stewardshipProposal.actionable
                          ? "PROPOSED · section ownership"
                          : "BLOCKED · ownership / capacity"}
                      </p>
                      <p className="mt-1 text-[11px] leading-snug text-teal-100/75">
                        Week {stewardshipProposal.week_label}. Not assigned until
                        confirmed. Capacity {stewardshipProposal.owned_total}/
                        {stewardshipProposal.shared_target} · remaining{" "}
                        {stewardshipProposal.remaining_shared}. Owned-section
                        picks {stewardshipProposal.steward_match_count}.
                      </p>
                      <p className="mt-1 text-[10px] leading-snug text-teal-200/60">
                        {stewardshipProposal.distribution_note}
                      </p>
                      {stewardshipProposal.associate_summaries.length > 0 ? (
                        <ul
                          data-testid="section-ownership-associate-summary"
                          className="mt-2 space-y-1.5 text-[12px] text-teal-50"
                        >
                          {stewardshipProposal.associate_summaries.map((row) => (
                            <li
                              key={row.specialist_id}
                              className="rounded-md border border-teal-500/15 bg-zinc-950/30 px-2 py-1.5"
                            >
                              <div>
                                {row.specialist_name}
                                {row.section_name
                                  ? ` · ${row.section_name}`
                                  : " · no owned section"}
                              </div>
                              <p className="mt-0.5 font-mono text-[10px] text-teal-200/75">
                                Approved {row.approved_capacity} · proposed{" "}
                                {row.proposed_count}
                                {row.aisles.length > 0
                                  ? ` · aisles ${row.aisles.join(", ")}`
                                  : ""}
                                {row.unfilled > 0
                                  ? ` · unfilled ${row.unfilled}`
                                  : ""}
                              </p>
                              {row.unfilled_reason ? (
                                <p className="mt-0.5 text-[10px] leading-snug text-amber-200/85">
                                  {row.unfilled_reason}
                                </p>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      {stewardshipProposal.actionable &&
                      stewardshipProposal.items.length < pending ? (
                        <p
                          role="status"
                          data-testid="stewardship-partial-achievable"
                          className="mt-1 text-[11px] leading-snug text-amber-200"
                        >
                          Achievable owned proposal:{" "}
                          {stewardshipProposal.items.length} of {pending}{" "}
                          unowned staged (approved shared target{" "}
                          {stewardshipProposal.shared_target}). Excess staged
                          bays beyond capacity or outside owned sections stay
                          unassigned.
                        </p>
                      ) : null}
                      {stewardshipProposal.block_reason ? (
                        <p
                          role="status"
                          className="mt-1 text-[11px] leading-snug text-amber-200"
                        >
                          {stewardshipProposal.block_reason}
                        </p>
                      ) : null}
                      {stewardshipProposal.supervisor_priorities.length > 0 ? (
                        <ul
                          data-testid="supervisor-week-priorities"
                          className="mt-2 space-y-1.5 text-[12px] text-teal-50"
                        >
                          <li className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-amber-200/90">
                            Supervisor priorities (intent only)
                          </li>
                          {stewardshipProposal.supervisor_priorities.map(
                            (prio) => {
                              const statusLabel =
                                prio.status === "included_in_proposal"
                                  ? "Included in proposal"
                                  : prio.status === "already_assigned"
                                    ? "Already assigned"
                                    : prio.status === "not_included"
                                      ? "Not included"
                                      : "Priority requested";
                              return (
                                <li
                                  key={prio.physical_key}
                                  data-testid="supervisor-week-priority-row"
                                  data-status={prio.status}
                                  className="rounded-md border border-amber-500/20 bg-amber-950/20 px-2 py-1.5"
                                >
                                  <div>
                                    <span className="font-mono text-[9px] uppercase text-amber-200/90">
                                      {statusLabel}
                                    </span>{" "}
                                    Aisle {prio.aisle} Bay {prio.bay}
                                    {prio.section_name
                                      ? ` · ${prio.section_name}`
                                      : ""}
                                    {prio.owner_name
                                      ? ` · ${prio.owner_name}`
                                      : ""}
                                  </div>
                                  <p className="mt-0.5 text-[10px] leading-snug text-amber-100/70">
                                    {prio.reason}
                                  </p>
                                </li>
                              );
                            }
                          )}
                        </ul>
                      ) : null}
                      {stewardshipProposal.actionable &&
                      stewardshipProposal.items.length > 0 ? (
                        <ul
                          data-testid="week-assign-preview"
                          className="mt-2 max-h-48 space-y-1.5 overflow-y-auto text-[12px] text-teal-50"
                        >
                          {stewardshipProposal.items.map((item) => (
                            <li
                              key={item.rotationId}
                              className="rounded-md border border-teal-500/15 bg-zinc-950/30 px-2 py-1.5"
                            >
                              <div>
                                <span className="font-mono text-[9px] uppercase text-teal-300/90">
                                  PROPOSED
                                </span>{" "}
                                {item.specialist_name} → Aisle {item.aisle} Bay{" "}
                                {item.bay}
                                {item.section_name
                                  ? ` · ${item.section_name}`
                                  : ""}
                                {item.explanation.codes.includes(
                                  "supervisor_week_priority"
                                ) ? (
                                  <span className="ml-1 font-mono text-[9px] uppercase text-amber-200/90">
                                    · priority requested
                                  </span>
                                ) : null}
                              </div>
                              <p className="mt-0.5 text-[10px] leading-snug text-teal-100/65">
                                {item.explanation.summary}
                              </p>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ) : capacityBoard.approvals_complete ? (
                    <p className="mt-2 text-[12px] leading-snug text-amber-100">
                      Building stewardship proposal…
                    </p>
                  ) : (
                    <ul
                      data-testid="week-assign-preview"
                      className="mt-2 space-y-1 text-sm text-cyan-50"
                    >
                      {balancerPlan.loads.map((load) => (
                        <li key={load.specialist_id}>
                          {load.specialist_name} → up to {load.quota} bay
                          {load.quota === 1 ? "" : "s"} (approve capacity to
                          lock stewardship owners)
                        </li>
                      ))}
                    </ul>
                  )}
                  {sectionAwarePreviewOn && sectionAwarePreview ? (
                    <div
                      data-testid="section-aware-assign-preview"
                      className="mt-3 rounded-lg border border-violet-500/30 bg-violet-950/25 p-2.5"
                    >
                      <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-violet-300">
                        PROPOSED · section-aware (opt-in preview only)
                      </p>
                      <p className="mt-1 text-[11px] leading-snug text-violet-100/75">
                        Preview only — Assign this week uses stewardship +
                        approved capacity, not this opt-in path.
                      </p>
                    </div>
                  ) : null}
                  <button
                    type="button"
                    data-testid="week-assign-confirm"
                    className="btn-primary-glow mt-3 flex min-h-[44px] w-full items-center justify-center rounded-xl px-3 text-sm disabled:opacity-40"
                    disabled={
                      busy ||
                      !capacityBoard.approvals_complete ||
                      !stewardshipProposal?.actionable ||
                      (stewardshipProposal?.items.length ?? 0) === 0
                    }
                    onClick={() => void handleBalanceAssign()}
                  >
                    {busy
                      ? "Assigning…"
                      : !capacityBoard.approvals_complete
                        ? "Assign this week (approve capacity first)"
                        : stewardshipProposal?.actionable &&
                            stewardshipProposal.items.length > 0
                          ? "Assign this week"
                          : "Assign this week (proposal not ready)"}
                  </button>
                </>
              ) : (
                <p
                  data-testid="week-assign-insufficient"
                  className="mt-1.5 text-[13px] leading-snug text-amber-100"
                >
                  Schedules for this week are incomplete, so DeptSync cannot
                  propose owners. Confirm start and end times on Roster first.
                  Missing times are not treated as 8 hours.
                </p>
              )}
            </section>
          ) : null}

          {extraBayOwners.length > 0 ? (
            <section
              data-testid="extra-bay-dispatch"
              className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-3"
            >
              <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-300">
                Add another bay
              </p>
              <p className="mt-1 text-[11px] text-emerald-100/70">
                Base plan is set ({BASE_WEEKLY_BAY_QUOTA} each). Give one more
                owed bay to someone who has capacity — others stay unchanged.
              </p>
              <ul className="mt-2 space-y-2">
                {extraBayOwners.map((owner) => (
                  <li
                    key={owner.specialistId}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-500/20 bg-zinc-950/40 px-2.5 py-2"
                  >
                    <span className="min-w-0 truncate text-sm font-semibold text-white">
                      {owner.specialistName}
                      <span className="ml-1.5 font-mono text-[10px] font-normal text-emerald-200/80">
                        {owner.count} this week
                      </span>
                    </span>
                    <button
                      type="button"
                      data-testid={`extra-bay-add-${owner.specialistId}`}
                      disabled={
                        busy ||
                        Boolean(extraBusyId) ||
                        !flooringDept
                      }
                      onClick={() =>
                        void handleSuggestExtraBay(
                          owner.specialistId,
                          owner.specialistName
                        )
                      }
                      className="shrink-0 rounded-lg border border-emerald-400/50 bg-emerald-950/50 px-2.5 py-1.5 text-[11px] font-bold text-emerald-100 disabled:opacity-40"
                    >
                      {extraBusyId === owner.specialistId
                        ? "Looking…"
                        : "Add another bay"}
                    </button>
                  </li>
                ))}
              </ul>
              {extraConfirm ? (
                <div
                  data-testid="extra-bay-confirm"
                  className="mt-3 rounded-lg border border-amber-400/40 bg-amber-950/30 p-2.5"
                >
                  <p className="text-[13px] text-amber-50">
                    Assign{" "}
                    <span className="font-mono font-semibold">
                      {extraConfirm.label}
                    </span>{" "}
                    to {extraConfirm.specialistName}?
                  </p>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      data-testid="extra-bay-confirm-yes"
                      disabled={busy || Boolean(extraBusyId)}
                      onClick={() => void handleConfirmExtraBay()}
                      className="btn-primary-glow flex min-h-[40px] flex-1 items-center justify-center rounded-xl px-3 text-sm disabled:opacity-40"
                    >
                      {extraBusyId ? "Assigning…" : "Confirm"}
                    </button>
                    <button
                      type="button"
                      data-testid="extra-bay-confirm-cancel"
                      disabled={Boolean(extraBusyId)}
                      onClick={() => {
                        setExtraConfirm(null);
                        setStatus(null);
                      }}
                      className="flex min-h-[40px] flex-1 items-center justify-center rounded-xl border border-zinc-600 px-3 text-sm text-zinc-300 disabled:opacity-40"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}
            </section>
          ) : null}

          {bays.length > 0 ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                disabled={busy || !flooringDept || !isMasterAdmin(specialist)}
                onClick={() => void handleGenerateFlooring()}
                className="flex min-h-[44px] items-center justify-center rounded-xl border border-amber-400/45 bg-amber-950/35 px-3 text-sm font-bold text-amber-100 disabled:opacity-40"
              >
                {busy ? "Staging…" : "Recalculate Flooring rotation"}
              </button>
              <button
                type="button"
                data-testid="auto-assign-me"
                disabled={busy}
                onClick={() => void handleAutoAssignMe()}
                className="flex min-h-[44px] items-center justify-center rounded-xl border border-zinc-700 bg-zinc-950/70 px-3 text-sm font-semibold text-zinc-300 disabled:opacity-40"
              >
                Auto-Assign All to Me (Flooring DS)
              </button>
            </div>
          ) : null}

          {shiftRoster.length > 0 ? (
            <section className="rounded-xl border border-zinc-800/80 bg-zinc-950/40 p-3">
              <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500">
                Sunday shift board
              </p>
              <p className="mt-1 text-[11px] text-zinc-500">
                Local hour chips for this device. They do not set this
                week&apos;s automatic distribution.
              </p>
              <ul className="mt-2 space-y-2">
                {shiftRoster.map((row) => {
                  const member = roster.find(
                    (m) => String(m.id) === row.specialist_id
                  );
                  const match = member
                    ? associateMatchesSundayDepartment(
                        member,
                        FLOORING_STAGING_DEPT
                      )
                    : false;
                  const canToggle = isMasterAdmin(specialist) || match;
                  return (
                  <li
                    key={row.specialist_id}
                    className="rounded-lg border border-zinc-800/80 bg-zinc-950/50 px-2.5 py-2"
                  >
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={row.active}
                        disabled={!canToggle}
                        onChange={(e) =>
                          patchMember(row.specialist_id, {
                            active: e.target.checked,
                          })
                        }
                        className="h-5 w-5 accent-cyan-500"
                      />
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-white">
                        {row.specialist_name}
                        {member ? (
                          <span
                            className={`ml-1.5 inline-flex rounded-full border px-1.5 py-px font-mono text-[9px] font-bold uppercase tracking-wide ${
                              match
                                ? "border-cyan-400/40 text-cyan-200"
                                : "border-zinc-600 text-zinc-400"
                            }`}
                          >
                            {rosterJobTitleLabel(member)}
                          </span>
                        ) : null}
                      </span>
                      <span className="shrink-0 font-mono text-[10px] text-zinc-400">
                        {row.active ? `${row.hours}h` : "off"}
                      </span>
                    </label>
                    {row.active ? (
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-[9px] font-bold uppercase tracking-wide text-zinc-500">
                          Hours
                        </span>
                        {SHIFT_HOUR_PRESETS.map((h) => (
                          <button
                            key={h}
                            type="button"
                            onClick={() =>
                              patchMember(row.specialist_id, {
                                hours: h,
                                start: undefined,
                                end: undefined,
                              })
                            }
                            className={`rounded-lg border px-2 py-1 text-[10px] font-bold ${
                              row.hours === h && !row.start
                                ? "border-cyan-400/60 bg-cyan-950/50 text-cyan-100"
                                : "border-zinc-700 text-zinc-300"
                            }`}
                          >
                            {h}h
                          </button>
                        ))}
                        <input
                          type="time"
                          aria-label={`${row.specialist_name} start`}
                          value={row.start ?? ""}
                          onChange={(e) =>
                            patchMember(row.specialist_id, {
                              start: e.target.value || undefined,
                            })
                          }
                          className="glass-input h-9 w-[6.5rem] px-1.5 text-[11px]"
                        />
                        <span className="text-[10px] text-zinc-500">→</span>
                        <input
                          type="time"
                          aria-label={`${row.specialist_name} end`}
                          value={row.end ?? ""}
                          onChange={(e) =>
                            patchMember(row.specialist_id, {
                              end: e.target.value || undefined,
                            })
                          }
                          className="glass-input h-9 w-[6.5rem] px-1.5 text-[11px]"
                        />
                      </div>
                    ) : null}
                  </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          <AssociateRosterPanel
            compact
            specialist={specialist}
            roster={roster}
            stagingDepartment={FLOORING_STAGING_DEPT}
            selectionSummary={selectionSummary.label}
            onRosterChange={(next) => {
              const assignable = sundayAssignableRoster(next);
              setRoster(assignable);
              persistRoster(
                mergeShiftRoster(
                  assignable,
                  shiftRoster,
                  sundayShiftSeedActive(FLOORING_STAGING_DEPT)
                )
              );
            }}
            shiftHours={Object.fromEntries(
              shiftRoster.map((row) => [row.specialist_id, row.hours])
            )}
            shiftActive={Object.fromEntries(
              shiftRoster.map((row) => [row.specialist_id, row.active])
            )}
            onShiftHoursChange={(patch) => {
              const exists = shiftRoster.some(
                (row) => row.specialist_id === patch.specialist_id
              );
              if (!exists) {
                const member = roster.find(
                  (m) => String(m.id) === patch.specialist_id
                );
                persistRoster([
                  ...shiftRoster,
                  {
                    specialist_id: patch.specialist_id,
                    specialist_name: member?.name ?? "Associate",
                    active: patch.active !== false,
                    hours: patch.hours,
                  },
                ]);
                return;
              }
              patchMember(patch.specialist_id, {
                hours: patch.hours,
                ...(patch.active !== undefined ? { active: patch.active } : {}),
              });
            }}
          />

          {loading ? (
            <p className="py-8 text-center text-sm text-zinc-400">
              Loading pending Flooring bays…
            </p>
          ) : bays.length === 0 ? (
            <p className="glass-card border-dashed px-4 py-8 text-center text-sm text-zinc-400">
              No open Flooring rotation bays this week. Use{" "}
              <span className="font-semibold text-amber-200">
                Stage / Draw 12 Flooring Bays
              </span>{" "}
              or More → Generate this week&apos;s list (Master Admin).
            </p>
          ) : (
            <ul className="space-y-2">
              {bays.map((bay) => (
                <li
                  key={bay.rotation.id}
                  className="rounded-xl border border-zinc-800/80 bg-zinc-950/55 px-3 py-2.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-mono text-sm font-semibold tracking-tight tabular-nums text-white">
                        {bay.label}
                      </p>
                      <p className="font-mono text-[10px] tracking-tight tabular-nums text-zinc-500">
                        {formatBayTag({ aisle: bay.aisle, bay: bay.bay })}
                        {bay.assignment
                          ? ` · → ${bay.assignment.specialist_name}`
                          : " · unassigned"}
                      </p>
                      <p className="mt-1">
                        <CarryOverPriorityBadge
                          location={bay.rotation.store_locations}
                          assignment={bay.assignment}
                        />
                      </p>
                    </div>
                    {!bay.assignment ? (
                      <span className="glass-pill-amber shrink-0">Pending</span>
                    ) : bay.assignment.is_carried_over ||
                      String(bay.assignment.status ?? "").toUpperCase() ===
                        "CARRIED_OVER" ? (
                      <span className="glass-pill-amber shrink-0 font-mono tracking-tight">
                        Carry-over
                      </span>
                    ) : (
                      <span className="glass-pill-emerald shrink-0">Assigned</span>
                    )}
                  </div>
                  <label className="mt-2 block">
                    <span className="glass-label mb-1 block text-xs">
                      Assign specialist
                    </span>
                    <select
                      className="glass-input min-h-[44px] text-sm font-semibold"
                      value={bay.assignment?.specialist_id ?? ""}
                      onChange={(e) =>
                        void handleAssign(bay.rotation.id, e.target.value)
                      }
                    >
                      <option value="">Unassigned</option>
                      {roster.map((m) => (
                        <option key={m.id} value={String(m.id)}>
                          {m.name}
                          {m.role === "MasterAdmin" ? " (Master / Flooring DS)" : ""}
                          {m.role === "Supervisor" ? " (Supervisor)" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
