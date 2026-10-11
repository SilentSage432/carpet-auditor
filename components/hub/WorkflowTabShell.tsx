"use client";

/**
 * Keep-alive shell for Overview · Map · This Week · Walkthroughs · More.
 * PERF-LOAD-002: visit-on-demand first mount, then keep-alive after visit.
 * Team (/roster) remains a secondary More route during RD-1.
 */

import { usePathname, useRouter } from "next/navigation";
import { Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { ChangePinModal } from "@/components/hub/ChangePinModal";
import { NavigationHub } from "@/components/hub/NavigationHub";
import { SpecialtyToolsHost } from "@/components/hub/SpecialtyToolsHost";
import { FloorTab } from "@/components/hub/tabs/FloorTab";
import { MapTab } from "@/components/hub/tabs/MapTab";
import { OverviewTab } from "@/components/hub/tabs/OverviewTab";
import { RosterTab } from "@/components/hub/tabs/RosterTab";
import { SettingsTab } from "@/components/hub/tabs/SettingsTab";
import { WalkthroughsTab } from "@/components/hub/tabs/WalkthroughsTab";
import type { WorkflowTabProps } from "@/components/hub/tabs/tab-props";
import { updateAuthSessionSpecialist } from "@/lib/auth-session";
import {
  canAccessWorkflowTab,
  homeHrefForSpecialist,
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
import {
  reconcileVisitedTabs,
  seedVisitedTabs,
  visitedSetsEqual,
} from "@/lib/workflow-tab-visit";

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

function primaryVisitKey(
  active: NonNullable<ReturnType<typeof workflowTabFromPathname>>
): WorkflowTabHref {
  if (active === "/roster") return "/settings";
  return active;
}

export function WorkflowTabShell(props: WorkflowTabProps) {
  const pathname = usePathname() || "/overview";
  const router = useRouter();
  const { viewSpecialist } = useDevSandbox(props.specialist);
  const viewPreview = viewSpecialist ?? props.specialist;
  const resolved =
    workflowTabFromPathname(pathname) ?? homeHrefForSpecialist(viewPreview);
  const active = resolved;
  const visitKey = primaryVisitKey(active);
  const [storeNumber, setStore] = useState(props.storeNumber);
  const [member, setMember] = useState<StoreSpecialist>(props.specialist);
  const [changePinOpen, setChangePinOpen] = useState(false);
  const [rosterVisited, setRosterVisited] = useState(active === "/roster");
  const view = viewSpecialist ?? member;
  const working = useWorkingDepartment(view);
  const allowedTabs = useMemo(
    () =>
      PRIMARY_WORKFLOW_TAB_HREFS.filter((href) =>
        canAccessWorkflowTab(view, href)
      ),
    [view]
  );
  const [visited, setVisited] = useState<Set<WorkflowTabHref>>(() =>
    seedVisitedTabs(visitKey, allowedTabs)
  );

  useEffect(() => {
    if (!canAccessWorkflowTab(view, active)) {
      router.replace(homeHrefForSpecialist(view));
    }
  }, [active, router, view]);

  useEffect(() => {
    if (active === "/roster") setRosterVisited(true);
  }, [active]);

  useEffect(() => {
    setVisited((prev) => {
      const next = reconcileVisitedTabs(prev, visitKey, allowedTabs);
      return visitedSetsEqual(prev, next) ? prev : next;
    });
  }, [visitKey, allowedTabs]);

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
    <div className="hub-app-shell hub-floor-command flex h-dvh max-h-dvh flex-col overflow-hidden">
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
        {visited.has("/overview") && canAccessWorkflowTab(view, "/overview") ? (
          <KeepAlivePanel active={active === "/overview"}>
            <OverviewTab {...tabProps} />
          </KeepAlivePanel>
        ) : null}
        {visited.has("/admin/store-map") ? (
          <KeepAlivePanel active={active === "/admin/store-map"}>
            <Suspense fallback={null}>
              <MapTab {...tabProps} />
            </Suspense>
          </KeepAlivePanel>
        ) : null}
        {visited.has("/dashboard") ? (
          <KeepAlivePanel active={active === "/dashboard"}>
            <FloorTab {...tabProps} />
          </KeepAlivePanel>
        ) : null}
        {visited.has("/walkthroughs") &&
        canAccessWorkflowTab(view, "/walkthroughs") ? (
          <KeepAlivePanel active={active === "/walkthroughs"}>
            <WalkthroughsTab {...tabProps} />
          </KeepAlivePanel>
        ) : null}
        {rosterVisited && canAccessWorkflowTab(view, "/roster") ? (
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
