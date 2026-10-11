# DEPTSYNC-SEC-OPS-002 — Production RLS Exposure Containment

**Status:** COMPLETE (scoped production remediation) · **SEC-OPS-002B repository alignment authorized**  
**Date:** 2026-10-11  
**Project:** `fmeinlwhixngednabhgy`  
**App:** https://deptsync-hub.vercel.app  
**Migration:** `supabase/migrations/20261013_sec_ops_002_rls_containment.sql`  
**Production DB re-apply:** NOT AUTHORIZED (already applied)  
**App deploy:** NOT AUTHORIZED

---

## A. Original exposure confirmed

From SEC-OPS-001, re-confirmed live before change:

| Object | Open policy name | Roles | Command | Qual |
|--------|------------------|-------|---------|------|
| `bay_service_logs` | `Allow all operations for authenticated and anon` | `{public}` | ALL | `true` (+ CHECK `true`) |
| `rotation_exceptions` | `Allow authenticated full access to rotation_exceptions` | `{public}` | ALL | `true` |

Anon held full table DML grants on both. Anon PostgREST SELECT on `bay_service_logs` previously returned live rows.

**Application dependency check:** both tables are written/read by API routes via **service role after actor auth** (`logBayService`, `verification.ts` / `/api/rotations/exceptions`, `/api/store-locations/service`). Legitimate server paths do **not** depend on open `{public}` policies.

---

## B. Exact policies removed

| Table | Dropped policy |
|-------|----------------|
| `bay_service_logs` | `Allow all operations for authenticated and anon` |
| `rotation_exceptions` | `Allow authenticated full access to rotation_exceptions` |

**Retained (intended):**

| Table | Policy | Cmd | Roles |
|-------|--------|-----|-------|
| `bay_service_logs` | `Allow authenticated store-scoped select` | SELECT | `{authenticated}` |
| `rotation_exceptions` | `Allow authenticated store-scoped select` | SELECT | `{authenticated}` |
| `rotation_exceptions` | `Enforce Store and Department Isolation` | ALL | `{authenticated}` |

No `USING (true)` policies remain on these tables.

---

## C. Grants changed

| Target | Change |
|--------|--------|
| `bay_service_logs` → `anon` | **REVOKE ALL** |
| `rotation_exceptions` → `anon` | **REVOKE ALL** |
| `bay_service_logs` → `authenticated` | **REVOKE ALL** then **GRANT SELECT** only |
| `rotation_exceptions` → `authenticated` | **GRANT** select/insert/update/delete (supports store+dept JWT ALL policy) |
| `store_specialists` → `anon` | **REVOKE ALL** |
| `store_specialists` → `authenticated` | Table SELECT replaced with **column-level SELECT** excluding secrets |
| `profiles` → `anon` | **REVOKE SELECT** |
| `profiles` → `authenticated` | Table SELECT replaced with **column-level SELECT** excluding secrets |

**Secret columns excluded from client SELECT** (`store_specialists`): `pin`, `pin_code`, `pin_hash`, `temp_pin_hash`, `invite_token`, `invite_token_hash`, `auth_token_hash`.  

**Secret columns excluded** (`profiles`): `pin`, `pin_code`, `pin_hash`, `auth_token_hash`.

`service_role` privileges unchanged (bypasses RLS; used after API authorization).

---

## D. Backup verification

| Field | Value |
|-------|--------|
| Project | `fmeinlwhixngednabhgy` ACTIVE_HEALTHY us-west-2 |
| Dump | `tmp/production-backups/deptsync-fmeinlwhixngednabhgy-2026-10-11T16-25-50-189316000Z.dump` |
| Size | **581993** bytes |
| TOC entries | **934** (`pg_restore -l`) |
| TOC includes | stores, departments, store_specialists, weekly_rotations, bay_service_logs, rotation_exceptions |
| Meta | `…16-25-50-189316000Z.meta.json` |
| Platform PITR | Off / empty — local dump required |
| Credentials | Ephemeral DB password via Management API; **not persisted / not printed** |

Pre-state JSON: `tmp/sec-ops-002/pre-state.json`.

---

## E. Production SQL applied

1. First apply via `psql` 17.11 as `postgres` using migration file (transaction COMMIT).  
2. Secret-column SELECT required a follow-up apply of the corrected column-grant section (PostgreSQL table-level SELECT made bare `REVOKE SELECT (col)` a no-op). Full migration file re-applied via Management SQL (idempotent).  

Operational rows, PIN values, rotations, topology, walkthroughs, sections: **unchanged**.

---

## F. Live RLS verification

| Check | Result |
|-------|--------|
| Open ALL / `USING (true)` on target tables | **0** |
| RLS enabled on both tables | **true** |
| Remaining policies | store-scoped authenticated only (see §B) |
| Anon table SELECT/INSERT on targets | **false** (`has_table_privilege`) |
| Authenticated `bay_service_logs` INSERT | **false** |
| Authenticated `bay_service_logs` SELECT | **true** (store-scoped policy) |
| `pin_code` SELECT authenticated | **false** |
| `name` SELECT authenticated | **true** |

---

## G. Anonymous PostgREST verification

| Request | Result |
|---------|--------|
| `bay_service_logs?select=id` | **401** `42501` permission denied |
| `rotation_exceptions?select=id` | **401** `42501` permission denied |
| `store_specialists?select=id,name` | **401** permission denied (anon revoked) |
| `store_specialists?select=id,pin_code` | **401** permission denied |

P0 anon row disclosure: **contained**.

---

## H. Authenticated access verification

| Check | Result |
|-------|--------|
| Store-scoped policies still present | **PASS** (live catalog) |
| Live JWT session smoke (same-store read/write) | **NOT VERIFIED** — no test identities minted |
| Service-role API paths (code) | **PASS** — unchanged; still authorize then admin client |

Do not claim authenticated end-to-end smoke passed.

---

## I. Regression results

| Check | Result |
|-------|--------|
| `tsc --noEmit` | **PASS** |
| Focused security vitest | **PASS** — 6 files / **59** tests |
| Full suite | **PASS** — 110 files / **1436** tests |
| Production build | **PASS** |
| `GET /login` | **200** |
| `GET /` | **307** → login |
| Protected APIs (`/api/weekly-rotations`, `/api/walkthroughs`, `/api/rotations/exceptions`, `/api/store-locations/service`) | **401** Unauthorized |

---

## J. Remaining PIN findings (no values modified)

| Metric | Count |
|--------|------:|
| Specialists | 35 |
| With non-null `pin_code` | 3 |
| Bcrypt-shaped (`$2…`) | 0 |
| Short non-bcrypt (len ≤ 12) | **3** |
| Of those with `is_active` true | **3** |
| Master/admin-ish role among short non-bcrypt | **1** |

**Interpretation:** Three active roster rows store non-bcrypt short `pin_code` shapes (historical plaintext-compatible path still accepted by `verifyStoredPin`). Consumed by hub-bridge / PIN verify via **service role**, not client SELECT (now blocked).

**Insecurity:** Short non-bcrypt storage is weaker than salted hash if DB or privileged read is compromised. Client PostgREST SELECT of `pin_code` is now denied.

**Separate tranche:** SEC-OPS-003 / PIN-HASH-REWRITE — authorized hash migration of those three rows only; no auth redesign.

---

## K. Remaining rate-limit findings

Public auth endpoints still have **no application rate limits**:

- `POST /api/auth/hub-bridge`
- `POST /api/auth/pin-reset/request`
- `POST /api/auth/phone-reset/lookup`
- invite redeem / pair surfaces

Accepted residual from ALIGN-SEC-003. **Recommend AUTH-RATE-001** (narrow lockout / IP+username bounding) — not in this tranche.

---

## L. Migration file

`supabase/migrations/20261013_sec_ops_002_rls_containment.sql`

- Additive; does not rewrite historical migrations  
- Ensures fresh environments do not silently recreate open `{public}` ALL policies  
- Documents column-grant approach for secret SELECT containment  

**Not committed** (commit/push not authorized).

Rollback SQL (emergency only; reopens P0): `scripts/sql/sec-ops-002-rollback.sql`  
Readonly inventory helper: `scripts/sql/sec-ops-002-pre-state-readonly.sql`

---

## M. Rollback procedure

1. **Prefer:** leave containment in place.  
2. **Emergency policy restore:** run `scripts/sql/sec-ops-002-rollback.sql` (recreates open policies — **reopens P0**; operator-only).  
3. **Catastrophe data restore:** `pg_restore` from  
   `tmp/production-backups/deptsync-fmeinlwhixngednabhgy-2026-10-11T16-25-50-189316000Z.dump`  
   (operator-controlled; does not auto-run).  
4. App deploy rollback: N/A (no app deploy in this tranche).

---

## N. Remaining security blockers

| ID | Severity | Status |
|----|----------|--------|
| Open public RLS on bay_service_logs / rotation_exceptions | P0 | **Contained** |
| Secret-column client SELECT | P1 | **Contained** (column grants) |
| Short non-bcrypt PIN rows (3) | P1 | **Open** — document only |
| Public auth rate limits | P1 | **Open** — document only |
| JWT `user_metadata` fallbacks | P2 | Open (SEC-OPS-001) |
| Broad authenticated ALL on other Hub tables | P2 | Open (out of scope) |
| Authenticated e2e smoke | — | NOT VERIFIED |

---

## O. GO / NO-GO assessment

**GO for P0 containment** of the confirmed anon PostgREST exposure on `bay_service_logs` / `rotation_exceptions`.

**CONDITIONAL** overall production trust: PIN-format and rate-limit residuals remain (P1). Authenticated JWT behavior not smoke-tested with live sessions.

**Next authorized tranches (separate):**

1. Commit + push migration/docs when operator authorizes (so Vercel/repo truth matches prod).  
2. **SEC-OPS-003** — hash-rewrite 3 short non-bcrypt PINs.  
3. **AUTH-RATE-001** — public auth rate limits.  
4. **CI-001 / DOCS-TRUTH-001** — trust pack remainder.

---

*End of DEPTSYNC-SEC-OPS-002. STOP — no commit/push/app deploy.*
