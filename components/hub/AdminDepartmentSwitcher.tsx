"use client";

/**
 * Department context pill — presentation only.
 * Context ownership: lib/admin-department-context.ts
 * Master Admin: compact dropdown. Multi-department associates/supervisors:
 * granted-scope dropdown. Single-department roles: read-only chip.
 */

import { useEffect, useId, useRef, useState } from "react";
import { DepartmentIcon, HubIcon } from "@/components/hub/NavIcons";
import {
  ADMIN_DEPT_CONTEXT_EVENT,
  ADMIN_PINNABLE_DEPARTMENTS,
  adminWorkingDepartmentLabel,
  adminWorkingDepartmentPillLabel,
  preferredHubSectionForWorkingDept,
  setAdminWorkingDepartment,
  workingDepartment,
  type AdminWorkingDepartment,
} from "@/lib/admin-department-context";
import {
  accessibleDepartments,
  hasMultipleDepartmentAccess,
} from "@/lib/department-access";
import { effectiveDepartment, isMasterAdmin } from "@/lib/rbac";
import { invalidateStoreOpsListCaches } from "@/lib/store-ops/client";
import {
  departmentMeta,
  type OperationalDepartment,
  type StoreSpecialist,
} from "@/lib/types";

type Props = {
  specialist: StoreSpecialist | null;
  /** Optional: jump hub to preferred section when pinning. */
  onPinnedNavigate?: (section: "audit" | "appliances" | "department") => void;
  compact?: boolean;
};

export function AdminDepartmentSwitcher({
  specialist,
  onPinnedNavigate,
  compact = false,
}: Props) {
  const [dept, setDept] = useState<AdminWorkingDepartment>("all");
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const master = isMasterAdmin(specialist);
  const multi = hasMultipleDepartmentAccess(specialist);
  const granted = specialist ? accessibleDepartments(specialist) : [];

  useEffect(() => {
    setDept(workingDepartment(specialist));
    function onChange() {
      setDept(workingDepartment(specialist));
    }
    window.addEventListener(ADMIN_DEPT_CONTEXT_EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(ADMIN_DEPT_CONTEXT_EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, [specialist]);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  if (!specialist) return null;

  if (!master && !multi) {
    const scoped = departmentMeta(effectiveDepartment(specialist));
    return (
      <span
        className={`inline-flex h-9 shrink-0 items-center gap-1 rounded-full border border-zinc-700/80 bg-zinc-950/60 px-2 font-mono text-[10px] font-bold uppercase tracking-wide text-zinc-300 ${
          compact ? "max-w-[4.75rem] sm:max-w-[6.25rem]" : "max-w-[6.25rem]"
        }`}
        title={scoped.label}
      >
        <DepartmentIcon
          department={effectiveDepartment(specialist)}
          className="h-3.5 w-3.5 shrink-0 text-accent"
        />
        <span className="truncate">{scoped.shortLabel}</span>
      </span>
    );
  }

  const options: AdminWorkingDepartment[] = master
    ? ["all", ...ADMIN_PINNABLE_DEPARTMENTS]
    : granted;

  function pin(next: AdminWorkingDepartment) {
    if (!master && next !== "all" && !granted.includes(next as OperationalDepartment)) {
      return;
    }
    invalidateStoreOpsListCaches();
    const saved = setAdminWorkingDepartment(next);
    setDept(saved);
    setOpen(false);
    const section = preferredHubSectionForWorkingDept(saved);
    if (section) onPinnedNavigate?.(section);
  }

  const label = adminWorkingDepartmentLabel(dept);
  const pill = adminWorkingDepartmentPillLabel(dept);

  return (
    <div className="relative shrink-0" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={menuId}
        aria-label={`Working department: ${label}`}
        className={`inline-flex h-9 items-center gap-1 rounded-full border border-accent/40 bg-zinc-950/70 px-2 text-left backdrop-blur-sm transition active:scale-[0.98] ${
          compact ? "max-w-[4.85rem] sm:max-w-[6.5rem]" : "max-w-[6.5rem]"
        }`}
      >
        <DepartmentIcon
          department={dept}
          className="h-3.5 w-3.5 shrink-0 text-accent"
        />
        <span className="min-w-0 truncate font-mono text-[10px] font-bold uppercase tracking-wide text-accent">
          {pill}
        </span>
        <HubIcon id="chevronDown" className="h-3.5 w-3.5 shrink-0 text-accent" />
      </button>

      {open ? (
        <ul
          id={menuId}
          role="listbox"
          aria-label="Working department"
          className="glass-card absolute right-0 top-[calc(100%+0.35rem)] z-50 max-h-[min(70dvh,22rem)] w-56 overflow-y-auto p-1.5"
        >
          {options.map((opt) => {
            const active = dept === opt;
            return (
              <li key={opt} role="option" aria-selected={active}>
                <button
                  type="button"
                  onClick={() => pin(opt)}
                  className={`flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-left text-sm font-semibold ${
                    active
                      ? "theme-accent-surface text-accent-fg-soft"
                      : "text-zinc-200 hover:bg-zinc-800/60"
                  }`}
                >
                  <DepartmentIcon
                    department={opt}
                    className={`h-4 w-4 shrink-0 ${
                      active ? "text-accent" : "text-cyan-300/80"
                    }`}
                  />
                  {adminWorkingDepartmentLabel(opt)}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
