# DEPTSYNC-ALIGN-SEC-006 — Recovery Credential Protection

**Status:** IMPLEMENTATION COMPLETE (local; deploy not authorized)  
**Date:** 2026-10-10  
**Mode:** Scoped security implementation  
**Deployment / production mutation / commit / push:** NOT AUTHORIZED  

---

## A. Exact exposure paths (pre-change)

| Path | Exposure |
|------|----------|
| `ensureMasterAdminBootstrap` → `store_specialists.pin_code` | Wrote **plaintext** `HUB_MASTER_PIN` |
| `store_specialists.pin_hash` | Not set by bootstrap (left stale/null) |
| `linkAuthUserToSpecialistProfile` → `profiles.pin_code` / `profiles.pin` | Copied specialist `pin_code` (plaintext when bootstrap wrote plaintext) |
| `scripts/bootstrap-admin.mjs` roster + profiles | Wrote plaintext `masterPin` |
| `POST` / `GET ?force=1` `/api/auth/bootstrap-admin` JSON | Returned `pin: getHubMasterPin()` |
| Local script stdout | Printed `pin: masterPin` |
| Supabase Auth `password` | Set from env PIN (provider stores its own hash — required API input, not our table plaintext) |

**Required for subsequent auth (not plaintext-dependent):**

1. Env `HUB_MASTER_PIN` + `isHubMasterPin` (hub-bridge Master fallback)  
2. Roster `pin_hash` / `pin_code` verified via `verifyStoredPin` (supports salted hash **and** legacy plaintext)  
3. Auth user linked; hub-bridge mints session with rotated one-time password  

Plaintext roster storage was **not** required for recovery.

---

## B. Changes implemented

1. **`lib/store-ops/bootstrap-admin.ts`**
   - Added `masterBootstrapPinFields(pin)` using existing `hashPin` (same as reset-pin).
   - Bootstrap write: `pin_code` + `pin_hash` = salted hash; never plaintext.
   - Pin mismatch check uses `verifyStoredPin` (hash-aware).
   - Auth password still set from env PIN (provider-hashed); unchanged recovery semantics.

2. **`app/api/auth/bootstrap-admin/route.ts`**
   - Removed raw `pin` from POST and GET `?force=1` responses.
   - Returns `pin_configured`, `pin_storage: "hashed"`, non-sensitive metadata + hint.

3. **`scripts/bootstrap-admin.mjs`**
   - Hashes with the same `salt:pin` SHA-256 algorithm as `lib/auth-token.ts`.
   - Writes `pin_code` / `pin_hash` / profile pin fields as hash.
   - Stdout no longer prints the Master credential.

4. **Tests**
   - `lib/store-ops/bootstrap-admin.align-sec006.test.ts`
   - SEC-005 source contracts updated for hashed storage.

**Not changed:** Production rows (no migration). Historical plaintext `pin_code` still verifies. Ordinary associate PIN paths unchanged.

---

## C. Storage and verification behavior

| Store | After SEC-006 bootstrap |
|-------|-------------------------|
| `store_specialists.pin_code` | `salt.digest` (salted SHA-256) |
| `store_specialists.pin_hash` | same hash |
| `profiles.pin*` (via link / script) | hash when specialist pin_code is hash |
| `auth.users` password | set from env PIN; Auth bcrypt/argon internally |
| Env `HUB_MASTER_PIN` | remains operator secret (not stored plaintext in app tables) |

Verification order (hub-bridge, unchanged):

1. `verifyStoredPin(candidate, pin_hash || pin_code)`  
2. else `isHubMasterPin(candidate)` → mint existing Master  

Legacy plaintext rows continue to work via step 1 equality path.

---

## D. Recovery response contract

**POST** (authorized) success body includes:  
`ok`, `username`, `pin_configured`, `pin_storage: "hashed"`, `specialist_id`, `store_number`, `auth_user_id`, `email`, create flags, optional `session`, `hint`  

**Does not include:** `pin`, raw `HUB_MASTER_PIN`, or hash digests.

**GET ?force=1:** same protection (`pin_configured` / `pin_storage`, no `pin`).

**Local script stdout:** `pin_configured` / `pin_storage` only — no credential.

Operator signs in with username `master_admin` + the env value they already configured.

---

## E. Test results

| Check | Result |
|-------|--------|
| SEC-006 targeted tests | Pass (see suite) |
| SEC-005 compatibility tests | Pass (contracts updated) |
| `npm run typecheck` | Pass |
| Full `npm test` | **1351/1351 pass** |
| `npm run build` | Pass |
| Lint (SEC-006 touched files) | Clean |
| Lint (full repo) | Pre-existing: 135 problems (103 errors, 32 warnings); largely `tmp/` + legacy — not introduced by this tranche |

---

## F. Remaining risks

| Risk | Notes |
|------|-------|
| Pre-existing Production plaintext `pin_code` | Not migrated; re-run bootstrap (HTTP or script) to replace with hash when authorized |
| Auth password set from Master PIN at bootstrap | Provider-hashed; optional direct Auth sign-in still possible; hub-bridge rotates on mint |
| Bootstrap HTTP returns Auth `session` tokens when `mint_session` | Capability token — protect `BOOTSTRAP_SECRET`; not the Master PIN |
| No login rate limits | Pre-existing (SEC-003) |
| Script duplicates `hashPin` algorithm | Must stay aligned with `lib/auth-token.ts` |

---

## G. Deployment readiness recommendation

**READY for operator-authorized commit/deploy of this code change** after separate authorization.  

Does **not** require a production SQL migration. Existing plaintext Master rows remain login-compatible until next bootstrap rewrite.  

Recommend: after deploy, operator-run bootstrap once (local script or Bearer `BOOTSTRAP_SECRET`) so Production Master roster stores a hash. Do not treat this tranche as deploy authorization.

---

## H. Git diff summary (uncommitted)

- `lib/store-ops/bootstrap-admin.ts` — hashed pin fields helper + write path  
- `app/api/auth/bootstrap-admin/route.ts` — response scrub  
- `scripts/bootstrap-admin.mjs` — hash storage + no stdout credential  
- `lib/store-ops/bootstrap-admin.align-sec006.test.ts` — new  
- `lib/store-ops/hub-master-pin.align-sec005.test.ts` — contract update  
- Docs: this file + journal / handoff / roadmap / state  

---

*End of ALIGN-SEC-006. STOP for operator review.*
