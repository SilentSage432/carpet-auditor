import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function readRepo(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

describe("APP-UX-001 appliance teach / quiet scan contracts", () => {
  it("scanner keeps wedge NumberField and intentional manual entry", () => {
    const form = readRepo("components/sections/ApplianceScanForm.tsx");
    expect(form).toContain("Enter item manually");
    expect(form).toContain("onScanCommit={handleItemLookup}");
    expect(form).toContain("Quiet count");
    expect(form).toContain("QuickAddApplianceModal");
    expect(form).not.toContain("ApplianceCategoryFields");
  });

  it("unknown path opens Quick-Add with category fields; known path auto-logs", () => {
    const form = readRepo("components/sections/ApplianceScanForm.tsx");
    expect(form).toContain('setQuickAddBarcode(resolution.scanned)');
    expect(form).toContain("void commitScan(item)");
    const quick = readRepo("components/barcode/QuickAddApplianceModal.tsx");
    expect(quick).toContain("ApplianceCategoryFields");
    expect(quick).toContain("Lowe's Item # / SKU");
    expect(quick).toContain("findApplianceIdentifierConflict");
    expect(quick).toContain("Link to existing item");
    expect(quick).toContain("Create new item");
  });

  it("manage mappings sheet recovers searchable edit of UPC/item/category/description", () => {
    const manage = readRepo(
      "components/appliances/ApplianceCatalogManageSheet.tsx"
    );
    expect(manage).toContain("Manage appliance mappings");
    expect(manage).toContain("filterApplianceCatalog");
    expect(manage).toContain("ApplianceCategoryFields");
    expect(manage).toContain("UPC / Vendor Barcode");
    expect(manage).toContain("findApplianceUpcConflict");
    expect(manage).not.toContain("handleDelete");
    const section = readRepo("components/sections/ApplianceAuditSection.tsx");
    expect(section).toContain("ApplianceCatalogManageSheet");
    expect(section).toContain("Manage appliance mappings");
  });

  it("catalog API refuses ambiguous UPC remaps with 409", () => {
    const api = readRepo("app/api/appliances/catalog/route.ts");
    expect(api).toContain("status: 409");
    expect(api).toContain("already linked");
    const idApi = readRepo("app/api/appliances/catalog/identifiers/route.ts");
    expect(idApi).toContain("status: 409");
  });

  it("online application failures do not fall through to direct Supabase upsert", () => {
    const catalog = readRepo("lib/appliance-catalog.ts");
    expect(catalog).toContain("gotHttpResponse");
    expect(catalog).toContain("if (gotHttpResponse) throw err");
    expect(catalog).toContain("actor-bound catalog API only");
    // Online save must not upsert appliance_catalog via client after API response.
    const saveFnStart = catalog.indexOf("export async function saveApplianceCatalogItem");
    const saveFn = catalog.slice(saveFnStart, saveFnStart + 4500);
    expect(saveFn).not.toMatch(/\.from\(TABLE\)\s*\n?\s*\.upsert/);
    expect(saveFn).not.toMatch(/\.from\("appliance_catalog"\)\s*\n?\s*\.upsert/);
  });

  it("manage / teach surfaces do not invent Lowe's OH or reconciliation UI", () => {
    const manage = readRepo(
      "components/appliances/ApplianceCatalogManageSheet.tsx"
    );
    const quick = readRepo("components/barcode/QuickAddApplianceModal.tsx");
    for (const src of [manage, quick]) {
      expect(src).not.toMatch(/reconciliation_snapshot/i);
      expect(src).not.toMatch(/declared_lowes_oh/i);
      expect(src).not.toMatch(/physical_audit/i);
    }
  });
});
