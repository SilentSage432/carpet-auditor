"use client";

import { useRef, useState } from "react";
import { DeptSyncBadge } from "@/components/hub/DeptSyncBadge";
import { TextField } from "@/components/ui/NumberField";
import {
  requestPinResetLink,
} from "@/lib/phone-auth";
import { formatStoreLabel, getStoreNumber } from "@/lib/store";
import {
  findSpecialistByLogin,
  hasQuickPin,
  needsCredentialSetup,
  roleBadge,
  updateSpecialistCredentials,
  verifyPin,
} from "@/lib/specialists";
import { tryEstablishHubBridgeSession, establishHubBridgeSession } from "@/lib/store-ops/hub-bridge-client";
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
  // Prefer known specialist profile store (unlock/setup); else device hub store.
  const storeLabel = formatStoreLabel(
    member?.store_number?.trim() || getStoreNumber()
  );

  return (
    <div className="glass-void fixed inset-0 z-[90] flex items-end justify-center sm:items-center">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-black/40 backdrop-blur-md"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-wall-title"
        className="glass-card theme-modal relative z-[91] w-full max-w-md rounded-t-2xl !rounded-b-none p-5 sm:!rounded-2xl"
      >
        <div className="flex flex-col items-center text-center">
          <DeptSyncBadge size="lg" branded />
          <p className="mt-4 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-accent">
            DeptSync · {storeLabel}
          </p>
          <h1
            id="auth-wall-title"
            className="glass-title mt-1.5 text-xl tracking-tight"
          >
            {mode === "setup"
              ? "Set Your Permanent Credentials"
              : mode === "unlock"
                ? "Unlock DeptSync"
                : "Login to Your Department"}
          </h1>
          <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-zinc-400">
            {mode === "setup"
              ? "Choose a custom username and password before department access unlocks."
              : mode === "unlock"
                ? `Welcome back, ${member?.name ?? "specialist"}. Enter your PIN or password to continue.`
                : "Sign in with your store username and password to unlock your workspace."}
          </p>
        </div>

        {mode === "login" ? (
          <LoginForm roster={roster} onAuthenticated={onAuthenticated} />
        ) : null}
        {mode === "setup" && member ? (
          <SetupForm member={member} onAuthenticated={onAuthenticated} />
        ) : null}
        {mode === "unlock" && member ? (
          <UnlockForm
            key={member.id}
            member={member}
            roster={roster}
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
  const [phoneResetOpen, setPhoneResetOpen] = useState(false);
  const submittingRef = useRef(false);

  // AUTH-006: PIN/password is the sole login path — no biometric enroll/resume.
  async function finishLogin(member: StoreSpecialist, pin?: string) {
    if (pin) {
      const bridgeError = await tryEstablishHubBridgeSession(member, pin);
      if (bridgeError) {
        setError(bridgeError);
        return;
      }
    }
    onAuthenticated(member);
  }

  async function handleLogin() {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const match = findSpecialistByLogin(roster, username, password);
      if (match) {
        await finishLogin(match, password.trim());
        return;
      }

      const bridge = await establishHubBridgeSession({
        username: username.trim() || "master_admin",
        pin: password.trim(),
        store_number: getStoreNumber() || undefined,
      });
      if (bridge.ok) {
        const recovered =
          bridge.specialist ??
          roster.find((m) => String(m.id) === String(bridge.specialist_id)) ??
          null;
        if (recovered) {
          await finishLogin(recovered);
          return;
        }
        setError(
          "Sign-in succeeded but your roster profile was not returned. Reload and sign in again with your PIN."
        );
        return;
      }

      setError(bridge.error || "Invalid username or password");
    } finally {
      submittingRef.current = false;
      setBusy(false);
    }
  }

  if (phoneResetOpen) {
    return (
      <PhoneResetPanel onCancel={() => setPhoneResetOpen(false)} />
    );
  }

  return (
    <form
      className="mt-5 space-y-3"
      method="post"
      action="#"
      autoComplete="on"
      onSubmit={(e) => {
        e.preventDefault();
        void handleLogin();
      }}
    >
      <TextField
        id="deptsync-username"
        name="username"
        label="Username"
        value={username}
        onChange={setUsername}
        autoComplete="username"
      />
      <TextField
        id="deptsync-password"
        name="password"
        label="Password / PIN"
        value={password}
        onChange={setPassword}
        type="password"
        autoComplete="current-password"
        passwordToggle
      />
      {error ? (
        <p className="text-center text-sm font-semibold text-rose-400" role="alert">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={busy || !username.trim() || !password.trim()}
        className="btn-primary-glow flex min-h-[44px] w-full items-center justify-center rounded-xl text-sm disabled:opacity-40"
      >
        {busy ? "Signing in…" : "Log In"}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setError(null);
          setPhoneResetOpen(true);
        }}
        className="flex min-h-[44px] w-full items-center justify-center rounded-xl border border-zinc-700/80 bg-zinc-950/50 text-sm font-semibold text-emerald-300 active:scale-[0.98] disabled:opacity-40"
      >
        Forgot Access Code? Reset via Phone
      </button>
      <p className="text-center text-[11px] leading-relaxed text-zinc-400">
        Sign in with your username and PIN or password. Idle lock is 8 hours.
      </p>
    </form>
  );
}

function PhoneResetPanel({
  onCancel,
}: {
  onCancel: () => void;
}) {
  const [phone, setPhone] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSend() {
    setBusy(true);
    setError(null);
    try {
      const result = await requestPinResetLink(phone);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSent(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-5 space-y-3">
      <p className="rounded-xl border border-emerald-500/30 bg-emerald-950/40 px-3 py-2 text-xs leading-relaxed text-emerald-100">
        We&apos;ll text a one-time link to the mobile number on your DeptSync
        profile. Open it to set a new 4–6 digit PIN.
      </p>

      {sent ? (
        <p className="rounded-xl border border-emerald-500/30 bg-emerald-950/30 px-3 py-3 text-sm text-emerald-100">
          If that number is on this store roster, a reset link is on the way.
          The link expires in 30 minutes and can be used once.
        </p>
      ) : (
        <>
          <TextField
            id="deptsync-reset-phone"
            name="tel"
            label="Verified Mobile Number"
            value={phone}
            onChange={setPhone}
            autoComplete="tel"
          />
          <button
            type="button"
            disabled={busy || !phone.trim()}
            onClick={() => void handleSend()}
            className="btn-primary-glow flex min-h-[44px] w-full items-center justify-center rounded-xl text-sm disabled:opacity-40"
          >
            {busy ? "Sending link…" : "Send PIN reset link"}
          </button>
        </>
      )}

      {error ? (
        <p className="text-center text-sm font-semibold text-rose-400" role="alert">
          {error}
        </p>
      ) : null}

      <button
        type="button"
        disabled={busy}
        onClick={onCancel}
        className="flex min-h-[44px] w-full items-center justify-center text-sm font-semibold text-zinc-400"
      >
        ← Back to login
      </button>
    </div>
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
  const [phone, setPhone] = useState(member.phone_number ?? "");
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
    if (!phone.trim()) {
      setError("Add a verified mobile number for phone recovery");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const { record } = await updateSpecialistCredentials(member, {
        username,
        password,
        phone,
      });
      const bridgeError = await tryEstablishHubBridgeSession(
        record,
        password.trim()
      );
      if (bridgeError) {
        setError(bridgeError);
        return;
      }
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
    <form
      className="mt-5 space-y-3"
      method="post"
      action="#"
      autoComplete="on"
      onSubmit={(e) => {
        e.preventDefault();
        void handleSave();
      }}
    >
      <p className="rounded-xl border border-amber-500/30 bg-amber-950/40 px-3 py-2 text-xs text-amber-100">
        Signed in as <span className="font-semibold">{member.name}</span>
        {" · "}
        {roleBadge(member)}
        {needsCredentialSetup(member)
          ? " — temporary credentials must be replaced."
          : ""}
      </p>
      <TextField
        id="deptsync-setup-username"
        name="username"
        label="Custom Username"
        value={username}
        onChange={setUsername}
        autoComplete="username"
      />
      <TextField
        id="deptsync-setup-phone"
        name="tel"
        label="Verified Mobile Number"
        value={phone}
        onChange={setPhone}
        autoComplete="tel"
      />
      <TextField
        id="deptsync-setup-password"
        name="new-password"
        label="Custom Password"
        value={password}
        onChange={setPassword}
        type="password"
        autoComplete="new-password"
        passwordToggle
      />
      <TextField
        id="deptsync-setup-password-confirm"
        name="new-password-confirm"
        label="Confirm Password"
        value={confirm}
        onChange={setConfirm}
        type="password"
        autoComplete="new-password"
        passwordToggle
      />
      <p className="text-[11px] leading-relaxed text-zinc-400">
        Mobile is stored on your Supabase profile and used for SMS OTP access
        recovery.
      </p>
      {error ? (
        <p className="text-center text-sm font-semibold text-rose-400" role="alert">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={saving}
        className="btn-primary-glow flex min-h-[44px] w-full items-center justify-center rounded-xl text-sm disabled:opacity-40"
      >
        {saving ? "Saving…" : "Save & Unlock Department"}
      </button>
    </form>
  );
}

function UnlockForm({
  member,
  roster,
  onAuthenticated,
  onRequestFullLogin,
}: {
  member: StoreSpecialist;
  roster: StoreSpecialist[];
  onAuthenticated: (member: StoreSpecialist) => void;
  onRequestFullLogin?: () => void;
}) {
  const pinMode = hasQuickPin(member);
  const [secret, setSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const [busy, setBusy] = useState(false);
  const submittingRef = useRef(false);

  function fail(message: string) {
    setShake(true);
    setError(message);
    setSecret("");
    window.setTimeout(() => setShake(false), 450);
  }

  async function submit(attempt?: string) {
    const value = (attempt ?? secret).trim();
    if (!value) {
      setError(pinMode ? "Enter PIN" : "Enter password");
      return;
    }
    if (submittingRef.current) return;
    submittingRef.current = true;

    setBusy(true);
    setError(null);
    try {
      // Prefer server Hub-bridge (source of truth). Local verify alone can be
      // stale; master PIN unlocks an existing Master Admin only.
      const bridge = await establishHubBridgeSession({
        username: member.username || member.name || "master_admin",
        specialist_id: member.id,
        pin: value,
        store_number: member.store_number,
      });
      if (bridge.ok) {
        const matched =
          bridge.specialist ??
          roster.find((m) => String(m.id) === String(bridge.specialist_id)) ??
          member;
        setSecret("");
        onAuthenticated(matched);
        return;
      }

      if (verifyPin(member, value)) {
        fail(bridge.error);
        return;
      }
      fail(pinMode ? "Incorrect PIN" : "Incorrect password");
    } finally {
      submittingRef.current = false;
      setBusy(false);
    }
  }

  function handleDigit(digit: string) {
    if (busy || submittingRef.current) return;
    const next = secret.length >= 8 ? secret : secret + digit;
    setError(null);
    setSecret(next);
    if (next.length === 4) {
      window.setTimeout(() => {
        void submit(next);
      }, 80);
    }
  }

  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"];

  return (
    <div className={`mt-5 ${shake ? "animate-pin-shake" : ""}`}>
      <p className="mb-3 text-center text-xs text-zinc-400">
        {roleBadge(member)}
      </p>
      <p className="mb-3 text-center text-xs text-zinc-500">
        Enter your PIN to unlock Store Ops.
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
                    : "border-zinc-600 bg-transparent"
                }`}
              />
            ))}
          </div>
          {error ? (
            <p
              className="mt-3 text-center text-sm font-semibold text-rose-400"
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
                    disabled={busy}
                    onClick={() => {
                      setError(null);
                      setSecret((prev) => prev.slice(0, -1));
                    }}
                    className="flex min-h-[44px] h-14 items-center justify-center rounded-xl border border-zinc-700/80 bg-zinc-950/80 text-lg font-semibold text-zinc-200 transition focus:outline-none focus:ring-2 focus:ring-emerald-500/50 active:scale-95 disabled:opacity-40"
                  >
                    ⌫
                  </button>
                );
              }
              return (
                <button
                  key={key}
                  type="button"
                  disabled={busy}
                  onClick={() => handleDigit(key)}
                  className="flex min-h-[44px] h-14 items-center justify-center rounded-xl border border-zinc-700/80 bg-zinc-950/80 font-mono text-xl font-bold text-white transition focus:outline-none focus:ring-2 focus:ring-emerald-500/50 active:scale-95 disabled:opacity-40"
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
          method="post"
          action="#"
          autoComplete="on"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <TextField
            id="deptsync-unlock-password"
            name="password"
            label="Password"
            type="password"
            autoComplete="current-password"
            value={secret}
            onChange={(v) => {
              setError(null);
              setSecret(v);
            }}
            passwordToggle
          />
          {error ? (
            <p
              className="text-center text-sm font-semibold text-rose-400"
              role="alert"
            >
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={busy}
            className="btn-primary-glow flex min-h-[44px] w-full items-center justify-center rounded-xl text-sm disabled:opacity-40"
          >
            {busy ? "Signing in…" : "Unlock"}
          </button>
        </form>
      )}

      {pinMode ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void submit()}
          className="mt-3 btn-primary-glow flex min-h-[44px] w-full items-center justify-center rounded-xl text-sm disabled:opacity-40"
        >
          {busy ? "Signing in…" : "Unlock"}
        </button>
      ) : null}

      {onRequestFullLogin ? (
        <button
          type="button"
          onClick={onRequestFullLogin}
          className="mt-2 flex min-h-[44px] w-full items-center justify-center rounded-xl border border-zinc-700/80 text-sm font-semibold text-zinc-300"
        >
          Sign in as a different user
        </button>
      ) : null}
    </div>
  );
}
