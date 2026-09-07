import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  findApplianceByItemOrUpc,
  resolveApplianceScan,
} from "@/lib/appliance-catalog";
import type { ApplianceCatalogItem } from "@/lib/types";

const root = process.cwd();

function readRepo(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

function catalogItem(
  partial: Partial<ApplianceCatalogItem> &
    Pick<ApplianceCatalogItem, "id" | "item_number">
): ApplianceCatalogItem {
  return {
    store_number: "2587",
    upc: "012345678905",
    description: "Washer",
    category: "Laundry",
    sub_category: "Washer",
    created_at: "",
    updated_at: "",
    ...partial,
  };
}

describe("APP-FIELD-001 field corrections", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("known local UPC resolves without teaching", () => {
    const catalog = [
      catalogItem({ id: "1", item_number: "111", upc: "012345678905" }),
    ];
    const resolution = resolveApplianceScan(catalog, "012345678905");
    expect(resolution.kind).toBe("matched");
    expect(findApplianceByItemOrUpc(catalog, "012345678905")?.item_number).toBe(
      "111"
    );
  });

  it("unknown UPC opens teach path (unmatched)", () => {
    const resolution = resolveApplianceScan([], "999999999999");
    expect(resolution.kind === "unlinked_barcode" || resolution.kind === "unknown_sku").toBe(
      true
    );
  });

  it("rapid-fire COUNT uses localFirst save (no await network before ready)", () => {
    const form = readRepo("components/sections/ApplianceScanForm.tsx");
    expect(form).toContain("localFirst: true");
    expect(form).toContain("Ready — scan next barcode");
    expect(form).not.toContain("Logging to database");

    const scans = readRepo("lib/appliance-scans.ts");
    expect(scans).toContain("options.localFirst");
    expect(scans).toContain("flushSyncQueue");
    expect(scans).toContain("enqueueSyncAction");
  });

  it("rapid scans capture scanned_at and audit_session_id before enqueue", () => {
    const form = readRepo("components/sections/ApplianceScanForm.tsx");
    expect(form).toContain("capturedAt");
    expect(form).toContain("scanned_at: capturedAt");
    expect(form).toContain("audit_session_id: sessionId");

    const scans = readRepo("lib/appliance-scans.ts");
    expect(scans).toMatch(/if \(!payload\.id\) payload\.id = uid\(\)/);
    expect(scans).toMatch(
      /if \(!payload\.scanned_at\) payload\.scanned_at = new Date\(\)\.toISOString\(\)/
    );
  });

  it("scanner exposes active audit + Review / Finish Audit", () => {
    const form = readRepo("components/sections/ApplianceScanForm.tsx");
    expect(form).toContain("Physical audit active");
    expect(form).toContain("Review / Finish Audit");
    expect(form).toContain("onReviewFinishAudit");

    const panel = readRepo(
      "components/appliances/AppliancePhysicalAuditPanel.tsx"
    );
    expect(panel).toContain("reviewFinishToken");
    expect(panel).toContain("Close physical audit");
  });

  it("teach resume logs once via commitScan after mapping save", () => {
    const form = readRepo("components/sections/ApplianceScanForm.tsx");
    expect(form).toContain("handleQuickAdded");
    expect(form).toContain("await commitScan(item)");
    expect(form).toMatch(/do not require a second scan/i);
  });

  it("catalog store_number migration restores canonical store scoping", () => {
    const sql = readRepo(
      "supabase/migrations/20260907_appliance_catalog_store_number.sql"
    );
    expect(sql).toContain("add column if not exists store_number");
    expect(sql).toContain("appliance_catalog_store_item_uidx");
    expect(sql).toContain("jwt_matches_store");
    expect(sql).toContain("set not null");
    expect(sql).toMatch(/lack trustworthy store_number/i);
    expect(sql).toMatch(/Refusing fictional store assignment/i);
    expect(sql).not.toMatch(/set store_number\s*=\s*'0000'/i);
    expect(sql).not.toMatch(/default '0000'/i);
    expect(sql).not.toMatch(/drop table.*appliance_catalog/i);
  });

  it("catalog API retains store_number scoping (fail-closed)", () => {
    const route = readRepo("app/api/appliances/catalog/route.ts");
    expect(route).toContain("store_number");
    expect(route).toContain('onConflict: "store_number,item_number"');
    expect(route).toContain("actorBoundStoreNumber");
  });

  it("APP-AUD-001A close protections remain intact", () => {
    const client = readRepo("lib/appliances/audit-client.ts");
    expect(client).toContain("getPendingApplianceScanSyncForAudit");
    expect(client).toContain("flushSyncQueue");
    expect(client).toContain("Cannot close");
  });
});
