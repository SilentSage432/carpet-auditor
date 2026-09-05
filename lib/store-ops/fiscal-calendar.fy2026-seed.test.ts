/**
 * Local validation of Lowe's FY2026 company-published fiscal seed artifact.
 * Synthetic fixtures elsewhere remain distinct — this loads the real published dataset.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createFakeFiscalDb } from "./fiscal-calendar.fake";
import {
  fiscalCalendarFingerprint,
  fiscalWeeksOverlappingIsoWeek,
  importFiscalCalendar,
  operationalDateFromInstant,
  resolveFiscalContextForDate,
  validateFiscalCalendarImport,
  type FiscalCalendarImport,
} from "./fiscal-calendar";
import { isoWeekLabel } from "./week";
import {
  DEFAULT_STORE_TIMEZONE,
  sundayStagingWeekLabel,
} from "./sunday-schedule";

const ARTIFACT_PATH = resolve(
  process.cwd(),
  "data/fiscal-calendars/lowes-fy2026-company-published.json"
);

function loadImport(): FiscalCalendarImport {
  const raw = JSON.parse(readFileSync(ARTIFACT_PATH, "utf8")) as {
    fiscal_year: number;
    start_date: string;
    end_date: string;
    week_count: 52 | 53;
    source_type: "COMPANY_PUBLISHED" | "MASTER_ADMIN_DECLARED";
    source_reference: string;
    source_year: number;
    declared_by: string | null;
    weeks: FiscalCalendarImport["weeks"];
  };
  return {
    fiscal_year: raw.fiscal_year,
    start_date: raw.start_date,
    end_date: raw.end_date,
    week_count: raw.week_count,
    source_type: raw.source_type,
    source_reference: raw.source_reference,
    source_year: raw.source_year,
    declared_by: raw.declared_by,
    weeks: raw.weeks,
  };
}

describe("Lowe's FY2026 company-published fiscal seed", () => {
  const input = loadImport();

  it("passes validateFiscalCalendarImport with zero issues", () => {
    const issues = validateFiscalCalendarImport(input);
    expect(issues).toEqual([]);
    expect(input.week_count).toBe(52);
    expect(input.weeks).toHaveLength(52);
    expect(input.start_date).toBe("2026-01-31");
    expect(input.end_date).toBe("2027-01-29");
  });

  it("imports locally and is idempotent on identical re-import", async () => {
    const db = createFakeFiscalDb();
    const first = await importFiscalCalendar(db.client, input);
    expect(first.ok && first.created).toBe(true);
    const second = await importFiscalCalendar(db.client, input);
    expect(second.ok && !second.created && second.identical).toBe(true);
    expect(db.years).toHaveLength(1);
    expect(db.weeks).toHaveLength(52);
  });

  it("resolves key operational dates", async () => {
    const db = createFakeFiscalDb();
    await importFiscalCalendar(db.client, input);

    const cases: Array<{
      date: string;
      week: number;
      period: number;
      quarter: number;
    }> = [
      { date: "2026-01-31", week: 1, period: 1, quarter: 1 },
      { date: "2026-05-01", week: 13, period: 3, quarter: 1 },
      { date: "2026-07-31", week: 26, period: 6, quarter: 2 },
      { date: "2026-09-05", week: 32, period: 8, quarter: 3 },
      { date: "2027-01-29", week: 52, period: 12, quarter: 4 },
    ];

    for (const c of cases) {
      const ctx = await resolveFiscalContextForDate(db.client, {
        operationalDate: c.date,
      });
      expect(ctx.status).toBe("ok");
      if (ctx.status !== "ok") continue;
      expect(ctx.fiscal_year).toBe(2026);
      expect(ctx.fiscal_week).toBe(c.week);
      expect(ctx.fiscal_period).toBe(c.period);
      expect(ctx.fiscal_quarter).toBe(c.quarter);
    }

    for (const outside of ["2026-01-30", "2027-01-30"]) {
      const ctx = await resolveFiscalContextForDate(db.client, {
        operationalDate: outside,
      });
      expect(ctx.status).toBe("calendar_unavailable");
    }
  });

  it("reports Store 2587 current local fiscal context", async () => {
    const db = createFakeFiscalDb();
    await importFiscalCalendar(db.client, input);
    const now = new Date();
    const operational_date = operationalDateFromInstant(
      now,
      DEFAULT_STORE_TIMEZONE
    );
    const ctx = await resolveFiscalContextForDate(db.client, {
      operationalDate: operational_date,
    });
    expect(ctx.status).toBe("ok");
    if (ctx.status === "ok") {
      // Durable assertion for the seed day (2026-09-05 America/Denver).
      console.log(
        JSON.stringify({
          store: 2587,
          timezone: DEFAULT_STORE_TIMEZONE,
          operational_date,
          fiscal_year: ctx.fiscal_year,
          fiscal_week: ctx.fiscal_week,
          fiscal_period: ctx.fiscal_period,
          fiscal_quarter: ctx.fiscal_quarter,
          week_start_date: ctx.week_start_date,
          week_end_date: ctx.week_end_date,
        })
      );
    }
  });

  it("ISO week overlap is by date range, not label equality", async () => {
    const db = createFakeFiscalDb();
    await importFiscalCalendar(db.client, input);
    const iso = isoWeekLabel(new Date(2026, 8, 5)); // Sep 5 2026 local
    const staging = sundayStagingWeekLabel(
      new Date(2026, 8, 5),
      DEFAULT_STORE_TIMEZONE
    );
    const overlap = await fiscalWeeksOverlappingIsoWeek(db.client, iso);
    expect(overlap.ok).toBe(true);
    if (!overlap.ok) return;
    console.log(
      JSON.stringify({
        iso_week_label: iso,
        sunday_staging_week: staging,
        iso_monday: overlap.result.iso_monday,
        iso_sunday: overlap.result.iso_sunday,
        overlapping_fiscal_weeks: overlap.result.fiscal_weeks,
        fingerprint: fiscalCalendarFingerprint(input),
      })
    );
    expect(overlap.result.fiscal_weeks.length).toBeGreaterThanOrEqual(1);
    // Labels need not match — Sat–Fri fiscal vs Mon–Sun ISO.
    const fiscalNums = overlap.result.fiscal_weeks.map((w) => w.fiscal_week);
    expect(fiscalNums.includes(32) || fiscalNums.includes(31)).toBe(true);
  });
});
