"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { AdminRosterManager } from "@/components/hub/AdminRosterManager";
import { PushNotificationsCard } from "@/components/hub/PushNotificationsCard";
import { WeeklyBayTargetCard } from "@/components/hub/WeeklyBayTargetCard";
import { countLocalCatalog } from "@/lib/catalog";
import { countLocalRemnants } from "@/lib/remnants";
import { selectOnFocus } from "@/lib/number-input";
import { isSupervisor } from "@/lib/specialists";
import { canManageStoreNumber, isMasterAdmin } from "@/lib/rbac";
import { countLocalAudits } from "@/lib/storage";
import {
  formatStoreLabel,
  normalizeStoreNumber,
  setStoreNumber,
} from "@/lib/store";
import { countPendingSync, flushSyncQueue } from "@/lib/sync-queue";
import { isSupabaseConfigured, getSupabase } from "@/lib/supabase";
import type { StoreSpecialist } from "@/lib/types";

type Props = {
  catalogCount: number;
  remnantCount: number;
  activeSpecialist: StoreSpecialist | null;
  specialists: StoreSpecialist[];
  onSpecialistUpdated: (member: StoreSpecialist) => void;
  onRosterChange: (roster: StoreSpecialist[]) => void;
  onOpenChangePin: () => void;
  storeNumber: string;
  onStoreNumberChange: (storeNumber: string) => void;
};

export function SettingsSection({
  catalogCount,
  remnantCount,
  activeSpecialist,
  specialists,
  onRosterChange,
  onOpenChangePin,
  storeNumber,
  onStoreNumberChange,
}: Props) {
  const [ping, setPing] = useState<"idle" | "ok" | "fail" | "checking">("idle");
  const [storeDraftOverride, setStoreDraftOverride] = useState<string | null>(
    null
  );
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const storeSaveTimer = useRef<number | null>(null);

  const configured = isSupabaseConfigured();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const supervisorSession = isSupervisor(activeSpecialist);
  const masterSession = isMasterAdmin(activeSpecialist);
  const canEditStore = canManageStoreNumber(activeSpecialist);
  const canChangePin = Boolean(activeSpecialist);
  const pending = countPendingSync(storeNumber);
  const storeDraft = storeDraftOverride ?? storeNumber;

  const localAudits = countLocalAudits();
  const localCatalog = countLocalCatalog();
  const localRemnants = countLocalRemnants();

  function commitStore(raw: string) {
    if (storeSaveTimer.current != null) {
      window.clearTimeout(storeSaveTimer.current);
      storeSaveTimer.current = null;
    }
    const next = setStoreNumber(raw);
    onStoreNumberChange(next);
    setStoreDraftOverride(null);
  }

  function handleStoreDraftChange(raw: string) {
    setStoreDraftOverride(raw);
    if (storeSaveTimer.current != null) {
      window.clearTimeout(storeSaveTimer.current);
    }
    storeSaveTimer.current = window.setTimeout(() => {
      const normalized = normalizeStoreNumber(raw);
      if (normalized !== storeNumber) {
        commitStore(raw);
      } else {
        setStoreDraftOverride(null);
      }
    }, 500);
  }

  async function testConnection() {
    setPing("checking");
    const client = getSupabase();
    if (!client) {
      setPing("fail");
      return;
    }
    try {
      const { error } = await client
        .from("carpet_audits")
        .select("id")
        .eq("store_number", storeNumber)
        .limit(1);
      setPing(error ? "fail" : "ok");
    } catch {
      setPing("fail");
    }
  }

  async function syncNow() {
    setSyncing(true);
    try {
      const synced = await flushSyncQueue(storeNumber);
      setSyncMsg(
        synced > 0
          ? `🟢 Connected! Synced ${synced} offline action${synced === 1 ? "" : "s"} to store database.`
          : "No pending offline actions"
      );
      window.setTimeout(() => setSyncMsg(null), 3500);
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="space-y-4">
      <AdminRosterManager
        activeSpecialist={activeSpecialist}
        storeNumber={storeNumber}
        roster={specialists}
        onRosterChange={onRosterChange}
      />

      <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/90 p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          Store number / location
        </h2>
        <p className="text-sm text-slate-300">
          Active:{" "}
          <span className="font-semibold text-emerald-400">
            {formatStoreLabel(storeNumber)}
          </span>
        </p>
        {canEditStore ? (
          <>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-slate-200">
                Store Number / Location
              </span>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="off"
                placeholder="e.g. Store #1234"
                aria-label="Store Number / Location"
                value={storeDraft}
                onFocus={selectOnFocus}
                onChange={(e) =>
                  handleStoreDraftChange(e.target.value.replace(/\D/g, ""))
                }
                onBlur={() => commitStore(storeDraft)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitStore(storeDraft);
                    e.currentTarget.blur();
                  }
                }}
                className="min-h-12 h-12 w-full rounded-xl border border-slate-800 bg-slate-950 px-4 font-mono text-base font-semibold tabular-nums text-slate-100 outline-none transition focus:border-emerald-500"
              />
            </label>
            <p className="text-xs leading-relaxed text-slate-500">
              Master Admin only. Audits, catalog, remnants, and specialists are
              scoped by this store number for district isolation.
            </p>
          </>
        ) : (
          <p className="text-xs leading-relaxed text-slate-500">
            Store switching is restricted to Master Admin. Contact your admin to
            change location.
          </p>
        )}
      </section>

      {(masterSession || supervisorSession) && (
        <section className="space-y-3 rounded-2xl border border-emerald-500/25 bg-slate-900/90 p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            Navigation Hub
          </h2>
          <p className="text-sm text-slate-300">
            Use the header hamburger (☰) for role-aware Store Operations links —
            Store Map, Zebra checklist, supervisors, and settings.
          </p>
          <div className="grid gap-2">
            {masterSession ? (
              <>
                <Link
                  href="/admin/store-map"
                  className="flex min-h-12 items-center justify-center rounded-xl border border-emerald-500/40 text-sm font-semibold text-emerald-300"
                >
                  Store Map & Bulk Generator
                </Link>
                <Link
                  href="/admin/supervisors"
                  className="flex min-h-12 items-center justify-center rounded-xl border border-slate-700 bg-slate-950 text-sm font-semibold text-slate-100"
                >
                  Supervisor & Role Management
                </Link>
              </>
            ) : null}
            <Link
              href="/dashboard"
              className="flex min-h-12 items-center justify-center rounded-xl border border-slate-700 bg-slate-950 text-sm font-semibold text-slate-100"
            >
              Zebra Floor Checklist
            </Link>
            {supervisorSession && !masterSession ? (
              <Link
                href="/department"
                className="flex min-h-12 items-center justify-center rounded-xl border border-slate-700 bg-slate-950 text-sm font-semibold text-slate-100"
              >
                Department Overview
              </Link>
            ) : null}
          </div>
        </section>
      )}

      <PushNotificationsCard specialist={activeSpecialist} />

      <WeeklyBayTargetCard specialist={activeSpecialist} />

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
              {masterSession
                ? " (Master Admin)"
                : supervisorSession
                  ? " (Department Supervisor)"
                  : " (Floor Associate)"}
              .
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
          Offline sync queue
        </h2>
        <p className="text-sm text-slate-300">
          Pending actions:{" "}
          <span className="font-mono font-semibold text-amber-300">{pending}</span>
        </p>
        <button
          type="button"
          disabled={syncing || pending === 0}
          onClick={() => void syncNow()}
          className="flex min-h-12 w-full items-center justify-center rounded-xl border border-emerald-500/40 text-sm font-semibold text-emerald-300 disabled:opacity-40"
        >
          {syncing ? "Syncing…" : "Replay queue now"}
        </button>
        {syncMsg ? (
          <p className="text-center text-sm font-semibold text-emerald-300">{syncMsg}</p>
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
          Writes fall back to localStorage + the sync queue when Supabase is
          offline. Reconnect auto-replays pending actions.
        </p>
      </section>
    </div>
  );
}
