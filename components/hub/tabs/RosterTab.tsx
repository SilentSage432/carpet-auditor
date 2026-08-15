"use client";

/**
 * Roster tab — department-grouped team, shift board, and call-out rebalance.
 * Persistence: lib/specialists.ts + shift-status + sunday-audit (call-out).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { DepartmentAccessChips } from "@/components/hub/DepartmentAccessChips";
import { DepartmentPicker } from "@/components/hub/DepartmentPicker";
import { DepartmentIcon, HubIcon } from "@/components/hub/NavIcons";
import { TextField } from "@/components/ui/NumberField";
import { adminWorkingDepartmentLabel } from "@/lib/admin-department-context";
import { redistributeCallOutBays } from "@/lib/store-ops/call-out";
import { composeAccessibleDepartments } from "@/lib/department-access";
import {
  canGrantDepartmentAccess,
  canManageShiftBoard,
  canManageTeamRoster,
  suggestUsername,
} from "@/lib/rbac";
import {
  dedupeRoster,
  deleteSpecialist,
  fetchSpecialists,
  saveSpecialist,
} from "@/lib/specialists";
import { updateDepartmentAccess } from "@/lib/store-ops/client";
import {
  composeShiftBoard,
  fetchShiftDays,
  formatShiftPill,
  localWorkDate,
  SHIFT_STATUS_EVENT,
  upsertShiftDay,
  type AssociateShiftDay,
} from "@/lib/store-ops/shift-status";
import { toastError, toastSuccess } from "@/lib/toast";
import {
  associateFloorTitle,
  departmentMeta,
  type DepartmentScope,
  type OperationalDepartment,
  type SpecialistRole,
  type StoreSpecialist,
} from "@/lib/types";
import type { WorkflowTabProps } from "@/components/hub/tabs/tab-props";

function rosterRoleLabel(member: StoreSpecialist): string {
  if (member.role === "MasterAdmin") return "Master Admin";
  if (member.role === "Supervisor") return "Supervisor";
  return associateFloorTitle(member.assigned_department);
}

function homeDepartment(member: StoreSpecialist): DepartmentScope {
  const dept = member.assigned_department;
  if (dept && dept !== "all") return dept;
  return member.role === "MasterAdmin" ? "all" : "flooring";
}

function departmentHeading(home: DepartmentScope): string {
  if (home === "all") return "Full Store";
  if (
    home === "flooring" ||
    home === "appliances" ||
    home === "cabinets" ||
    home === "millwork" ||
    home === "paint"
  ) {
    return adminWorkingDepartmentLabel(home);
  }
  return departmentMeta(home).label;
}

type DeptGroup = {
  home: DepartmentScope;
  heading: string;
  members: StoreSpecialist[];
  onDuty: number;
};

export function RosterTab({ specialist, storeNumber }: WorkflowTabProps) {
  const [roster, setRoster] = useState<StoreSpecialist[]>([]);
  const [days, setDays] = useState<Record<string, AssociateShiftDay>>({});
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
  const [startDraft, setStartDraft] = useState("07:00");
  const [endDraft, setEndDraft] = useState("15:30");
  const today = localWorkDate();
  const canManage = canManageTeamRoster(specialist);
  const canGrant = canGrantDepartmentAccess(specialist);
  const canShift = canManageShiftBoard(specialist);

  const reload = useCallback(async () => {
    const [team, saved] = await Promise.all([
      fetchSpecialists(),
      fetchShiftDays(today).catch(() => ({})),
    ]);
    setRoster(dedupeRoster(team));
    setDays(saved);
  }, [today]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void reload().finally(() => {
      if (!cancelled) setLoading(false);
    });
    function onShift() {
      void fetchShiftDays(today)
        .then(setDays)
        .catch(() => undefined);
    }
    window.addEventListener(SHIFT_STATUS_EVENT, onShift);
    return () => {
      cancelled = true;
      window.removeEventListener(SHIFT_STATUS_EVENT, onShift);
    };
  }, [reload, storeNumber, today]);

  const board = useMemo(
    () => composeShiftBoard(roster, days, today),
    [roster, days, today]
  );
  const dayById = useMemo(
    () => new Map(board.map((row) => [row.specialist_id, row])),
    [board]
  );

  const groups = useMemo((): DeptGroup[] => {
    const active = roster.filter((m) => m.is_active !== false);
    const buckets = new Map<DepartmentScope, StoreSpecialist[]>();
    for (const member of active) {
      const home = homeDepartment(member);
      const list = buckets.get(home) ?? [];
      list.push(member);
      buckets.set(home, list);
    }
    const order: DepartmentScope[] = [
      "flooring",
      "cabinets",
      "appliances",
      "millwork",
      "paint",
      "plumbing",
      "electrical",
      "tools",
      "building_materials",
      "inside_garden",
      "outside_garden",
      "lawn_garden",
      "hardware",
      "all",
    ];
    return order
      .filter((home) => buckets.has(home))
      .map((home) => {
        const members = (buckets.get(home) ?? []).sort((a, b) => {
          const rank = (m: StoreSpecialist) =>
            m.role === "MasterAdmin" ? 0 : m.role === "Supervisor" ? 1 : 2;
          const d = rank(a) - rank(b);
          if (d !== 0) return d;
          return a.name.localeCompare(b.name);
        });
        return {
          home,
          heading: departmentHeading(home),
          members,
          onDuty: members.filter((m) => {
            const day = dayById.get(String(m.id));
            return day?.status === "ON_DUTY";
          }).length,
        };
      });
  }, [roster, dayById]);

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

  async function saveSchedule() {
    if (!scheduleTarget) return;
    setBusyId(scheduleTarget.id);
    try {
      const next = await upsertShiftDay({
        specialist_id: String(scheduleTarget.id),
        start_time: startDraft,
        end_time: endDraft,
        is_scheduled_today: true,
        is_call_out: false,
      });
      setDays((curr) => ({ ...curr, [next.specialist_id]: next }));
      toastSuccess(`Saved shift for ${scheduleTarget.name}`);
      setScheduleTarget(null);
    } catch (err) {
      toastError(
        err instanceof Error ? err.message : "Could not save schedule"
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
        setDays((curr) => ({ ...curr, [next.specialist_id]: next }));
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
      setDays((curr) => ({ ...curr, [next.specialist_id]: next }));
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
            const open = openDepts[group.home] !== false;
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
                      return (
                        <li
                          key={member.id}
                          className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-3"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-bold text-white">
                                {member.name}
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
                            <div className="mt-2 flex flex-wrap items-center gap-1.5">
                              <span
                                className={`inline-flex min-h-8 items-center rounded-full border px-2.5 font-mono text-[11px] font-bold tracking-tight ${
                                  calledOut
                                    ? "border-rose-500/40 bg-rose-950/40 text-rose-100"
                                    : "border-zinc-700 bg-zinc-900 text-zinc-200"
                                }`}
                              >
                                {formatShiftPill(
                                  day?.start_time,
                                  day?.end_time
                                )}
                              </span>
                              {canShift ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setStartDraft(day?.start_time || "07:00");
                                    setEndDraft(day?.end_time || "15:30");
                                    setScheduleTarget(member);
                                  }}
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
          storeNumber={storeNumber}
          onClose={() => setAddOpen(false)}
          onCreated={async () => {
            await reload();
            setAddOpen(false);
          }}
        />
      ) : null}

      {scheduleTarget ? (
        <div className="glass-backdrop fixed inset-0 z-[80] flex flex-col justify-end">
          <button
            type="button"
            className="absolute inset-0"
            aria-label="Close schedule"
            onClick={() => setScheduleTarget(null)}
          />
          <div
            role="dialog"
            aria-modal="true"
            className="glass-card theme-modal relative z-10 w-full !rounded-t-2xl px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3"
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-zinc-600" />
            <h2 className="glass-title text-lg">
              Edit schedule · {scheduleTarget.name}
            </h2>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-zinc-200">Start</span>
                <input
                  type="time"
                  value={startDraft}
                  onChange={(e) => setStartDraft(e.target.value)}
                  className="min-h-12 w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 font-mono tracking-tight text-zinc-100"
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-zinc-200">End</span>
                <input
                  type="time"
                  value={endDraft}
                  onChange={(e) => setEndDraft(e.target.value)}
                  className="min-h-12 w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 font-mono tracking-tight text-zinc-100"
                />
              </label>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setScheduleTarget(null)}
                className="flex min-h-12 items-center justify-center rounded-xl border border-zinc-700 text-sm font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busyId === scheduleTarget.id}
                onClick={() => void saveSchedule()}
                className="btn-primary-glow flex min-h-12 items-center justify-center rounded-xl text-sm font-bold disabled:opacity-40"
              >
                Save shift
              </button>
            </div>
          </div>
        </div>
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

function AddTeamMemberSheet({
  storeNumber,
  onClose,
  onCreated,
}: {
  storeNumber: string;
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [displayRole, setDisplayRole] = useState<
    "Supervisor" | "Specialist" | "CSA"
  >("Specialist");
  const [department, setDepartment] = useState<DepartmentScope>("flooring");
  const [pin, setPin] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const platformRole: SpecialistRole =
    displayRole === "Supervisor" ? "Supervisor" : "Associate";

  async function handleSave() {
    const trimmed = name.trim();
    const pinCode = pin.trim();
    if (!trimmed) {
      setError("Enter a name");
      return;
    }
    if (!/^\d{4,6}$/.test(pinCode)) {
      setError("PIN must be 4–6 digits");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const assigned =
        platformRole === "Supervisor" || platformRole === "Associate"
          ? department
          : "flooring";
      const result = await saveSpecialist({
        name: trimmed,
        role: platformRole,
        pin_code: pinCode,
        username: suggestUsername(trimmed, assigned),
        assigned_department: assigned,
        accessible_departments: composeAccessibleDepartments(assigned, [
          assigned === "all" ? "flooring" : (assigned as OperationalDepartment),
        ]),
        store_number: storeNumber,
        must_change_credentials: false,
      });
      toastSuccess(`Added ${result.record.name} to the roster`);
      await onCreated();
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
          Name, role, PIN, and home department save immediately to the roster.
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
            <span className="text-sm font-medium text-zinc-200">PIN</span>
            <input
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              maxLength={6}
              value={pin}
              onChange={(e) =>
                setPin(e.target.value.replace(/\D/g, "").slice(0, 6))
              }
              placeholder="4–6 digits"
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
            {saving ? "Saving…" : "Save to roster"}
          </button>
        </div>
      </div>
    </div>
  );
}
