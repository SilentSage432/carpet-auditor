"use client";

import { useEffect, useState } from "react";
import { PinKeypadModal } from "@/components/hub/PinKeypadModal";
import { NumberField } from "@/components/ui/NumberField";
import { countLocalCatalog } from "@/lib/catalog";
import { countLocalRemnants } from "@/lib/remnants";
import {
  isSupervisor,
  updateSpecialistPin,
  verifyPin,
} from "@/lib/specialists";
import { countLocalAudits } from "@/lib/storage";
import { isSupabaseConfigured, getSupabase } from "@/lib/supabase";
import type { StoreSpecialist } from "@/lib/types";

type Props = {
  catalogCount: number;
  remnantCount: number;
  activeSpecialist: StoreSpecialist | null;
  onSpecialistUpdated: (member: StoreSpecialist) => void;
};

export function SettingsSection({
  catalogCount,
  remnantCount,
  activeSpecialist,
  onSpecialistUpdated,
}: Props) {
  const [localAudits, setLocalAudits] = useState(0);
  const [localCatalog, setLocalCatalog] = useState(0);
  const [localRemnants, setLocalRemnants] = useState(0);
  const [ping, setPing] = useState<"idle" | "ok" | "fail" | "checking">("idle");
  const [changingPin, setChangingPin] = useState(false);
  const [pinStep, setPinStep] = useState<"verify" | "new">("verify");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [pinMsg, setPinMsg] = useState<string | null>(null);
  const [savingPin, setSavingPin] = useState(false);

  const configured = isSupabaseConfigured();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const supervisorSession = isSupervisor(activeSpecialist);

  useEffect(() => {
    setLocalAudits(countLocalAudits());
    setLocalCatalog(countLocalCatalog());
    setLocalRemnants(countLocalRemnants());
  }, [catalogCount, remnantCount]);

  async function testConnection() {
    setPing("checking");
    const client = getSupabase();
    if (!client) {
      setPing("fail");
      return;
    }
    try {
      const { error } = await client.from("carpet_audits").select("id").limit(1);
      setPing(error ? "fail" : "ok");
    } catch {
      setPing("fail");
    }
  }

  async function saveNewPin() {
    if (!activeSpecialist) return;
    if (newPin.length < 4) {
      setPinMsg("PIN must be at least 4 digits");
      return;
    }
    if (newPin !== confirmPin) {
      setPinMsg("PINs do not match");
      return;
    }
    setSavingPin(true);
    setPinMsg(null);
    try {
      const { record, offline } = await updateSpecialistPin(activeSpecialist, newPin);
      onSpecialistUpdated(record);
      setChangingPin(false);
      setPinStep("verify");
      setNewPin("");
      setConfirmPin("");
      setPinMsg(offline ? "PIN updated offline" : "Supervisor PIN updated");
      window.setTimeout(() => setPinMsg(null), 2500);
    } catch {
      setPinMsg("Could not update PIN");
    } finally {
      setSavingPin(false);
    }
  }

  return (
    <div className="space-y-4">
      <PinKeypadModal
        open={changingPin && pinStep === "verify"}
        title="Verify current PIN"
        subtitle="Confirm supervisor access before changing PIN"
        verify={(pin) =>
          activeSpecialist ? verifyPin(activeSpecialist, pin) : false
        }
        onClose={() => {
          setChangingPin(false);
          setPinStep("verify");
        }}
        onSuccess={() => setPinStep("new")}
      />

      <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/90 p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          Supervisor access
        </h2>
        {supervisorSession ? (
          <>
            <p className="text-sm text-slate-300">
              Signed in as{" "}
              <span className="font-semibold text-emerald-400">
                {activeSpecialist?.name}
              </span>{" "}
              (Department Supervisor).
            </p>
            {pinStep === "new" && changingPin ? (
              <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-950/70 p-3">
                <NumberField
                  label="New PIN"
                  mode="digits"
                  value={newPin}
                  onChange={setNewPin}
                  placeholder="At least 4 digits"
                />
                <NumberField
                  label="Confirm new PIN"
                  mode="digits"
                  value={confirmPin}
                  onChange={setConfirmPin}
                  placeholder="Re-enter PIN"
                />
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setChangingPin(false);
                      setPinStep("verify");
                      setNewPin("");
                      setConfirmPin("");
                    }}
                    className="flex min-h-12 items-center justify-center rounded-xl border border-slate-700 text-sm font-semibold text-slate-300"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={savingPin}
                    onClick={() => void saveNewPin()}
                    className="flex min-h-12 items-center justify-center rounded-xl bg-emerald-500 text-sm font-bold text-slate-950 disabled:opacity-40"
                  >
                    {savingPin ? "Saving…" : "Save PIN"}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setChangingPin(true);
                  setPinStep("verify");
                }}
                className="flex min-h-12 w-full items-center justify-center rounded-xl border border-emerald-500/40 text-sm font-semibold text-emerald-300"
              >
                Change Supervisor PIN
              </button>
            )}
          </>
        ) : (
          <p className="text-sm text-amber-300/90">
            Switch to a 🛡️ Department Supervisor profile (PIN required) to change
            access codes or use restricted discrepancy tools.
          </p>
        )}
        {pinMsg && (
          <p className="text-center text-sm text-emerald-300">{pinMsg}</p>
        )}
      </section>

      <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/90 p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          Supabase
        </h2>
        <p className="text-sm text-slate-300">
          Status:{" "}
          <span
            className={
              configured ? "font-semibold text-emerald-400" : "font-semibold text-amber-300"
            }
          >
            {configured ? "Configured" : "Not configured (offline mode)"}
          </span>
        </p>
        {configured ? (
          <p className="break-all font-mono text-xs text-slate-500">{url}</p>
        ) : (
          <p className="text-sm text-slate-400">
            Set <code className="text-emerald-400">NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
            <code className="text-emerald-400">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> in{" "}
            <code className="text-slate-300">.env.local</code>, then apply{" "}
            <code className="text-slate-300">supabase/schema.sql</code>.
          </p>
        )}
        <button
          type="button"
          onClick={() => void testConnection()}
          disabled={!configured || ping === "checking"}
          className="flex min-h-12 w-full items-center justify-center rounded-xl border border-slate-700 bg-slate-950 text-sm font-semibold text-slate-100 disabled:opacity-40"
        >
          {ping === "checking"
            ? "Checking…"
            : ping === "ok"
              ? "Connection OK ✓"
              : ping === "fail"
                ? "Connection failed — retry"
                : "Test connection"}
        </button>
      </section>

      <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/90 p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          Local storage
        </h2>
        <ul className="space-y-2 text-sm text-slate-300">
          <li className="flex justify-between gap-3 rounded-xl bg-slate-950/70 px-3 py-3">
            <span>Audit cache</span>
            <span className="font-mono text-emerald-400">{localAudits}</span>
          </li>
          <li className="flex justify-between gap-3 rounded-xl bg-slate-950/70 px-3 py-3">
            <span>Catalog cache</span>
            <span className="font-mono text-emerald-400">{localCatalog}</span>
          </li>
          <li className="flex justify-between gap-3 rounded-xl bg-slate-950/70 px-3 py-3">
            <span>Remnant cache</span>
            <span className="font-mono text-emerald-400">{localRemnants}</span>
          </li>
          <li className="flex justify-between gap-3 rounded-xl bg-slate-950/70 px-3 py-3">
            <span>Loaded catalog</span>
            <span className="font-mono text-slate-200">{catalogCount}</span>
          </li>
          <li className="flex justify-between gap-3 rounded-xl bg-slate-950/70 px-3 py-3">
            <span>Loaded remnants</span>
            <span className="font-mono text-slate-200">{remnantCount}</span>
          </li>
        </ul>
        <p className="text-xs leading-relaxed text-slate-500">
          Writes fall back to browser localStorage when Supabase is offline or
          unconfigured. Offline rows are tagged in each section.
        </p>
      </section>
    </div>
  );
}
