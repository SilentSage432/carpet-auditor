"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { PushNotificationsCard } from "@/components/hub/PushNotificationsCard";
import { WeeklyBayTargetCard } from "@/components/hub/WeeklyBayTargetCard";
import { ThemeSelector } from "@/components/settings/ThemeSelector";
import {
  clearLocalApplianceScans,
  countLocalApplianceScans,
} from "@/lib/appliance-scans";
import { fetchCatalog } from "@/lib/catalog";
import { usePendingSyncCount } from "@/lib/network";
import { selectOnFocus } from "@/lib/number-input";
import { canAccessSection, isMasterAdmin } from "@/lib/rbac";
import { clearLocalRemnants, countLocalRemnants, fetchRemnants } from "@/lib/remnants";
import { dedupeRoster, fetchSpecialists, isSupervisor } from "@/lib/specialists";
import {
  formatStoreLabel,
  getStoreNumber,
  normalizeStoreNumber,
  setStoreNumber,
} from "@/lib/store";
import { fetchDepartmentsDetailed } from "@/lib/store-ops/client";
import { fallbackDepartments } from "@/lib/store-ops/stores";
import { findFlooringDepartment } from "@/lib/store-ops/sunday-audit";
import {
  flushSyncQueue,
  isBrowserOnline,
  purgeSyncQueue,
} from "@/lib/sync-queue";
import { isSupabaseConfigured, getSupabase } from "@/lib/supabase";
import type { CatalogItem, Remnant, StoreSpecialist } from "@/lib/types";
import type { Department } from "@/lib/store-ops/types";

const BulkLocationGenerator = dynamic(
  () =>
    import("@/components/admin/BulkLocationGenerator").then(
      (mod) => mod.BulkLocationGenerator
    ),
  { ssr: false }
);
const ForceRotationModal = dynamic(
  () =>
    import("@/components/admin/ForceRotationModal").then(
      (mod) => mod.ForceRotationModal
    ),
  { ssr: false }
);
const TaxonomyManagerModal = dynamic(
  () =>
    import("@/components/catalog/TaxonomyManagerModal").then(
      (mod) => mod.TaxonomyManagerModal
    ),
  { ssr: false }
);
const RemnantSection = dynamic(
  () =>
    import("@/components/sections/RemnantSection").then(
      (mod) => mod.RemnantSection
    ),
  { ssr: false }
);

type Props = {
  activeSpecialist: StoreSpecialist | null;
  onOpenChangePin: () => void;
  storeNumber: string;
  onStoreNumberChange: (storeNumber: string) => void;
};

type ConnectionStatus = "idle" | "checking" | "ok" | "fail";
type SettingsAccordion = "device" | "store" | "bulk" | "remnants" | null;

/**
 * Settings — floor-first. Themes, PIN, sync, targets, push.
 * Master Admin setup (bulk, taxonomies, force rotation, store #) lives here
 * as accordions / modals — not a second menu. Floor Pad lives on Floor.
 */
export function SettingsSection({
  activeSpecialist,
  onOpenChangePin,
  storeNumber,
  onStoreNumberChange,
}: Props) {
  const [ping, setPing] = useState<ConnectionStatus>("idle");
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [openSection, setOpenSection] = useState<SettingsAccordion>("device");
  const [cacheTick, setCacheTick] = useState(0);
  const [cacheMsg, setCacheMsg] = useState<string | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [forceOpen, setForceOpen] = useState(false);
  const [taxonomyOpen, setTaxonomyOpen] = useState(false);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [remnants, setRemnants] = useState<Remnant[]>([]);
  const [roster, setRoster] = useState<StoreSpecialist[]>([]);

  const configured = isSupabaseConfigured();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const supervisorSession = isSupervisor(activeSpecialist);
  const masterSession = isMasterAdmin(activeSpecialist);
  const canChangePin = Boolean(activeSpecialist);
  const pending = usePendingSyncCount(storeNumber);
  const showRemnants =
    Boolean(activeSpecialist) && canAccessSection(activeSpecialist, "remnants");
  const pathname = usePathname();

  void cacheTick;
  const applianceAuditCache = countLocalApplianceScans(storeNumber);
  const remnantInventoryCache = countLocalRemnants();

  const refreshCacheCounts = useCallback(() => {
    setCacheTick((n) => n + 1);
  }, []);

  const reloadDepts = useCallback(async () => {
    if (!activeSpecialist || !masterSession) return;
    const store = normalizeStoreNumber(
      storeNumber || getStoreNumber() || activeSpecialist.store_number || ""
    );
    if (!store) {
      setDepartments(fallbackDepartments());
      return;
    }
    try {
      const result = await fetchDepartmentsDetailed(activeSpecialist, store);
      setDepartments(
        result.items.length > 0 ? result.items : fallbackDepartments()
      );
    } catch {
      setDepartments(fallbackDepartments());
    }
  }, [activeSpecialist, masterSession, storeNumber]);

  useEffect(() => {
    void reloadDepts();
  }, [reloadDepts]);

  useEffect(() => {
    if (!showRemnants) return;
    let cancelled = false;
    void Promise.all([fetchCatalog(), fetchRemnants(), fetchSpecialists()]).then(
      ([cat, rem, team]) => {
        if (cancelled) return;
        setCatalog(cat);
        setRemnants(rem);
        setRoster(dedupeRoster(team));
      }
    );
    return () => {
      cancelled = true;
    };
  }, [showRemnants, storeNumber]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    function applyHash() {
      const hash = window.location.hash.replace(/^#/, "");
      if (hash === "bulk-generate" || hash === "map-management") {
        setOpenSection("bulk");
      } else if (hash === "weekly-rotation") {
        setForceOpen(true);
      } else if (
        hash === "manager-notes" ||
        hash === "s-pen-notes" ||
        hash === "floor-pad"
      ) {
        window.location.replace("/dashboard#floor-pad");
      } else if (hash === "taxonomies") {
        setTaxonomyOpen(true);
      } else if (hash === "remnants") {
        setOpenSection("remnants");
      } else if (hash === "admin-tools") {
        setOpenSection("store");
      }
    }
    applyHash();
    window.addEventListener("hashchange", applyHash);
    return () => window.removeEventListener("hashchange", applyHash);
  }, [pathname]);

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

  function toggleSection(id: SettingsAccordion) {
    setOpenSection((current) => (current === id ? null : id));
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

      {(supervisorSession || masterSession) && activeSpecialist ? (
        <WeeklyBayTargetCard specialist={activeSpecialist} />
      ) : null}

      {(supervisorSession || masterSession) && (
        <PushNotificationsCard specialist={activeSpecialist} />
      )}

      {masterSession && activeSpecialist ? (
        <section className="space-y-2">
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-amber-300">
            Floor architecture
          </p>
          <Accordion
            id="store"
            title="Store number"
            subtitle={formatStoreLabel(storeNumber)}
            open={openSection === "store"}
            onToggle={() => toggleSection("store")}
          >
            <StoreNumberPanel
              storeNumber={storeNumber}
              onStoreNumberChange={onStoreNumberChange}
            />
          </Accordion>
          <Accordion
            id="bulk-generate"
            title="Bulk Generator"
            subtitle="Aisle / bay tags"
            open={openSection === "bulk"}
            onToggle={() => toggleSection("bulk")}
          >
            {departments.length === 0 ? (
              <p className="text-sm text-slate-400">Loading departments…</p>
            ) : (
              <BulkLocationGenerator
                specialist={activeSpecialist}
                departments={departments}
                onGenerated={() => void reloadDepts()}
              />
            )}
          </Accordion>
          <button
            type="button"
            onClick={() => setTaxonomyOpen(true)}
            className="flex min-h-12 w-full items-center justify-between rounded-2xl border border-slate-800 bg-slate-900/90 px-4 text-left"
          >
            <span>
              <span className="block text-sm font-semibold text-slate-100">
                Catalog taxonomies
              </span>
              <span className="block text-xs text-slate-500">
                Folder trees per department
              </span>
            </span>
            <span className="text-slate-500">→</span>
          </button>
          <button
            type="button"
            onClick={() => setForceOpen(true)}
            className="flex min-h-12 w-full items-center justify-between rounded-2xl border border-slate-800 bg-slate-900/90 px-4 text-left"
          >
            <span>
              <span className="block text-sm font-semibold text-slate-100">
                Trigger weekly rotation
              </span>
              <span className="block text-xs text-slate-500">
                Force a new Sunday draw
              </span>
            </span>
            <span className="text-slate-500">→</span>
          </button>
        </section>
      ) : null}

      {showRemnants && activeSpecialist ? (
        <Accordion
          id="remnants"
          title="Remnant inventory"
          subtitle="Rack status and markdown"
          open={openSection === "remnants"}
          onToggle={() => toggleSection("remnants")}
        >
          <RemnantSection
            catalog={catalog}
            remnants={remnants}
            onRemnantsChange={setRemnants}
            loggedBy={activeSpecialist.name}
            specialists={roster}
            activeSpecialist={activeSpecialist}
          />
        </Accordion>
      ) : null}

      <Accordion
        title="Device & sync"
        subtitle={
          pending > 0
            ? `${pending} pending offline action${pending === 1 ? "" : "s"}`
            : "Queue clear · diagnostics"
        }
        open={openSection === "device"}
        onToggle={() => toggleSection("device")}
      >
        <div className="space-y-4">
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
      </Accordion>

      {forceOpen && activeSpecialist ? (
        <ForceRotationModal
          open={forceOpen}
          onClose={() => setForceOpen(false)}
          specialist={activeSpecialist}
          departments={departments}
          initialDepartmentId={
            findFlooringDepartment(departments)?.id ?? departments[0]?.id
          }
          onForced={() => {
            setForceOpen(false);
            void reloadDepts();
          }}
        />
      ) : null}
      {taxonomyOpen ? (
        <TaxonomyManagerModal
          open={taxonomyOpen}
          onClose={() => setTaxonomyOpen(false)}
          departments={departments}
        />
      ) : null}
    </div>
  );
}

function Accordion({
  id,
  title,
  subtitle,
  open,
  onToggle,
  children,
}: {
  id?: string;
  title: string;
  subtitle?: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/90"
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex min-h-14 w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            {title}
          </h2>
          {subtitle ? (
            <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>
          ) : null}
        </div>
        <span aria-hidden className="font-mono text-slate-400">
          {open ? "▲" : "▼"}
        </span>
      </button>
      {open ? (
        <div className="border-t border-slate-800 px-4 pb-4 pt-3">{children}</div>
      ) : null}
    </section>
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
    <div className="space-y-3">
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
    </div>
  );
}
