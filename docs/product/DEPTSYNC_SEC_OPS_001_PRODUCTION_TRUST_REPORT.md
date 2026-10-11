# DEPTSYNC-SEC-OPS-001 — Production Security Truth Report

**Status:** COMPLETE (read-only verification)  
**Date:** 2026-10-11  
**Mode:** READ-ONLY PRODUCTION VERIFICATION  
**Implementation / mutations / commits / pushes / deploys:** NOT AUTHORIZED  

---

## A. Executive GO / NO-GO assessment

**NO-GO for production security certification.**

Floor Command **application edge + API authorization** largely matches ALIGN-SEC / RD-3 / RD-5 intent (fail-closed gate cookie, protected APIs return 401 without session, Supervisor/Master gates on sensitive routes, service-role used after actor resolve).

The **live database RLS posture does not fully enforce** the intended model. Two public tables retain open `USING (true)` policies for role `{public}` (includes `anon`). With the published anon key, unauthenticated PostgREST **SELECT on `bay_service_logs` returned live row ids + `store_id` + timestamps** (demonstrated). Privilege metadata also shows anon **INSERT** capability on that table and on `rotation_exceptions` — INSERT behavior was **not** exercised (mutation forbidden).

Until open public policies are dropped and secret-column grants are revoked to match `20260817_rls_security_lockdown.sql` intent, production cannot be certified as store-boundary–safe at the database layer.

**Operator workflow may continue** with awareness that PostgREST anon exposure exists on residual open tables; remediation tranche recommended next (see §L / §O).

---

## B. Production environment identity

| Check | Result | Evidence |
|-------|--------|----------|
| Canonical Supabase project | **PASS** — `fmeinlwhixngednabhgy` | Management API project status `ACTIVE_HEALTHY`, region `us-west-2` |
| `.env.local` URL ref | **PASS** — host `fmeinlwhixngednabhgy.supabase.co` | Local env host parse (values not printed) |
| Production app | **PASS** — `https://deptsync-hub.vercel.app` | Unauthenticated smoke (login 200; APIs 401) |
| Alternate Supabase project | **Not used** | All SQL via Management API on canonical ref |
| Live SQL access | **Available** | `POST /v1/projects/.../database/query` as `postgres` (read-only SELECTs only) |

Secrets (DB password, service-role key, JWT signing secret, session tokens, env values) were **not printed**.

---

## C. Live database / RLS inventory

**Discovery:** 36 `public` base tables. **RLS enabled on all 36. RLS forced: none.**

| Table | RLS | Forced | Policies (summary) |
|-------|-----|--------|--------------------|
| stores | ON | N | authenticated ALL via `jwt_matches_store` |
| departments | ON | N | authenticated ALL store+dept |
| store_specialists | ON | N | SELECT store; INSERT/UPDATE/DELETE roster_admin |
| store_locations | ON | N | SELECT store; ALL store+dept |
| store_profiles | ON | N | **No policies** (client fail-closed) |
| profiles | ON | N | own read/update; elevated store ALL |
| weekly_rotations | ON | N | SELECT store; ALL store+dept |
| sunday_bay_assignments | ON | N | SELECT `jwt_matches_store`; ALL exact `app_metadata` match |
| weekly_rotation_completion_attempts | ON | N | ALL via weekly_rotations→departments |
| operational_sections / _members / _events | ON | N | **SELECT-only** store via `stores` + `jwt_matches_store` |
| walkthrough_sessions / _observations / _follow_ups | ON | N | **SELECT-only** store via `stores` + `jwt_matches_store` |
| manager_notes / shift_walk_tasks / downstock_queue | ON | N | store(+dept) ALL for authenticated |
| bay_service_logs | ON | N | **OPEN `{public}` ALL true** + scoped SELECT |
| rotation_exceptions | ON | N | **OPEN `{public}` ALL true** + scoped policies |
| fiscal_years / fiscal_weeks | ON | N | authenticated SELECT true (catalog) |
| appliance_* / carpet_* / bay_audit_logs / associate_shift_days / push_subscriptions / operational_contexts* | ON | N | store-scoped (or self) policies |

**Row counts (readonly, contextual):** stores 5 · departments 12 · store_specialists 35 · store_locations 584 · weekly_rotations 156 · sunday_bay_assignments 30 · operational_sections 1 · walkthrough_sessions 0 · manager_notes 2 · profiles 1 · store_profiles 1 · bay_service_logs 3 · rotation_exceptions 0.

**Stores present:** `1234`, `1234258`, `12342587`, `1852`, `2587` (numbers only).

**Tables with RLS ON and zero policies:** `store_profiles` only → client roles denied by default; service_role still bypasses RLS (expected in Supabase).

---

## D. Policy and grant verification

### Intended model (from ALIGN-SEC / RD-3 / RD-5 / lockdown migration)

- Single authorized operator (ALIGN-002); Supervisor/Master for privileged mutations  
- Store-scoped operational records  
- Client: prefer authenticated SELECT; writes via API + service role after authz  
- Fail-closed gate / bootstrap / master PIN  
- Historical evidence preserved  
- Legacy associate auth still supported (not retired)  

### Live findings

| Control | Classification | Notes |
|---------|----------------|-------|
| RLS enabled on app tables | **PASS** | 36/36 |
| RLS forced | **NOT APPLICABLE / gap** | None forced; owners/service_role bypass expected — do not claim RLS protects service-role |
| RD-3 / RD-5 SELECT-only (no auth write policies) | **PASS** | Confirmed on sections + walkthroughs |
| Open `{public}` ALL true policies | **FAIL — P0** | `bay_service_logs`, `rotation_exceptions` |
| Fiscal catalog SELECT true | **PASS** (intent) | Authenticated global read of fiscal calendar |
| Anon table grants (DML) | **FAIL — P1** (defense-in-depth) | Broad grants on nearly all public tables; safe only when RLS denies |
| `pin_code` / token column SELECT to anon+authenticated | **FAIL — P1** | Grants present; contradicts lockdown migration revoke |
| Anon SELECT store-scoped tables without JWT store claim | **PASS** (smoke) | empty `[]` for specialists/rotations/stores/walkthroughs/sections |
| Anon SELECT `bay_service_logs` | **FAIL — P0** | Demonstrated live rows |

PostgreSQL **PERMISSIVE** policies OR together: store-scoped policies do **not** neutralize a coexisting `USING (true)` policy.

---

## E. `jwt_matches_store` verification

**Deployed definition (live):**

```sql
-- SECURITY INVOKER, STABLE, no search_path pin on this function
select
  public.jwt_store_number() is not null
  and p_store_number is not null
  and nullif(ltrim(public.jwt_store_number(), '0'), '')
    = nullif(ltrim(p_store_number, '0'), '');
```

| Property | Result |
|----------|--------|
| Present as `(text)` | **PASS** |
| Security mode | **SECURITY INVOKER** |
| Zero-prefix normalization | **PASS** (`ltrim(..., '0')`) |
| Claim source | `jwt_store_number()` → `app_metadata.store_number` then **`user_metadata.store_number`** |
| Related elevation | `jwt_app_role()` / `jwt_is_elevated()` also coalesce **user_metadata** |
| Bypass via client JWT forge | **NOT VERIFIED** (no forge) — Supabase signs JWTs; client cannot mint `app_metadata` |
| Bypass via `user_metadata` when `app_metadata` empty | **NOT VERIFIED — REQUIRES CONTROLLED TEST** | Fallback exists; hub-bridge sets `app_metadata` on mint |
| Protects service-role | **NOT APPLICABLE** | service_role bypasses RLS |

Hub-bridge sets `app_metadata.store_number` + `app_metadata.role` on user create/link path (`lib/store-ops/hub-bridge.ts`). Residual risk is sessions missing app claims.

`sunday_bay_assignments` ALL policy still uses **exact** `app_metadata.store_number` equality (no zero-strip) — inconsistent with `jwt_matches_store` (**P2**).

---

## F. API authorization findings

Pattern for Floor Command / Store Ops mutations (source):

1. `resolveStoreOpsActor(request)` ← Auth JWT → `profiles` (service-role read of profile)  
2. `requireStoreOpsActor` / `requireSupervisorOrAdmin` / `requireSuperAdmin`  
3. Actor `storeNumber` drives queries; RD-3/5 load helpers re-check store ownership  
4. Privileged DB via `getSupabaseAdmin()` **after** checks  

| Area | Authz pattern | Classification |
|------|---------------|----------------|
| Walkthroughs (write) | Supervisor/Master + store-scoped domain | **PASS** (source) |
| Walkthroughs (list GET) | Store Ops actor | **PASS** (source) |
| Operational sections mutate | Supervisor/Master + `loadOperationalSectionForStore` | **PASS** (source) |
| Rotations verify | Supervisor/Master (legacy associate verify path removed — THESIS-001A) | **PASS** (source + tests) |
| Rotations complete | Authenticated floor actor; dept scoping for associates | **PASS** (legacy associate allowed by design) |
| Roster create | Super admin | **PASS** (source) |
| Store locations mutate | Supervisor/Master or Super admin (route-specific) | **PASS** (source) |
| Bulk locations | Super admin + dept `store_id` check | **PASS** (source) |
| Cron weekly-rotation | `CRON_SECRET` at handler | **PASS** (edge allows; handler denies without secret — smoke 401) |
| Proxy edge | Gate cookie; Bearer alone does not bypass | **PASS** (source `proxy.ts` / `edgeAllowsRequest`) |

Cross-store API exploit with live credentials: **NOT VERIFIED — REQUIRES CONTROLLED TEST** (no test identities created).

Success-without-persistence paths: not re-audited exhaustively here; RD-3/5 contract tests cover primary mutation routes (**local tests PASS**).

---

## G. Authentication findings

| Control | Classification | Evidence |
|---------|----------------|----------|
| Hub gate `HUB_GATE_SECRET` only | **PASS** (code) | `lib/auth-gate.ts` — no cron/service/anon/hardcoded fallback |
| Gate cookie HttpOnly / SameSite=Lax / Secure in production | **PASS** (code) | `hubGateCookieOptions()` |
| Edge: protected `/api/*` without gate | **PASS** (prod smoke) | weekly-rotations, walkthroughs, sections, roster, store-locations → **401** |
| Edge: public `/api/auth/*` | **PASS** (intent) | hub-bridge reachable; empty body → 400 validation |
| Bootstrap HTTP requires `BOOTSTRAP_SECRET` | **PASS** (prod smoke + code) | GET/POST without Bearer → **401** |
| Master PIN fail-closed when unset | **PASS** (local tests) | `hub-master-pin.test.ts` |
| Legacy associate login | **Present by design** | Not retired; distinguish from final single-operator model |
| Rate limiting on hub-bridge / pin-reset / phone-lookup | **FAIL — P1** | No rate-limit implementation found; accepted residual in SEC-003 |
| Historical non-bcrypt `pin_code` rows | **FAIL — P1** | 3 of 35 specialists: `pin_code` present, not `$2…` prefix, length ≤ 12 (values not inspected) |

---

## H. Cross-store integrity findings

| Relationship | Enforcement | Class |
|--------------|-------------|-------|
| department → store | FK `departments.store_id → stores.id` | **A** DB |
| location → store + department | FKs present; **no** composite guaranteeing dept.store = location.store | **A** partial + **B** API |
| section → store + department | FKs; uniqueness trigger/index (RD-3); API `loadOperationalSectionForStore` | **A** + **B** |
| section members → store | FK store_id; API store load | **A** + **B** |
| walkthrough → store + soft refs | FK store; RD-5-FIX domain store_number / section-for-store | **A** + **B** |
| weekly_rotations → department + location | FKs; store_number column + RLS | **A** + **B** |
| specialist → store | `store_number` column + RLS; dept FKs SET NULL | **B** primary for store_number |
| Missing composite FKs alone | Not treated as exploit | **C** unless API also missing |

No **D — demonstrated vulnerability** for cross-store attachment via API in this tranche (mutations forbidden; no dual-store test actors).

---

## I. Public endpoint findings

Unauthenticated production smoke (`https://deptsync-hub.vercel.app`):

| Endpoint | Result |
|----------|--------|
| `GET /` | 307 (redirect) |
| `GET /login` | 200 |
| `GET /api/weekly-rotations` (etc.) | 401 `{"error":"Unauthorized"}` |
| `POST /api/auth/hub-bridge` `{}` | 400 validation (no credential leak) |
| `POST/GET /api/auth/bootstrap-admin` | 401 |
| `POST /api/auth/gate` `{}` | 401 sign-in required |
| `GET /api/cron/weekly-rotation` | 401 |
| Phone/PIN reset empty/invalid | 400 validation messages |

**PostgREST (anon key, canonical project):**

| Resource | HTTP | Notes |
|----------|------|-------|
| `bay_service_logs` | **200 + rows** | **P0 demonstrated** |
| `rotation_exceptions` | 200 `[]` | Open policy; empty; INSERT priv true |
| store_specialists / stores / rotations / sections / walkthroughs / manager_notes / sunday / store_profiles / profiles | 200 `[]` | RLS deny effective for anon |

Rate limiting / brute-force bounding: **FAIL — P1** (code/config absence). Brute-force testing against production was **not** performed.

---

## J. Verified vs unverified controls

### Verified (PASS or FAIL with evidence)

- Canonical project identity  
- Live RLS enablement inventory  
- Open public policies + anon PostgREST read of `bay_service_logs`  
- RD-3/RD-5 SELECT-only policies  
- Edge gate blocking protected APIs  
- Bootstrap/cron fail-closed without secrets  
- `jwt_matches_store` definition + zero-strip  
- Column grant presence for `pin_code`  
- Non-bcrypt-shaped PIN count (3)  
- Local typecheck + 59 security-focused tests  

### NOT VERIFIED — REQUIRES CONTROLLED TEST

- Anon INSERT/UPDATE/DELETE on open tables (privilege true; mutation not executed)  
- Authenticated same-store SELECT of `pin_code` via PostgREST  
- Cross-store API attachment with dual store JWTs  
- `user_metadata` claim override when `app_metadata` absent  
- Associate privilege escalation to Supervisor via client-only claim mutation  
- Full suite beyond focused security tests  

---

## K. Severity-ranked findings

| ID | Severity | Class | Finding |
|----|----------|-------|---------|
| F-01 | **P0** | FAIL | `bay_service_logs` policy `Allow all operations for authenticated and anon` (`{public}` ALL `true`) — anon SELECT demonstrated |
| F-02 | **P0** | FAIL | `rotation_exceptions` policy `Allow authenticated full access…` (`{public}` ALL `true`) — anon SELECT allowed; INSERT privilege true |
| F-03 | **P1** | FAIL | Secret columns on `store_specialists` (`pin_code`, hashes, invite tokens) still SELECT-granted to `anon`/`authenticated` despite lockdown migration intent |
| F-04 | **P1** | FAIL | 3 roster `pin_code` values not bcrypt-shaped / length ≤ 12 (likely historical plaintext) |
| F-05 | **P1** | FAIL | No rate limits on public auth/recovery endpoints (hub-bridge, pin-reset, phone-lookup, redeem-invite) |
| F-06 | **P2** | FAIL | JWT helpers fall back to `user_metadata` for store/role/department |
| F-07 | **P2** | FAIL | Many Hub tables still grant authenticated **ALL** (client write surface) vs Floor Command “service-role after authz” preference |
| F-08 | **P2** | FAIL | `sunday_bay_assignments` ALL policy uses exact claim match (no zero-strip); diverges from `jwt_matches_store` |
| F-09 | **P3** | FAIL | Broad anon DML grants on tables that rely solely on RLS deny |
| F-10 | **P3** | NOTE | Extra store numbers beyond primary operator store (`1234`, `1234258`, `12342587`, `1852`) — data hygiene |
| F-11 | **P3** | NOTE | `store_profiles` RLS ON, zero policies — fail-closed for clients (OK) but grants remain wide |
| — | — | PASS | Edge/API auth for Floor Command protected routes; RD-3/RD-5 RLS SELECT pattern; project identity |

No finding was marked PASS on assumption alone.

---

## L. Smallest remediation plan

### SEC-OPS-002 (recommended next) — RLS open-policy + secret-column close

| Item | Detail |
|------|--------|
| Action | Drop open `{public}` ALL policies on `bay_service_logs` and `rotation_exceptions`; retain store-scoped authenticated policies only. Revoke SELECT on secret columns from `anon`/`authenticated` (re-apply lockdown grants). Optionally `REVOKE` anon DML where unused. |
| Objects | Policies on `bay_service_logs`, `rotation_exceptions`; column privileges on `store_specialists` (+ `profiles.pin` if still used) |
| Migration | **Yes** — additive SQL migration + readonly verify script extension |
| Tests | Contract test: open policy names absent; anon PostgREST expect empty/err; column privilege asserts |
| Prod risk | **Low–medium** — if any legacy client wrote bay_service_logs as anon, those writes break (prefer intentional) |
| Verify | Re-run anon GET `bay_service_logs` → `[]` or 401; Management SQL policy inventory |

### Follow-ons (separate authorizations)

| Tranche | Scope |
|---------|-------|
| SEC-OPS-003 | Hash-rewrite remaining plaintext-shaped `pin_code` (authorized ops script; preserve verify compatibility) |
| AUTH-RATE-001 | Bounded rate limit / lockout on hub-bridge + recovery (no auth rewrite) |
| AUTH-SIMPLIFY-001 | Inventory associate retirement (ALIGN-002); do not retire in RLS tranche |
| JWT-CLAIMS-001 | Remove `user_metadata` fallbacks from `jwt_store_number` / `jwt_app_role` / `jwt_department` |
| CI-001 / DOCS-TRUTH-001 | Trust pack remainder from RD-6 |

Avoid broad authentication rewrites; preserve Master + Supervisor PIN → hub-bridge → gate cookie.

---

## M. Verification results (local, non-mutating)

| Check | Result |
|-------|--------|
| `tsc --noEmit` | **PASS** (exit 0) |
| Focused vitest (ALIGN-SEC bootstrap, hub-master-pin, auth-gate, THESIS-001A, RD-3/RD-5 contracts) | **PASS** — 6 files, **59** tests |
| Full test suite | **Not run** this tranche (focused set only) |
| Production mutations | **None** |
| Existing unrelated failures | **None observed** in focused set |

---

## N. Evidence references

| Evidence | Location |
|----------|----------|
| Live SQL inventory | Management API query session 2026-10-11 on `fmeinlwhixngednabhgy` |
| Align-SEC intent | `docs/product/DEPTSYNC_ALIGN_SEC_001_SECURITY_STABILIZATION.md` … `_006` |
| RLS verify script (repo) | `scripts/sql/align-sec001-rls-verify-readonly.sql` |
| Lockdown migration intent | `supabase/migrations/20260817_rls_security_lockdown.sql` |
| RD-3 / RD-5 authz | `docs/product/DEPTSYNC_RD_3_*`, `DEPTSYNC_RD_5_*`; `lib/store-ops/auth*.ts` |
| Edge proxy | `proxy.ts`, `lib/auth-gate.ts` |
| Hub bridge claims | `lib/store-ops/hub-bridge.ts` |
| RD-6 gap callout | `docs/product/DEPTSYNC_RD_6_PRODUCT_COMPLETION_AUDIT.md` |
| Anon PostgREST probes | Live against `*.supabase.co/rest/v1/*` with anon key (results summarized; key not printed) |
| App smoke | `https://deptsync-hub.vercel.app` unauthenticated GETs/POSTs |

---

## O. Recommended next tranche

**DEPTSYNC-SEC-OPS-002 — Close open public RLS policies + revoke secret-column grants**

1. Operator-authorized migration only (after optional dump).  
2. Drop F-01/F-02 policies; keep store-scoped authenticated policies.  
3. Revoke secret column SELECT from client roles.  
4. Re-run anon PostgREST + policy inventory.  
5. Do **not** bundle associate retirement, topology cutover, rate limits, or engine changes unless separately authorized.

Parallel trust pack (non-blocking on F-01): **CI-001**, **DOCS-TRUTH-001**.

---

*End of DEPTSYNC-SEC-OPS-001. STOP — remediation not implemented.*
