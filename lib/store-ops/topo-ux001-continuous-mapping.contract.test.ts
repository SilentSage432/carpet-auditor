/**
 * TOPO-UX-001 continuous manual Bulk Generator mapping session.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  formatManualBulkSavedMessage,
  shouldCloseBulkGeneratorAfterGenerated,
  workflowTypeForDepartmentCode,
  type BulkGeneratorActionSource,
} from "./bulk-mapping-session";

const root = path.resolve(__dirname, "../..");

function readRepo(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf8");
}

describe("TOPO-UX-001 bulk mapping session helpers", () => {
  it("keeps the sheet open only for explicit manual source (fail-closed otherwise)", () => {
    expect(shouldCloseBulkGeneratorAfterGenerated("manual")).toBe(false);
    const closeSources: BulkGeneratorActionSource[] = [
      "csv",
      "ai",
      "cleanup",
      "apply_workflow",
    ];
    for (const source of closeSources) {
      expect(shouldCloseBulkGeneratorAfterGenerated(source)).toBe(true);
    }
    expect(shouldCloseBulkGeneratorAfterGenerated(undefined)).toBe(true);
    expect(shouldCloseBulkGeneratorAfterGenerated(null)).toBe(true);
    expect(shouldCloseBulkGeneratorAfterGenerated("")).toBe(true);
    expect(shouldCloseBulkGeneratorAfterGenerated("unknown")).toBe(true);
  });

  it("formats upsert-safe success copy from captured aisle (not live cleared state)", () => {
    expect(
      formatManualBulkSavedMessage({
        saved: 20,
        departmentName: "Flooring",
        aisle: "A41",
      })
    ).toBe("20 locations saved · Flooring · A41");
    expect(
      formatManualBulkSavedMessage({
        saved: 1,
        departmentName: "Flooring",
        aisle: "39",
      })
    ).toBe("1 location saved · Flooring · 39");
    expect(
      formatManualBulkSavedMessage({
        saved: 20,
        departmentName: "Flooring",
        aisle: "A41",
      })
    ).not.toMatch(/created/i);
  });

  it("updates acknowledgement per successive aisle (A39 → A40)", () => {
    const first = formatManualBulkSavedMessage({
      saved: 16,
      departmentName: "Flooring",
      aisle: "A39",
    });
    const second = formatManualBulkSavedMessage({
      saved: 16,
      departmentName: "Flooring",
      aisle: "A40",
    });
    expect(first).toBe("16 locations saved · Flooring · A39");
    expect(second).toBe("16 locations saved · Flooring · A40");
    expect(second).not.toBe(first);
  });

  it("maps Appliances → SIMS and non-Appliances → STANDARD_MERCH without leakage", () => {
    expect(workflowTypeForDepartmentCode("appliances")).toBe(
      "APPLIANCE_SIMS_AUDIT"
    );
    expect(workflowTypeForDepartmentCode("APPLIANCES")).toBe(
      "APPLIANCE_SIMS_AUDIT"
    );
    expect(workflowTypeForDepartmentCode("flooring")).toBe("STANDARD_MERCH");
    expect(workflowTypeForDepartmentCode("D23")).toBe("STANDARD_MERCH");
    expect(workflowTypeForDepartmentCode(undefined)).toBe("STANDARD_MERCH");
    expect(workflowTypeForDepartmentCode("")).toBe("STANDARD_MERCH");
  });
});

describe("TOPO-UX-001 continuous mapping source contracts", () => {
  it("manual generate stays open; clears aisle after success notify; keeps session defaults", () => {
    const generator = readRepo("components/admin/BulkLocationGenerator.tsx");
    const manager = readRepo("components/admin/AisleBayManager.tsx");

    expect(manager).toContain("shouldCloseBulkGeneratorAfterGenerated");
    expect(manager).toContain("event.source");
    expect(manager).toMatch(
      /shouldCloseBulkGeneratorAfterGenerated\(event\.source\)[\s\S]{0,80}setBulkOpen\(false\)/
    );

    expect(generator).toContain('onGenerated({ source: "manual" })');
    expect(generator).toContain("formatManualBulkSavedMessage");
    expect(generator).toContain("submittedAisle");
    expect(generator).toMatch(/setAisle\(""\)/);
    expect(generator).not.toMatch(
      /handleGenerate[\s\S]*setBulkOpen\(false\)/
    );

    // Preferred success order: message → notify → clear aisle (not clear before message).
    const handleStart = generator.indexOf("async function handleGenerate()");
    const handleEnd = generator.indexOf("async function handleCsvBatch()");
    const handleBody = generator.slice(handleStart, handleEnd);
    const msgIdx = handleBody.indexOf("setMessage(");
    const notifyIdx = handleBody.indexOf('onGenerated({ source: "manual" })');
    const clearIdx = handleBody.indexOf('setAisle("")');
    expect(msgIdx).toBeGreaterThan(-1);
    expect(notifyIdx).toBeGreaterThan(msgIdx);
    expect(clearIdx).toBeGreaterThan(notifyIdx);

    // Failure path: setAisle("") only appears once in handleGenerate (success path).
    expect(handleBody.match(/setAisle\(""\)/g)?.length ?? 0).toBe(1);
    expect(handleBody).toContain("setError(bulkAuthFriendlyError");
    expect(handleBody.indexOf("catch")).toBeGreaterThan(clearIdx);

    // Session fields are not reset after manual success (aisle clear only).
    expect(generator).not.toMatch(
      /onGenerated\(\{\s*source:\s*"manual"\s*\}\)[\s\S]{0,200}setDepartmentId/
    );
    expect(generator).not.toMatch(
      /onGenerated\(\{\s*source:\s*"manual"\s*\}\)[\s\S]{0,200}setStartBay/
    );
    expect(generator).not.toMatch(
      /onGenerated\(\{\s*source:\s*"manual"\s*\}\)[\s\S]{0,200}setEndBay/
    );
    expect(generator).not.toMatch(
      /onGenerated\(\{\s*source:\s*"manual"\s*\}\)[\s\S]{0,200}setLocationMode/
    );
    expect(generator).not.toMatch(
      /onGenerated\(\{\s*source:\s*"manual"\s*\}\)[\s\S]{0,200}setVelocitySeed/
    );
    expect(generator).not.toMatch(
      /onGenerated\(\{\s*source:\s*"manual"\s*\}\)[\s\S]{0,200}setBayPattern/
    );
    expect(generator).not.toMatch(
      /onGenerated\(\{\s*source:\s*"manual"\s*\}\)[\s\S]{0,200}setWorkflowType/
    );
    expect(generator).not.toMatch(
      /onGenerated\(\{\s*source:\s*"manual"\s*\}\)[\s\S]{0,200}setTab/
    );

    // Blank aisle cannot submit; busy disables generate; no form Enter submit.
    expect(generator).toContain(
      "disabled={busy || !departmentId || !isValidAisle(aisle)}"
    );
    expect(handleBody).toContain("if (!isValidAisle(aisleCode))");
    expect(handleBody).toContain("await bulkGenerateLocations");
    expect(handleBody.indexOf("if (!isValidAisle(aisleCode))")).toBeLessThan(
      handleBody.indexOf("await bulkGenerateLocations")
    );
    expect(generator).not.toMatch(/<form[\s\S]*handleGenerate/);
    expect(generator).toContain('data-testid="bulk-manual-aisle"');
    expect(generator).toContain('data-testid="bulk-manual-generate"');
    expect(generator).toContain('data-testid="bulk-generator-status"');
  });

  it("preserves close-on-success for CSV, AI, cleanup, and apply-workflow", () => {
    const generator = readRepo("components/admin/BulkLocationGenerator.tsx");
    expect(generator).toContain('onGenerated({ source: "csv" })');
    expect(generator).toContain('onGenerated({ source: "ai" })');
    expect(generator).toContain('onGenerated({ source: "cleanup" })');
    expect(generator).toContain('onGenerated({ source: "apply_workflow" })');
    expect(generator).not.toMatch(/onGenerated\(\)/);
  });

  it("session is component lifetime — no browser storage persistence APIs", () => {
    const generator = readRepo("components/admin/BulkLocationGenerator.tsx");
    const manager = readRepo("components/admin/AisleBayManager.tsx");
    const helper = readRepo("lib/store-ops/bulk-mapping-session.ts");
    for (const source of [generator, manager, helper]) {
      expect(source).not.toMatch(/\blocalStorage\b|\bsessionStorage\b/);
    }
  });

  it("does not introduce seasonal relevance into Bulk Generator", () => {
    const generator = readRepo("components/admin/BulkLocationGenerator.tsx");
    expect(generator).not.toMatch(
      /operational_context_location_relevance|location_relevance|seasonal/i
    );
    expect(generator).toContain("velocity_seed");
    expect(generator).toContain("parseVelocitySeedPreset");
  });

  it("keeps HubPortal sheet + Appliances workflow via selectDepartment", () => {
    const manager = readRepo("components/admin/AisleBayManager.tsx");
    const generator = readRepo("components/admin/BulkLocationGenerator.tsx");
    const helper = readRepo("lib/store-ops/bulk-mapping-session.ts");
    expect(manager).toContain("HubPortal");
    expect(manager).toContain("hub-modal-sheet");
    expect(manager).toContain('aria-label="Close bulk generator"');
    expect(generator).toContain("workflowTypeForDepartmentCode");
    expect(generator).toContain("selectDepartment");
    expect(helper).toContain("APPLIANCE_SIMS_AUDIT");
    expect(generator).toMatch(
      /useState<LocationWorkflowType>\(\(\) =>\s*workflowTypeForDepartmentCode\(departments\[0\]\?\.code\)/
    );
  });

  it("close/reopen remounts generator via conditional bulkOpen (new session)", () => {
    const manager = readRepo("components/admin/AisleBayManager.tsx");
    expect(manager).toMatch(/\{bulkOpen \? \(/);
    expect(manager).toContain("setBulkOpen(false)");
    expect(manager).toContain("setBulkOpen(true)");
    expect(manager).not.toMatch(/key=\{.*bulk/);
  });

  it("does not change bulk API auth or velocity persistence contracts", () => {
    const bulkApi = readRepo("app/api/store-locations/bulk/route.ts");
    expect(bulkApi).toContain("requireSuperAdmin");
    expect(bulkApi).toContain("velocity_seed");
    const generator = readRepo("components/admin/BulkLocationGenerator.tsx");
    expect(generator).not.toMatch(
      /IndexedDB|indexedDB|sessionStorage|localStorage/
    );
  });
});
