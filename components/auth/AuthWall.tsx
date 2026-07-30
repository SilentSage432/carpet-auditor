"use client";

import { useEffect, useState } from "react";
import { DeptSyncBadge } from "@/components/hub/DeptSyncBadge";
import { TextField } from "@/components/ui/NumberField";
import { formatStoreLabel, getStoreNumber } from "@/lib/store";
import {
  findSpecialistByLogin,
  hasQuickPin,
  needsCredentialSetup,
  roleBadge,
  updateSpecialistCredentials,
  verifyPin,
} from "@/lib/specialists";
import type { StoreSpecialist } from "@/lib/types";

export type AuthWallMode = "login" | "setup" | "unlock";

type Props = {
  mode: AuthWallMode;
  roster: StoreSpecialist[];
  /** Remembered specialist for unlock / setup modes. */
  member: StoreSpecialist | null;
  onAuthenticated: (member: StoreSpecialist) => void;
  /** Switch unlock → full login (different user). */
  onRequestFullLogin?: () => void;
};

/**
 * Non-dismissible zero-access authentication wall.
 * No backdrop dismiss, no Remind Later, no ✕ — workspace stays hidden until auth.
 */
export function AuthWall({
  mode,
  roster,
  member,
  onAuthenticated,
  onRequestFullLogin,
}: Props) {
  const storeLabel = formatStoreLabel(getStoreNumber());

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-slate-950/90 backdrop-blur-2xl sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-wall-title"
        className="relative z-[91] w-full max-w-md rounded-t-2xl border border-emerald-500/30 bg-slate-900 p-5 shadow-2xl sm:rounded-2xl"
      >
        <div className="flex items-start gap-3">
          <DeptSyncBadge size="md" />
          <div className="min-w-0">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-400">
              DeptSync · {storeLabel}
            </p>
            <h1
              id="auth-wall-title"
              className="mt-1 text-lg font-bold text-slate-50"
            >
              {mode === "setup"
                ? "Set Your Permanent Credentials"
                : mode === "unlock"
                  ? "Unlock DeptSync"
                  : "DeptSync — Login to Your Department"}
            </h1>
            <p className="mt-1 text-sm leading-relaxed text-slate-400">
              {mode === "setup"
                ? "Choose a custom username and password before department access unlocks."
                : mode === "unlock"
                  ? `Welcome back, ${member?.name ?? "specialist"}. Enter your PIN or password to continue.`
                  : "Sign in with your store username and password to unlock your workspace."}
            </p>
          </div>
        </div>

        {mode === "login" ? (
          <LoginForm roster={roster} onAuthenticated={onAuthenticated} />
        ) : null}
        {mode === "setup" && member ? (
          <SetupForm member={member} onAuthenticated={onAuthenticated} />
        ) : null}
        {mode === "unlock" && member ? (
          <UnlockForm
            member={member}
            onAuthenticated={onAuthenticated}
            onRequestFullLogin={onRequestFullLogin}
          />
        ) : null}
      </div>
    </div>
  );
}

function LoginForm({
  roster,
  onAuthenticated,
}: {
  roster: StoreSpecialist[];
  onAuthenticated: (member: StoreSpecialist) => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function handleLogin() {
    setBusy(true);
    setError(null);
    const match = findSpecialistByLogin(roster, username, password);
    if (!match) {
      setError("Invalid username or password");
      setBusy(false);
      return;
    }
    onAuthenticated(match);
    setBusy(false);
  }

  return (
    <form
      className="mt-5 space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        handleLogin();
      }}
    >
      <TextField
        label="Username"
        value={username}
        onChange={setUsername}
        placeholder="e.g. amber_appliance"
        autoComplete="username"
      />
      <TextField
        label="Password / PIN"
        value={password}
        onChange={setPassword}
        placeholder="Temporary or permanent password"
        type="password"
        autoComplete="current-password"
      />
      {error ? (
        <p className="text-center text-sm font-semibold text-red-400" role="alert">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={busy || !username.trim() || !password.trim()}
        className="flex min-h-12 w-full items-center justify-center rounded-xl bg-emerald-500 text-sm font-bold text-slate-950 disabled:opacity-40"
      >
        {busy ? "Signing in…" : "Log In"}
      </button>
      <p className="text-center text-[11px] text-slate-500">
        Access is locked until you authenticate. No guest or skip options.
      </p>
    </form>
  );
}

function SetupForm({
  member,
  onAuthenticated,
}: {
  member: StoreSpecialist;
  onAuthenticated: (member: StoreSpecialist) => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (username.trim().length < 3) {
      setError("Username must be at least 3 characters");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }
    if (password !== confirm) {
      setError("Password and confirmation do not match");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const { record } = await updateSpecialistCredentials(member, {
        username,
        password,
      });
      onAuthenticated(record);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not save credentials. Please try again."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-5 space-y-3">
      <p className="rounded-xl border border-amber-500/30 bg-amber-950/40 px-3 py-2 text-xs text-amber-100">
        Signed in as <span className="font-semibold">{member.name}</span>
        {" · "}
        {roleBadge(member)}
        {needsCredentialSetup(member)
          ? " — temporary credentials must be replaced."
          : ""}
      </p>
      <TextField
        label="Custom Username"
        value={username}
        onChange={setUsername}
        placeholder="e.g. amber.appliances"
        autoComplete="username"
      />
      <TextField
        label="Custom Password"
        value={password}
        onChange={setPassword}
        placeholder="At least 6 characters"
        type="password"
        autoComplete="new-password"
      />
      <TextField
        label="Confirm Password"
        value={confirm}
        onChange={setConfirm}
        placeholder="Re-enter password"
        type="password"
        autoComplete="new-password"
      />
      {error ? (
        <p className="text-center text-sm font-semibold text-red-400" role="alert">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        disabled={saving}
        onClick={() => void handleSave()}
        className="flex min-h-12 w-full items-center justify-center rounded-xl bg-emerald-500 text-sm font-bold text-slate-950 disabled:opacity-40"
      >
        {saving ? "Saving…" : "Save & Unlock Department"}
      </button>
    </div>
  );
}

function UnlockForm({
  member,
  onAuthenticated,
  onRequestFullLogin,
}: {
  member: StoreSpecialist;
  onAuthenticated: (member: StoreSpecialist) => void;
  onRequestFullLogin?: () => void;
}) {
  const pinMode = hasQuickPin(member);
  const [secret, setSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(false);

  function fail(message: string) {
    setShake(true);
    setError(message);
    setSecret("");
    window.setTimeout(() => setShake(false), 450);
  }

  function submit(attempt?: string) {
    const value = (attempt ?? secret).trim();
    if (!value) {
      setError(pinMode ? "Enter PIN" : "Enter password");
      return;
    }
    if (verifyPin(member, value)) {
      setSecret("");
      setError(null);
      onAuthenticated(member);
      return;
    }
    fail(pinMode ? "Incorrect PIN" : "Incorrect password");
  }

  function handleDigit(digit: string) {
    const next = secret.length >= 8 ? secret : secret + digit;
    setError(null);
    setSecret(next);
    if (next.length === 4) {
      window.setTimeout(() => submit(next), 80);
    }
  }

  useEffect(() => {
    setSecret("");
    setError(null);
  }, [member.id]);

  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"];

  return (
    <div className={`mt-5 ${shake ? "animate-pin-shake" : ""}`}>
      <p className="mb-3 text-center text-xs text-slate-400">
        {roleBadge(member)}
      </p>

      {pinMode ? (
        <>
          <div className="flex justify-center gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <span
                key={i}
                className={`h-3 w-3 rounded-full border ${
                  i < secret.length
                    ? "border-emerald-400 bg-emerald-400"
                    : "border-slate-600 bg-transparent"
                }`}
              />
            ))}
          </div>
          {error ? (
            <p
              className="mt-3 text-center text-sm font-semibold text-red-400"
              role="alert"
            >
              {error}
            </p>
          ) : null}
          <div className="mt-4 grid grid-cols-3 gap-2">
            {keys.map((key, idx) => {
              if (key === "") return <div key={`empty-${idx}`} />;
              if (key === "⌫") {
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      setError(null);
                      setSecret((prev) => prev.slice(0, -1));
                    }}
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
        </>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <TextField
            label="Password"
            type="password"
            autoComplete="current-password"
            value={secret}
            onChange={(v) => {
              setError(null);
              setSecret(v);
            }}
            placeholder="Enter your password"
          />
          {error ? (
            <p
              className="text-center text-sm font-semibold text-red-400"
              role="alert"
            >
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            className="flex min-h-12 w-full items-center justify-center rounded-xl bg-emerald-500 text-sm font-bold text-slate-950"
          >
            Unlock
          </button>
        </form>
      )}

      {pinMode ? (
        <button
          type="button"
          onClick={() => submit()}
          className="mt-3 flex min-h-12 w-full items-center justify-center rounded-xl bg-emerald-500 text-sm font-bold text-slate-950"
        >
          Unlock
        </button>
      ) : null}

      {onRequestFullLogin ? (
        <button
          type="button"
          onClick={onRequestFullLogin}
          className="mt-2 flex min-h-12 w-full items-center justify-center rounded-xl border border-slate-700 text-sm font-semibold text-slate-300"
        >
          Sign in as a different user
        </button>
      ) : null}
    </div>
  );
}
