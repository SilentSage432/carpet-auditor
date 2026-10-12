/**
 * DEPTSYNC-TOPOLOGY-REGISTRY-002 — migration + normalize contracts.
 * Does not execute SQL against production. Local PG validation is separate.
 */

import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { normalizeAisle } from "./aisle";
import { locationDedupeAisleKey } from "./locations";

const root = path.resolve(__dirname, "../..");
const migrationPath =
  "supabase/migrations/20261015_store_aisles_registry.sql";

function readRepo(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

/** App-side equivalent of SQL public.normalize_store_aisle. */
function normalizeStoreAisleCode(raw: unknown): string {
  return locationDedupeAisleKey(raw);
}

describe("REGISTRY-002 migration contracts", () => {
  const sql = readRepo(migrationPath);

  it("creates additive store_aisles with required columns and soft-retire", () => {
    expect(sql).toMatch(/create table if not exists public\.store_aisles/);
    expect(sql).toMatch(/store_id uuid not null/);
    expect(sql).toMatch(/department_id uuid not null/);
    expect(sql).toMatch(/aisle text not null/);
    expect(sql).toMatch(/display_name text null/);
    expect(sql).toMatch(/is_active boolean not null default true/);
    expect(sql).toMatch(/retired_at timestamptz null/);
    expect(sql).toMatch(/store_aisles_retire_consistency_check/);
    expect(sql).toMatch(/unique \(department_id, aisle\)/);
  });

  it("does not alter store_locations bay NOT NULL or add FK from bays", () => {
    expect(sql).not.toMatch(/alter table public\.store_locations/);
    expect(sql).not.toMatch(/store_locations_.*store_aisles/);
    expect(sql).not.toMatch(/references public\.store_aisles/);
    expect(sql).not.toMatch(/bay\s+null/i);
  });

  it("includes normalize function, triggers, and idempotent backfill", () => {
    expect(sql).toMatch(/create or replace function public\.normalize_store_aisle/);
    expect(sql).toMatch(/store_aisles_normalize_aisle/);
    expect(sql).toMatch(/store_aisles_enforce_store_department/);
    expect(sql).toMatch(/on conflict \(department_id, aisle\) do nothing/i);
    expect(sql).toMatch(/bool_or\(sl\.is_active is distinct from false\)/);
  });

  it("RLS: no authenticated writes; fail-closed without jwt_matches_store", () => {
    expect(sql).toMatch(/enable row level security/);
    expect(sql).toMatch(/Authenticated read store aisles/);
    expect(sql).toMatch(/jwt_matches_store missing — authenticated SELECT denied/);
    expect(sql).toMatch(
      /revoke insert, update, delete, truncate, references, trigger on table public\.store_aisles from authenticated/
    );
    expect(sql).not.toMatch(/using \(true\)/);
    expect(sql).not.toMatch(/for insert/i);
    expect(sql).not.toMatch(/for update/i);
    expect(sql).not.toMatch(/for delete/i);
  });

  it("transactional begin/commit wrapper", () => {
    expect(sql.trimStart().startsWith("begin;") || sql.includes("\nbegin;")).toBe(
      true
    );
    expect(sql).toMatch(/\ncommit;\s*$/);
  });

  it("does not wire app UI or rotation engines", () => {
    expect(sql).not.toMatch(/sunday_bay_assignments/);
    expect(sql).not.toMatch(/section-aware/);
    expect(sql).not.toMatch(/operational_section_members/);
  });
});

describe("REGISTRY-002 normalize parity with app helpers", () => {
  it("matches normalizeAisle for named zones and digit collapse for numbers", () => {
    expect(normalizeStoreAisleCode(" show-l ")).toBe("SHOW-L");
    expect(normalizeStoreAisleCode("CARPET-WALL")).toBe("CARPET-WALL");
    expect(normalizeStoreAisleCode("clothing")).toBe("CLOTHING");
    expect(normalizeStoreAisleCode("012")).toBe("12");
    expect(normalizeStoreAisleCode("41")).toBe("41");
    expect(normalizeStoreAisleCode("0")).toBe("0");
    expect(normalizeAisle(" show-l ")).toBe("SHOW-L");
    expect(locationDedupeAisleKey("012")).toBe("12");
  });
});
