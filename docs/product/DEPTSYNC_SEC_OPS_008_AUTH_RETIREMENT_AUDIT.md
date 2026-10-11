# DEPTSYNC-SEC-OPS-008 — Plaintext Authentication Retirement Audit

**Date:** 2026-10-11  
**Mode:** Read-only discovery (no implementation, no production mutations)  
**Canonical Supabase:** `fmeinlwhixngednabhgy`  
**Application:** https://deptsync-hub.vercel.app  
**App hotfix commit:** `54d2bc4` (SEC-OPS-007G)  
**App deploy:** `E84YJUL4vH3TFPPe31agW6kx5vmm`  
**Repo tip at audit:** `90b6224` (docs-only after `54d2bc4`; `lib/auth-token.ts` / hub-bridge unchanged)  
**Operator verification:** CONFIRMED SUCCESSFUL Floor Command login with existing MasterAdmin PIN  
**References:** SEC-OPS-003…007G · AUTH-HARDEN-001/002 · SEC-OPS-005 writers  

---

## 1. Executive summary

DeptSync can retire the **DB plaintext PIN equality fallback** for the current single-operator Floor Command model, but only as a **controlled SEC-OPS-009** step — not by deleting code in this tranche.

**Live login authority** is `POST /api/auth/hub-bridge` → `mintHubBridgeSession` → `verifyStoredPin` on `store_specialists.pin_hash || pin_code`. Production metadata shows **exactly one** effective login credential: MasterAdmin `f9e36630-9793-40cd-9d3c-53b5ee450b1c` in **scrypt1** form. There are **zero** digit-shaped, salted-SHA-256, or unknown non-empty credential formats on the roster. Mirror tables hold empty-string / null PIN fields only and are **not** verify authorities.

`DEPTSYNC_ALLOW_PLAINTEXT_PIN_VERIFY` defaults **on** when unset (`lib/auth-token.ts` lines 173–178). Disabling it (`0` / `false` / `no` / `off`) removes only the equality branch; **scrypt1** and **legacy salted SHA-256** verification remain. Operator login against scrypt1 does not depend on plaintext equality.

**Verdict: CONDITIONAL GO** for a separate SEC-OPS-009 that sets the env flag to disabled (code removal later). Conditions are listed in §10.

---

## 2. Authentication path inventory

Every place a PIN/password can be accepted as valid (active + dormant).

| # | Path | File / function | Credential source | Verification method | Auth authority | Production use | Plaintext fallback reachable? |
|---|------|-----------------|-------------------|---------------------|----------------|----------------|-------------------------------|
| 1 | **Hub login (canonical)** | `app/api/auth/hub-bridge/route.ts` → `mintHubBridgeSession` (`lib/store-ops/hub-bridge.ts` ~280–344) | `store_specialists.pin_hash \|\| pin_code` | `verifyStoredPin` then JWT mint | Service-role roster + Supabase Auth | **Yes — Floor Command / AuthWall** | Only if stored value is non-scrypt / non-SHA-256 **and** flag enabled. **Not required** for current Master scrypt1. |
| 2 | **Hub Master env unlock** | `mintHubBridgeSession` / `mintExistingMasterWithHubPin` + `isHubMasterPin` (`lib/store-ops/hub-master-pin.ts` 13–17) | `HUB_MASTER_PIN` env | Exact string equality to env | Env secret → existing Master row session | Recovery / empty-PIN Master unlock | **Independent of** `DEPTSYNC_ALLOW_PLAINTEXT_PIN_VERIFY`. Not DB plaintext fallback. |
| 3 | **Login-time upgrade re-verify** | `maybeUpgradePinCredential` (`hub-bridge.ts` ~362–397) + `persistPinCredentialUpgrade` (`pin-credential-upgrade.ts`) | Same roster fields | `verifyStoredPin` before/after upgrade | Same as #1 | Active after legacy verify | Same as #1; no-op for already-scrypt1 Master. |
| 4 | **Change PIN (server)** | `POST /api/auth/reset-pin` → `resetHubPin` (`lib/store-ops/reset-pin.ts` ~324–334) | Roster `pin_hash \|\| pin_code` | `verifyStoredPin(current, stored)` (or `DEFAULT_SUPERVISOR_PIN` if empty stored) | Service role | Available; not required for ordinary login | Yes for non-hash stored; empty-stored path uses hardcoded default compare, **not** the flag. |
| 5 | **Bootstrap admin** | `POST /api/auth/bootstrap-admin` → `bootstrap-admin.ts` (~318–331) | Roster + `HUB_MASTER_PIN` / bootstrap secret | Secret-gated; writes scrypt via `masterBootstrapPinFields`; may call `verifyStoredPin` when updating | `BOOTSTRAP_SECRET` | Protected recovery only | Equality only if legacy stored + flag on; writers emit scrypt. |
| 6 | **Invite / PIN-reset complete** | `POST /api/auth/verify` → `completePinFromVerifySession` (`lib/onboarding/redeem-token.ts` ~105–138) | New PIN hashed with `hashPin` (scrypt), then `mintHubBridgeSession` | Write scrypt → verify via #1 | One-time verify cookie + service role | Dormant for single-operator (no invited associates with PINs) | New writes are scrypt; post-write login uses #1. |
| 7 | **Phone-reset confirm** | `POST /api/auth/phone-reset/confirm` | Writes via `rosterSecurePinFields` | Does not verify old PIN; OTP session gate | Phone Auth JWT + service role | Available / rare | Writers scrypt only. |
| 8 | **Hub gate cookie** | `POST /api/auth/gate` + `proxy.ts` | Existing Supabase JWT | HMAC hub-gate cookie | Session restore — **not PIN verify** | Yes after login | N/A — no PIN. |
| 9 | **AccessGate / hub bootstrap** | `AccessGate.tsx`, `decideAccessGateBoot`, `decideHubPageBoot` (007D/007G) | Session / JWT presence | Bootstrap decisions only | Post-auth | Yes | N/A — no PIN. |
| 10 | **Client `verifyPin`** | `lib/specialists.ts` 486–492; AuthWall ~745; ChangePinModal ~39 | Local `member.pin_code` (usually stripped) or `DEFAULT_SUPERVISOR_PIN` | Plainstring `===` | **Does not mint session** | UX / error messaging / client pre-check | Not the server fallback flag. AuthWall still requires hub-bridge success to authenticate. |
| 11 | **Client credential customize** | `updateSpecialistCredentials` (`lib/specialists.ts` 1061–1108) → `persistSpecialistFields` | Writes `pin_code: password` via authenticated client update | Persistence, not verify | Client + RLS roster-admin update | **Residual write risk** if first-login customize runs | Can **reintroduce** DB plaintext after retirement (see §5 / §11). |
| 12 | **Biometric unlock** | AuthWall `handleBiometricUnlock` | Prior Supabase session | WebAuthn + existing JWT | Session restore | Optional after first PIN login | N/A. |
| 13 | **Offline / localStorage roster** | `lib/specialists.ts` local helpers | Device-local copies | Local `verifyPin` | Offline UX only | Dormant / non-authoritative for Store Ops JWT | Local equality; not production hub-bridge. |

**Rate limiting:** hub-bridge admits via `touch_auth_rate_limit` **before** PIN verify (`hub-bridge/route.ts` 54–63). Fail-closed. Unaffected by plaintext flag.

**Edge middleware:** `proxy.ts` enforces hub-gate cookie; does not verify PINs.

---

## 3. Production credential-format inventory

**Method:** Read-only PostgREST select of credential columns; classify by format signature only (no PIN values printed).  
**Project confirmed:** `fmeinlwhixngednabhgy`.  
**Classifier aligned with** `isScryptPinHash` / `isSaltedPinHash` (`lib/auth-token.ts` 122–147) plus digit-shape and empty/null.

### `store_specialists` (canonical — 35 rows)

| Effective credential (`pin_hash` else `pin_code`) | Count |
|--------------------------------------------------|------:|
| **scrypt1** | **1** |
| salted SHA-256 (`salt.hexdigest`) | **0** |
| digit-shaped plaintext (4–8 digits) | **0** |
| unknown / unrecognized non-empty | **0** |
| null / empty (no app PIN) | **34** |

| Field | null | scrypt1 | other |
|-------|-----:|--------:|------:|
| `pin_code` | 34 | 1 | 0 |
| `pin_hash` | 34 | 1 | 0 |

**MasterAdmin (login credential):**

| Attribute | Value |
|-----------|--------|
| Id | `f9e36630-9793-40cd-9d3c-53b5ee450b1c` |
| Role / store / status | `MasterAdmin` / `2587` / `active` |
| `pin_code` shape | **scrypt1** (len 84) |
| `pin_hash` shape | **scrypt1** (len 84) |
| Effective verify material | **scrypt1** |

### `profiles` (1 row — identity mirror)

| Field | Kind |
|-------|------|
| `pin` | **empty_string** (NOT NULL placeholder from SEC-OPS-007/007B) |
| `pin_code` | null |
| `pin_hash` | null |

Digit / scrypt1 / SHA-256 / unknown: **0**.

### `store_profiles` (1 row — legacy mirror)

| Field | Kind |
|-------|------|
| `pin` | **empty_string** |
| `pin_code` | null |

Digit / scrypt1 / SHA-256 / unknown: **0**.

### Interpretation

- Zero digit-shaped values **and** zero unknown non-empty formats on the login table.  
- No active login credential requires plaintext equality.  
- No known active credential requires unsupported legacy verification.  
- Empty-string mirrors **cannot** authenticate via `verifyStoredPin` (`!stored` short-circuit, lines 237–238).  
- Metadata cache (no secrets): `tmp/sec-ops-008-credential-inventory.json` (local audit artifact; not for commit).

---

## 4. Credential writer inventory

| Writer | Location | Persist format | Mirror PIN behavior | Plaintext recreate? | Automated test evidence | Production runtime verify |
|--------|----------|----------------|---------------------|---------------------|-------------------------|---------------------------|
| `rosterSecurePinFields` | `reset-pin.ts` 19–33 | scrypt1 both columns; rejects hash===pin | N/A | No | SEC-OPS-005 tests | Deployed via SEC-OPS-006; live Change PIN not re-exercised this audit |
| `resetHubPin` | `reset-pin.ts` | scrypt via helper; ensure_master insert hashed | `pin: ""`, `pin_code`/`pin_hash` null | No | Source + unit contracts | Same |
| `phone-reset/confirm` | `app/api/auth/phone-reset/confirm/route.ts` ~95–99 | scrypt | Profile link clears mirrors | No | Source contract | Not re-run live |
| `linkAuthUserToSpecialistProfile` | `link-auth-profile.ts` 87–91 | N/A | `pin: ""`, nulls | No | SEC-OPS-007B | Operator login after 007G implies link path OK |
| `masterBootstrapPinFields` / bootstrap | `bootstrap-admin.ts` 35–41 | scrypt | Hashed roster | No | ALIGN-SEC-006 | Secret-gated; not public |
| Invite redeem / verify complete | `redeem-token.ts` 105–113 | `hashPin` → scrypt | Clears tokens | No | Prior suites | Unused for current operator PIN |
| Login upgrade | `pin-credential-upgrade.ts` | `hashPinScrypt` | Roster only | No | AUTH-HARDEN-001 | No-op for current Master |
| Roster invite / create member | `roster-invite.ts` / `create-roster-member.ts` | null PIN fields | N/A | No | Prior | 34 null-PIN rows consistent |
| **`updateSpecialistCredentials`** | `specialists.ts` 1095 | **`pin_code: password` (plaintext)** via client `persistSpecialistFields` | May write roster PIN column if RLS allows | **Yes — residual** | Not covered by SEC-OPS-005 | **Not proven unused** in all UI modes |

**Conclusion:** Server-owned auth writers from SEC-OPS-005/006/007B are scrypt-correct and do not recreate digit mirrors. One **client** credential-customization writer remains a plaintext reintroduction risk if exercised under roster-admin JWT (`store_specialists_update_roster_admin` still grants UPDATE; secret columns revoke **SELECT** only — `20260817_rls_security_lockdown.sql` 92–141).

---

## 5. Plaintext fallback behavior

```173:247:lib/auth-token.ts
export function plaintextPinVerifyEnabled(): boolean {
  const raw = process.env.DEPTSYNC_ALLOW_PLAINTEXT_PIN_VERIFY;
  if (raw === undefined || raw === "") return true;
  const v = raw.trim().toLowerCase();
  return !(v === "0" || v === "false" || v === "no" || v === "off");
}
// ...
export function verifyStoredPin(pin, stored) {
  if (!pin || !stored) return false;
  if (isScryptPinHash(stored)) return verifyPinScrypt(pin, stored);
  if (isSaltedPinHash(stored)) return verifyPinHash(pin, stored);
  if (!plaintextPinVerifyEnabled()) return false;
  // timing-safe equality ...
}
```

| Question | Finding |
|----------|---------|
| Default | **Enabled** when env unset/empty |
| Production explicit set? | **Not confirmed** via Vercel dashboard in this read-only audit; flag **absent** from `.env.example`; docs historically leave unset/`1`. Behavior consistent with default-on. |
| Disable effect on scrypt | **None** — scrypt branch returns before flag check |
| Disable effect on salted SHA-256 | **None** — SHA-256 branch returns before flag check |
| Disable effect on empty/null | Still reject (`!stored`) |
| Unknown formats with flag on | Treated as plaintext equality candidates (`classifyPinCredential` → `plaintext_legacy`) |
| Unknown formats with flag off | Reject (`unknown`); cannot authenticate |
| Accidental auth on unknown | Only if submitted PIN equals stored blob **and** flag on; production has **0** unknown blobs |

**Do not change the flag in this tranche.** (Boundary honored.)

---

## 6. Legacy SHA-256 compatibility assessment

| Item | Status |
|------|--------|
| Verify support independent of plaintext flag | **Yes** (`isSaltedPinHash` → `verifyPinHash`) |
| Production roster rows | **0** |
| Login-time upgrade to scrypt | Still available if any appear |
| Retirement of SHA-256 path | **Out of scope** for plaintext retirement; keep until separately authorized |

Disabling plaintext fallback does **not** remove SHA-256 compatibility.

---

## 7. Authentication regression risks

| Surface | Impact if plaintext fallback disabled |
|---------|----------------------------------------|
| Existing MasterAdmin login (scrypt1) | **None expected** — operator already confirmed scrypt login |
| Invited associates | 34 rows have null PIN; hub-bridge already blocks invited/no-PIN; no plaintext dependency |
| Account recovery (phone-reset / verify token) | Writes scrypt; verify uses #1 — **OK** |
| PIN resets (`reset-pin`) | Current PIN check uses `verifyStoredPin` (scrypt) — **OK**; empty-stored default `1234` path unchanged |
| Session restoration / AccessGate / hub bootstrap (007D/007G) | JWT + hub-gate — **no PIN path** |
| Supabase JWT minting | After successful verify only — unchanged |
| Roster retrieval | Authenticated JWT + non-secret projection — unchanged |
| Existing sessions | Unaffected (already minted) |
| `HUB_MASTER_PIN` env unlock | **Preserved** (separate equality) |
| Single-operator Floor Command model | **Preserved** — no auth scope expansion |
| Future `updateSpecialistCredentials` plaintext write | **Lockout risk** if that UI runs after flag disable — primary residual |

Public smoke (read-only): `/` 200, `/login` 200, hub-bridge bad PIN **401**, bootstrap-admin unauth **401**.

---

## 8. Missing tests

### Present (automated)

| Coverage | Where |
|----------|--------|
| Canonical scrypt verify | `auth-harden-001.test.ts`, SEC-OPS-005/007B |
| Legacy SHA-256 verify + upgrade | `auth-harden-001.test.ts` |
| Plaintext enabled / disabled | `auth-harden-001.test.ts` 69–81 |
| Empty-string / null rejection | `sec-ops-007b.login-hotfix.test.ts` 42–56 |
| Incorrect PIN rejection | `auth-harden-001.test.ts` 84–90 |
| Rate limiting fail-closed | `auth-harden-001.test.ts` AUTH-HARDEN-001A block |
| AccessGate / hub bootstrap recovery | `access-gate-bootstrap.test.ts`, SEC-OPS-007C/D/E/F/G |
| Writer no-plaintext contracts | `sec-ops-005.credential-writers.test.ts` |

### Missing / weak (do not implement in this tranche)

1. **scrypt still verifies when `DEPTSYNC_ALLOW_PLAINTEXT_PIN_VERIFY=0`** (flag-off isolation).  
2. **SHA-256 still verifies when flag=0** (same).  
3. **Unknown-format rejection** when flag=0 (non-digit, non-hash blob).  
4. **Unknown-format cannot authenticate** when flag=0 even if pin===stored.  
5. **`updateSpecialistCredentials` must not persist plaintext** (or must route through `rosterSecurePinFields` / reset-pin).  
6. Production/integration assertion that Vercel Production has flag=`0` after SEC-OPS-009 (ops checklist, not unit).

ALIGN-SEC-005/006 tests that **expect** plaintext 64-hex equality will need env/`0` awareness before **code deletion** of the equality branch (not required for env-only disable if default remains on in test process unless stubbed).

---

## 9. Exact proposed retirement scope (SEC-OPS-009)

**In scope (recommended sequence):**

1. Add missing unit tests from §8 items 1–4 (and ideally 5).  
2. Set Vercel Production (and Preview) `DEPTSYNC_ALLOW_PLAINTEXT_PIN_VERIFY=0` — **no app code delete yet**.  
3. Redeploy or restart so Node process picks up env (if required by platform).  
4. Operator re-verify Floor Command MasterAdmin PIN login once.  
5. Confirm hub-bridge still 401 on bad PIN; rate-limit + RLS containment unchanged.  
6. Re-inventory credential formats (expect identical to §3).  

**Explicitly out of scope for first SEC-OPS-009 cut:**

- Removing the equality branch from `verifyStoredPin`  
- Removing salted SHA-256 verify  
- Changing `isHubMasterPin` / `HUB_MASTER_PIN`  
- RLS / rate-limit / bootstrap secret changes  
- Master PIN rotation  
- Product feature work  
- Expanding authentication beyond single-operator Floor Command  

**Follow-on (SEC-OPS-009B or later):** delete equality branch + `plaintextPinVerifyEnabled` after flag has been disabled in production for a soak period; fix `updateSpecialistCredentials` plaintext write before or with that deletion.

---

## 10. GO / CONDITIONAL GO / NO-GO

| Action | Verdict |
|--------|---------|
| Disable plaintext fallback **in this audit** | **NO-GO** (not authorized; discovery only) |
| Remove equality code **now** | **NO-GO** |
| Separate **SEC-OPS-009** env disable | **CONDITIONAL GO** |
| Overall trust that active login needs plaintext | **GO — it does not** |

### CONDITIONAL GO criteria for SEC-OPS-009

| # | Condition | Status now |
|---|-----------|------------|
| C1 | SEC-OPS-005/006 writers live | **Met** |
| C2 | Digit + unknown inventory = 0 on specialists + mirrors | **Met** (§3) |
| C3 | MasterAdmin effective credential = scrypt1 | **Met** |
| C4 | Operator interactive scrypt login confirmed | **Met** (operator) |
| C5 | Automated tests: scrypt + SHA-256 succeed with flag=`0` | **Missing** — add before deploy |
| C6 | Residual `updateSpecialistCredentials` plaintext write addressed **or** explicitly accepted as non-use for operator + blocked in checklist | **Open** — prefer fix or server-route redirect before flag disable |
| C7 | Separate authorization + rollback plan (re-set flag to unset/`1`) | **Required at execution** |

**Not sufficient alone:** operator login success (necessary, already present).  
**Not blocking:** presence of empty-string mirror `pin` columns; hub Master env PIN path; SHA-256 code retention.

---

## 11. Remaining security concerns

1. **Client credential customization** can still write plaintext `pin_code` under roster-admin UPDATE grants — would recreate a plaintext dependency after retirement.  
2. **Vercel env actual value** of `DEPTSYNC_ALLOW_PLAINTEXT_PIN_VERIFY` not dashboard-confirmed (defaults on).  
3. **Historical backups / dumps** retain pre-cleanup digit material offline.  
4. **`DEFAULT_SUPERVISOR_PIN` (`1234`)** remains in client helpers and empty-stored reset-pin compare — separate from DB plaintext fallback; do not expand scope here.  
5. **Client `verifyPin` equality** remains for UX; does not mint JWT but can confuse Change PIN pre-checks when roster `pin_code` is stripped.  
6. **34 null-PIN specialists** are correct for roster-only; keep hub-bridge invited/suspended/no-PIN gates.  
7. Docs tip `90b6224` is not an auth binary change vs `54d2bc4`; treat `54d2bc4` / `E84YJUL4…` as the auth hotfix identity.

---

## Boundaries honored

- No application code changes  
- No production SQL / credential modifications / PIN resets  
- No environment variable changes  
- No commit / push / deploy  
- No authentication bypasses, RLS, rate-limit, or product feature work  

**STOP.** Next authorized step: SEC-OPS-009 under CONDITIONAL GO criteria above.
