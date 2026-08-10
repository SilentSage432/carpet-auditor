"use client";

import { useCallback, useEffect, useState } from "react";
import { AuthWall, type AuthWallMode } from "@/components/auth/AuthWall";
import { ChangePinModal } from "@/components/hub/ChangePinModal";
import { BottomNavBar } from "@/components/hub/HubChrome";
import { NavigationHub } from "@/components/hub/NavigationHub";
import { SpecialistModal } from "@/components/hub/SpecialistModal";
import { CatalogSection } from "@/components/sections/CatalogSection";
import { CycleAuditSection } from "@/components/sections/CycleAuditSection";
import { ApplianceAuditSection } from "@/components/sections/ApplianceAuditSection";
import { RemnantSection } from "@/components/sections/RemnantSection";
import { SettingsSection } from "@/components/sections/SettingsSection";
import { DepartmentAuditSection } from "@/components/sections/DepartmentAuditSection";
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
import { fetchCatalog } from "@/lib/catalog";
import { fetchRemnants } from "@/lib/remnants";
import {
  canAccessSection,
  catalogDomainForMember,
  defaultSectionForMember,
  effectiveDepartment,
  isGenericDepartment,
  sectionTitle,
} from "@/lib/rbac";
import {
  dedupeRoster,
  fetchSpecialists,
  needsCredentialSetup,
  syncActiveSpecialistFromRoster,
} from "@/lib/specialists";
import { getStoreNumber, STORE_CHANGED_EVENT } from "@/lib/store";
import { flushSyncQueue } from "@/lib/sync-queue";
import type {
  CatalogItem,
  HubSection,
  Remnant,
  StoreSpecialist,
} from "@/lib/types";

type Gate = "booting" | AuthWallMode | "ready";

export default function DeptSyncHubPage() {
  const [section, setSection] = useState<HubSection>("audit");
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [remnants, setRemnants] = useState<Remnant[]>([]);
  const [specialist, setSpecialist] = useState<StoreSpecialist | null>(null);
  const [specialists, setSpecialists] = useState<StoreSpecialist[]>([]);
  const [specialistOpen, setSpecialistOpen] = useState(false);
  const [changePinOpen, setChangePinOpen] = useState(false);
  const [pinToast, setPinToast] = useState(false);
  const [syncToast, setSyncToast] = useState<string | null>(null);
  const [storeNumber, setStoreNumberState] = useState(() =>
    typeof window === "undefined" ? "1234" : getStoreNumber()
  );
  const [gate, setGate] = useState<Gate>("booting");
  const [rosterReady, setRosterReady] = useState(false);

  const unlockWorkspace = useCallback((member: StoreSpecialist) => {
    setSpecialist(member);
    setSection(defaultSectionForMember(member));
    if (needsCredentialSetup(member) || member.must_change_credentials) {
      setGate("setup");
      return;
    }
    const session = readAuthSession();
    if (session) markWorkspaceUnlocked(session.sessionToken);
    setGate("ready");
  }, []);

  const requireLogin = useCallback(() => {
    clearAuthSession();
    setSpecialist(null);
    setGate("login");
  }, []);

  const resolveGateFromSession = useCallback((roster: StoreSpecialist[]) => {
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

    // Single session: valid localStorage session → workspace (no PIN unlock).
    // Re-auth only on missing/expired session (cold start without session, logout, 8h idle).
    touchAuthSession();
    markWorkspaceUnlocked(refreshed.sessionToken);
    setSpecialist(matched);
    setGate("ready");
  }, []);

  const loadStoreData = useCallback(async () => {
    const [cat, rem, team] = await Promise.all([
      fetchCatalog(),
      fetchRemnants(),
      fetchSpecialists(),
    ]);
    const roster = dedupeRoster(team);
    setCatalog(cat);
    setRemnants(rem);
    setSpecialists(roster);
    setRosterReady(true);
    return roster;
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

  useEffect(() => {
    async function onOnline() {
      const synced = await flushSyncQueue();
      if (synced > 0) {
        setSyncToast(
          `🟢 Connected! Synced ${synced} offline action${synced === 1 ? "" : "s"} to store database.`
        );
        window.setTimeout(() => setSyncToast(null), 4000);
        await loadStoreData();
      }
    }
    window.addEventListener("online", onOnline);
    if (navigator.onLine) {
      void onOnline();
    }
    return () => window.removeEventListener("online", onOnline);
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
    upsertSpecialist(member);
    startAuthSession(member);
    unlockWorkspace(member);
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
    if (!canAccessSection(specialist, next)) return;
    blurActiveInput();
    touchAuthSession();
    setSection(next);
  }

  const catalogDomain = catalogDomainForMember(specialist);
  const dept = effectiveDepartment(specialist);
  const authenticated = gate === "ready" && specialist != null;

  // Zero-access wall — hide all workspace chrome until auth succeeds.
  if (gate === "booting" || !rosterReady) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-slate-950 px-4">
        <p className="text-sm font-semibold text-slate-400">
          Loading DeptSync secure session…
        </p>
      </div>
    );
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
        title={sectionTitle(section, specialist)}
        specialist={specialist}
        onOpenSpecialist={() => setSpecialistOpen(true)}
        onChangePin={specialist ? () => setChangePinOpen(true) : undefined}
        onLogout={handleLogout}
        storeNumber={storeNumber}
        showBottomNav={false}
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
          <div
            className={`mx-auto w-full max-w-md flex-1 overflow-x-hidden px-4 py-4 ${
              section === "audit" ||
              section === "appliances" ||
              section === "department"
                ? "pb-44"
                : "pb-32"
            }`}
          >
            {section === "audit" && canAccessSection(specialist, "audit") && (
              <CycleAuditSection
                catalog={catalog}
                onCatalogChange={setCatalog}
                auditedBy={specialist?.name ?? ""}
                specialists={specialists}
                activeSpecialist={specialist}
              />
            )}
            {section === "catalog" && canAccessSection(specialist, "catalog") && (
              <CatalogSection
                catalog={catalog}
                onCatalogChange={setCatalog}
                domainFilter={catalogDomain}
              />
            )}
            {section === "remnants" &&
              canAccessSection(specialist, "remnants") && (
                <RemnantSection
                  catalog={catalog}
                  remnants={remnants}
                  onRemnantsChange={setRemnants}
                  loggedBy={specialist?.name ?? ""}
                  specialists={specialists}
                  activeSpecialist={specialist}
                />
              )}
            {section === "appliances" &&
              canAccessSection(specialist, "appliances") && (
                <ApplianceAuditSection
                  catalog={catalog}
                  onCatalogChange={setCatalog}
                  auditedBy={specialist?.name ?? ""}
                  activeSpecialist={specialist}
                />
              )}
            {section === "department" &&
              canAccessSection(specialist, "department") &&
              isGenericDepartment(dept) && (
                <DepartmentAuditSection
                  department={dept}
                  catalog={catalog}
                  onCatalogChange={setCatalog}
                  auditedBy={specialist?.name ?? ""}
                  activeSpecialist={specialist}
                />
              )}
            {section === "settings" &&
              canAccessSection(specialist, "settings") && (
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
              )}
          </div>

          <BottomNavBar
            active={section}
            onSelect={handleSectionSelect}
            specialist={specialist}
          />
        </>
      ) : null}
    </div>
  );
}
