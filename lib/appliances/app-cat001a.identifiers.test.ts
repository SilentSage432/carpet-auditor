/**
 * APP-CAT-001A / APP-UPC-001A — opaque physical scan identity.
 *
 * Client catalog holds public item_number identity only. Physical scan matching
 * and teach are server-side (fingerprints via teach-scan / resolve-scan).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ApplianceCatalogConflictError,
  applianceIdentifierLookupKeys,
  findApplianceByItemOrUpc,
  findApplianceIdentifierConflict,
  listApplianceTaughtIdentifiers,
  normalizeApplianceIdentifier,
  resolveApplianceScan,
} from "@/lib/appliance-catalog";
import { APPLIANCE_CLOSED_FROZEN_SCAN_FIELDS } from "@/lib/appliances/physical-audit";
import type { ApplianceCatalogItem } from "@/lib/types";

const root = process.cwd();

function readRepo(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

function item(
  partial: Partial<ApplianceCatalogItem> &
    Pick<ApplianceCatalogItem, "id" | "item_number">
): ApplianceCatalogItem {
  return {
    store_number: "2587",
    description: "Test appliance",
    category: "Laundry",
    sub_category: "Washer",
    created_at: "2026-09-06T00:00:00.000Z",
    updated_at: "2026-09-06T00:00:00.000Z",
    ...partial,
  };
}

describe("APP-CAT-001A multi-identifier catalog (APP-UPC-001A opaque)", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    });
  });

  const catalog: ApplianceCatalogItem[] = [
    item({
      id: "1",
      item_number: "1234567",
      description: "Whirlpool Washer",
    }),
    item({
      id: "2",
      item_number: "7654321",
      description: "GE French Door",
      category: "Refrigeration",
      sub_category: "French Door",
    }),
  ];

  it("migration adds identifier table with unique store+identifier", () => {
    const sql = readRepo(
      "supabase/migrations/20260907_appliance_catalog_identifiers.sql"
    );
    expect(sql).toContain("appliance_catalog_identifiers");
    expect(sql).toContain(
      "appliance_catalog_identifiers_store_identifier_uidx"
    );
    expect(sql).toContain("on conflict (store_number, identifier) do nothing");
    expect(sql).not.toMatch(
      /create table[\s\S]*identifier_type|add column[\s\S]*identifier_type/i
    );
    expect(sql).not.toMatch(
      /alter table public\.appliance_catalog[\s\S]*drop column.*upc/i
    );
    expect(sql).not.toMatch(/update public\.appliance_scans/i);
  });

  it("listApplianceTaughtIdentifiers is always empty on the client", () => {
    expect(listApplianceTaughtIdentifiers(catalog[0]!)).toEqual([]);
    expect(listApplianceTaughtIdentifiers()).toEqual([]);
  });

  it("item_number collision helper still detects public identity clashes", () => {
    const conflict = findApplianceIdentifierConflict(catalog, "1234567", {
      excludeItemNumber: "7654321",
    });
    expect(conflict?.item_number).toBe("1234567");
  });

  it("same item_number may remain store-scoped across different stores", () => {
    const otherStore = [
      item({
        id: "x",
        store_number: "9999",
        item_number: "1234567",
      }),
    ];
    expect(
      findApplianceIdentifierConflict(otherStore, "1234567")?.item_number
    ).toBe("1234567");
    expect(
      findApplianceIdentifierConflict(catalog, "1234567")?.item_number
    ).toBe("1234567");
  });

  it("canonical item_number resolution still works", () => {
    expect(findApplianceByItemOrUpc(catalog, "1234567")?.description).toBe(
      "Whirlpool Washer"
    );
  });

  it("physical UPC / alias does not resolve locally", () => {
    expect(findApplianceByItemOrUpc(catalog, "012345678905")).toBeUndefined();
    expect(findApplianceByItemOrUpc(catalog, "999988887777")).toBeUndefined();
    expect(resolveApplianceScan(catalog, "012345678905").kind).toBe(
      "unlinked_barcode"
    );
    expect(resolveApplianceScan(catalog, "999988887777").kind).toBe(
      "unlinked_barcode"
    );
  });

  it("known item_number is quiet; unknown physical opens teach path", () => {
    expect(resolveApplianceScan(catalog, "1234567").kind).toBe("matched");
    expect(resolveApplianceScan(catalog, "111122223333").kind).toBe(
      "unlinked_barcode"
    );
  });

  it("normalization trims framing without inventing UPC-only collapse", () => {
    expect(normalizeApplianceIdentifier("  ABC-123  \n")).toBe("ABC-123");
    expect(normalizeApplianceIdentifier("00123")).toBe("00123");
    const keys = applianceIdentifierLookupKeys("  012345678905 ");
    expect(keys).toEqual(["012345678905"]);
  });

  it("leading-zero item_number matches exactly (no digit sanitize)", () => {
    const withZeros = [
      item({
        id: "z",
        item_number: "0012345",
      }),
    ];
    expect(findApplianceByItemOrUpc(withZeros, "0012345")?.item_number).toBe(
      "0012345"
    );
    expect(findApplianceByItemOrUpc(withZeros, "12345")).toBeUndefined();
  });

  it("duplicate item_number rows collapse to a single local match", () => {
    const ambiguous = [
      item({ id: "1", item_number: "111", store_number: "2587" }),
      item({ id: "2", item_number: "111", store_number: "2587" }),
    ];
    // uniqueCatalogItems keys by store::item_number — duplicates are not ambiguous.
    expect(findApplianceByItemOrUpc(ambiguous, "111")?.item_number).toBe("111");
    expect(resolveApplianceScan(ambiguous, "111").kind).toBe("matched");
  });

  it("link path skips metadata fields in Quick Add", () => {
    const quick = readRepo("components/barcode/QuickAddApplianceModal.tsx");
    expect(quick).toContain("Link to existing item");
    expect(quick).toContain("Create new item");
    expect(quick).toContain("linkApplianceCatalogIdentifier");
    expect(quick).toContain("No metadata re-entry");
    expect(quick).toContain("Reuse existing description and category");
  });

  it("create-new teaches via teach_scan_identifier (online teach-scan)", () => {
    const quick = readRepo("components/barcode/QuickAddApplianceModal.tsx");
    expect(quick).toContain("teach_scan_identifier: teachIdentifier");
    expect(quick).toContain("saveApplianceCatalogItem");
  });

  it("API + client refuse silent identifier stealing", () => {
    const teach = readRepo("app/api/appliances/catalog/teach-scan/route.ts");
    const resolveServer = readRepo("lib/appliances/scan-resolve.server.ts");
    expect(teach).toContain("teachApplianceScanFingerprint");
    expect(resolveServer).toContain(".status = 409");
    expect(resolveServer).toMatch(/already linked/i);
    const client = readRepo("lib/appliance-catalog.ts");
    expect(client).toContain("linkApplianceCatalogIdentifier");
    expect(client).toContain("/api/appliances/catalog/teach-scan");
    expect(client).toContain("scan_identifier");
    expect(client).toContain("res.status === 409");
  });

  it("offline path never queues plaintext physical identifiers", () => {
    const catalogSrc = readRepo("lib/appliance-catalog.ts");
    expect(catalogSrc).toContain(
      "Physical teach requires network — do not enqueue plaintext identifiers"
    );
    expect(catalogSrc).toContain(
      "Teaching scan identity requires a network connection"
    );
  });

  it("historical scans and OBS/AUD soft-freeze contracts untouched", () => {
    expect(APPLIANCE_CLOSED_FROZEN_SCAN_FIELDS).toContain("item_number");
    expect(APPLIANCE_CLOSED_FROZEN_SCAN_FIELDS).not.toContain(
      "fulfillment_disposition"
    );
    const mig = readRepo(
      "supabase/migrations/20260907_appliance_catalog_identifiers.sql"
    );
    expect(mig).not.toMatch(/appliance_scans/);
    const freeze = readRepo(
      "supabase/migrations/20260907_appliance_scans_closed_evidence_freeze.sql"
    );
    expect(freeze).toContain("appliance_scans_enforce_closed_evidence_freeze");
  });

  it("Manage mappings does not display upc or taught identifiers", () => {
    const manage = readRepo(
      "components/appliances/ApplianceCatalogManageSheet.tsx"
    );
    expect(manage).not.toContain("Identifiers:");
    expect(manage).not.toContain("UPC / Vendor Barcode");
    expect(manage).toContain("Teach physical");
  });

  it("ApplianceCatalogConflictError still carries conflict row", () => {
    const err = new ApplianceCatalogConflictError("dup", catalog[1]!);
    expect(err.conflict.item_number).toBe("7654321");
  });
});
