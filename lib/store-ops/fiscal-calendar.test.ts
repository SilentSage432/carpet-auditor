/**
 * FS-001 fiscal calendar tests.
 * Synthetic fixtures only — NOT Lowe’s production fiscal calendar data.
 */

import { describe, expect, it } from "vitest";
import { createFakeFiscalDb } from "./fiscal-calendar.fake";
import {
  buildSyntheticFiscalCalendarImport,
  fiscalCalendarFingerprint,
  fiscalWeeksOverlappingIsoWeek,
  importFiscalCalendar,
  isFiscalCalendarUnavailable,
  operationalDateFromInstant,
  resolveFiscalContextForDate,
  validateFiscalCalendarImport,
} from "./fiscal-calendar";
import { isoWeekLabel, parseIsoWeekLabel } from "./week";

/** Marker so suite readers never confuse fixtures with company truth. */
const SYNTHETIC_NOTE =
  "SYNTHETIC_TEST_FIXTURE — not Lowe's production calendar";

describe("FS-001 fiscal calendar (synthetic fixtures only)", () => {
  it("N. source-independent fixture is clearly synthetic", () => {
    const cal = buildSyntheticFiscalCalendarImport({
      fiscalYear: 2099,
      startDate: "2099-02-02",
      weekCount: 52,
    });
    expect(cal.source_reference).toContain("SYNTHETIC_TEST_FIXTURE");
    expect(cal.source_reference).toContain(SYNTHETIC_NOTE.split(" — ")[0]);
    expect(cal.source_type).toBe("MASTER_ADMIN_DECLARED");
  });

  it("A. valid 52-week import is accepted", async () => {
    const db = createFakeFiscalDb();
    const input = buildSyntheticFiscalCalendarImport({
      fiscalYear: 2099,
      startDate: "2099-02-02",
      weekCount: 52,
    });
    expect(validateFiscalCalendarImport(input)).toEqual([]);
    const result = await importFiscalCalendar(db.client, input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.created).toBe(true);
    expect(result.weeks).toHaveLength(52);
    expect(result.year.week_count).toBe(52);
  });

  it("B. valid 53-week import is accepted", async () => {
    const db = createFakeFiscalDb();
    const input = buildSyntheticFiscalCalendarImport({
      fiscalYear: 2098,
      startDate: "2098-02-03",
      weekCount: 53,
    });
    expect(validateFiscalCalendarImport(input)).toEqual([]);
    const result = await importFiscalCalendar(db.client, input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.weeks).toHaveLength(53);
  });

  it("C. duplicate fiscal week is rejected", () => {
    const input = buildSyntheticFiscalCalendarImport({
      fiscalYear: 2097,
      startDate: "2097-02-03",
      weekCount: 52,
    });
    input.weeks[5] = { ...input.weeks[5]!, fiscal_week: 1 };
    const issues = validateFiscalCalendarImport(input);
    expect(issues.some((i) => i.code === "duplicate_fiscal_week")).toBe(true);
  });

  it("D. missing week / gap is rejected", () => {
    const input = buildSyntheticFiscalCalendarImport({
      fiscalYear: 2096,
      startDate: "2096-02-05",
      weekCount: 52,
    });
    // Create a gap by shifting week 10 start forward without fixing prior end.
    input.weeks[9] = {
      ...input.weeks[9]!,
      start_date: "2096-04-20",
      end_date: "2096-04-26",
    };
    const issues = validateFiscalCalendarImport(input);
    expect(
      issues.some((i) => i.code === "week_gap" || i.code === "week_overlap")
    ).toBe(true);
  });

  it("E. overlapping week dates are rejected", () => {
    const input = buildSyntheticFiscalCalendarImport({
      fiscalYear: 2095,
      startDate: "2095-02-06",
      weekCount: 52,
    });
    input.weeks[2] = {
      ...input.weeks[2]!,
      start_date: input.weeks[1]!.start_date,
      end_date: input.weeks[1]!.end_date,
    };
    const issues = validateFiscalCalendarImport(input);
    expect(
      issues.some(
        (i) =>
          i.code === "week_overlap" ||
          i.code === "week_gap" ||
          i.code === "week_not_seven_days"
      )
    ).toBe(true);
  });

  it("F. wrong week count is rejected", () => {
    const input = buildSyntheticFiscalCalendarImport({
      fiscalYear: 2094,
      startDate: "2094-02-07",
      weekCount: 52,
    });
    input.week_count = 53;
    const issues = validateFiscalCalendarImport(input);
    expect(issues.some((i) => i.code === "week_count_mismatch")).toBe(true);
  });

  it("G. invalid quarter/period is rejected", () => {
    const input = buildSyntheticFiscalCalendarImport({
      fiscalYear: 2093,
      startDate: "2093-02-01",
      weekCount: 52,
    });
    input.weeks[0] = { ...input.weeks[0]!, fiscal_quarter: 9 };
    expect(
      validateFiscalCalendarImport(input).some((i) => i.code === "invalid_quarter")
    ).toBe(true);

    const input2 = buildSyntheticFiscalCalendarImport({
      fiscalYear: 2092,
      startDate: "2092-02-03",
      weekCount: 52,
    });
    input2.weeks[0] = { ...input2.weeks[0]!, fiscal_period: 0 };
    expect(
      validateFiscalCalendarImport(input2).some((i) => i.code === "invalid_period")
    ).toBe(true);
  });

  it("H. existing fiscal year collision does not silently overwrite", async () => {
    const db = createFakeFiscalDb();
    const first = buildSyntheticFiscalCalendarImport({
      fiscalYear: 2091,
      startDate: "2091-02-04",
      weekCount: 52,
      source_reference: "first-import",
    });
    const created = await importFiscalCalendar(db.client, first);
    expect(created.ok && created.created).toBe(true);

    const second = buildSyntheticFiscalCalendarImport({
      fiscalYear: 2091,
      startDate: "2091-02-11",
      weekCount: 52,
      source_reference: "different-import",
    });
    const collision = await importFiscalCalendar(db.client, second);
    expect(collision.ok).toBe(false);
    if (collision.ok) return;
    expect(collision.code).toBe("year_exists");
    expect(db.years).toHaveLength(1);
    expect(db.years[0]!.source_reference).toBe("first-import");
  });

  it("H2. identical re-import is idempotent no-op", async () => {
    const db = createFakeFiscalDb();
    const input = buildSyntheticFiscalCalendarImport({
      fiscalYear: 2090,
      startDate: "2090-02-05",
      weekCount: 52,
    });
    const a = await importFiscalCalendar(db.client, input);
    const b = await importFiscalCalendar(db.client, input);
    expect(a.ok && a.created).toBe(true);
    expect(b.ok && !b.created && b.identical).toBe(true);
    expect(db.years).toHaveLength(1);
  });

  it("I. known date resolves exact fiscal year/week/period/quarter", async () => {
    const db = createFakeFiscalDb();
    const input = buildSyntheticFiscalCalendarImport({
      fiscalYear: 2089,
      startDate: "2089-02-07",
      weekCount: 52,
    });
    await importFiscalCalendar(db.client, input);
    const week3 = input.weeks[2]!;
    const mid = week3.start_date;
    const ctx = await resolveFiscalContextForDate(db.client, {
      operationalDate: mid,
    });
    expect(ctx.status).toBe("ok");
    if (ctx.status !== "ok") return;
    expect(ctx.fiscal_year).toBe(2089);
    expect(ctx.fiscal_week).toBe(3);
    expect(ctx.fiscal_period).toBe(week3.fiscal_period);
    expect(ctx.fiscal_quarter).toBe(week3.fiscal_quarter);
    expect(ctx.week_start_date).toBe(week3.start_date);
    expect(ctx.week_end_date).toBe(week3.end_date);
  });

  it("J. missing date coverage returns calendar_unavailable", async () => {
    const db = createFakeFiscalDb();
    const input = buildSyntheticFiscalCalendarImport({
      fiscalYear: 2088,
      startDate: "2088-02-02",
      weekCount: 52,
    });
    await importFiscalCalendar(db.client, input);
    const ctx = await resolveFiscalContextForDate(db.client, {
      operationalDate: "2000-01-01",
    });
    expect(ctx.status).toBe("calendar_unavailable");
    if (ctx.status !== "calendar_unavailable") return;
    expect(ctx.reason.toLowerCase()).toContain("no authoritative");
  });

  it("K. instant near UTC midnight resolves by store timezone", () => {
    // 2026-03-15T06:30:00Z = still Mar 14 evening in America/Los_Angeles,
    // already Mar 15 morning in America/New_York.
    const instant = new Date("2026-03-15T06:30:00.000Z");
    const la = operationalDateFromInstant(instant, "America/Los_Angeles");
    const ny = operationalDateFromInstant(instant, "America/New_York");
    expect(la).toBe("2026-03-14");
    expect(ny).toBe("2026-03-15");
  });

  it("L. ISO week helpers retain current behavior", () => {
    // Fixed calendar date → stable ISO label (host-date components → UTC week math).
    const label = isoWeekLabel(new Date(2026, 7, 31)); // Aug 31 2026 local
    expect(label).toMatch(/^2026-W\d{2}$/);
    const parsed = parseIsoWeekLabel(label);
    expect(parsed.year).toBe(2026);
    expect(parsed.week).toBeGreaterThanOrEqual(1);
    expect(parsed.week).toBeLessThanOrEqual(53);
    expect(() => parseIsoWeekLabel("not-a-week")).toThrow();
  });

  it("M. imported calendar preserves provenance", async () => {
    const db = createFakeFiscalDb();
    const input = buildSyntheticFiscalCalendarImport({
      fiscalYear: 2087,
      startDate: "2087-02-02",
      weekCount: 52,
      source_type: "COMPANY_PUBLISHED",
      source_reference: "synthetic-company-ref-2087",
      declared_by: "master-test",
    });
    input.source_year = 2087;
    const result = await importFiscalCalendar(db.client, input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.year.source_type).toBe("COMPANY_PUBLISHED");
    expect(result.year.source_reference).toBe("synthetic-company-ref-2087");
    expect(result.year.source_year).toBe(2087);
    expect(result.year.declared_by).toBe("master-test");
    expect(fiscalCalendarFingerprint(input)).toContain("COMPANY_PUBLISHED");
  });

  it("ISO↔fiscal overlap uses date ranges (not arithmetic conversion)", async () => {
    const db = createFakeFiscalDb();
    const input = buildSyntheticFiscalCalendarImport({
      fiscalYear: 2086,
      startDate: "2086-02-03",
      weekCount: 52,
    });
    await importFiscalCalendar(db.client, input);
    const monday = input.weeks[0]!.start_date;
    // Build an ISO label that covers the same Monday via isoWeekLabel on that Y-M-D.
    const [y, m, d] = monday.split("-").map(Number) as [number, number, number];
    const iso = isoWeekLabel(new Date(y, m - 1, d));
    const overlap = await fiscalWeeksOverlappingIsoWeek(db.client, iso);
    expect(overlap.ok).toBe(true);
    if (!overlap.ok) return;
    expect(overlap.result.fiscal_weeks.length).toBeGreaterThanOrEqual(1);
  });

  it("missing relation classification is narrow", () => {
    expect(
      isFiscalCalendarUnavailable({
        code: "42P01",
        message: 'relation "public.fiscal_years" does not exist',
      })
    ).toBe(true);
    expect(
      isFiscalCalendarUnavailable({
        code: "42P01",
        message: 'relation "public.weekly_rotations" does not exist',
      })
    ).toBe(false);
    expect(
      isFiscalCalendarUnavailable({
        code: "42703",
        message: 'column "fiscal_years.bogus" does not exist',
      })
    ).toBe(false);
  });

  it("resolve returns unavailable when schema missing", async () => {
    const db = createFakeFiscalDb();
    db.setMissingRelation(true);
    const ctx = await resolveFiscalContextForDate(db.client, {
      operationalDate: "2026-09-05",
    });
    expect(ctx.status).toBe("calendar_unavailable");
  });
});
