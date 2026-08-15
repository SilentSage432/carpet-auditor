"use client";

import { useEffect } from "react";
import { HubIcon } from "@/components/hub/NavIcons";
import { DepartmentPicker } from "@/components/hub/DepartmentPicker";
import {
  clearDevSandbox,
  sandboxPreviewLabel,
  writeDevSandbox,
  type DevSandboxState,
} from "@/lib/dev-sandbox";
import { type HubViewRole } from "@/lib/rbac";
import type { DepartmentScope } from "@/lib/types";

const ROLES: HubViewRole[] = [
  "MASTER_ADMIN",
  "DEPARTMENT_SUPERVISOR",
  "ASSOCIATE_CSA",
];

type Props = {
  open: boolean;
  sandbox: DevSandboxState;
  onClose: () => void;
};

export function DevSandboxDrawer({ open, sandbox, onClose }: Props) {
  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

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
