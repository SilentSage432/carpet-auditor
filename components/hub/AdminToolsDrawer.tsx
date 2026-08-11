"use client";

/**
 * Super Admin Tools — single slide-over for setup / one-off ops.
 * Defaults closed. Owns Bulk Generate, Force Rotation, roster link,
 * all-dept targets, store number, and device diagnostics.
 */

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useId,
  useState,
  type ReactNode,
} from "react";
import { BulkLocationGenerator } from "@/components/admin/BulkLocationGenerator";
import { ForceRotationModal } from "@/components/admin/ForceRotationModal";
import { WeeklyBayTargetCard } from "@/components/hub/WeeklyBayTargetCard";
import { selectOnFocus } from "@/lib/number-input";
import { isMasterAdmin } from "@/lib/rbac";
import { fetchDepartments } from "@/lib/store-ops/client";
import { usePendingSyncCount } from "@/lib/network";
import {
  formatStoreLabel,
  getStoreNumber,
  normalizeStoreNumber,
  setStoreNumber,
} from "@/lib/store";
import { flushSyncQueue } from "@/lib/sync-queue";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import type { Department } from "@/lib/store-ops/types";
import type { StoreSpecialist } from "@/lib/types";

export type AdminToolsSection =
  | "menu"
  | "bulk"
  | "targets"
  | "store"
  | "diagnostics";

export const ADMIN_TOOLS_EVENT = "deptsync:admin-tools";

export type AdminToolsEventDetail = {
  section?: AdminToolsSection;
  openForceRotation?: boolean;
};

type Props = {
  open: boolean;
  onClose: () => void;
  specialist: StoreSpecialist;
  storeNumber: string;
  onStoreNumberChange?: (storeNumber: string) => void;
  initialSection?: AdminToolsSection;
  openForceRotationOnMount?: boolean;
};

export function AdminToolsDrawer({
  open,
  onClose,
  specialist,
  storeNumber,
  onStoreNumberChange,
  initialSection = "menu",
  openForceRotationOnMount = false,
}: Props) {
  const titleId = useId();
  const [section, setSection] = useState<AdminToolsSection>(initialSection);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [forceOpen, setForceOpen] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const reloadDepts = useCallback(async () => {
    if (!isMasterAdmin(specialist)) return;
    try {
      const list = await fetchDepartments(specialist);
      setDepartments(list);
      setLoadError(null);
    } catch {
      setDepartments([]);
      setLoadError("Could not load departments for admin tools.");
    }
  }, [specialist]);

  useEffect(() => {
    if (!open) return;
    setSection(initialSection);
    setForceOpen(openForceRotationOnMount);
    void reloadDepts();
  }, [open, initialSection, openForceRotationOnMount, reloadDepts]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (forceOpen) setForceOpen(false);
        else onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, forceOpen, onClose]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open || !isMasterAdmin(specialist)) return null;

  return (
    <>
      <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true">
        <button
          type="button"
          aria-label="Close admin tools"
          className="absolute inset-0 bg-slate-950/70"
          onClick={onClose}
        />
        <aside
          aria-labelledby={titleId}
          className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col border-l-2 border-amber-400/50 bg-slate-950 shadow-none"
        >
          <header className="flex shrink-0 items-start gap-3 border-b border-amber-500/30 bg-amber-950/40 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-amber-300">
                Super Admin
              </p>
              <h2 id={titleId} className="text-lg font-bold text-slate-50">
                Admin Tools
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-600 text-slate-200"
              aria-label="Close"
            >
              ✕
            </button>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 pb-10">
            {section !== "menu" ? (
              <button
                type="button"
                onClick={() => setSection("menu")}
                className="mb-3 min-h-11 text-sm font-semibold text-amber-200"
              >
                ← All tools
              </button>
            ) : null}

            {loadError ? (
              <p className="mb-3 rounded-xl border border-red-500/40 bg-red-950/40 px-3 py-2 text-sm text-red-200">
                {loadError}
              </p>
            ) : null}

            {section === "menu" ? (
              <Menu
                onBulk={() => setSection("bulk")}
                onForce={() => setForceOpen(true)}
                onTargets={() => setSection("targets")}
                onStore={() => setSection("store")}
                onDiagnostics={() => setSection("diagnostics")}
                onNavigate={onClose}
              />
            ) : null}

            {section === "bulk" ? (
              departments.length === 0 ? (
                <p className="text-sm text-slate-400">Loading departments…</p>
              ) : (
                <BulkLocationGenerator
                  specialist={specialist}
                  departments={departments}
                  onGenerated={() => void reloadDepts()}
                />
              )
            ) : null}

            {section === "targets" ? (
              <WeeklyBayTargetCard specialist={specialist} />
            ) : null}

            {section === "store" ? (
              <StoreNumberPanel
                storeNumber={storeNumber}
                onStoreNumberChange={onStoreNumberChange}
              />
            ) : null}

            {section === "diagnostics" ? (
              <DiagnosticsPanel storeNumber={storeNumber} />
            ) : null}
          </div>
        </aside>
      </div>

      <ForceRotationModal
        open={forceOpen}
        onClose={() => setForceOpen(false)}
        specialist={specialist}
        departments={departments}
        initialDepartmentId={departments[0]?.id}
        onForced={() => {
          setForceOpen(false);
          void reloadDepts();
        }}
      />
    </>
  );
}

function Menu({
  onBulk,
  onForce,
  onTargets,
  onStore,
  onDiagnostics,
  onNavigate,
}: {
  onBulk: () => void;
  onForce: () => void;
  onTargets: () => void;
  onStore: () => void;
  onDiagnostics: () => void;
  onNavigate: () => void;
}) {
  return (
    <div className="grid gap-2">
      <ToolButton onClick={onBulk}>Bulk Generate Aisles</ToolButton>
      <ToolButton onClick={onForce}>Trigger Weekly Rotation</ToolButton>
      <ToolButton onClick={onTargets}>All-Department Bay Targets</ToolButton>
      <ToolButton onClick={onStore}>Store Number / Location</ToolButton>
      <Link
        href="/admin/supervisors"
        onClick={onNavigate}
        className="flex min-h-14 items-center justify-center rounded-xl border-2 border-amber-400/50 bg-slate-900 px-3 text-center text-sm font-bold text-amber-100"
      >
        Manage Supervisor Logins
      </Link>
      <Link
        href="/admin/store-map"
        onClick={onNavigate}
        className="flex min-h-12 items-center justify-center rounded-xl border border-slate-700 bg-slate-900 px-3 text-center text-sm font-semibold text-slate-100"
      >
        Open Store Map
      </Link>
      <Link
        href="/admin/exceptions"
        onClick={onNavigate}
        className="flex min-h-12 items-center justify-center rounded-xl border border-slate-700 bg-slate-900 px-3 text-center text-sm font-semibold text-slate-100"
      >
        Exception Log
      </Link>
      <ToolButton onClick={onDiagnostics} subtle>
        Device &amp; sync diagnostics
      </ToolButton>
    </div>
  );
}

function ToolButton({
  children,
  onClick,
  subtle,
}: {
  children: ReactNode;
  onClick: () => void;
  subtle?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        subtle
          ? "flex min-h-12 items-center justify-center rounded-xl border border-slate-700 bg-slate-900 px-3 text-center text-sm font-semibold text-slate-200"
          : "flex min-h-14 items-center justify-center rounded-xl border-2 border-amber-400/50 bg-slate-900 px-3 text-center text-sm font-bold text-amber-100"
      }
    >
      {children}
    </button>
  );
}

function StoreNumberPanel({
  storeNumber,
  onStoreNumberChange,
}: {
  storeNumber: string;
  onStoreNumberChange?: (storeNumber: string) => void;
}) {
  const [draft, setDraft] = useState(storeNumber || getStoreNumber());
  const [msg, setMsg] = useState<string | null>(null);
  const dirty =
    normalizeStoreNumber(draft) !== normalizeStoreNumber(storeNumber);

  useEffect(() => {
    setDraft(storeNumber || getStoreNumber());
  }, [storeNumber]);

  function save() {
    const next = setStoreNumber(draft);
    onStoreNumberChange?.(next);
    setDraft(next);
    setMsg(next ? `Saved store ${next}.` : "Store number cleared.");
    window.setTimeout(() => setMsg(null), 3000);
  }

  return (
    <section className="space-y-3 rounded-2xl border border-slate-700 bg-slate-900/90 p-4">
      <h3 className="text-sm font-semibold text-slate-200">
        Store Number / Location
      </h3>
      <p className="text-sm text-slate-400">
        Active:{" "}
        <span className="font-semibold text-emerald-400">
          {formatStoreLabel(storeNumber)}
        </span>
      </p>
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        aria-label="Store Number"
        value={draft}
        onFocus={selectOnFocus}
        onChange={(e) => setDraft(e.target.value.replace(/\D/g, ""))}
        className="min-h-12 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 font-mono text-base font-semibold text-slate-100 outline-none focus:border-emerald-500"
      />
      <button
        type="button"
        disabled={!dirty && draft === storeNumber}
        onClick={save}
        className="min-h-12 w-full rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white disabled:opacity-50"
      >
        Save Store Number
      </button>
      {msg ? <p className="text-xs text-emerald-400">{msg}</p> : null}
    </section>
  );
}

function DiagnosticsPanel({ storeNumber }: { storeNumber: string }) {
  const [ping, setPing] = useState<"idle" | "ok" | "fail" | "checking">("idle");
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const configured = isSupabaseConfigured();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const pending = usePendingSyncCount(storeNumber);

  async function testConnection() {
    setPing("checking");
    if (!navigator.onLine) {
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
      window.setTimeout(() => setSyncMsg(null), 3000);
    } finally {
      setSyncing(false);
    }
  }

  return (
    <section className="space-y-4">
      <div className="rounded-2xl border border-slate-700 bg-slate-900/90 p-4">
        <h3 className="text-sm font-semibold text-slate-200">Offline sync</h3>
        <p className="mt-1 text-sm text-slate-400">
          Pending:{" "}
          <span className="font-mono font-semibold text-amber-300">{pending}</span>
        </p>
        <button
          type="button"
          disabled={syncing || pending === 0}
          onClick={() => void syncNow()}
          className="mt-3 min-h-12 w-full rounded-xl border border-emerald-500/40 text-sm font-semibold text-emerald-300 disabled:opacity-40"
        >
          {syncing ? "Syncing…" : "Replay queue now"}
        </button>
        {syncMsg ? (
          <p className="mt-2 text-sm text-emerald-300">{syncMsg}</p>
        ) : null}
      </div>
      <div className="rounded-2xl border border-slate-700 bg-slate-900/90 p-4">
        <h3 className="text-sm font-semibold text-slate-200">Supabase</h3>
        <p className="mt-1 text-sm text-slate-400">
          {configured ? "Configured" : "Not configured (offline mode)"}
        </p>
        {configured ? (
          <p className="mt-1 break-all font-mono text-[10px] text-slate-500">
            {url}
          </p>
        ) : null}
        <div className="mt-2 flex items-center gap-2">
          <span
            className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${
              ping === "ok"
                ? "bg-emerald-400"
                : ping === "fail"
                  ? "bg-red-400"
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
                  : "Not tested yet"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void testConnection()}
          disabled={!configured || ping === "checking"}
          className="mt-3 min-h-12 w-full rounded-xl border border-slate-700 bg-slate-950 text-sm font-semibold text-slate-100 disabled:opacity-40"
        >
          {ping === "checking" ? "Checking…" : "Test Connection"}
        </button>
      </div>
    </section>
  );
}

/** Dispatch from any page (e.g. hash deep-links) to open Admin Tools. */
export function openAdminTools(detail?: AdminToolsEventDetail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(ADMIN_TOOLS_EVENT, { detail: detail ?? {} })
  );
}
