"use client";

/**
 * People tab — rotation participation and schedule evidence.
 *
 * Pipeline: "+ Add Team Member" → AddTeamMemberSheet →
 *   POST /api/roster/members → createRosterMember → store_specialists (roster-only).
 * Device pairing: SpecialistEditSheet → POST /api/roster/pair (10-minute QR).
 * Accordions: fetchSpecialists(storeNumber) SELECTs store_specialists, then
 *   composeRosterDepartmentGroups. On-now counts come from derived availability.
 *
 * UX-REDUCE-004: People + schedule first. Access/device admin secondary.
 * Capability is not availability. accessible_departments is authority scope.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Plus } from "lucide-react";
import { DepartmentPicker } from "@/components/hub/DepartmentPicker";
import { DepartmentIcon } from "@/components/hub/NavIcons";
import { SpecialistCard } from "@/components/hub/SpecialistCard";
import { SpecialistEditSheet } from "@/components/hub/SpecialistEditSheet";
import { TextField } from "@/components/ui/NumberField";
import { redistributeCallOutBays } from "@/lib/store-ops/call-out";
import {
  composeCurrentAvailability,
  isScheduledNow,
  previousStoreLocalWorkDate,
  storeLocalWorkDate,
} from "@/lib/store-ops/current-availability";
import {
  composeNextScheduledOpportunity,
  countWeeklyOwnership,
  isoWeekLabelFromStoreDate,
} from "@/lib/store-ops/next-opportunity";
import {
  formatOwnedBayCaption,
  formatPeopleCount,
} from "@/lib/store-ops/roster-people-presentation";
import { useStoreClockTick } from "@/lib/store-ops/use-store-clock";
import { DEFAULT_STORE_TIMEZONE } from "@/lib/store-ops/sunday-schedule";
import { composeRosterDepartmentGroups } from "@/lib/store-ops/roster-groups";
import {
  fetchSundayAssignments,
  type SundayAssignmentMap,
} from "@/lib/store-ops/sunday-audit";
import { isoWeekCalendarRange } from "@/lib/store-ops/week";
import {
  canAccessDepartment,
  composeAccessibleDepartments,
} from "@/lib/department-access";
import {
  canGrantDepartmentAccess,
  canManageShiftBoard,
  canManageTeamRoster,
  isMasterAdmin,
  suggestUsername,
} from "@/lib/rbac";
import {
  dedupeRoster,
  deleteSpecialist,
  fetchSpecialists,
  invalidateRosterCache,
  isDatabaseUuid,
  mapRow,
} from "@/lib/specialists";
import { updateDepartmentAccess, createRosterMember } from "@/lib/store-ops/client";
import type { InviteSupervisorResult } from "@/lib/store-ops/client";
import {
  composeShiftBoard,
  DEFAULT_SHIFT_END,
  DEFAULT_SHIFT_START,
  fetchShiftDaysRange,
  fetchStoreTimezone,
  localWorkDate,
  retailWeekDates,
  retailWeekStart,
  SHIFT_STATUS_EVENT,
  shiftRowKey,
  sliceShiftDaysForDate,
  upsertShiftDay,
  type AssociateShiftDay,
} from "@/lib/store-ops/shift-status";
import { toastError, toastSuccess } from "@/lib/toast";
import {
  ROSTER_JOB_GROUPS,
  ROSTER_JOB_OPTIONS,
  resolveRosterJobSave,
  rosterJobOptionById,
  specialistHomeDepartment,
  type DepartmentScope,
  type OperationalDepartment,
  type StoreSpecialist,
} from "@/lib/types";
import { normalizePhoneE164 } from "@/lib/phone";
import { useFocusedWorkspace } from "@/lib/ui/focused-workspace";
import { useWorkingDepartment } from "@/lib/use-working-department";
import type { WorkflowTabProps } from "@/components/hub/tabs/tab-props";

const ICON_STROKE = 1.75;

function scheduleFetchWindow(input: {
  storeToday: string;
  storeYesterday: string;
  weekStart: string;
  weekEnd: string;
}): { isoWeek: string; rangeStart: string; rangeEnd: string } {
  const isoWeek = isoWeekLabelFromStoreDate(input.storeToday);
  const iso = isoWeekCalendarRange(isoWeek);
  const starts = [input.storeYesterday, input.weekStart, iso.startDate].sort();
  const ends = [input.storeToday, input.weekEnd, iso.endDate].sort();
  return {
    isoWeek,
    rangeStart: starts[0]!,
    rangeEnd: ends[ends.length - 1]!,
  };
}

function homeDepartment(member: StoreSpecialist): DepartmentScope {
  return specialistHomeDepartment(member);
}

function memberFromCreateResult(
  result: InviteSupervisorResult,
  storeNumber: string
): StoreSpecialist | null {
  if (!result.ok) return null;
  const raw =
    result.specialist && typeof result.specialist === "object"
      ? {
          ...result.specialist,
          store_number: result.specialist.store_number ?? storeNumber,
        }
      : result.specialist_id
        ? {
            id: result.specialist_id,
            store_number: storeNumber,
            name: result.name,
            role: "Associate",
            username: result.username,
            assigned_department: result.department,
            phone_number: result.phone,
            is_active: true,
            status: result.status ?? "active",
            created_at: new Date().toISOString(),
          }
        : null;
  if (!raw) return null;
  const mapped = mapRow(raw);
  if (!isDatabaseUuid(mapped.id) || !mapped.name.trim()) return null;
  return mapped;
}

export function RosterTab({ specialist, storeNumber }: WorkflowTabProps) {
  const [roster, setRoster] = useState<StoreSpecialist[]>([]);
  const [weekRows, setWeekRows] = useState<Record<string, AssociateShiftDay>>(
    {}
  );
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<StoreSpecialist | null>(
    null
  );
  const [openDepts, setOpenDepts] = useState<Record<string, boolean>>({});
  const [manageTarget, setManageTarget] = useState<StoreSpecialist | null>(
    null
  );
  const [callOutTarget, setCallOutTarget] = useState<StoreSpecialist | null>(
    null
  );
  const [reassignTarget, setReassignTarget] = useState<StoreSpecialist | null>(
    null
  );
  const [weekAssignments, setWeekAssignments] = useState<SundayAssignmentMap>(
    {}
  );
  const [assignmentsKnown, setAssignmentsKnown] = useState(false);
  const [storeTimezone, setStoreTimezone] = useState(DEFAULT_STORE_TIMEZONE);
  const clockNow = useStoreClockTick();
  const today = localWorkDate();
  const storeToday = storeLocalWorkDate(clockNow, storeTimezone);
  const storeYesterday = previousStoreLocalWorkDate(clockNow, storeTimezone);
  const weekStart = retailWeekStart(today);
  const weekDates = useMemo(() => retailWeekDates(weekStart), [weekStart]);
  const canManage = canManageTeamRoster(specialist);
  const canGrant = canGrantDepartmentAccess(specialist);
  const canShift = canManageShiftBoard(specialist);
  const working = useWorkingDepartment(specialist);

  // Remove-confirm owns the viewport while it is open (field-proven on Samsung).
  useFocusedWorkspace(Boolean(deleteTarget));

  const reload = useCallback(async () => {
    const weekEnd = weekDates[6] ?? today;
    const window = scheduleFetchWindow({
      storeToday,
      storeYesterday,
      weekStart,
      weekEnd,
    });
    try {
      const [tz, team, saved] = await Promise.all([
        fetchStoreTimezone(storeNumber),
        fetchSpecialists(storeNumber),
        fetchShiftDaysRange(window.rangeStart, window.rangeEnd, storeNumber),
      ]);
      setStoreTimezone(tz);
      const nextRoster = dedupeRoster(team);
      setRoster(nextRoster);
      setWeekRows(saved);
      setManageTarget((curr) =>
        curr ? nextRoster.find((row) => row.id === curr.id) ?? null : curr
      );
      const homes = [
        ...new Set(
          nextRoster
            .filter((row) => row.is_active !== false)
            .map((row) => homeDepartment(row))
            .filter((home) => home !== "all")
        ),
      ];
      try {
        const maps = await Promise.all(
          homes.map(async (dept) => {
            try {
              return await fetchSundayAssignments(
                window.isoWeek,
                storeNumber,
                dept
              );
            } catch {
              return {};
            }
          })
        );
        const merged: SundayAssignmentMap = {};
        for (const map of maps) Object.assign(merged, map);
        setWeekAssignments(merged);
        setAssignmentsKnown(true);
      } catch {
        setAssignmentsKnown(false);
      }
    } catch (err) {
      toastError(
        err instanceof Error ? err.message : "Could not load live roster"
      );
    }
  }, [today, weekDates, weekStart, storeNumber, storeToday, storeYesterday]);

  useEffect(() => {
    let cancelled = false;
    // Keep painted roster; never blank the list when returning to this tab.
    void reload().finally(() => {
      if (!cancelled) setLoading(false);
    });
    function onShift() {
      const weekEnd = weekDates[6] ?? today;
      const window = scheduleFetchWindow({
        storeToday,
        storeYesterday,
        weekStart,
        weekEnd,
      });
      void fetchShiftDaysRange(window.rangeStart, window.rangeEnd, storeNumber)
        .then(setWeekRows)
        .catch((err) => {
          toastError(
            err instanceof Error ? err.message : "Could not load live schedule"
          );
        });
    }
    window.addEventListener(SHIFT_STATUS_EVENT, onShift);
    return () => {
      cancelled = true;
      window.removeEventListener(SHIFT_STATUS_EVENT, onShift);
    };
  }, [reload, storeNumber, today, weekDates, weekStart, storeToday, storeYesterday]);

  const days = useMemo(
    () => sliceShiftDaysForDate(weekRows, storeToday),
    [weekRows, storeToday]
  );

  const board = useMemo(
    () => composeShiftBoard(roster, days, storeToday),
    [roster, days, storeToday]
  );
  const boardById = useMemo(() => {
    const map: Record<string, AssociateShiftDay> = {};
    for (const row of board) map[row.specialist_id] = row;
    return map;
  }, [board]);

  const groups = useMemo(() => {
    const visible = roster.filter((m) => {
      if (m.is_active === false) return false;
      if (isMasterAdmin(specialist)) return true;
      const home = homeDepartment(m);
      return home !== "all" && canAccessDepartment(specialist, home);
    });
    return composeRosterDepartmentGroups(visible, (m) => {
      const availability = composeCurrentAvailability({
        row: weekRows[shiftRowKey(String(m.id), storeToday)],
        previousDay: weekRows[shiftRowKey(String(m.id), storeYesterday)],
        now: clockNow,
        timeZone: storeTimezone,
      });
      return isScheduledNow(availability);
    });
  }, [roster, weekRows, specialist, clockNow, storeTimezone, storeToday, storeYesterday]);

  const displayGroups = useMemo(() => {
    if (working === "all") return groups;
    return groups.filter((group) => group.home === working);
  }, [groups, working]);

  const assignmentWeek = isoWeekLabelFromStoreDate(storeToday);

  useEffect(() => {
    if (working === "all") return;
    setOpenDepts((prev) =>
      prev[working] === true ? prev : { ...prev, [working]: true }
    );
  }, [working]);

  async function handleAccess(
    member: StoreSpecialist,
    next: OperationalDepartment[]
  ) {
    const primary = homeDepartment(member);
    const assigned = primary === "all" ? "flooring" : primary;
    const composed = composeAccessibleDepartments(assigned, next);
    const previous = roster;
    setRoster((curr) =>
      curr.map((row) =>
        row.id === member.id
          ? { ...row, accessible_departments: composed }
          : row
      )
    );
    setManageTarget((curr) =>
      curr && curr.id === member.id
        ? { ...curr, accessible_departments: composed }
        : curr
    );
    setBusyId(member.id);
    try {
      const result = await updateDepartmentAccess(specialist, {
        specialist_id: member.id,
        assigned_department: assigned,
        accessible_departments: composed,
      });
      const persisted = composeAccessibleDepartments(
        assigned,
        result.accessible_departments as OperationalDepartment[]
      );
      setRoster((curr) =>
        curr.map((row) =>
          row.id === member.id
            ? { ...row, accessible_departments: persisted }
            : row
        )
      );
      setManageTarget((curr) =>
        curr && curr.id === member.id
          ? { ...curr, accessible_departments: persisted }
          : curr
      );
      toastSuccess(`Updated permissions for ${member.name}`);
      await reload();
    } catch (err) {
      setRoster(previous);
      setManageTarget((curr) =>
        curr && curr.id === member.id
          ? previous.find((row) => row.id === member.id) ?? curr
          : curr
      );
      toastError(
        err instanceof Error
          ? err.message
          : `Could not update permissions for ${member.name}`
      );
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    setBusyId(target.id);
    const previous = roster;
    setRoster((curr) => curr.filter((s) => s.id !== target.id));
    try {
      await deleteSpecialist(target);
      toastSuccess(`Removed ${target.name} from the roster`);
      await reload();
    } catch (err) {
      setRoster(previous);
      toastError(
        err instanceof Error
          ? err.message
          : `Could not remove ${target.name}`
      );
    } finally {
      setBusyId(null);
    }
  }

  async function markCallOut(absent: StoreSpecialist, nextCallOut: boolean) {
    if (!nextCallOut) {
      const previous = weekRows;
      const existing = days[String(absent.id)];
      const optimistic: AssociateShiftDay = {
        specialist_id: String(absent.id),
        work_date: storeToday,
        start_time: existing?.start_time ?? DEFAULT_SHIFT_START,
        end_time: existing?.end_time ?? DEFAULT_SHIFT_END,
        is_scheduled_today: true,
        is_call_out: false,
        status: "ON_DUTY",
      };
      setWeekRows((curr) => ({
        ...curr,
        [shiftRowKey(optimistic.specialist_id, storeToday)]: optimistic,
      }));
      setBusyId(absent.id);
      try {
        const next = await upsertShiftDay(
          {
            specialist_id: String(absent.id),
            is_call_out: false,
            is_scheduled_today: true,
          },
          storeToday,
          storeNumber
        );
        setWeekRows((curr) => ({
          ...curr,
          [shiftRowKey(next.specialist_id, next.work_date)]: next,
        }));
        toastSuccess(`${absent.name} is scheduled today`);
      } catch (err) {
        setWeekRows(previous);
        toastError(
          err instanceof Error ? err.message : "Could not update duty status"
        );
      } finally {
        setBusyId(null);
      }
      return;
    }
    setCallOutTarget(absent);
  }

  async function recordCallOut() {
    if (!callOutTarget) return;
    const absent = callOutTarget;
    const previous = weekRows;
    const existing = days[String(absent.id)];
    const optimistic: AssociateShiftDay = {
      specialist_id: String(absent.id),
      work_date: storeToday,
      start_time: existing?.start_time ?? null,
      end_time: existing?.end_time ?? null,
      is_scheduled_today: true,
      is_call_out: true,
      status: "ABSENT_CALLOUT",
    };
    setWeekRows((curr) => ({
      ...curr,
      [shiftRowKey(optimistic.specialist_id, storeToday)]: optimistic,
    }));
    setBusyId(absent.id);
    try {
      const next = await upsertShiftDay(
        {
          specialist_id: String(absent.id),
          is_call_out: true,
          is_scheduled_today: true,
        },
        storeToday,
        storeNumber
      );
      setWeekRows((curr) => ({
        ...curr,
        [shiftRowKey(next.specialist_id, next.work_date)]: next,
      }));
      toastSuccess(`${absent.name} called out`);
      setCallOutTarget(null);
    } catch (err) {
      setWeekRows(previous);
      toastError(
        err instanceof Error ? err.message : "Could not record call-out"
      );
    } finally {
      setBusyId(null);
    }
  }

  async function applyReassign(mode: "pool" | "auto" | "carry") {
    if (!reassignTarget) return;
    const absent = reassignTarget;
    setBusyId(absent.id);
    try {
      const result = await redistributeCallOutBays({
        actor: specialist,
        absent,
        peers: roster,
        days: composeShiftBoard(roster, days, storeToday),
        mode,
      });
      const label =
        mode === "pool"
          ? "returned to the department pool"
          : mode === "auto"
            ? "auto-redistributed to on-duty peers"
            : "carried over to the next shift";
      toastSuccess(
        `${absent.name}: ${result.moved} bay${
          result.moved === 1 ? "" : "s"
        } ${label}`
      );
      setReassignTarget(null);
      await reload();
    } catch (err) {
      toastError(
        err instanceof Error ? err.message : "Could not reassign bays"
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="hub-main">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-base font-bold tracking-tight text-white">
            People
          </h1>
          <p className="mt-1 font-mono text-[11px] text-zinc-400">
            Schedule &amp; availability · {storeToday}
            {displayGroups.length > 0
              ? ` · ${formatPeopleCount(
                  displayGroups.reduce((n, g) => n + g.members.length, 0)
                )}`
              : ""}
          </p>
        </div>
        {canManage ? (
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="btn-primary-glow inline-flex shrink-0 items-center gap-1.5 rounded-xl px-3 text-sm font-bold"
          >
            <Plus className="h-4 w-4" strokeWidth={ICON_STROKE} aria-hidden />
            Add Team Member
          </button>
        ) : null}
      </div>

      {loading ? (
        <p className="text-sm text-zinc-400">Loading people…</p>
      ) : displayGroups.length === 0 ? (
        <p className="glass-card border-dashed px-4 py-8 text-center text-sm text-zinc-400">
          {working === "all"
            ? "No active team members on this store yet."
            : "No team members in this department."}
        </p>
      ) : (
        <ul className="space-y-2">
          {displayGroups.map((group) => {
            const open = openDepts[group.home] === true;
            const highlighted = working !== "all" && group.home === working;
            return (
              <li
                key={group.home}
                className={`glass-card overflow-hidden !rounded-xl !p-0 ${
                  highlighted ? "ring-1 ring-accent/50" : ""
                }`}
              >
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() =>
                    setOpenDepts((prev) => ({
                      ...prev,
                      [group.home]: !open,
                    }))
                  }
                  className="flex min-h-12 w-full items-center justify-between gap-3 px-3 py-2 text-left"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <DepartmentIcon
                      department={group.home}
                      className="h-4 w-4 shrink-0 text-accent"
                      strokeWidth={ICON_STROKE}
                    />
                    <span>
                      <span className="block truncate text-sm font-bold text-white">
                        {group.heading}
                      </span>
                      <span className="font-mono text-[11px] tracking-tight text-zinc-500">
                        {formatPeopleCount(group.members.length)} ·{" "}
                        {group.onDuty} on now
                      </span>
                    </span>
                  </span>
                  {open ? (
                    <ChevronUp
                      className="h-4 w-4 text-zinc-400"
                      strokeWidth={ICON_STROKE}
                      aria-hidden
                    />
                  ) : (
                    <ChevronDown
                      className="h-4 w-4 text-zinc-400"
                      strokeWidth={ICON_STROKE}
                      aria-hidden
                    />
                  )}
                </button>
                {open ? (
                  <ul className="space-y-2 border-t border-zinc-800/80 px-2 py-2">
                    {group.members.map((member) => {
                      const persistedDay = days[String(member.id)];
                      const exceptionDay = boardById[String(member.id)];
                      const scheduledToday = exceptionDay?.status === "ON_DUTY";
                      const availability = composeCurrentAvailability({
                        row: persistedDay,
                        previousDay:
                          weekRows[shiftRowKey(String(member.id), storeYesterday)],
                        now: clockNow,
                        timeZone: storeTimezone,
                      });
                      const nextOpportunity = composeNextScheduledOpportunity({
                        rows: Object.values(weekRows).filter(
                          (row) => row.specialist_id === String(member.id)
                        ),
                        now: clockNow,
                        timeZone: storeTimezone,
                        weekLabel: assignmentWeek,
                      });
                      const ownedBays = countWeeklyOwnership(
                        weekAssignments,
                        String(member.id)
                      );
                      const calledOut = availability.reason === "CALLED_OUT";
                      const showReassign =
                        calledOut &&
                        canShift &&
                        (!assignmentsKnown || ownedBays > 0);
                      const canManageCard =
                        canShift || canGrant || canManage;
                      return (
                        <SpecialistCard
                          key={member.id}
                          member={member}
                          day={persistedDay}
                          availability={availability}
                          busy={busyId === member.id}
                          canShift={canShift}
                          canManageCard={canManageCard}
                          callOutArmed={Boolean(scheduledToday)}
                          nextCaption={
                            calledOut &&
                            (!assignmentsKnown || ownedBays > 0)
                              ? nextOpportunity.caption
                              : null
                          }
                          ownedBayCaption={
                            calledOut
                              ? formatOwnedBayCaption(ownedBays)
                              : null
                          }
                          onToggleDuty={() =>
                            void markCallOut(member, scheduledToday)
                          }
                          onReassign={
                            showReassign
                              ? () => setReassignTarget(member)
                              : undefined
                          }
                          onManage={() => setManageTarget(member)}
                        />
                      );
                    })}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {canManage ? (
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="btn-primary-glow mt-4 flex min-h-12 w-full items-center justify-center gap-1.5 rounded-xl text-sm font-bold"
        >
          <Plus className="h-4 w-4" strokeWidth={ICON_STROKE} aria-hidden />
          Add Team Member
        </button>
      ) : null}

      {addOpen ? (
        <AddTeamMemberSheet
          specialist={specialist}
          storeNumber={storeNumber}
          onClose={() => setAddOpen(false)}
          onCreated={async (created) => {
            if (created) {
              setRoster((curr) => dedupeRoster([created, ...curr]));
              setOpenDepts((prev) => ({
                ...prev,
                [homeDepartment(created)]: true,
              }));
            }
            invalidateRosterCache();
            await reload();
          }}
        />
      ) : null}

      {manageTarget ? (
        <SpecialistEditSheet
          actor={specialist}
          member={manageTarget}
          busy={busyId === manageTarget.id}
          canShift={canShift}
          canGrant={canGrant}
          canManage={canManage}
          availability={composeCurrentAvailability({
            row: days[String(manageTarget.id)],
            previousDay:
              weekRows[
                shiftRowKey(String(manageTarget.id), storeYesterday)
              ],
            now: clockNow,
            timeZone: storeTimezone,
          })}
          ownedBayCaption={formatOwnedBayCaption(
            countWeeklyOwnership(weekAssignments, String(manageTarget.id))
          )}
          nextCaption={
            composeNextScheduledOpportunity({
              rows: Object.values(weekRows).filter(
                (row) => row.specialist_id === String(manageTarget.id)
              ),
              now: clockNow,
              timeZone: storeTimezone,
              weekLabel: assignmentWeek,
            }).caption
          }
          onClose={() => setManageTarget(null)}
          onAccessChange={(next) => void handleAccess(manageTarget, next)}
          onRemove={() => {
            setDeleteTarget(manageTarget);
            setManageTarget(null);
          }}
          onScheduleSaved={() => void reload()}
          onPaired={() => void reload()}
          onDetailsSaved={() => void reload()}
          onReassign={
            canShift &&
            composeCurrentAvailability({
              row: days[String(manageTarget.id)],
              previousDay:
                weekRows[
                  shiftRowKey(String(manageTarget.id), storeYesterday)
                ],
              now: clockNow,
              timeZone: storeTimezone,
            }).reason === "CALLED_OUT" &&
            (!assignmentsKnown ||
              countWeeklyOwnership(
                weekAssignments,
                String(manageTarget.id)
              ) > 0)
              ? () => {
                  setReassignTarget(manageTarget);
                  setManageTarget(null);
                }
              : undefined
          }
        />
      ) : null}

      {callOutTarget ? (
        <div className="glass-backdrop fixed inset-0 z-[80] flex items-end justify-center sm:items-center">
          <button
            type="button"
            className="absolute inset-0"
            aria-label="Cancel call-out"
            onClick={() => setCallOutTarget(null)}
          />
          <div
            role="dialog"
            aria-modal="true"
            className="glass-card theme-modal relative z-10 w-full max-w-md !rounded-t-2xl p-4 sm:!rounded-2xl"
          >
            <h2 className="glass-title text-lg">
              Call out {callOutTarget.name}?
            </h2>
            <p className="mt-2 text-sm text-zinc-400">
              They leave On now. Weekly bay ownership stays.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setCallOutTarget(null)}
                className="flex min-h-12 items-center justify-center rounded-xl border border-zinc-700 text-sm font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busyId === callOutTarget.id}
                onClick={() => void recordCallOut()}
                className="flex min-h-12 items-center justify-center rounded-xl bg-amber-600 text-sm font-bold text-white"
              >
                Call out
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {reassignTarget ? (
        <div className="glass-backdrop fixed inset-0 z-[80] flex items-end justify-center sm:items-center">
          <button
            type="button"
            className="absolute inset-0"
            aria-label="Cancel reassign"
            onClick={() => setReassignTarget(null)}
          />
          <div
            role="dialog"
            aria-modal="true"
            className="glass-card theme-modal relative z-10 w-full max-w-md !rounded-t-2xl p-4 sm:!rounded-2xl"
          >
            <h2 className="glass-title text-lg">
              Reassign {reassignTarget.name}&apos;s bays?
            </h2>
            <p className="mt-2 text-sm text-zinc-400">
              Optional. Weekly ownership stays unless you choose an action.
            </p>
            <div className="mt-4 space-y-2">
              <button
                type="button"
                disabled={busyId === reassignTarget.id}
                onClick={() => void applyReassign("pool")}
                className="flex min-h-12 w-full items-center justify-center rounded-xl border border-zinc-700 text-sm font-bold"
              >
                Return to Department Pool
              </button>
              <button
                type="button"
                disabled={busyId === reassignTarget.id}
                onClick={() => void applyReassign("auto")}
                className="btn-primary-glow flex min-h-12 w-full items-center justify-center rounded-xl text-sm font-bold"
              >
                Auto-Redistribute to On-Duty Peers
              </button>
              <button
                type="button"
                disabled={busyId === reassignTarget.id}
                onClick={() => void applyReassign("carry")}
                className="flex min-h-12 w-full items-center justify-center rounded-xl border border-amber-500/40 bg-amber-950/30 text-sm font-bold text-amber-100"
              >
                Carry Over to Next Shift
              </button>
              <button
                type="button"
                onClick={() => setReassignTarget(null)}
                className="flex min-h-11 w-full items-center justify-center text-sm font-semibold text-zinc-400"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {deleteTarget ? (
        <div className="glass-backdrop fixed inset-0 z-[80] flex items-end justify-center sm:items-center">
          <button
            type="button"
            className="absolute inset-0"
            aria-label="Cancel remove"
            onClick={() => setDeleteTarget(null)}
          />
          <div
            role="dialog"
            aria-modal="true"
            className="glass-card theme-modal hub-modal-sheet relative z-10 w-full max-w-md !rounded-t-2xl px-4 pt-4 sm:!rounded-2xl"
          >
            <h2 className="glass-title text-lg">Remove {deleteTarget.name}?</h2>
            <p className="mt-2 text-sm text-zinc-400">
              They will be deactivated on this store roster.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="flex min-h-12 items-center justify-center rounded-xl border border-zinc-700 text-sm font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleDelete()}
                className="flex min-h-12 items-center justify-center rounded-xl bg-rose-600 text-sm font-bold text-white"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function AddTeamMemberSheet({
  specialist,
  storeNumber,
  onClose,
  onCreated,
}: {
  specialist: StoreSpecialist;
  storeNumber: string;
  onClose: () => void;
  onCreated: (created: StoreSpecialist | null) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [jobOptionId, setJobOptionId] = useState("flooring_specialist");
  const [department, setDepartment] = useState<DepartmentScope>("flooring");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const jobOption = rosterJobOptionById(jobOptionId);
  const departmentLocked = Boolean(jobOption?.department);

  // Mount is the open signal — this sheet is conditionally rendered.
  useFocusedWorkspace();

  async function handleSave() {
    const trimmed = name.trim();
    const phoneE164 = normalizePhoneE164(phone);
    if (!trimmed) {
      setError("Enter a name");
      return;
    }
    if (phone.trim() && !phoneE164) {
      setError("Enter a valid phone number");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const job = resolveRosterJobSave(jobOptionId, department);
      const assigned = job.department;
      const payload = {
        name: trimmed,
        department: assigned,
        role: job.role === "MasterAdmin" ? "MasterAdmin" as const : job.role === "Supervisor" ? "Supervisor" as const : "Associate" as const,
        floor_title: job.floor_title,
        username: suggestUsername(trimmed, assigned),
        phone: phoneE164 ?? undefined,
        store_number: storeNumber,
        accessible_departments: composeAccessibleDepartments(assigned, [
          assigned === "all" ? "flooring" : (assigned as OperationalDepartment),
        ]),
      };
      const result = await createRosterMember(specialist, payload);
      const created = memberFromCreateResult(result, storeNumber);
      if (!created) {
        console.error("Roster Insert Failed:", result);
        throw new Error("Roster save did not return a specialist row");
      }
      toastSuccess(`${result.name} added to the roster`);
      await onCreated(created);
      onClose();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not add team member";
      setError(message);
      toastError(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="glass-backdrop fixed inset-0 z-[80] flex flex-col justify-end">
      <button
        type="button"
        aria-label="Close add team member"
        className="absolute inset-0"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-team-title"
        className="glass-card theme-modal relative z-10 max-h-[88dvh] w-full overflow-y-auto !rounded-t-2xl !rounded-b-none border-t-2 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3"
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-zinc-600" />
        <h2 id="add-team-title" className="glass-title text-lg">
          Add Team Member
        </h2>
        <p className="mt-1 text-sm text-zinc-400">
          Adds this person to DeptSync&apos;s rotation workforce — not a Lowe&apos;s
          employee record. Pair their device later from member settings.
        </p>

        <div className="mt-4 space-y-3">
          <TextField
            label="Name"
            value={name}
            onChange={setName}
            placeholder="Name badge"
          />

          <fieldset>
            <legend className="mb-1.5 text-sm font-medium text-zinc-200">
              Role
            </legend>
            <select
              value={jobOptionId}
              onChange={(e) => {
                const nextId = e.target.value;
                setJobOptionId(nextId);
                const next = rosterJobOptionById(nextId);
                if (next?.department) setDepartment(next.department);
              }}
              className="glass-input min-h-12 w-full text-sm"
            >
              {ROSTER_JOB_GROUPS.map((group) => (
                <optgroup key={group.id} label={group.label}>
                  {ROSTER_JOB_OPTIONS.filter(
                    (option) => option.group === group.id
                  ).map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </fieldset>

          <DepartmentPicker
            value={department}
            onChange={setDepartment}
            disabled={departmentLocked}
            label="Home Department"
            showFloorTitle={false}
          />

          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-zinc-200">
              Phone Number (optional)
            </span>
            <input
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="(555) 123-4567"
              className="glass-input min-h-12 w-full font-mono"
            />
          </label>
        </div>

        {error ? (
          <p className="mt-3 text-center text-sm font-semibold text-rose-300" role="alert">
            {error}
          </p>
        ) : null}

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex min-h-12 items-center justify-center rounded-xl border border-zinc-700 text-sm font-semibold"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleSave()}
            className="btn-primary-glow flex min-h-12 items-center justify-center rounded-xl text-sm font-bold disabled:opacity-40"
          >
            {saving ? "Adding…" : "Add to roster"}
          </button>
        </div>
      </div>
    </div>
  );
}
