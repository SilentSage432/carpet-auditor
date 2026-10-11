# DEPTSYNC-SEC-OPS-009 — Credential Writer Closure

**Date:** 2026-10-11  
**Mode:** Controlled security release (writer closure + deploy)  
**Canonical Supabase:** `fmeinlwhixngednabhgy`  
**Application:** https://deptsync-hub.vercel.app  
**Commit:** `dbf68470e60f23bceb2ff3be6cb3fa372a4160f4` (`dbf6847`)  
**Vercel Production:** `As1U36FuRe89XwQrtkVDai9YgR6y`  
**Plaintext fallback env:** **NOT CHANGED** (still default-on unless separately set)  
**Reference:** [`DEPTSYNC_SEC_OPS_008_AUTH_RETIREMENT_AUDIT.md`](DEPTSYNC_SEC_OPS_008_AUTH_RETIREMENT_AUDIT.md)

---

## Remaining writer root cause

`updateSpecialistCredentials` (`lib/specialists.ts`) was the last production-reachable path that persisted a **plaintext** roster secret:

1. AuthWall `SetupForm` called it with `{ username, password, phone }`.
2. It built `pin_code: password` and called client `persistSpecialistFields`.
3. That issued a browser Supabase `update`/`insert` under authenticated roster-admin RLS.
4. Hub-bridge then verified via `verifyStoredPin` — so after a setup save, login depended on the plaintext equality fallback (or a later upgrade).

SEC-OPS-005 had closed server writers (`reset-pin`, phone-reset, profile link). This client path remained.

Secondary hardening found in the same module:

- `specialistPayload` / `insertProfile` / `buildSpecialistDbPatch` could still send `pin_code` from the browser.
- `resetSpecialistCredentials` (unused caller) wrote plaintext via the same client path.
- AccessGate could enter `setup` **without** a Hub Auth JWT, so credential writes lacked an authorized server actor.

---

## Exact changes

| File | Change |
|------|--------|
| `lib/store-ops/reset-pin.ts` | New `updateHubCredentials` — service-role scrypt write via `rosterSecurePinFields`; actor-authorized or `current_password` verify; mirrors cleared through existing helpers when not test-injected |
| `app/api/auth/update-credentials/route.ts` | **New** authorized boundary — JWT actor ownership / super_admin, else `current_password`; never accepts client hashes |
| `lib/specialists.ts` | `updateSpecialistCredentials` → `POST /api/auth/update-credentials` only; fail closed offline; strip `pin_code` from client payloads/inserts; `resetSpecialistCredentials` throws (invite / reset-pin only) |
| `lib/auth/access-gate-bootstrap.ts` | Setup requires JWT (`setup_requires_unlock` when `needsSetup && !hasJwt`) |
| `lib/store-ops/sec-ops-009.writer-closure.test.ts` | **New** fallback matrix + writer + auth boundary contracts |
| `lib/auth/access-gate-bootstrap.test.ts` | Setup-without-JWT → unlock |
| `docs/product/DEPTSYNC_SEC_OPS_008_AUTH_RETIREMENT_AUDIT.md` | Prior audit committed with this release |

**Not changed:** MasterAdmin PIN, production SQL, RLS, rate limits, `DEPTSYNC_ALLOW_PLAINTEXT_PIN_VERIFY`, equality-branch code removal.

---

## Authorization boundary

```
Browser SetupForm
  → POST /api/auth/update-credentials  (Bearer JWT and/or current_password)
    → resolveStoreOpsActor
    → updateHubCredentials (service role)
      → rosterSecurePinFields (scrypt1)
      → store_specialists.pin_code + pin_hash
      → mirror pin clear ("" / null) via existing SEC-OPS-005/007B helpers
```

| Gate | Behavior |
|------|----------|
| No JWT and no `current_password` | **401** |
| JWT actor ≠ target (non–super_admin) | **403** |
| JWT owns target / super_admin | `actor_authorized: true` — no current PIN required |
| No JWT + wrong `current_password` | **401** / current PIN incorrect |
| Offline client | Throws — no local credential queue |

Browser never hashes “for security” and never writes credential columns directly.

---

## Regression coverage

`lib/store-ops/sec-ops-009.writer-closure.test.ts` (+ AccessGate bootstrap tests):

- scrypt1 verifies with fallback enabled **and** disabled  
- Salted SHA-256 verifies with fallback enabled **and** disabled  
- Plaintext equality only when enabled; fails when disabled  
- Empty-string credentials never verify  
- Unknown formats fail when fallback disabled  
- Incorrect PINs fail  
- Writers persist scrypt only (`updateHubCredentials`, `rosterSecurePinFields`)  
- Unauthorized update (wrong current password) fails  
- Client routes to `/api/auth/update-credentials`; no `pin_code: password`  
- Client payloads never assign `pin_code`  
- Route source requires actor or `current_password`  
- Rate-limit default (8) unchanged  

---

## Full test count / build

| Gate | Result |
|------|--------|
| `npm run typecheck` | **PASS** |
| `npm test` | **PASS — 121 files / 1523 tests** |
| `npm run build` | **PASS** (includes `/api/auth/update-credentials`) |

---

## Commit / deployment

| Field | Value |
|-------|--------|
| SHA | `dbf68470e60f23bceb2ff3be6cb3fa372a4160f4` |
| Short | `dbf6847` |
| Message | `fix(auth): close client plaintext credential writer (SEC-OPS-009)` |
| Vercel URL | https://vercel.com/tyson-zauggs-projects/deptsync-hub/As1U36FuRe89XwQrtkVDai9YgR6y |
| Deployment id | `As1U36FuRe89XwQrtkVDai9YgR6y` |
| GitHub Production deployment | `7000363916` |
| Status | **success** |

---

## Credential inventory (post-deploy, read-only)

Project `fmeinlwhixngednabhgy`:

| Table | Rows | Effective shapes |
|-------|-----:|------------------|
| `store_specialists` | 35 | **scrypt1 = 1**, null = 34, SHA-256 = 0, digit = 0, unknown = 0 |
| `profiles` | 1 | empty_or_null only |
| `store_profiles` | 1 | empty_or_null only |

MasterAdmin `f9e36630-9793-40cd-9d3c-53b5ee450b1c`: active / store `2587` / **scrypt1** `pin_code`+`pin_hash` — **unchanged**.

---

## Production verification

| Check | Result |
|-------|--------|
| Supabase project | `fmeinlwhixngednabhgy` |
| `/login` | **200** |
| `/` | **200** |
| hub-bridge bad PIN | **401** |
| bootstrap-admin unauth | **401** |
| update-credentials unauth | **401** (new boundary) |
| Anon `store_specialists` / `profiles` / `bay_service_logs` | **401** `42501` |
| `touch_auth_rate_limit` attempt + clear | **operational** |
| Master scrypt1 preserved | **Yes** |
| Plaintext reintroduced | **No** |
| SEC-OPS-007G JWT-first bootstrap | **Intact** (no hub bootstrap code regression in this diff) |
| `DEPTSYNC_ALLOW_PLAINTEXT_PIN_VERIFY` | **Not modified** |

Operator PIN was not requested or exposed. Interactive operator re-login after this deploy is recommended but not blocking for writer closure.

---

## Remaining risks

1. **Plaintext verify fallback still enabled** (default-on) until a separate env change.  
2. **Vercel dashboard value** of the flag was not inspected; code defaults to enabled when unset.  
3. Client `verifyPin` local equality remains UX-only (does not mint JWT).  
4. `DEFAULT_SUPERVISOR_PIN` empty-stored reset path remains (separate from DB plaintext fallback).  
5. Equality-branch **code** still present — env disable first; delete later.  
6. Historical dumps may still contain pre-cleanup digits offline.

---

## GO / NO-GO for fallback disable

| Action | Verdict |
|--------|---------|
| Writer closure deploy (this tranche) | **GO — COMPLETE** |
| Set `DEPTSYNC_ALLOW_PLAINTEXT_PIN_VERIFY=0` **in this tranche** | **NO-GO** (explicitly excluded) |
| Separate operator-authorized env disable | **GO** |

### Ready for separate configuration change when

1. Writer correction is live — **met** (`dbf6847` / `As1U36Fu…`).  
2. Full regression suite passing — **met** (1523).  
3. Credential inventory unchanged / no plaintext dependency — **met**.  
4. Public auth + containment + rate-limit healthy — **met**.  
5. Operator sets Vercel Production `DEPTSYNC_ALLOW_PLAINTEXT_PIN_VERIFY=0`, redeploys/restarts if required, confirms runtime, then re-verifies MasterAdmin login once.  
6. Do **not** delete the equality branch until after a soak on flag=`0`.

**Rollback (writer):** redeploy prior app commit; do not reintroduce client `pin_code` writes.  
**Rollback (future flag disable):** unset flag or set `1` — scrypt login unaffected either way.

---

## Boundaries honored

- No MasterAdmin PIN changes  
- No production SQL / credential resets  
- No RLS weakening / anon grants  
- No authentication redesign beyond the authorized credential write boundary  
- **No plaintext fallback disable**  
- No unrelated product work  

**STOP.** Next authorized step: operator sets `DEPTSYNC_ALLOW_PLAINTEXT_PIN_VERIFY=0` under the GO criteria above.
