"use client";

import { useEffect, useState } from "react";
import { HubIcon } from "@/components/hub/NavIcons";
import { DepartmentPicker } from "@/components/hub/DepartmentPicker";
import {
  clearDevSandbox,
  sandboxPreviewLabel,
  writeDevSandbox,
  type DevSandboxState,
} from "@/lib/dev-sandbox";
import { type HubViewRole } from "@/lib/rbac";
import {
  fetchDepartments,
  fetchStoreScheduleSettings,
  resetStagedRotation,
} from "@/lib/store-ops/client";
import { readableError } from "@/lib/store-ops/errors";
import type { Department } from "@/lib/store-ops/types";
import { playErrorTone, playSuccessTone } from "@/lib/ui/feedback";
import type { DepartmentScope, StoreSpecialist } from "@/lib/types";

const ROLES: HubViewRole[] = [
  "MASTER_ADMIN",
  "DEPARTMENT_SUPERVISOR",
  "ASSOCIATE_CSA",
];

type Props = {
  open: boolean;
  sandbox: DevSandboxState;
  specialist: StoreSpecialist | null;
  onClose: () => void;
};

export function DevSandboxDrawer({ open, sandbox, specialist, onClose }: Props) {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [resetDeptId, setResetDeptId] = useState("");
  const [resetWeek, setResetWeek] = useState("");
  const [resetBusy, setResetBusy] = useState(false);
  const [resetMsg, setResetMsg] = useState<string | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  useEffect(() => {
    if (!open || !specialist) return;
    let cancelled = false;
    setResetMsg(null);
    setResetError(null);
    setConfirmReset(false);
    void Promise.all([
      fetchDepartments(specialist),
      fetchStoreScheduleSettings(specialist),
    ])
      .then(([depts, schedule]) => {
        if (cancelled) return;
        const active = depts.filter((d) => d.is_active !== false);
        setDepartments(active.length > 0 ? active : depts);
        setResetWeek(schedule.staging_week);
        setResetDeptId((current) => {
          if (current && depts.some((d) => d.id === current)) return current;
          return active[0]?.id ?? depts[0]?.id ?? "";
        });
      })
      .catch((err) => {
        if (!cancelled) {
          setResetError(
            readableError(err, "Could not load departments or staging week")
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, specialist]);

  if (!open) return null;

  const role = sandbox.previewRole ?? "MASTER_ADMIN";
  const department = sandbox.previewDepartment ?? "all";

  function apply(next: Partial<DevSandboxState>) {
    writeDevSandbox({
      previewRole: next.previewRole === undefined ? role : next.previewRole,
      previewDepartment:
        next.previewDepartment === undefined
          ? department
          : next.previewDepartment,
    });
  }

  async function handleClearStagedRotation() {
    if (!specialist || !resetDeptId || !resetWeek) return;
    if (!confirmReset) {
      setConfirmReset(true);
      setResetMsg(null);
      setResetError(null);
      return;
    }
    setResetBusy(true);
    setResetMsg(null);
    setResetError(null);
    try {
      const result = await resetStagedRotation(
        specialist,
        resetDeptId,
        resetWeek,
        { includeCompleted: true }
      );
      const audit = result.audit;
      setResetMsg(
        `Cleared ${audit.week_label}: ${audit.deleted_rotations} rotation${
          audit.deleted_rotations === 1 ? "" : "s"
        }, ${audit.deleted_assignments} assignment${
          audit.deleted_assignments === 1 ? "" : "s"
        }, ${audit.reset_locations} bay${
          audit.reset_locations === 1 ? "" : "s"
        } reset to PENDING.`
      );
      setConfirmReset(false);
      playSuccessTone();
    } catch (err) {
      setResetError(
        readableError(err, "Could not clear staged rotation for this week")
      );
      setConfirmReset(false);
      playErrorTone();
    } finally {
      setResetBusy(false);
    }
  }

  return (
    <div className="glass-backdrop fixed inset-0 z-[90] flex flex-col justify-end">
      <button
        type="button"
        className="absolute inset-0"
        aria-label="Close developer sandbox"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="dev-sandbox-title"
        className="glass-card theme-modal relative z-10 max-h-[88dvh] w-full overflow-y-auto !rounded-t-2xl !rounded-b-none border-t-2 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3"
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-zinc-600" />
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-amber-300">
              Developer sandbox
            </p>
            <h2 id="dev-sandbox-title" className="mt-1 text-lg font-bold">
              Preview as role
            </h2>
            <p className="mt-1 text-sm text-zinc-400">
              Layout only — credentials and JWT stay yours.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn-icon-touch"
            aria-label="Close"
          >
            <HubIcon id="close" className="h-5 w-5" />
          </button>
        </div>

        <div
          className="mb-4 grid grid-cols-3 gap-1 rounded-full border border-zinc-700/80 bg-zinc-950/70 p-0.5"
          role="group"
          aria-label="Preview as role"
        >
          {ROLES.map((value) => {
            const selected = role === value;
            return (
              <button
                key={value}
                type="button"
                aria-pressed={selected}
                onClick={() =>
                  apply({
                    previewRole: value,
                    previewDepartment:
                      value === "MASTER_ADMIN"
                        ? department
                        : department === "all"
                          ? "flooring"
                          : department,
                  })
                }
                className={`min-h-11 rounded-full px-1 font-mono text-[10px] font-bold ${
                  selected ? "bg-accent/25 text-accent" : "text-zinc-400"
                }`}
              >
                {value === "MASTER_ADMIN"
                  ? "Master Admin"
                  : value === "DEPARTMENT_SUPERVISOR"
                    ? "DS Supervisor"
                    : "CSA Specialist"}
              </button>
            );
          })}
        </div>

        <DepartmentPicker
          value={department === "all" ? "flooring" : department}
          onChange={(next: DepartmentScope) =>
            apply({ previewRole: role, previewDepartment: next })
          }
          label="Simulate department"
          showFloorTitle
        />
        {role === "MASTER_ADMIN" ? (
          <button
            type="button"
            onClick={() =>
              apply({ previewRole: role, previewDepartment: "all" })
            }
            className={`mt-2 flex min-h-11 w-full items-center justify-center rounded-xl border text-sm font-bold ${
              department === "all"
                ? "border-accent/50 bg-accent/15 text-accent"
                : "border-zinc-700 text-zinc-300"
            }`}
          >
            Full Store
          </button>
        ) : null}

        {sandbox.previewRole ? (
          <p className="mt-3 font-mono text-[11px] tracking-tight text-amber-200">
            Simulating: {sandboxPreviewLabel(sandbox)}
          </p>
        ) : (
          <p className="mt-3 text-sm text-zinc-500">
            Select a role to overlay the hub chrome.
          </p>
        )}

        {specialist ? (
          <section
            className="mt-5 rounded-xl border border-rose-500/35 bg-rose-950/20 p-3"
            aria-labelledby="dev-sandbox-danger-title"
          >
            <p
              id="dev-sandbox-danger-title"
              className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-rose-300"
            >
              Danger zone / testing actions
            </p>
            <p className="mt-1 text-xs text-zinc-400">
              Deletes staged weekly rotations and Sunday bay assignments for the
              selected week. Bays return to PENDING.
            </p>
            <div className="mt-3 space-y-2">
              <label className="block text-sm">
                <span className="mb-1 block text-xs font-medium text-zinc-300">
                  Department
                </span>
                <select
                  value={resetDeptId}
                  onChange={(e) => {
                    setResetDeptId(e.target.value);
                    setConfirmReset(false);
                  }}
                  className="glass-input min-h-11 w-full text-sm font-semibold"
                >
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-xs font-medium text-zinc-300">
                  ISO week
                </span>
                <input
                  type="text"
                  value={resetWeek}
                  onChange={(e) => {
                    setResetWeek(e.target.value.trim());
                    setConfirmReset(false);
                  }}
                  placeholder="2026-W34"
                  className="glass-input min-h-11 w-full font-mono text-sm font-semibold"
                />
              </label>
              <button
                type="button"
                disabled={resetBusy || !resetDeptId || !resetWeek}
                onClick={handleClearStagedRotation}
                className="flex min-h-11 w-full items-center justify-center rounded-xl border border-rose-400/50 bg-rose-600/90 text-sm font-bold text-white disabled:opacity-50"
              >
                {resetBusy
                  ? "Clearing…"
                  : confirmReset
                    ? "Confirm clear staged rotation"
                    : "Clear staged rotation"}
              </button>
            </div>
            {resetMsg ? (
              <p className="mt-2 text-xs text-emerald-200" role="status">
                {resetMsg}
              </p>
            ) : null}
            {resetError ? (
              <p className="mt-2 text-xs font-medium text-rose-200" role="alert">
                {resetError}
              </p>
            ) : null}
          </section>
        ) : null}

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => {
              clearDevSandbox();
              onClose();
            }}
            className="flex min-h-12 items-center justify-center rounded-xl border border-zinc-700 text-sm font-semibold"
          >
            Exit preview
          </button>
          <button
            type="button"
            onClick={onClose}
            className="btn-primary-glow flex min-h-12 items-center justify-center rounded-xl text-sm font-bold"
          >
            Apply & close
          </button>
        </div>
      </div>
    </div>
  );
}
