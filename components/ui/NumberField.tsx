"use client";

import type { ReactNode } from "react";
import {
  sanitizeDecimalInput,
  sanitizeIntegerInput,
  selectOnFocus,
} from "@/lib/number-input";

type NumberFieldProps = {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  className?: string;
  inputClassName?: string;
  mode?: "integer" | "decimal" | "digits";
  placeholder?: string;
  min?: number;
  "aria-label"?: string;
  inputMode?: "numeric" | "decimal";
  center?: boolean;
  leftIcon?: ReactNode;
};

const baseInput =
  "min-h-12 h-12 w-full rounded-xl border border-slate-800 bg-slate-950 px-4 text-base font-semibold text-slate-100 outline-none transition focus:border-emerald-500";

export function NumberField({
  value,
  onChange,
  label,
  className,
  inputClassName,
  mode = "integer",
  placeholder,
  "aria-label": ariaLabel,
  inputMode,
  center,
  leftIcon,
}: NumberFieldProps) {
  function handleChange(raw: string) {
    if (mode === "decimal") onChange(sanitizeDecimalInput(raw));
    else onChange(sanitizeIntegerInput(raw));
  }

  const input = (
    <div className="relative">
      {leftIcon ? (
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-500">
          {leftIcon}
        </span>
      ) : null}
      <input
        type="text"
        inputMode={inputMode ?? (mode === "decimal" ? "decimal" : "numeric")}
        pattern={mode === "decimal" ? "[0-9]*[.]?[0-9]*" : "[0-9]*"}
        autoComplete="off"
        placeholder={placeholder}
        aria-label={ariaLabel ?? label}
        value={value}
        onFocus={selectOnFocus}
        onChange={(e) => handleChange(e.target.value)}
        className={`${baseInput} ${leftIcon ? "pl-11" : ""} ${center ? "text-center font-mono tabular-nums" : "font-mono tabular-nums"} ${inputClassName ?? ""}`}
      />
    </div>
  );

  if (!label) {
    return <div className={className}>{input}</div>;
  }

  return (
    <label className={`block space-y-1.5 ${className ?? ""}`}>
      <span className="text-sm font-medium text-slate-200">{label}</span>
      {input}
    </label>
  );
}

type TextFieldProps = {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  className?: string;
  inputClassName?: string;
  placeholder?: string;
  leftIcon?: ReactNode;
  "aria-label"?: string;
};

export function TextField({
  value,
  onChange,
  label,
  className,
  inputClassName,
  placeholder,
  leftIcon,
  "aria-label": ariaLabel,
}: TextFieldProps) {
  const input = (
    <div className="relative">
      {leftIcon ? (
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-500">
          {leftIcon}
        </span>
      ) : null}
      <input
        type="text"
        autoComplete="off"
        placeholder={placeholder}
        aria-label={ariaLabel ?? label}
        value={value}
        onFocus={selectOnFocus}
        onChange={(e) => onChange(e.target.value)}
        className={`${baseInput} ${leftIcon ? "pl-11" : ""} ${inputClassName ?? ""}`}
      />
    </div>
  );

  if (!label) return <div className={className}>{input}</div>;

  return (
    <label className={`block space-y-1.5 ${className ?? ""}`}>
      <span className="text-sm font-medium text-slate-200">{label}</span>
      {input}
    </label>
  );
}
