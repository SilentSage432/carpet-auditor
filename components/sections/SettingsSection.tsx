"use client";

import { useCallback, useState } from "react";
import { openAdminTools } from "@/components/hub/admin-tools-events";
import { AssociateRosterPanel } from "@/components/admin/AssociateRosterPanel";
import { PushNotificationsCard } from "@/components/hub/PushNotificationsCard";
import { WeeklyBayTargetCard } from "@/components/hub/WeeklyBayTargetCard";
import { ThemeSelector } from "@/components/settings/ThemeSelector";
import {
  clearLocalApplianceScans,
  countLocalApplianceScans,
} from "@/lib/appliance-scans";
import { usePendingSyncCount } from "@/lib/network";
import { clearLocalRemnants, countLocalRemnants } from "@/lib/remnants";
import { isSupervisor } from "@/lib/specialists";
import { isMasterAdmin } from "@/lib/rbac";
import { formatStoreLabel } from "@/lib/store";
import {
  flushSyncQueue,
  isBrowserOnline,
  purgeSyncQueue,
} from "@/lib/sync-queue";
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

type ConnectionStatus = "idle" | "checking" | "ok" | "fail";

/**
 * Settings — floor-first. Supervisors: PIN, own bay target, push, sync.
 * Master Admin setup (roster, store #, all-dept targets, diagnostics) lives in
 * Admin Tools drawer — not permanent page chrome.
 */
export function SettingsSection({
  activeSpecialist,
  specialists,
  onRosterChange,
  onOpenChangePin,
  storeNumber,
}: Props) {
  const [ping, setPing] = useState<ConnectionStatus>("idle");
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [deviceOpen, setDeviceOpen] = useState(false);
  const [cacheTick, setCacheTick] = useState(0);
  const [cacheMsg, setCacheMsg] = useState<string | null>(null);

  const configured = isSupabaseConfigured();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const supervisorSession = isSupervisor(activeSpecialist);
  const masterSession = isMasterAdmin(activeSpecialist);
  const canChangePin = Boolean(activeSpecialist);
  const pending = usePendingSyncCount(storeNumber);

  // cacheTick forces a re-read after Clear Local Cache.
  void cacheTick;
  const applianceAuditCache = countLocalApplianceScans(storeNumber);
  const remnantInventoryCache = countLocalRemnants();

  const refreshCacheCounts = useCallback(() => {
    setCacheTick((n) => n + 1);
  }, []);

  async function testConnection() {
    setPing("checking");
    if (!isBrowserOnline()) {
      setPing("fail");
      return;
    }
    const client = getSupabase();
    if (!client) {
      setPing("fail");
      return;
    }
    try {
      const { error } = await client
        .from("appliance_scans")
        .select("count", { count: "exact", head: true });
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
          ? `Synced ${synced} offline action${synced === 1 ? "" : "s"}.`
          : "No pending offline actions"
      );
      window.setTimeout(() => setSyncMsg(null), 3500);
    } finally {
      setSyncing(false);
    }
  }

  function clearLocalCache() {
    clearLocalApplianceScans(storeNumber);
    clearLocalRemnants(storeNumber);
    purgeSyncQueue(storeNumber);
    refreshCacheCounts();
    setCacheMsg("Local operational caches cleared.");
    window.setTimeout(() => setCacheMsg(null), 3000);
  }

  return (
    <div className="space-y-4">
      <ThemeSelector />

      <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/90 p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          Security &amp; PIN
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
            <p className="text-xs text-slate-500">
              Store: {formatStoreLabel(storeNumber)}
            </p>
            <button
              type="button"
              onClick={onOpenChangePin}
              className="flex min-h-12 w-full items-center justify-center rounded-xl border border-emerald-500/40 text-sm font-semibold text-emerald-300"
            >
              Change My PIN
            </button>
          </>
        ) : (
          <p className="text-sm text-amber-300/90">
            Select a profile first, then change your PIN from here or the header.
          </p>
        )}
      </section>

      {/* Supervisors only — own department weekly target */}
      {supervisorSession && !masterSession ? (
        <WeeklyBayTargetCard specialist={activeSpecialist} />
      ) : null}

      {(supervisorSession || masterSession) && (
        <PushNotificationsCard specialist={activeSpecialist} />
      )}

      {masterSession && activeSpecialist ? (
        <AssociateRosterPanel
          specialist={activeSpecialist}
          roster={specialists}
          onRosterChange={onRosterChange}
        />
      ) : null}

      {masterSession ? (
        <section className="rounded-2xl border-2 border-amber-400/40 bg-amber-950/20 p-4">
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-amber-300">
            Super Admin
          </p>
          <p className="mt-1 text-sm text-slate-300">
            Store number, all-department targets, bulk generate, and diagnostics
            live in Admin Tools. Associate roster is on this page and in Admin
            Tools.
          </p>
          <button
            type="button"
            onClick={() => openAdminTools({ section: "menu" })}
            className="mt-3 flex min-h-12 w-full items-center justify-center rounded-xl border-2 border-amber-400/50 bg-slate-950 text-sm font-bold text-amber-100"
          >
            Open Admin Tools
          </button>
        </section>
      ) : null}

      <section className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/90">
        <button
          type="button"
          aria-expanded={deviceOpen}
          onClick={() => setDeviceOpen((o) => !o)}
          className="flex min-h-14 w-full items-center justify-between gap-3 px-4 py-3 text-left"
        >
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
              Device &amp; sync
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {pending > 0
                ? `${pending} pending offline action${pending === 1 ? "" : "s"}`
                : "Queue clear · expand for diagnostics"}
            </p>
          </div>
          <span aria-hidden className="font-mono text-slate-400">
            {deviceOpen ? "▲" : "▼"}
          </span>
        </button>
        {deviceOpen ? (
          <div className="space-y-4 border-t border-slate-800 px-4 pb-4 pt-3">
            <div>
              <p className="text-sm text-slate-300">
                Pending actions:{" "}
                <span className="font-mono font-semibold text-amber-300">
                  {pending}
                </span>
              </p>
              <button
                type="button"
                disabled={syncing || pending === 0}
                onClick={() => void syncNow()}
                className="mt-2 flex min-h-12 w-full items-center justify-center rounded-xl border border-emerald-500/40 text-sm font-semibold text-emerald-300 disabled:opacity-40"
              >
                {syncing ? "Syncing…" : "Replay queue now"}
              </button>
              {syncMsg ? (
                <p className="mt-2 text-center text-sm font-semibold text-emerald-300">
                  {syncMsg}
                </p>
              ) : null}
            </div>

            <div>
              <p className="text-sm font-semibold text-slate-400">Connection</p>
              {configured ? (
                <p className="mt-1 break-all font-mono text-[10px] text-slate-500">
                  {url}
                </p>
              ) : (
                <p className="mt-1 text-sm text-slate-400">
                  Supabase not configured (offline mode)
                </p>
              )}
              <div className="mt-2 flex items-center gap-2">
                <span
                  className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${
                    ping === "ok"
                      ? "bg-emerald-400"
                      : ping === "fail"
                        ? "bg-red-400"
                        : ping === "checking"
                          ? "bg-amber-400"
                          : "bg-slate-600"
                  }`}
                  aria-hidden
                />
                <p
                  className={`text-sm font-semibold ${
                    ping === "ok"
                      ? "text-emerald-300"
                      : ping === "fail"
                        ? "text-red-300"
                        : "text-slate-300"
                  }`}
                >
                  {ping === "checking"
                    ? "Checking…"
                    : ping === "ok"
                      ? "Connected (Database Live)"
                      : ping === "fail"
                        ? "Offline / Unreachable"
                        : configured
                          ? "Not tested yet"
                          : "Offline / Unreachable"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void testConnection()}
                disabled={!configured || ping === "checking"}
                className="mt-2 flex min-h-12 w-full items-center justify-center rounded-xl border border-slate-700 bg-slate-950 text-sm font-semibold text-slate-100 disabled:opacity-40"
              >
                {ping === "checking" ? "Checking…" : "Test Connection"}
              </button>
            </div>

            <div>
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-slate-400">
                  Local storage
                </p>
                <button
                  type="button"
                  onClick={clearLocalCache}
                  className="rounded-lg border border-red-500/40 px-2.5 py-1.5 text-[11px] font-semibold text-red-300"
                >
                  Clear Local Cache
                </button>
              </div>
              <ul className="mt-2 space-y-1.5 text-sm text-slate-300">
                <li className="flex justify-between gap-3 rounded-lg bg-slate-950/70 px-3 py-2">
                  <span>Appliance Audit Cache</span>
                  <span className="font-mono text-emerald-400">
                    {applianceAuditCache}
                  </span>
                </li>
                <li className="flex justify-between gap-3 rounded-lg bg-slate-950/70 px-3 py-2">
                  <span>Remnant Inventory Cache</span>
                  <span className="font-mono text-emerald-400">
                    {remnantInventoryCache}
                  </span>
                </li>
                <li className="flex justify-between gap-3 rounded-lg bg-slate-950/70 px-3 py-2">
                  <span>Pending Queue</span>
                  <span className="font-mono text-amber-300">{pending}</span>
                </li>
              </ul>
              {cacheMsg ? (
                <p className="mt-2 text-center text-xs font-semibold text-emerald-300">
                  {cacheMsg}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
