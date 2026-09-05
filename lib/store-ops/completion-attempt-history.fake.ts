/**
 * In-memory fake for weekly_rotation_completion_attempts tests.
 * Mirrors insert/update/select semantics used by completion-attempt-history.ts
 * plus the one-PENDING unique rule.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { WeeklyRotationCompletionAttempt } from "./completion-attempt-history";

type AttemptRow = WeeklyRotationCompletionAttempt;

function uid(): string {
  return `att-${Math.random().toString(36).slice(2, 10)}`;
}

type QueryResult = { data: unknown; error: { code?: string; message: string } | null };

export type FakeAttemptDb = {
  client: SupabaseClient;
  attempts: AttemptRow[];
  setMissingRelation: (missing: boolean) => void;
  setForceError: (error: { code?: string; message: string } | null) => void;
  seed: (rows: AttemptRow[]) => void;
};

export function createFakeCompletionAttemptDb(): FakeAttemptDb {
  let missingRelation = false;
  let forceError: { code?: string; message: string } | null = null;
  const attempts: AttemptRow[] = [];

  function missingError(): QueryResult {
    return {
      data: null,
      error: {
        code: "42P01",
        message: `relation "public.weekly_rotation_completion_attempts" does not exist`,
      },
    };
  }

  function buildFilter(filters: Array<{ col: string; op: string; val: unknown }>) {
    return (row: AttemptRow) =>
      filters.every((f) => {
        const raw = (row as Record<string, unknown>)[f.col];
        if (f.op === "eq") return String(raw) === String(f.val);
        if (f.op === "in") {
          const vals = (f.val as unknown[]).map(String);
          return vals.includes(String(raw));
        }
        return true;
      });
  }

  function from(table: string) {
    if (table !== "weekly_rotation_completion_attempts") {
      throw new Error(`Unexpected table ${table}`);
    }

    const filters: Array<{ col: string; op: string; val: unknown }> = [];
    const orderSpecs: Array<{ col: string; ascending: boolean }> = [];
    let mode: "select" | "insert" | "update" = "select";
    let insertPayload: Record<string, unknown> | null = null;
    let updatePayload: Record<string, unknown> | null = null;
    let wantSingle = false;
    let wantMaybeSingle = false;
    let limitCount: number | null = null;

    const api: Record<string, unknown> = {};

    const run = async (): Promise<QueryResult> => {
      if (missingRelation) return missingError();
      if (forceError && mode === "insert") {
        return { data: null, error: forceError };
      }

      if (mode === "insert" && insertPayload) {
        if (
          insertPayload.review_outcome === "PENDING" &&
          attempts.some(
            (a) =>
              a.weekly_rotation_id === String(insertPayload!.weekly_rotation_id) &&
              a.review_outcome === "PENDING"
          )
        ) {
          return {
            data: null,
            error: {
              code: "23505",
              message:
                "duplicate key value violates unique constraint weekly_rotation_completion_attempts_one_pending_uidx",
            },
          };
        }
        if (
          insertPayload.review_outcome === "PENDING" &&
          (insertPayload.reviewed_at != null || insertPayload.reviewed_by != null)
        ) {
          return {
            data: null,
            error: {
              code: "23514",
              message: "violates check constraint pending_review_null",
            },
          };
        }
        if (
          insertPayload.review_outcome !== "PENDING" &&
          insertPayload.reviewed_at == null
        ) {
          return {
            data: null,
            error: {
              code: "23514",
              message: "violates check constraint terminal_reviewed_at",
            },
          };
        }

        const row: AttemptRow = {
          id: uid(),
          weekly_rotation_id: String(insertPayload.weekly_rotation_id),
          reported_at: String(insertPayload.reported_at),
          reported_by:
            insertPayload.reported_by == null
              ? null
              : String(insertPayload.reported_by),
          reviewed_at:
            insertPayload.reviewed_at == null
              ? null
              : String(insertPayload.reviewed_at),
          reviewed_by:
            insertPayload.reviewed_by == null
              ? null
              : String(insertPayload.reviewed_by),
          review_outcome: String(
            insertPayload.review_outcome
          ) as AttemptRow["review_outcome"],
          review_note:
            insertPayload.review_note == null
              ? null
              : String(insertPayload.review_note),
          created_at: new Date().toISOString(),
        };
        attempts.push(row);
        return { data: row, error: null };
      }

      let rows = attempts.filter(buildFilter(filters));
      for (const spec of orderSpecs) {
        rows = [...rows].sort((a, b) => {
          const av = String((a as Record<string, unknown>)[spec.col] ?? "");
          const bv = String((b as Record<string, unknown>)[spec.col] ?? "");
          const cmp = av.localeCompare(bv);
          return spec.ascending ? cmp : -cmp;
        });
      }
      if (limitCount != null) {
        rows = rows.slice(0, limitCount);
      }

      if (mode === "update" && updatePayload) {
        const targets = attempts.filter(buildFilter(filters));
        const updated: AttemptRow[] = [];
        for (const target of targets) {
          Object.assign(target, updatePayload);
          updated.push(target);
        }
        if (wantMaybeSingle || wantSingle) {
          return { data: updated[0] ?? null, error: null };
        }
        return { data: updated, error: null };
      }

      if (wantMaybeSingle) {
        return { data: rows[0] ?? null, error: null };
      }
      if (wantSingle) {
        if (!rows[0]) {
          return { data: null, error: { message: "JSON object requested, multiple (or no) rows returned" } };
        }
        return { data: rows[0], error: null };
      }
      return { data: rows, error: null };
    };

    const thenable = {
      then(onFulfilled: (v: QueryResult) => unknown, onRejected?: (e: unknown) => unknown) {
        return run().then(onFulfilled, onRejected);
      },
    };

    Object.assign(api, {
      select() {
        return Object.assign(api, thenable);
      },
      insert(payload: Record<string, unknown>) {
        mode = "insert";
        insertPayload = payload;
        return Object.assign(api, thenable);
      },
      update(payload: Record<string, unknown>) {
        mode = "update";
        updatePayload = payload;
        return Object.assign(api, thenable);
      },
      eq(col: string, val: unknown) {
        filters.push({ col, op: "eq", val });
        return Object.assign(api, thenable);
      },
      in(col: string, val: unknown[]) {
        filters.push({ col, op: "in", val });
        return Object.assign(api, thenable);
      },
      order(col: string, opts?: { ascending?: boolean }) {
        orderSpecs.push({ col, ascending: opts?.ascending !== false });
        return Object.assign(api, thenable);
      },
      limit(n: number) {
        limitCount = n;
        return Object.assign(api, thenable);
      },
      single() {
        wantSingle = true;
        return Object.assign(api, thenable);
      },
      maybeSingle() {
        wantMaybeSingle = true;
        return Object.assign(api, thenable);
      },
    });

    return api;
  }

  return {
    attempts,
    client: { from } as unknown as SupabaseClient,
    setMissingRelation(missing: boolean) {
      missingRelation = missing;
    },
    setForceError(error: { code?: string; message: string } | null) {
      forceError = error;
    },
    seed(rows: AttemptRow[]) {
      attempts.splice(0, attempts.length, ...rows);
    },
  };
}
