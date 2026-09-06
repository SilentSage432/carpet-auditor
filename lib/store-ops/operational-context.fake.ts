/**
 * In-memory fake for operational_contexts / dept + location relevance (FS-002/003).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  OperationalContext,
  OperationalContextDepartmentRelevance,
  OperationalContextLocationRelevance,
} from "./operational-context";

function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

type QueryResult = {
  data: unknown;
  error: { code?: string; message: string } | null;
};

type FakeLocation = {
  id: string;
  store_id: string;
  is_active: boolean;
  /** Priority fields — FS-003 must never mutate these via domain. */
  manual_priority_count: number;
  priority_override: boolean;
  custom_decay_days: number | null;
  velocity_tier: string;
};

export type FakeOperationalContextDb = {
  client: SupabaseClient;
  contexts: OperationalContext[];
  relevance: OperationalContextDepartmentRelevance[];
  locationRelevance: OperationalContextLocationRelevance[];
  locations: FakeLocation[];
  setMissingRelation: (missing: boolean) => void;
  clear: () => void;
  seedLocation: (loc: Partial<FakeLocation> & Pick<FakeLocation, "id" | "store_id">) => void;
};

export function createFakeOperationalContextDb(): FakeOperationalContextDb {
  let missingRelation = false;
  const contexts: OperationalContext[] = [];
  const relevance: OperationalContextDepartmentRelevance[] = [];
  const locationRelevance: OperationalContextLocationRelevance[] = [];
  const locations: FakeLocation[] = [];

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
    type Filter = { col: string; op: string; val: unknown };
    const filters: Filter[] = [];
    let mode: "select" | "insert" | "update" | "delete" | "upsert" = "select";
    let insertPayload: Record<string, unknown> | Record<string, unknown>[] | null =
      null;
    let updatePayload: Record<string, unknown> | null = null;
    let wantSingle = false;
    let wantMaybeSingle = false;
    const orderCols: Array<{ col: string; asc: boolean }> = [];
    let orExpr: string | null = null;
    const inFilters: Array<{ col: string; vals: unknown[] }> = [];

    const api: Record<string, unknown> = {};

    const matchesContext = (row: OperationalContext) => {
      if (orExpr) {
        const parts = orExpr.split(",");
        const ok = parts.some((p) => {
          if (p === "store_id.is.null") return row.store_id == null;
          if (p.startsWith("store_id.eq.")) {
            return row.store_id === p.slice("store_id.eq.".length);
          }
          return false;
        });
        if (!ok) return false;
      }
      return filters.every((f) => {
        const raw = (row as unknown as Record<string, unknown>)[f.col];
        if (f.op === "eq") return String(raw) === String(f.val);
        return true;
      });
    };

    const matchesDeptRel = (row: OperationalContextDepartmentRelevance) => {
      for (const inn of inFilters) {
        if (inn.col === "context_id") {
          if (!inn.vals.map(String).includes(row.context_id)) return false;
        }
      }
      return filters.every((f) => {
        const raw = (row as unknown as Record<string, unknown>)[f.col];
        if (f.op === "eq") return String(raw) === String(f.val);
        return true;
      });
    };

    const matchesLocRel = (row: OperationalContextLocationRelevance) => {
      for (const inn of inFilters) {
        if (inn.col === "context_id") {
          if (!inn.vals.map(String).includes(row.context_id)) return false;
        }
        if (inn.col === "location_id") {
          if (!inn.vals.map(String).includes(row.location_id)) return false;
        }
      }
      return filters.every((f) => {
        const raw = (row as unknown as Record<string, unknown>)[f.col];
        if (f.op === "eq") return String(raw) === String(f.val);
        return true;
      });
    };

    const matchesLocation = (row: FakeLocation) => {
      for (const inn of inFilters) {
        if (inn.col === "id") {
          if (!inn.vals.map(String).includes(row.id)) return false;
        }
      }
      return filters.every((f) => {
        const raw = (row as unknown as Record<string, unknown>)[f.col];
        if (f.op === "eq") return String(raw) === String(f.val);
        return true;
      });
    };

    const run = async (): Promise<QueryResult> => {
      if (missingRelation) return missingError(table);

      if (table === "store_locations") {
        if (mode === "select") {
          const rows = locations.filter(matchesLocation);
          if (wantSingle || wantMaybeSingle) {
            if (rows.length === 0) {
              return wantMaybeSingle
                ? { data: null, error: null }
                : { data: null, error: { message: "no rows" } };
            }
            return { data: rows[0], error: null };
          }
          return { data: rows, error: null };
        }
        if (mode === "update") {
          const idx = locations.findIndex(matchesLocation);
          if (idx < 0) {
            return { data: null, error: { message: "no rows" } };
          }
          locations[idx] = {
            ...locations[idx]!,
            ...(updatePayload as Partial<FakeLocation>),
          };
          return {
            data: wantSingle || wantMaybeSingle ? locations[idx] : [locations[idx]],
            error: null,
          };
        }
        return { data: null, error: { message: `unsupported ${mode} on store_locations` } };
      }

      if (mode === "insert" || mode === "upsert") {
        const rows = Array.isArray(insertPayload)
          ? insertPayload
          : insertPayload
            ? [insertPayload]
            : [];

        if (table === "operational_contexts") {
          const created: OperationalContext[] = [];
          for (const row of rows) {
            const ctx: OperationalContext = {
              id: String(row.id ?? uid("oc")),
              kind: row.kind as OperationalContext["kind"],
              store_id: row.store_id == null ? null : String(row.store_id),
              title: String(row.title),
              concept_key:
                row.concept_key == null ? null : String(row.concept_key),
              start_date: String(row.start_date).slice(0, 10),
              end_date: String(row.end_date).slice(0, 10),
              source_type: row.source_type as OperationalContext["source_type"],
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
            contexts.push(ctx);
            created.push(ctx);
          }
          const data = wantSingle ? created[0] ?? null : created;
          return { data, error: null };
        }

        if (table === "operational_context_location_relevance") {
          const created: OperationalContextLocationRelevance[] = [];
          for (const row of rows) {
            const existingIdx = locationRelevance.findIndex(
              (r) =>
                r.context_id === String(row.context_id) &&
                r.location_id === String(row.location_id)
            );
            const rel: OperationalContextLocationRelevance = {
              id:
                existingIdx >= 0
                  ? locationRelevance[existingIdx]!.id
                  : String(row.id ?? uid("oclr")),
              context_id: String(row.context_id),
              location_id: String(row.location_id),
              relevance:
                row.relevance as OperationalContextLocationRelevance["relevance"],
              declared_by:
                row.declared_by == null ? null : String(row.declared_by),
              created_at:
                existingIdx >= 0
                  ? locationRelevance[existingIdx]!.created_at
                  : String(row.created_at ?? new Date().toISOString()),
              updated_at: String(row.updated_at ?? new Date().toISOString()),
            };
            if (existingIdx >= 0) locationRelevance[existingIdx] = rel;
            else locationRelevance.push(rel);
            created.push(rel);
          }
          return {
            data: wantSingle ? created[0] ?? null : created,
            error: null,
          };
        }

        const created: OperationalContextDepartmentRelevance[] = [];
        for (const row of rows) {
          const existingIdx = relevance.findIndex(
            (r) =>
              r.context_id === String(row.context_id) &&
              r.department_code === String(row.department_code)
          );
          const rel: OperationalContextDepartmentRelevance = {
            id:
              existingIdx >= 0
                ? relevance[existingIdx]!.id
                : String(row.id ?? uid("ocr")),
            context_id: String(row.context_id),
            department_code: String(row.department_code),
            relevance:
              row.relevance as OperationalContextDepartmentRelevance["relevance"],
            created_at:
              existingIdx >= 0
                ? relevance[existingIdx]!.created_at
                : String(row.created_at ?? new Date().toISOString()),
            updated_at: String(row.updated_at ?? new Date().toISOString()),
          };
          if (existingIdx >= 0) relevance[existingIdx] = rel;
          else relevance.push(rel);
          created.push(rel);
        }
        return {
          data: wantSingle ? created[0] ?? null : created,
          error: null,
        };
      }

      if (mode === "update" && table === "operational_contexts") {
        const idx = contexts.findIndex((c) => matchesContext(c));
        if (idx < 0) {
          return wantMaybeSingle
            ? { data: null, error: null }
            : { data: null, error: { message: "no rows" } };
        }
        const next = {
          ...contexts[idx]!,
          ...(updatePayload as Partial<OperationalContext>),
          start_date: String(
            updatePayload?.start_date ?? contexts[idx]!.start_date
          ).slice(0, 10),
          end_date: String(
            updatePayload?.end_date ?? contexts[idx]!.end_date
          ).slice(0, 10),
          updated_at: String(
            updatePayload?.updated_at ?? new Date().toISOString()
          ),
        };
        contexts[idx] = next as OperationalContext;
        return {
          data: wantMaybeSingle || wantSingle ? next : [next],
          error: null,
        };
      }

      if (mode === "delete") {
        if (table === "operational_contexts") {
          const keep = contexts.filter((c) => !matchesContext(c));
          const removed = new Set(
            contexts.filter((c) => matchesContext(c)).map((c) => c.id)
          );
          contexts.length = 0;
          contexts.push(...keep);
          for (let i = relevance.length - 1; i >= 0; i -= 1) {
            if (removed.has(relevance[i]!.context_id)) relevance.splice(i, 1);
          }
          for (let i = locationRelevance.length - 1; i >= 0; i -= 1) {
            if (removed.has(locationRelevance[i]!.context_id)) {
              locationRelevance.splice(i, 1);
            }
          }
        } else if (table === "operational_context_location_relevance") {
          const keep = locationRelevance.filter((r) => !matchesLocRel(r));
          locationRelevance.length = 0;
          locationRelevance.push(...keep);
        } else {
          const keep = relevance.filter((r) => !matchesDeptRel(r));
          relevance.length = 0;
          relevance.push(...keep);
        }
        return { data: null, error: null };
      }

      if (table === "operational_contexts") {
        let rows = contexts.filter(matchesContext);
        for (const ord of orderCols) {
          rows = [...rows].sort((a, b) => {
            const av = String(
              (a as unknown as Record<string, unknown>)[ord.col] ?? ""
            );
            const bv = String(
              (b as unknown as Record<string, unknown>)[ord.col] ?? ""
            );
            if (av === bv) return 0;
            const cmp = av < bv ? -1 : 1;
            return ord.asc ? cmp : -cmp;
          });
        }
        if (wantSingle || wantMaybeSingle) {
          if (rows.length === 0) {
            return wantMaybeSingle
              ? { data: null, error: null }
              : { data: null, error: { message: "no rows" } };
          }
          return { data: rows[0], error: null };
        }
        return { data: rows, error: null };
      }

      if (table === "operational_context_location_relevance") {
        const relRows = locationRelevance.filter(matchesLocRel);
        if (wantSingle || wantMaybeSingle) {
          if (relRows.length === 0) {
            return wantMaybeSingle
              ? { data: null, error: null }
              : { data: null, error: { message: "no rows" } };
          }
          return { data: relRows[0], error: null };
        }
        return { data: relRows, error: null };
      }

      const relRows = relevance.filter(matchesDeptRel);
      if (wantSingle || wantMaybeSingle) {
        if (relRows.length === 0) {
          return wantMaybeSingle
            ? { data: null, error: null }
            : { data: null, error: { message: "no rows" } };
        }
        return { data: relRows[0], error: null };
      }
      return { data: relRows, error: null };
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
      select() {
        return api;
      },
      insert(payload: Record<string, unknown> | Record<string, unknown>[]) {
        mode = "insert";
        insertPayload = payload;
        return api;
      },
      upsert(payload: Record<string, unknown> | Record<string, unknown>[]) {
        mode = "upsert";
        insertPayload = payload;
        return api;
      },
      update(payload: Record<string, unknown>) {
        mode = "update";
        updatePayload = payload;
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
      or(expr: string) {
        orExpr = expr;
        return api;
      },
      in(col: string, vals: unknown[]) {
        inFilters.push({ col, vals });
        return api;
      },
      order(col: string, opts?: { ascending?: boolean }) {
        orderCols.push({ col, asc: opts?.ascending !== false });
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
    contexts,
    relevance,
    locationRelevance,
    locations,
    setMissingRelation: (m) => {
      missingRelation = m;
    },
    clear: () => {
      contexts.length = 0;
      relevance.length = 0;
      locationRelevance.length = 0;
      locations.length = 0;
      missingRelation = false;
    },
    seedLocation: (loc) => {
      locations.push({
        manual_priority_count: 0,
        priority_override: false,
        custom_decay_days: null,
        velocity_tier: "standard",
        is_active: true,
        ...loc,
      });
    },
  };
}
