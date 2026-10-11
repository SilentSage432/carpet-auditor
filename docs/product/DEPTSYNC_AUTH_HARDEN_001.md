# DEPTSYNC-AUTH-HARDEN-001 — Privileged PIN Security + Login Rate Limiting

**Mode:** Scoped local implementation  
**Production mutations:** NOT AUTHORIZED (none executed)  
**Canonical project:** `fmeinlwhixngednabhgy`  
**Date:** 2026-10-11  
**Predecessor:** [`DEPTSYNC_SEC_OPS_003_PIN_AUTH_DISCOVERY.md`](DEPTSYNC_SEC_OPS_003_PIN_AUTH_DISCOVERY.md)  
**Amendment:** **AUTH-HARDEN-001A** (same day) — rate limiter **fail-closed**; atomic `attempt` admit; IP-only buckets; release ordering hardened.

---

## A. Root causes

1. **Active MasterAdmin PIN stored as digit plaintext** in `store_specialists.pin_code`, accepted by `verifyStoredPin` equality fallback.
2. **Legacy salted SHA-256** (`salt.digest`) was the prior “secure” write path — inadequate for low-entropy PINs (fast hash).
3. **Two invited Associate rows** retained unused digit plaintext PINs (hub-bridge blocked by `invited`, but material still at rest).
4. **No shared rate limit** on public `POST /api/auth/hub-bridge` — online guessing of short PINs was practical across serverless instances.

---

## B. Existing authentication paths (preserved)

| Path | Behavior after AUTH-HARDEN-001 |
|------|--------------------------------|
| `POST /api/auth/hub-bridge` → `mintHubBridgeSession` | Same UX; rate-limited; login-time scrypt upgrade on legacy success |
| `HUB_MASTER_PIN` env unlock | Unchanged — unlocks existing Master only (no bootstrap) |
| Bootstrap / `masterBootstrapPinFields` | Writes **scrypt** (was salted SHA-256) |
| Invite redeem / `resetHubPin` | Continue to call `hashPin` → now scrypt |
| Invited / suspended | Still rejected before PIN verify |
| HttpOnly gate / session cookies | Untouched |
| Roles / store scope / Floor Command | Untouched |

**Operator PIN value is not changed.** Only storage format upgrades after a successful verified login.

---

## C. New PIN storage strategy

**Canonical format:** Node `crypto.scryptSync`

```
scrypt1$N$r$p$saltB64url$hashB64url
```

Parameters: `N=16384`, `r=8`, `p=1`, key length 32.

| API | Role |
|-----|------|
| `hashPin` / `hashPinScrypt` | New writes |
| `hashPinSha256Legacy` | Tests + verifying historical rows only |
| `isScryptPinHash` / `isCanonicalPinHash` | Shape checks |
| `isSaltedPinHash` | Legacy v1 detector (excludes scrypt) |
| `verifyStoredPin` | scrypt → salted SHA-256 → gated plaintext |
| `plaintextPinVerifyEnabled` | `DEPTSYNC_ALLOW_PLAINTEXT_PIN_VERIFY` (default **on**) |

Do **not** blind-rehash existing digest strings. Upgrade only after successful verify of the presented PIN.

---

## D. Legacy upgrade behavior

On successful hub-bridge PIN match, if `needsPinCredentialUpgrade(stored)`:

1. Generate fresh scrypt hash of the **presented** PIN.
2. Atomic conditional update: `pin_code`/`pin_hash` updated only where column still equals the exact prior stored value.
3. Concurrent upgrades: second updater gets **conflict** (0 rows); re-load + re-verify before mint; reject if PIN no longer matches.
4. Persist failure: **do not claim upgrade**; log warning **without** PIN; **login still proceeds** so the operator is not locked out during migration.

Owner: `lib/store-ops/pin-credential-upgrade.ts` composed from `mintHubBridgeSession`.

---

## E. Rate-limit implementation (AUTH-HARDEN-001A)

**Infrastructure:** `public.auth_rate_limits` + `touch_auth_rate_limit(bucket, window_ms, max_failures, mode)`  
Migration: `supabase/migrations/20261013_auth_harden_001_rate_limits.sql`  
Client: `lib/store-ops/auth-rate-limit.ts` wired in `app/api/auth/hub-bridge/route.ts`

| Setting | Default | Env override |
|---------|---------|--------------|
| Max attempts / window | **8** | `DEPTSYNC_AUTH_RATE_LIMIT_MAX` |
| Window | **15 minutes** | `DEPTSYNC_AUTH_RATE_LIMIT_WINDOW_MS` |
| Bucket | SHA-256 of `hub-bridge\|v2\|{ip}` (opaque; **IP only**) | — |
| Modes | `attempt` (admit) / `fail` alias / `peek` / `success` | — |

**001A corrections:**

- **Fail-closed:** RPC missing, error, exception, or malformed payload ⇒ deny public PIN auth (`503` `AUTH_LIMITER_UNAVAILABLE`). No silent bypass.
- **Atomic admit:** route calls `attempt` **before** PIN verify under `FOR UPDATE` — concurrent requests cannot exceed 8 via peek/TOCTOU races.
- **Failed attempts:** each admit consumes a slot; wrong PIN leaves the count; verified success clears **only that IP bucket** (cannot reset another actor’s key).
- **Identity:** prefer `x-real-ip` / `x-vercel-forwarded-for`, else **rightmost** `x-forwarded-for` hop. Client `store_number` is **not** part of the bucket (prevents body-field bucket rotation).
- Shared across serverless instances via Supabase (not process memory).
- Generic 429 when limited; 503 when limiter unavailable; no username/PIN in logs or keys.

**Protected recovery (not a public auth bypass):**

| Mechanism | Gate | Rate-limited? |
|-----------|------|---------------|
| `POST /api/auth/bootstrap-admin` | Bearer `BOOTSTRAP_SECRET` | No (secret-gated ops recovery) |
| `scripts/bootstrap-admin.mjs` | Service role + local env | No (operator workstation) |
| `HUB_MASTER_PIN` via hub-bridge | Same public route | **Yes** (counts toward limit) |

Invite redeem remains token-gated and is not an unauthenticated PIN-guess surface.

---

## F. Invited associate correction

Prepared (not executed):  
`scripts/sql/auth-harden-001-clear-invited-associate-pins.sql`

- Targets id prefixes `6f79f577%` and `2d65fa60%` from SEC-OPS-003.
- Guards: `role=associate`, `status=invited`, digit plaintext `pin_code`.
- Sets `pin_code`/`pin_hash` null; does not change status/role/identity.
- File ends in **`ROLLBACK`** — accidental run is non-mutating.

---

## G. Files changed

| File | Change |
|------|--------|
| `lib/auth-token.ts` | scrypt canonical; legacy verify; plaintext gate |
| `lib/invite.ts` | Re-exports |
| `lib/store-ops/pin-credential-upgrade.ts` | **New** atomic upgrade |
| `lib/store-ops/auth-rate-limit.ts` | Shared limiter — **001A fail-closed + IP bucket** |
| `lib/store-ops/hub-bridge.ts` | Upgrade after verified login |
| `app/api/auth/hub-bridge/route.ts` | Atomic `attempt` + generic 401; **001A** |
| `lib/store-ops/bootstrap-admin.ts` | Comment; still uses `hashPin` |
| `scripts/bootstrap-admin.mjs` | scrypt aligned with app |
| `supabase/migrations/20261013_auth_harden_001_rate_limits.sql` | **New** |
| `scripts/sql/auth-harden-001-clear-invited-associate-pins.sql` | **New** (local only) |
| `lib/store-ops/auth-harden-001.test.ts` | **New** behavioral tests |
| `lib/store-ops/bootstrap-admin.align-sec006.test.ts` | scrypt expectations |
| `lib/store-ops/hub-master-pin.align-sec005.test.ts` | scrypt expectations |
| `docs/product/DEPTSYNC_AUTH_HARDEN_001.md` | This report |

---

## H. Migration requirements (release ordering — HARD)

**Ordering is mandatory under fail-closed:**

1. **DB first:** Apply `20261013_auth_harden_001_rate_limits.sql` to `fmeinlwhixngednabhgy` (out-of-band; no `schema_migrations` table).
2. **Verify RPC** with service role: `attempt` / `success` / `peek`; confirm anon/authenticated cannot SELECT `auth_rate_limits` or EXECUTE the RPC.
3. **Then** deploy the AUTH-HARDEN app build.
4. **If app deploys before RPC:** every public hub-bridge login returns **503** until migration is applied. This is intentional (fail-closed). Recovery: bootstrap-admin / local script — **not** a public PIN bypass.
5. No roster credential rewrite migration required for Master — login-time upgrade handles it.
6. Invited associate clear SQL is a **separate authorized** step (see §K).
7. Optional env:
   - `DEPTSYNC_ALLOW_PLAINTEXT_PIN_VERIFY` — leave unset/`1` until retirement
   - `DEPTSYNC_AUTH_RATE_LIMIT_MAX` / `DEPTSYNC_AUTH_RATE_LIMIT_WINDOW_MS` — optional tuning

---

## I. Test results

| Check | Result |
|-------|--------|
| `npm run typecheck` | **PASS** (001A) |
| Auth-focused vitest (`auth-harden-001`) | **PASS** (28 tests) |
| Full `npm test` | **PASS** — **1465** tests (111 files) |
| `npm run build` | **PASS** |
| New regressions | **None observed** |

001A coverage includes: limiter unavailable, RPC failure/exception, concurrent attempts, limit exhaustion, success clear, normal admit, IP/bucket spoof resistance, bootstrap recovery contract.

---

## J. Operator login risks

| Risk | Mitigation |
|------|------------|
| Upgrade persist fails | Login still succeeds on legacy; warn logged; retry upgrade next login |
| Concurrent double login | Conditional PIN upgrade + re-verify on conflict |
| Plaintext fallback removed too early | Gated by env; retirement only after digit inventory = 0 |
| Rate-limit table / RPC missing | **Fail-closed 503** on hub-bridge; recover via `BOOTSTRAP_SECRET` bootstrap or local script |
| Operator rate-limited (8 wrong tries) | Wait for window or bootstrap recovery; correct PIN clears bucket on success |
| Success-clear RPC fails after good PIN | Session still issued; warn logged (access preserved) |
| Accidental associate PIN clear in prod | SQL ends in ROLLBACK; requires explicit authorize + COMMIT |

**No production Master PIN reset is required.** Four-digit operator PIN value unchanged.

---

## K. Production release sequence (controlled — do not execute here)

1. **Preflight:** Confirm `HUB_MASTER_PIN` + `HUB_GATE_SECRET` + `BOOTSTRAP_SECRET` in Vercel. Operator affirms bootstrap recovery path.
2. **Backup:** `pg_dump` of `fmeinlwhixngednabhgy`.
3. **DB (before app):** Apply `20261013_auth_harden_001_rate_limits.sql`.
4. **Verify limiter:** service-role `attempt` admits; 9th attempt limited; `success` clears same `bucket_key` only; anon/authenticated denied.
5. **Deploy app** (AUTH-HARDEN-001 + **001A**) — separate authorization required.
6. **Operator smoke:** Master username + **existing four-digit PIN** → Floor Command.
7. **Migration verify (read-only):** Master `pin_code` is `scrypt1$…` after login; active digit plaintext inventory = 0.
8. **Rate-limit verify:** ≥9 attempts from one IP → 429; missing RPC (staging only) → 503 not 200; success clears; no PIN in logs.
9. **Invited associates (optional):** pre-check + authorize + COMMIT (not Master credential change).
10. **Plaintext retirement (later):** digit inventory = 0 → `DEPTSYNC_ALLOW_PLAINTEXT_PIN_VERIFY=0` → later remove equality branch.
11. **Rollback:** Redeploy prior app. Table/RPC may remain. If hub-bridge 503: apply/fix RPC or use bootstrap. Do **not** re-plaintext scrypt rows. Do **not** force-reset operator PIN without authorization.

**Production credential change required?**  
- **Master PIN value:** No.  
- **Invited associate unused plaintext clear:** Optional separate authorize.  
- **Env:** No new secrets; limiter migration is required infrastructure.

---

## L. Remaining security risks

1. Plaintext verify remains until retirement flag + inventory clear.
2. Deploy-before-DB causes temporary hub-bridge 503 (fail-closed by design) — mitigated by release ordering + bootstrap recovery.
3. Follow-on plaintext **writes** on some paths (phone-reset / profile sync) — out of scope; SEC-OPS-003 follow-on.
4. `HUB_MASTER_PIN` / `BOOTSTRAP_SECRET` remain high-value secrets (by design).
5. Shared NAT / carrier IP may rate-limit multiple users behind one egress (acceptable for single-operator store).
6. Associate multi-user auth model still broader than constitutional single-operator intent.

---

## M. GO / NO-GO recommendation

| Action | Recommendation |
|--------|----------------|
| Local implementation (001 + **001A**) | **GO** |
| Production release readiness (engineering) | **CONDITIONAL GO** — only if §K.3 DB migration is applied **before** app deploy |
| Commit / push / deploy / prod SQL | **NO-GO** until operator authorizes §K |
| Deploy app without rate-limit RPC | **NO-GO** (hub-bridge would 503) |
| Remove plaintext fallback immediately | **NO-GO** until digit inventory = 0 |
| Execute invited associate clear | **NO-GO** here; **CONDITIONAL GO** under §K.9 |

**Overall:** AUTH-HARDEN-001A closes the fail-open release gate. Engineering is **CONDITIONAL GO** for controlled production release with **DB-before-app** ordering. Operator four-digit PIN and MasterAdmin identity preserved. STOP after local verification — no production mutations in this tranche.
