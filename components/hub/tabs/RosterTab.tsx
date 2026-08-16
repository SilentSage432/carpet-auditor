"use client";

/**
 * Roster tab — department-grouped team, shift board, and call-out rebalance.
 *
 * Pipeline: "+ Add Team Member" → AddTeamMemberSheet →
 *   roster-only: POST /api/roster/members → createRosterMember → store_specialists
 *   SMS invite:  POST /api/admin/invite-supervisor
 * Accordions: fetchSpecialists(storeNumber) SELECTs store_specialists, then
 *   composeRosterDepartmentGroups. On-duty counts come from associate_shift_days.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { AssociateScheduleModal } from "@/components/hub/AssociateScheduleModal";
import { DepartmentAccessChips } from "@/components/hub/DepartmentAccessChips";
import { DepartmentPicker } from "@/components/hub/DepartmentPicker";
import { DepartmentIcon, HubIcon } from "@/components/hub/NavIcons";
import { TextField } from "@/components/ui/NumberField";
import { redistributeCallOutBays } from "@/lib/store-ops/call-out";
import { composeRosterDepartmentGroups } from "@/lib/store-ops/roster-groups";
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
  appAccessLabel,
  appAccessStatus,
  dedupeRoster,
  deleteSpecialist,
  fetchSpecialists,
  invalidateRosterCache,
  isDatabaseUuid,
  mapRow,
} from "@/lib/specialists";
import { updateDepartmentAccess, inviteSupervisor, createRosterMember } from "@/lib/store-ops/client";
import type { InviteSupervisorResult } from "@/lib/store-ops/client";
import {
  composeShiftBoard,
  fetchShiftDaysRange,
  isScheduledShiftDay,
  localWorkDate,
  retailWeekDates,
  retailWeekStart,
  RETAIL_WEEKDAY_SHORT,
  SHIFT_STATUS_EVENT,
  shiftRowKey,
  sliceShiftDaysForDate,
  todayShiftCaption,
  upsertShiftDay,
  type AssociateShiftDay,
} from "@/lib/store-ops/shift-status";
import { toastError, toastSuccess, toastInfo } from "@/lib/toast";
import {
  associateFloorTitle,
  departmentMeta,
  departmentRosterHeading,
  specialistHomeDepartment,
  type DepartmentScope,
  type OperationalDepartment,
  type SpecialistRole,
  type StoreSpecialist,
} from "@/lib/types";
import { normalizePhoneE164, formatPhoneDisplay } from "@/lib/phone";
import type { WorkflowTabProps } from "@/components/hub/tabs/tab-props";

function rosterRoleLabel(member: StoreSpecialist): string {
  if (member.role === "MasterAdmin") return "Master Admin";
  if (member.role === "Supervisor") return "Supervisor";
  return associateFloorTitle(member.assigned_department);
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
  const [scheduleTarget, setScheduleTarget] = useState<StoreSpecialist | null>(
    null
  );
  const [callOutTarget, setCallOutTarget] = useState<StoreSpecialist | null>(
    null
  );
  const [inviteTarget, setInviteTarget] = useState<StoreSpecialist | null>(
    null
  );
  const today = localWorkDate();
  const weekStart = retailWeekStart(today);
  const weekDates = useMemo(() => retailWeekDates(weekStart), [weekStart]);
  const canManage = canManageTeamRoster(specialist);
  const canGrant = canGrantDepartmentAccess(specialist);
  const canShift = canManageShiftBoard(specialist);

  const reload = useCallback(async () => {
    const weekEnd = weekDates[6] ?? today;
    const [team, saved] = await Promise.all([
      fetchSpecialists(storeNumber),
      fetchShiftDaysRange(weekStart, weekEnd).catch(() => ({})),
    ]);
    setRoster(dedupeRoster(team));
    setWeekRows(saved);
  }, [today, weekDates, weekStart, storeNumber]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void reload().finally(() => {
      if (!cancelled) setLoading(false);
    });
    function onShift() {
      const weekEnd = weekDates[6] ?? today;
      void fetchShiftDaysRange(weekStart, weekEnd)
        .then(setWeekRows)
        .catch(() => undefined);
    }
    window.addEventListener(SHIFT_STATUS_EVENT, onShift);
    return () => {
      cancelled = true;
      window.removeEventListener(SHIFT_STATUS_EVENT, onShift);
    };
  }, [reload, storeNumber, today, weekDates, weekStart]);

  const days = useMemo(
    () => sliceShiftDaysForDate(weekRows, today),
    [weekRows, today]
  );

  const board = useMemo(
    () => composeShiftBoard(roster, days, today),
    [roster, days, today]
  );
  const dayById = useMemo(
    () => new Map(board.map((row) => [row.specialist_id, row])),
    [board]
  );

  const groups = useMemo(() => {
    const visible = roster.filter((m) => {
      if (m.is_active === false) return false;
      if (isMasterAdmin(specialist)) return true;
      const home = homeDepartment(m);
      return home !== "all" && canAccessDepartment(specialist, home);
    });
    return composeRosterDepartmentGroups(visible, (m) => {
      const day = dayById.get(String(m.id));
      return day?.status === "ON_DUTY";
    });
  }, [roster, dayById, specialist]);

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
    toastSuccess(`Updated permissions for ${member.name}`);
    setBusyId(member.id);
    try {
      await updateDepartmentAccess(specialist, {
        specialist_id: member.id,
        assigned_department: assigned,
        accessible_departments: composed,
      });
      await reload();
    } catch (err) {
      setRoster(previous);
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
      setBusyId(absent.id);
      try {
        const next = await upsertShiftDay({
          specialist_id: String(absent.id),
          is_call_out: false,
          is_scheduled_today: true,
        });
        setWeekRows((curr) => ({
          ...curr,
          [shiftRowKey(next.specialist_id, next.work_date)]: next,
        }));
        toastSuccess(`${absent.name} is on-duty`);
      } catch (err) {
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

  async function applyCallOut(
    mode: "pool" | "auto" | "carry"
  ) {
    if (!callOutTarget) return;
    const absent = callOutTarget;
    setBusyId(absent.id);
    try {
      const next = await upsertShiftDay({
        specialist_id: String(absent.id),
        is_call_out: true,
        is_scheduled_today: true,
      });
      setWeekRows((curr) => ({
        ...curr,
        [shiftRowKey(next.specialist_id, next.work_date)]: next,
      }));
      const result = await redistributeCallOutBays({
        actor: specialist,
        absent,
        peers: roster,
        days: composeShiftBoard(
          roster,
          { ...days, [next.specialist_id]: next },
          today
        ),
        mode,
      });
      const label =
        mode === "pool"
          ? "returned to the department pool"
          : mode === "auto"
            ? "auto-redistributed to on-duty peers"
            : "carried over to the next shift";
      toastSuccess(
        `${absent.name} marked call-out · ${result.moved} bay${
          result.moved === 1 ? "" : "s"
        } ${label}`
      );
      setCallOutTarget(null);
    } catch (err) {
      toastError(
        err instanceof Error ? err.message : "Could not rebalance bays"
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="hub-main">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-accent">
            Team roster
          </p>
          <p className="mt-1 text-sm text-zinc-400">
            Grouped by home department · today {today}
          </p>
        </div>
        {canManage ? (
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="btn-primary-glow shrink-0 rounded-xl px-3 text-sm font-bold"
          >
            + Add Team Member
          </button>
        ) : null}
      </div>

      {loading ? (
        <p className="text-sm text-zinc-400">Loading roster…</p>
      ) : groups.length === 0 ? (
        <p className="glass-card border-dashed px-4 py-8 text-center text-sm text-zinc-400">
          No active team members on this store yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {groups.map((group) => {
            const open = openDepts[group.home] === true;
            return (
              <li
                key={group.home}
                className="glass-card overflow-hidden !rounded-xl !p-0"
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
                    />
                    <span>
                      <span className="block truncate text-sm font-bold text-white">
                        {group.heading}
                      </span>
                      <span className="font-mono text-[11px] tracking-tight text-zinc-500">
                        {group.members.length} roster · {group.onDuty} on-duty
                      </span>
                    </span>
                  </span>
                  <HubIcon
                    id={open ? "chevronUp" : "chevronDown"}
                    className="h-4 w-4 text-zinc-400"
                  />
                </button>
                {open ? (
                  <ul className="space-y-2 border-t border-zinc-800/80 px-2 py-2">
                    {group.members.map((member) => {
                      const home = homeDepartment(member);
                      const day = dayById.get(String(member.id));
                      const grantable =
                        canGrant &&
                        member.role !== "MasterAdmin" &&
                        (canManage || member.role === "Associate");
                      const calledOut = day?.is_call_out === true;
                      const access = appAccessStatus(member);
                      return (
                        <li
                          key={member.id}
                          className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-3"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-bold text-white">
                                {member.name}
                                <AppAccessBadge member={member} />
                              </p>
                              <p className="mt-0.5 flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-accent">
                                {member.role === "MasterAdmin" ? (
                                  <HubIcon id="crown" className="h-3.5 w-3.5" />
                                ) : member.role === "Supervisor" ? (
                                  <HubIcon id="shield" className="h-3.5 w-3.5" />
                                ) : (
                                  <HubIcon id="user" className="h-3.5 w-3.5" />
                                )}
                                {rosterRoleLabel(member)}
                              </p>
                            </div>
                            {canManage && member.role !== "MasterAdmin" ? (
                              <button
                                type="button"
                                disabled={busyId === member.id}
                                onClick={() => setDeleteTarget(member)}
                                className="btn-icon-touch text-rose-300"
                                aria-label={`Remove ${member.name}`}
                              >
                                <HubIcon id="trash" className="h-4 w-4" />
                              </button>
                            ) : null}
                          </div>

                          {member.role !== "MasterAdmin" ? (
                            <div className="mt-2 space-y-2">
                              <div
                                className="flex items-center justify-between gap-1"
                                aria-label={`${member.name} weekly schedule`}
                              >
                                {weekDates.map((date, index) => {
                                  const saved =
                                    weekRows[
                                      shiftRowKey(String(member.id), date)
                                    ];
                                  const on =
                                    date === today
                                      ? isScheduledShiftDay(saved ?? day)
                                      : isScheduledShiftDay(saved);
                                  return (
                                    <span
                                      key={date}
                                      className="flex flex-1 flex-col items-center gap-1"
                                    >
                                      <span className="font-mono text-[9px] font-bold uppercase tracking-wide text-zinc-500">
                                        {RETAIL_WEEKDAY_SHORT[index]}
                                      </span>
                                      <span
                                        className={`h-2 w-2 rounded-full ${
                                          on ? "bg-emerald-400" : "bg-zinc-600"
                                        }`}
                                        title={
                                          on
                                            ? `${RETAIL_WEEKDAY_SHORT[index]} scheduled`
                                            : `${RETAIL_WEEKDAY_SHORT[index]} off`
                                        }
                                      />
                                    </span>
                                  );
                                })}
                              </div>
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span
                                  className={`inline-flex min-h-8 items-center rounded-full border px-2.5 font-mono text-[11px] font-bold tracking-tight ${
                                    calledOut
                                      ? "border-rose-500/40 bg-rose-950/40 text-rose-100"
                                      : isScheduledShiftDay(day)
                                        ? "border-emerald-500/35 bg-emerald-950/30 text-emerald-100"
                                        : "border-zinc-700 bg-zinc-900 text-zinc-300"
                                  }`}
                                >
                                  {todayShiftCaption(day)}
                                </span>
                                {canShift ? (
                                  <button
                                    type="button"
                                    onClick={() => setScheduleTarget(member)}
                                    className="inline-flex min-h-8 items-center gap-1 rounded-full border border-zinc-700 px-2.5 text-[11px] font-bold"
                                  >
                                    <HubIcon
                                      id="calendar"
                                      className="h-3.5 w-3.5"
                                    />
                                    Edit Schedule
                                  </button>
                                ) : null}
                              </div>
                            </div>
                          ) : null}

                          {canShift && member.role !== "MasterAdmin" ? (
                            <button
                              type="button"
                              role="switch"
                              aria-checked={calledOut}
                              disabled={busyId === member.id}
                              onClick={() =>
                                void markCallOut(member, !calledOut)
                              }
                              className={`mt-2 flex min-h-11 w-full items-center justify-between rounded-xl border px-3 text-sm font-bold ${
                                calledOut
                                  ? "border-rose-500/45 bg-rose-950/40 text-rose-100"
                                  : "border-emerald-500/35 bg-emerald-950/25 text-emerald-100"
                              }`}
                            >
                              <span className="inline-flex items-center gap-1.5">
                                <HubIcon id="zap" className="h-4 w-4" />
                                {calledOut ? "Call-Out" : "On-Duty"}
                              </span>
                              <span
                                className={`relative h-7 w-12 shrink-0 rounded-full ${
                                  calledOut ? "bg-rose-500" : "bg-emerald-500"
                                }`}
                              >
                                <span
                                  className={`absolute top-0.5 h-6 w-6 rounded-full bg-white transition ${
                                    calledOut ? "left-[1.35rem]" : "left-0.5"
                                  }`}
                                />
                              </span>
                            </button>
                          ) : null}

                          {canManage &&
                          member.role !== "MasterAdmin" &&
                          access === "roster_only" ? (
                            <button
                              type="button"
                              disabled={busyId === member.id}
                              onClick={() => setInviteTarget(member)}
                              className="mt-2 flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-cyan-500/40 bg-cyan-950/25 text-sm font-bold text-cyan-100"
                            >
                              <HubIcon id="users" className="h-4 w-4" />
                              Send App Invite
                            </button>
                          ) : null}

                          {member.role === "MasterAdmin" ? (
                            <p className="mt-2 text-[11px] text-zinc-500">
                              Full-store access — chips are not required.
                            </p>
                          ) : grantable ? (
                            <div className="mt-3">
                              <DepartmentAccessChips
                                primary={home === "all" ? "flooring" : home}
                                value={composeAccessibleDepartments(
                                  home,
                                  member.accessible_departments
                                )}
                                disabled={busyId === member.id}
                                onChange={(next) =>
                                  void handleAccess(member, next)
                                }
                              />
                            </div>
                          ) : (
                            <div className="mt-2 flex flex-wrap gap-1">
                              {composeAccessibleDepartments(
                                home,
                                member.accessible_departments
                              ).map((dept) => (
                                <span
                                  key={dept}
                                  className="inline-flex min-h-8 items-center gap-1 rounded-full border border-zinc-700 bg-zinc-900 px-2 font-mono text-[10px] font-bold uppercase tracking-wide text-zinc-300"
                                >
                                  <DepartmentIcon
                                    department={dept}
                                    className="h-3.5 w-3.5"
                                  />
                                  {departmentMeta(dept).shortLabel}
                                </span>
                              ))}
                            </div>
                          )}
                        </li>
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
          className="btn-primary-glow mt-4 flex min-h-12 w-full items-center justify-center rounded-xl text-sm font-bold"
        >
          + Add Team Member
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

      {inviteTarget ? (
        <SendAppInviteSheet
          specialist={specialist}
          member={inviteTarget}
          storeNumber={storeNumber}
          onClose={() => setInviteTarget(null)}
          onSent={async () => {
            await reload();
          }}
        />
      ) : null}

      {scheduleTarget ? (
        <AssociateScheduleModal
          member={scheduleTarget}
          homeLabel={departmentRosterHeading(homeDepartment(scheduleTarget))}
          onClose={() => setScheduleTarget(null)}
          onSaved={() => void reload()}
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
              Rebalance {callOutTarget.name}&apos;s bays?
            </h2>
            <p className="mt-2 text-sm text-zinc-400">
              Marks them ABSENT_CALLOUT for today, then moves their open
              checklist bays.
            </p>
            <div className="mt-4 space-y-2">
              <button
                type="button"
                disabled={busyId === callOutTarget.id}
                onClick={() => void applyCallOut("pool")}
                className="flex min-h-12 w-full items-center justify-center rounded-xl border border-zinc-700 text-sm font-bold"
              >
                Return to Department Pool
              </button>
              <button
                type="button"
                disabled={busyId === callOutTarget.id}
                onClick={() => void applyCallOut("auto")}
                className="btn-primary-glow flex min-h-12 w-full items-center justify-center rounded-xl text-sm font-bold"
              >
                Auto-Redistribute to On-Duty Peers
              </button>
              <button
                type="button"
                disabled={busyId === callOutTarget.id}
                onClick={() => void applyCallOut("carry")}
                className="flex min-h-12 w-full items-center justify-center rounded-xl border border-amber-500/40 bg-amber-950/30 text-sm font-bold text-amber-100"
              >
                Carry Over to Next Shift
              </button>
              <button
                type="button"
                onClick={() => setCallOutTarget(null)}
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
            className="glass-card theme-modal relative z-10 w-full max-w-md !rounded-t-2xl p-4 sm:!rounded-2xl"
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

function AppAccessBadge({ member }: { member: StoreSpecialist }) {
  const access = appAccessStatus(member);
  const tone =
    access === "invited"
      ? "border-amber-500/40 bg-amber-950/40 text-amber-100"
      : access === "active"
        ? "border-emerald-500/40 bg-emerald-950/40 text-emerald-100"
        : "border-zinc-600 bg-zinc-900 text-zinc-300";
  return (
    <span
      className={`ml-2 inline-flex rounded-full border px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wide ${tone}`}
    >
      {appAccessLabel(access)}
    </span>
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
  const [displayRole, setDisplayRole] = useState<
    "Supervisor" | "Specialist" | "CSA"
  >("Specialist");
  const [department, setDepartment] = useState<DepartmentScope>("flooring");
  const [phone, setPhone] = useState("");
  const [sendInvite, setSendInvite] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{
    name: string;
    invite_url: string;
    sms_reason?: string;
    sms_link: string;
  } | null>(null);

  const platformRole: SpecialistRole =
    displayRole === "Supervisor" ? "Supervisor" : "Associate";

  async function copyText(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      toastSuccess(`Copied ${label}`);
    } catch {
      toastError(`Could not copy ${label}`);
    }
  }

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
    if (sendInvite && !phoneE164) {
      setError("Phone number is required to send a mobile app invite");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const assigned = department;
      const payload = {
        name: trimmed,
        department: assigned,
        role: platformRole === "Supervisor" ? "Supervisor" as const : "Associate" as const,
        username: suggestUsername(trimmed, assigned),
        phone: phoneE164 ?? undefined,
        store_number: storeNumber,
        accessible_departments: composeAccessibleDepartments(assigned, [
          assigned === "all" ? "flooring" : (assigned as OperationalDepartment),
        ]),
      };
      if (sendInvite) {
        const result = await inviteSupervisor(specialist, {
          ...payload,
          send_invite: true,
        });
        const created = memberFromCreateResult(result, storeNumber);
        if (!created) {
          console.error("Roster Insert Failed:", result);
          throw new Error("Roster save did not return a specialist row");
        }
        setIssued({
          name: result.name,
          invite_url: result.invite_url ?? "",
          sms_reason:
            result.sms && result.sms.ok === true ? undefined : result.sms?.reason,
          sms_link: result.sms_preview?.sms_link ?? "",
        });
        toastSuccess(`Invited ${result.name} — status invited`);
        if (result.sms && result.sms.ok !== true) {
          toastInfo(result.sms.reason);
        }
        await onCreated(created);
      } else {
        const result = await createRosterMember(specialist, payload);
        const created = memberFromCreateResult(result, storeNumber);
        if (!created) {
          console.error("Roster Insert Failed:", result);
          throw new Error("Roster save did not return a specialist row");
        }
        toastSuccess(`${result.name} added to the roster`);
        await onCreated(created);
        onClose();
        return;
      }
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
          {issued ? "Invite sent" : "Add Team Member"}
        </h2>
        <p className="mt-1 text-sm text-zinc-400">
          {issued
            ? "Share the one-time link. They set a 4–6 digit PIN at /auth/verify."
            : "Name, role, and home department add them to the floor roster. App invite is optional."}
        </p>

        {issued ? (
          <div className="mt-4 space-y-3">
            <p className="text-sm font-semibold text-white">
              {issued.name} · store {storeNumber}
            </p>
            <p className="break-all font-mono text-[11px] text-zinc-300">
              {issued.invite_url}
            </p>
            {issued.sms_reason ? (
              <p className="text-xs text-amber-200">{issued.sms_reason}</p>
            ) : (
              <p className="text-xs text-emerald-200">
                SMS dispatched to {formatPhoneDisplay(phone)}
              </p>
            )}
            <button
              type="button"
              onClick={() => void copyText("invite link", issued.invite_url)}
              className="flex min-h-11 items-center justify-center rounded-xl border border-zinc-700 text-xs font-semibold"
            >
              Copy invite link
            </button>
            <button
              type="button"
              onClick={() => void copyText("SMS text", issued.sms_link)}
              className="flex min-h-11 w-full items-center justify-center rounded-xl border border-zinc-700 text-xs font-semibold"
            >
              Copy SMS link
            </button>
            <button
              type="button"
              onClick={onClose}
              className="btn-primary-glow flex min-h-12 w-full items-center justify-center rounded-xl text-sm font-bold"
            >
              Done
            </button>
          </div>
        ) : (
          <>
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
                <div className="grid grid-cols-3 gap-1.5">
                  {(
                    [
                      ["Supervisor", "Supervisor"],
                      ["Specialist", "Specialist"],
                      ["CSA", "CSA"],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setDisplayRole(value)}
                      className={`min-h-11 rounded-xl border text-xs font-bold ${
                        displayRole === value
                          ? "theme-accent-surface border"
                          : "border-zinc-700 text-zinc-300"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </fieldset>

              <DepartmentPicker
                value={department}
                onChange={setDepartment}
                label="Initial Department"
                showFloorTitle
              />

              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-zinc-200">
                  Phone Number{sendInvite ? "" : " (optional)"}
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

              <label className="flex min-h-12 items-start gap-3 rounded-xl border border-zinc-700 px-3 py-2.5">
                <input
                  type="checkbox"
                  checked={sendInvite}
                  onChange={(e) => setSendInvite(e.target.checked)}
                  className="mt-0.5 h-5 w-5 shrink-0 accent-cyan-500"
                />
                <span>
                  <span className="block text-sm font-bold text-white">
                    Send Mobile App Invite
                  </span>
                  <span className="text-[11px] leading-snug text-zinc-400">
                    SMS a one-time link so they can set a PIN. Off by default —
                    they are still available for schedules and rotations.
                  </span>
                </span>
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
                {saving
                  ? sendInvite
                    ? "Sending invite…"
                    : "Adding…"
                  : sendInvite
                    ? "Send invite"
                    : "Add to roster"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SendAppInviteSheet({
  specialist,
  member,
  storeNumber,
  onClose,
  onSent,
}: {
  specialist: StoreSpecialist;
  member: StoreSpecialist;
  storeNumber: string;
  onClose: () => void;
  onSent: () => Promise<void>;
}) {
  const [phone, setPhone] = useState(member.phone_number ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{
    invite_url: string;
    sms_reason?: string;
    sms_link: string;
  } | null>(null);

  async function copyText(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      toastSuccess(`Copied ${label}`);
    } catch {
      toastError(`Could not copy ${label}`);
    }
  }

  async function handleSend() {
    const phoneE164 = normalizePhoneE164(phone);
    if (!phoneE164) {
      setError("Enter a valid phone number");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await inviteSupervisor(specialist, {
        specialist_id: member.id,
        phone: phoneE164,
        send_invite: true,
      });
      setIssued({
        invite_url: result.invite_url ?? "",
        sms_reason:
          result.sms && result.sms.ok === true ? undefined : result.sms?.reason,
        sms_link: result.sms_preview?.sms_link ?? "",
      });
      toastSuccess(`Invited ${member.name}`);
      if (result.sms && result.sms.ok !== true) {
        toastInfo(result.sms.reason);
      }
      await onSent();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not send invite";
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
        aria-label="Close send app invite"
        className="absolute inset-0"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="send-invite-title"
        className="glass-card theme-modal relative z-10 max-h-[88dvh] w-full overflow-y-auto !rounded-t-2xl !rounded-b-none border-t-2 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3"
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-zinc-600" />
        <h2 id="send-invite-title" className="glass-title text-lg">
          {issued ? "Invite sent" : "Send App Invite"}
        </h2>
        <p className="mt-1 text-sm text-zinc-400">
          {issued
            ? `${member.name} can set a PIN at /auth/verify.`
            : `SMS a one-time link to ${member.name}. They stay on the floor roster either way.`}
        </p>

        {issued ? (
          <div className="mt-4 space-y-3">
            <p className="break-all font-mono text-[11px] text-zinc-300">
              {issued.invite_url}
            </p>
            {issued.sms_reason ? (
              <p className="text-xs text-amber-200">{issued.sms_reason}</p>
            ) : (
              <p className="text-xs text-emerald-200">
                SMS dispatched to {formatPhoneDisplay(phone)} · store{" "}
                {storeNumber}
              </p>
            )}
            <button
              type="button"
              onClick={() => void copyText("invite link", issued.invite_url)}
              className="flex min-h-11 items-center justify-center rounded-xl border border-zinc-700 text-xs font-semibold"
            >
              Copy invite link
            </button>
            <button
              type="button"
              onClick={() => void copyText("SMS text", issued.sms_link)}
              className="flex min-h-11 w-full items-center justify-center rounded-xl border border-zinc-700 text-xs font-semibold"
            >
              Copy SMS link
            </button>
            <button
              type="button"
              onClick={onClose}
              className="btn-primary-glow flex min-h-12 w-full items-center justify-center rounded-xl text-sm font-bold"
            >
              Done
            </button>
          </div>
        ) : (
          <>
            <label className="mt-4 block space-y-1.5">
              <span className="text-sm font-medium text-zinc-200">
                Phone Number
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
                onClick={() => void handleSend()}
                className="btn-primary-glow flex min-h-12 items-center justify-center rounded-xl text-sm font-bold disabled:opacity-40"
              >
                {saving ? "Sending…" : "Send invite"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
