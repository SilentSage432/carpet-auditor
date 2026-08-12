"use client";

/**
 * Master Admin working-department pin — presentation only.
 * Context ownership: lib/admin-department-context.ts
 */

import { useEffect, useState } from "react";
import {
  ADMIN_DEPT_CONTEXT_EVENT,
  ADMIN_PINNABLE_DEPARTMENTS,
  adminWorkingDepartmentLabel,
  preferredHubSectionForWorkingDept,
  readAdminWorkingDepartment,
  setAdminWorkingDepartment,
  type AdminWorkingDepartment,
} from "@/lib/admin-department-context";
import { isMasterAdmin } from "@/lib/rbac";
import type { StoreSpecialist } from "@/lib/types";

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

  useEffect(() => {
    setDept(readAdminWorkingDepartment());
    function onChange() {
      setDept(readAdminWorkingDepartment());
    }
    window.addEventListener(ADMIN_DEPT_CONTEXT_EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(ADMIN_DEPT_CONTEXT_EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  if (!isMasterAdmin(specialist)) return null;

  const options: AdminWorkingDepartment[] = [
    "all",
    ...ADMIN_PINNABLE_DEPARTMENTS.filter(
      (d) => d === "flooring" || d === "appliances" || d === "plumbing"
    ),
  ];

  function pin(next: AdminWorkingDepartment) {
    const saved = setAdminWorkingDepartment(next);
    setDept(saved);
    const section = preferredHubSectionForWorkingDept(saved);
    if (section) onPinnedNavigate?.(section);
  }

  return (
    <div
      className={
        compact
          ? "flex max-w-full gap-1 overflow-x-auto no-scrollbar"
          : "flex max-w-full gap-1.5 overflow-x-auto pb-0.5 no-scrollbar"
      }
      role="group"
      aria-label="Master Admin working department"
    >
      {options.map((opt) => {
        const active = dept === opt;
        return (
          <button
            key={opt}
            type="button"
            onClick={() => pin(opt)}
            className={`min-h-[44px] shrink-0 rounded-xl border px-2.5 text-[10px] font-bold uppercase tracking-wide transition active:scale-[0.98] ${
              active
                ? opt === "flooring"
                  ? "border-emerald-500/55 bg-emerald-950/55 text-emerald-100 shadow-[0_0_16px_-6px_rgba(16,185,129,0.6)]"
                  : opt === "appliances"
                    ? "border-cyan-500/55 bg-cyan-950/50 text-cyan-100 shadow-[0_0_16px_-6px_rgba(34,211,238,0.55)]"
                    : "border-amber-400/50 bg-amber-950/45 text-amber-100"
                : "border-zinc-700/80 bg-zinc-950/50 text-zinc-400"
            }`}
          >
            {adminWorkingDepartmentLabel(opt)}
          </button>
        );
      })}
    </div>
  );
}
