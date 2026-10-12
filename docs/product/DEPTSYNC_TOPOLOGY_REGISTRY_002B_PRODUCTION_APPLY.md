# DEPTSYNC-TOPOLOGY-REGISTRY-002B — Controlled Production Registry Migration

**Mode:** Authorized production migration · **No application deployment**  
**Date (UTC apply):** 2026-10-12T00:16:10Z → 2026-10-12T00:16:12Z  
**Canonical project:** `fmeinlwhixngednabhgy`  
**Migration applied:** `supabase/migrations/20261015_store_aisles_registry.sql` (unmodified)

---

## Verdict

**APPLIED — VERIFIED**

`public.store_aisles` exists on production with 21 backfilled aisle rows, fail-closed store-scoped RLS, unchanged bay/section/assignment fingerprints, and non-mutating app smoke still healthy. No application deploy. No showroom / carpet-wall rows invented.

---

## 1. Canonical project verification

| Check | Result |
|-------|--------|
| Management API project id/ref | `fmeinlwhixngednabhgy` |
| Status | `ACTIVE_HEALTHY` |
| Region | `us-west-2` |
| DB host | `db.fmeinlwhixngednabhgy.supabase.co` |
| Postgres | `17.6` (API reports `17.6.1.155`) |
| Store 2587 | Present (`2ce36733-8843-4554-ae67-1ace71900449`) |
| Other Supabase projects used | **None** |

Identity confirmed via Management API + live `psql` session to the canonical host. Credentials were ephemeral (Management API password rotate); not persisted in repo or report.

---

## 2. References confirmed

| Document / artifact | Role |
|---------------------|------|
| `docs/product/DEPTSYNC_TOPOLOGY_REGISTRY_001_DESIGN.md` | Soft-join registry design |
| `docs/product/DEPTSYNC_TOPOLOGY_REGISTRY_002_IMPLEMENTATION.md` | Local implementation + preflight plan |
| `supabase/migrations/20261015_store_aisles_registry.sql` | Exact SQL applied (no edits) |
| `scripts/sql/registry-002-production-preflight-readonly.sql` | Read-only preflight |
| REGISTRY-002 local validation | Isolated Homebrew PG **PASS** (prior tranche); app contracts **7 PASS** / suite **1643** |

---

## 3. Production preflight (read-only)

### Schema / relationships

| Gate | Observation | Pass? |
|------|-------------|-------|
| `store_aisles` absent | `to_regclass` null | **PASS** |
| `store_locations.aisle` | `text NOT NULL` | **PASS** |
| `store_locations.bay` | `text NOT NULL` (comment in migration mentions INTEGER; production is TEXT — additive migration does not touch `bay`) | **PASS** |
| Orphan store/dept FKs | 0 / 0 | **PASS** |
| `jwt_matches_store(text)` | Present | **PASS** |
| Roles `anon` / `authenticated` / `service_role` | Present | **PASS** |
| Normalization collisions (digit-pad / case) | **0** ambiguous groups | **PASS** |
| Existing registry presence | None | **PASS** |

### Inventory (before)

| Metric | Value |
|--------|-------|
| `store_locations` rows | **712** |
| Distinct raw aisles | 20 |
| Distinct normalized aisles (global) | 20 |
| Expected registry rows `(store, dept, normalize(aisle))` | **21** |
| Active / retired bay rows | 320 active · 392 retired (`is_active` null = 0) |
| Departments with locations | 4 |
| `operational_section_members` | **0** |
| `sunday_bay_assignments` | **30** |

Per-department bay distribution (store 2587):

| Department | Distinct aisles | Bays | Retired bays |
|------------|-----------------|------|--------------|
| Cabinets | 1 | 38 | 38 |
| Electrical | 6 | 236 | 236 |
| Flooring / Home Decor | 9 | 320 | 0 |
| Paint | 5 | 118 | 118 |

### Migration tracking convention

No `supabase_migrations.schema_migrations` on this project (same out-of-band apply pattern as RD-3 / SEC-OPS-002 / CAPACITY-GUARD-003). History remains repo `supabase/migrations/` + apply reports.

### Safety gates before apply

| Gate | Result |
|------|--------|
| Additive only | **PASS** |
| Bay identities unchanged by SQL design | **PASS** |
| Section memberships untouched | **PASS** |
| Assignment records untouched | **PASS** |
| No fake bays introduced | **PASS** |
| Existing app compatible (no `store_aisles` readers yet) | **PASS** |
| RLS fail-closed (no `using(true)`) | **PASS** |
| Backfill idempotent (`ON CONFLICT DO NOTHING`) | **PASS** |
| Recovery documented | **PASS** (§8) |

---

## 4. Execution

| Item | Detail |
|------|--------|
| Method | Supabase Management API ephemeral DB password rotate → `psql` 17 (`/opt/homebrew/opt/postgresql@17/bin/psql`) over SSL |
| SQL file | `supabase/migrations/20261015_store_aisles_registry.sql` **only** |
| Transaction | Migration `BEGIN` … `COMMIT` (single transaction) |
| Apply window (UTC) | `2026-10-12T00:16:10Z` → `2026-10-12T00:16:12Z` |
| Backfill result | `INSERT 0 21` |
| App deploy | **None** |
| Unrelated migrations | **Not executed** |
| Invented showroom / carpet-wall rows | **None** |

Apply log (abridged): `CREATE EXTENSION` (pgcrypto already present) → `normalize_store_aisle` → `store_aisles` + indexes/triggers → backfill 21 → RLS enable + store-scoped SELECT policy → privilege revoke/grant → `NOTIFY pgrst` → `COMMIT`.

---

## 5. Post-migration verification

### Registry

| Check | Result |
|-------|--------|
| `public.store_aisles` exists | **Yes** |
| Columns | `id`, `store_id`, `department_id`, `aisle`, `display_name`, `is_active`, `retired_at`, `created_at`, `updated_at` |
| Constraints | PK, FKs, `UNIQUE (department_id, aisle)`, nonempty aisle, retire consistency |
| Norm unique index | `store_aisles_dept_aisle_norm_uidx` present |
| Registry rows | **21** |
| Active / retired aisles | **9 / 12** |
| Duplicate `(department_id, aisle)` | **0** |
| Unique enforcement probe | Duplicate insert → `unique_violation` (**PASS**) |
| Idempotent re-backfill | `INSERT 0 0`; count remains 21 |
| `normalize_store_aisle('041')` → `41`; `' show-l '` → `SHOW-L` | **PASS** |

Active/retired aisle distribution matches bay activity:

| Department | Aisles | Active | Retired |
|------------|--------|--------|---------|
| Cabinets | 1 | 0 | 1 |
| Electrical | 6 | 0 | 6 |
| Flooring / Home Decor | 9 | 9 | 0 |
| Paint | 5 | 0 | 5 |

No unexpected retired aisles activated (Cabinets / Electrical / Paint remain retired; Flooring remains active).

### Existing data preservation (before → after)

| Fingerprint | Before | After |
|-------------|--------|-------|
| `store_locations` count | 712 | **712** |
| `store_locations` identity md5 | `d67d4aa9ac0df83eae9f6df93fb2f384` | **same** |
| `operational_section_members` count | 0 | **0** |
| `sunday_bay_assignments` count | 30 | **30** |
| Assignments md5 (`id\|bay_id\|status`) | `c6ae1f4548eadeccb356ae979d283f9b` | **same** |

### RLS / privileges

| Check | Result |
|-------|--------|
| RLS enabled | **Yes** |
| Policies | Only `"Authenticated read store aisles"` **FOR SELECT** to `authenticated` via `jwt_matches_store` |
| Authenticated INSERT/UPDATE/DELETE policies | **None** |
| `authenticated` grants | **SELECT only** |
| `anon` table grants | **None** (revoked) |
| SELECT without store JWT claim | **0 rows** visible |
| Authenticated INSERT attempt | **permission denied** (privilege revoked) |

### Application compatibility (non-mutating smoke)

| URL | HTTP |
|-----|------|
| `https://deptsync-hub.vercel.app/` | **307** (auth redirect) |
| `https://deptsync-hub.vercel.app/floor` | **307** (auth redirect) |
| `https://deptsync-hub.vercel.app/login` | **200** |

No production test locations created. Existing app does not read `store_aisles` yet (REGISTRY-003).

---

## 6. Discrepancies

1. Migration header comment says `bay INTEGER NOT NULL`; production `store_locations.bay` is **`text NOT NULL`**. Non-blocking — migration never alters `bay`.
2. No `supabase_migrations.schema_migrations` table — expected for this project’s out-of-band apply convention; tracked via this report + repo migration file.
3. Live authenticated JWT with a real store claim was **not** exercised (would require operator session). Store isolation verified fail-closed without claim; SELECT policy SQL matches RD-3 pattern.

---

## 7. Recovery considerations

Safe while app has no registry dependency (current state):

```sql
begin;
drop table if exists public.store_aisles cascade;
drop function if exists public.store_aisles_normalize_aisle() cascade;
drop function if exists public.store_aisles_enforce_store_department() cascade;
drop function if exists public.store_aisles_touch_updated_at() cascade;
drop function if exists public.normalize_store_aisle(text) cascade;
commit;
```

**Never** delete or rewrite `store_locations` / section members / assignments to “undo” registry.

If a future apply failed mid-transaction: this migration wraps `BEGIN`/`COMMIT` — a failed apply rolls back entirely. This apply **committed successfully**; do not re-apply the full file casually (idempotent parts are safe; prefer verification SELECT first).

Ephemeral DB password was rotated for this session and cleared from local temp files after verification.

---

## 8. Final verdict

**APPLIED — VERIFIED**

Production `fmeinlwhixngednabhgy` now has the additive `store_aisles` registry with expected backfill and fail-closed RLS. Operational bay data and the deployed application binary are unchanged. Next product step (separate authorization): **REGISTRY-003** Create Location UI + Map merge — still do not invent empty production zones until that ships.
