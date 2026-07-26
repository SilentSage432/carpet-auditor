"use client";

import { useEffect, useState } from "react";

type Props = {
  open: boolean;
  title?: string;
  subtitle?: string;
  onClose: () => void;
  onSuccess: () => void;
  verify: (pin: string) => boolean;
};

export function PinKeypadModal({
  open,
  title = "Enter Supervisor PIN",
  subtitle,
  onClose,
  onSuccess,
  verify,
}: Props) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(false);

  useEffect(() => {
    if (open) {
      setPin("");
      setError(null);
      setShake(false);
    }
  }, [open]);

  if (!open) return null;

  function backspace() {
    setError(null);
    setPin((prev) => prev.slice(0, -1));
  }

  function submit(nextPin?: string) {
    const attempt = nextPin ?? pin;
    if (!attempt) {
      setError("Enter PIN");
      return;
    }
    if (verify(attempt)) {
      setPin("");
      setError(null);
      onSuccess();
      return;
    }
    setShake(true);
    setError("Incorrect PIN");
    setPin("");
    window.setTimeout(() => setShake(false), 450);
  }

  function handleDigit(digit: string) {
    const next = pin.length >= 8 ? pin : pin + digit;
    setError(null);
    setPin(next);
    // Auto-submit common 4-digit PINs
    if (next.length === 4) {
      window.setTimeout(() => submit(next), 80);
    }
  }

  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"];

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center">
      <button
        type="button"
        className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm"
        aria-label="Close PIN keypad"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pin-title"
        className={`relative z-[71] w-full max-w-sm rounded-t-2xl border border-slate-700 bg-slate-900 p-4 shadow-2xl sm:rounded-2xl ${
          shake ? "animate-pin-shake" : ""
        }`}
      >
        <h2 id="pin-title" className="text-center text-lg font-bold text-slate-50">
          {title}
        </h2>
        {subtitle ? (
          <p className="mt-1 text-center text-sm text-slate-400">{subtitle}</p>
        ) : null}

        <div className="mt-4 flex justify-center gap-2">
          {Array.from({ length: Math.max(4, pin.length || 4) }).map((_, i) => (
            <span
              key={i}
              className={`h-3 w-3 rounded-full border ${
                i < pin.length
                  ? "border-emerald-400 bg-emerald-400"
                  : "border-slate-600 bg-transparent"
              }`}
            />
          ))}
        </div>

        {error && (
          <p className="mt-3 text-center text-sm font-semibold text-red-400" role="alert">
            {error}
          </p>
        )}

        <div className="mt-4 grid grid-cols-3 gap-2">
          {keys.map((key, idx) => {
            if (key === "") {
              return <div key={`empty-${idx}`} />;
            }
            if (key === "⌫") {
              return (
                <button
                  key={key}
                  type="button"
                  onClick={backspace}
                  className="flex h-14 items-center justify-center rounded-xl border border-slate-700 bg-slate-950 text-lg font-semibold text-slate-200 active:scale-95"
                >
                  ⌫
                </button>
              );
            }
            return (
              <button
                key={key}
                type="button"
                onClick={() => handleDigit(key)}
                className="flex h-14 items-center justify-center rounded-xl border border-slate-700 bg-slate-950 font-mono text-xl font-bold text-slate-50 active:scale-95"
              >
                {key}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => submit()}
          className="mt-3 flex min-h-12 w-full items-center justify-center rounded-xl bg-emerald-500 text-sm font-bold text-slate-950"
        >
          Unlock
        </button>
        <button
          type="button"
          onClick={onClose}
          className="mt-2 flex min-h-12 w-full items-center justify-center rounded-xl border border-slate-700 text-sm font-semibold text-slate-300"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
