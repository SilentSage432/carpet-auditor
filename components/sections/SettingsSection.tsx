"use client";

import { useState } from "react";
import { countLocalCatalog } from "@/lib/catalog";
import { countLocalRemnants } from "@/lib/remnants";
import { isSupervisor } from "@/lib/specialists";
import { countLocalAudits } from "@/lib/storage";
import { isSupabaseConfigured, getSupabase } from "@/lib/supabase";
import type { StoreSpecialist } from "@/lib/types";

type Props = {
  catalogCount: number;
  remnantCount: number;
  activeSpecialist: StoreSpecialist | null;
  onSpecialistUpdated: (member: StoreSpecialist) => void;
  onOpenChangePin: () => void;
};

export function SettingsSection({
  catalogCount,
  remnantCount,
  activeSpecialist,
  onOpenChangePin,
}: Props) {
  const [ping, setPing] = useState<"idle" | "ok" | "fail" | "checking">("idle");

  const configured = isSupabaseConfigured();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const supervisorSession = isSupervisor(activeSpecialist);
  const canChangePin = Boolean(activeSpecialist);

  const localAudits = countLocalAudits();
  const localCatalog = countLocalCatalog();
  const localRemnants = countLocalRemnants();

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

  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/90 p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          Security & PIN
        </h2>
        {canChangePin ? (
          <>
            <p className="text-sm text-slate-300">
              Signed in as{" "}
              <span className="font-semibold text-emerald-400">
                {activeSpecialist?.name}
              </span>
              {supervisorSession ? " (Department Supervisor)" : ""}.
            </p>
            <button
              type="button"
              onClick={onOpenChangePin}
              className="flex min-h-12 w-full items-center justify-center rounded-xl border border-emerald-500/40 text-sm font-semibold text-emerald-300"
            >
              ⚙️ Change My PIN
            </button>
          </>
        ) : (
          <p className="text-sm text-amber-300/90">
            Select a profile first, then change your PIN from here or the header ⚙️
            button.
          </p>
        )}
        {!supervisorSession && canChangePin ? (
          <p className="text-xs text-slate-500">
            Discrepancy tools still require a Supervisor session or PIN unlock.
          </p>
        ) : null}
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
