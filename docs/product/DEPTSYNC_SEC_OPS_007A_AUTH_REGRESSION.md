# DEPTSYNC-SEC-OPS-007A — Post-Cleanup Authentication Regression

**Date:** 2026-10-11  
**Mode:** Diagnostic only  
**Production mutations:** NOT AUTHORIZED (none executed)  
**Commit / push / deploy:** NOT AUTHORIZED  
**Canonical project:** `fmeinlwhixngednabhgy`  
**References:** SEC-OPS-005 · SEC-OPS-006 · SEC-OPS-007

---

## Exact failing path

**Operation:** Hub PIN login → session establishment → profile linking upsert  

**Call chain (production execution, not hypothetical):**

1. `POST /api/auth/hub-bridge` (`app/api/auth/hub-bridge/route.ts`)  
2. `mintHubBridgeSession` verifies PIN against **`store_specialists`** (`lib/store-ops/hub-bridge.ts`)  
3. On success → `mintSessionForSpecialist`  
4. `ensureAuthUserForSpecialist` / `mintSessionForSpecialist` call  
   `linkAuthUserToSpecialistProfile` (**multiple times** per login)  
5. `linkAuthUserToSpecialistProfile` upserts `public.profiles` with **`pin: null`**

```76:100:lib/store-ops/link-auth-profile.ts
  const profilePayload: Record<string, unknown> = {
    id: input.authUserId,
    role,
    // ...
    pin_code: null,
    pin: null,
    pin_hash: null,
    // ...
  };

  const { error: profileError } = await admin
    .from("profiles")
    .upsert(profilePayload, { onConflict: "id" });
```

Hub-bridge call sites (all production login/session mint):

| File | Lines | When |
|------|------:|------|
| `lib/store-ops/hub-bridge.ts` | 159, 196, 206 | `ensureAuthUserForSpecialist` |
| `lib/store-ops/hub-bridge.ts` | 236 | `mintSessionForSpecialist` (after PIN verify) |

**Failure class:** Profile synchronization / linking during session establishment — **not** the PIN verify step itself (verify already succeeded against `store_specialists` scrypt1).

---

## Root cause

SEC-OPS-005 intentionally stopped copying roster PIN material into profile mirrors and wrote `pin: null` / `pin_code: null` / `pin_hash: null`.

Production schema (SEC-OPS-007 live inspection):

| Column | Nullability |
|--------|-------------|
| `profiles.pin` | **NOT NULL** (`is_nullable = NO`) |
| `profiles.pin_code` | NULL allowed |
| `profiles.pin_hash` | NULL allowed |
| `store_profiles.pin` | **NOT NULL** |
| `store_profiles.pin_code` | NULL allowed |

SEC-OPS-007 cleared obsolete digits using `pin = ''` because `pin = null` was rejected by the same constraint.

After cleanup, Master login re-runs profile link and attempts to set `pin` back to SQL `NULL` → Postgres `23502`:

`null value in column "pin" of relation "profiles" violates not-null constraint`

**File/line evidence:**

| Writer | File | Lines | Writes `pin: null`? | Production path |
|--------|------|------:|--------------------:|-----------------|
| Profile link (login) | `lib/store-ops/link-auth-profile.ts` | 87–88, 98–100 | **Yes** | **Yes — hub-bridge every successful login** |
| Auth profile PIN sync | `lib/store-ops/reset-pin.ts` | 240–248 | **Yes** | Change PIN only (no fallback) |
| `store_profiles` mirror | `lib/store-ops/reset-pin.ts` | 133–134 | **Yes** | Change PIN only |
| Bootstrap HTTP/script | `lib/store-ops/bootstrap-admin.ts` → link | via link | **Yes** | Protected bootstrap |
| Local bootstrap script direct upsert | `scripts/bootstrap-admin.mjs` | 239–252 | Writes **hash** to `pin` | Offline/admin only |

---

## Relevant schema constraints

- Live: `profiles.pin` NOT NULL, no usable null default observed during SEC-OPS-007 cleanup.  
- Repo migration `20260809_store_operations_rbac.sql` creates a thinner `profiles` table (no `pin` column) — `pin` NOT NULL was introduced out-of-band / earlier live evolution and is **not** reflected as a soft-null column in current app assumptions.  
- `handle_new_user` trigger inserts `(id, email)` only — compatible only if `pin` has a default or is nullable at insert time; live Master row already exists, so login hits **UPDATE/UPSERT**, not trigger insert.  
- No production schema change performed in this diagnostic.

---

## Whether production login is affected

| Aspect | Assessment |
|--------|------------|
| PIN verification against `store_specialists` scrypt1 | **Unaffected** (canonical authority) |
| Session mint requiring `linkAuthUserToSpecialistProfile` | **Affected** — primary upsert writes `pin: null` |
| Silent fallback in link-auth | Retries minimal upsert **without** `pin` (lines 104–112). If that succeeds, login may still complete while the NOT NULL error occurs on the first attempt. |
| If minimal fallback fails | Login throws with the NOT NULL message (reproduced in tests) |
| Operator report | Matches exact Postgres NOT NULL text → failing write is confirmed; outer login may fail hard or appear flaky depending on fallback |

**Existing sessions:** Already-issued JWTs do not re-run profile link until the next hub-bridge mint / re-login / bootstrap. Mid-session Store Ops calls that only **read** `profiles` are not writing `pin`. Re-login is the high-risk moment.

---

## Proposed minimal fix (NOT applied)

Do **not** reintroduce plaintext. Do **not** change MasterAdmin credentials.

In credential-clearing writers, satisfy NOT NULL with a non-secret empty string:

1. `lib/store-ops/link-auth-profile.ts` — `pin: ""` (keep `pin_code` / `pin_hash` null)  
2. `lib/store-ops/reset-pin.ts` `syncAuthProfilePin` — `pin: ""`  
3. `lib/store-ops/reset-pin.ts` `upsertStoreProfiles` — `pin: ""`  
4. Update SEC-OPS-005 / 007A tests to expect `pin: ""` and reject `pin: null`  
5. Optional follow-on: omit `pin` on pure UPDATE paths — less safe for INSERT upserts without a default

**Out of scope / not required for repair:** schema soften (`ALTER … DROP NOT NULL`), plaintext fallback changes, RLS changes, rate-limit changes, Master PIN reset.

---

## Regression test results

File: `lib/store-ops/sec-ops-007a.profiles-pin-not-null.test.ts`

| Test | Result |
|------|--------|
| Current payload writes `pin: null` | **PASS** (documents bug) |
| Reproduces NOT NULL throw when DB rejects + fallback fails | **PASS** |
| Documents silent minimal fallback can mask first error | **PASS** |
| Source contracts: hub-bridge → link; writers use `pin: null` | **PASS** |

```
npx vitest run lib/store-ops/sec-ops-007a.profiles-pin-not-null.test.ts
✓ 4 tests
```

---

## Risk assessment

| Risk | Level | Notes |
|------|-------|-------|
| Operator cannot complete hub-bridge login | **High** if minimal fallback fails; **Medium** if fallback masks but logs/UX still show error |
| Master scrypt credential integrity | **None** from this bug (roster untouched) |
| Plaintext reintroduction if fixed with `pin: ""` | **None** (empty non-secret) |
| Change PIN path | **High** for mirror update — `syncAuthProfilePin` has **no** fallback |
| Security control regression from proposed fix | **Low** — aligns writers with SEC-OPS-007 empty-string clear |

---

## GO / NO-GO for a separate repair release

| Action | Verdict |
|--------|---------|
| Diagnostic complete | **GO** |
| Separate minimal writer repair (`pin: ""`) | **GO** (authorize as SEC-OPS-007B / repair tranche) |
| Implement/deploy in this diagnostic | **NO-GO** (not authorized) |
| Production SQL / schema change now | **NO-GO** |
| Reintroduce plaintext / weaken auth | **NO-GO** |
| Disable plaintext verify fallback | **NO-GO** (unchanged) |

**Overall:** Root cause is SEC-OPS-005 profile writers writing `pin: null` into a NOT NULL column during hub-bridge profile link. Smallest safe fix is empty-string clear in those writers. Authorize a separate repair release to implement and deploy.

---

## Execution boundary confirmation

- Read-only inspection + local regression tests only  
- No production SQL  
- No credential changes  
- No commit / push / deploy  

**STOP.**
