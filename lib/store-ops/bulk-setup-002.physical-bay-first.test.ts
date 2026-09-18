/**
 * BULK-SETUP-002 — physical-bay-first Bulk Generator.
 *
 * Normal topology setup: Department · Aisle · Bay range · Odd/Even · Preview · Create.
 * Internal representation: SELLING + TOPSTOCK. AI Pre-Flight retired.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { expandBayNumbers } from "./bay-pattern";
import {
  formatManualBulkSavedMessage,
  NORMAL_BULK_SURFACE_TYPES,
  shouldCloseBulkGeneratorAfterGenerated,
} from "./bulk-mapping-session";
import { buildBulkLocationRows } from "./locations";
import { velocitySeedFromPreset } from "./velocity";

const root = path.resolve(__dirname, "../..");

function readRepo(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf8");
}

function repoExists(relativePath: string): boolean {
  return existsSync(path.join(root, relativePath));
}

describe("BULK-SETUP-002 normal Bulk UI", () => {
  const generator = readRepo("components/admin/BulkLocationGenerator.tsx");

  it("no longer mounts Location Type radios or Selling-only / Topstock-only choices", () => {
    expect(generator).not.toMatch(/name="bulk-location-type"/);
    expect(generator).not.toMatch(/name="cleanup-location-type"/);
    expect(generator).not.toMatch(/Both \(Selling \+ Topstock\)/);
    expect(generator).not.toMatch(/Location type/);
    expect(generator).not.toMatch(/setLocationMode/);
    expect(generator).not.toMatch(/locationMode/);
    expect(generator).toContain("NORMAL_BULK_SURFACE_TYPES");
  });

  it("no longer mounts AI Pre-Flight", () => {
    expect(generator).not.toMatch(/AI Pre-Flight/);
    expect(generator).not.toMatch(/Parse with AI/);
    expect(generator).not.toMatch(/Confirm & Bulk Create/);
    expect(generator).not.toMatch(/aiParseLocations/);
    expect(generator).not.toMatch(/tab === "ai"/);
    expect(generator).not.toMatch(/setAiPreview|setAiText|setAiCorrections/);
  });

  it("preview speaks physical bays", () => {
    expect(generator).toContain('data-testid="bulk-physical-bay-preview"');
    expect(generator).toMatch(/physical bay/);
    expect(generator).toContain("Create physical bays");
    expect(formatManualBulkSavedMessage({
      physicalBays: 8,
      departmentName: "Flooring",
      aisle: "12",
    })).toBe("8 physical bays saved · Flooring · 12");
  });

  it("retains Manual/CSV and Clean-Up modes only", () => {
    expect(generator).toMatch(/Manual \/ CSV/);
    expect(generator).toMatch(/Clean-Up/);
    expect(generator).toMatch(/type GeneratorTab = "manual" \| "cleanup"/);
  });
});

describe("BULK-SETUP-002 internal BOTH creation", () => {
  it("normal surface types are SELLING + TOPSTOCK", () => {
    expect(NORMAL_BULK_SURFACE_TYPES).toEqual(["SELLING", "TOPSTOCK"]);
  });

  it("one physical bay expands to two surface rows after Odd filter", () => {
    const bays = expandBayNumbers(1, 1, "odd");
    expect(bays).toEqual([1]);
    const rows = buildBulkLocationRows({
      store_id: "store-1",
      department_id: "dept-1",
      aisle: "12",
      start_bay: 1,
      end_bay: 1,
      types: NORMAL_BULK_SURFACE_TYPES,
      bay_pattern: "odd",
      velocity_seed: "standard",
    });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.type).sort()).toEqual(["SELLING", "TOPSTOCK"]);
    expect(rows.every((r) => r.bay === 1)).toBe(true);
    expect(rows.every((r) => r.priority_override === false)).toBe(true);
    expect(rows.every((r) => r.velocity_tier === "standard")).toBe(true);
  });

  it("odd filtering happens before BOTH expansion", () => {
    const bays = expandBayNumbers(1, 10, "odd");
    expect(bays).toEqual([1, 3, 5, 7, 9]);
    const rows = buildBulkLocationRows({
      store_id: "store-1",
      department_id: "dept-1",
      aisle: "12",
      start_bay: 1,
      end_bay: 10,
      types: NORMAL_BULK_SURFACE_TYPES,
      bay_pattern: "odd",
    });
    expect(rows).toHaveLength(10); // 5 physical × 2 surfaces
    const physical = new Set(rows.map((r) => r.bay));
    expect([...physical].sort((a, b) => a - b)).toEqual([1, 3, 5, 7, 9]);
  });

  it("even filtering happens before BOTH expansion", () => {
    const bays = expandBayNumbers(1, 10, "even");
    expect(bays).toEqual([2, 4, 6, 8, 10]);
    const rows = buildBulkLocationRows({
      store_id: "store-1",
      department_id: "dept-1",
      aisle: "12",
      start_bay: 1,
      end_bay: 10,
      types: NORMAL_BULK_SURFACE_TYPES,
      bay_pattern: "even",
    });
    expect(rows).toHaveLength(10);
    expect(new Set(rows.map((r) => r.bay)).size).toBe(5);
  });

  it("new bulk rows begin Standard (priority_override false)", () => {
    expect(velocitySeedFromPreset("standard").priority_override).toBe(false);
    const generator = readRepo("components/admin/BulkLocationGenerator.tsx");
    expect(generator).toContain('parseVelocitySeedPreset("standard")');
    expect(generator).not.toMatch(/Priority Lock|priority_lock/);
  });

  it("API still accepts types for compatibility; UI forces BOTH on manual create", () => {
    const generator = readRepo("components/admin/BulkLocationGenerator.tsx");
    const handleStart = generator.indexOf("async function handleGenerate()");
    const handleEnd = generator.indexOf("async function handleCsvBatch()");
    const handleBody = generator.slice(handleStart, handleEnd);
    expect(handleBody).toContain("types: NORMAL_BULK_SURFACE_TYPES");
    expect(handleBody).toContain("expandBayNumbers");
    expect(handleBody).toContain("physicalBays");
  });
});

describe("BULK-SETUP-002 AI Pre-Flight retirement", () => {
  it("removes unique AI Pre-Flight route and helper", () => {
    expect(repoExists("app/api/store-locations/ai-parse/route.ts")).toBe(false);
    expect(repoExists("lib/store-ops/ai-parse.ts")).toBe(false);
    expect(readRepo("lib/store-ops/client.ts")).not.toMatch(/aiParseLocations/);
  });

  it("preserves Floor Pad / Walk & Talk Gemini consumers", () => {
    expect(repoExists("app/api/copilot/parse-walk/route.ts")).toBe(true);
    expect(repoExists("app/actions/manager-notes.ts")).toBe(true);
    expect(readRepo("app/actions/manager-notes.ts")).toContain(
      "callGeminiFlashJson"
    );
    expect(readRepo("app/api/copilot/parse-walk/route.ts")).toContain(
      "callGeminiFlashJson"
    );
    expect(readRepo("components/sections/SettingsSection.tsx")).toContain(
      'data-testid="more-executive-floor-pad"'
    );
  });

  it("preserves shared Gemini transport", () => {
    const transport = readRepo("lib/ai/gemini.ts");
    expect(transport).toContain("callGeminiFlashJson");
    expect(transport).toContain('import "server-only"');
  });
});

describe("BULK-SETUP-002 compatibility preservation", () => {
  it("Add Bay remains BOTH hardcoded", () => {
    const add = readRepo("components/admin/AddBaySheet.tsx");
    expect(add).toContain('types: ["SELLING", "TOPSTOCK"]');
  });

  it("one-surface buildBulkLocationRows still works", () => {
    const sellingOnly = buildBulkLocationRows({
      store_id: "store-1",
      department_id: "dept-1",
      aisle: "12",
      start_bay: 3,
      end_bay: 3,
      types: ["SELLING"],
      bay_pattern: "odd",
    });
    expect(sellingOnly).toHaveLength(1);
    expect(sellingOnly[0]?.type).toBe("SELLING");

    const topOnly = buildBulkLocationRows({
      store_id: "store-1",
      department_id: "dept-1",
      aisle: "12",
      start_bay: 4,
      end_bay: 4,
      types: ["TOPSTOCK"],
      bay_pattern: "even",
    });
    expect(topOnly).toHaveLength(1);
    expect(topOnly[0]?.type).toBe("TOPSTOCK");
  });

  it("bulk API auth remains Master-only (RBAC-TOPO-001 untouched)", () => {
    expect(readRepo("app/api/store-locations/bulk/route.ts")).toContain(
      "requireSuperAdmin"
    );
  });

  it("session close policy remains fail-closed for non-manual sources", () => {
    expect(shouldCloseBulkGeneratorAfterGenerated("manual")).toBe(false);
    expect(shouldCloseBulkGeneratorAfterGenerated("csv")).toBe(true);
    expect(shouldCloseBulkGeneratorAfterGenerated("cleanup")).toBe(true);
    expect(shouldCloseBulkGeneratorAfterGenerated("ai")).toBe(true);
  });
});
