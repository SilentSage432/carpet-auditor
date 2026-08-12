/**
 * Shared Lucide icons for Navigation Hub + inventory bottom bars.
 * Presentation only — route ownership stays in lib/nav-hub / lib/rbac.
 */

import {
  AlertTriangle,
  Building2,
  CheckSquare,
  ClipboardList,
  Construction,
  LayoutGrid,
  Lock,
  Map,
  MoreHorizontal,
  NotebookPen,
  Settings,
  ShieldCheck,
  Smartphone,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";

export type NavIconId =
  | "map"
  | "users"
  | "alert"
  | "zebra"
  | "notes"
  | "settings"
  | "check"
  | "shield"
  | "building"
  | "tools"
  | "lock"
  | "more"
  | "home"
  | "barrier"
  | "grid";

const NAV_ICON_MAP: Record<NavIconId, LucideIcon> = {
  map: Map,
  users: Users,
  alert: AlertTriangle,
  zebra: Smartphone,
  notes: NotebookPen,
  settings: Settings,
  check: CheckSquare,
  shield: ShieldCheck,
  building: Building2,
  tools: Wrench,
  lock: Lock,
  more: MoreHorizontal,
  home: LayoutGrid,
  barrier: Construction,
  grid: ClipboardList,
};

export function NavIcon({
  id,
  className = "h-5 w-5",
  strokeWidth = 2,
}: {
  id: NavIconId;
  className?: string;
  strokeWidth?: number;
}) {
  const Icon = NAV_ICON_MAP[id] ?? LayoutGrid;
  return (
    <Icon className={className} strokeWidth={strokeWidth} aria-hidden />
  );
}
