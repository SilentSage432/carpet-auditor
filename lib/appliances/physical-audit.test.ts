import { describe, expect, it } from "vitest";
import {
  composeAppliancePhysicalCounts,
  deriveApplianceVariance,
  normalizeApplianceReconOutcome,
  summarizeAppliancePhysicalAudit,
} from "@/lib/appliances/physical-audit";
import type { ApplianceCatalogItem, ApplianceScan } from "@/lib/types";

function scan(
  partial: Partial<ApplianceScan> & Pick<ApplianceScan, "id" | "item_number">
): ApplianceScan {
  return {
    store_number: "2587",
    serial_number: "",
    location: "Showroom Floor",
    location_type: "showroom",
    condition_tag: "SHOWROOM_DISPLAY",
    category: "Laundry",
    sub_category: "Washer",
    scanned_by: "ds",
    scanned_at: "2026-09-06T12:00:00.000Z",
    audit_session_id: "audit-1",
    ...partial,
  };
}

describe("APP-AUD-001 physical audit composition", () => {
  it("aggregates physical counts from observed scans by item", () => {
    const scans = [
      scan({ id: "a", item_number: "111" }),
      scan({ id: "b", item_number: "111" }),
      scan({ id: "c", item_number: "222", category: "Refrigeration" }),
    ];
    const catalog: ApplianceCatalogItem[] = [
      {
        id: "c1",
        store_number: "2587",
        item_number: "111",
        upc: "999",
        description: "Washer A",
        category: "Laundry",
        sub_category: "Washer",
        created_at: "",
        updated_at: "",
      },
    ];
    const rows = composeAppliancePhysicalCounts(scans, catalog);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.item_number === "111")?.physical_count).toBe(2);
    expect(rows.find((r) => r.item_number === "111")?.description).toBe(
      "Washer A"
    );
    expect(rows.find((r) => r.item_number === "222")?.physical_count).toBe(1);
  });

  it("summarizes unique items and units", () => {
    const summary = summarizeAppliancePhysicalAudit([
      scan({ id: "a", item_number: "111" }),
      scan({ id: "b", item_number: "111" }),
      scan({ id: "c", item_number: "222" }),
    ]);
    expect(summary.physical_unit_count).toBe(3);
    expect(summary.unique_item_count).toBe(2);
  });

  it("blank Lowe's OH does not become zero variance", () => {
    expect(deriveApplianceVariance(3, null)).toBeNull();
    expect(deriveApplianceVariance(3, undefined)).toBeNull();
  });

  it("derives variance as physical - declared OH", () => {
    expect(deriveApplianceVariance(3, 4)).toBe(-1);
    expect(deriveApplianceVariance(4, 4)).toBe(0);
    expect(deriveApplianceVariance(5, 2)).toBe(3);
  });

  it("normalizes declared outcomes only", () => {
    expect(normalizeApplianceReconOutcome("RESOLVED")).toBe("RESOLVED");
    expect(normalizeApplianceReconOutcome("needs_follow_up")).toBe(
      "NEEDS_FOLLOW_UP"
    );
    expect(normalizeApplianceReconOutcome("")).toBeNull();
    expect(() => normalizeApplianceReconOutcome("THEFT")).toThrow();
  });
});
