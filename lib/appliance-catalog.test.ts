import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApplianceCatalogConflictError,
  filterApplianceCatalog,
  findApplianceByItemOrUpc,
  findApplianceUpcConflict,
  resolveApplianceScan,
} from "@/lib/appliance-catalog";
import type { ApplianceCatalogItem } from "@/lib/types";

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
    ...partial,
  };
}

describe("appliance catalog teach / resolve (APP-UX-001)", () => {
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
      description: "Whirlpool Washer",
      category: "Laundry",
      sub_category: "Washer",
    }),
    item({
      id: "2",
      item_number: "7654321",
      upc: "098765432109",
      description: "GE French Door",
      category: "Refrigeration",
      sub_category: "French Door",
    }),
  ];

  it("known UPC resolves without teaching kinds", () => {
    const resolution = resolveApplianceScan(catalog, "012345678905");
    expect(resolution.kind).toBe("matched");
    if (resolution.kind === "matched") {
      expect(resolution.item.item_number).toBe("1234567");
      expect(resolution.item.description).toBe("Whirlpool Washer");
    }
  });

  it("unknown UPC opens teaching path (unlinked_barcode)", () => {
    const resolution = resolveApplianceScan(catalog, "111122223333");
    expect(resolution.kind).toBe("unlinked_barcode");
    if (resolution.kind === "unlinked_barcode") {
      expect(resolution.scanned).toBe("111122223333");
    }
  });

  it("unknown short SKU is unknown_sku for teach interrupt", () => {
    const resolution = resolveApplianceScan(catalog, "9999");
    expect(resolution.kind).toBe("unknown_sku");
  });

  it("saved mapping identity is findable by UPC and item number", () => {
    expect(findApplianceByItemOrUpc(catalog, "012345678905")?.item_number).toBe(
      "1234567"
    );
    expect(findApplianceByItemOrUpc(catalog, "1234567")?.description).toBe(
      "Whirlpool Washer"
    );
  });

  it("filter finds mappings by description and category", () => {
    const hits = filterApplianceCatalog(catalog, "french");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.item_number).toBe("7654321");
  });

  it("detects duplicate UPC conflict against another item", () => {
    const conflict = findApplianceUpcConflict(catalog, "098765432109", {
      excludeItemNumber: "1234567",
    });
    expect(conflict?.item_number).toBe("7654321");
  });

  it("allows same UPC on the item already owning it", () => {
    const conflict = findApplianceUpcConflict(catalog, "012345678905", {
      excludeId: "1",
      excludeItemNumber: "1234567",
    });
    expect(conflict).toBeUndefined();
  });

  it("ApplianceCatalogConflictError carries conflict row", () => {
    const row = catalog[1]!;
    const err = new ApplianceCatalogConflictError("dup", row);
    expect(err.name).toBe("ApplianceCatalogConflictError");
    expect(err.conflict.item_number).toBe("7654321");
  });
});
