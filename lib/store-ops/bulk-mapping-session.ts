/**
 * TOPO-UX-001 — continuous manual Bulk Generator mapping session.
 * Presentation owns open/close; this module owns session event semantics
 * and upsert-safe success copy. No browser storage persistence.
 */

import { departmentCodesMatch } from "@/lib/store-ops/department-codes";
import type { LocationWorkflowType } from "@/lib/store-ops/types";

export type BulkGeneratorActionSource =
  | "manual"
  | "csv"
  | "ai"
  | "cleanup"
  | "apply_workflow";

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
 * Upsert-safe acknowledgement — API returns upserted row count as `created`.
 * Capture aisle before clearing the input so copy names the submitted range.
 */
export function formatManualBulkSavedMessage(input: {
  saved: number;
  departmentName: string;
  aisle: string;
}): string {
  const n = Math.max(0, Math.floor(Number(input.saved) || 0));
  const dept = String(input.departmentName ?? "").trim() || "department";
  const aisle = String(input.aisle ?? "").trim() || "?";
  const noun = n === 1 ? "location" : "locations";
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
