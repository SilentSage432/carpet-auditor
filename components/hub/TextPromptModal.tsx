"use client";

import { useEffect, useRef, useState } from "react";
import { TextField } from "@/components/ui/NumberField";

type Props = {
  open: boolean;
  title: string;
  subtitle?: string;
  label?: string;
  placeholder?: string;
  confirmLabel?: string;
  initialValue?: string;
  scanDigits?: boolean;
  onClose: () => void;
  onConfirm: (value: string) => void;
};

export function TextPromptModal({
  open,
  title,
  subtitle,
  label,
  placeholder,
  confirmLabel = "Confirm",
  initialValue = "",
  scanDigits = false,
  onClose,
  onConfirm,
}: Props) {
  const [value, setValue] = useState(initialValue);
  const inputWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setValue(initialValue);
    window.setTimeout(() => {
      const input = inputWrapRef.current?.querySelector("input");
      input?.focus();
      input?.select();
    }, 50);
  }, [open, initialValue]);

  if (!open) return null;

  function submit() {
    const trimmed = value.trim();
    if (!trimmed) return;
    onConfirm(trimmed);
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center">
      <button
        type="button"
        className="absolute inset-0 bg-black/60 backdrop-blur-md"
        aria-label="Close"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="text-prompt-title"
        className="relative z-[61] w-full max-w-md overflow-hidden glass-card rounded-t-2xl !rounded-b-none border-emerald-500/20 p-4 sm:!rounded-2xl"
      >
        <h2
          id="text-prompt-title"
          className="text-lg font-bold text-white"
        >
          {title}
        </h2>
        {subtitle ? (
          <p className="mt-1 text-sm text-zinc-400">{subtitle}</p>
        ) : null}
        <div ref={inputWrapRef} className="mt-4">
          <TextField
            label={label}
            value={value}
            onChange={setValue}
            placeholder={placeholder}
            scanDigits={scanDigits}
            onScanCommit={(v) => {
              setValue(v);
              if (v.trim()) onConfirm(v.trim());
            }}
          />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex h-12 items-center justify-center rounded-xl border border-zinc-700 text-sm font-semibold text-zinc-300"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!value.trim()}
            onClick={submit}
            className="flex h-12 items-center justify-center btn-primary-glow rounded-xl text-sm disabled:opacity-40"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
