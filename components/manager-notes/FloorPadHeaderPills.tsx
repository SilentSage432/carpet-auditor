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

export function FloorPadHeaderPills({
  department,
  aisle,
  bay,
  onDepartmentChange,
  onAisleChange,
  onBayChange,
}: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2 px-3 pt-2">
      <PillField
        label="Dept"
        value={department}
        onChange={(v) => onDepartmentChange(v.trim().toLowerCase())}
        className="min-w-[6.5rem] font-mono"
        placeholder="flooring"
      />
      <PillField
        label="Aisle"
        value={aisle}
        onChange={(v) => onAisleChange(v.toUpperCase())}
        className="min-w-[4.5rem] font-mono uppercase"
        placeholder="BW"
      />
      <PillField
        label="Bay"
        value={bay == null ? "" : String(bay)}
        onChange={(v) => {
          const raw = v.replace(/\D/g, "");
          onBayChange(raw ? Number(raw) : null);
        }}
        className="min-w-[3.5rem] font-mono"
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
    <label className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-cyan-500/35 bg-cyan-950/25 px-2.5 py-1 shadow-[0_0_18px_-10px_rgba(34,211,238,0.45)]">
      <span className="font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-cyan-400/90">
        {label}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={selectOnFocus}
        placeholder={placeholder}
        inputMode={inputMode}
        className={`w-auto min-w-[2.5rem] bg-transparent text-xs font-semibold text-zinc-100 outline-none placeholder:text-zinc-600 ${className ?? ""}`}
      />
    </label>
  );
}
