"use client";

/**
 * Specialty hub `/` — SEC-OPS-007G: JWT-first roster bootstrap (never anon
 * store_specialists). Fail-closed via decideHubPageBoot / AccessGate table.
 */

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ChangePinModal } from "@/components/hub/ChangePinModal";
import { AssociateSpecialtySwitcher } from "@/components/hub/HubChrome";
import { SpecialtyToolsPanel } from "@/components/hub/SpecialtyToolsPanel";
import { SpecialistModal } from "@/components/hub/SpecialistModal";
import {
  canFetchProtectedRoster,
  decideHubPageBoot,
} from "@/lib/auth/hub-page-bootstrap";
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
import { homeHrefForSpecialist } from "@/lib/nav-hub";
import {
  canAccessSection,
  effectiveDepartment,
  isGenericDepartment,
  isSimplifiedAssociateView,
  sectionTitle,
} from "@/lib/rbac";
import {
  dedupeRoster,
  fetchSpecialists,
  needsCredentialSetup,
  syncActiveSpecialistFromRoster,
} from "@/lib/specialists";
import {
  adoptStoreNumberFromSpecialist,
  getStoreNumber,
  setStoreNumber,
  STORE_CHANGED_EVENT,
} from "@/lib/store";
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
import { shouldStayOnSpecialtyHub } from "@/lib/nav-hub";
import { useDevSandbox } from "@/lib/use-dev-sandbox";
import { useWorkingDepartment } from "@/lib/use-working-department";

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
  const bootGenRef = useRef(0);
  const { viewSpecialist } = useDevSandbox(specialist);
  const viewMember = viewSpecialist ?? specialist;
  const working = useWorkingDepartment(viewMember);

  const unlockWorkspace = useCallback((member: StoreSpecialist) => {
    setSpecialist(member);
    const fromQuery =
      typeof window !== "undefined"
        ? parseHubSectionParam(
            new URLSearchParams(window.location.search).get("section")
          )
        : null;
    if (needsCredentialSetup(member) || member.must_change_credentials) {
      setGate("setup");
      return;
    }
    const session = readAuthSession();
    if (session) markWorkspaceUnlocked(session.sessionToken);
    if (fromQuery === "remnants" || fromQuery === "settings") {
      router.replace(fromQuery === "settings" ? "/settings" : "/dashboard");
      return;
    }
    // REDUCE-004: specialty hub sections no longer stay as an everyday product.
    if (fromQuery && shouldStayOnSpecialtyHub(fromQuery)) {
      router.replace(homeHrefForSpecialist(member));
      return;
    }
    router.replace(homeHrefForSpecialist(member));
  }, [router]);

  const requireLogin = useCallback(() => {
    clearAuthSession();
    setSpecialist(null);
    setSpecialists([]);
    setRosterReady(true);
    setGate("login");
    window.location.replace("/login");
  }, []);

  /** Authenticated roster refresh only — never PostgREST as anon. */
  const loadStoreData = useCallback(async () => {
    const supabase = getSupabase();
    let hasJwt = false;
    try {
      const { data } = supabase
        ? await supabase.auth.getSession()
        : { data: { session: null } };
      hasJwt = Boolean(data.session?.access_token);
    } catch {
      hasJwt = false;
    }
    if (!canFetchProtectedRoster(hasJwt)) {
      setRosterReady(true);
      return [] as StoreSpecialist[];
    }
    try {
      const team = await fetchSpecialists();
      const roster = dedupeRoster(team);
      setSpecialists(roster);
      setRosterReady(true);
      return roster;
    } catch (err) {
      console.error("[loadStoreData] authorized roster fetch failed", err);
      setRosterReady(true);
      return [] as StoreSpecialist[];
    }
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
    const bootGen = ++bootGenRef.current;
    let cancelled = false;
    const stillActive = () => !cancelled && bootGenRef.current === bootGen;

    void (async () => {
      try {
        const session = readAuthSession();
        const expired = Boolean(session && isAuthSessionExpired(session));

        if (!session || expired) {
          const outcome = decideHubPageBoot({
            session,
            sessionExpired: expired,
            hasJwt: false,
            roster: null,
            rosterError: null,
            matched: null,
            needsSetup: false,
          });
          if (!stillActive()) return;
          if (outcome.clearHubSession) clearAuthSession();
          setSpecialists([]);
          setSpecialist(null);
          setRosterReady(true);
          setGate("login");
          window.location.replace("/login");
          return;
        }

        const supabase = getSupabase();
        let hasJwt = false;
        try {
          const { data } = supabase
            ? await supabase.auth.getSession()
            : { data: { session: null } };
          if (!stillActive()) return;
          hasJwt = Boolean(data.session?.access_token);
        } catch {
          if (!stillActive()) return;
          hasJwt = false;
        }

        let team: StoreSpecialist[] | null = null;
        let rosterError: unknown | null = null;
        if (canFetchProtectedRoster(hasJwt)) {
          try {
            team = dedupeRoster(await fetchSpecialists());
          } catch (err) {
            rosterError = err;
            team = null;
          }
        } else {
          team = [];
        }
        if (!stillActive()) return;

        const matched =
          (hasJwt && team
            ? syncActiveSpecialistFromRoster(team)
            : null) ?? session.specialist;

        const outcome = decideHubPageBoot({
          session,
          sessionExpired: false,
          hasJwt,
          roster: team,
          rosterError,
          matched,
          needsSetup:
            needsCredentialSetup(matched) ||
            Boolean(matched.must_change_credentials),
        });

        if (!stillActive()) return;

        if (outcome.clearHubSession) clearAuthSession();
        if (outcome.clearSupabaseLocal) {
          const client = getSupabase();
          if (client) {
            void client.auth.signOut({ scope: "local" });
          }
        }

        setSpecialists(outcome.roster);
        setRosterReady(true);

        if (outcome.member && outcome.mode !== "login") {
          updateAuthSessionSpecialist(outcome.member);
        }

        if (outcome.mode === "enter" && outcome.member) {
          const adopted = adoptStoreNumberFromSpecialist(
            outcome.member.store_number
          );
          const withStore = adopted
            ? { ...outcome.member, store_number: adopted }
            : outcome.member;
          if (adopted) setStoreNumberState(adopted);
          setSpecialist(withStore);
          touchAuthSession();
          const refreshed = readAuthSession();
          if (refreshed) markWorkspaceUnlocked(refreshed.sessionToken);
          try {
            unlockWorkspace(withStore);
            if (!stillActive()) return;
            // Redirect may not unmount immediately — never stay booting.
            setGate((current) => (current === "booting" ? "unlock" : current));
          } catch {
            if (!stillActive()) return;
            setGate("unlock");
          }
          return;
        }

        setSpecialist(outcome.member);
        if (
          outcome.mode === "login" ||
          outcome.mode === "unlock" ||
          outcome.mode === "setup"
        ) {
          setGate(outcome.mode);
          if (outcome.mode === "login") {
            window.location.replace("/login");
          }
          return;
        }
        setGate("unlock");
      } catch {
        if (!stillActive()) return;
        setSpecialists([]);
        setSpecialist(null);
        setRosterReady(true);
        setGate("login");
        window.location.replace("/login");
      }
    })();

    return () => {
      cancelled = true;
      bootGenRef.current += 1;
    };
  }, [unlockWorkspace]);

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
      router.push("/settings#remnants");
      return;
    }
    if (next === "settings") {
      router.push("/settings");
      return;
    }
    if (!canAccessSection(viewMember, next)) return;
    blurActiveInput();
    touchAuthSession();
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("section", next);
      window.history.replaceState({}, "", url.pathname + url.search);
    }
    setSection(next);
    setVisitedSections((prev) => {
      if (prev.has(next)) return prev;
      const copy = new Set(prev);
      copy.add(next);
      return copy;
    });
  }

  const deptHome = effectiveDepartment(viewMember);
  const dept = isGenericDepartment(working) ? working : deptHome;
  const authenticated = gate === "ready" && specialist != null;
  const activeSection =
    section === "catalog" ? "appliances" : section;

  useEffect(() => {
    if (gate !== "ready") return;
    void loadInventoryForSection(activeSection);
  }, [gate, activeSection, storeNumber, loadInventoryForSection]);

  useEffect(() => {
    function onPopState() {
      const next = parseHubSectionParam(
        new URLSearchParams(window.location.search).get("section")
      );
      // REDUCE-004: specialty hub deep links leave everyday product for Floor.
      if (next && shouldStayOnSpecialtyHub(next)) {
        window.location.replace("/dashboard");
      }
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

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
    <div className="hub-app-shell flex h-dvh max-h-dvh flex-col overflow-hidden">
      <div className="hub-app-header shrink-0">
        <NavigationHub
          title={sectionTitle(activeSection, viewMember)}
          specialist={viewMember}
          sandboxActor={specialist}
          onOpenSpecialist={() => setSpecialistOpen(true)}
          onChangePin={specialist ? () => setChangePinOpen(true) : undefined}
          onLogout={handleLogout}
          storeNumber={storeNumber}
        />
      </div>
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
          <div className="hub-app-workspace mx-auto min-h-0 w-full max-w-lg flex-1 overflow-x-hidden overflow-y-auto overscroll-y-contain px-3 py-2 hub-scan-dock-pad">
            {!isSimplifiedAssociateView(viewMember) ? (
              <AssociateSpecialtySwitcher
                active={activeSection}
                onSelect={handleSectionSelect}
                specialist={viewMember}
              />
            ) : null}
            <SpecialtyToolsPanel specialist={viewMember} />
            {visitedSections.has("audit") &&
              canAccessSection(viewMember, "audit") && (
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
            {visitedSections.has("appliances") &&
              canAccessSection(viewMember, "appliances") && (
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
              canAccessSection(viewMember, "department") &&
              isGenericDepartment(dept) && (
                <HubPane show={activeSection === "department"}>
                  <DepartmentAuditSection
                    key={dept}
                    department={dept}
                    catalog={catalog}
                    onCatalogChange={setCatalog}
                    auditedBy={specialist?.name ?? ""}
                    activeSpecialist={specialist}
                    scannerEnabled={activeSection === "department"}
                  />
                </HubPane>
              )}
          </div>
        </>
      ) : null}
    </div>
  );
}
