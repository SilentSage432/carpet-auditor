"use client";

/**
 * Lightweight Associate Roster — presentation for Sunday drawer.
 * Knowledge stays in lib/specialists.ts. Floor titles (Specialist vs CSA) come from
 * department taxonomy in lib/types.ts. PINs are issued on the Roster tab.
 */

import { useMemo, useState } from "react";
import { DepartmentPicker } from "@/components/hub/DepartmentPicker";
import { DepartmentIcon, HubIcon } from "@/components/hub/NavIcons";
import { canGrantDepartmentAccess, canManageTeamRoster, suggestUsername } from "@/lib/rbac";
import { DepartmentAccessChips } from "@/components/hub/DepartmentAccessChips";
import {
  composeAccessibleDepartments,
} from "@/lib/department-access";
import { updateDepartmentAccess } from "@/lib/store-ops/client";
import { toastError, toastSuccess } from "@/lib/toast";
import {
  dedupeRoster,
  fetchSpecialists,
  setSpecialistActive,
  updateSpecialistScope,
} from "@/lib/specialists";
import { inviteSupervisor } from "@/lib/store-ops/client";
import { SHIFT_HOUR_PRESETS } from "@/lib/store-ops/weekly-rotations";
import {
  associateFloorTitleLabel,
  departmentMeta,
  type DepartmentScope,
  type StoreSpecialist,
} from "@/lib/types";

export type ShiftHoursPatch = {
  specialist_id: string;
  hours: number;
  active?: boolean;
};

type Props = {
  specialist: StoreSpecialist;
  roster: StoreSpecialist[];
  onRosterChange: (roster: StoreSpecialist[]) => void;
  /** When set, hours chips write into the Sunday shift balancer. */
  shiftHours?: Record<string, number>;
  shiftActive?: Record<string, boolean>;
  onShiftHoursChange?: (patch: ShiftHoursPatch) => void;
  compact?: boolean;
};

function floorLabel(member: StoreSpecialist): string {
  if (member.role === "MasterAdmin") return "Master Admin";
  if (member.role === "Supervisor") {
    const dept = member.assigned_department;
    return dept && dept !== "all"
      ? `${departmentMeta(dept).shortLabel} Supervisor`
      : "Supervisor";
  }
  return associateFloorTitleLabel(member.assigned_department);
}

export function AssociateRosterPanel({
  specialist,
  roster,
  onRosterChange,
  shiftHours,
  shiftActive,
  onShiftHoursChange,
  compact = false,
}: Props) {
  const canManage = canManageTeamRoster(specialist);
  const canGrant = canGrantDepartmentAccess(specialist);
  const [name, setName] = useState("");
  const [department, setDepartment] = useState<DepartmentScope>("flooring");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rows = useMemo(
    () =>
      [...roster]
        .filter((m) => m.role !== "MasterAdmin")
        .sort((a, b) => {
          const deptA = a.assigned_department ?? "";
          const deptB = b.assigned_department ?? "";
          if (deptA !== deptB) return deptA.localeCompare(deptB);
          return a.name.localeCompare(b.name);
        }),
    [roster]
  );

  async function refresh() {
    const team = await fetchSpecialists();
    onRosterChange(dedupeRoster(team));
  }

  async function handleDept(member: StoreSpecialist, next: DepartmentScope) {
    setBusyId(member.id);
    setError(null);
    try {
      await updateSpecialistScope(member, { assigned_department: next });
      await refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not update department"
      );
    } finally {
      setBusyId(null);
    }
  }

  async function handleAccess(
    member: StoreSpecialist,
    next: StoreSpecialist["accessible_departments"]
  ) {
    const primary =
      member.assigned_department && member.assigned_department !== "all"
        ? member.assigned_department
        : "flooring";
    const previous = roster;
    onRosterChange(
      roster.map((row) =>
        row.id === member.id
          ? { ...row, accessible_departments: composeAccessibleDepartments(primary, next) }
          : row
      )
    );
    toastSuccess(`Updated permissions for ${member.name}`);
    setBusyId(member.id);
    setError(null);
    try {
      await updateDepartmentAccess(specialist, {
        specialist_id: member.id,
        assigned_department: primary,
        accessible_departments: composeAccessibleDepartments(primary, next),
      });
      await refresh();
    } catch (err) {
      onRosterChange(previous);
      const msg =
        err instanceof Error ? err.message : "Could not update department access";
      setError(msg);
      toastError(msg);
    } finally {
      setBusyId(null);
    }
  }

  async function handleActive(member: StoreSpecialist, active: boolean) {
    setBusyId(member.id);
    setError(null);
    try {
      await setSpecialistActive(member, active);
      onShiftHoursChange?.({
        specialist_id: String(member.id),
        hours: shiftHours?.[String(member.id)] ?? 8,
        active,
      });
      await refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not update on-duty status"
      );
    } finally {
      setBusyId(null);
    }
  }

  async function handleAdd() {
    const trimmed = name.trim();
    if (!trimmed || !canManage) return;
    setAdding(true);
    setError(null);
    try {
      await inviteSupervisor(specialist, {
        name: trimmed,
        department,
        role: "Associate",
        username: suggestUsername(trimmed, department),
      });
      setName("");
      toastSuccess(`Added ${trimmed} to the roster`);
      await refresh();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Could not add associate";
      setError(msg);
      toastError(msg);
    } finally {
      setAdding(false);
    }
  }

  if (!canManage && rows.length === 0) return null;

  return (
    <section
      className={
        compact
          ? "rounded-xl border border-cyan-500/30 bg-cyan-950/20 p-3"
          : "space-y-3 rounded-2xl border border-emerald-500/25 bg-slate-900/90 p-4"
      }
    >
      <div>
        <p
          className={`font-mono text-[10px] font-bold uppercase tracking-[0.14em] ${
            compact ? "text-cyan-300" : "text-emerald-300"
          }`}
        >
          Associate roster
        </p>
        <p className="mt-1 text-[11px] leading-snug text-zinc-400">
          Specialty depts (Flooring, Appliances, Millwork, Cabinets) use
          Specialist. Core depts use CSA. On-duty names feed the Sunday shift
          balancer.
        </p>
      </div>

      {error ? (
        <p className="text-xs font-medium text-rose-300" role="alert">
          {error}
        </p>
      ) : null}

      <ul className="space-y-2">
        {rows.length === 0 ? (
          <li className="rounded-lg border border-dashed border-zinc-700 px-3 py-4 text-center text-xs text-zinc-500">
            No associates or department supervisors on this store roster yet.
          </li>
        ) : null}
        {rows.map((member) => {
          const dept = (member.assigned_department &&
          member.assigned_department !== "all"
            ? member.assigned_department
            : "flooring") as DepartmentScope;
          const hours = shiftHours?.[String(member.id)] ?? 8;
          const onDuty = shiftActive
            ? shiftActive[String(member.id)] !== false
            : member.is_active !== false;
          return (
            <li
              key={member.id}
              className="rounded-lg border border-zinc-800/80 bg-zinc-950/50 px-2.5 py-2"
            >
              <div className="flex items-start gap-2">
                {canManage ? (
                  <input
                    type="checkbox"
                    checked={onDuty}
                    disabled={busyId === member.id}
                    onChange={(e) => {
                      const next = e.target.checked;
                      if (onShiftHoursChange) {
                        onShiftHoursChange({
                          specialist_id: String(member.id),
                          hours,
                          active: next,
                        });
                        return;
                      }
                      void handleActive(member, next);
                    }}
                    className="mt-1 h-5 w-5 accent-cyan-500"
                    aria-label={`${member.name} on duty`}
                  />
                ) : null}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-white">
                    {member.name}
                  </p>
                  <p className="font-mono text-[10px] uppercase tracking-wider text-cyan-300/90">
                    {floorLabel(member)}
                    {!onDuty ? " · off duty" : ""}
                  </p>
                  {canManage ? (
                    <DepartmentPicker
                      value={dept}
                      disabled={busyId === member.id}
                      onChange={(next) => void handleDept(member, next)}
                      className="mt-1.5"
                    />
                  ) : (
                    <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-zinc-400">
                      <DepartmentIcon
                        department={dept}
                        className="h-3.5 w-3.5 text-accent"
                      />
                      {departmentMeta(dept).shortLabel}
                    </p>
                  )}
                  {canGrant &&
                  member.role !== "MasterAdmin" &&
                  (canManage || member.role === "Associate") ? (
                    <div className="mt-2">
                      <DepartmentAccessChips
                        primary={dept}
                        value={composeAccessibleDepartments(
                          dept,
                          member.accessible_departments
                        )}
                        disabled={busyId === member.id}
                        onChange={(next) => void handleAccess(member, next)}
                      />
                    </div>
                  ) : null}
                  {onShiftHoursChange && onDuty ? (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {SHIFT_HOUR_PRESETS.map((h) => (
                        <button
                          key={h}
                          type="button"
                          onClick={() =>
                            onShiftHoursChange({
                              specialist_id: String(member.id),
                              hours: h,
                              active: true,
                            })
                          }
                          className={`rounded-lg border px-2 py-1 text-[10px] font-bold ${
                            hours === h
                              ? "border-cyan-400/60 bg-cyan-950/50 text-cyan-100"
                              : "border-zinc-700 text-zinc-300"
                          }`}
                        >
                          {h}h
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {canManage ? (
        <form
          className="space-y-2 border-t border-zinc-800/80 pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            void handleAdd();
          }}
        >
          <p className="text-[11px] font-semibold text-zinc-300">
            Add associate
          </p>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Display name"
            className="glass-input min-h-11 w-full text-sm"
          />
          <DepartmentPicker
            value={department}
            onChange={setDepartment}
            label="Department"
          />
          <button
            type="submit"
            disabled={adding || !name.trim()}
            className="btn-primary-glow flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl text-sm disabled:opacity-40"
          >
            <HubIcon id="users" className="h-4 w-4" />
            {adding ? "Adding…" : "Add to roster"}
          </button>
        </form>
      ) : null}
    </section>
  );
}
