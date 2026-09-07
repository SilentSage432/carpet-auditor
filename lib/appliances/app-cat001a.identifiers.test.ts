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
    upc: null,
    description: "Test appliance",
    category: "Laundry",
    sub_category: "Washer",
    created_at: "2026-09-06T00:00:00.000Z",
    updated_at: "2026-09-06T00:00:00.000Z",
    identifiers: [],
    ...partial,
  };
}

describe("APP-CAT-001A multi-identifier catalog", () => {
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
      upc: "012345678905",
      identifiers: ["012345678905", "999988887777"],
      description: "Whirlpool Washer",
    }),
    item({
      id: "2",
      item_number: "7654321",
      upc: "098765432109",
      identifiers: ["098765432109"],
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
    expect(sql).not.toMatch(/alter table public\.appliance_catalog[\s\S]*drop column.*upc/i);
    expect(sql).not.toMatch(/update public\.appliance_scans/i);
  });

  it("one item may own multiple identifiers", () => {
    const ids = listApplianceTaughtIdentifiers(catalog[0]!);
    expect(ids).toContain("012345678905");
    expect(ids).toContain("999988887777");
    expect(ids.length).toBeGreaterThanOrEqual(2);
  });

  it("one identifier cannot belong to two items in same store", () => {
    const conflict = findApplianceIdentifierConflict(catalog, "999988887777", {
      excludeItemNumber: "7654321",
    });
    expect(conflict?.item_number).toBe("1234567");
  });

  it("same identifier may remain store-scoped across different stores", () => {
    const otherStore = [
      item({
        id: "x",
        store_number: "9999",
        item_number: "111",
        identifiers: ["999988887777"],
      }),
    ];
    // Conflict helper is list-scoped; different store lists are independent.
    expect(
      findApplianceIdentifierConflict(otherStore, "999988887777")?.item_number
    ).toBe("111");
    expect(
      findApplianceIdentifierConflict(catalog, "999988887777")?.item_number
    ).toBe("1234567");
  });

  it("canonical item_number resolution still works", () => {
    expect(findApplianceByItemOrUpc(catalog, "1234567")?.description).toBe(
      "Whirlpool Washer"
    );
  });

  it("legacy UPC resolution still works", () => {
    expect(findApplianceByItemOrUpc(catalog, "012345678905")?.item_number).toBe(
      "1234567"
    );
  });

  it("new identifier resolution works", () => {
    expect(findApplianceByItemOrUpc(catalog, "999988887777")?.item_number).toBe(
      "1234567"
    );
  });

  it("UPC A + identifier B both resolve same item", () => {
    const a = findApplianceByItemOrUpc(catalog, "012345678905");
    const b = findApplianceByItemOrUpc(catalog, "999988887777");
    expect(a?.id).toBe(b?.id);
  });

  it("adding B does not require replacing legacy UPC A (model)", () => {
    const before = catalog[0]!.upc;
    const linked = {
      ...catalog[0]!,
      identifiers: [...(catalog[0]!.identifiers ?? []), "555544443333"],
    };
    expect(linked.upc).toBe(before);
    expect(listApplianceTaughtIdentifiers(linked)).toContain("012345678905");
    expect(listApplianceTaughtIdentifiers(linked)).toContain("555544443333");
  });

  it("known alias is quiet; unknown opens teach path", () => {
    expect(resolveApplianceScan(catalog, "999988887777").kind).toBe("matched");
    expect(resolveApplianceScan(catalog, "111122223333").kind).toBe(
      "unlinked_barcode"
    );
  });

  it("normalization trims framing without inventing UPC-only collapse", () => {
    expect(normalizeApplianceIdentifier("  ABC-123  \n")).toBe("ABC-123");
    expect(normalizeApplianceIdentifier("00123")).toBe("00123");
    const keys = applianceIdentifierLookupKeys("  012345678905 ");
    expect(keys).toContain("012345678905");
  });

  it("exact identifier preserves leading zeros and non-digits", () => {
    const withZeros = [
      item({
        id: "z",
        item_number: "999",
        identifiers: ["0012345"],
      }),
    ];
    expect(findApplianceByItemOrUpc(withZeros, "0012345")?.item_number).toBe(
      "999"
    );
    const withAlpha = [
      item({
        id: "a",
        item_number: "888",
        identifiers: ["ABC12345"],
      }),
    ];
    expect(findApplianceByItemOrUpc(withAlpha, "ABC12345")?.item_number).toBe(
      "888"
    );
  });

  it("sanitized fallback cannot misresolve ambiguous collapsed identifiers", () => {
    // Neither alias equals "12345" exactly; both collapse to 12345 via digit sanitize.
    const ambiguous = [
      item({
        id: "1",
        item_number: "111",
        identifiers: ["ABC12345"],
      }),
      item({
        id: "2",
        item_number: "222",
        identifiers: ["XYZ12345"],
      }),
    ];
    expect(findApplianceByItemOrUpc(ambiguous, "12345")).toBeUndefined();
    expect(resolveApplianceScan(ambiguous, "12345").kind).toBe("ambiguous");

    const leading = [
      item({
        id: "1",
        item_number: "111",
        identifiers: ["0012345"],
      }),
      item({
        id: "2",
        item_number: "222",
        identifiers: ["XX12345"],
      }),
    ];
    expect(findApplianceByItemOrUpc(leading, "12345")).toBeUndefined();
    expect(resolveApplianceScan(leading, "12345").kind).toBe("ambiguous");
  });

  it("exact-match resolution beats compatibility fallback", () => {
    const catalogLocal = [
      item({
        id: "1",
        item_number: "111",
        identifiers: ["ABC12345"],
      }),
      item({
        id: "2",
        item_number: "222",
        identifiers: ["12345"],
      }),
    ];
    // Exact alias wins for ABC12345 even though digits collapse to 12345.
    expect(findApplianceByItemOrUpc(catalogLocal, "ABC12345")?.item_number).toBe(
      "111"
    );
    // Exact alias "12345" wins over collapsed ABC12345 (no ambiguous pick).
    expect(findApplianceByItemOrUpc(catalogLocal, "12345")?.item_number).toBe(
      "222"
    );
  });

  it("link path skips metadata fields in Quick Add", () => {
    const quick = readRepo("components/barcode/QuickAddApplianceModal.tsx");
    expect(quick).toContain("Link to existing item");
    expect(quick).toContain("Create new item");
    expect(quick).toContain("linkApplianceCatalogIdentifier");
    expect(quick).toContain("No metadata re-entry");
    expect(quick).toContain("Reuse existing description and category");
  });

  it("create-new teaches identifier via saveApplianceCatalogItem", () => {
    const quick = readRepo("components/barcode/QuickAddApplianceModal.tsx");
    expect(quick).toContain("teach_identifier: teachIdentifier");
    expect(quick).toContain("saveApplianceCatalogItem");
  });

  it("API + client refuse silent identifier stealing", () => {
    const api = readRepo("app/api/appliances/catalog/identifiers/route.ts");
    expect(api).toContain("status: 409");
    expect(api).toContain("already linked");
    expect(api).toContain(".insert(payload)");
    expect(api).not.toMatch(/\.upsert\([\s\S]*onConflict:\s*"store_number,identifier"/);
    const client = readRepo("lib/appliance-catalog.ts");
    expect(client).toContain("linkApplianceCatalogIdentifier");
    expect(client).toContain("upsert_appliance_catalog_identifier");
  });

  it("offline queue preserves identifier ownership conflict", () => {
    const queue = readRepo("lib/sync-queue.ts");
    expect(queue).toContain("upsert_appliance_catalog_identifier");
    expect(queue).toContain("Do not overwrite server ownership");
    expect(queue).toContain("SyncConflictError");
    expect(queue).not.toMatch(
      /bulk.?promot|upload every legacy local/i
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

  it("Manage mappings surfaces multiple identifiers", () => {
    const manage = readRepo(
      "components/appliances/ApplianceCatalogManageSheet.tsx"
    );
    expect(manage).toContain("listApplianceTaughtIdentifiers");
    expect(manage).toContain("Identifiers:");
  });

  it("ApplianceCatalogConflictError still carries conflict row", () => {
    const err = new ApplianceCatalogConflictError("dup", catalog[1]!);
    expect(err.conflict.item_number).toBe("7654321");
  });
});
