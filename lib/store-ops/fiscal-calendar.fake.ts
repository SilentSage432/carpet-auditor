/**
 * In-memory fake for fiscal_years / fiscal_weeks (FS-001 tests).
 * Synthetic fixtures only — not Lowe’s production calendar data.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { FiscalWeek, FiscalYear } from "./fiscal-calendar";

type YearRow = FiscalYear;
type WeekRow = FiscalWeek;

function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

type QueryResult = {
  data: unknown;
  error: { code?: string; message: string } | null;
};

export type FakeFiscalDb = {
  client: SupabaseClient;
  years: YearRow[];
  weeks: WeekRow[];
  setMissingRelation: (missing: boolean) => void;
  seed: (years: YearRow[], weeks: WeekRow[]) => void;
  clear: () => void;
};

export function createFakeFiscalDb(): FakeFiscalDb {
  let missingRelation = false;
  const years: YearRow[] = [];
  const weeks: WeekRow[] = [];

  function missingError(table: string): QueryResult {
    return {
      data: null,
      error: {
        code: "42P01",
        message: `relation "public.${table}" does not exist`,
      },
    };
  }

  function from(table: string) {
    if (table !== "fiscal_years" && table !== "fiscal_weeks") {
      throw new Error(`Unexpected table ${table}`);
    }

    type Filter = { col: string; op: string; val: unknown };
    const filters: Filter[] = [];
    let mode: "select" | "insert" | "delete" = "select";
    let insertPayload: Record<string, unknown> | Record<string, unknown>[] | null =
      null;
    let wantSingle = false;
    let wantMaybeSingle = false;
    let limitCount: number | null = null;
    let orderCol: string | null = null;
    let orderAsc = true;
    let selectCols = "*";
    let joinYears = false;

    const api: Record<string, unknown> = {};

    const matches = (row: Record<string, unknown>) =>
      filters.every((f) => {
        const raw = row[f.col];
        if (f.op === "eq") return String(raw) === String(f.val);
        if (f.op === "lte") return String(raw) <= String(f.val);
        if (f.op === "gte") return String(raw) >= String(f.val);
        return true;
      });

    const run = async (): Promise<QueryResult> => {
      if (missingRelation) return missingError(table);

      if (mode === "delete") {
        if (table === "fiscal_years") {
          const keep = years.filter((y) => !matches(y as unknown as Record<string, unknown>));
          const removedIds = new Set(
            years
              .filter((y) => matches(y as unknown as Record<string, unknown>))
              .map((y) => y.id)
          );
          years.length = 0;
          years.push(...keep);
          for (let i = weeks.length - 1; i >= 0; i -= 1) {
            if (removedIds.has(weeks[i]!.fiscal_year_id)) weeks.splice(i, 1);
          }
        }
        return { data: null, error: null };
      }

      if (mode === "insert") {
        const rows = Array.isArray(insertPayload)
          ? insertPayload
          : insertPayload
            ? [insertPayload]
            : [];

        if (table === "fiscal_years") {
          const created: YearRow[] = [];
          for (const row of rows) {
            if (
              years.some((y) => y.fiscal_year === Number(row.fiscal_year))
            ) {
              return {
                data: null,
                error: {
                  code: "23505",
                  message: "duplicate key value violates unique constraint",
                },
              };
            }
            const yr: YearRow = {
              id: String(row.id ?? uid("fy")),
              fiscal_year: Number(row.fiscal_year),
              start_date: String(row.start_date).slice(0, 10),
              end_date: String(row.end_date).slice(0, 10),
              week_count: Number(row.week_count),
              source_type: row.source_type as YearRow["source_type"],
              source_reference:
                row.source_reference == null
                  ? null
                  : String(row.source_reference),
              source_year:
                row.source_year == null ? null : Number(row.source_year),
              declared_by:
                row.declared_by == null ? null : String(row.declared_by),
              created_at: String(row.created_at ?? new Date().toISOString()),
              updated_at: String(row.updated_at ?? new Date().toISOString()),
            };
            years.push(yr);
            created.push(yr);
          }
          const data = wantSingle ? created[0] ?? null : created;
          return { data, error: null };
        }

        const created: WeekRow[] = [];
        for (const row of rows) {
          const wk: WeekRow = {
            id: String(row.id ?? uid("fw")),
            fiscal_year_id: String(row.fiscal_year_id),
            fiscal_week: Number(row.fiscal_week),
            fiscal_quarter: Number(row.fiscal_quarter),
            fiscal_period: Number(row.fiscal_period),
            start_date: String(row.start_date).slice(0, 10),
            end_date: String(row.end_date).slice(0, 10),
            created_at: String(row.created_at ?? new Date().toISOString()),
          };
          weeks.push(wk);
          created.push(wk);
        }
        return { data: created, error: null };
      }

      // select
      let rows: Record<string, unknown>[] =
        table === "fiscal_years"
          ? years.map((y) => ({ ...y }))
          : weeks.map((w) => {
              const base: Record<string, unknown> = { ...w };
              if (joinYears) {
                const yr = years.find((y) => y.id === w.fiscal_year_id);
                base.fiscal_years = yr ? { ...yr } : null;
              }
              return base;
            });

      rows = rows.filter(matches);

      if (orderCol) {
        const col = orderCol;
        rows.sort((a, b) => {
          const av = String(a[col] ?? "");
          const bv = String(b[col] ?? "");
          if (av === bv) return 0;
          const cmp = av < bv ? -1 : 1;
          return orderAsc ? cmp : -cmp;
        });
      }

      if (limitCount != null) rows = rows.slice(0, limitCount);

      if (wantSingle || wantMaybeSingle) {
        if (rows.length === 0) {
          return wantMaybeSingle
            ? { data: null, error: null }
            : {
                data: null,
                error: { message: "JSON object requested, multiple (or no) rows returned" },
              };
        }
        return { data: rows[0], error: null };
      }

      return { data: rows, error: null };
    };

    const thenable = {
      then(
        onfulfilled?: (v: QueryResult) => unknown,
        onrejected?: (e: unknown) => unknown
      ) {
        return run().then(onfulfilled, onrejected);
      },
    };

    Object.assign(api, {
      select(cols?: string) {
        selectCols = cols ?? "*";
        joinYears =
          table === "fiscal_weeks" &&
          String(selectCols).includes("fiscal_years");
        return api;
      },
      insert(payload: Record<string, unknown> | Record<string, unknown>[]) {
        mode = "insert";
        insertPayload = payload;
        return api;
      },
      delete() {
        mode = "delete";
        return api;
      },
      eq(col: string, val: unknown) {
        filters.push({ col, op: "eq", val });
        return api;
      },
      lte(col: string, val: unknown) {
        filters.push({ col, op: "lte", val });
        return api;
      },
      gte(col: string, val: unknown) {
        filters.push({ col, op: "gte", val });
        return api;
      },
      order(col: string, opts?: { ascending?: boolean }) {
        orderCol = col;
        orderAsc = opts?.ascending !== false;
        return api;
      },
      limit(n: number) {
        limitCount = n;
        return api;
      },
      single() {
        wantSingle = true;
        return thenable;
      },
      maybeSingle() {
        wantMaybeSingle = true;
        return thenable;
      },
      then: thenable.then,
    });

    return api;
  }

  return {
    client: { from } as unknown as SupabaseClient,
    years,
    weeks,
    setMissingRelation: (missing: boolean) => {
      missingRelation = missing;
    },
    seed: (y, w) => {
      years.length = 0;
      weeks.length = 0;
      years.push(...y);
      weeks.push(...w);
    },
    clear: () => {
      years.length = 0;
      weeks.length = 0;
      missingRelation = false;
    },
  };
}
