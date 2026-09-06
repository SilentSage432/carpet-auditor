/**
 * Specialty tool registry — appliance UPC audit scanner & carpet remnant calculator.
 * Presentation routes live here; scan/calc logic stays in section components.
 */

import { canAccessSection } from "@/lib/rbac";
import type { NavIconId } from "@/components/hub/NavIcons";
import type { HubSection, StoreSpecialist } from "@/lib/types";

export const APPLIANCE_SCANNER_HASH = "scan";
export const REMNANT_CALCULATOR_HASH = "remnants-calculator";
export const EXECUTIVE_FLOOR_PAD_HASH = "floor-pad";

/** Durable Floor handoff — survives soft nav and hard reload (UX-004C.1). */
export const EXECUTIVE_FLOOR_PAD_OPEN_PARAM = "open";
export const EXECUTIVE_FLOOR_PAD_OPEN_VALUE = "executive-floor-pad";

export const APPLIANCE_SCANNER_OPEN_EVENT = "deptsync:appliance-scanner-open";
export const REMNANT_CALCULATOR_OPEN_EVENT = "deptsync:remnant-calculator-open";
export const EXECUTIVE_FLOOR_PAD_OPEN_EVENT = "deptsync:executive-floor-pad-open";

const FLOOR_PAD_HASHES = new Set([
  EXECUTIVE_FLOOR_PAD_HASH,
  "manager-notes",
  "s-pen-notes",
]);

/** Bare Floor path after intent consumption (UX-004C.1). */
export const EXECUTIVE_FLOOR_PAD_BARE_HREF = "/dashboard";

export function buildExecutiveFloorPadHref(): string {
  return `${EXECUTIVE_FLOOR_PAD_BARE_HREF}?${EXECUTIVE_FLOOR_PAD_OPEN_PARAM}=${EXECUTIVE_FLOOR_PAD_OPEN_VALUE}`;
}

export function isExecutiveFloorPadOpenIntent(
  searchParams: URLSearchParams | { get(name: string): string | null }
): boolean {
  return (
    searchParams.get(EXECUTIVE_FLOOR_PAD_OPEN_PARAM) ===
    EXECUTIVE_FLOOR_PAD_OPEN_VALUE
  );
}

export function isExecutiveFloorPadHash(hash: string): boolean {
  return FLOOR_PAD_HASHES.has(hash.replace(/^#/, ""));
}

/** Floor command surface only — `/` is specialty scan hub, not Floor. */
export function isExecutiveFloorPadFloorPath(pathname: string): boolean {
  return pathname === "/dashboard" || pathname.startsWith("/dashboard/");
}

/**
 * Strip query/hash intent while preserving history.state (Map investigation pattern).
 * Call after dispatching the open event so listeners receive it before URL clears.
 */
export function syncExecutiveFloorPadIntentConsumedUrl(
  href: string = EXECUTIVE_FLOOR_PAD_BARE_HREF
): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (url.pathname === href && url.search === "" && url.hash === "") return;
  window.history.replaceState(window.history.state, "", href);
}

export type SpecialtyToolId = "appliance-scanner" | "remnant-calculator";

export type SpecialtyTool = {
  id: SpecialtyToolId;
  label: string;
  shortLabel: string;
  description: string;
  icon: NavIconId;
  /** Primary navigation target */
  href: string;
  /** RBAC gate — member must access this hub section */
  section: HubSection;
};

export const SPECIALTY_TOOLS: SpecialtyTool[] = [
  {
    id: "appliance-scanner",
    label: "Appliance Audit Scanner",
    shortLabel: "Appliance Scanner",
    description: "Continuous UPC scan & count for appliance inventory audits",
    icon: "tools",
    href: `/?section=appliances#${APPLIANCE_SCANNER_HASH}`,
    section: "appliances",
  },
  {
    id: "remnant-calculator",
    label: "Carpet Remnant Calculator",
    shortLabel: "Remnant Calculator",
    description: "Roll length, square-yard cuts, and remnant price tags",
    icon: "notes",
    href: `/settings#${REMNANT_CALCULATOR_HASH}`,
    section: "remnants",
  },
];

/** Tools the active roster member may open (Settings remnants or specialty hub scan). */
export function visibleSpecialtyTools(
  member: StoreSpecialist | null | undefined
): SpecialtyTool[] {
  return SPECIALTY_TOOLS.filter((tool) => canAccessSection(member, tool.section));
}

export function specialtyToolHref(toolId: SpecialtyToolId): string {
  const tool = SPECIALTY_TOOLS.find((t) => t.id === toolId);
  return tool?.href ?? "/";
}

export type ApplianceScannerLocationContext = {
  location_id: string;
  aisle: string;
  bay: number;
  location_tag: string;
  location_type?: "showroom" | "topstock";
};

/** Open appliance scanner on the specialty hub (in-page modal). */
export function requestApplianceScanner(
  context?: ApplianceScannerLocationContext
) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(APPLIANCE_SCANNER_OPEN_EVENT, {
      detail: context ?? null,
    })
  );
}

/** Open remnant calculator — Settings accordion or in-page modal on flooring scan. */
export function requestRemnantCalculator() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(REMNANT_CALCULATOR_OPEN_EVENT));
}

/**
 * Open Executive Floor Pad / Walk & Talk on Floor.
 *
 * When already on Floor: dispatch open event (listeners are mounted keep-alive).
 * From other routes: navigate with durable query intent
 * (`/dashboard?open=executive-floor-pad`). Prefer Next `router.push(href)` from
 * UI callers so keep-alive soft-nav avoids a full reload. Hard `assign` remains
 * a durable fallback — query survives reload; Floor bridge consumes after mount.
 */
export function requestExecutiveFloorPad() {
  if (typeof window === "undefined") return;
  const path = window.location.pathname || "";
  if (isExecutiveFloorPadFloorPath(path)) {
    window.dispatchEvent(new CustomEvent(EXECUTIVE_FLOOR_PAD_OPEN_EVENT));
    return;
  }
  window.location.assign(buildExecutiveFloorPadHref());
}

export function isApplianceScannerHash(hash: string): boolean {
  return hash.replace(/^#/, "") === APPLIANCE_SCANNER_HASH;
}

export function isRemnantCalculatorHash(hash: string): boolean {
  return hash.replace(/^#/, "") === REMNANT_CALCULATOR_HASH;
}
