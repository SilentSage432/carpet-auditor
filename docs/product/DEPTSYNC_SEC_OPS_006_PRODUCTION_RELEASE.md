# DEPTSYNC-SEC-OPS-006 — Credential Writer Production Release

**Date:** 2026-10-11  
**Mode:** Authorized controlled production release  
**Scope:** Deploy SEC-OPS-005 credential writer corrections  
**Canonical Supabase:** `fmeinlwhixngednabhgy` (ACTIVE_HEALTHY, us-west-2)  
**Application:** https://deptsync-hub.vercel.app  
**Repository commit:** `e36bfb577e70f2f7ec709e51711073e9823f60bd`

---

## A. Release scope

| Included | Excluded |
|----------|----------|
| `resetHubPin` secure roster writes + mirror PIN nulling | Production SQL / credential cleanup |
| `phone-reset/confirm` scrypt roster writes | MasterAdmin PIN change |
| Hub-bridge profile link without PIN copy | Plaintext fallback removal |
| `rosterSecurePinFields` helper | Auth architecture redesign |
| SEC-OPS-004/005 docs + regression tests | Rotation / topology / CI / unrelated features |
| Journal / handoff / roadmap updates | `DEPTSYNC_RD_6_PRODUCT_COMPLETION_AUDIT.md`, `tmp/` |

No unreviewed authentication behavior. Canonical verify authority remains `store_specialists` via hub-bridge `verifyStoredPin`.

---

## B. Files changed

| File | Role |
|------|------|
| `lib/store-ops/reset-pin.ts` | `rosterSecurePinFields`; null mirror PINs; store-scoped `store_profiles` |
| `lib/store-ops/link-auth-profile.ts` | Stop copying PIN into `profiles` |
| `app/api/auth/phone-reset/confirm/route.ts` | Hash roster credentials |
| `lib/store-ops/sec-ops-005.credential-writers.test.ts` | Regression tests |
| `docs/product/DEPTSYNC_SEC_OPS_004_LEGACY_CREDENTIAL_DISCOVERY.md` | Predecessor discovery |
| `docs/product/DEPTSYNC_SEC_OPS_005_CREDENTIAL_WRITERS.md` | Writer correction report |
| `CHAT_HANDOFF.md` / `DEVELOPMENT_JOURNAL.md` / `MASTER_ROADMAP.md` | Process docs |

---

## C. Canonical environment verification

| Check | Result |
|-------|--------|
| `.env.local` Supabase host ref | `fmeinlwhixngednabhgy` |
| Management API project | `fmeinlwhixngednabhgy` / ACTIVE_HEALTHY / us-west-2 |
| App URL | https://deptsync-hub.vercel.app reachable |
| Vercel project (linked) | `deptsync-hub` (`prj_OztuUVQCkIl1vO5FdsguTxeyrxqr`) |
| Pre-release Production tip | `eca1e4d` (AUTH-HARDEN-002 docs) |
| Rate-limit RPC | `touch_auth_rate_limit` operational (attempt+success) |
| SEC-OPS-002 anon containment | `bay_service_logs` / `rotation_exceptions` / `store_specialists` / `profiles` → **401** `42501` |

---

## D. Production backup verification

| Field | Value |
|-------|--------|
| Dump | `tmp/production-backups/deptsync-fmeinlwhixngednabhgy-2026-10-11T17-30-20-974541000Z.dump` |
| Meta | `…17-30-20-974541000Z.meta.json` |
| Size | **587293** bytes |
| TOC entries | **938** (`pg_restore -l`) |
| TOC includes | `store_specialists`, `stores`, `bay_service_logs`, `rotation_exceptions`, `auth_rate_limits` |
| Client | `pg_dump (PostgreSQL) 17.11 (Homebrew)` |
| Credentials | Ephemeral Management API DB password (`PATCH …/database/password`); **not persisted / not printed** |

Prior AUTH-HARDEN-002 dump retained on disk (not deleted).

---

## E. Database migration requirements

**None.** SEC-OPS-005 is application write-path only. No schema/RPC/SQL apply in this tranche. Production SQL mutations **not** authorized and **not** executed.

---

## F. Typecheck / test / build results

| Check | Result |
|-------|--------|
| `npm run typecheck` | **PASS** |
| Full `npm test` | **PASS** — 112 files / **1471** tests |
| `npm run build` | **PASS** |

Automated writer contracts (synthetic credentials only): no plaintext from `rosterSecurePinFields`; profile link nulls PIN fields; source contracts for reset-pin / phone-reset / link-auth; store-scoped `store_profiles` updates.

---

## G. Commit SHA

`e36bfb577e70f2f7ec709e51711073e9823f60bd`  
Message: `fix(auth): stop plaintext PIN writes on credential sync paths`

Unrelated untracked `DEPTSYNC_RD_6_PRODUCT_COMPLETION_AUDIT.md` and `tmp/` **not** included.

---

## H. Push result

`git push origin main`: **success** (`eca1e4d..e36bfb5`)

---

## I. Vercel deployment ID

| Field | Value |
|-------|--------|
| GitHub deployment id | `6999173939` |
| Environment | Production |
| SHA | `e36bfb577e70f2f7ec709e51711073e9823f60bd` |
| Vercel status | **success** — Deployment has completed |
| Vercel deployment URL | https://vercel.com/tyson-zauggs-projects/deptsync-hub/CkWcALCvQTJYbaEw9Xm49Yas8E3B |
| Deployment id (path) | `CkWcALCvQTJYbaEw9Xm49Yas8E3B` |

---

## J. Production alias verification

| Check | Result |
|-------|--------|
| https://deptsync-hub.vercel.app/ | **307** → `/login?next=%2F` |
| https://deptsync-hub.vercel.app/login | **200** |
| https://deptsync-hub.vercel.app/dashboard | **307** → `/login?next=%2Fdashboard` |
| Commit status context `Vercel` | success for `e36bfb5` → deployment `CkWcALCvQTJYbaEw9Xm49Yas8E3B` |
| Deployed source markers at SHA | `rosterSecurePinFields` in reset-pin + phone-reset; `pin_code: null` in link-auth / mirror sync |

---

## K. Authentication smoke results

| Check | Result |
|-------|--------|
| `POST /api/auth/hub-bridge` empty body | **400** validation |
| Bad username/PIN | **401** `Invalid username or PIN` (no enumeration) |
| `GET /api/auth/bootstrap-admin` no Bearer | **401** Unauthorized |
| Anon PostgREST secret/contained tables | **401** `42501` |
| Service-role rate-limit RPC attempt+clear | **operational** |
| Authenticated end-to-end operator login | **NOT PERFORMED** (no interactive Master PIN session in this tranche) |

---

## L. Credential writer verification

| Check | Result |
|-------|--------|
| Source/deploy identity matches release SHA | **PASS** |
| Automated regression tests | **PASS** |
| Live production Change PIN / phone-reset execution | **WRITER RUNTIME — NOT VERIFIED** |

No production PIN reset was executed (would mutate operator/associate credentials).

---

## M. Remaining plaintext inventory

Read-only metadata (no credential values printed):

| Table | Digit-shaped | scrypt1 | Notes |
|-------|-------------:|--------:|-------|
| `store_specialists` | **0** | **1** | Canonical roster |
| `profiles` | **1** | 0 | `0f3b20ce…` / store 2587 / linked specialist `f9e36630…` |
| `store_profiles` | **1** | 0 | `0b7d86d3…` / store **1852** orphan `admin` |

Same two obsolete mirror rows identified in SEC-OPS-004. **Not cleared** in this tranche.

---

## N. Operator credential verification

| Field | Result |
|-------|--------|
| MasterAdmin id prefix | `f9e36630…` |
| Store | `2587` |
| Status / active | `active` / true |
| `pin_code` / `pin_hash` shape | **scrypt1** / **scrypt1** |
| PIN value changed by this release | **No** |

---

## O. Rollback readiness

| Item | Plan |
|------|------|
| Safe app rollback target | Prior production tip `eca1e4d` / `4fd914d` (AUTH-HARDEN scrypt verify + rate limits) |
| Unsafe rollback | Any pre-`4fd914d` build that cannot verify existing `scrypt1` Master credential |
| DB rollback | Restore from dump `…17-30-20-974541000Z.dump` only if authorized; **not** executed |
| Writer-only nature | App rollback reintroduces plaintext-capable writers but does not itself alter Master scrypt |

---

## P. Remaining risks

1. Legacy digit mirrors in `profiles` / `store_profiles` still present until authorized cleanup.  
2. `DEPTSYNC_ALLOW_PLAINTEXT_PIN_VERIFY` still enabled — required until digit inventory is zero.  
3. Live Change PIN / phone-reset write behavior not exercised in production this tranche.  
4. Next login that links profiles will **null** profile PIN columns (intended); does not affect roster scrypt.

---

## Q. Final GO / NO-GO assessment

| Action | Verdict |
|--------|---------|
| Writers-only production release | **GO — SHIPPED** |
| Production SQL cleanup of obsolete mirrors | **NO-GO** here (next authorized tranche) |
| Disable plaintext PIN verify fallback | **NO-GO** (inventory not clear) |
| MasterAdmin PIN rotation | **NO-GO** / not performed |

**Overall:** Controlled application release **complete**. Next authorized step: re-inventory after soak, then exact identity-scoped clearance of the two obsolete digit mirrors, then plaintext-fallback retirement criteria from SEC-OPS-005.
