/**
 * APP-OBS-001 — Per-unit fulfillment disposition (physical observation).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { composeAppliancePhysicalCounts } from "@/lib/appliances/physical-audit";
import { APPLIANCE_CLOSED_FROZEN_SCAN_FIELDS } from "@/lib/appliances/physical-audit";
import {
  formatApplianceFulfillmentDisposition,
  normalizeApplianceFulfillmentDisposition,
  type ApplianceScan,
} from "@/lib/types";

const root = process.cwd();

function readRepo(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

function scan(
  partial: Partial<ApplianceScan> & Pick<ApplianceScan, "id" | "item_number">
): ApplianceScan {
  return {
    store_number: "2587",
    serial_number: "",
    location: "Top Stock",
    location_type: "topstock",
    condition_tag: "NEW_BOXED",
    category: "Laundry",
    sub_category: "Washer",
    scanned_by: "ds",
    scanned_at: "2026-09-07T12:00:00.000Z",
    audit_session_id: "audit-1",
    fulfillment_disposition: null,
    ...partial,
  };
}

describe("APP-OBS-001 schema & types", () => {
  const sql = readRepo(
    "supabase/migrations/20260907_appliance_scans_fulfillment_disposition.sql"
  );

  it("schema allows NULL / STAGED_PICKUP / STAGED_DELIVERY and rejects inventing NORMAL", () => {
    expect(sql).toContain("fulfillment_disposition text");
    expect(sql).toContain("STAGED_PICKUP");
    expect(sql).toContain("STAGED_DELIVERY");
    expect(sql).toContain("fulfillment_disposition is null");
    expect(sql).not.toMatch(/NORMAL|AVAILABLE|sellable/i);
    expect(sql).toMatch(/no staged disposition recorded/i);
  });

  it("existing/historical rows require no backfill", () => {
    expect(sql).not.toMatch(/update\s+public\.appliance_scans/i);
    expect(sql).not.toMatch(/backfill/i);
  });

  it("normalize accepts only staged values; unknown → null", () => {
    expect(normalizeApplianceFulfillmentDisposition(null)).toBeNull();
    expect(normalizeApplianceFulfillmentDisposition("")).toBeNull();
    expect(normalizeApplianceFulfillmentDisposition("STAGED_PICKUP")).toBe(
      "STAGED_PICKUP"
    );
    expect(normalizeApplianceFulfillmentDisposition("STAGED_DELIVERY")).toBe(
      "STAGED_DELIVERY"
    );
    expect(normalizeApplianceFulfillmentDisposition("AVAILABLE")).toBeNull();
    expect(normalizeApplianceFulfillmentDisposition("NORMAL")).toBeNull();
    expect(formatApplianceFulfillmentDisposition(null)).toBe("");
    expect(formatApplianceFulfillmentDisposition("STAGED_PICKUP")).toBe(
      "Staged pickup"
    );
  });
});

describe("APP-OBS-001 scanner / edit / orthogonality", () => {
  const form = readRepo("components/sections/ApplianceScanForm.tsx");
  const edit = readRepo("components/appliances/ApplianceScanEditModal.tsx");
  const client = readRepo("lib/appliance-scans.ts");
  const route = readRepo("app/api/appliances/scans/route.ts");
  const freezeSql = readRepo(
    "supabase/migrations/20260907_appliance_scans_closed_evidence_freeze.sql"
  );

  it("new normal scan defaults NULL (no mandatory question)", () => {
    expect(form).toContain("saveApplianceScan");
    expect(form).not.toMatch(
      /saveApplianceScan\([\s\S]{0,400}fulfillment_disposition:/
    );
    expect(form).toContain("Ready — scan next barcode");
    expect(form).toContain("last-scan-fulfillment");
  });

  it("quick Pickup/Delivery targets only last-created scan", () => {
    expect(form).toContain("setLastScanId(record.id)");
    expect(form).toContain('applyLastScanDisposition("STAGED_PICKUP")');
    expect(form).toContain('applyLastScanDisposition("STAGED_DELIVERY")');
    expect(form).toContain("updateApplianceScan(targetId");
    expect(form).toContain("fulfillment_disposition: value");
  });

  it("rapid-scan stale disposition response cannot retarget last-scan chrome", () => {
    expect(form).toContain("const targetId = lastScanId");
    expect(form).toContain("lastScanIdRef.current = lastScanId");
    expect(form).toContain("lastScanIdRef.current === targetId");
    expect(form).toContain(
      "stale A response must not overwrite B's last-scan chrome"
    );
  });

  it("edit can clear back to NULL; disposition separate from condition/location", () => {
    expect(edit).toContain("No staged disposition recorded");
    expect(edit).toContain("Fulfillment disposition");
    expect(edit).toContain("Condition");
    expect(edit).toContain("fulfillment_disposition");
  });

  it("disposition is soft — not in CLOSED freeze set", () => {
    expect(APPLIANCE_CLOSED_FROZEN_SCAN_FIELDS).not.toContain(
      "fulfillment_disposition"
    );
    expect(freezeSql).not.toContain("fulfillment_disposition");
    expect(route).toContain("fulfillment_disposition");
  });

  it("offline create/update preserves disposition and audit membership", () => {
    expect(client).toContain("fulfillment_disposition: next.fulfillment_disposition ?? null");
    expect(client).toContain("audit_session_id: next.audit_session_id ?? null");
    expect(client).toContain("fulfillment_disposition: payload.fulfillment_disposition ?? null");
  });

  it("PATCH sends only patched fields (disposition-only safe after CLOSED)", () => {
    expect(client).toContain(
      "if (patch.fulfillment_disposition !== undefined)"
    );
    expect(client).toContain("body.fulfillment_disposition = next.fulfillment_disposition");
  });

  it("API rejects unknown disposition values", () => {
    expect(route).toContain(
      "fulfillment_disposition must be STAGED_PICKUP, STAGED_DELIVERY, or null"
    );
  });
});

describe("APP-OBS-001 reconciliation breakdown & CSV", () => {
  it("derives staged pickup/delivery/null and showroom without claiming availability", () => {
    const rows = composeAppliancePhysicalCounts([
      scan({
        id: "1",
        item_number: "111",
        location_type: "showroom",
        condition_tag: "SHOWROOM_DISPLAY",
        fulfillment_disposition: null,
      }),
      scan({
        id: "2",
        item_number: "111",
        location_type: "topstock",
        fulfillment_disposition: "STAGED_PICKUP",
      }),
      scan({
        id: "3",
        item_number: "111",
        location_type: "topstock",
        fulfillment_disposition: "STAGED_DELIVERY",
      }),
      scan({
        id: "4",
        item_number: "111",
        location_type: "topstock",
        fulfillment_disposition: "STAGED_DELIVERY",
      }),
      scan({
        id: "5",
        item_number: "111",
        location_type: "topstock",
        fulfillment_disposition: null,
      }),
      scan({
        id: "6",
        item_number: "111",
        location_type: "topstock",
        fulfillment_disposition: null,
      }),
      scan({
        id: "7",
        item_number: "111",
        location_type: "topstock",
        fulfillment_disposition: null,
      }),
    ]);
    const item = rows.find((r) => r.item_number === "111")!;
    expect(item.physical_count).toBe(7);
    expect(item.showroom_count).toBe(1);
    expect(item.staged_pickup_count).toBe(1);
    expect(item.staged_delivery_count).toBe(2);
    expect(item.no_staged_disposition_count).toBe(4);
  });

  it("disposition change does not change physical_count cardinality", () => {
    const before = composeAppliancePhysicalCounts([
      scan({ id: "a", item_number: "X", fulfillment_disposition: null }),
      scan({ id: "b", item_number: "X", fulfillment_disposition: null }),
    ]);
    const after = composeAppliancePhysicalCounts([
      scan({
        id: "a",
        item_number: "X",
        fulfillment_disposition: "STAGED_PICKUP",
      }),
      scan({
        id: "b",
        item_number: "X",
        fulfillment_disposition: "STAGED_DELIVERY",
      }),
    ]);
    expect(before[0]!.physical_count).toBe(2);
    expect(after[0]!.physical_count).toBe(2);
  });

  it("CSV includes fulfillment disposition; NULL remains blank", () => {
    const client = readRepo("lib/appliance-scans.ts");
    expect(client).toContain('"Fulfillment Disposition"');
    expect(client).toContain(
      "formatApplianceFulfillmentDisposition(s.fulfillment_disposition)"
    );
    const panel = readRepo(
      "components/appliances/AppliancePhysicalAuditPanel.tsx"
    );
    expect(panel).toContain("No staged disposition recorded");
    expect(panel).not.toMatch(/Available\s*inventory|Sellable|Free stock/i);
  });
});

describe("APP-OBS-001 freeze compatibility", () => {
  it("does not overload condition_tag or location_type", () => {
    const types = readRepo("lib/types.ts");
    expect(types).toContain("ApplianceFulfillmentDisposition");
    expect(types).toContain('"STAGED_PICKUP" | "STAGED_DELIVERY"');
    const conditionBlock = types.slice(
      types.indexOf("export type ApplianceConditionTag"),
      types.indexOf("export const APPLIANCE_CONDITION_TAGS")
    );
    expect(conditionBlock).not.toContain("STAGED_PICKUP");
    expect(conditionBlock).not.toContain("STAGED_DELIVERY");
  });
});
