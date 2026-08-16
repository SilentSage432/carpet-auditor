"use client";

/**
 * @deprecated Unused. Invite activation UI lives on `/auth/verify/[token]`.
 * Token verification lives on GET/POST /api/auth/verify/[token].
 */

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { DeptSyncBadge } from "@/components/hub/DeptSyncBadge";
import { NumberField } from "@/components/ui/NumberField";
import { startAuthSession } from "@/lib/auth-session";
import {
  isPlatformAuthenticatorAvailable,
  registerBiometricCredential,
} from "@/lib/biometric-auth";
import {
  canPromptPwaInstall,
  initPwaInstallCapture,
  isStandaloneDisplay,
  promptPwaInstall,
} from "@/lib/pwa-install";
import { setActiveSpecialist } from "@/lib/specialists";
import { setStoreNumber } from "@/lib/store";
import type { StoreSpecialist } from "@/lib/types";

type InvitePreview = {
  specialist_id: string;
  name: string;
  username: string | null;
  store_number: string;
  department: string;
  department_label: string;
  must_change_pin: boolean;
  invite_expires_at: string | null;
  expired: boolean;
};

type Step = "load" | "pin" | "new-pin" | "install" | "biometric" | "done" | "error";

export function InviteOnboardingView({
  token,
  testQuery,
}: {
  token: string;
  testQuery?: string | null;
}) {
  const router = useRouter();
  const dryRun =
    testQuery === "1" || testQuery === "true";
  const testMode = dryRun || process.env.NODE_ENV === "development";

  const [step, setStep] = useState<Step>("load");
  const [invite, setInvite] = useState<InvitePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tempPin, setTempPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [member, setMember] = useState<StoreSpecialist | null>(null);
  const [bioAvailable, setBioAvailable] = useState(false);
  const [installAvailable, setInstallAvailable] = useState(false);

  function harnessLog(message: string, extra?: Record<string, unknown>) {
    if (!testMode) return;
    console.info(`[invite harness] ${message}`, extra ?? "");
  }

  useEffect(() => {
    initPwaInstallCapture();
    const t = window.setInterval(() => {
      setInstallAvailable(canPromptPwaInstall() && !isStandaloneDisplay());
    }, 500);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    if (!token) {
      setError("Missing invite token. Open the link from your SMS.");
      setStep("error");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const qs = dryRun ? "?test=1" : "";
        const res = await fetch(
          `/api/invite/${encodeURIComponent(token)}${qs}`
        );
        const json = (await res.json()) as {
          invite?: InvitePreview;
          error?: string;
        };
        if (!res.ok || !json.invite) {
          throw new Error(json.error || "Invite not found");
        }
        if (cancelled) return;
        setInvite(json.invite);
        harnessLog("Token Validated", {
          specialist_id: json.invite.specialist_id,
          dry_run: dryRun,
        });
        if (json.invite.store_number) {
          setStoreNumber(json.invite.store_number);
        }
        if (json.invite.expired) {
          setError("This invite link has expired. Ask Master Admin to resend.");
          setStep("error");
          return;
        }
        setStep("pin");
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Could not load invite");
        setStep("error");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- harnessLog is stable enough for mount load
  }, [token, dryRun]);

  useEffect(() => {
    void isPlatformAuthenticatorAvailable().then(setBioAvailable);
  }, []);

  async function verifyTempPin() {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/invite/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "verify",
          temp_pin: tempPin.trim(),
          dry_run: dryRun,
          test: dryRun,
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        must_change_pin?: boolean;
        error?: string;
      };
      if (!res.ok) throw new Error(json.error || "PIN rejected");
      harnessLog("Token Validated", { action: "verify", dry_run: dryRun });
      setStep(json.must_change_pin === false ? "install" : "new-pin");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setBusy(false);
    }
  }

  async function completeNewPin() {
    if (!token) return;
    if (newPin !== confirmPin) {
      setError("PINs do not match");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/invite/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "complete",
          temp_pin: tempPin.trim(),
          new_pin: newPin.trim(),
          dry_run: dryRun,
          test: dryRun,
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        dry_run?: boolean;
        specialist?: StoreSpecialist;
        error?: string;
      };
      if (!res.ok || !json.specialist) {
        throw new Error(json.error || "Could not save PIN");
      }
      harnessLog("PIN Reset Success", {
        dry_run: Boolean(json.dry_run),
        specialist_id: json.specialist.id,
      });
      const next = {
        ...json.specialist,
        must_change_credentials: false,
        is_active: true,
        status: "active",
      } as StoreSpecialist;
      setMember(next);
      if (!dryRun) {
        setActiveSpecialist(next);
        startAuthSession(next);
        if (next.store_number) setStoreNumber(next.store_number);
      }
      setStep("install");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save PIN");
    } finally {
      setBusy(false);
    }
  }

  async function handleInstall() {
    setBusy(true);
    setError(null);
    try {
      const outcome = await promptPwaInstall();
      if (outcome === "unavailable") {
        setStep("biometric");
        return;
      }
      setStep("biometric");
    } finally {
      setBusy(false);
    }
  }

  async function handleBiometric() {
    harnessLog("Biometric Prompt Fired", {
      hasMember: Boolean(member),
      dry_run: dryRun,
    });
    if (!member) {
      setStep("done");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (dryRun) {
        try {
          await registerBiometricCredential(member);
        } catch (err) {
          harnessLog("Biometric Prompt Fired", {
            cancelled_or_failed: true,
            message: err instanceof Error ? err.message : String(err),
          });
        }
        setStep("done");
        return;
      }
      await registerBiometricCredential(member);
      setStep("done");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Biometric registration was cancelled"
      );
    } finally {
      setBusy(false);
    }
  }

  function finish() {
    if (dryRun) {
      harnessLog("Harness complete — returning without burning token");
      router.replace("/roster");
      return;
    }
    router.replace("/dashboard");
  }

  return (
    <InviteShell>
      {dryRun ? (
        <p className="mb-3 rounded-xl border border-amber-500/40 bg-amber-950/40 px-3 py-2 text-xs font-semibold text-amber-100">
          Admin test mode — invite token will not be invalidated on PIN reset.
        </p>
      ) : null}
      {step === "load" ? (
        <p className="text-sm text-slate-400">Validating invite…</p>
      ) : null}

      {step === "error" ? (
        <p className="rounded-xl border border-red-500/40 bg-red-950/40 px-3 py-3 text-sm text-red-200">
          {error}
        </p>
      ) : null}

      {invite && step !== "error" && step !== "load" ? (
        <div className="mb-4 rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2">
          <p className="text-sm font-semibold text-slate-50">{invite.name}</p>
          <p className="font-mono text-xs text-slate-400">
            {invite.username ? `@${invite.username}` : "No username"} ·{" "}
            {invite.department_label} · Store {invite.store_number || "—"}
          </p>
        </div>
      ) : null}

      {error && step !== "error" ? (
        <p className="mb-3 rounded-xl border border-red-500/40 bg-red-950/40 px-3 py-2 text-sm text-red-200">
          {error}
        </p>
      ) : null}

      {step === "pin" ? (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void verifyTempPin();
          }}
        >
          <h2 className="text-base font-bold text-slate-50">
            Enter temporary PIN
          </h2>
          <p className="text-sm text-slate-400">
            Use the 6-digit PIN from your invite SMS.
          </p>
          <NumberField
            label="Temporary PIN"
            mode="digits"
            value={tempPin}
            onChange={(v) => setTempPin(v.replace(/\D/g, "").slice(0, 6))}
            placeholder="••••••"
          />
          <button
            type="submit"
            disabled={busy || tempPin.length !== 6}
            className="flex min-h-14 w-full items-center justify-center rounded-xl bg-emerald-500 text-base font-bold text-slate-950 disabled:opacity-40"
          >
            {busy ? "Checking…" : "Continue"}
          </button>
        </form>
      ) : null}

      {step === "new-pin" ? (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void completeNewPin();
          }}
        >
          <h2 className="text-base font-bold text-slate-50">Create your PIN</h2>
          <p className="text-sm text-slate-400">
            Choose a permanent 4–6 digit PIN before opening your dashboard.
          </p>
          <NumberField
            label="New PIN"
            mode="digits"
            value={newPin}
            onChange={(v) => setNewPin(v.replace(/\D/g, "").slice(0, 6))}
            placeholder="4–6 digits"
          />
          <NumberField
            label="Confirm PIN"
            mode="digits"
            value={confirmPin}
            onChange={(v) => setConfirmPin(v.replace(/\D/g, "").slice(0, 6))}
            placeholder="Re-enter PIN"
          />
          <button
            type="submit"
            disabled={
              busy ||
              newPin.length < 4 ||
              newPin.length > 6 ||
              newPin !== confirmPin
            }
            className="flex min-h-14 w-full items-center justify-center rounded-xl bg-emerald-500 text-base font-bold text-slate-950 disabled:opacity-40"
          >
            {busy ? "Saving…" : "Save PIN & Continue"}
          </button>
        </form>
      ) : null}

      {step === "install" ? (
        <div className="space-y-3">
          <h2 className="text-base font-bold text-slate-50">
            Add DeptSync to Home Screen
          </h2>
          <p className="text-sm text-slate-400">
            Install the PWA so rotation alerts and offline audit work like a
            native app.
          </p>
          {isStandaloneDisplay() ? (
            <p className="rounded-xl border border-emerald-500/30 bg-emerald-950/30 px-3 py-2 text-sm text-emerald-200">
              Already installed on this device.
            </p>
          ) : installAvailable ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleInstall()}
              className="flex min-h-14 w-full items-center justify-center rounded-xl bg-emerald-500 text-base font-bold text-slate-950 disabled:opacity-40"
            >
              {busy ? "Prompting…" : "Add to Home Screen"}
            </button>
          ) : (
            <p className="rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-3 text-sm text-slate-300">
              On iPhone: Safari Share → <strong>Add to Home Screen</strong>. On
              Android Chrome: menu → <strong>Install app</strong>.
            </p>
          )}
          <button
            type="button"
            onClick={() => setStep("biometric")}
            className="flex min-h-12 w-full items-center justify-center rounded-xl border border-slate-600 text-sm font-semibold text-slate-200"
          >
            Continue
          </button>
        </div>
      ) : null}

      {step === "biometric" ? (
        <div className="space-y-3">
          <h2 className="text-base font-bold text-slate-50">
            Enable Face ID / Fingerprint
          </h2>
          <p className="text-sm text-slate-400">
            Register this device so you can unlock DeptSync without typing your
            PIN every time.
          </p>
          {bioAvailable && member ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleBiometric()}
              className="flex min-h-14 w-full items-center justify-center rounded-xl bg-emerald-500 text-base font-bold text-slate-950 disabled:opacity-40"
            >
              {busy ? "Waiting for biometric…" : "Register Face ID / Fingerprint"}
            </button>
          ) : (
            <p className="rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-3 text-sm text-slate-300">
              This browser does not expose a platform authenticator. You can
              still sign in with your PIN.
            </p>
          )}
          <button
            type="button"
            onClick={() => setStep("done")}
            className="flex min-h-12 w-full items-center justify-center rounded-xl border border-slate-600 text-sm font-semibold text-slate-200"
          >
            Skip for now
          </button>
        </div>
      ) : null}

      {step === "done" ? (
        <div className="space-y-3">
          <h2 className="text-base font-bold text-slate-50">You&apos;re set</h2>
          <p className="text-sm text-slate-400">
            Permanent PIN saved
            {member ? ` for ${member.name}` : ""}. Open your Floor checklist to
            start the week.
          </p>
          <button
            type="button"
            onClick={finish}
            className="flex min-h-14 w-full items-center justify-center rounded-xl bg-emerald-500 text-base font-bold text-slate-950"
          >
            Open Floor checklist
          </button>
        </div>
      ) : null}
    </InviteShell>
  );
}

export function InviteShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-slate-950 px-4 py-8">
      <div className="w-full max-w-md rounded-2xl border border-emerald-500/30 bg-slate-900 p-5">
        <div className="mb-4 flex items-start gap-3">
          <DeptSyncBadge size="md" branded />
          <div>
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-400">
              Account setup
            </p>
            <h1 className="mt-1 text-lg font-bold text-slate-50">
              DeptSync Invite
            </h1>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
