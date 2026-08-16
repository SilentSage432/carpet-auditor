"use client";

/**
 * Unified invite / PIN-reset redemption — /auth/verify/[token]
 * Token is consumed on first load; PIN is saved via the HttpOnly setup cookie.
 */

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { DeptSyncBadge } from "@/components/hub/DeptSyncBadge";
import { NumberField } from "@/components/ui/NumberField";
import { startAuthSession } from "@/lib/auth-session";
import { getSupabase } from "@/lib/supabase";
import { setActiveSpecialist } from "@/lib/specialists";
import { setStoreNumber } from "@/lib/store";
import type { StoreSpecialist } from "@/lib/types";

type Preview = {
  specialist_id: string;
  name: string;
  username: string | null;
  store_number: string;
  department_label: string;
  purpose: "invite" | "reset";
};

export default function AuthVerifyPage() {
  return (
    <Suspense
      fallback={
        <VerifyShell>
          <p className="text-sm text-slate-400">Validating link…</p>
        </VerifyShell>
      }
    >
      <AuthVerifyBody />
    </Suspense>
  );
}

function AuthVerifyBody() {
  const params = useParams<{ token: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const token = decodeURIComponent(String(params.token ?? "")).trim();
  const testQuery = search.get("test");
  const dryRun = testQuery === "1" || testQuery === "true";

  const [step, setStep] = useState<"load" | "pin" | "error">("load");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const qs = dryRun ? "?test=1" : "";
        let res = await fetch(
          `/api/auth/verify/${encodeURIComponent(token)}${qs}`,
          { credentials: "include" }
        );
        if (res.status === 410 || res.status === 404) {
          const fallback = await fetch("/api/auth/verify", {
            credentials: "include",
          });
          if (fallback.ok) res = fallback;
        }
        const json = (await res.json()) as {
          invite?: Preview;
          error?: string;
        };
        if (!res.ok || !json.invite) {
          throw new Error(json.error || "This link is invalid or expired");
        }
        if (cancelled) return;
        setPreview(json.invite);
        if (json.invite.store_number) {
          setStoreNumber(json.invite.store_number);
        }
        setStep("pin");
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Could not open link");
        setStep("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, dryRun]);

  async function handleSavePin() {
    if (pin !== confirmPin) {
      setError("PINs do not match");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/verify", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin, confirm_pin: confirmPin }),
      });
      const json = (await res.json()) as {
        specialist?: StoreSpecialist;
        session?: { access_token: string; refresh_token: string };
        error?: string;
      };
      if (!res.ok || !json.specialist) {
        throw new Error(json.error || "Could not save PIN");
      }
      const next = {
        ...json.specialist,
        must_change_credentials: false,
        is_active: true,
        status: "active",
      } as StoreSpecialist;
      setActiveSpecialist(next);
      startAuthSession(next);
      if (next.store_number) setStoreNumber(next.store_number);
      if (json.session?.access_token && json.session.refresh_token) {
        const supabase = getSupabase();
        await supabase?.auth.setSession({
          access_token: json.session.access_token,
          refresh_token: json.session.refresh_token,
        });
      }
      router.replace("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save PIN");
    } finally {
      setBusy(false);
    }
  }

  return (
    <VerifyShell>
      {dryRun ? (
        <p className="mb-3 rounded-xl border border-amber-500/40 bg-amber-950/40 px-3 py-2 text-xs font-semibold text-amber-100">
          Admin test mode — token will not be consumed.
        </p>
      ) : null}

      {step === "load" ? (
        <p className="text-sm text-slate-400">Validating one-time link…</p>
      ) : null}

      {step === "error" ? (
        <p className="rounded-xl border border-red-500/40 bg-red-950/40 px-3 py-3 text-sm text-red-200">
          {error}
        </p>
      ) : null}

      {preview && step === "pin" ? (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void handleSavePin();
          }}
        >
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2">
            <p className="text-sm font-semibold text-slate-50">{preview.name}</p>
            <p className="font-mono text-xs text-slate-400">
              {preview.username ? `@${preview.username}` : "No username"} ·{" "}
              {preview.department_label} · Store {preview.store_number || "—"}
            </p>
          </div>
          <h2 className="text-base font-bold text-slate-50">
            {preview.purpose === "reset" ? "Set a new PIN" : "Create your PIN"}
          </h2>
          <p className="text-sm text-slate-400">
            Choose a permanent 4–6 digit PIN. This one-time link cannot be reused.
          </p>
          {error ? (
            <p className="rounded-xl border border-red-500/40 bg-red-950/40 px-3 py-2 text-sm text-red-200">
              {error}
            </p>
          ) : null}
          <NumberField
            label="PIN"
            mode="digits"
            value={pin}
            onChange={(v) => setPin(v.replace(/\D/g, "").slice(0, 6))}
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
              busy || pin.length < 4 || pin.length > 6 || pin !== confirmPin
            }
            className="flex min-h-14 w-full items-center justify-center rounded-xl bg-emerald-500 text-base font-bold text-slate-950 disabled:opacity-40"
          >
            {busy ? "Saving…" : "Save PIN & continue"}
          </button>
        </form>
      ) : null}
    </VerifyShell>
  );
}

function VerifyShell({ children }: { children: ReactNode }) {
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
              DeptSync PIN
            </h1>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
