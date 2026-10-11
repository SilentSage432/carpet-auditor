# DEPTSYNC-RD-3-DB-PREFLIGHT — Production Migration Readiness

**Status:** COMPLETE (read-only inspection)  
**Date:** 2026-10-10  
**Mode:** No production mutations · no commit · no push · no deploy · no RD-4  
**Migration:** `supabase/migrations/20261011_operational_sections.sql`  
**Operator SQL:** [`scripts/sql/rd3-operational-sections-preflight-readonly.sql`](../../scripts/sql/rd3-operational-sections-preflight-readonly.sql)

Application tests do **not** prove database-level uniqueness. This tranche inspects production catalog compatibility only.

---

## A. Production project identity

| Field | Value |
|-------|--------|
| Project ref | `fmeinlwhixngednabhgy` |
| Host | `fmeinlwhixngednabhgy.supabase.co` |
| Source | Local `.env.local` `NEXT_PUBLIC_SUPABASE_URL` |
| Match to historical prod | **Yes** — same ref used for APP-AUD / APP-CAT / APP-UPC migrations |
| New project | **Not created / not recommended** |

Evidence store sample (read-only REST): store_numbers include `2587`, `1852`, and legacy test numbers — confirming the live multi-store registry on this project.

---

## B. Migration dependency verification

| Dependency | Required by migration | Production evidence | Status |
|------------|----------------------|---------------------|--------|
| `public.stores (id uuid PK, store_number text)` | FK + RLS join | REST OpenAPI + `select id,store_number` OK | **Present** |
| `public.departments (id uuid PK)` | FK | REST OpenAPI + table probe 200 | **Present** |
| `public.store_specialists (id uuid PK)` | nullable owner FK `ON DELETE SET NULL` | REST OpenAPI uuid; count probe OK | **Present** |
| `pgcrypto` / `gen_random_uuid()` | table defaults | Existing UUID PKs on stores/depts | **Present** (extension already used) |
| `authenticated` role | RLS policy target | Standard on Supabase; migration skips policies only if absent | **Expected present** |
| `public.jwt_matches_store(text)` | Store-scoped SELECT policies | OpenAPI exposes `/rpc/jwt_matches_store`; POST with `p_store_number` returns 200 | **Present** (`p_store_number text` ≡ `(text)` for `to_regprocedure`) |
| Expression-index functions (`upper`, `trim`, `regexp_replace`) | Unique bay index | Built-in immutable SQL | **OK** |
| Trigger syntax `execute function` | aisle normalize | Already used by applied migrations on this project | **OK** |

**SQL structure review (static):** Tables, FKs, checks, events enum constraint, normalize trigger, expression unique index, partial active-name unique, RLS enable + SELECT-only policies, `notify pgrst` — all internally consistent. No references to Sunday rotation / weekly capacity / topology mutation tables.

**Note:** Member rows do **not** FK to `store_locations` (physical bay identity is `(department_id, aisle, bay)`). Topology records are untouched.

---

## C. Existing object conflicts

Read-only PostgREST probes against production (`PGRST205` / OpenAPI):

| Object | Status |
|--------|--------|
| `operational_sections` | **Absent** |
| `operational_section_members` | **Absent** |
| `operational_section_events` | **Absent** |
| `normalize_operational_section_aisle` | **Absent** (not in OpenAPI RPC list) |
| OpenAPI defs matching `operational_section*` | **None** |

Near-name collision: `operational_contexts` (seasonal cadence) exists and is a **different domain**. PostgREST even hinted that name when RD-3 tables were missing. No schema conflict.

`CREATE TABLE IF NOT EXISTS` / `DROP … IF EXISTS` / `CREATE OR REPLACE` make a clean first apply safe. Re-running after partial failure is mostly idempotent; first apply on empty catalog is the intended path.

---

## D. RLS / security compatibility

| Check | Finding |
|-------|---------|
| Write surface | Migration creates **no** authenticated INSERT/UPDATE/DELETE policies — writes remain service-role after API actor checks |
| Read surface | When `jwt_matches_store` exists (confirmed), policies scope SELECT via `stores.store_number` |
| Fallback risk | If helper were missing, migration would install open authenticated SELECT — **does not apply here** |
| JWT helper naming | Function arg is `p_store_number`; SQL call `jwt_matches_store(s.store_number)` is valid |
| Service role vs operator auth | Unchanged — API still requires Supervisor/Master + store + department assert (FIX-001) |

Compatible with ALIGN-SEC JWT RLS posture already live on this project.

---

## E. Database uniqueness verification plan

**Production-safe (authorized):** After migration, run sections B2–B3 of  
`scripts/sql/rd3-operational-sections-preflight-readonly.sql`:

1. Trigger `operational_section_members_normalize_aisle` → function `normalize_operational_section_aisle`
2. Unique index `operational_section_members_one_bay_idx` definition contains  
   `regexp_replace(upper(trim(BOTH FROM aisle)), '\s+', ' ', 'g')`  
   on `(department_id, <expr>, bay)`

That proves the **database invariant is installed**. It does not require writing rows.

**Not authorized on production for this tranche:** INSERT of case/whitespace conflict pairs (even inside `BEGIN…ROLLBACK`).

**Live conflict proof options (later, separate authorization):**

- Non-production clone / local Postgres applying the same migration, **or**
- Operator smoke via API: create section A with bay `bw`/1, attempt section B with ` BW `/1 → expect `bay_conflict` / `23505`, then retire A.

App vitest normalize parity supports equivalence but **does not replace** catalog verification above.

---

## F. Migration execution procedure

**Not executed in this tranche.** When the operator authorizes:

1. Confirm project in Supabase dashboard = `fmeinlwhixngednabhgy` (no new project).
2. Optional: take a pre-migration dump (historical practice under `tmp/production-backups/`).
3. Run preflight block **A** of the readonly SQL — expect RD-3 objects null/false; `jwt_matches_store` present.
4. Apply **only** `supabase/migrations/20261011_operational_sections.sql` in SQL Editor (or equivalent psql) on that project.
5. Run post-migration block **B** — expect three tables, RLS on, SELECT policies with `jwt_matches_store`, trigger + unique expression index, empty row counts.
6. Prefer migrate **before** shipping RD-3 app routes to production (app already degrades to `missing_relation` / empty Map index if tables absent).
7. Do **not** run Sunday bootstrap / topology rebuild as part of this migration.

---

## G. GO / NO-GO

| Decision | Verdict |
|----------|---------|
| Compatibility of pending migration with this production project | **GO** — prerequisites present; RD-3 objects absent; JWT helper present; additive DDL |
| Execute migration now (this agent / this tranche) | **NO-GO** — execution not authorized |
| Production deploy / commit / push / RD-4 | **NO-GO** |

**CONDITIONAL GO for operator-authorized migration execution** on `fmeinlwhixngednabhgy` after dump + preflight A + apply + verify B.

**STOP.**
