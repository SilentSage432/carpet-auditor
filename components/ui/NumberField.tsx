"use client";

import {
  useCallback,
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  SCANNER_INTER_KEY_MS,
  sanitizeBarcodeScan,
} from "@/lib/barcode";
import {
  sanitizeDecimalInput,
  sanitizeIntegerInput,
  selectOnFocus,
} from "@/lib/number-input";

type ScanCapableProps = {
  /** Called when Enter ends a scan (or manual commit). */
  onScanCommit?: (sanitizedValue: string) => void;
  /** Visual flash after a successful match. */
  flash?: boolean;
};

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
} & ScanCapableProps;

const baseInput =
  "min-h-12 h-12 w-full rounded-xl border border-slate-800 bg-slate-950 px-4 text-base font-semibold text-slate-100 outline-none transition focus:border-emerald-500";

function useScannerKeyTracking(onScanCommit?: (v: string) => void) {
  const lastKeyAt = useRef(0);
  const rapidBurst = useRef(false);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      const now = Date.now();
      const gap = now - lastKeyAt.current;
      if (lastKeyAt.current > 0 && gap > 0 && gap < SCANNER_INTER_KEY_MS) {
        rapidBurst.current = true;
      }
      lastKeyAt.current = now;

      if (e.key === "Enter") {
        e.preventDefault();
        const raw = e.currentTarget.value;
        const sanitized = sanitizeBarcodeScan(raw);
        // Prefer scan commit on Enter (scanner suffix) or rapid burst
        if (onScanCommit && (rapidBurst.current || sanitized.length > 0)) {
          onScanCommit(sanitized || sanitizeBarcodeScan(raw));
        }
        rapidBurst.current = false;
      }
    },
    [onScanCommit]
  );

  return { onKeyDown };
}

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
  onScanCommit,
  flash,
}: NumberFieldProps) {
  const { onKeyDown } = useScannerKeyTracking(onScanCommit);

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
        onKeyDown={onScanCommit ? onKeyDown : undefined}
        className={`${baseInput} ${leftIcon ? "pl-11" : ""} ${center ? "text-center font-mono tabular-nums" : "font-mono tabular-nums"} ${
          flash
            ? "border-emerald-400 ring-2 ring-emerald-400/50 shadow-[0_0_20px_-4px_rgba(16,185,129,0.7)]"
            : ""
        } ${inputClassName ?? ""}`}
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
  /** When true, sanitize digit queries and support scan Enter. */
  scanDigits?: boolean;
} & ScanCapableProps;

export function TextField({
  value,
  onChange,
  label,
  className,
  inputClassName,
  placeholder,
  leftIcon,
  "aria-label": ariaLabel,
  onScanCommit,
  flash,
  scanDigits,
}: TextFieldProps) {
  const { onKeyDown } = useScannerKeyTracking(onScanCommit);

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
        onChange={(e) => {
          const next = e.target.value;
          onChange(scanDigits ? sanitizeIntegerInput(next) : next);
        }}
        onKeyDown={onScanCommit ? onKeyDown : undefined}
        className={`${baseInput} ${leftIcon ? "pl-11" : ""} ${
          flash
            ? "border-emerald-400 ring-2 ring-emerald-400/50 shadow-[0_0_20px_-4px_rgba(16,185,129,0.7)]"
            : ""
        } ${inputClassName ?? ""}`}
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
