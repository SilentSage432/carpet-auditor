"use client";

import { useState } from "react";
import { TextField } from "@/components/ui/NumberField";

type Props = {
  open: boolean;
  title?: string;
  subtitle?: string;
  /** Digit keypad (default) or alphanumeric password field. */
  mode?: "pin" | "password";
  onClose: () => void;
  onSuccess: () => void;
  verify: (pin: string) => boolean;
};

export function PinKeypadModal({
  open,
  title = "Enter Supervisor PIN",
  subtitle,
  mode = "pin",
  onClose,
  onSuccess,
  verify,
}: Props) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(false);

  if (!open) return null;

  function fail(message: string) {
    setShake(true);
    setError(message);
    setPin("");
    window.setTimeout(() => setShake(false), 450);
  }

  function backspace() {
    setError(null);
    setPin((prev) => prev.slice(0, -1));
  }

  function submit(nextPin?: string) {
    const attempt = nextPin ?? pin;
    if (!attempt) {
      setError(mode === "password" ? "Enter password" : "Enter PIN");
      return;
    }
    if (verify(attempt)) {
      setPin("");
      setError(null);
      onSuccess();
      return;
    }
    fail(mode === "password" ? "Incorrect password" : "Incorrect PIN");
  }

  function handleDigit(digit: string) {
    const next = pin.length >= 8 ? pin : pin + digit;
    setError(null);
    setPin(next);
    if (next.length === 4) {
      window.setTimeout(() => submit(next), 80);
    }
  }

  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"];

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center">
      <button
        type="button"
        className="absolute inset-0 bg-black/60 backdrop-blur-md"
        aria-label="Close PIN keypad"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pin-title"
        className={`relative z-[71] w-full max-w-sm glass-card theme-modal rounded-t-2xl !rounded-b-none p-4 sm:!rounded-2xl ${
          shake ? "animate-pin-shake" : ""
        }`}
      >
        <h2 id="pin-title" className="glass-title text-center text-lg">
          {title}
        </h2>
        {subtitle ? (
          <p className="mt-1 text-center text-sm text-zinc-400">{subtitle}</p>
        ) : null}

        {mode === "password" ? (
          <div className="mt-4">
            <TextField
              label="Password"
              type="password"
              autoComplete="current-password"
              value={pin}
              onChange={(v) => {
                setError(null);
                setPin(v);
              }}
              placeholder="Enter password"
              autoFocus
            />
          </div>
        ) : (
          <div className="mt-4 flex justify-center gap-2">
            {Array.from({ length: Math.max(4, pin.length || 4) }).map((_, i) => (
              <span
                key={i}
                className={`h-3 w-3 rounded-full border ${
                  i < pin.length
                    ? "border-accent bg-accent"
                    : "border-zinc-600 bg-transparent"
                }`}
              />
            ))}
          </div>
        )}

        {error && (
          <p className="mt-3 text-center text-sm font-semibold text-rose-400" role="alert">
            {error}
          </p>
        )}

        {mode === "pin" ? (
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
                    className="flex min-h-[44px] h-14 items-center justify-center rounded-xl border border-zinc-700/80 bg-zinc-950/80 text-lg font-semibold text-zinc-200 transition focus:outline-none focus:ring-2 focus:ring-accent/50 active:scale-95"
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
                  className="flex min-h-[44px] h-14 items-center justify-center rounded-xl border border-zinc-700/80 bg-zinc-950/80 font-mono text-xl font-bold text-white transition focus:outline-none focus:ring-2 focus:ring-accent/50 active:scale-95"
                >
                  {key}
                </button>
              );
            })}
          </div>
        ) : null}

        <button
          type="button"
          onClick={() => submit()}
          className="btn-primary-glow mt-3 flex min-h-[44px] w-full items-center justify-center rounded-xl text-sm"
        >
          Unlock
        </button>
        <button
          type="button"
          onClick={onClose}
          className="mt-2 flex min-h-[44px] w-full items-center justify-center rounded-xl border border-zinc-700/80 text-sm font-semibold text-zinc-300"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
