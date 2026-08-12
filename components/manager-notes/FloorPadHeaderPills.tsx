"use client";

import { selectOnFocus } from "@/lib/number-input";

type Props = {
  department: string;
  aisle: string;
  bay: number | null;
  onDepartmentChange: (value: string) => void;
  onAisleChange: (value: string) => void;
  onBayChange: (value: number | null) => void;
};

/** Single horizontal scrollable pill bar for Dept / Aisle / Bay. */
export function FloorPadHeaderPills({
  department,
  aisle,
  bay,
  onDepartmentChange,
  onAisleChange,
  onBayChange,
}: Props) {
  return (
    <div className="no-scrollbar flex items-center gap-1.5 overflow-x-auto">
      <PillField
        label="Dept"
        value={department}
        onChange={(v) => onDepartmentChange(v.trim().toLowerCase())}
        className="w-[6.5rem] font-mono"
        placeholder="flooring"
      />
      <PillField
        label="Aisle"
        value={aisle}
        onChange={(v) => onAisleChange(v.toUpperCase())}
        className="w-[3.75rem] font-mono uppercase"
        placeholder="BW"
      />
      <PillField
        label="Bay"
        value={bay == null ? "" : String(bay)}
        onChange={(v) => {
          const raw = v.replace(/\D/g, "");
          onBayChange(raw ? Number(raw) : null);
        }}
        className="w-[2.75rem] font-mono"
        placeholder="4"
        inputMode="numeric"
      />
    </div>
  );
}

function PillField({
  label,
  value,
  onChange,
  className,
  placeholder,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
}) {
  return (
    <label className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full border border-cyan-500/35 bg-cyan-950/30 px-2 shadow-[0_0_14px_-10px_rgba(34,211,238,0.4)]">
      <span className="font-mono text-[8px] font-bold uppercase tracking-[0.12em] text-cyan-400/90">
        {label}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={selectOnFocus}
        placeholder={placeholder}
        inputMode={inputMode}
        className={`bg-transparent text-[11px] font-semibold text-zinc-100 outline-none placeholder:text-zinc-600 ${className ?? ""}`}
      />
    </label>
  );
}
