"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  Calendar,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  FolderTree,
  Layers,
  PlusCircle,
  RefreshCw,
  Scissors,
  Sliders,
  Target,
  UserCheck,
  type LucideIcon,
} from "lucide-react";
import { AisleBayManager } from "@/components/admin/AisleBayManager";
import { PushNotificationsCard } from "@/components/hub/PushNotificationsCard";
import { FloorTitleBadge } from "@/components/hub/SpecialistCard";
import { WeeklyBayTargetCard } from "@/components/hub/WeeklyBayTargetCard";
import { ThemeSelector } from "@/components/settings/ThemeSelector";
import { SyncQueuePanel } from "@/components/settings/SyncQueuePanel";
import { SundayScheduleCard } from "@/components/admin/SundayScheduleCard";
import {
  clearLocalApplianceScans,
  countLocalApplianceScans,
} from "@/lib/appliance-scans";
import { fetchCatalog } from "@/lib/catalog";
import { usePendingSyncCount, useSyncQueueSummary } from "@/lib/network";
import { selectOnFocus } from "@/lib/number-input";
import { canAccessSection, canManageMapConsole, isMasterAdmin } from "@/lib/rbac";
import { clearLocalRemnants, countLocalRemnants, fetchRemnants } from "@/lib/remnants";
import { requestRemnantCalculator } from "@/lib/specialty-tools";
import { dedupeRoster, fetchSpecialists, isSupervisor } from "@/lib/specialists";
import {
  formatStoreLabel,
  getStoreNumber,
  normalizeStoreNumber,
  setStoreNumber,
} from "@/lib/store";
import {
  fetchDepartmentsDetailed,
  fetchStoreLocationsDetailed,
  STORE_OPS_LOCATIONS_CHANGED_EVENT,
} from "@/lib/store-ops/client";
import { findFlooringDepartment } from "@/lib/store-ops/sunday-audit";
import {
  ADMIN_DEPT_CONTEXT_EVENT,
  adminWorkingDepartmentLabel,
  workingDepartmentId,
} from "@/lib/admin-department-context";
import { useWorkingDepartment } from "@/lib/use-working-department";
import {
  flushSyncQueue,
  isBrowserOnline,
  purgeSyncQueue,
} from "@/lib/sync-queue";
import { isSupabaseConfigured, getSupabase } from "@/lib/supabase";
import type { CatalogItem, Remnant, StoreSpecialist } from "@/lib/types";
import type { Department, StoreLocation } from "@/lib/store-ops/types";

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
type SettingsAccordion =
  | "device"
  | "store"
  | "bulk"
  | "remnants"
  | "taxonomies"
  | null;

const ICON_STROKE = 1.75;

/**
 * Settings — four scannable cards. Themes, PIN, sync, targets, topology, catalog.
 * Master Admin setup lives here as nested accordions / modals — not a second menu.
 * Floor Pad lives on Floor.
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
  const [openSection, setOpenSection] = useState<SettingsAccordion>(null);
  const [cacheTick, setCacheTick] = useState(0);
  const [cacheMsg, setCacheMsg] = useState<string | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [locations, setLocations] = useState<StoreLocation[]>([]);
  const [forceOpen, setForceOpen] = useState(false);
  const [taxonomyOpen, setTaxonomyOpen] = useState(false);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [remnants, setRemnants] = useState<Remnant[]>([]);
  const [roster, setRoster] = useState<StoreSpecialist[]>([]);

  const configured = isSupabaseConfigured();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const supervisorSession = isSupervisor(activeSpecialist);
  const masterSession = isMasterAdmin(activeSpecialist);
  const mapConsole = canManageMapConsole(activeSpecialist);
  const working = useWorkingDepartment(activeSpecialist);
  const canChangePin = Boolean(activeSpecialist);
  const pending = usePendingSyncCount(storeNumber);
  const syncSummary = useSyncQueueSummary(storeNumber);
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
    if (!activeSpecialist || (!masterSession && !mapConsole)) return;
    const store = normalizeStoreNumber(
      storeNumber || getStoreNumber() || activeSpecialist.store_number || ""
    );
    if (!store) {
      setDepartments([]);
      setLocations([]);
      return;
    }
    try {
      const result = await fetchDepartmentsDetailed(activeSpecialist, store);
      setDepartments(result.items);
      if (mapConsole) {
        const deptId = workingDepartmentId(activeSpecialist, result.items);
        const locs = await fetchStoreLocationsDetailed(
          activeSpecialist,
          deptId
        );
        setLocations(locs.items);
      } else {
        setLocations([]);
      }
    } catch (err) {
      console.error("[Settings] live departments failed", err);
      setDepartments([]);
      setLocations([]);
    }
  }, [activeSpecialist, masterSession, mapConsole, storeNumber]);

  useEffect(() => {
    void reloadDepts();
  }, [reloadDepts]);

  useEffect(() => {
    function onMap() {
      void reloadDepts();
    }
    window.addEventListener(ADMIN_DEPT_CONTEXT_EVENT, onMap);
    window.addEventListener(STORE_OPS_LOCATIONS_CHANGED_EVENT, onMap);
    return () => {
      window.removeEventListener(ADMIN_DEPT_CONTEXT_EVENT, onMap);
      window.removeEventListener(STORE_OPS_LOCATIONS_CHANGED_EVENT, onMap);
    };
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
      if (
        hash === "bulk-generate" ||
        hash === "map-management" ||
        hash === "topology" ||
        hash === "bay-setup"
      ) {
        setOpenSection("bulk");
      } else if (hash === "weekly-rotation") {
        setForceOpen(true);
        window.setTimeout(() => {
          document.getElementById("settings-targets")?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
        }, 50);
      } else if (
        hash === "manager-notes" ||
        hash === "s-pen-notes" ||
        hash === "floor-pad"
      ) {
        window.location.replace("/dashboard#floor-pad");
      } else if (hash === "taxonomies") {
        setOpenSection("taxonomies");
        setTaxonomyOpen(true);
      } else if (hash === "remnants") {
        setOpenSection("remnants");
      } else if (hash === "remnants-calculator") {
        setOpenSection("remnants");
        window.setTimeout(() => requestRemnantCalculator(), 100);
      } else if (hash === "admin-tools" || hash === "sunday-schedule") {
        window.setTimeout(() => {
          document.getElementById("sunday-schedule")?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
        }, 50);
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
      <SettingsCard
        title="Profile & Preferences"
        subtitle="PIN, theme, device, and alerts"
        icons={[UserCheck, Sliders]}
      >
        {canChangePin && activeSpecialist ? (
          <>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <p className="truncate text-base font-semibold text-emerald-400">
                {activeSpecialist.name}
              </p>
              <FloorTitleBadge member={activeSpecialist} />
            </div>
            <p className="font-mono text-xs text-slate-500">
              Store {formatStoreLabel(storeNumber)}
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={onOpenChangePin}
                className="flex min-h-12 w-full items-center justify-center rounded-xl border border-emerald-500/40 text-sm font-semibold text-emerald-300"
              >
                Change PIN
              </button>
              <ThemeSelector />
            </div>
          </>
        ) : (
          <p className="text-sm text-amber-300/90">
            Select a profile first, then change your PIN from here or the header.
          </p>
        )}

        <Accordion
          title="Device & sync"
          subtitle={
            syncSummary.quarantined > 0
              ? `${syncSummary.quarantined} blocked · ${syncSummary.pending} pending`
              : pending > 0
                ? `${pending} pending offline action${pending === 1 ? "" : "s"}`
                : "Queue clear · diagnostics"
          }
          open={openSection === "device"}
          onToggle={() => toggleSection("device")}
        >
          <div className="space-y-4">
            <SyncQueuePanel
              specialist={activeSpecialist}
              storeNumber={storeNumber}
            />

            <div className="border-t border-slate-800 pt-4">
              <p className="text-sm font-semibold text-slate-400">Manual replay</p>
              <p className="mt-1 text-sm text-slate-300">
                Actionable pending:{" "}
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
                  <span>Pending queue</span>
                  <span className="font-mono text-amber-300">{pending}</span>
                </li>
                <li className="flex justify-between gap-3 rounded-lg bg-slate-950/70 px-3 py-2">
                  <span>Blocked (quarantined)</span>
                  <span className="font-mono text-red-300">
                    {syncSummary.quarantined}
                  </span>
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

        {(supervisorSession || masterSession) && (
          <PushNotificationsCard specialist={activeSpecialist} />
        )}

        {masterSession ? (
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
        ) : null}
      </SettingsCard>

      {(supervisorSession || masterSession) && activeSpecialist ? (
        <SettingsCard
          id="settings-targets"
          title="Department Targets & Sunday Auto-Stage"
          subtitle="Weekly quotas and Sunday clock"
          icons={[Calendar, Target]}
        >
          {masterSession ? (
            <SundayScheduleCard specialist={activeSpecialist} />
          ) : null}
          <WeeklyBayTargetCard specialist={activeSpecialist} />
          {masterSession ? (
            <button
              type="button"
              onClick={() => setForceOpen(true)}
              className="flex min-h-12 w-full items-center justify-center rounded-xl border border-slate-700 bg-slate-950 text-sm font-semibold text-slate-100"
            >
              <RefreshCw
                className="w-4 h-4 mr-2"
                strokeWidth={ICON_STROKE}
                aria-hidden
              />
              Trigger Weekly Rotation Now
            </button>
          ) : null}
        </SettingsCard>
      ) : null}

      {mapConsole && activeSpecialist ? (
        <SettingsCard
          id="bulk-generate"
          title="Store Topology & Bay Setup"
          subtitle="Aisles, single bays, bulk generate"
          icons={[Layers, PlusCircle]}
          collapsible
          open={openSection === "bulk"}
          onToggle={() => toggleSection("bulk")}
        >
          <AisleBayManager
            specialist={activeSpecialist}
            departments={departments}
            locations={locations}
            canMutate
            contextLabel={
              working === "all"
                ? "Full Store"
                : adminWorkingDepartmentLabel(working)
            }
            onChanged={() => void reloadDepts()}
          />
        </SettingsCard>
      ) : null}

      {(masterSession || showRemnants) && activeSpecialist ? (
        <SettingsCard
          title="Catalog & Remnants"
          subtitle="Taxonomies and remnant markdown"
          icons={[FolderTree, Scissors]}
        >
          {masterSession ? (
            <Accordion
              title="Catalog taxonomies"
              subtitle="Folder trees per department"
              open={openSection === "taxonomies"}
              onToggle={() => toggleSection("taxonomies")}
            >
              <button
                type="button"
                onClick={() => setTaxonomyOpen(true)}
                className="flex min-h-12 w-full items-center justify-between rounded-xl border border-slate-700 bg-slate-950 px-4 text-left"
              >
                <span className="text-sm font-semibold text-slate-100">
                  Open taxonomy manager
                </span>
                <ChevronRight
                  className="h-4 w-4 text-slate-500"
                  strokeWidth={ICON_STROKE}
                  aria-hidden
                />
              </button>
            </Accordion>
          ) : null}
          {showRemnants ? (
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
        </SettingsCard>
      ) : null}

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

function SettingsCard({
  id,
  title,
  subtitle,
  icons,
  children,
  collapsible = false,
  open = true,
  onToggle,
}: {
  id?: string;
  title: string;
  subtitle?: string;
  icons: LucideIcon[];
  children: ReactNode;
  collapsible?: boolean;
  open?: boolean;
  onToggle?: () => void;
}) {
  const heading = (
    <>
      <span className="flex shrink-0 items-center gap-1 text-accent">
        {icons.map((Icon) => (
          <Icon
            key={Icon.displayName ?? Icon.name}
            className="h-4 w-4"
            strokeWidth={ICON_STROKE}
            aria-hidden
          />
        ))}
      </span>
      <span className="min-w-0 flex-1">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-200">
          {title}
        </h2>
        {subtitle ? (
          <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>
        ) : null}
      </span>
      {collapsible ? (
        open ? (
          <ChevronUp
            className="h-4 w-4 shrink-0 text-slate-400"
            strokeWidth={ICON_STROKE}
            aria-hidden
          />
        ) : (
          <ChevronDown
            className="h-4 w-4 shrink-0 text-slate-400"
            strokeWidth={ICON_STROKE}
            aria-hidden
          />
        )
      ) : null}
    </>
  );

  return (
    <section
      id={id}
      className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/90"
    >
      {collapsible ? (
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left"
        >
          {heading}
        </button>
      ) : (
        <div className="flex min-h-14 items-center gap-3 px-4 py-3">
          {heading}
        </div>
      )}
      {!collapsible || open ? (
        <div className="space-y-4 border-t border-slate-800 px-4 pb-4 pt-3">
          {children}
        </div>
      ) : null}
    </section>
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
      className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950/50"
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
        {open ? (
          <ChevronUp className="h-4 w-4 shrink-0 text-slate-400" strokeWidth={1.75} aria-hidden />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" strokeWidth={1.75} aria-hidden />
        )}
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
