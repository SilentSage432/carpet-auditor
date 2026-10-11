# DEPTSYNC-SEC-OPS-005 — Legacy Credential Write-Path Correction

**Mode:** Local implementation  
**Production mutations:** NOT AUTHORIZED (none executed)  
**Canonical project:** `fmeinlwhixngednabhgy`  
**Date:** 2026-10-11  
**References:** SEC-OPS-004 · AUTH-HARDEN-001

---

## Root causes

1. `resetHubPin` wrote **plaintext** `newPin` into `store_profiles.pin` / `pin_code` and `profiles.pin` / `pin_code` after hashing the roster correctly.
2. `phone-reset/confirm` wrote **plaintext** `newPassword` into `store_specialists.pin_code`.
3. `linkAuthUserToSpecialistProfile` copied `specialist.pin_code` (often stale plaintext) into `profiles`.
4. `ensure_master` insert path wrote plaintext `pin_code: newPin`.
5. Profile tables were treated as credential mirrors though **no production verify path reads them**.

---

## Canonical credential ownership

| Table | Purpose | Auth authority? |
|-------|---------|-----------------|
| `store_specialists.pin_code` / `pin_hash` | Hub-bridge / reset verify source | **Yes — canonical** |
| `profiles` | Auth user ↔ specialist identity + JWT claims | **No** (PIN columns legacy residue) |
| `store_profiles` | Legacy identity mirror (username/role/store) | **No** (PIN columns legacy residue) |

**Supported login flow:** `POST /api/auth/hub-bridge` → `verifyStoredPin` on `store_specialists` only.  
Active MasterAdmin (store 2587) already holds `scrypt1` on the roster — unchanged by this tranche.

---

## Corrected write paths

| Path | Before | After |
|------|--------|-------|
| `resetHubPin` roster update | scrypt (OK) | unchanged via `rosterSecurePinFields` |
| `resetHubPin` `ensure_master` insert | plaintext | scrypt `pin_code`+`pin_hash` |
| `upsertStoreProfiles` | plaintext pin fields | **null** pin fields; store-scoped username/role match |
| `syncAuthProfilePin` | plaintext pin fields | **null** pin/pin_code/pin_hash; Auth password still set (provider-hashed) |
| `phone-reset/confirm` | plaintext roster PIN | scrypt via `rosterSecurePinFields` |
| `linkAuthUserToSpecialistProfile` | copied roster PIN | **null** pin/pin_code/pin_hash |

Columns are not dropped. Historical obsolete digits remain until a future authorized cleanup (SEC-OPS-004 plan).

---

## Files changed

| File | Change |
|------|--------|
| `lib/store-ops/reset-pin.ts` | `rosterSecurePinFields`; mirror PIN nulling; store-scoped updates; hashed ensure_master |
| `lib/store-ops/link-auth-profile.ts` | Stop copying PIN into profiles |
| `app/api/auth/phone-reset/confirm/route.ts` | Hash roster credentials |
| `lib/store-ops/sec-ops-005.credential-writers.test.ts` | **New** regression tests |
| `docs/product/DEPTSYNC_SEC_OPS_005_CREDENTIAL_WRITERS.md` | This report |

---

## Regression tests

Covered in `sec-ops-005.credential-writers.test.ts`:

- `rosterSecurePinFields` never returns digit plaintext; verifies as scrypt  
- Profile link payload nulls PIN fields even when specialist carries plaintext  
- Source contracts: reset-pin / phone-reset / link-auth / hub-bridge ownership  
- Store-scoped `store_profiles` updates (no cross-store rewrite)

---

## Remaining legacy consumers

| Item | Status |
|------|--------|
| Client `lib/specialists.ts` local PIN helpers | May still handle local/offline shapes — not server persistence of production mirrors |
| Bootstrap scripts | Already write hashed PIN to specialists/profiles (scrypt) |
| Existing digit rows in `profiles` / `store_profiles` | Still present until authorized cleanup |
| `DEPTSYNC_ALLOW_PLAINTEXT_PIN_VERIFY` | Remains enabled (default) |

---

## Production release requirements (future — not executed)

**A.** Deploy corrected credential writers (this code).  
**B.** Verify hub-bridge login + Change PIN + (if used) phone-reset write hashed roster rows.  
**C.** Re-inventory digit shapes on `store_specialists`, `profiles`, `store_profiles`.  
**D.** Clear the two SEC-OPS-004 obsolete rows with exact identity-scoped SQL.  
**E.** Confirm digit inventory = 0 across all three tables.  
**F.** Only then disable `DEPTSYNC_ALLOW_PLAINTEXT_PIN_VERIFY` and later remove equality branch.

---

## Credential cleanup prerequisites

- Writers from this tranche must be live first (else Change PIN / phone-reset reintroduce digits).  
- Exact-row gates from SEC-OPS-004 (Master mirror on 2587; orphan `store_profiles` on 1852).  
- Do not touch MasterAdmin `store_specialists` scrypt row.

---

## Plaintext fallback retirement criteria

Disable only when **all** are true:

1. SEC-OPS-005 writers deployed.  
2. Digit-shaped PIN count = 0 on specialists + profiles + store_profiles.  
3. Operator login verified against scrypt.  
4. Separate authorization for env flag + code removal.

---

## Verification (local)

| Check | Result |
|-------|--------|
| `npm run typecheck` | **PASS** |
| Full `npm test` | **PASS** — 112 files / **1471** tests |
| `npm run build` | **PASS** |

No regressions observed in this tranche.

---

## GO / NO-GO recommendation

| Action | Verdict |
|--------|---------|
| Local implementation complete | **GO** |
| Commit / push / deploy | **NO-GO** until operator authorizes |
| Production SQL cleanup | **NO-GO** here |
| Disable plaintext fallback now | **NO-GO** |

**Overall:** Engineering **CONDITIONAL GO** for a controlled writers-only release, then cleanup, then fallback retirement.
