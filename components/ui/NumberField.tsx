"use client";

import {
  useCallback,
  useEffect,
  useRef,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from "react";
import {
  SCANNER_BURST_MIN_DIGITS,
  SCANNER_DEBOUNCE_MS,
  SCANNER_INTER_KEY_MS,
  sanitizeBarcodeScan,
} from "@/lib/barcode";
import {
  sanitizeDecimalInput,
  sanitizeIntegerInput,
  selectOnFocus,
} from "@/lib/number-input";

type ScanCapableProps = {
  /** Called when Enter ends a scan, or a rapid digit burst settles. */
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
  onBlur?: () => void;
  inputRef?: Ref<HTMLInputElement>;
  autoFocus?: boolean;
} & ScanCapableProps;

const baseInput =
  "min-h-12 h-12 w-full rounded-xl border border-slate-800 bg-slate-950 px-4 text-base font-semibold text-slate-100 outline-none transition focus:border-emerald-500";

function assignRef<T>(ref: Ref<T> | undefined, node: T | null) {
  if (!ref) return;
  if (typeof ref === "function") ref(node);
  else ref.current = node;
}

/**
 * Dual scan trigger: Enter key + rapid digit burst (8+ chars, ≤150ms gaps)
 * with 250ms quiet debounce so wedges without Enter still resolve.
 */
function useScannerKeyTracking(
  onScanCommit?: (v: string) => void,
  getCurrentValue?: () => string
) {
  const lastChangeAt = useRef(0);
  const prevDigitLen = useRef(0);
  const debounceTimer = useRef<number | null>(null);
  const onScanCommitRef = useRef(onScanCommit);
  const getValueRef = useRef(getCurrentValue);

  useEffect(() => {
    onScanCommitRef.current = onScanCommit;
  }, [onScanCommit]);

  useEffect(() => {
    getValueRef.current = getCurrentValue;
  }, [getCurrentValue]);

  useEffect(() => {
    return () => {
      if (debounceTimer.current != null) {
        window.clearTimeout(debounceTimer.current);
      }
    };
  }, []);

  const clearDebounce = useCallback(() => {
    if (debounceTimer.current != null) {
      window.clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }
  }, []);

  const commit = useCallback(
    (raw: string) => {
      clearDebounce();
      const sanitized = sanitizeBarcodeScan(raw);
      if (!sanitized || !onScanCommitRef.current) return;
      onScanCommitRef.current(sanitized);
    },
    [clearDebounce]
  );

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (!onScanCommitRef.current) return;
      if (e.key !== "Enter") return;
      e.preventDefault();
      e.stopPropagation();
      commit(e.currentTarget.value);
    },
    [commit]
  );

  /** Call from onChange after the controlled value updates. */
  const noteValueChange = useCallback(
    (nextValue: string) => {
      if (!onScanCommitRef.current) return;

      const digits = sanitizeBarcodeScan(nextValue);
      const now = Date.now();
      const gap = lastChangeAt.current > 0 ? now - lastChangeAt.current : 0;
      const digitDelta = digits.length - prevDigitLen.current;
      lastChangeAt.current = now;
      prevDigitLen.current = digits.length;

      clearDebounce();

      if (digits.length < SCANNER_BURST_MIN_DIGITS) return;

      const rapidBurst = gap > 0 && gap <= SCANNER_INTER_KEY_MS;
      const pasteOrDump = digitDelta >= SCANNER_BURST_MIN_DIGITS || gap === 0;

      if (!rapidBurst && !pasteOrDump) return;

      debounceTimer.current = window.setTimeout(() => {
        debounceTimer.current = null;
        const latest = getValueRef.current?.() ?? nextValue;
        commit(latest);
      }, SCANNER_DEBOUNCE_MS);
    },
    [clearDebounce, commit]
  );

  return { onKeyDown, noteValueChange };
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
  onBlur,
  inputRef,
  autoFocus,
}: NumberFieldProps) {
  const localRef = useRef<HTMLInputElement | null>(null);
  const getCurrentValue = useCallback(
    () => localRef.current?.value ?? value,
    [value]
  );
  const { onKeyDown, noteValueChange } = useScannerKeyTracking(
    onScanCommit,
    getCurrentValue
  );

  function handleChange(raw: string) {
    const next =
      mode === "decimal" ? sanitizeDecimalInput(raw) : sanitizeIntegerInput(raw);
    onChange(next);
    if (onScanCommit) noteValueChange(next);
  }

  const input = (
    <div className="relative">
      {leftIcon ? (
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-500">
          {leftIcon}
        </span>
      ) : null}
      <input
        ref={(node) => {
          localRef.current = node;
          assignRef(inputRef, node);
        }}
        type="text"
        inputMode={inputMode ?? (mode === "decimal" ? "decimal" : "numeric")}
        pattern={mode === "decimal" ? "[0-9]*[.]?[0-9]*" : "[0-9]*"}
        autoComplete="off"
        autoFocus={autoFocus}
        placeholder={placeholder}
        aria-label={ariaLabel ?? label}
        value={value}
        onFocus={selectOnFocus}
        onBlur={() => onBlur?.()}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={(e) => {
          if (onScanCommit) {
            onKeyDown(e);
            return;
          }
          if (e.key === "Enter") {
            e.preventDefault();
            onBlur?.();
            e.currentTarget.blur();
          }
        }}
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
  inputRef?: Ref<HTMLInputElement>;
  autoFocus?: boolean;
  type?: "text" | "password";
  autoComplete?: string;
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
  inputRef,
  autoFocus,
  type = "text",
  autoComplete = "off",
}: TextFieldProps) {
  const localRef = useRef<HTMLInputElement | null>(null);
  const getCurrentValue = useCallback(
    () => localRef.current?.value ?? value,
    [value]
  );
  const { onKeyDown, noteValueChange } = useScannerKeyTracking(
    onScanCommit,
    getCurrentValue
  );

  const input = (
    <div className="relative">
      {leftIcon ? (
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-500">
          {leftIcon}
        </span>
      ) : null}
      <input
        ref={(node) => {
          localRef.current = node;
          assignRef(inputRef, node);
        }}
        type={type}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        placeholder={placeholder}
        aria-label={ariaLabel ?? label}
        value={value}
        onFocus={selectOnFocus}
        onChange={(e) => {
          const next = scanDigits
            ? sanitizeIntegerInput(e.target.value)
            : e.target.value;
          onChange(next);
          if (onScanCommit) noteValueChange(next);
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
