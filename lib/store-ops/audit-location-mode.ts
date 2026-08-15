/**
 * Selling vs Topstock audit mode.
 * Store Ops `type` (SELLING | TOPSTOCK) is canonical; hub `LocationType` maps onto it.
 */

import type { LocationType } from "@/lib/types";
import type { StoreLocationType } from "./types";

export type AuditLocationMode = StoreLocationType;

export type AuditLocationModeMeta = {
  code: AuditLocationMode;
  hub: LocationType;
  short: string;
  hint: string;
};

export const AUDIT_LOCATION_MODES: AuditLocationModeMeta[] = [
  {
    code: "SELLING",
    hub: "sales_floor",
    short: "Floor",
    hint: "Lower floor level",
  },
  {
    code: "TOPSTOCK",
    hub: "top_stock",
    short: "Overhead",
    hint: "Overheads / racking",
  },
];

export function storeTypeFromHubLocation(
  location: LocationType | string | null | undefined
): AuditLocationMode {
  const raw = String(location ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  if (
    raw === "TOPSTOCK" ||
    raw === "TOP_STOCK" ||
    raw === "TOP" ||
    raw === "OVERHEAD"
  ) {
    return "TOPSTOCK";
  }
  return "SELLING";
}

export function hubLocationFromStoreType(
  type: StoreLocationType | string | null | undefined
): LocationType {
  return storeTypeFromHubLocation(type) === "TOPSTOCK"
    ? "top_stock"
    : "sales_floor";
}

export function auditLocationModeMeta(
  mode: StoreLocationType | LocationType | string | null | undefined
): AuditLocationModeMeta {
  const code = storeTypeFromHubLocation(mode);
  return (
    AUDIT_LOCATION_MODES.find((m) => m.code === code) ?? AUDIT_LOCATION_MODES[0]
  );
}

export function auditLocationModeLabel(
  mode: StoreLocationType | LocationType | string | null | undefined
): string {
  return auditLocationModeMeta(mode).short;
}

/** Compact floor badge: Floor or Overhead. */
export function formatAuditLocationBadge(
  mode: StoreLocationType | LocationType | string | null | undefined
): string {
  const meta = auditLocationModeMeta(mode);
  return meta.short;
}
