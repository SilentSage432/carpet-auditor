"use client";

/**
 * Keep-alive shell for Floor / Map / Roster / Settings.
 * Primary tabs mount immediately so switches only toggle `hidden` (0ms).
 * URL still updates via BottomNav Links.
 */

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { ChangePinModal } from "@/components/hub/ChangePinModal";
import { NavigationHub } from "@/components/hub/NavigationHub";
import { FloorTab } from "@/components/hub/tabs/FloorTab";
import type { WorkflowTabProps } from "@/components/hub/tabs/tab-props";
import { updateAuthSessionSpecialist } from "@/lib/auth-session";
import {
  PRIMARY_WORKFLOW_TAB_HREFS,
  workflowTabFromPathname,
  workflowTabTitle,
  type WorkflowTabHref,
} from "@/lib/nav-hub";
import { setStoreNumber } from "@/lib/store";
import {
  dedupeRoster,
  fetchSpecialists,
  syncActiveSpecialistFromRoster,
} from "@/lib/specialists";
import type { StoreSpecialist } from "@/lib/types";

const MapTab = dynamic(
  () => import("@/components/hub/tabs/MapTab").then((mod) => mod.MapTab),
  { ssr: false }
);
const RosterTab = dynamic(
  () => import("@/components/hub/tabs/RosterTab").then((mod) => mod.RosterTab),
  { ssr: false }
);
const SettingsTab = dynamic(
  () =>
    import("@/components/hub/tabs/SettingsTab").then((mod) => mod.SettingsTab),
  { ssr: false }
);

function KeepAlivePanel({
  active,
  children,
}: {
  active: boolean;
  children: ReactNode;
}) {
  return (
    <div
      hidden={!active}
      aria-hidden={!active}
      className={active ? "min-h-0 flex-1 overflow-y-auto" : undefined}
    >
      {children}
    </div>
  );
}

export function WorkflowTabShell(props: WorkflowTabProps) {
  const pathname = usePathname() || "/dashboard";
  const active = workflowTabFromPathname(pathname) ?? "/dashboard";
  const [visited, setVisited] = useState<Set<WorkflowTabHref>>(
    () => new Set<WorkflowTabHref>(PRIMARY_WORKFLOW_TAB_HREFS)
  );
  const [storeNumber, setStore] = useState(props.storeNumber);
  const [member, setMember] = useState<StoreSpecialist>(props.specialist);
  const [changePinOpen, setChangePinOpen] = useState(false);

  useEffect(() => {
    setVisited((prev) => {
      if (prev.has(active)) return prev;
      const next = new Set(prev);
      next.add(active);
      return next;
    });
  }, [active]);

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
    specialist: member,
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
    <div className="flex min-h-dvh flex-col">
      <NavigationHub
        title={workflowTabTitle(active, member)}
        specialist={member}
        storeNumber={storeNumber}
        onLogout={props.logout}
        onChangePin={() => setChangePinOpen(true)}
      />
      <ChangePinModal
        key={changePinOpen ? `pin-${member.id}` : "pin-closed"}
        open={changePinOpen}
        member={member}
        onClose={() => setChangePinOpen(false)}
        onUpdated={handleUpdated}
      />
      <KeepAlivePanel active={active === "/dashboard"}>
        <FloorTab {...tabProps} />
      </KeepAlivePanel>
      {visited.has("/admin/store-map") ? (
        <KeepAlivePanel active={active === "/admin/store-map"}>
          <MapTab {...tabProps} />
        </KeepAlivePanel>
      ) : null}
      {visited.has("/roster") ? (
        <KeepAlivePanel active={active === "/roster"}>
          <RosterTab {...tabProps} />
        </KeepAlivePanel>
      ) : null}
      {visited.has("/settings") ? (
        <KeepAlivePanel active={active === "/settings"}>
          <SettingsTab {...tabProps} />
        </KeepAlivePanel>
      ) : null}
    </div>
  );
}
