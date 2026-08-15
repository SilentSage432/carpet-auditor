"use client";

import dynamic from "next/dynamic";
import { startTransition, useCallback, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ChangePinModal } from "@/components/hub/ChangePinModal";
import { AssociateSpecialtySwitcher } from "@/components/hub/HubChrome";
import { SpecialistModal } from "@/components/hub/SpecialistModal";
import {
  clearAuthSession,
  isAuthSessionExpired,
  markWorkspaceUnlocked,
  readAuthSession,
  startAuthSession,
  touchAuthSession,
  updateAuthSessionSpecialist,
} from "@/lib/auth-session";
import { blurActiveInput } from "@/lib/focus-input";
import { fetchApplianceCatalog } from "@/lib/appliance-catalog";
import { fetchCatalog } from "@/lib/catalog";
import { fetchRemnants } from "@/lib/remnants";
import {
  canAccessSection,
  defaultSectionForMember,
  effectiveDepartment,
  isAssociate,
  isGenericDepartment,
  sectionTitle,
} from "@/lib/rbac";
import {
  dedupeRoster,
  fetchSpecialists,
  needsCredentialSetup,
  syncActiveSpecialistFromRoster,
} from "@/lib/specialists";
import { getStoreNumber, setStoreNumber, STORE_CHANGED_EVENT } from "@/lib/store";
import { flushSyncQueue } from "@/lib/sync-queue";
import { getSupabase } from "@/lib/supabase";
import type {
  ApplianceCatalogItem,
  CatalogItem,
  HubSection,
  Remnant,
  StoreSpecialist,
} from "@/lib/types";
import type { AuthWallMode } from "@/components/auth/AuthWall";
import { DeptSyncSplash } from "@/components/hub/DeptSyncSplash";

function HubBootFallback() {
  return <DeptSyncSplash message="Loading DeptSync secure session…" />;
}

const AuthWall = dynamic(
  () => import("@/components/auth/AuthWall").then((m) => m.AuthWall),
  { loading: HubBootFallback }
);
const NavigationHub = dynamic(
  () => import("@/components/hub/NavigationHub").then((m) => m.NavigationHub)
);
const CycleAuditSection = dynamic(
  () =>
    import("@/components/sections/CycleAuditSection").then(
      (m) => m.CycleAuditSection
    ),
  { ssr: false }
);
const ApplianceAuditSection = dynamic(
  () =>
    import("@/components/sections/ApplianceAuditSection").then(
      (m) => m.ApplianceAuditSection
    ),
  { ssr: false }
);
const RemnantSection = dynamic(
  () =>
    import("@/components/sections/RemnantSection").then((m) => m.RemnantSection),
  { ssr: false }
);
const SettingsSection = dynamic(
  () =>
    import("@/components/sections/SettingsSection").then(
      (m) => m.SettingsSection
    ),
  { ssr: false }
);
const DepartmentAuditSection = dynamic(
  () =>
    import("@/components/sections/DepartmentAuditSection").then(
      (m) => m.DepartmentAuditSection
    ),
  { ssr: false }
);

const HUB_SECTION_IDS: HubSection[] = [
  "audit",
  "appliances",
  "remnants",
  "department",
  "settings",
];

function parseHubSectionParam(raw: string | null): HubSection | null {
  if (!raw) return null;
  if (raw === "catalog") return "appliances";
  if ((HUB_SECTION_IDS as string[]).includes(raw)) {
    return raw as HubSection;
  }
  return null;
}

function sectionNeedsCatalog(section: HubSection): boolean {
  return (
    section === "audit" ||
    section === "remnants" ||
    section === "department" ||
    section === "settings"
  );
}

function sectionNeedsRemnants(section: HubSection): boolean {
  return section === "audit" || section === "remnants" || section === "settings";
}

function sectionNeedsApplianceCatalog(section: HubSection): boolean {
  return section === "appliances";
}

function HubPane({ show, children }: { show: boolean; children: ReactNode }) {
  return (
    <div hidden={!show} aria-hidden={!show}>
      {children}
    </div>
  );
}

type Gate = "booting" | AuthWallMode | "ready";

export default function DeptSyncHubPage() {
  const router = useRouter();
  const [section, setSection] = useState<HubSection>("audit");
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [applianceCatalog, setApplianceCatalog] = useState<
    ApplianceCatalogItem[]
  >([]);
  const [remnants, setRemnants] = useState<Remnant[]>([]);
  const [specialist, setSpecialist] = useState<StoreSpecialist | null>(null);
  const [specialists, setSpecialists] = useState<StoreSpecialist[]>([]);
  const [specialistOpen, setSpecialistOpen] = useState(false);
  const [changePinOpen, setChangePinOpen] = useState(false);
  const [pinToast, setPinToast] = useState(false);
  const [syncToast, setSyncToast] = useState<string | null>(null);
  const [storeNumber, setStoreNumberState] = useState(() =>
    typeof window === "undefined" ? "" : getStoreNumber()
  );
  const [gate, setGate] = useState<Gate>("booting");
  const [rosterReady, setRosterReady] = useState(false);
  const [visitedSections, setVisitedSections] = useState<Set<HubSection>>(
    () => new Set()
  );

  const unlockWorkspace = useCallback((member: StoreSpecialist) => {
    setSpecialist(member);
    const fromQuery =
      typeof window !== "undefined"
        ? parseHubSectionParam(
            new URLSearchParams(window.location.search).get("section")
          )
        : null;
    const next =
      fromQuery && canAccessSection(member, fromQuery)
        ? fromQuery
        : defaultSectionForMember(member);
    setSection(next === "catalog" ? "appliances" : next);
    if (needsCredentialSetup(member) || member.must_change_credentials) {
      setGate("setup");
      return;
    }
    const session = readAuthSession();
    if (session) markWorkspaceUnlocked(session.sessionToken);
    if (next === "remnants") {
      router.replace("/stock");
      return;
    }
    if (next === "settings") {
      router.replace("/settings");
      return;
    }
    setGate("ready");
  }, [router]);

  const requireLogin = useCallback(() => {
    clearAuthSession();
    setSpecialist(null);
    setGate("login");
  }, []);

  const resolveGateFromSession = useCallback(async (roster: StoreSpecialist[]) => {
    const session = readAuthSession();
    if (!session || isAuthSessionExpired(session)) {
      clearAuthSession();
      setSpecialist(null);
      setGate("login");
      return;
    }

    const matched =
      syncActiveSpecialistFromRoster(roster) ?? session.specialist;
    updateAuthSessionSpecialist(matched);
    const refreshed = readAuthSession() ?? session;

    if (needsCredentialSetup(matched) || matched.must_change_credentials) {
      setSpecialist(matched);
      setGate("setup");
      return;
    }

    // Hub UI session alone is not enough for Store Ops — require a live
    // Supabase Auth JWT (minted by Hub PIN bridge or phone recovery).
    const supabase = getSupabase();
    const { data: authData } = supabase
      ? await supabase.auth.getSession()
      : { data: { session: null } };
    if (!authData.session?.access_token) {
      setSpecialist(matched);
      setGate("unlock");
      return;
    }

    touchAuthSession();
    markWorkspaceUnlocked(refreshed.sessionToken);
    setSpecialist(matched);
    setGate("ready");
  }, []);

  const loadStoreData = useCallback(async () => {
    const team = await fetchSpecialists();
    const roster = dedupeRoster(team);
    setSpecialists(roster);
    setRosterReady(true);
    return roster;
  }, []);

  const loadInventoryForSection = useCallback(async (next: HubSection) => {
    const tasks: Promise<void>[] = [];
    if (sectionNeedsCatalog(next)) {
      tasks.push(fetchCatalog().then((cat) => setCatalog(cat)));
    }
    if (sectionNeedsRemnants(next)) {
      tasks.push(fetchRemnants().then((rem) => setRemnants(rem)));
    }
    if (sectionNeedsApplianceCatalog(next)) {
      tasks.push(
        fetchApplianceCatalog().then((items) => setApplianceCatalog(items))
      );
    }
    if (tasks.length === 0) return;
    await Promise.all(tasks);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const roster = await loadStoreData();
      if (cancelled) return;
      resolveGateFromSession(roster);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadStoreData, resolveGateFromSession]);

  useEffect(() => {
    function onStoreChanged(event: Event) {
      const detail = (event as CustomEvent<string>).detail;
      const nextStore = detail || getStoreNumber();
      setStoreNumberState(nextStore);
      // Single session: changing store number must NOT force re-login.
      const session = readAuthSession();
      if (session) {
        const updated = updateAuthSessionSpecialist({
          ...session.specialist,
          store_number: nextStore,
        });
        if (updated) {
          markWorkspaceUnlocked(updated.sessionToken);
          setSpecialist(updated.specialist);
        }
      }
      void loadStoreData();
    }
    window.addEventListener(STORE_CHANGED_EVENT, onStoreChanged);
    return () => window.removeEventListener(STORE_CHANGED_EVENT, onStoreChanged);
  }, [loadStoreData]);

  // Inactivity watchdog — after 8h idle, require full login (app-level only).
  useEffect(() => {
    if (gate !== "ready") return;

    function onActivity() {
      const next = touchAuthSession();
      if (!next) {
        requireLogin();
      }
    }

    const events = ["pointerdown", "keydown", "touchstart", "visibilitychange"] as const;
    for (const evt of events) {
      window.addEventListener(evt, onActivity, { passive: true });
    }

    const timer = window.setInterval(() => {
      const session = readAuthSession();
      if (!session || isAuthSessionExpired(session)) {
        requireLogin();
      }
    }, 60_000);

    return () => {
      for (const evt of events) {
        window.removeEventListener(evt, onActivity);
      }
      window.clearInterval(timer);
    };
  }, [gate, requireLogin]);

  useEffect(() => {
    document.body.style.overflow =
      gate !== "ready" || specialistOpen || changePinOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [gate, specialistOpen, changePinOpen]);

  function upsertSpecialist(member: StoreSpecialist) {
    setSpecialists((prev) => dedupeRoster([member, ...prev]));
  }

  function handleAuthenticated(member: StoreSpecialist) {
    // Adopt profile store when device store is unset — never invent a default.
    const active = getStoreNumber();
    const profileStore = String(member.store_number ?? "").trim();
    let nextMember = member;
    if (!active && profileStore) {
      const saved = setStoreNumber(profileStore);
      setStoreNumberState(saved);
      nextMember = { ...member, store_number: saved };
    } else if (active) {
      nextMember = { ...member, store_number: active };
      setStoreNumberState(active);
    }
    upsertSpecialist(nextMember);
    startAuthSession(nextMember);
    unlockWorkspace(nextMember);
  }

  function handleSelectSpecialist(member: StoreSpecialist) {
    upsertSpecialist(member);
    startAuthSession(member);
    unlockWorkspace(member);
    setSpecialistOpen(false);
  }

  function handleSpecialistUpdated(member: StoreSpecialist) {
    upsertSpecialist(member);
    updateAuthSessionSpecialist(member);
    setSpecialist(member);
    setChangePinOpen(false);
    if (needsCredentialSetup(member)) {
      setGate("setup");
      return;
    }
    setGate("ready");
    setPinToast(true);
    window.setTimeout(() => setPinToast(false), 2500);
  }

  function handleLogout() {
    requireLogin();
    setSpecialistOpen(false);
    setChangePinOpen(false);
  }

  function handleSectionSelect(next: HubSection) {
    if (next === "catalog") {
      next = "appliances";
    }
    if (next === "remnants") {
      router.push("/stock");
      return;
    }
    if (next === "settings") {
      router.push("/settings");
      return;
    }
    if (!canAccessSection(specialist, next)) return;
    blurActiveInput();
    touchAuthSession();
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("section", next);
      window.history.replaceState({}, "", url.pathname + url.search);
    }
    startTransition(() => {
      setSection(next);
      setVisitedSections((prev) => {
        if (prev.has(next)) return prev;
        const copy = new Set(prev);
        copy.add(next);
        return copy;
      });
    });
  }

  const dept = effectiveDepartment(specialist);
  const authenticated = gate === "ready" && specialist != null;
  const associateSession = isAssociate(specialist);
  const activeSection =
    section === "catalog"
      ? "appliances"
      : associateSession && section === "settings"
        ? defaultSectionForMember(specialist)
        : section;

  useEffect(() => {
    if (gate !== "ready") return;
    void loadInventoryForSection(activeSection);
  }, [gate, activeSection, storeNumber, loadInventoryForSection]);

  useEffect(() => {
    if (gate !== "ready") return;
    setVisitedSections((prev) => {
      if (prev.has(activeSection)) return prev;
      const next = new Set(prev);
      next.add(activeSection);
      return next;
    });
  }, [gate, activeSection]);

  useEffect(() => {
    async function onOnline() {
      const synced = await flushSyncQueue();
      if (synced > 0) {
        setSyncToast(
          `🟢 Connected! Synced ${synced} offline action${synced === 1 ? "" : "s"} to store database.`
        );
        window.setTimeout(() => setSyncToast(null), 4000);
        await loadStoreData();
        if (gate === "ready") {
          await loadInventoryForSection(activeSection);
        }
      }
    }
    window.addEventListener("online", onOnline);
    if (navigator.onLine) {
      void onOnline();
    }
    return () => window.removeEventListener("online", onOnline);
  }, [loadStoreData, loadInventoryForSection, gate, activeSection]);

  // Zero-access wall — hide all workspace chrome until auth succeeds.
  if (gate === "booting" || !rosterReady) {
    return <HubBootFallback />;
  }

  if (gate === "login" || gate === "setup" || gate === "unlock") {
    return (
      <AuthWall
        mode={gate}
        roster={specialists}
        member={specialist}
        onAuthenticated={handleAuthenticated}
        onRequestFullLogin={
          gate === "unlock"
            ? () => {
                requireLogin();
              }
            : undefined
        }
      />
    );
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <NavigationHub
        title={sectionTitle(activeSection, specialist)}
        specialist={specialist}
        onOpenSpecialist={() => setSpecialistOpen(true)}
        onChangePin={specialist ? () => setChangePinOpen(true) : undefined}
        onLogout={handleLogout}
        storeNumber={storeNumber}
      />
      <SpecialistModal
        open={specialistOpen}
        active={specialist}
        onClose={() => setSpecialistOpen(false)}
        onSelect={handleSelectSpecialist}
      />
      <ChangePinModal
        key={changePinOpen ? `change-pin-${specialist?.id}` : "change-pin-closed"}
        open={changePinOpen}
        member={specialist}
        onClose={() => setChangePinOpen(false)}
        onUpdated={handleSpecialistUpdated}
      />

      {pinToast && (
        <p
          role="status"
          className="fixed inset-x-0 top-20 z-[56] mx-auto w-fit max-w-sm rounded-xl border border-emerald-500/40 bg-emerald-950/95 px-4 py-2 text-center text-sm font-semibold text-emerald-200 shadow-lg"
        >
          ✅ Credentials updated successfully!
        </p>
      )}

      {syncToast && (
        <p
          role="status"
          className="fixed inset-x-0 top-20 z-[56] mx-auto max-w-sm rounded-xl border border-emerald-500/40 bg-emerald-950/95 px-4 py-2 text-center text-sm font-semibold text-emerald-200 shadow-lg"
        >
          {syncToast}
        </p>
      )}

      {authenticated ? (
        <>
          <div className="mx-auto w-full max-w-md flex-1 overflow-x-hidden px-3 py-2 pb-28">
            <AssociateSpecialtySwitcher
              active={activeSection}
              onSelect={handleSectionSelect}
              specialist={specialist}
            />
            {visitedSections.has("audit") &&
              canAccessSection(specialist, "audit") && (
                <HubPane show={activeSection === "audit"}>
                  <CycleAuditSection
                    catalog={catalog}
                    onCatalogChange={setCatalog}
                    auditedBy={specialist?.name ?? ""}
                    specialists={specialists}
                    activeSpecialist={specialist}
                    remnants={remnants}
                    onRemnantsChange={setRemnants}
                    scannerEnabled={activeSection === "audit"}
                  />
                </HubPane>
              )}
            {visitedSections.has("remnants") &&
              canAccessSection(specialist, "remnants") && (
                <HubPane show={activeSection === "remnants"}>
                  <RemnantSection
                    catalog={catalog}
                    remnants={remnants}
                    onRemnantsChange={setRemnants}
                    loggedBy={specialist?.name ?? ""}
                    specialists={specialists}
                    activeSpecialist={specialist}
                  />
                </HubPane>
              )}
            {visitedSections.has("appliances") &&
              canAccessSection(specialist, "appliances") && (
                <HubPane show={activeSection === "appliances"}>
                  <ApplianceAuditSection
                    catalog={applianceCatalog}
                    onCatalogChange={setApplianceCatalog}
                    scannedBy={specialist?.name ?? ""}
                    activeSpecialist={specialist}
                    scannerEnabled={activeSection === "appliances"}
                  />
                </HubPane>
              )}
            {visitedSections.has("department") &&
              canAccessSection(specialist, "department") &&
              isGenericDepartment(dept) && (
                <HubPane show={activeSection === "department"}>
                  <DepartmentAuditSection
                    department={dept}
                    catalog={catalog}
                    onCatalogChange={setCatalog}
                    auditedBy={specialist?.name ?? ""}
                    activeSpecialist={specialist}
                    scannerEnabled={activeSection === "department"}
                  />
                </HubPane>
              )}
            {!associateSession &&
              visitedSections.has("settings") &&
              canAccessSection(specialist, "settings") && (
                <HubPane show={activeSection === "settings"}>
                  <SettingsSection
                    catalogCount={catalog.length}
                    remnantCount={remnants.length}
                    activeSpecialist={specialist}
                    specialists={specialists}
                    onSpecialistUpdated={handleSpecialistUpdated}
                    onRosterChange={(roster) => setSpecialists(dedupeRoster(roster))}
                    onOpenChangePin={() => setChangePinOpen(true)}
                    storeNumber={storeNumber}
                    onStoreNumberChange={setStoreNumberState}
                  />
                </HubPane>
              )}
          </div>
        </>
      ) : null}
    </div>
  );
}
