"use client";

/**
 * Roster tab — unified team list, PIN issue, and department chips.
 * Persistence: lib/specialists.ts + POST /api/admin/department-access.
 * Presentation only; does not own RBAC or department knowledge.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { DepartmentAccessChips } from "@/components/hub/DepartmentAccessChips";
import { DepartmentPicker } from "@/components/hub/DepartmentPicker";
import { DepartmentIcon, HubIcon } from "@/components/hub/NavIcons";
import { TextField } from "@/components/ui/NumberField";
import { composeAccessibleDepartments } from "@/lib/department-access";
import {
  canGrantDepartmentAccess,
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

export function RosterTab({ specialist, storeNumber }: WorkflowTabProps) {
  const [roster, setRoster] = useState<StoreSpecialist[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<StoreSpecialist | null>(
    null
  );
  const canManage = canManageTeamRoster(specialist);
  const canGrant = canGrantDepartmentAccess(specialist);

  const reload = useCallback(async () => {
    const team = await fetchSpecialists();
    setRoster(dedupeRoster(team));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void fetchSpecialists().then((team) => {
      if (cancelled) return;
      setRoster(dedupeRoster(team));
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [storeNumber]);

  const rows = useMemo(
    () =>
      [...roster]
        .filter((m) => m.is_active !== false)
        .sort((a, b) => {
          const rank = (m: StoreSpecialist) =>
            m.role === "MasterAdmin" ? 0 : m.role === "Supervisor" ? 1 : 2;
          const d = rank(a) - rank(b);
          if (d !== 0) return d;
          return a.name.localeCompare(b.name);
        }),
    [roster]
  );

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

  return (
    <main className="hub-main">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-accent">
            Team roster
          </p>
          <p className="mt-1 text-sm text-zinc-400">
            Name, role, home department, and Floor / Map / Roster access chips.
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
      ) : rows.length === 0 ? (
        <p className="glass-card border-dashed px-4 py-8 text-center text-sm text-zinc-400">
          No active team members on this store yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((member) => {
            const home = homeDepartment(member);
            const grantable =
              canGrant &&
              member.role !== "MasterAdmin" &&
              (canManage || member.role === "Associate");
            return (
              <li key={member.id} className="glass-card !rounded-xl !p-3">
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
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-zinc-400">
                      <DepartmentIcon
                        department={home}
                        className="h-3.5 w-3.5 shrink-0 text-accent"
                      />
                      {home === "all"
                        ? "Full store"
                        : departmentMeta(home).label}
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
                {grantable ? (
                  <div className="mt-3">
                    <DepartmentAccessChips
                      primary={home === "all" ? "flooring" : home}
                      value={composeAccessibleDepartments(
                        home,
                        member.accessible_departments
                      )}
                      disabled={busyId === member.id}
                      onChange={(next) => void handleAccess(member, next)}
                    />
                  </div>
                ) : member.role === "MasterAdmin" ? (
                  <p className="mt-2 text-[11px] text-zinc-500">
                    Full-store access — chips are not required.
                  </p>
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
