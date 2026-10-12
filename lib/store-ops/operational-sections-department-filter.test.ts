/**
 * OPERATIONAL-009 — sections list filter + race / empty-state contracts.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  classifySectionsEmptyState,
  resolveOperationalSectionsListFilter,
  shouldApplySectionsFetchResult,
} from "./operational-sections-department-filter";

const root = join(__dirname, "../..");

describe("resolveOperationalSectionsListFilter", () => {
  it("pin all never falls back to departments[0] — store-wide omit filter", () => {
    const filter = resolveOperationalSectionsListFilter({
      pinnedDepartmentId: undefined,
      workingScopeIsAll: true,
      departmentsLoaded: true,
    });
    expect(filter.storeWide).toBe(true);
    expect(filter.departmentId).toBeUndefined();
    expect(filter.awaitingResolution).toBe(false);
    expect(filter.canManageInDepartment).toBe(false);
  });

  it("pin all is ready before departments hydrate (no flash filter)", () => {
    const filter = resolveOperationalSectionsListFilter({
      pinnedDepartmentId: undefined,
      workingScopeIsAll: true,
      departmentsLoaded: false,
    });
    expect(filter.departmentId).toBeUndefined();
    expect(filter.awaitingResolution).toBe(false);
  });

  it("pinned department waits until departments load — no guessed id", () => {
    const filter = resolveOperationalSectionsListFilter({
      pinnedDepartmentId: undefined,
      workingScopeIsAll: false,
      departmentsLoaded: false,
    });
    expect(filter.awaitingResolution).toBe(true);
    expect(filter.departmentId).toBeUndefined();
    expect(filter.canManageInDepartment).toBe(false);
  });

  it("pinned flooring id filters that department only", () => {
    const flooring = "8d741e55-4dd8-40fc-ab24-89e63429e903";
    const filter = resolveOperationalSectionsListFilter({
      pinnedDepartmentId: flooring,
      workingScopeIsAll: false,
      departmentsLoaded: true,
    });
    expect(filter.departmentId).toBe(flooring);
    expect(filter.storeWide).toBe(false);
    expect(filter.canManageInDepartment).toBe(true);
  });
});

describe("shouldApplySectionsFetchResult (stale race)", () => {
  it("rejects stale unfiltered success after newer filtered request", () => {
    // Request 1 (unfiltered) finishes after request 2 started → ignore.
    expect(shouldApplySectionsFetchResult(1, 2)).toBe(false);
    expect(shouldApplySectionsFetchResult(2, 2)).toBe(true);
  });

  it("reproduces flash-then-disappear prevention contract", () => {
    let latest = 0;
    const apply = (id: number, sections: string[]) => {
      if (!shouldApplySectionsFetchResult(id, latest)) return null;
      return sections;
    };
    latest = 1;
    // First response (4 sections) is in-flight…
    latest = 2;
    // Second request started (would have been wrong dept → []).
    // Stale first response must not win after a newer empty either —
    // and a wrong empty must not clear if superseded. Here latest=2 wins.
    expect(apply(1, ["a", "b", "c", "d"])).toBeNull();
    expect(apply(2, ["a", "b", "c", "d"])).toEqual(["a", "b", "c", "d"]);
  });
});

describe("classifySectionsEmptyState", () => {
  const storeWide = resolveOperationalSectionsListFilter({
    pinnedDepartmentId: undefined,
    workingScopeIsAll: true,
    departmentsLoaded: true,
  });
  const flooring = resolveOperationalSectionsListFilter({
    pinnedDepartmentId: "flooring-id",
    workingScopeIsAll: false,
    departmentsLoaded: true,
  });

  it("distinguishes filtered empty from none configured", () => {
    expect(
      classifySectionsEmptyState({
        loading: false,
        error: null,
        sectionCount: 0,
        filter: flooring,
      })
    ).toBe("none_in_department");
    expect(
      classifySectionsEmptyState({
        loading: false,
        error: null,
        sectionCount: 0,
        filter: storeWide,
      })
    ).toBe("none_configured");
  });

  it("load error is not presented as empty success", () => {
    expect(
      classifySectionsEmptyState({
        loading: false,
        error: "network",
        sectionCount: 0,
        filter: storeWide,
      })
    ).toBe("error");
  });
});

describe("OperationalSectionsPanel source contracts", () => {
  const panel = readFileSync(
    join(root, "components/admin/OperationalSectionsPanel.tsx"),
    "utf8"
  );

  it("does not coerce pin all to departments[0]", () => {
    expect(panel).not.toMatch(/departments\[0\]\s*\?\?\s*departments\[0\]/);
    expect(panel).not.toMatch(
      /workingDepartmentId\([^)]+\)\s*\?\?\s*departments\[0\]/
    );
    expect(panel).toMatch(/resolveOperationalSectionsListFilter/);
    expect(panel).toMatch(/shouldApplySectionsFetchResult/);
  });

  it("distinguishes filtered empty copy from none configured", () => {
    expect(panel).toMatch(/sections-empty-filtered/);
    expect(panel).toMatch(/sections-empty/);
    expect(panel).toMatch(/sections-load-failed/);
  });
});
