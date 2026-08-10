"use client";

import { useEffect, useState } from "react";
import { openAdminTools } from "@/components/hub/AdminToolsDrawer";
import { PushNotificationsCard } from "@/components/hub/PushNotificationsCard";
import { WeeklyBayTargetCard } from "@/components/hub/WeeklyBayTargetCard";
import { countLocalCatalog } from "@/lib/catalog";
import { countLocalRemnants } from "@/lib/remnants";
import { isSupervisor } from "@/lib/specialists";
import { isMasterAdmin } from "@/lib/rbac";
import { countLocalAudits } from "@/lib/storage";
import { formatStoreLabel } from "@/lib/store";
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

/**
 * Settings — floor-first. Supervisors: PIN, own bay target, push, sync.
 * Master Admin setup (roster, store #, all-dept targets, diagnostics) lives in
 * Admin Tools drawer — not permanent page chrome.
 */
export function SettingsSection({
  catalogCount,
  remnantCount,
  activeSpecialist,
  onOpenChangePin,
  storeNumber,
}: Props) {
  const [ping, setPing] = useState<"idle" | "ok" | "fail" | "checking">("idle");
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [deviceOpen, setDeviceOpen] = useState(false);

  const configured = isSupabaseConfigured();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const supervisorSession = isSupervisor(activeSpecialist);
  const masterSession = isMasterAdmin(activeSpecialist);
  const canChangePin = Boolean(activeSpecialist);
  const pending = countPendingSync(storeNumber);

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
          ? `Synced ${synced} offline action${synced === 1 ? "" : "s"}.`
          : "No pending offline actions"
      );
      window.setTimeout(() => setSyncMsg(null), 3500);
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => {
    // keep pending count reactive if store changes
  }, [storeNumber]);

  return (
    <div className="space-y-4">
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

      {masterSession ? (
        <section className="rounded-2xl border-2 border-amber-400/40 bg-amber-950/20 p-4">
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-amber-300">
            Super Admin
          </p>
          <p className="mt-1 text-sm text-slate-300">
            Roster, store number, all-department targets, bulk generate, and
            diagnostics live in Admin Tools — not on this page.
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

            {masterSession ? (
              <div>
                <p className="text-sm font-semibold text-slate-400">Supabase</p>
                <p className="mt-1 text-sm text-slate-300">
                  {configured ? "Configured" : "Not configured (offline mode)"}
                </p>
                {configured ? (
                  <p className="mt-1 break-all font-mono text-[10px] text-slate-500">
                    {url}
                  </p>
                ) : null}
                <button
                  type="button"
                  onClick={() => void testConnection()}
                  disabled={!configured || ping === "checking"}
                  className="mt-2 flex min-h-12 w-full items-center justify-center rounded-xl border border-slate-700 bg-slate-950 text-sm font-semibold text-slate-100 disabled:opacity-40"
                >
                  {ping === "checking"
                    ? "Checking…"
                    : ping === "ok"
                      ? "Connection OK"
                      : ping === "fail"
                        ? "Connection failed — retry"
                        : "Test connection"}
                </button>
              </div>
            ) : null}

            <div>
              <p className="text-sm font-semibold text-slate-400">
                Local storage
              </p>
              <ul className="mt-2 space-y-1.5 text-sm text-slate-300">
                <li className="flex justify-between gap-3 rounded-lg bg-slate-950/70 px-3 py-2">
                  <span>Audit cache</span>
                  <span className="font-mono text-emerald-400">{localAudits}</span>
                </li>
                <li className="flex justify-between gap-3 rounded-lg bg-slate-950/70 px-3 py-2">
                  <span>Catalog cache</span>
                  <span className="font-mono text-emerald-400">
                    {localCatalog}
                  </span>
                </li>
                <li className="flex justify-between gap-3 rounded-lg bg-slate-950/70 px-3 py-2">
                  <span>Remnant cache</span>
                  <span className="font-mono text-emerald-400">
                    {localRemnants}
                  </span>
                </li>
                <li className="flex justify-between gap-3 rounded-lg bg-slate-950/70 px-3 py-2">
                  <span>Loaded catalog / remnants</span>
                  <span className="font-mono text-slate-200">
                    {catalogCount} / {remnantCount}
                  </span>
                </li>
              </ul>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
