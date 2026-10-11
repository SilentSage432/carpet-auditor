# DEPTSYNC-SEC-OPS-007B — Emergency Production Login Repair

**Date:** 2026-10-11  
**Mode:** Controlled hotfix — restore operator login  
**Canonical Supabase:** `fmeinlwhixngednabhgy` (ACTIVE_HEALTHY, us-west-2)  
**Application:** https://deptsync-hub.vercel.app  
**Repository commit:** `ff2b30bf3ddf74002bb49bd6cb166eee42f170b1`  
**Production SQL:** none  

---

## Root cause

SEC-OPS-005 profile writers upserted `profiles.pin = null` during hub-bridge session mint (`linkAuthUserToSpecialistProfile`). Production `profiles.pin` is **NOT NULL**. After SEC-OPS-007 cleared obsolete digits to `pin = ''`, login re-link attempted to set `pin` null and failed with:

`null value in column "pin" of relation "profiles" violates not-null constraint`

Canonical MasterAdmin credential on `store_specialists` remained **scrypt1** and was never the verify failure.

---

## Exact changed files

| File | Change |
|------|--------|
| `lib/store-ops/link-auth-profile.ts` | `pin: ""` (nullable `pin_code`/`pin_hash` stay null) |
| `lib/store-ops/reset-pin.ts` | Same for `syncAuthProfilePin` + `upsertStoreProfiles` |
| `lib/store-ops/sec-ops-005.credential-writers.test.ts` | Expect `pin: ""` |
| `lib/store-ops/sec-ops-007a.profiles-pin-not-null.test.ts` | Contract tests updated for hotfix |
| `lib/store-ops/sec-ops-007b.login-hotfix.test.ts` | **New** — NOT NULL + empty-string auth safety |

No schema migrations. No MasterAdmin / role / store changes. No plaintext reintroduction.

---

## Empty-string safety

| Check | Result |
|-------|--------|
| `verifyStoredPin(pin, "")` | **false** (`!stored`) |
| `verifyStoredPin("", "")` | **false** |
| Hub-bridge `!storedPin` after trim | Empty roster PIN → no app access (not a match) |
| Profiles `pin` read for login verify | **No** — verify uses `store_specialists` only |
| Plaintext fallback vs `""` | Cannot succeed for a non-empty operator PIN |

---

## Regression tests

Focused: SEC-OPS-005 / 007A / 007B — **12** pass.  
Full suite:

| Check | Result |
|-------|--------|
| `npm run typecheck` | **PASS** |
| `npm test` | **PASS** — 114 files / **1477** tests |
| `npm run build` | **PASS** |

---

## Commit SHA

`ff2b30bf3ddf74002bb49bd6cb166eee42f170b1`  
Message: `fix(auth): clear NOT NULL profile pin mirrors with empty string`

Push: `16dab12..ff2b30b` → `origin/main`

---

## Vercel deployment ID

| Field | Value |
|-------|--------|
| GitHub deployment id | `6999478031` |
| Environment | Production |
| SHA | `ff2b30bf3ddf74002bb49bd6cb166eee42f170b1` |
| Vercel status | **success** |
| Vercel URL | https://vercel.com/tyson-zauggs-projects/deptsync-hub/ED2oSLiAtovm3xWY944KCF74VDAB |
| Deployment id | `ED2oSLiAtovm3xWY944KCF74VDAB` |

Deployed source markers: `pin: ""` in `link-auth-profile.ts` + `reset-pin.ts` at `ff2b30b`.

---

## Backup details

| Field | Value |
|-------|--------|
| Dump | `tmp/production-backups/deptsync-fmeinlwhixngednabhgy-2026-10-11T17-53-54-077129000Z.dump` |
| Size | **587360** bytes |
| TOC | **938** |
| Purpose | SEC-OPS-007B pre-hotfix |

**Rollback:** Fix forward preferred. Do **not** roll back to `e36bfb5` / SEC-OPS-006 (restores `pin: null` login break). Do **not** roll back before AUTH-HARDEN (cannot verify scrypt1). DB restore from this dump only if separately authorized.

---

## Production verification

| Check | Result |
|-------|--------|
| `/` | **307** → `/login` |
| `/login` | **200** |
| `/dashboard` | **307** → `/login` |
| hub-bridge empty / bad | **400** / **401** |
| bootstrap unauth | **401** |
| Anon containment | **401** |
| Rate-limit RPC | **operational** |
| Master `f9e36630…` | **scrypt1** / active / 2587 |
| Digit inventory specialists / profiles / store_profiles | **0 / 0 / 0** |

---

## Operator login verification status

**OPERATOR LOGIN PENDING**

No interactive Master PIN login was performed in this tranche (no PIN requested/exposed; no repeated attempts).

Operator should sign in once at https://deptsync-hub.vercel.app with the existing Master username + four-digit PIN.

---

## Remaining risks

1. Operator login still needs manual confirmation.  
2. `profiles.pin` / `store_profiles.pin` remain NOT NULL with empty-string clears — schema soften deferred.  
3. Plaintext verify fallback still enabled (separate retirement tranche).  
4. SEC-OPS-007 cleanup SQL/docs may still be uncommitted locally relative to earlier work.

---

## GO / NO-GO

| Action | Verdict |
|--------|---------|
| Hotfix shipped | **GO — SHIPPED** |
| Operator login confirmed | **PENDING** |
| Plaintext fallback removal | **NO-GO** |
| Further PIN / identity changes | **NO-GO** |

**STOP.**
