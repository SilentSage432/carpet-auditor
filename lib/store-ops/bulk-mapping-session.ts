/**
 * TOPO-UX-001 / BULK-SETUP-002 — continuous manual Bulk Generator mapping session.
 * Presentation owns open/close; this module owns session event semantics
 * and physical-bay success copy. No browser storage persistence.
 *
 * Normal bulk create always uses SELLING + TOPSTOCK (BOTH) internally.
 */

import { departmentCodesMatch } from "@/lib/store-ops/department-codes";
import type { LocationWorkflowType, StoreLocationType } from "@/lib/store-ops/types";

/** Canonical normal surface representation for physical-bay topology create. */
export const NORMAL_BULK_SURFACE_TYPES: StoreLocationType[] = [
  "SELLING",
  "TOPSTOCK",
];

export type BulkGeneratorActionSource =
  | "manual"
  | "csv"
  | "cleanup"
  | "apply_workflow"
  /** @deprecated BULK-SETUP-002 retired AI Pre-Flight; retained for fail-closed close policy. */
  | "ai";

export type BulkGeneratedEvent = {
  source: BulkGeneratorActionSource;
};

/**
 * Manual aisle-by-aisle generation keeps the mapping sheet open.
 * All other known sources close. Unknown / missing source fails closed (closes).
 */
export function shouldCloseBulkGeneratorAfterGenerated(
  source: BulkGeneratorActionSource | null | undefined | string
): boolean {
  switch (source) {
    case "manual":
      return false;
    case "csv":
    case "ai":
    case "cleanup":
    case "apply_workflow":
      return true;
    default:
      return true;
  }
}

/**
 * Upsert-safe acknowledgement — speak physical bays, not surface-row count.
 * Capture aisle before clearing the input so copy names the submitted range.
 */
export function formatManualBulkSavedMessage(input: {
  physicalBays: number;
  departmentName: string;
  aisle: string;
}): string {
  const n = Math.max(0, Math.floor(Number(input.physicalBays) || 0));
  const dept = String(input.departmentName ?? "").trim() || "department";
  const aisle = String(input.aisle ?? "").trim() || "?";
  const noun = n === 1 ? "physical bay" : "physical bays";
  return `${n} ${noun} saved · ${dept} · ${aisle}`;
}

/** Appliances department → SIMS workflow; all others → standard merch. */
export function workflowTypeForDepartmentCode(
  code: string | null | undefined
): LocationWorkflowType {
  return departmentCodesMatch(code ?? "", "appliances")
    ? "APPLIANCE_SIMS_AUDIT"
    : "STANDARD_MERCH";
}
