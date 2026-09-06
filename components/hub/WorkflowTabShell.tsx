"use client";

/**
 * Keep-alive shell for Floor / Map / Roster / More.
 * All primary tabs stay mounted; switches use opacity/visibility (no remount).
 * URL still updates via BottomNav Links.
 */

import { usePathname, useRouter } from "next/navigation";
import { Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { ChangePinModal } from "@/components/hub/ChangePinModal";
import { NavigationHub } from "@/components/hub/NavigationHub";
import { SpecialtyToolsHost } from "@/components/hub/SpecialtyToolsHost";
import { FloorTab } from "@/components/hub/tabs/FloorTab";
import { MapTab } from "@/components/hub/tabs/MapTab";
import { RosterTab } from "@/components/hub/tabs/RosterTab";
import { SettingsTab } from "@/components/hub/tabs/SettingsTab";
import type { WorkflowTabProps } from "@/components/hub/tabs/tab-props";
import { updateAuthSessionSpecialist } from "@/lib/auth-session";
import {
  canAccessWorkflowTab,
  PRIMARY_WORKFLOW_TAB_HREFS,
  workflowTabFromPathname,
  workflowTabTitle,
  type WorkflowTabHref,
} from "@/lib/nav-hub";
import { useDevSandbox } from "@/lib/use-dev-sandbox";
import { useWorkingDepartment } from "@/lib/use-working-department";
import { setStoreNumber } from "@/lib/store";
import {
  dedupeRoster,
  fetchSpecialists,
  syncActiveSpecialistFromRoster,
} from "@/lib/specialists";
import type { StoreSpecialist } from "@/lib/types";

/**
 * Per-tab scroll owner: absolute inset fills the constrained workspace so
 * overflow-y-auto always has a definite height (never grows past the shell).
 * Inactive panels stay mounted for keep-alive but do not receive input.
 */
function KeepAlivePanel({
  active,
  children,
}: {
  active: boolean;
  children: ReactNode;
}) {
  return (
    <div
      data-active={active ? "true" : "false"}
      aria-hidden={!active}
      inert={!active}
      className={`hub-tab-panel absolute inset-0 min-h-0 overflow-x-hidden overflow-y-auto overscroll-y-contain ${
        /* Ordinary panel content stays beneath BottomNav (z-30). Modal/sheet
         * surfaces must HubPortal to document.body to paint above the nav. */
        active ? "z-10" : "pointer-events-none z-0"
      }`}
    >
      {children}
    </div>
  );
}

export function WorkflowTabShell(props: WorkflowTabProps) {
  const pathname = usePathname() || "/dashboard";
  const router = useRouter();
  const active = workflowTabFromPathname(pathname) ?? "/dashboard";
  const [storeNumber, setStore] = useState(props.storeNumber);
  const [member, setMember] = useState<StoreSpecialist>(props.specialist);
  const [changePinOpen, setChangePinOpen] = useState(false);
  const { viewSpecialist } = useDevSandbox(member);
  const view = viewSpecialist ?? member;
  const working = useWorkingDepartment(view);
  const allowedTabs = useMemo(
    () =>
      PRIMARY_WORKFLOW_TAB_HREFS.filter((href) =>
        canAccessWorkflowTab(view, href)
      ),
    [view]
  );
  const [visited, setVisited] = useState<Set<WorkflowTabHref>>(
    () => new Set<WorkflowTabHref>(allowedTabs)
  );

  useEffect(() => {
    if (!canAccessWorkflowTab(view, active)) {
      router.replace("/dashboard");
    }
  }, [active, router, view]);

  useEffect(() => {
    setVisited((prev) => {
      if (!canAccessWorkflowTab(view, active)) return prev;
      if (prev.has(active)) return prev;
      const next = new Set(prev);
      next.add(active);
      return next;
    });
  }, [active, view]);

  useEffect(() => {
    setVisited((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const href of allowedTabs) {
        if (!next.has(href)) {
          next.add(href);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [allowedTabs]);

  useEffect(() => {
    setStore(props.storeNumber);
  }, [props.storeNumber]);

  useEffect(() => {
    setMember(props.specialist);
  }, [props.specialist]);

  useEffect(() => {
    let cancelled = false;
    void fetchSpecialists().then((team) => {
      if (cancelled) return;
      const synced = syncActiveSpecialistFromRoster(dedupeRoster(team));
      if (!synced) return;
      updateAuthSessionSpecialist(synced);
      setMember(synced);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const tabProps: WorkflowTabProps = {
    ...props,
    specialist: view,
    storeNumber,
    onStoreNumberChange: (next) => {
      setStore(next);
      setStoreNumber(next);
      props.onStoreNumberChange?.(next);
    },
    onChangePin: () => setChangePinOpen(true),
  };

  function handleUpdated(next: StoreSpecialist) {
    updateAuthSessionSpecialist(next);
    setMember(next);
    setChangePinOpen(false);
  }

  return (
    <div className="hub-app-shell flex h-dvh max-h-dvh flex-col overflow-hidden">
      <div className="hub-app-header shrink-0">
        <NavigationHub
          title={workflowTabTitle(active, view, working)}
          specialist={view}
          sandboxActor={member}
          storeNumber={storeNumber}
          onLogout={props.logout}
          onChangePin={() => setChangePinOpen(true)}
        />
      </div>
      <ChangePinModal
        key={changePinOpen ? `pin-${member.id}` : "pin-closed"}
        open={changePinOpen}
        member={member}
        onClose={() => setChangePinOpen(false)}
        onUpdated={handleUpdated}
      />
      {/* Outside keep-alive `inert` panels so More utilities can open tools. */}
      <SpecialtyToolsHost specialist={view} storeNumber={storeNumber} />
      <div className="hub-app-workspace relative min-h-0 flex-1">
        <KeepAlivePanel active={active === "/dashboard"}>
          <FloorTab {...tabProps} />
        </KeepAlivePanel>
        {visited.has("/admin/store-map") ? (
          <KeepAlivePanel active={active === "/admin/store-map"}>
            <Suspense fallback={null}>
              <MapTab {...tabProps} />
            </Suspense>
          </KeepAlivePanel>
        ) : null}
        {visited.has("/roster") && canAccessWorkflowTab(view, "/roster") ? (
          <KeepAlivePanel active={active === "/roster"}>
            <RosterTab {...tabProps} />
          </KeepAlivePanel>
        ) : null}
        {visited.has("/settings") && canAccessWorkflowTab(view, "/settings") ? (
          <KeepAlivePanel active={active === "/settings"}>
            <SettingsTab {...tabProps} />
          </KeepAlivePanel>
        ) : null}
      </div>
    </div>
  );
}
