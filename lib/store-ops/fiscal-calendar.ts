/**
 * FS-001 Fiscal calendar foundation.
 * Authoritative imported fiscal years/weeks — parallel to ISO rotation weeks.
 * Does not invent missing calendar periods. Does not mutate assigned_week.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { readableError } from "./errors";
import {
  isoWeekToMondayDate,
  parseIsoWeekLabel,
} from "./week";
import {
  normalizeStoreTimezone,
  zonedParts,
} from "./sunday-schedule";

export const FISCAL_YEARS_TABLE = "fiscal_years" as const;
export const FISCAL_WEEKS_TABLE = "fiscal_weeks" as const;

/** Accepted authoritative calendar sources (not SYSTEM_DERIVED drafts). */
export type FiscalCalendarSource =
  | "COMPANY_PUBLISHED"
  | "MASTER_ADMIN_DECLARED";

export type FiscalYear = {
  id: string;
  fiscal_year: number;
  start_date: string;
  end_date: string;
  week_count: number;
  source_type: FiscalCalendarSource;
  source_reference: string | null;
  source_year: number | null;
  declared_by: string | null;
  created_at: string;
  updated_at: string;
};

export type FiscalWeek = {
  id: string;
  fiscal_year_id: string;
  fiscal_week: number;
  fiscal_quarter: number;
  fiscal_period: number;
  start_date: string;
  end_date: string;
  created_at: string;
};

export type FiscalCalendarImportWeek = {
  fiscal_week: number;
  fiscal_quarter: number;
  fiscal_period: number;
  start_date: string;
  end_date: string;
};

export type FiscalCalendarImport = {
  fiscal_year: number;
  start_date: string;
  end_date: string;
  week_count: 52 | 53;
  source_type: FiscalCalendarSource;
  source_reference?: string | null;
  source_year?: number | null;
  declared_by?: string | null;
  weeks: FiscalCalendarImportWeek[];
};

export type FiscalContext = {
  status: "ok";
  fiscal_year: number;
  fiscal_week: number;
  fiscal_period: number;
  fiscal_quarter: number;
  week_start_date: string;
  week_end_date: string;
  fiscal_year_id: string;
  fiscal_week_id: string;
  source_type: FiscalCalendarSource;
  source_reference: string | null;
  source_year: number | null;
  operational_date: string;
};

export type FiscalContextUnavailable = {
  status: "calendar_unavailable";
  operational_date: string;
  reason: string;
};

export type FiscalContextResult = FiscalContext | FiscalContextUnavailable;

export type FiscalImportResult =
  | {
      ok: true;
      created: true;
      year: FiscalYear;
      weeks: FiscalWeek[];
    }
  | {
      ok: true;
      created: false;
      identical: true;
      year: FiscalYear;
      weeks: FiscalWeek[];
    }
  | {
      ok: false;
      code:
        | "validation_failed"
        | "year_exists"
        | "missing_relation"
        | "write_failed";
      message: string;
      details?: string[];
    };

/** Classic 4-5-4 week counts per retail period (52-week years). */
export const RETAIL_454_PERIOD_LENGTHS: readonly number[] = [
  4, 5, 4, 4, 5, 4, 4, 5, 4, 4, 5, 4,
] as const;

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isFiscalCalendarSource(
  raw: unknown
): raw is FiscalCalendarSource {
  return raw === "COMPANY_PUBLISHED" || raw === "MASTER_ADMIN_DECLARED";
}

export function parseOperationalDate(raw: string): string | null {
  const m = YMD_RE.exec(String(raw ?? "").trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isInteger(y) || !Number.isInteger(mo) || !Number.isInteger(d)) {
    return null;
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const utc = new Date(Date.UTC(y, mo - 1, d));
  if (
    utc.getUTCFullYear() !== y ||
    utc.getUTCMonth() !== mo - 1 ||
    utc.getUTCDate() !== d
  ) {
    return null;
  }
  return `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function addDaysToOperationalDate(ymd: string, days: number): string {
  const parsed = parseOperationalDate(ymd);
  if (!parsed) throw new Error(`Invalid operational date: ${ymd}`);
  const [y, m, d] = parsed.split("-").map(Number) as [number, number, number];
  const utc = new Date(Date.UTC(y, m - 1, d + days));
  return `${utc.getUTCFullYear()}-${String(utc.getUTCMonth() + 1).padStart(2, "0")}-${String(utc.getUTCDate()).padStart(2, "0")}`;
}

export function compareOperationalDates(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** Inclusive day count for a closed date range. */
export function inclusiveDayCount(start: string, end: string): number {
  const s = parseOperationalDate(start);
  const e = parseOperationalDate(end);
  if (!s || !e) return Number.NaN;
  const [ys, ms, ds] = s.split("-").map(Number) as [number, number, number];
  const [ye, me, de] = e.split("-").map(Number) as [number, number, number];
  const a = Date.UTC(ys, ms - 1, ds);
  const b = Date.UTC(ye, me - 1, de);
  return Math.floor((b - a) / 86_400_000) + 1;
}

/**
 * Store-local YYYY-MM-DD from an instant.
 * Uses stores.timezone — never UTC midnight as the retail day boundary.
 */
export function operationalDateFromInstant(
  instant: Date | string,
  timeZone: string
): string {
  const date =
    typeof instant === "string" ? new Date(instant) : instant;
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new Error("Invalid instant for operational date");
  }
  const parts = zonedParts(date, normalizeStoreTimezone(timeZone));
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function errorCode(error: unknown): string {
  return String((error as { code?: unknown } | null)?.code ?? "");
}

function errorMessageLower(error: unknown): string {
  return readableError(error, "").toLowerCase();
}

function messageNamesFiscalTable(msg: string): boolean {
  return (
    msg.includes(FISCAL_YEARS_TABLE) ||
    msg.includes(FISCAL_WEEKS_TABLE) ||
    msg.includes(`public.${FISCAL_YEARS_TABLE}`) ||
    msg.includes(`public.${FISCAL_WEEKS_TABLE}`)
  );
}

/**
 * True only when PostgREST/Postgres reports fiscal calendar tables absent.
 * Missing columns / permissions / other tables must not soft-skip.
 */
export function isFiscalCalendarUnavailable(error: unknown): boolean {
  const code = errorCode(error);
  const msg = errorMessageLower(error);

  if (code === "42703" || code === "PGRST204") return false;
  if (/\bcolumn\b/.test(msg) && msg.includes("does not exist")) return false;

  const namesTable = messageNamesFiscalTable(msg);
  if (code === "42P01" || code === "PGRST205") {
    return namesTable;
  }
  if (
    namesTable &&
    (msg.includes("could not find the table") ||
      (msg.includes("schema cache") && msg.includes("could not find")))
  ) {
    return true;
  }
  return false;
}

export type FiscalValidationIssue = { code: string; message: string };

/**
 * Pure validation of an imported fiscal calendar.
 *
 * Policy:
 * - Contiguous, sequential, no gaps/overlaps; each week exactly 7 days.
 * - First/last weeks match year start/end; week_count matches weeks.length.
 * - Quarters 1–4, periods 1–12 as supplied (importer does not invent mapping).
 * - 52-week years: period lengths must match classic 4-5-4 RETAIL_454_PERIOD_LENGTHS.
 * - 53-week years: integrity rules only; extra week’s period/quarter must be
 *   declared by the source — no algorithmic reallocation.
 */
export function validateFiscalCalendarImport(
  input: FiscalCalendarImport
): FiscalValidationIssue[] {
  const issues: FiscalValidationIssue[] = [];

  if (!Number.isInteger(input.fiscal_year) || input.fiscal_year < 1900) {
    issues.push({
      code: "invalid_fiscal_year",
      message: "fiscal_year must be an integer >= 1900",
    });
  }
  if (input.week_count !== 52 && input.week_count !== 53) {
    issues.push({
      code: "invalid_week_count",
      message: "week_count must be 52 or 53",
    });
  }
  if (!isFiscalCalendarSource(input.source_type)) {
    issues.push({
      code: "invalid_source_type",
      message: "source_type must be COMPANY_PUBLISHED or MASTER_ADMIN_DECLARED",
    });
  }

  const yearStart = parseOperationalDate(input.start_date);
  const yearEnd = parseOperationalDate(input.end_date);
  if (!yearStart) {
    issues.push({
      code: "invalid_start_date",
      message: `Invalid start_date: ${input.start_date}`,
    });
  }
  if (!yearEnd) {
    issues.push({
      code: "invalid_end_date",
      message: `Invalid end_date: ${input.end_date}`,
    });
  }
  if (yearStart && yearEnd && compareOperationalDates(yearStart, yearEnd) > 0) {
    issues.push({
      code: "year_date_order",
      message: "start_date must be <= end_date",
    });
  }

  if (!Array.isArray(input.weeks) || input.weeks.length === 0) {
    issues.push({
      code: "weeks_required",
      message: "weeks array is required",
    });
    return issues;
  }

  if (input.weeks.length !== input.week_count) {
    issues.push({
      code: "week_count_mismatch",
      message: `weeks.length (${input.weeks.length}) must equal week_count (${input.week_count})`,
    });
  }

  const sorted = [...input.weeks].sort(
    (a, b) => a.fiscal_week - b.fiscal_week
  );
  const seenWeeks = new Set<number>();
  const periodWeekCounts = new Map<number, number>();

  for (let i = 0; i < sorted.length; i += 1) {
    const w = sorted[i]!;
    if (!Number.isInteger(w.fiscal_week) || w.fiscal_week < 1) {
      issues.push({
        code: "invalid_fiscal_week",
        message: `Invalid fiscal_week at index ${i}: ${w.fiscal_week}`,
      });
      continue;
    }
    if (seenWeeks.has(w.fiscal_week)) {
      issues.push({
        code: "duplicate_fiscal_week",
        message: `Duplicate fiscal_week ${w.fiscal_week}`,
      });
    }
    seenWeeks.add(w.fiscal_week);

    if (w.fiscal_week !== i + 1) {
      issues.push({
        code: "non_sequential_week",
        message: `Expected fiscal_week ${i + 1}, got ${w.fiscal_week}`,
      });
    }

    if (
      !Number.isInteger(w.fiscal_quarter) ||
      w.fiscal_quarter < 1 ||
      w.fiscal_quarter > 4
    ) {
      issues.push({
        code: "invalid_quarter",
        message: `fiscal_week ${w.fiscal_week}: fiscal_quarter must be 1–4`,
      });
    }
    if (
      !Number.isInteger(w.fiscal_period) ||
      w.fiscal_period < 1 ||
      w.fiscal_period > 12
    ) {
      issues.push({
        code: "invalid_period",
        message: `fiscal_week ${w.fiscal_week}: fiscal_period must be 1–12`,
      });
    }

    // Quarter ↔ period consistency for classic retail mapping (periods 1–3 → Q1, …).
    if (
      Number.isInteger(w.fiscal_period) &&
      Number.isInteger(w.fiscal_quarter) &&
      w.fiscal_period >= 1 &&
      w.fiscal_period <= 12 &&
      w.fiscal_quarter >= 1 &&
      w.fiscal_quarter <= 4
    ) {
      const expectedQ = Math.ceil(w.fiscal_period / 3);
      if (w.fiscal_quarter !== expectedQ) {
        issues.push({
          code: "quarter_period_mismatch",
          message: `fiscal_week ${w.fiscal_week}: period ${w.fiscal_period} belongs to quarter ${expectedQ}, got ${w.fiscal_quarter}`,
        });
      }
    }

    const start = parseOperationalDate(w.start_date);
    const end = parseOperationalDate(w.end_date);
    if (!start || !end) {
      issues.push({
        code: "invalid_week_dates",
        message: `fiscal_week ${w.fiscal_week}: invalid start/end date`,
      });
      continue;
    }
    if (compareOperationalDates(start, end) > 0) {
      issues.push({
        code: "week_date_order",
        message: `fiscal_week ${w.fiscal_week}: start_date must be <= end_date`,
      });
      continue;
    }

    const days = inclusiveDayCount(start, end);
    if (days !== 7) {
      issues.push({
        code: "week_not_seven_days",
        message: `fiscal_week ${w.fiscal_week}: expected 7 days, got ${days}`,
      });
    }

    if (i === 0 && yearStart && start !== yearStart) {
      issues.push({
        code: "first_week_start",
        message: `First week must start on fiscal year start_date (${yearStart})`,
      });
    }
    if (i === sorted.length - 1 && yearEnd && end !== yearEnd) {
      issues.push({
        code: "last_week_end",
        message: `Last week must end on fiscal year end_date (${yearEnd})`,
      });
    }

    if (i > 0) {
      const prev = sorted[i - 1]!;
      const prevEnd = parseOperationalDate(prev.end_date);
      if (prevEnd) {
        const expectedStart = addDaysToOperationalDate(prevEnd, 1);
        if (start !== expectedStart) {
          if (compareOperationalDates(start, expectedStart) < 0) {
            issues.push({
              code: "week_overlap",
              message: `fiscal_week ${w.fiscal_week} overlaps prior week ending ${prevEnd}`,
            });
          } else {
            issues.push({
              code: "week_gap",
              message: `Gap before fiscal_week ${w.fiscal_week}: expected start ${expectedStart}, got ${start}`,
            });
          }
        }
      }
    }

    periodWeekCounts.set(
      w.fiscal_period,
      (periodWeekCounts.get(w.fiscal_period) ?? 0) + 1
    );
  }

  if (input.week_count === 52 && issues.length === 0) {
    for (let p = 1; p <= 12; p += 1) {
      const expected = RETAIL_454_PERIOD_LENGTHS[p - 1]!;
      const actual = periodWeekCounts.get(p) ?? 0;
      if (actual !== expected) {
        issues.push({
          code: "period_454_mismatch",
          message: `Period ${p}: expected ${expected} weeks (4-5-4), got ${actual}`,
        });
      }
    }
  }

  if (input.week_count === 53 && issues.length === 0) {
    const total = [...periodWeekCounts.values()].reduce((a, b) => a + b, 0);
    if (total !== 53) {
      issues.push({
        code: "period_sum_mismatch",
        message: `53-week year period week counts sum to ${total}, expected 53`,
      });
    }
    // Do not invent which period owns the 53rd week — source must declare it.
  }

  return issues;
}

/** Deterministic fingerprint for identical re-import detection. */
export function fiscalCalendarFingerprint(
  input: Pick<
    FiscalCalendarImport,
    | "fiscal_year"
    | "start_date"
    | "end_date"
    | "week_count"
    | "source_type"
    | "source_reference"
    | "source_year"
    | "weeks"
  >
): string {
  const weeks = [...input.weeks]
    .sort((a, b) => a.fiscal_week - b.fiscal_week)
    .map(
      (w) =>
        `${w.fiscal_week}|${w.fiscal_quarter}|${w.fiscal_period}|${w.start_date}|${w.end_date}`
    )
    .join(";");
  return [
    input.fiscal_year,
    input.start_date,
    input.end_date,
    input.week_count,
    input.source_type,
    input.source_reference ?? "",
    input.source_year ?? "",
    weeks,
  ].join("::");
}

function mapYearRow(row: Record<string, unknown>): FiscalYear {
  const source = String(row.source_type ?? "");
  return {
    id: String(row.id),
    fiscal_year: Number(row.fiscal_year),
    start_date: String(row.start_date).slice(0, 10),
    end_date: String(row.end_date).slice(0, 10),
    week_count: Number(row.week_count),
    source_type: isFiscalCalendarSource(source)
      ? source
      : "MASTER_ADMIN_DECLARED",
    source_reference:
      row.source_reference == null ? null : String(row.source_reference),
    source_year:
      row.source_year == null || row.source_year === ""
        ? null
        : Number(row.source_year),
    declared_by: row.declared_by == null ? null : String(row.declared_by),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function mapWeekRow(row: Record<string, unknown>): FiscalWeek {
  return {
    id: String(row.id),
    fiscal_year_id: String(row.fiscal_year_id),
    fiscal_week: Number(row.fiscal_week),
    fiscal_quarter: Number(row.fiscal_quarter),
    fiscal_period: Number(row.fiscal_period),
    start_date: String(row.start_date).slice(0, 10),
    end_date: String(row.end_date).slice(0, 10),
    created_at: String(row.created_at),
  };
}

const YEAR_SELECT =
  "id, fiscal_year, start_date, end_date, week_count, source_type, source_reference, source_year, declared_by, created_at, updated_at";
const WEEK_SELECT =
  "id, fiscal_year_id, fiscal_week, fiscal_quarter, fiscal_period, start_date, end_date, created_at";

export async function fetchFiscalYearByNumber(
  client: SupabaseClient,
  fiscalYear: number
): Promise<
  | { ok: true; year: FiscalYear | null }
  | { ok: false; missingRelation: true }
  | { ok: false; error: string }
> {
  const { data, error } = await client
    .from(FISCAL_YEARS_TABLE)
    .select(YEAR_SELECT)
    .eq("fiscal_year", fiscalYear)
    .maybeSingle();

  if (error) {
    if (isFiscalCalendarUnavailable(error)) {
      return { ok: false, missingRelation: true };
    }
    return { ok: false, error: readableError(error) };
  }
  if (!data) return { ok: true, year: null };
  return { ok: true, year: mapYearRow(data as Record<string, unknown>) };
}

export async function fetchFiscalWeeksForYear(
  client: SupabaseClient,
  fiscalYearId: string
): Promise<
  | { ok: true; weeks: FiscalWeek[] }
  | { ok: false; missingRelation: true }
  | { ok: false; error: string }
> {
  const { data, error } = await client
    .from(FISCAL_WEEKS_TABLE)
    .select(WEEK_SELECT)
    .eq("fiscal_year_id", fiscalYearId)
    .order("fiscal_week", { ascending: true });

  if (error) {
    if (isFiscalCalendarUnavailable(error)) {
      return { ok: false, missingRelation: true };
    }
    return { ok: false, error: readableError(error) };
  }
  return {
    ok: true,
    weeks: (data ?? []).map((row) =>
      mapWeekRow(row as Record<string, unknown>)
    ),
  };
}

/**
 * Import an authoritative fiscal calendar.
 * Rejects invalid input before writes.
 * Existing year with different data → year_exists (no silent overwrite).
 * Existing year with identical fingerprint → identical no-op.
 */
export async function importFiscalCalendar(
  client: SupabaseClient,
  input: FiscalCalendarImport
): Promise<FiscalImportResult> {
  const issues = validateFiscalCalendarImport(input);
  if (issues.length > 0) {
    return {
      ok: false,
      code: "validation_failed",
      message: "Fiscal calendar validation failed",
      details: issues.map((i) => `${i.code}: ${i.message}`),
    };
  }

  const existing = await fetchFiscalYearByNumber(client, input.fiscal_year);
  if (!existing.ok) {
    if ("missingRelation" in existing && existing.missingRelation) {
      return {
        ok: false,
        code: "missing_relation",
        message: "Fiscal calendar tables are not available",
      };
    }
    return {
      ok: false,
      code: "write_failed",
      message: "error" in existing ? existing.error : "Failed to read fiscal year",
    };
  }

  if (existing.year) {
    const weeksRes = await fetchFiscalWeeksForYear(client, existing.year.id);
    if (!weeksRes.ok) {
      if ("missingRelation" in weeksRes && weeksRes.missingRelation) {
        return {
          ok: false,
          code: "missing_relation",
          message: "Fiscal calendar tables are not available",
        };
      }
      return {
        ok: false,
        code: "write_failed",
        message: "error" in weeksRes ? weeksRes.error : "Failed to read weeks",
      };
    }

    const existingAsImport: FiscalCalendarImport = {
      fiscal_year: existing.year.fiscal_year,
      start_date: existing.year.start_date,
      end_date: existing.year.end_date,
      week_count: existing.year.week_count as 52 | 53,
      source_type: existing.year.source_type,
      source_reference: existing.year.source_reference,
      source_year: existing.year.source_year,
      weeks: weeksRes.weeks.map((w) => ({
        fiscal_week: w.fiscal_week,
        fiscal_quarter: w.fiscal_quarter,
        fiscal_period: w.fiscal_period,
        start_date: w.start_date,
        end_date: w.end_date,
      })),
    };

    if (
      fiscalCalendarFingerprint(existingAsImport) ===
      fiscalCalendarFingerprint(input)
    ) {
      return {
        ok: true,
        created: false,
        identical: true,
        year: existing.year,
        weeks: weeksRes.weeks,
      };
    }

    return {
      ok: false,
      code: "year_exists",
      message: `Fiscal year ${input.fiscal_year} already exists — explicit replacement required (not implemented in FS-001)`,
    };
  }

  const now = new Date().toISOString();
  const { data: yearRow, error: yearError } = await client
    .from(FISCAL_YEARS_TABLE)
    .insert({
      fiscal_year: input.fiscal_year,
      start_date: input.start_date,
      end_date: input.end_date,
      week_count: input.week_count,
      source_type: input.source_type,
      source_reference: input.source_reference ?? null,
      source_year: input.source_year ?? null,
      declared_by: input.declared_by ?? null,
      created_at: now,
      updated_at: now,
    })
    .select(YEAR_SELECT)
    .single();

  if (yearError || !yearRow) {
    if (isFiscalCalendarUnavailable(yearError)) {
      return {
        ok: false,
        code: "missing_relation",
        message: "Fiscal calendar tables are not available",
      };
    }
    return {
      ok: false,
      code: "write_failed",
      message: readableError(yearError, "Failed to insert fiscal year"),
    };
  }

  const year = mapYearRow(yearRow as Record<string, unknown>);
  const weekPayload = [...input.weeks]
    .sort((a, b) => a.fiscal_week - b.fiscal_week)
    .map((w) => ({
      fiscal_year_id: year.id,
      fiscal_week: w.fiscal_week,
      fiscal_quarter: w.fiscal_quarter,
      fiscal_period: w.fiscal_period,
      start_date: w.start_date,
      end_date: w.end_date,
      created_at: now,
    }));

  const { data: weekRows, error: weekError } = await client
    .from(FISCAL_WEEKS_TABLE)
    .insert(weekPayload)
    .select(WEEK_SELECT);

  if (weekError || !weekRows) {
    // Best-effort rollback of the year row so a partial import is not left authoritative.
    await client.from(FISCAL_YEARS_TABLE).delete().eq("id", year.id);
    if (isFiscalCalendarUnavailable(weekError)) {
      return {
        ok: false,
        code: "missing_relation",
        message: "Fiscal calendar tables are not available",
      };
    }
    return {
      ok: false,
      code: "write_failed",
      message: readableError(weekError, "Failed to insert fiscal weeks"),
    };
  }

  return {
    ok: true,
    created: true,
    year,
    weeks: weekRows.map((row) => mapWeekRow(row as Record<string, unknown>)),
  };
}

export type ResolveFiscalContextInput = {
  /** Already a store-local operational date YYYY-MM-DD. */
  operationalDate?: string;
  /** Instant — converted with timeZone before lookup. */
  instant?: Date | string;
  /** Required when resolving from instant. */
  timeZone?: string;
};

/**
 * Resolve authoritative fiscal context for a store-local operational date.
 * Never invents a week when no imported calendar covers the date.
 */
export async function resolveFiscalContextForDate(
  client: SupabaseClient,
  input: ResolveFiscalContextInput
): Promise<FiscalContextResult> {
  let operationalDate: string;
  if (input.operationalDate) {
    const parsed = parseOperationalDate(input.operationalDate);
    if (!parsed) {
      return {
        status: "calendar_unavailable",
        operational_date: String(input.operationalDate),
        reason: "Invalid operational date",
      };
    }
    operationalDate = parsed;
  } else if (input.instant != null) {
    try {
      operationalDate = operationalDateFromInstant(
        input.instant,
        input.timeZone ?? "America/Denver"
      );
    } catch {
      return {
        status: "calendar_unavailable",
        operational_date: "",
        reason: "Invalid instant for store-local date",
      };
    }
  } else {
    return {
      status: "calendar_unavailable",
      operational_date: "",
      reason: "operationalDate or instant is required",
    };
  }

  const { data, error } = await client
    .from(FISCAL_WEEKS_TABLE)
    .select(
      `${WEEK_SELECT}, fiscal_years!inner(${YEAR_SELECT})`
    )
    .lte("start_date", operationalDate)
    .gte("end_date", operationalDate)
    .limit(2);

  if (error) {
    if (isFiscalCalendarUnavailable(error)) {
      return {
        status: "calendar_unavailable",
        operational_date: operationalDate,
        reason: "Fiscal calendar schema unavailable",
      };
    }
    return {
      status: "calendar_unavailable",
      operational_date: operationalDate,
      reason: readableError(error, "Fiscal calendar lookup failed"),
    };
  }

  const rows = data ?? [];
  if (rows.length === 0) {
    return {
      status: "calendar_unavailable",
      operational_date: operationalDate,
      reason: "No authoritative fiscal week covers this date",
    };
  }
  if (rows.length > 1) {
    return {
      status: "calendar_unavailable",
      operational_date: operationalDate,
      reason: "Multiple fiscal weeks cover this date (calendar integrity error)",
    };
  }

  const row = rows[0] as Record<string, unknown>;
  const yearRel = row.fiscal_years;
  const yearRow = (
    Array.isArray(yearRel) ? yearRel[0] : yearRel
  ) as Record<string, unknown> | null;
  if (!yearRow) {
    return {
      status: "calendar_unavailable",
      operational_date: operationalDate,
      reason: "Fiscal week missing parent year",
    };
  }

  const week = mapWeekRow(row);
  const year = mapYearRow(yearRow);

  return {
    status: "ok",
    fiscal_year: year.fiscal_year,
    fiscal_week: week.fiscal_week,
    fiscal_period: week.fiscal_period,
    fiscal_quarter: week.fiscal_quarter,
    week_start_date: week.start_date,
    week_end_date: week.end_date,
    fiscal_year_id: year.id,
    fiscal_week_id: week.id,
    source_type: year.source_type,
    source_reference: year.source_reference,
    source_year: year.source_year,
    operational_date: operationalDate,
  };
}

export type IsoFiscalOverlap = {
  iso_week_label: string;
  iso_monday: string;
  iso_sunday: string;
  fiscal_weeks: Array<{
    fiscal_year: number;
    fiscal_week: number;
    fiscal_period: number;
    fiscal_quarter: number;
    start_date: string;
    end_date: string;
  }>;
};

/**
 * Map an ISO rotation week to overlapping fiscal weeks by date range.
 * Does not assume Monday–Sunday alignment is a permanent invariant.
 */
export async function fiscalWeeksOverlappingIsoWeek(
  client: SupabaseClient,
  isoWeekLabel: string
): Promise<
  | { ok: true; result: IsoFiscalOverlap }
  | { ok: false; missingRelation: true }
  | { ok: false; error: string }
> {
  parseIsoWeekLabel(isoWeekLabel);
  const monday = isoWeekToMondayDate(isoWeekLabel);
  const sunday = addDaysToOperationalDate(monday, 6);

  const { data, error } = await client
    .from(FISCAL_WEEKS_TABLE)
    .select(`${WEEK_SELECT}, fiscal_years!inner(fiscal_year)`)
    .lte("start_date", sunday)
    .gte("end_date", monday)
    .order("start_date", { ascending: true });

  if (error) {
    if (isFiscalCalendarUnavailable(error)) {
      return { ok: false, missingRelation: true };
    }
    return { ok: false, error: readableError(error) };
  }

  const fiscal_weeks = (data ?? []).map((raw) => {
    const row = raw as Record<string, unknown>;
    const yearRel = row.fiscal_years;
    const yearRow = (
      Array.isArray(yearRel) ? yearRel[0] : yearRel
    ) as Record<string, unknown> | null;
    const week = mapWeekRow(row);
    return {
      fiscal_year: Number(yearRow?.fiscal_year ?? 0),
      fiscal_week: week.fiscal_week,
      fiscal_period: week.fiscal_period,
      fiscal_quarter: week.fiscal_quarter,
      start_date: week.start_date,
      end_date: week.end_date,
    };
  });

  return {
    ok: true,
    result: {
      iso_week_label: isoWeekLabel,
      iso_monday: monday,
      iso_sunday: sunday,
      fiscal_weeks,
    },
  };
}

/**
 * Build a synthetic contiguous fiscal calendar for tests only.
 * Fixture dates are NOT Lowe’s production truth.
 */
export function buildSyntheticFiscalCalendarImport(opts: {
  fiscalYear: number;
  startDate: string;
  weekCount: 52 | 53;
  source_type?: FiscalCalendarSource;
  source_reference?: string;
  declared_by?: string;
}): FiscalCalendarImport {
  const start = parseOperationalDate(opts.startDate);
  if (!start) throw new Error(`Invalid startDate: ${opts.startDate}`);

  const weeks: FiscalCalendarImportWeek[] = [];
  let cursor = start;
  let weekNo = 1;

  const periodPlan: number[] = [...RETAIL_454_PERIOD_LENGTHS];
  if (opts.weekCount === 53) {
    // Attach extra week to period 12 without inventing company policy —
    // synthetic fixture choice for tests only.
    periodPlan[11] = (periodPlan[11] ?? 4) + 1;
  }

  for (let p = 1; p <= 12; p += 1) {
    const len = periodPlan[p - 1]!;
    const quarter = Math.ceil(p / 3);
    for (let i = 0; i < len; i += 1) {
      const end = addDaysToOperationalDate(cursor, 6);
      weeks.push({
        fiscal_week: weekNo,
        fiscal_quarter: quarter,
        fiscal_period: p,
        start_date: cursor,
        end_date: end,
      });
      cursor = addDaysToOperationalDate(end, 1);
      weekNo += 1;
    }
  }

  const last = weeks[weeks.length - 1]!;
  return {
    fiscal_year: opts.fiscalYear,
    start_date: start,
    end_date: last.end_date,
    week_count: opts.weekCount,
    source_type: opts.source_type ?? "MASTER_ADMIN_DECLARED",
    source_reference:
      opts.source_reference ??
      "SYNTHETIC_TEST_FIXTURE — not Lowe's production calendar",
    source_year: opts.fiscalYear,
    declared_by: opts.declared_by ?? "test-fixture",
    weeks,
  };
}

// ---------------------------------------------------------------------------
// FS-001A — Fiscal calendar coverage (derived on read; no persistence)
// ---------------------------------------------------------------------------

/**
 * Days remaining ≤ this with next FY absent → ATTENTION.
 * Operational meaning: preparation / acquisition window for Master.
 */
export const FISCAL_COVERAGE_ATTENTION_DAYS = 90;

/**
 * Days remaining ≤ this with next FY absent → URGENT.
 * Operational meaning: immediate Master action window.
 */
export const FISCAL_COVERAGE_URGENT_DAYS = 30;

export type FiscalCoverageStatus =
  | "HEALTHY"
  | "ATTENTION"
  | "URGENT"
  | "EXPIRED";

export type FiscalCoverageReasonCode =
  | "NEXT_YEAR_MISSING"
  | "NEXT_YEAR_LOADED"
  | "COVERAGE_ATTENTION"
  | "COVERAGE_URGENT"
  | "COVERAGE_EXPIRED"
  | "GAP_AFTER_LAST_YEAR"
  | "NO_AUTHORITATIVE_CALENDAR"
  | "SCHEMA_UNAVAILABLE";

/**
 * Deterministic Layer-1 coverage contract.
 * Derived from authoritative fiscal_years rows + store-local operational date.
 */
export type FiscalCoverage = {
  status: FiscalCoverageStatus;
  operational_date: string;
  current_fiscal_year: number | null;
  coverage_start_date: string | null;
  coverage_end_date: string | null;
  days_remaining: number | null;
  next_fiscal_year: number | null;
  next_fiscal_year_loaded: boolean;
  /** Provenance of the year covering operational_date, when present. */
  current_source_type: FiscalCalendarSource | null;
  reason_codes: FiscalCoverageReasonCode[];
  generated_at: string;
};

export type ComputeFiscalCoverageInput = {
  operationalDate?: string;
  instant?: Date | string;
  timeZone?: string;
  /** Override clock for tests — ISO string. */
  generatedAt?: string;
};

/**
 * Load all authoritative fiscal years ordered by fiscal_year ascending.
 */
export async function fetchAuthoritativeFiscalYears(
  client: SupabaseClient
): Promise<
  | { ok: true; years: FiscalYear[] }
  | { ok: false; missingRelation: true }
  | { ok: false; error: string }
> {
  const { data, error } = await client
    .from(FISCAL_YEARS_TABLE)
    .select(YEAR_SELECT)
    .order("fiscal_year", { ascending: true });

  if (error) {
    if (isFiscalCalendarUnavailable(error)) {
      return { ok: false, missingRelation: true };
    }
    return { ok: false, error: readableError(error) };
  }

  return {
    ok: true,
    years: (data ?? []).map((row) =>
      mapYearRow(row as Record<string, unknown>)
    ),
  };
}

function yearCoversDate(year: FiscalYear, operationalDate: string): boolean {
  return (
    compareOperationalDates(year.start_date, operationalDate) <= 0 &&
    compareOperationalDates(operationalDate, year.end_date) <= 0
  );
}

/**
 * Contiguous coverage end walking forward from `fromYear`.
 * Stops when the next fiscal_year number is missing or dates are not adjacent.
 * Does not invent dates across gaps.
 */
export function contiguousCoverageEndFrom(
  years: FiscalYear[],
  fromYear: FiscalYear
): { end_date: string; gap_after: boolean } {
  const byNumber = new Map(years.map((y) => [y.fiscal_year, y]));
  let cursor = fromYear;
  let end = fromYear.end_date;
  let gap_after = false;

  while (true) {
    const next = byNumber.get(cursor.fiscal_year + 1);
    if (!next) {
      // A later year may exist with a skipped number — that is a gap.
      const later = years.some((y) => y.fiscal_year > cursor.fiscal_year);
      gap_after = later;
      break;
    }
    const expectedStart = addDaysToOperationalDate(cursor.end_date, 1);
    if (next.start_date !== expectedStart) {
      gap_after = true;
      break;
    }
    cursor = next;
    end = next.end_date;
  }

  return { end_date: end, gap_after };
}

/**
 * Pure coverage derivation from authoritative year rows.
 *
 * Next-year semantics:
 * - When a year covers operational_date, next_fiscal_year = that year + 1.
 * - When none covers, next_fiscal_year = (most recent year that has ended) + 1,
 *   or the earliest upcoming fiscal_year if none have ended yet.
 * - next_fiscal_year_loaded is true only when that exact year number exists.
 * - A later year (e.g. FY2028 while FY2027 is missing) is never "next".
 */
export function computeFiscalCoverageFromYears(
  years: FiscalYear[],
  operationalDate: string,
  generatedAt: string = new Date().toISOString()
): FiscalCoverage {
  const op = parseOperationalDate(operationalDate);
  if (!op) {
    return {
      status: "EXPIRED",
      operational_date: String(operationalDate),
      current_fiscal_year: null,
      coverage_start_date: null,
      coverage_end_date: null,
      days_remaining: null,
      next_fiscal_year: null,
      next_fiscal_year_loaded: false,
      current_source_type: null,
      reason_codes: ["COVERAGE_EXPIRED"],
      generated_at: generatedAt,
    };
  }

  const sorted = [...years].sort((a, b) => a.fiscal_year - b.fiscal_year);

  if (sorted.length === 0) {
    return {
      status: "EXPIRED",
      operational_date: op,
      current_fiscal_year: null,
      coverage_start_date: null,
      coverage_end_date: null,
      days_remaining: null,
      next_fiscal_year: null,
      next_fiscal_year_loaded: false,
      current_source_type: null,
      reason_codes: ["NO_AUTHORITATIVE_CALENDAR", "COVERAGE_EXPIRED"],
      generated_at: generatedAt,
    };
  }

  const coverage_start_date = sorted.reduce(
    (min, y) =>
      compareOperationalDates(y.start_date, min) < 0 ? y.start_date : min,
    sorted[0]!.start_date
  );
  const latest_end = sorted.reduce(
    (max, y) =>
      compareOperationalDates(y.end_date, max) > 0 ? y.end_date : max,
    sorted[0]!.end_date
  );

  const covering = sorted.filter((y) => yearCoversDate(y, op));
  const byNumber = new Map(sorted.map((y) => [y.fiscal_year, y]));

  if (covering.length === 0) {
    const ended = sorted.filter(
      (y) => compareOperationalDates(y.end_date, op) < 0
    );
    const upcoming = sorted.filter(
      (y) => compareOperationalDates(y.start_date, op) > 0
    );

    let next_fiscal_year: number | null = null;
    if (ended.length > 0) {
      const mostRecent = ended.reduce((a, b) =>
        compareOperationalDates(a.end_date, b.end_date) >= 0 ? a : b
      );
      next_fiscal_year = mostRecent.fiscal_year + 1;
    } else if (upcoming.length > 0) {
      next_fiscal_year = upcoming.reduce((a, b) =>
        a.fiscal_year < b.fiscal_year ? a : b
      ).fiscal_year;
    }

    const next_fiscal_year_loaded =
      next_fiscal_year != null && byNumber.has(next_fiscal_year);

    const reason_codes: FiscalCoverageReasonCode[] = ["COVERAGE_EXPIRED"];
    if (ended.length > 0 && upcoming.length > 0) {
      reason_codes.push("GAP_AFTER_LAST_YEAR");
    } else if (
      ended.length > 0 &&
      compareOperationalDates(op, latest_end) > 0
    ) {
      // Past all authoritative coverage.
    } else if (ended.length > 0 && !next_fiscal_year_loaded) {
      reason_codes.push("GAP_AFTER_LAST_YEAR");
    }
    if (next_fiscal_year != null && !next_fiscal_year_loaded) {
      reason_codes.push("NEXT_YEAR_MISSING");
    } else if (next_fiscal_year_loaded) {
      reason_codes.push("NEXT_YEAR_LOADED");
    }

    return {
      status: "EXPIRED",
      operational_date: op,
      current_fiscal_year: null,
      coverage_start_date,
      coverage_end_date: latest_end,
      days_remaining: 0,
      next_fiscal_year,
      next_fiscal_year_loaded,
      current_source_type: null,
      reason_codes,
      generated_at: generatedAt,
    };
  }

  // Integrity: multiple covering years → treat as unavailable coverage (expired).
  if (covering.length > 1) {
    return {
      status: "EXPIRED",
      operational_date: op,
      current_fiscal_year: null,
      coverage_start_date,
      coverage_end_date: latest_end,
      days_remaining: null,
      next_fiscal_year: null,
      next_fiscal_year_loaded: false,
      current_source_type: null,
      reason_codes: ["COVERAGE_EXPIRED"],
      generated_at: generatedAt,
    };
  }

  const current = covering[0]!;
  const next_fiscal_year = current.fiscal_year + 1;
  const next_fiscal_year_loaded = byNumber.has(next_fiscal_year);
  const contiguous = contiguousCoverageEndFrom(sorted, current);
  const coverage_end_date = contiguous.end_date;
  const days_remaining = Math.max(
    0,
    inclusiveDayCount(op, coverage_end_date) - 1
  );

  const reason_codes: FiscalCoverageReasonCode[] = [];
  if (next_fiscal_year_loaded) {
    reason_codes.push("NEXT_YEAR_LOADED");
  } else {
    reason_codes.push("NEXT_YEAR_MISSING");
  }
  if (contiguous.gap_after) {
    reason_codes.push("GAP_AFTER_LAST_YEAR");
  }

  let status: FiscalCoverageStatus;
  if (next_fiscal_year_loaded || days_remaining > FISCAL_COVERAGE_ATTENTION_DAYS) {
    status = "HEALTHY";
  } else if (days_remaining <= FISCAL_COVERAGE_URGENT_DAYS) {
    status = "URGENT";
    reason_codes.push("COVERAGE_URGENT");
  } else {
    status = "ATTENTION";
    reason_codes.push("COVERAGE_ATTENTION");
  }

  return {
    status,
    operational_date: op,
    current_fiscal_year: current.fiscal_year,
    coverage_start_date,
    coverage_end_date,
    days_remaining,
    next_fiscal_year,
    next_fiscal_year_loaded,
    current_source_type: current.source_type,
    reason_codes,
    generated_at: generatedAt,
  };
}

/**
 * Derive fiscal calendar coverage for a store-local operational date.
 * Never invents years. Never mutates ISO rotation state.
 */
export async function computeFiscalCoverage(
  client: SupabaseClient,
  input: ComputeFiscalCoverageInput
): Promise<
  | { ok: true; coverage: FiscalCoverage }
  | { ok: false; missingRelation: true; coverage: FiscalCoverage }
  | { ok: false; error: string }
> {
  let operationalDate: string;
  if (input.operationalDate) {
    const parsed = parseOperationalDate(input.operationalDate);
    if (!parsed) {
      return {
        ok: false,
        error: `Invalid operational date: ${input.operationalDate}`,
      };
    }
    operationalDate = parsed;
  } else if (input.instant != null) {
    try {
      operationalDate = operationalDateFromInstant(
        input.instant,
        input.timeZone ?? "America/Denver"
      );
    } catch {
      return { ok: false, error: "Invalid instant for store-local date" };
    }
  } else {
    return {
      ok: false,
      error: "operationalDate or instant is required",
    };
  }

  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const yearsRes = await fetchAuthoritativeFiscalYears(client);

  if (!yearsRes.ok) {
    if ("missingRelation" in yearsRes && yearsRes.missingRelation) {
      const coverage: FiscalCoverage = {
        status: "EXPIRED",
        operational_date: operationalDate,
        current_fiscal_year: null,
        coverage_start_date: null,
        coverage_end_date: null,
        days_remaining: null,
        next_fiscal_year: null,
        next_fiscal_year_loaded: false,
        current_source_type: null,
        reason_codes: ["SCHEMA_UNAVAILABLE", "COVERAGE_EXPIRED"],
        generated_at: generatedAt,
      };
      return { ok: false, missingRelation: true, coverage };
    }
    return {
      ok: false,
      error: "error" in yearsRes ? yearsRes.error : "Failed to load fiscal years",
    };
  }

  return {
    ok: true,
    coverage: computeFiscalCoverageFromYears(
      yearsRes.years,
      operationalDate,
      generatedAt
    ),
  };
}
