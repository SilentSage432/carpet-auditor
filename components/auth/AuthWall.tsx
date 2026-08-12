"use client";

import { useEffect, useState } from "react";
import { DeptSyncBadge } from "@/components/hub/DeptSyncBadge";
import { TextField } from "@/components/ui/NumberField";
import {
  authenticateWithBiometric,
  clearStoredBiometricCredential,
  getStoredBiometricCredential,
  hasBiometricForSpecialist,
  isPlatformAuthenticatorAvailable,
  registerBiometricCredential,
} from "@/lib/biometric-auth";
import {
  isEmergencyMasterCode,
  requestEmergencyAdminUnlock,
} from "@/lib/emergency-access";
import {
  resetAccessViaVerifiedPhone,
  sendPhoneAccessOtp,
  verifyPhoneAccessOtp,
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
    <div className="glass-void fixed inset-0 z-[90] flex items-end justify-center sm:items-center">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-black/40 backdrop-blur-md"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-wall-title"
        className="glass-card relative z-[91] w-full max-w-md rounded-t-2xl !rounded-b-none border-emerald-500/35 p-5 shadow-[0_0_60px_-12px_rgba(16,185,129,0.45)] sm:!rounded-2xl"
      >
        <div className="flex items-start gap-3">
          <DeptSyncBadge size="md" />
          <div className="min-w-0">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-400">
              DeptSync · {storeLabel}
            </p>
            <h1
              id="auth-wall-title"
              className="glass-title mt-1 text-lg"
            >
              {mode === "setup"
                ? "Set Your Permanent Credentials"
                : mode === "unlock"
                  ? "Unlock DeptSync"
                  : "DeptSync — Login to Your Department"}
            </h1>
            <p className="mt-1 text-sm leading-relaxed text-zinc-400">
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
  const [biometricReady, setBiometricReady] = useState(false);
  const [hasPasskey, setHasPasskey] = useState(false);
  const [enrollMember, setEnrollMember] = useState<StoreSpecialist | null>(null);
  const [enrollBusy, setEnrollBusy] = useState(false);
  const [phoneResetOpen, setPhoneResetOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const available = await isPlatformAuthenticatorAvailable();
      const stored = getStoredBiometricCredential();
      if (cancelled) return;
      setBiometricReady(available);
      setHasPasskey(Boolean(stored));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function finishLogin(member: StoreSpecialist) {
    const available = biometricReady || (await isPlatformAuthenticatorAvailable());
    if (available && !hasBiometricForSpecialist(member.id)) {
      setEnrollMember(member);
      return;
    }
    onAuthenticated(member);
  }

  async function tryEmergencyUnlock(code: string): Promise<boolean> {
    if (!isEmergencyMasterCode(code)) return false;
    // Immediate local Master Admin session — no secondary PIN / insert gate.
    const result = await requestEmergencyAdminUnlock({
      code,
      storeNumber: getStoreNumber(),
    });
    if (!result.ok) {
      setError(result.error);
      return true;
    }
    await finishLogin(result.specialist);
    return true;
  }

  async function handleLogin() {
    setBusy(true);
    setError(null);
    try {
      const emergencyCandidate = password.trim() || username.trim();
      if (await tryEmergencyUnlock(emergencyCandidate)) return;

      const match = findSpecialistByLogin(roster, username, password);
      if (!match) {
        setError("Invalid username or password");
        return;
      }
      await finishLogin(match);
    } finally {
      setBusy(false);
    }
  }

  async function handleBiometricLogin() {
    setBusy(true);
    setError(null);
    try {
      const specialistId = await authenticateWithBiometric();
      const match =
        roster.find((m) => String(m.id) === String(specialistId)) ?? null;
      if (!match || match.is_active === false) {
        clearStoredBiometricCredential();
        setHasPasskey(false);
        setError("Saved fingerprint login is no longer valid. Sign in with password.");
        return;
      }
      onAuthenticated(match);
    } catch (err) {
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        setError("Fingerprint login cancelled");
      } else {
        setError(
          err instanceof Error ? err.message : "Fingerprint login failed"
        );
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleEnableBiometric() {
    if (!enrollMember) return;
    setEnrollBusy(true);
    setError(null);
    try {
      await registerBiometricCredential(enrollMember);
      setHasPasskey(true);
      const member = enrollMember;
      setEnrollMember(null);
      onAuthenticated(member);
    } catch (err) {
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        setError("Fingerprint registration cancelled");
      } else {
        setError(
          err instanceof Error
            ? err.message
            : "Could not enable fingerprint login"
        );
      }
    } finally {
      setEnrollBusy(false);
    }
  }

  function handleSkipBiometric() {
    if (!enrollMember) return;
    const member = enrollMember;
    setEnrollMember(null);
    onAuthenticated(member);
  }

  if (enrollMember) {
    return (
      <BiometricEnrollBanner
        memberName={enrollMember.name}
        busy={enrollBusy}
        error={error}
        onEnable={() => void handleEnableBiometric()}
        onSkip={handleSkipBiometric}
      />
    );
  }

  if (phoneResetOpen) {
    return (
      <PhoneResetPanel
        onCancel={() => setPhoneResetOpen(false)}
        onResetComplete={(member) => {
          setPhoneResetOpen(false);
          void finishLogin(member);
        }}
      />
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
      {hasPasskey && biometricReady ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void handleBiometricLogin()}
          className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-950/50 text-sm font-bold text-emerald-200 shadow-[0_0_20px_-8px_rgba(16,185,129,0.55)] active:scale-[0.98] disabled:opacity-40"
        >
          👆 Login with Fingerprint / Touch ID
        </button>
      ) : null}

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
        disabled={
          busy ||
          (!password.trim() && !username.trim()) ||
          (!isEmergencyMasterCode(password.trim() || username.trim()) &&
            (!username.trim() || !password.trim()))
        }
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
      <p className="text-center text-[11px] text-zinc-400">
        Access is locked until you authenticate. Session stays signed in on this
        browser until logout or 8h idle.
      </p>
    </form>
  );
}

function PhoneResetPanel({
  onCancel,
  onResetComplete,
}: {
  onCancel: () => void;
  onResetComplete: (member: StoreSpecialist) => void;
}) {
  const [step, setStep] = useState<"phone" | "otp" | "password">("phone");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [verifiedPhone, setVerifiedPhone] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [username, setUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSendOtp() {
    setBusy(true);
    setError(null);
    try {
      const result = await sendPhoneAccessOtp(phone);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setVerifiedPhone(result.phone);
      setStep("otp");
    } finally {
      setBusy(false);
    }
  }

  async function handleVerifyOtp() {
    setBusy(true);
    setError(null);
    try {
      const result = await verifyPhoneAccessOtp({
        phone: verifiedPhone || phone,
        token: otp,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setVerifiedPhone(result.phone);
      setStep("password");
    } finally {
      setBusy(false);
    }
  }

  async function handleResetPassword() {
    if (newPassword !== confirmPassword) {
      setError("Password and confirmation do not match");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await resetAccessViaVerifiedPhone({
        phone: verifiedPhone,
        newPassword,
        username: username.trim() || undefined,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onResetComplete(result.specialist);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-5 space-y-3">
      <p className="rounded-xl border border-emerald-500/30 bg-emerald-950/40 px-3 py-2 text-xs leading-relaxed text-emerald-100">
        Reset via encrypted SMS OTP. A 6-digit code is sent to the mobile number
        on your DeptSync profile.
      </p>

      {step === "phone" ? (
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
            onClick={() => void handleSendOtp()}
            className="btn-primary-glow flex min-h-[44px] w-full items-center justify-center rounded-xl text-sm disabled:opacity-40"
          >
            {busy ? "Sending code…" : "Send 6-Digit SMS Code"}
          </button>
        </>
      ) : null}

      {step === "otp" ? (
        <>
          <TextField
            id="deptsync-reset-otp"
            name="one-time-code"
            label="6-Digit SMS Code"
            value={otp}
            onChange={setOtp}
            autoComplete="one-time-code"
          />
          <button
            type="button"
            disabled={busy || otp.replace(/\D/g, "").length !== 6}
            onClick={() => void handleVerifyOtp()}
            className="btn-primary-glow flex min-h-[44px] w-full items-center justify-center rounded-xl text-sm disabled:opacity-40"
          >
            {busy ? "Verifying…" : "Verify Code"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleSendOtp()}
            className="text-center text-xs font-semibold text-emerald-400"
          >
            Resend code
          </button>
        </>
      ) : null}

      {step === "password" ? (
        <>
          <TextField
            id="deptsync-reset-username"
            name="username"
            label="Username (optional)"
            value={username}
            onChange={setUsername}
            autoComplete="username"
          />
          <TextField
            id="deptsync-reset-password"
            name="new-password"
            label="New Password / Access Code"
            value={newPassword}
            onChange={setNewPassword}
            type="password"
            autoComplete="new-password"
            passwordToggle
          />
          <TextField
            id="deptsync-reset-password-confirm"
            name="new-password-confirm"
            label="Confirm New Password"
            value={confirmPassword}
            onChange={setConfirmPassword}
            type="password"
            autoComplete="new-password"
            passwordToggle
          />
          <button
            type="button"
            disabled={busy || newPassword.trim().length < 6}
            onClick={() => void handleResetPassword()}
            className="btn-primary-glow flex min-h-[44px] w-full items-center justify-center rounded-xl text-sm disabled:opacity-40"
          >
            {busy ? "Saving…" : "Save New Access Code & Sign In"}
          </button>
        </>
      ) : null}

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

function BiometricEnrollBanner({
  memberName,
  busy,
  error,
  onEnable,
  onSkip,
}: {
  memberName: string;
  busy: boolean;
  error: string | null;
  onEnable: () => void;
  onSkip: () => void;
}) {
  return (
    <div className="mt-5 space-y-3 rounded-2xl border border-emerald-500/30 bg-emerald-950/30 p-4">
      <p className="text-sm font-semibold leading-relaxed text-emerald-100">
        ⚡ Enable Fingerprint / Touch ID Login for faster access on this phone?
      </p>
      <p className="text-xs text-zinc-400">
        Signed in as {memberName}. Your device will prompt for Face ID,
        Touch ID, or fingerprint to register.
      </p>
      {error ? (
        <p className="text-center text-sm font-semibold text-rose-400" role="alert">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        disabled={busy}
        onClick={onEnable}
        className="btn-primary-glow flex min-h-[44px] w-full items-center justify-center rounded-xl text-sm disabled:opacity-40"
      >
        {busy ? "Waiting for sensor…" : "Enable Fingerprint Access"}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={onSkip}
        className="flex min-h-[44px] w-full items-center justify-center rounded-xl border border-zinc-700/80 text-sm font-semibold text-zinc-300 disabled:opacity-40"
      >
        Skip for Now
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
  const [enrollMember, setEnrollMember] = useState<StoreSpecialist | null>(null);
  const [enrollBusy, setEnrollBusy] = useState(false);
  const [biometricReady, setBiometricReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void isPlatformAuthenticatorAvailable().then((ok) => {
      if (!cancelled) setBiometricReady(ok);
    });
    return () => {
      cancelled = true;
    };
  }, []);

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
      if (biometricReady && !hasBiometricForSpecialist(record.id)) {
        setEnrollMember(record);
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

  async function handleEnableBiometric() {
    if (!enrollMember) return;
    setEnrollBusy(true);
    setError(null);
    try {
      await registerBiometricCredential(enrollMember);
      const next = enrollMember;
      setEnrollMember(null);
      onAuthenticated(next);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not enable fingerprint login"
      );
    } finally {
      setEnrollBusy(false);
    }
  }

  if (enrollMember) {
    return (
      <BiometricEnrollBanner
        memberName={enrollMember.name}
        busy={enrollBusy}
        error={error}
        onEnable={() => void handleEnableBiometric()}
        onSkip={() => {
          const next = enrollMember;
          setEnrollMember(null);
          onAuthenticated(next);
        }}
      />
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
  const [showBiometric, setShowBiometric] = useState(false);

  useEffect(() => {
    setSecret("");
    setError(null);
    let cancelled = false;
    void (async () => {
      const available = await isPlatformAuthenticatorAvailable();
      const stored = getStoredBiometricCredential();
      if (cancelled) return;
      setShowBiometric(
        available &&
          Boolean(stored) &&
          String(stored?.specialistId) === String(member.id)
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [member.id]);

  function fail(message: string) {
    setShake(true);
    setError(message);
    setSecret("");
    window.setTimeout(() => setShake(false), 450);
  }

  async function tryEmergencyUnlock(code: string): Promise<boolean> {
    if (!isEmergencyMasterCode(code)) return false;
    setBusy(true);
    setError(null);
    try {
      // Immediate local Master Admin session — bypass PIN + never require insert.
      const result = await requestEmergencyAdminUnlock({
        code,
        storeNumber: getStoreNumber() || member.store_number,
      });
      if (!result.ok) {
        fail(result.error);
        return true;
      }
      setSecret("");
      onAuthenticated(result.specialist);
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function submit(attempt?: string) {
    const value = (attempt ?? secret).trim();
    if (!value) {
      setError(pinMode ? "Enter PIN" : "Enter password");
      return;
    }
    if (await tryEmergencyUnlock(value)) return;
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
      window.setTimeout(() => {
        void submit(next);
      }, 80);
    }
  }

  async function handleBiometricUnlock() {
    setBusy(true);
    setError(null);
    try {
      const specialistId = await authenticateWithBiometric();
      const match =
        roster.find((m) => String(m.id) === String(specialistId)) ?? member;
      if (String(match.id) !== String(member.id)) {
        setError("Fingerprint login belongs to a different user");
        return;
      }
      onAuthenticated(match);
    } catch (err) {
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        setError("Fingerprint unlock cancelled");
      } else {
        setError(
          err instanceof Error ? err.message : "Fingerprint unlock failed"
        );
      }
    } finally {
      setBusy(false);
    }
  }

  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"];

  return (
    <div className={`mt-5 ${shake ? "animate-pin-shake" : ""}`}>
      <p className="mb-3 text-center text-xs text-zinc-400">
        {roleBadge(member)}
      </p>

      {showBiometric ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void handleBiometricUnlock()}
          className="mb-3 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-950/50 text-sm font-bold text-emerald-200 shadow-[0_0_20px_-8px_rgba(16,185,129,0.55)] active:scale-[0.98] disabled:opacity-40"
        >
          👆 Unlock with Fingerprint / Touch ID
        </button>
      ) : null}

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
                    onClick={() => {
                      setError(null);
                      setSecret((prev) => prev.slice(0, -1));
                    }}
                    className="flex min-h-[44px] h-14 items-center justify-center rounded-xl border border-zinc-700/80 bg-zinc-950/80 text-lg font-semibold text-zinc-200 transition focus:outline-none focus:ring-2 focus:ring-emerald-500/50 active:scale-95"
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
                  className="flex min-h-[44px] h-14 items-center justify-center rounded-xl border border-zinc-700/80 bg-zinc-950/80 font-mono text-xl font-bold text-white transition focus:outline-none focus:ring-2 focus:ring-emerald-500/50 active:scale-95"
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
            className="btn-primary-glow flex min-h-[44px] w-full items-center justify-center rounded-xl text-sm"
          >
            Unlock
          </button>
        </form>
      )}

      {pinMode ? (
        <button
          type="button"
          onClick={() => void submit()}
          className="mt-3 btn-primary-glow flex min-h-[44px] w-full items-center justify-center rounded-xl text-sm"
        >
          Unlock
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
