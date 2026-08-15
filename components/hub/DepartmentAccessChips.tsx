"use client";

/**
 * Multi-select department grants — presentation only.
 * Persist via POST /api/admin/department-access (instant upsert).
 */

import { DepartmentIcon } from "@/components/hub/NavIcons";
import {
  composeAccessibleDepartments,
} from "@/lib/department-access";
import {
  OPERATIONAL_DEPARTMENTS,
  departmentMeta,
  type DepartmentScope,
  type OperationalDepartment,
} from "@/lib/types";

type Props = {
  primary: DepartmentScope;
  value: OperationalDepartment[];
  onChange: (next: OperationalDepartment[]) => void;
  disabled?: boolean;
  label?: string;
};

export function DepartmentAccessChips({
  primary,
  value,
  onChange,
  disabled,
  label = "Cross-department access",
}: Props) {
  const home =
    primary !== "all" && OPERATIONAL_DEPARTMENTS.includes(primary as OperationalDepartment)
      ? (primary as OperationalDepartment)
      : null;
  const selected = new Set(composeAccessibleDepartments(primary, value));

  function toggle(dept: OperationalDepartment) {
    if (disabled || dept === home) return;
    const next = new Set(selected);
    if (next.has(dept)) next.delete(dept);
    else next.add(dept);
    onChange(composeAccessibleDepartments(primary, [...next]));
  }

  return (
    <fieldset className="min-w-0">
      <legend className="mb-1.5 text-sm font-medium text-slate-200">
        {label}
      </legend>
      <p className="mb-2 text-[11px] leading-snug text-zinc-500">
        Primary department stays on.         Extra chips grant Floor / Map / Roster
        access without changing home department.
      </p>
      <div className="flex flex-wrap gap-1.5">
        {OPERATIONAL_DEPARTMENTS.map((dept) => {
          const on = selected.has(dept);
          const locked = dept === home;
          const meta = departmentMeta(dept);
          return (
            <button
              key={dept}
              type="button"
              role="checkbox"
              aria-checked={on}
              disabled={disabled || locked}
              onClick={() => toggle(dept)}
              className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border px-2.5 font-mono text-[10px] font-bold uppercase tracking-wide ${
                on
                  ? "border-accent/50 bg-accent/15 text-accent"
                  : "border-zinc-700/80 bg-zinc-950/60 text-zinc-400"
              } disabled:opacity-70`}
            >
              <DepartmentIcon
                department={dept}
                className="h-3.5 w-3.5 shrink-0"
              />
              {meta.shortLabel}
              {locked ? " · home" : ""}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
