"use client";

/**
 * QR pairing redemption — /pair?t=
 * Validates the signed token, collects PIN, burns the invite hash, signs into Floor.
 */

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Clock, ShieldCheck } from "lucide-react";
import { DeptSyncBadge } from "@/components/hub/DeptSyncBadge";
import { NumberField } from "@/components/ui/NumberField";
import { startAuthSession } from "@/lib/auth-session";
import { setActiveSpecialist } from "@/lib/specialists";
import { setStoreNumber } from "@/lib/store";
import { getSupabase } from "@/lib/supabase";
import type { StoreSpecialist } from "@/lib/types";

const ICON_STROKE = 1.75;

type Preview = {
  specialist_id: string;
  name: string;
  username: string | null;
  store_number: string;
  department_label: string;
};

export default function PairPage() {
  return (
    <Suspense
      fallback={
        <PairShell>
          <p className="text-sm text-slate-400">Opening pairing…</p>
        </PairShell>
      }
    >
      <PairBody />
    </Suspense>
  );
}

function PairBody() {
  const router = useRouter();
  const search = useSearchParams();
  const token = String(search.get("t") ?? "").trim();

  const [step, setStep] = useState<"load" | "pin" | "error">("load");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) {
      setError("Missing pairing code. Scan a live QR from Roster.");
      setStep("error");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/redeem-invite", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const json = (await res.json()) as {
          invite?: Preview;
          error?: string;
        };
        if (!res.ok || !json.invite) {
          throw new Error(json.error || "This pairing code is invalid or expired");
        }
        if (cancelled) return;
        setPreview(json.invite);
        if (json.invite.store_number) setStoreNumber(json.invite.store_number);
        setStep("pin");
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof Error ? err.message : "Could not validate pairing code"
        );
        setStep("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function handleSavePin() {
    if (pin !== confirmPin) {
      setError("PINs do not match");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/redeem-invite", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, pin, confirm_pin: confirmPin }),
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
    <PairShell>
      {step === "load" ? (
        <p className="text-sm text-slate-400">Validating pairing code…</p>
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
          <h2 className="flex items-center gap-2 text-base font-bold text-slate-50">
            <Clock className="h-4 w-4 text-accent" strokeWidth={ICON_STROKE} aria-hidden />
            Create your PIN
          </h2>
          <p className="text-sm text-slate-400">
            Choose a 4–6 digit PIN. This QR cannot be reused after you save.
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
            onChange={(v) => setPin(v.slice(0, 6))}
            placeholder="####"
          />
          <NumberField
            label="Confirm PIN"
            mode="digits"
            value={confirmPin}
            onChange={(v) => setConfirmPin(v.slice(0, 6))}
            placeholder="####"
          />
          <button
            type="submit"
            disabled={busy || pin.length < 4}
            className="btn-primary-glow flex min-h-12 w-full items-center justify-center rounded-xl text-sm font-bold disabled:opacity-40"
          >
            {busy ? "Saving…" : "Save PIN & open Floor"}
          </button>
        </form>
      ) : null}
    </PairShell>
  );
}

function PairShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-[#090d16] px-4 py-8">
      <div className="w-full max-w-md space-y-4">
        <div className="flex items-center gap-3">
          <DeptSyncBadge />
          <div>
            <p className="flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-accent">
              <ShieldCheck className="h-3.5 w-3.5" strokeWidth={ICON_STROKE} aria-hidden />
              Device pairing
            </p>
            <h1 className="text-lg font-bold text-white">DeptSync Hub</h1>
          </div>
        </div>
        <section className="glass-card space-y-3 p-4">{children}</section>
      </div>
    </main>
  );
}
