# DEPTSYNC-SEC-OPS-003 — PIN Authentication Format and Migration Readiness

**Status:** COMPLETE (read-only discovery)  
**Date:** 2026-10-11  
**Project:** `fmeinlwhixngednabhgy`  
**Mode:** READ-ONLY — no PIN changes, rehashes, resets, auth code changes, commits, pushes, or deploys  

---

## Terminology correction (vs SEC-OPS-001)

DeptSync does **not** use bcrypt for roster PINs.

| Label | Meaning |
|-------|---------|
| Canonical hash | `salt.digest` — SHA-256 of `salt:pin` (`hashPin` in `lib/auth-token.ts`) |
| `isSaltedPinHash` | salt ≥ 16 hex chars + `.` + 64 hex digest |
| SEC-OPS-001 “non-bcrypt / len ≤ 12” | Correctly flagged **non-canonical** rows; those rows are **`digit_pin_shape`** (`^\d{4,6}$`), not bcrypt and not salted SHA-256 |

Live inventory: **0** `salted_sha256` `pin_code` rows among 35 specialists; **3** `digit_pin_shape`; **32** empty.

---

## A. Authentication paths

| Path | Entry | Verify | Write format (current code) |
|------|-------|--------|-----------------------------|
| Hub PIN login | `POST /api/auth/hub-bridge` → `mintHubBridgeSession` | `verifyStoredPin(pin, pin_hash \|\| pin_code)` then mint Auth session | N/A (read) |
| Master env unlock | Same hub-bridge | `isHubMasterPin(pin)` vs `HUB_MASTER_PIN` → existing MasterAdmin | N/A |
| Bootstrap HTTP | `POST /api/auth/bootstrap-admin` + `BOOTSTRAP_SECRET` | sets Master roster | **salted** `pin_code`+`pin_hash` (ALIGN-SEC-006) |
| Bootstrap script | `scripts/bootstrap-admin.mjs` | same | **salted** |
| Change / reset PIN API | `POST /api/auth/reset-pin` → `resetHubPin` | `verifyStoredPin` on current | **salted** on `store_specialists`; **plaintext** still written to `store_profiles` / `profiles` sync helpers |
| Invite redeem | `POST /api/auth/redeem-invite` | token + new PIN | **salted** |
| Phone reset confirm | `POST /api/auth/phone-reset/confirm` | phone verify | **`pin_code: newPassword` plaintext** (gap) |
| PIN reset request | `POST /api/auth/pin-reset/request` | issues hashed auth token SMS | token hash only |
| QR pair / invite | pairing APIs | token | PIN usually null until redeem |
| Legacy associate | hub-bridge with Associate role | same `verifyStoredPin` | same storage |

**Core functions** (`lib/auth-token.ts`):

```text
hashPin(pin)           → salt.sha256hex(salt:pin)
isSaltedPinHash(s)     → shape check
verifyPinHash(pin, s)  → recompute digest (timing-safe)
verifyStoredPin(pin,s) → if salted: verifyPinHash; else: stored === pin  (legacy plaintext)
```

**Hub-bridge order** (`lib/store-ops/hub-bridge.ts`):

1. Resolve specialist by id/username  
2. Reject `invited` / `suspended`  
3. Prefer `pin_hash`, else `pin_code`  
4. `verifyStoredPin` → mint session if active  
5. Else if `isHubMasterPin` → mint existing MasterAdmin (env credential; ignores roster digit PIN)

Supervisor and Associate use the same verify path; Master has the additional env fallback.

---

## B. PIN storage formats

| Format | Detection (metadata only) | Accepted by `verifyStoredPin`? |
|--------|---------------------------|--------------------------------|
| Salted SHA-256 | `salt.digest` regex | Yes (preferred) |
| Digit PIN shape | `^\d{4,6}$` | Yes via **plaintext equality** |
| Empty | null/blank | No (unless Master env path) |
| bcrypt `$2…` | not used in this codebase | N/A — **0** rows |

**Evidence that digit-shaped rows are plaintext-compatible (not “unknown hash”):**

1. Length 4–6 and digit-only → cannot be `isSaltedPinHash` (that format is much longer).  
2. `verifyStoredPin` explicitly falls back to `stored === pin`.  
3. No second hash algorithm is implemented for roster PINs.  

Therefore these are **not** candidates for blind re-hashing of an opaque digest; they are **legacy plaintext PIN storage**.

---

## C. Affected record classification

Table: **`public.store_specialists`** (canonical Hub login source).  
Store: **`2587`**. Values never selected/printed.

| # | id prefix | Role | status | is_active | pin_code format | pin_code_len | pin_hash | username | auth_user | must_change | Class |
|---|-----------|------|--------|-----------|-----------------|-------------:|----------|----------|-----------|-------------|-------|
| 1 | `f9e36630` | MasterAdmin | active | true | digit_pin_shape | 4 | empty | yes | yes | false | **Operator — active plaintext** |
| 2 | `6f79f577` | Associate | invited | true | digit_pin_shape | 6 | empty | yes | no | true | **Legacy associate — unused by hub-bridge** |
| 3 | `2d65fa60` | Associate | invited | true | digit_pin_shape | 6 | empty | yes | no | true | **Legacy associate — unused by hub-bridge** |

**Related tables (metadata):**

| Table | rows | digit_shape pin_code | salted |
|-------|-----:|---------------------:|-------:|
| `profiles` | 1 | 1 | 0 |
| `store_profiles` | 1 | 1 | 0 |

Likely Master mirrors from historical plaintext sync (`upsertStoreProfiles` / profile pin fields still accept plaintext in reset helpers).

---

## D. Actual security exposure

| Record | Classification | Rationale |
|--------|----------------|-----------|
| MasterAdmin `f9e36630` | **A — Active insecure credential** | `status=active`, `has_auth_user`, hub-bridge will accept username + matching 4-digit PIN via plaintext equality. Also unlockable via `HUB_MASTER_PIN` without consulting that digit string. |
| Associates `6f79f577`, `2d65fa60` | **B + D — Legacy plaintext still in DB; not consumed by current hub-bridge** | Hub-bridge rejects `invited` before PIN verify. No `auth_user_id`. Risk if status flipped to `active` without rehash, or if another path reads `pin_code`. |
| Format certainty | **Not “unknown hash”** | Digit shape + equality verify path ⇒ plaintext PIN material. |

**Client PostgREST SELECT of `pin_code`:** contained by SEC-OPS-002 column grants. Remaining exposure is **service-role / DB-privileged read** and **online guessing of short digits** against public hub-bridge (no rate limit).

**Brute-force surface (4-digit):** 10 000 possibilities against `POST /api/auth/hub-bridge` if username known — amplified by missing rate limits.

---

## E. Migration / reset options

### Option 1 — Login-time hash upgrade (recommended for Master)

After successful `verifyStoredPin` where stored was **not** salted, rewrite `pin_code`+`pin_hash` = `hashPin(presented_pin)` (service role).

| Aspect | Detail |
|--------|--------|
| Code | Small change in hub-bridge (or shared helper) after successful verify |
| DB | UPDATE those rows only when login succeeds |
| Operator login | **Preserved** — next successful login upgrades silently |
| Recovery | `HUB_MASTER_PIN` / bootstrap still work |
| Rollback | Keep plaintext verify fallback until zero digit rows remain |
| Caveat | Upgrade only runs when that PIN is presented; env-only Master logins never touch the digit row |

### Option 2 — Controlled PIN reset (`resetHubPin` / Change PIN)

Operator (or bootstrap) sets a new 4-digit PIN; roster stores salted hash.

| Aspect | Detail |
|--------|--------|
| Code | Mostly exists; fix `store_profiles`/`profiles` plaintext sync + phone-reset plaintext write as follow-on |
| DB | UPDATE Master row (+ optional profile rows) |
| Operator login | Must know current PIN **or** use admin/bootstrap path that skips current |
| Recovery | Bootstrap with `BOOTSTRAP_SECRET` + `HUB_MASTER_PIN` |
| Risk | `ensure_master` insert path still writes plaintext `pin_code: newPin` — fix before relying on it |

### Option 3 — Re-run hashed bootstrap (`force`)

`ensureMasterAdminBootstrap` with SEC-006 hashing overwrites Master roster PIN fields with hash of **env** `HUB_MASTER_PIN` (not the 4-digit roster secret).

| Aspect | Detail |
|--------|--------|
| Effect | Digit roster PIN may **stop working**; env Master PIN continues |
| Operator impact | **High** if operator still uses the 4-digit roster PIN daily |
| Use when | Operator confirms env Master PIN is the preferred login |

### Option 4 — Retire unused associate digit PINs

For invited associates: set `pin_code`/`pin_hash` null (they should set PIN at redeem).

| Aspect | Detail |
|--------|--------|
| Login impact | None (hub-bridge already blocks invited) |
| Code | Optional one-shot SQL or admin tool |
| Safe | Yes if status remains invited / no auth user |

### Option 5 — Remove plaintext fallback immediately

Delete `stored === pin` branch in `verifyStoredPin`.

| Aspect | Detail |
|--------|--------|
| **NO-GO now** | Would lock Master digit login until Option 1/2/3 completes |
| Sequence | Only after **0** digit_pin_shape rows on specialists (+ decide profile mirrors) |

### Rejected — Blind rehash of stored digit string as “hash input”

Unnecessary and confusing: the stored value **is** the PIN (plaintext). Rehashing the digit string as `hashPin(stored)` is correct **only when** you intentionally treat the stored plaintext as the password material (same as Option 1/2). Do **not** treat it as an opaque foreign hash.

---

## F. Operator login risks

| Scenario | Risk |
|----------|------|
| Upgrade-on-login (Option 1) while operator uses 4-digit PIN | **Low** — seamless |
| Bootstrap force overwrite to env hash while operator uses 4-digit PIN | **High** — digit login breaks until reset |
| Remove plaintext fallback before upgrade | **Critical** — lockout |
| Leave as-is | Ongoing plaintext-at-rest + guessable 4-digit online |

**Preserve working login:** Prefer Option 1 and/or Option 2 with confirmed recovery via `HUB_MASTER_PIN` + `BOOTSTRAP_SECRET` before any fallback removal.

---

## G. Recovery requirements

Before any destructive remediation:

1. Confirm Production `HUB_MASTER_PIN` and `BOOTSTRAP_SECRET` still configured (names only; values not read here).  
2. Confirm operator can reach `POST /api/auth/bootstrap-admin` or local `scripts/bootstrap-admin.mjs`.  
3. Confirm MasterAdmin row remains `active` with `auth_user_id` linked.  
4. After change: verify hub-bridge login; keep plaintext fallback until inventory shows 0 digit shapes.

---

## H. Recommended minimal correction

**Implementation tranche (separate authorization):**

1. **MasterAdmin (`f9e36630`):** Login-time hash upgrade (Option 1) **or** operator-driven `resetHubPin` (Option 2). Do not bootstrap-force unless operator abandons the 4-digit roster PIN.  
2. **Invited Associates (2 rows):** Null out `pin_code` / `pin_hash` (Option 4) — no login impact.  
3. **Do not** remove plaintext `verifyStoredPin` fallback in the same tranche.  
4. **Follow-on (same or later tranche):** Stop writing plaintext in `phone-reset/confirm`, `upsertStoreProfiles`, `syncAuthProfilePin`, and `ensure_master` insert.  
5. **AUTH-RATE-001:** Rate-limit hub-bridge (and recovery) — especially important while any digit PIN remains.

**GO / NO-GO for that implementation:** see §J.

---

## I. Required regression tests

| # | Behavior |
|---|----------|
| 1 | Valid Master login with salted hash succeeds |
| 2 | Valid Master login with legacy digit plaintext succeeds **until** upgraded |
| 3 | After upgrade-on-login, same PIN succeeds against salted hash; row format becomes `salted_sha256` |
| 4 | Incorrect PIN → 401 / generic invalid message |
| 5 | `isHubMasterPin` env path still mints existing Master when roster PIN mismatches |
| 6 | Invited Associate cannot hub-bridge login |
| 7 | `resetHubPin` stores salted hash on specialists (not digit plaintext) |
| 8 | Bootstrap writes salted hash only (ALIGN-SEC-006 contracts) |
| 9 | Unauthorized / missing session rejected on protected APIs (unchanged) |
| 10 | Inventory query: digit_pin_shape count → 0 after remediation |

Use synthetic fixtures only — no production user creation.

---

## J. GO / NO-GO for implementation

| Decision | Verdict |
|----------|---------|
| Discovery complete | **GO** |
| Implement PIN remediation now (this tranche) | **NO-GO** — discovery only |
| Authorize follow-on **SEC-OPS-003-IMPL** (upgrade-on-login + clear invited digits; keep plaintext fallback) | **CONDITIONAL GO** — after operator affirms recovery (`HUB_MASTER_PIN` / bootstrap) and accepts brief implementation scope |
| Remove plaintext verify fallback | **NO-GO** until digit_pin_shape = 0 |
| Blind rehash / guess PINs / mutate prod in discovery | **NO-GO** |

---

## K. Rate-limit interaction (§5)

| Public endpoint | Consumes these credentials? | Rate limit |
|-----------------|----------------------------|------------|
| `POST /api/auth/hub-bridge` | **Yes** — Master digit PIN + all roster PINs; Master env PIN | **None** |
| `POST /api/auth/reset-pin` | Current PIN verify | **None** (often gated) |
| `POST /api/auth/pin-reset/request` | Phone → token | **None** |
| `POST /api/auth/phone-reset/*` | Recovery | **None** |
| `POST /api/auth/bootstrap-admin` | `BOOTSTRAP_SECRET` Bearer | Secret-gated; still no throttle |
| `POST /api/auth/redeem-invite` | Invite + new PIN | **None** |

Missing rate limits make the **active 4-digit Master plaintext** (and any future digit PINs) practical to online-bruteforce if username is known. Rate limiting does not remove at-rest plaintext risk but bounds online guessing. Implement in **AUTH-RATE-001**, not here.

---

## Evidence references

- `lib/auth-token.ts` — `hashPin` / `verifyStoredPin`  
- `lib/store-ops/hub-bridge.ts` — login orchestration  
- `lib/store-ops/bootstrap-admin.ts` / ALIGN-SEC-006 — hashed bootstrap  
- `lib/store-ops/reset-pin.ts` — salted roster write; plaintext profile sync  
- `app/api/auth/phone-reset/confirm/route.ts` — plaintext `pin_code` write  
- Live readonly SQL 2026-10-11 on `fmeinlwhixngednabhgy` (format metadata only)  
- SEC-OPS-001 / SEC-OPS-002 reports  

---

*End of DEPTSYNC-SEC-OPS-003. STOP — no implementation.*
