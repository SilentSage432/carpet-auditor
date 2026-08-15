/**
 * Canonical Lucide vector icons for Navigation Hub + department-sync chrome.
 * Presentation only — route ownership stays in lib/nav-hub / lib/rbac.
 * Stroke weight is 2 everywhere so nav, status, and action glyphs match.
 * Color is currentColor — parent chrome (theme-nav-active / text-accent) owns the theme.
 */

import {
  AlertTriangle,
  Archive,
  BrickWall,
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
  DoorClosed,
  Droplets,
  Flag,
  FlagOff,
  Flower2,
  Hammer,
  Hand,
  Layers,
  LayoutGrid,
  Lightbulb,
  Lock,
  LogOut,
  Map,
  MoreHorizontal,
  MoreVertical,
  NotebookPen,
  Package,
  Paintbrush,
  Pencil,
  RefreshCw,
  Settings,
  ShieldCheck,
  Trash2,
  Trees,
  User,
  Users,
  Wifi,
  WifiOff,
  Wrench,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import {
  isDepartmentScope,
  type DepartmentScope,
} from "@/lib/types";

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
  | "grid"
  | "stock";

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
  | "logOut"
  | "moreVertical"
  | "edit"
  | "trash";

const HUB_ICON_MAP: Record<HubIconId, LucideIcon> = {
  map: Map,
  users: Users,
  alert: AlertTriangle,
  zebra: ClipboardList,
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
  stock: Package,
  moreVertical: MoreVertical,
  edit: Pencil,
  trash: Trash2,
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

const DEPARTMENT_LUCIDE: Record<DepartmentScope, LucideIcon> = {
  flooring: Layers,
  appliances: Zap,
  plumbing: Droplets,
  electrical: Lightbulb,
  lawn_garden: Trees,
  inside_garden: Flower2,
  outside_garden: Trees,
  paint: Paintbrush,
  millwork: DoorClosed,
  cabinets: Archive,
  building_materials: BrickWall,
  hardware: Hammer,
  tools: Wrench,
  all: Crown,
};

/** Lucide glyph for a hub department — cyan/gold via currentColor on the parent. */
export function DepartmentIcon({
  department,
  className = "h-4 w-4",
  strokeWidth = DEFAULT_STROKE,
}: {
  department: DepartmentScope | string | null | undefined;
  className?: string;
  strokeWidth?: number;
}) {
  const key =
    department && isDepartmentScope(department) ? department : "flooring";
  const Icon = DEPARTMENT_LUCIDE[key] ?? Layers;
  return (
    <Icon className={className} strokeWidth={strokeWidth} aria-hidden />
  );
}
