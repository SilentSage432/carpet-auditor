# DEPTSYNC-TOPOLOGY-REGISTRY-002 — Independent Location Registry Database Foundation

**Status:** COMPLETE (local migration + isolated DB validation; production not applied)  
**Date:** 2026-10-11  
**Mode:** Controlled implementation — production database **READ-ONLY**  
**Application:** https://deptsync-hub.vercel.app (unchanged; no deploy)  
**Supabase (canonical):** `fmeinlwhixngednabhgy` (**migration NOT applied**)  
**Store:** `2587`

**References:**  
[`DEPTSYNC_TOPOLOGY_REGISTRY_001_DESIGN.md`](DEPTSYNC_TOPOLOGY_REGISTRY_001_DESIGN.md) ·  
[`DEPTSYNC_TOPOLOGY_UX_004_IMPLEMENTATION.md`](DEPTSYNC_TOPOLOGY_UX_004_IMPLEMENTATION.md) ·  
[`DEPTSYNC_TOPOLOGY_AREAS_001_DISCOVERY.md`](DEPTSYNC_TOPOLOGY_AREAS_001_DISCOVERY.md) ·  
[`DEPTSYNC_SECTION_UX_003_RELEASE.md`](DEPTSYNC_SECTION_UX_003_RELEASE.md)

**Strict exclusions honored:** No production SQL apply, no production data mutations, no app UI, no deploy, no capacity/Sunday/Zebra/section-aware changes, no fake bays, no FK rewrite of `store_locations`.

---

## 1. Executive summary

Implemented the additive `public.store_aisles` registry as designed in REGISTRY-001: aisle/zone existence independent of bay rows, soft-joined by `(department_id, normalize_store_aisle(aisle))`, with idempotent backfill from `store_locations` and RD-3-style restrictive RLS (fail-closed when `jwt_matches_store` is absent).

| Gate | Result |
|------|--------|
| Migration authored | **IMPLEMENTED LOCALLY** |
| Isolated local Postgres validation | **VERIFIED IN ISOLATED DATABASE** |
| Production apply | **NOT VERIFIED IN PRODUCTION** / **NOT EXECUTED** |
| App UI / deploy | **NOT DONE** (REGISTRY-003) |
| Typecheck / full tests / build | **PASS** (`tsc`; **1643** tests; `next build`) |

**Verdict:** **CONDITIONAL GO** for a later operator-authorized production migration apply. **NO-GO** to apply or deploy in this tranche.

---

## 2. Migration filename

`supabase/migrations/20261015_store_aisles_registry.sql`

Supporting (not production DDL):

| Path | Role |
|------|------|
| `scripts/sql/registry-002-local-validation-harness.sql` | Disposable parent stubs |
| `scripts/sql/registry-002-local-validation-seed.sql` | Fixture aisles/bays |
| `scripts/sql/registry-002-local-validation-asserts.sql` | Local assert DO block |
| `scripts/sql/registry-002-production-preflight-readonly.sql` | Production SELECT-only preflight |

---

## 3. Exact schema implemented

```text
public.store_aisles (
  id uuid PK,
  store_id uuid NOT NULL → stores(id) ON DELETE CASCADE,
  department_id uuid NOT NULL → departments(id) ON DELETE RESTRICT,
  aisle text NOT NULL,                    -- stored normalized
  display_name text NULL,
  is_active boolean NOT NULL DEFAULT true,
  retired_at timestamptz NULL,
  created_at / updated_at timestamptz,
  UNIQUE (department_id, aisle),
  retire consistency CHECK,
  aisle nonempty CHECK
)
+ unique expression index on (department_id, normalize_store_aisle(aisle))
+ indexes (store_id, is_active), (department_id)
```

Functions / triggers:

| Object | Role |
|--------|------|
| `normalize_store_aisle(text)` | Immutable normalize (see §4) |
| `store_aisles_normalize_aisle` | BEFORE INSERT/UPDATE normalize |
| `store_aisles_enforce_store_department` | `store_id` must equal `departments.store_id` |
| `store_aisles_touch_updated_at` | `updated_at` on UPDATE |

**Intentional design correction vs REGISTRY-001 open-read fallback:** when `jwt_matches_store` is missing, authenticated SELECT is **denied** (fail-closed). REGISTRY-001 mirrored RD-3’s `using (true)` fallback; mission forbids permissive fallbacks. Production has `jwt_matches_store` (CAPACITY / RD-3 history).

**Unchanged:** `store_locations.bay NOT NULL`; no FK from bays → registry.

---

## 4. Normalization rules

SQL `normalize_store_aisle(raw)`:

1. `trim` → `upper` → collapse whitespace (`\s+` → single space)  
2. If result matches `^\d+$`, cast via numeric → bigint → text (collapses `"012"` → `"12"`, keeps `"0"`)  
3. Otherwise keep alphanumeric zone codes (`SHOW-L`, `CARPET-WALL`)

App parity: `locationDedupeAisleKey` / `normalizeAisle` + digit collapse (**VERIFIED** in contract tests).

**Does not rewrite** existing `store_locations.aisle` values.

---

## 5. Backfill behavior

Inside the same transaction as DDL:

```sql
INSERT INTO store_aisles (…)
SELECT store_id, department_id, normalize_store_aisle(aisle), …
FROM store_locations
JOIN departments …
GROUP BY store, department, normalized aisle
ON CONFLICT (department_id, aisle) DO NOTHING;
```

| Rule | Behavior |
|------|----------|
| Active state | `bool_or(is_active IS DISTINCT FROM false)` — any active bay → registry active |
| Fully retired | All inactive → `is_active=false`, `retired_at=max(updated_at)` |
| Mixed active/retired | Registry **active** |
| Digit padding variants | One registry row (`012`+`12` → `12`) |
| Re-run | `DO NOTHING` — does not reactivate or flip state |
| Empty aisle | Skipped |

---

## 6. RLS and authorization model

| Actor | Privilege |
|-------|-----------|
| `anon` | Revoked ALL on `store_aisles` |
| `authenticated` | `GRANT SELECT` only; policy uses `jwt_matches_store(store_number)` |
| `authenticated` writes | No INSERT/UPDATE/DELETE policies; privileges revoked |
| `service_role` | Bypasses RLS (future REGISTRY-003 API after `requireSuperAdmin`) |

Floor Command MasterAdmin ≠ Postgres role: topology writes remain **service-role API + app actor checks** (same as bulk locations). No client mutation trust.

---

## 7. Compatibility findings

| Check | Result |
|-------|--------|
| Existing Map / bay queries | Unaffected — app does not read `store_aisles` yet |
| Bay creation / sections / assignments / Sunday | Unchanged — no app wiring |
| `store_locations` schema | Untouched |
| Additive table only | Yes |

---

## 8. Local database verification

**VERIFIED IN ISOLATED DATABASE** (Homebrew PostgreSQL 14 on `127.0.0.1`, disposable DB `deptsync_registry_002_val_*`, dropped after run).

| Assert | Result |
|--------|--------|
| Migration applies in one transaction | **PASS** |
| Backfill distinct aisles | **PASS** (4 from seed bay groups) |
| Digit padding collapse `012`/`12` → `12` | **PASS** |
| Mixed 41 → active | **PASS** |
| Fully retired 99 → inactive | **PASS** |
| Named zone `CARPET-WALL` | **PASS** |
| Zero-bay `SHOW-L` insert | **PASS** |
| Duplicate `show-l` rejected | **PASS** |
| Cross-department same code | **PASS** |
| Store/department mismatch rejected | **PASS** |
| `store_locations` count unchanged (6) | **PASS** |
| Idempotent re-backfill | **PASS** |
| RLS policy creation with jwt absent | Fail-closed notice (expected in stub DB) |

**Production apply:** see [`DEPTSYNC_TOPOLOGY_REGISTRY_002B_PRODUCTION_APPLY.md`](DEPTSYNC_TOPOLOGY_REGISTRY_002B_PRODUCTION_APPLY.md) — **APPLIED — VERIFIED** (2026-10-12 UTC).

---

## 9. Application test results

| Gate | Result |
|------|--------|
| Focused REGISTRY-002 contracts | **7 PASS** |
| UX-004 blocker suite (updated) | **9 PASS** |
| Full suite | **1643 PASS** / 131 files |
| `npx tsc --noEmit` | **PASS** |
| Relevant eslint | **PASS** |
| `npm run build` | **PASS** |

---

## 10. Production migration preflight

Operator-run **SELECT-only** script:

`scripts/sql/registry-002-production-preflight-readonly.sql`

Checks:

1. Store `2587` present  
2. `store_aisles` absent (or report if present)  
3. `store_locations.bay` still NOT NULL  
4. Distinct aisle pair counts (backfill expectation)  
5. Digit-padding ambiguity groups (review; migration collapses safely)  
6. `jwt_matches_store` present  
7. `anon` / `authenticated` / `service_role` roles  

**STOP and escalate** if preflight shows destructive ambiguity beyond padding/case (none expected from design).

---

## 11. Production execution plan (DO NOT EXECUTE HERE)

1. Confirm canonical project `fmeinlwhixngednabhgy`  
2. Take fresh dump / backup  
3. Run preflight readonly SQL; record row counts  
4. Apply `20261015_store_aisles_registry.sql` in a maintenance window (single transaction)  
5. Post-migration verification (§12)  
6. Leave app unchanged (still bay-derived Map) until REGISTRY-003  
7. Do not create empty production zones until UI ships  

**Locking note:** Backfill is `INSERT…SELECT` grouped; expect brief share locks on `store_locations` reads. Prefer low-traffic window. No UPDATE/DELETE on bay rows.

---

## 12. Post-migration verification (production, future)

```sql
-- table + RLS
select c.relrowsecurity from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'store_aisles';

-- registry count vs distinct normalized aisles
select count(*) from public.store_aisles;

-- no bay mutation
-- compare store_locations count to preflight

-- policies
select polname, polcmd from pg_policy
where polrelid = 'public.store_aisles'::regclass;

-- anon cannot insert (expect failure as anon)
```

---

## 13. Rollback / recovery strategy

| Situation | Action |
|-----------|--------|
| Before app depends on registry | `DROP TABLE public.store_aisles CASCADE;` + drop `normalize_store_aisle` if unused |
| After REGISTRY-003 ships | Redeploy prior app first, then drop only if empty/unused |
| Never | Delete or rewrite `store_locations` to “undo” registry |
| Partial apply | Transaction `BEGIN`/`COMMIT` — failed apply rolls back entirely |

---

## 14. Known limitations

1. App cannot create/display empty locations until REGISTRY-003.  
2. Registry active flag is not continuously synced when bays retire after backfill (REGISTRY-003/cleanup should ensure).  
3. Local stub DB lacks `jwt_matches_store` — production policy path validated by SQL presence + RD-3 precedent, not live JWT smoke.  
4. `display_name` unused until UI.  
5. No commit/push/deploy performed in this tranche.

---

## 15. Files changed

| Path | Change |
|------|--------|
| `supabase/migrations/20261015_store_aisles_registry.sql` | **New** migration |
| `scripts/sql/registry-002-local-validation-*.sql` | Local harness / seed / asserts |
| `scripts/sql/registry-002-production-preflight-readonly.sql` | Production preflight |
| `lib/store-ops/topology-registry-002.contract.test.ts` | **New** contracts |
| `lib/store-ops/topology-ux-004.zero-bay.blocker.test.ts` | Expect `store_aisles` migration |
| `docs/product/DEPTSYNC_TOPOLOGY_REGISTRY_002_IMPLEMENTATION.md` | This report |
| `DEVELOPMENT_JOURNAL.md` / `CHAT_HANDOFF.md` / `MASTER_ROADMAP.md` | Program records |

---

## 16. GO / CONDITIONAL GO / NO-GO

| Decision | Verdict |
|----------|---------|
| Local migration implementation | **GO** — **IMPLEMENTED LOCALLY** |
| Isolated DB validation | **GO** — **VERIFIED IN ISOLATED DATABASE** |
| Production migration apply now | **NO-GO** |
| Application deploy / UI | **NO-GO** (REGISTRY-003) |
| Operator-authorized prod apply later | **CONDITIONAL GO** after preflight + dump |

**Overall tranche:** **CONDITIONAL GO** for future production SQL authorization.  
**This session:** migration + local proof + docs complete; production untouched.

**STOP.**
