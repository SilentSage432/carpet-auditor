"use client";

/**
 * Department picker with Lucide glyphs — native <option> cannot host SVGs.
 * Presentation only; department knowledge stays in lib/types.ts.
 */

import { useEffect, useId, useRef, useState } from "react";
import { DepartmentIcon, HubIcon } from "@/components/hub/NavIcons";
import {
  OPERATIONAL_DEPARTMENTS,
  associateFloorTitle,
  departmentMeta,
  type DepartmentScope,
} from "@/lib/types";

type Props = {
  value: DepartmentScope;
  onChange: (next: DepartmentScope) => void;
  disabled?: boolean;
  id?: string;
  label?: string;
  showFloorTitle?: boolean;
  className?: string;
};

export function DepartmentPicker({
  value,
  onChange,
  disabled,
  id,
  label,
  showFloorTitle = true,
  className = "",
}: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const meta = departmentMeta(value);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      {label ? (
        <span className="mb-1.5 block text-sm font-medium text-slate-200">
          {label}
        </span>
      ) : null}
      <button
        type="button"
        id={id}
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={listId}
        onClick={() => setOpen((v) => !v)}
        className="glass-input flex min-h-11 w-full items-center gap-2 px-3 text-left text-sm disabled:opacity-40"
      >
        <DepartmentIcon
          department={value}
          className="h-4 w-4 shrink-0 text-accent"
        />
        <span className="min-w-0 flex-1 truncate text-zinc-100">
          {meta.shortLabel}
          {showFloorTitle ? ` · ${associateFloorTitle(value)}` : ""}
        </span>
        <HubIcon id="chevronDown" className="h-3.5 w-3.5 shrink-0 text-accent" />
      </button>
      {open ? (
        <ul
          id={listId}
          role="listbox"
          className="glass-card absolute left-0 right-0 z-40 mt-1 max-h-64 overflow-y-auto p-1.5"
        >
          {OPERATIONAL_DEPARTMENTS.map((id) => {
            const row = departmentMeta(id);
            const active = id === value;
            return (
              <li key={id} role="option" aria-selected={active}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(id);
                    setOpen(false);
                  }}
                  className={`flex min-h-11 w-full items-center gap-2 rounded-xl px-2.5 text-left text-sm ${
                    active
                      ? "theme-accent-surface text-accent-fg-soft"
                      : "text-zinc-200 hover:bg-zinc-800/60"
                  }`}
                >
                  <DepartmentIcon
                    department={id}
                    className={`h-4 w-4 shrink-0 ${
                      active ? "text-accent" : "text-cyan-300/80"
                    }`}
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {row.shortLabel}
                    {showFloorTitle ? ` · ${associateFloorTitle(id)}` : ""}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
