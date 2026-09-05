/**
 * FS-001A fiscal calendar coverage tests.
 * Synthetic fixtures only — NOT Lowe’s production fiscal calendar data.
 */

import { describe, expect, it } from "vitest";
import { createFakeFiscalDb } from "./fiscal-calendar.fake";
import {
  addDaysToOperationalDate,
  buildSyntheticFiscalCalendarImport,
  computeFiscalCoverage,
  computeFiscalCoverageFromYears,
  FISCAL_COVERAGE_ATTENTION_DAYS,
  FISCAL_COVERAGE_URGENT_DAYS,
  importFiscalCalendar,
  type FiscalYear,
} from "./fiscal-calendar";
import { requireSuperAdmin, requireStoreOpsActor, StoreOpsAuthError } from "./auth";
import type { StoreOpsActor } from "./auth";

function yearFromImport(
  fiscalYear: number,
  startDate: string,
  weekCount: 52 | 53 = 52
): FiscalYear {
  const input = buildSyntheticFiscalCalendarImport({
    fiscalYear,
    startDate,
    weekCount,
  });
  return {
    id: `fy-${fiscalYear}`,
    fiscal_year: input.fiscal_year,
    start_date: input.start_date,
    end_date: input.end_date,
    week_count: input.week_count,
    source_type: input.source_type,
    source_reference: input.source_reference ?? null,
    source_year: input.source_year ?? null,
    declared_by: input.declared_by ?? null,
    created_at: "2090-01-01T00:00:00.000Z",
    updated_at: "2090-01-01T00:00:00.000Z",
  };
}

describe("FS-001A fiscal calendar coverage", () => {
  it("A. healthy when next year absent and days_remaining > 90", () => {
    const y2026 = yearFromImport(2090, "2090-02-06", 52);
    // Mid-year: far from end.
    const op = "2090-06-01";
    const coverage = computeFiscalCoverageFromYears([y2026], op);
    expect(coverage.days_remaining).toBeGreaterThan(FISCAL_COVERAGE_ATTENTION_DAYS);
    expect(coverage.status).toBe("HEALTHY");
    expect(coverage.next_fiscal_year).toBe(2091);
    expect(coverage.next_fiscal_year_loaded).toBe(false);
    expect(coverage.reason_codes).toContain("NEXT_YEAR_MISSING");
    expect(coverage.reason_codes).not.toContain("COVERAGE_ATTENTION");
  });

  it("B. attention when next year absent and days 31–90", () => {
    const y = yearFromImport(2091, "2091-02-05", 52);
    const op = addDaysToOperationalDate(y.end_date, -60);
    const coverage = computeFiscalCoverageFromYears([y], op);
    expect(coverage.days_remaining).toBe(60);
    expect(coverage.days_remaining).toBeGreaterThan(FISCAL_COVERAGE_URGENT_DAYS);
    expect(coverage.days_remaining).toBeLessThanOrEqual(
      FISCAL_COVERAGE_ATTENTION_DAYS
    );
    expect(coverage.status).toBe("ATTENTION");
    expect(coverage.reason_codes).toContain("COVERAGE_ATTENTION");
    expect(coverage.reason_codes).toContain("NEXT_YEAR_MISSING");
  });

  it("C. urgent when next year absent and days 0–30", () => {
    const y = yearFromImport(2092, "2092-02-04", 52);
    const op = addDaysToOperationalDate(y.end_date, -21);
    const coverage = computeFiscalCoverageFromYears([y], op);
    expect(coverage.days_remaining).toBe(21);
    expect(coverage.status).toBe("URGENT");
    expect(coverage.reason_codes).toContain("COVERAGE_URGENT");
  });

  it("D. healthy near end when next year loaded and contiguous", () => {
    const y1 = yearFromImport(2093, "2093-02-02", 52);
    const y2Start = addDaysToOperationalDate(y1.end_date, 1);
    const y2 = yearFromImport(2094, y2Start, 52);
    const op = addDaysToOperationalDate(y1.end_date, -10);
    const coverage = computeFiscalCoverageFromYears([y1, y2], op);
    expect(coverage.next_fiscal_year_loaded).toBe(true);
    expect(coverage.status).toBe("HEALTHY");
    expect(coverage.reason_codes).toContain("NEXT_YEAR_LOADED");
    expect(coverage.coverage_end_date).toBe(y2.end_date);
    expect(coverage.days_remaining).toBeGreaterThan(10);
  });

  it("E. expired when operational_date after coverage end", () => {
    const y = yearFromImport(2095, "2095-02-01", 52);
    const op = addDaysToOperationalDate(y.end_date, 1);
    const coverage = computeFiscalCoverageFromYears([y], op);
    expect(coverage.status).toBe("EXPIRED");
    expect(coverage.current_fiscal_year).toBeNull();
    expect(coverage.reason_codes).toContain("COVERAGE_EXPIRED");
    expect(coverage.next_fiscal_year).toBe(2096);
    expect(coverage.next_fiscal_year_loaded).toBe(false);
  });

  it("F. gap: FY N and FY N+2 without N+1 is not continuous next-year coverage", () => {
    const y2026 = yearFromImport(2100, "2100-02-01", 52);
    const y2028Start = addDaysToOperationalDate(y2026.end_date, 1 + 7 * 52);
    const y2028 = yearFromImport(2102, y2028Start, 52);
    const op = "2100-06-15";
    const coverage = computeFiscalCoverageFromYears([y2026, y2028], op);
    expect(coverage.current_fiscal_year).toBe(2100);
    expect(coverage.next_fiscal_year).toBe(2101);
    expect(coverage.next_fiscal_year_loaded).toBe(false);
    expect(coverage.reason_codes).toContain("GAP_AFTER_LAST_YEAR");
    expect(coverage.reason_codes).toContain("NEXT_YEAR_MISSING");
    // Contiguous horizon ends at FY2100 — not FY2102.
    expect(coverage.coverage_end_date).toBe(y2026.end_date);
    // Near mid-year still HEALTHY by days, but must not claim next loaded.
    expect(coverage.next_fiscal_year_loaded).toBe(false);
  });

  it("F2. gap inside missing year is EXPIRED with GAP_AFTER_LAST_YEAR", () => {
    const y2026 = yearFromImport(2103, "2103-02-04", 52);
    const y2028 = yearFromImport(
      2105,
      addDaysToOperationalDate(y2026.end_date, 1 + 7 * 52),
      52
    );
    const op = addDaysToOperationalDate(y2026.end_date, 5);
    const coverage = computeFiscalCoverageFromYears([y2026, y2028], op);
    expect(coverage.status).toBe("EXPIRED");
    expect(coverage.current_fiscal_year).toBeNull();
    expect(coverage.next_fiscal_year).toBe(2104);
    expect(coverage.next_fiscal_year_loaded).toBe(false);
    expect(coverage.reason_codes).toContain("GAP_AFTER_LAST_YEAR");
    expect(coverage.reason_codes).toContain("COVERAGE_EXPIRED");
  });

  it("G. 53-week calendar uses envelope dates for coverage math", () => {
    const y = yearFromImport(2106, "2106-02-03", 53);
    expect(y.week_count).toBe(53);
    const op = y.start_date;
    const coverage = computeFiscalCoverageFromYears([y], op);
    expect(coverage.coverage_end_date).toBe(y.end_date);
    expect(coverage.days_remaining).toBe(inclusiveDaysMinusOne(y.start_date, y.end_date));
    expect(coverage.status).toBe("HEALTHY");
  });

  it("H. empty authoritative calendar returns safe EXPIRED state", () => {
    const coverage = computeFiscalCoverageFromYears([], "2026-09-05");
    expect(coverage.status).toBe("EXPIRED");
    expect(coverage.current_fiscal_year).toBeNull();
    expect(coverage.reason_codes).toContain("NO_AUTHORITATIVE_CALENDAR");
    expect(coverage.next_fiscal_year).toBeNull();
  });

  it("schema missing returns SCHEMA_UNAVAILABLE without inventing a year", async () => {
    const db = createFakeFiscalDb();
    db.setMissingRelation(true);
    const result = await computeFiscalCoverage(db.client, {
      operationalDate: "2026-09-05",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect("missingRelation" in result && result.missingRelation).toBe(true);
    if (!("coverage" in result)) return;
    expect(result.coverage.reason_codes).toContain("SCHEMA_UNAVAILABLE");
    expect(result.coverage.current_fiscal_year).toBeNull();
  });

  it("async computeFiscalCoverage loads years from DB", async () => {
    const db = createFakeFiscalDb();
    const input = buildSyntheticFiscalCalendarImport({
      fiscalYear: 2110,
      startDate: "2110-02-05",
      weekCount: 52,
    });
    await importFiscalCalendar(db.client, input);
    const result = await computeFiscalCoverage(db.client, {
      operationalDate: "2110-03-01",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.coverage.current_fiscal_year).toBe(2110);
    expect(result.coverage.status).toBe("HEALTHY");
  });
});

function inclusiveDaysMinusOne(start: string, end: string): number {
  const [ys, ms, ds] = start.split("-").map(Number) as [number, number, number];
  const [ye, me, de] = end.split("-").map(Number) as [number, number, number];
  const a = Date.UTC(ys, ms - 1, ds);
  const b = Date.UTC(ye, me - 1, de);
  return Math.floor((b - a) / 86_400_000);
}

describe("FS-001A Master-only coverage authorization", () => {
  const master: StoreOpsActor = {
    userId: "u-master",
    specialistId: "s-master",
    role: "super_admin",
    departmentCode: null,
    accessibleDepartmentCodes: [],
    storeNumber: "2587",
  };
  const supervisor: StoreOpsActor = {
    userId: "u-ds",
    specialistId: "s-ds",
    role: "department_supervisor",
    departmentCode: "flooring",
    accessibleDepartmentCodes: ["flooring"],
    storeNumber: "2587",
  };

  it("unauthenticated → 401 via requireStoreOpsActor", () => {
    expect(() => requireStoreOpsActor(null)).toThrow(StoreOpsAuthError);
    try {
      requireStoreOpsActor(null);
    } catch (err) {
      expect((err as StoreOpsAuthError).status).toBe(401);
    }
  });

  it("Supervisor → 403 via requireSuperAdmin", () => {
    expect(() => requireSuperAdmin(supervisor)).toThrow(StoreOpsAuthError);
    try {
      requireSuperAdmin(supervisor);
    } catch (err) {
      expect((err as StoreOpsAuthError).status).toBe(403);
    }
  });

  it("Master → allowed through requireSuperAdmin", () => {
    expect(requireSuperAdmin(master)).toEqual(master);
  });

  it("coverage route source enforces Master-only actor chain", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.resolve(
        __dirname,
        "../../app/api/admin/fiscal-calendar/coverage/route.ts"
      ),
      "utf8"
    );
    expect(source).toMatch(/requireSuperAdmin/);
    expect(source).toMatch(/requireStoreOpsActor/);
    expect(source).toMatch(/resolveStoreOpsActor/);
    expect(source).toMatch(/computeFiscalCoverage/);
    expect(source).not.toMatch(/importFiscalCalendar/);
    expect(source).not.toMatch(/vendorgateway\.lowes\.com/);
  });
});

describe("FS-001A rotation independence", () => {
  it("rotation engine does not import fiscal coverage", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const rotations = await fs.readFile(
      path.resolve(__dirname, "rotations.ts"),
      "utf8"
    );
    const sunday = await fs.readFile(
      path.resolve(__dirname, "sunday-schedule.ts"),
      "utf8"
    );
    expect(rotations).not.toMatch(/computeFiscalCoverage/);
    expect(rotations).not.toMatch(/fiscal-calendar/);
    expect(sunday).not.toMatch(/computeFiscalCoverage/);
  });
});
