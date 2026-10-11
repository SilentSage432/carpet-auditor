# DEPTSYNC-AUTH-HARDEN-002 — Controlled Authentication Production Release

**Date:** 2026-10-11  
**Mode:** Authorized production release  
**Scope:** AUTH-HARDEN-001 + AUTH-HARDEN-001A  
**Canonical Supabase:** `fmeinlwhixngednabhgy` (ACTIVE_HEALTHY, us-west-2)  
**Application:** https://deptsync-hub.vercel.app  
**Repository commit:** `4fd914d56323baab73593dddbbf4a07d8c7330c9`

---

## A. Release scope

| Included | Excluded |
|----------|----------|
| scrypt PIN storage + login-time atomic upgrade | MasterAdmin PIN reset/replace |
| Fail-closed shared hub-bridge rate limiting | Plaintext fallback removal |
| Rate-limit table + `touch_auth_rate_limit` RPC | New auth roles |
| Exact invited-associate unused plaintext clear (2 rows) | Rotation / topology / CI / unrelated features |
| Docs + regression tests | Broad credential rewrites |

Operator MasterAdmin (`f9e36630…`) PIN value **not** changed by this release.

---

## B. Canonical project verification

| Check | Result |
|-------|--------|
| `.env.local` Supabase host ref | `fmeinlwhixngednabhgy` |
| Management API project | `fmeinlwhixngednabhgy` / ACTIVE_HEALTHY / us-west-2 |
| App URL | https://deptsync-hub.vercel.app reachable |
| Vercel project (linked) | `deptsync-hub` (`prj_OztuUVQCkIl1vO5FdsguTxeyrxqr`) |
| GitHub remote | `SilentSage432/carpet-auditor` |

---

## C. Backup path and verification

| Field | Value |
|-------|--------|
| Dump | `tmp/production-backups/deptsync-fmeinlwhixngednabhgy-2026-10-11T17-01-33-870528000Z.dump` |
| Meta | `…17-01-33-870528000Z.meta.json` |
| Size | **587207** bytes |
| TOC entries | **923** (`pg_restore -l`) |
| TOC includes | `store_specialists`, `stores`, `bay_service_logs`, `rotation_exceptions` |
| Client | `pg_dump (PostgreSQL) 17.11 (Homebrew)` |
| Credentials | Ephemeral Management API DB password; **not persisted / not printed** |

Prior SEC-OPS-002 dump retained on disk (not deleted).

---

## D. Rate-limit migration result

Applied out-of-band to `fmeinlwhixngednabhgy`:

`supabase/migrations/20261013_auth_harden_001_rate_limits.sql`

| Object | Result |
|--------|--------|
| `public.auth_rate_limits` | Present; RLS enabled |
| `public.touch_auth_rate_limit(...)` | Present |
| Apply transaction | **COMMIT** |

Non-destructive RPC smoke (`hb:auth-harden-002-verify`): attempt → peek → success clear; leftover rows **0**.

---

## E. RPC permissions verification

| Privilege | anon | authenticated | service_role |
|-----------|------|---------------|--------------|
| Table SELECT/INSERT `auth_rate_limits` | false | false | true |
| EXECUTE `touch_auth_rate_limit` | false | false | true |

No public/anon path can clear or manipulate buckets. App uses service-role admin client only after server route admission.

---

## F. Invited associate cleanup result

| Gate | Result |
|------|--------|
| Pre-check exact targets | **2** invited Associates (`6f79f577…`, `2d65fa60…`), plaintext digit shape, no `auth_user_id` |
| Not MasterAdmin | Confirmed |
| UPDATE affected rows | **2** (exact gate enforced before COMMIT) |
| Post-check | Both `pin_code` null; status/role still `invited` / `Associate` |
| MasterAdmin `f9e36630…` | Unchanged (`pin_len=4`, still digit plaintext pending login upgrade) |

---

## G. Commit SHA

`4fd914d56323baab73593dddbbf4a07d8c7330c9`  
Message: `feat(auth): harden hub-bridge PIN storage and shared rate limits`

Unrelated untracked `DEPTSYNC_RD_6_PRODUCT_COMPLETION_AUDIT.md` and `tmp/` **not** included.

---

## H. Push result

`git push origin main`: **success** (`da281c4..4fd914d`)

---

## I. Vercel deployment ID

| Field | Value |
|-------|--------|
| GitHub deployment id | `6998835331` |
| Environment | Production |
| SHA | `4fd914d56323baab73593dddbbf4a07d8c7330c9` |
| Vercel status | **success** — Deployment has completed |
| Vercel deployment URL | https://vercel.com/tyson-zauggs-projects/deptsync-hub/5muXnbeQbWh4CsmCoXWejQfYGKc6 |
| Deployment id (path) | `5muXnbeQbWh4CsmCoXWejQfYGKc6` |

---

## J. Production alias verification

| Check | Result |
|-------|--------|
| https://deptsync-hub.vercel.app/ | **307** → `/login?next=%2F` |
| `/login` | **200** |
| `/dashboard` (unauth) | **307** (redirect) |
| Commit status context `Vercel` | success for `4fd914d` |

---

## K. Public authentication checks

| Check | Result |
|-------|--------|
| `POST /api/auth/hub-bridge` empty body | **400** generic validation |
| Bad username/PIN | **401** `Invalid username or PIN` (no enumeration) |
| `GET /api/auth/bootstrap-admin` no Bearer | **401** Unauthorized |
| Anon PostgREST `bay_service_logs` / `rotation_exceptions` / `store_specialists` | **401** `42501` |
| Anon `select=id,pin_code` | **401** |
| Service-role rate-limit RPC attempt+clear | **operational** |

Fail-closed when RPC missing: enforced in shipped code + unit tests; not destructively proven by dropping production RPC.

---

## L. Operator login verification status

**OPERATOR LOGIN — AWAITING MANUAL VERIFICATION**

No PIN was requested, logged, or tested against production.  
Operator should sign in with the existing four-digit MasterAdmin PIN on https://deptsync-hub.vercel.app.

---

## M. MasterAdmin hash upgrade status

| Field | Current evidence |
|-------|------------------|
| Identity prefix | `f9e36630…` |
| Role | `MasterAdmin` |
| Status | `active` |
| Store | `2587` |
| `has_auth_user` | true |
| Credential format | **still `digit_plaintext`** (expected until first successful post-release login) |
| Upgrade | **PENDING operator login** (conditional scrypt rewrite on success) |

Never print credential values or hashes.

---

## N. Remaining legacy PIN inventory

| Format | Count |
|--------|------:|
| digit plaintext shape | **1** (MasterAdmin pending upgrade) |
| scrypt | 0 |
| salted SHA-256 | 0 |
| empty | 34 |
| total specialists | 35 |

Invited associate plaintext rows: **cleared**.  
Plaintext verify fallback: **still enabled** (do not remove yet).

---

## O. Regression results

| Check | Result |
|-------|--------|
| `npm run typecheck` | **PASS** |
| `npm test` | **PASS** — **1465** tests (111 files) |
| `npm run build` | **PASS** |
| Unexpected regressions | **None observed** |

---

## P. Rollback readiness

| Layer | Plan |
|-------|------|
| DB rate-limit objects | Additive; safe to leave. Optional DROP function/table only if abandoning feature. |
| Invited associate PIN clear | Low risk (unused invited rows). Restore from dump only if needed. |
| App rollback after Master upgrades to scrypt | **Unsafe for PIN login** on pre-AUTH-HARDEN builds (cannot verify `scrypt1$`). |
| Independent recovery | Production bootstrap: `POST /api/auth/bootstrap-admin` with `BOOTSTRAP_SECRET`; local `scripts/bootstrap-admin.mjs`; `HUB_MASTER_PIN` env unlock path. Endpoint confirmed live (**401** without secret). |
| Preferred recovery if app rollback required | Use bootstrap / `HUB_MASTER_PIN` — do **not** rely on rolling back to an app that cannot verify scrypt. |
| Dump restore | Full restore available from §C dump (last resort; out of band). |

Rollback safety: **established** via secret-gated bootstrap path + dump, with explicit scrypt incompatibility warning for naive app downgrade.

---

## Q. Remaining security risks

1. MasterAdmin still digit plaintext until first successful login upgrade.  
2. Plaintext verify fallback remains until inventory = 0 and env retirement.  
3. Follow-on plaintext **write** paths (phone-reset / profile sync) still open from SEC-OPS-003.  
4. Shared NAT may share hub-bridge rate-limit bucket.  
5. Operator login not yet manually confirmed.

---

## R. Final GO / NO-GO assessment

| Item | Status |
|------|--------|
| DB prerequisite applied before app | **GO** (ordering respected) |
| Invited associate cleanup | **GO** (exact 2 rows) |
| App commit / push / Production deploy | **GO** (`4fd914d` / Vercel success) |
| Public auth + SEC-OPS-002 containment | **GO** |
| Operator login + scrypt upgrade proof | **AWAITING MANUAL VERIFICATION** |
| Remove plaintext fallback | **NO-GO** (intentionally deferred) |

**Overall release status:** **CONDITIONAL GO — PRODUCTION SHIPPED**  
Engineering release complete. Final operator acceptance requires manual MasterAdmin login confirmation and post-login metadata check that Master credential format becomes `scrypt`.

---

## Operator next step (manual)

1. Sign in at https://deptsync-hub.vercel.app with existing Master username + four-digit PIN.  
2. Confirm Floor Command loads.  
3. Ask for a read-only metadata check (format only) — do not send the PIN to Cursor.  
4. After upgrade confirmed, plaintext retirement can be scheduled separately.
