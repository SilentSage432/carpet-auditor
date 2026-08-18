/**
 * Specialty tool registry — appliance UPC audit scanner & carpet remnant calculator.
 * Presentation routes live here; scan/calc logic stays in section components.
 */

import { canAccessSection } from "@/lib/rbac";
import type { NavIconId } from "@/components/hub/NavIcons";
import type { HubSection, StoreSpecialist } from "@/lib/types";

export const APPLIANCE_SCANNER_HASH = "scan";
export const REMNANT_CALCULATOR_HASH = "remnants-calculator";

export const APPLIANCE_SCANNER_OPEN_EVENT = "deptsync:appliance-scanner-open";
export const REMNANT_CALCULATOR_OPEN_EVENT = "deptsync:remnant-calculator-open";

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

export function isApplianceScannerHash(hash: string): boolean {
  return hash.replace(/^#/, "") === APPLIANCE_SCANNER_HASH;
}

export function isRemnantCalculatorHash(hash: string): boolean {
  return hash.replace(/^#/, "") === REMNANT_CALCULATOR_HASH;
}
