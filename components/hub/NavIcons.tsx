/**
 * Canonical Lucide vector icons for Navigation Hub + department-sync chrome.
 * Presentation only — route ownership stays in lib/nav-hub / lib/rbac.
 * Stroke weight is 2 everywhere so nav, status, and action glyphs match.
 */

import {
  AlertTriangle,
  Building2,
  Camera,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  ClipboardList,
  Clock,
  Construction,
  Crown,
  Flag,
  FlagOff,
  Hand,
  LayoutGrid,
  Lock,
  LogOut,
  Map,
  MoreHorizontal,
  NotebookPen,
  RefreshCw,
  Settings,
  ShieldCheck,
  Smartphone,
  User,
  Users,
  Wifi,
  WifiOff,
  Wrench,
  X,
  Zap,
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

export type HubIconId =
  | NavIconId
  | "close"
  | "chevronUp"
  | "chevronDown"
  | "chevronRight"
  | "wifi"
  | "wifiOff"
  | "zap"
  | "camera"
  | "refresh"
  | "clock"
  | "touch"
  | "flag"
  | "flagOff"
  | "crown"
  | "user"
  | "logOut";

const HUB_ICON_MAP: Record<HubIconId, LucideIcon> = {
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
  close: X,
  chevronUp: ChevronUp,
  chevronDown: ChevronDown,
  chevronRight: ChevronRight,
  wifi: Wifi,
  wifiOff: WifiOff,
  zap: Zap,
  camera: Camera,
  refresh: RefreshCw,
  clock: Clock,
  touch: Hand,
  flag: Flag,
  flagOff: FlagOff,
  crown: Crown,
  user: User,
  logOut: LogOut,
};

const DEFAULT_STROKE = 2;

export function HubIcon({
  id,
  className = "h-5 w-5",
  strokeWidth = DEFAULT_STROKE,
}: {
  id: HubIconId;
  className?: string;
  strokeWidth?: number;
}) {
  const Icon = HUB_ICON_MAP[id] ?? LayoutGrid;
  return (
    <Icon className={className} strokeWidth={strokeWidth} aria-hidden />
  );
}

/** Nav-scoped alias — same stroke and sizing as HubIcon. */
export function NavIcon({
  id,
  className = "h-5 w-5",
  strokeWidth = DEFAULT_STROKE,
}: {
  id: NavIconId;
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <HubIcon id={id} className={className} strokeWidth={strokeWidth} />
  );
}
