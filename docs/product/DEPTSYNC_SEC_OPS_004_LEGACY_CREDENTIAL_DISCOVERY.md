# DEPTSYNC-SEC-OPS-004 — Legacy Profile Credential Retirement Discovery

**Mode:** Read-only discovery  
**Production mutations:** NOT AUTHORIZED (none executed)  
**Canonical project:** `fmeinlwhixngednabhgy`  
**Date:** 2026-10-11  
**Predecessors:** AUTH-HARDEN-001/001A/002/002B · SEC-OPS-003

---

## A. Remaining credential inventory

Live metadata only (no credential values printed).

| Table | Digit-shaped PIN fields | scrypt | Notes |
|-------|------------------------:|-------:|-------|
| `store_specialists` | **0** | **1** | Canonical hub roster — MasterAdmin upgraded |
| `profiles` | **1** | 0 | Columns: `pin`, `pin_code`, `pin_hash`, `pin_updated_at` |
| `store_profiles` | **1** | 0 | Columns: `pin`, `pin_code` only (**no `pin_hash`**) |

### `profiles` digit row

| Field | Value |
|-------|--------|
| Profile id prefix | `0f3b20ce…` |
| Role | `super_admin` |
| Store | `2587` |
| Active | true |
| Username present | true |
| `specialist_id` prefix | `f9e36630…` |
| Linked specialist | `MasterAdmin` / `active` / **`scrypt1`** |
| Known Master prefix match | **true** |
| `pin_code` / `pin` format | digit |
| `pin_hash` | empty |

### `store_profiles` digit row

| Field | Value |
|-------|--------|
| Profile id prefix | `0b7d86d3…` |
| Role | `admin` |
| Store | **`1852`** (not 2587) |
| Active | true |
| Username | `master_admin` |
| `specialist_id` column | **does not exist** on this table |
| Username+store join to `store_specialists` | **no match** |
| Looks Master-like by username/role | true |
| `pin_code` / `pin` format | digit |

---

## B. Authentication consumer map

### Reads used for PIN verification (production login)

| Path | Reads `profiles` PIN? | Reads `store_profiles` PIN? | Canonical verify source |
|------|----------------------:|----------------------------:|-------------------------|
| `POST /api/auth/hub-bridge` → `mintHubBridgeSession` | **No** (loads `profiles.id` for Auth link only) | **No** | `store_specialists.pin_hash` \|\| `pin_code` via `verifyStoredPin` |
| `resetHubPin` current-PIN check | **No** | **No** | `store_specialists` |
| Invite redeem / QR pair | **No** | **No** | Writes hash to `store_specialists`, then hub-bridge |
| `resolveStoreOpsActor` / `auth-server` | **No PIN columns selected** | **No** | Auth JWT + profile identity fields |
| Sunday / push / department-access | **No PIN reads** | **No** | Non-auth |

**Conclusion:** Neither remaining digit record is consumed by a production PIN verification path.

### Writes that still touch profile PIN fields

| Writer | Target | Material written today |
|--------|--------|------------------------|
| `linkAuthUserToSpecialistProfile` | `profiles.pin_code` / `pin` | Copies `specialist.pin_code` (may be stale in-memory plaintext on hub-bridge mint) |
| `syncAuthProfilePin` (`reset-pin.ts`) | `profiles.pin` / `pin_code` | **Plaintext `newPin`** |
| `upsertStoreProfiles` (`reset-pin.ts`) | `store_profiles.pin` / `pin_code` | **Plaintext `newPin`** |
| `scripts/bootstrap-admin.mjs` / bootstrap HTTP | `profiles.pin_code` | Hashed (scrypt) when bootstrap runs |
| `phone-reset/confirm` | `store_specialists.pin_code` | **Plaintext `newPassword`** (reintroduces roster plaintext; does not require profile digits) |

Hub-bridge login-time upgrade updates **only** `store_specialists`. It does **not** clear or rehash `profiles` / `store_profiles`. That explains residual digit mirrors after a successful Master login.

---

## C. Record identity relationships

```
store_specialists f9e36630… (MasterAdmin, store 2587, scrypt1)
        ▲
        │ specialist_id
        │
profiles 0f3b20ce… (super_admin, store 2587, digit pin/pin_code)
        — DUPLICATE / SUPERSEDED mirror of the same operator identity

store_profiles 0b7d86d3… (admin / master_admin, store 1852, digit)
        — ORPHAN relative to current 2587 Master roster
        — no matching store_specialists row on 1852 by username
        — not the active Floor Command operator store
```

Matching username alone does **not** make the `1852` `store_profiles` row interchangeable with the live `2587` MasterAdmin credential.

---

## D. Active vs obsolete classification

| Record | Class | Rationale |
|--------|-------|-----------|
| `profiles` `0f3b20ce…` digit | **C — Duplicated credential superseded by canonical hub roster** | Linked to live Master `f9e36630…` whose roster PIN is already `scrypt1`. Not read for verify. |
| `store_profiles` `0b7d86d3…` digit | **B — Legacy credential no longer consumed** (+ orphan store `1852`) | No auth verify consumer; no matching active specialist on that store. |
| Neither | **A — Active credential requiring migration** | N/A — login already uses roster scrypt. |
| Write-path residue | **D — Unresolved authentication dependency** *(process, not the two rows)* | `reset-pin` / `phone-reset` / hub-bridge link can **reintroduce** plaintext into specialists or profiles if used again. |

---

## E. Safe migration or retirement plan

**Smallest safe correction (recommended next tranche — not executed here):**

1. **Null PIN columns** on the two identified rows only (metadata-gated):
   - `profiles` where `id` prefix `0f3b20ce` AND `specialist_id` prefix `f9e36630` AND digit shape AND linked specialist is already `scrypt1`.
   - `store_profiles` where `id` prefix `0b7d86d3` AND `store_number='1852'` AND username `master_admin` AND digit shape.
2. **Do not** change MasterAdmin `store_specialists` row.
3. **Stop plaintext writes** in the same or immediately following tranche:
   - `upsertStoreProfiles` / `syncAuthProfilePin`: write `hashPin(newPin)` or null PIN fields (prefer hash only if a future reader needs them; otherwise null).
   - `linkAuthUserToSpecialistProfile`: do not copy roster PIN into `profiles` (or copy only canonical hash after reload).
   - `phone-reset/confirm`: write `hashPin(newPassword)` + `pin_hash`, never raw password.
   - `resetHubPin` `ensure_master` insert: stop inserting plaintext `pin_code: newPin`.
4. **Then** inventory again: `store_specialists` + `profiles` + `store_profiles` digit counts = 0.
5. **Only then** set `DEPTSYNC_ALLOW_PLAINTEXT_PIN_VERIFY=0` and later remove the equality branch.

Optional alternate for `profiles` only: overwrite with the linked specialist’s current scrypt string (keeps mirror). Null is smaller and matches “profile PIN not used for verify.”

---

## F. Operator login risks

| Action | Risk to operator login |
|--------|------------------------|
| Null the two profile digit rows | **None** for hub-bridge (verifies roster only) |
| Disable plaintext fallback before write-path fixes | **Medium** — next phone-reset/ensure_master plaintext write would lock that account out of `verifyStoredPin` |
| Disable plaintext fallback after inventory=0 + write fixes | **Low** — roster already scrypt; SHA-256 legacy path remains |
| Touch Master `store_specialists` PIN | **Unauthorized / unnecessary** |

---

## G. Required regression tests (future impl)

1. Hub-bridge login succeeds against scrypt roster when profile PIN columns are null.  
2. `linkAuthUserToSpecialistProfile` does not persist digit plaintext.  
3. `resetHubPin` writes scrypt to specialists; profile sync does not write digit plaintext.  
4. `phone-reset/confirm` stores hash, not raw password.  
5. Targeted SQL clear affects exactly 2 rows (1 profiles + 1 store_profiles) under guards.  
6. With `DEPTSYNC_ALLOW_PLAINTEXT_PIN_VERIFY=0`, scrypt + SHA-256 still verify; digit equality fails.  
7. No credential values in logs.

---

## H. Recommended implementation tranche

**Name:** `DEPTSYNC-SEC-OPS-004-IMPL` (or `AUTH-HARDEN-003`)

**Order:**

1. Fix plaintext **write** paths (`reset-pin`, `phone-reset`, hub-bridge profile link).  
2. Apply narrowly scoped null/clear of the two discovered digit mirrors.  
3. Re-inventory all three tables.  
4. Env-disable plaintext verify.  
5. Follow-on PR: delete equality branch from `verifyStoredPin`.

Do **not** combine plaintext-fallback removal with write-path fixes in a single untested deploy.

---

## I. GO / NO-GO for plaintext fallback removal

| Question | Verdict |
|----------|---------|
| Can the two remaining digit rows be cleared without breaking hub login? | **CONDITIONAL GO** (after authorized SQL with exact-row gates) |
| Can `DEPTSYNC_ALLOW_PLAINTEXT_PIN_VERIFY` be disabled **now**? | **NO-GO** |
| Why | Write paths can still reintroduce digit plaintext into `store_specialists` / profiles; fallback still protects that failure mode. Also env change + code removal not authorized in this discovery. |
| After write-path fixes + digit inventory = 0 across specialists/profiles/store_profiles? | **CONDITIONAL GO** for env disable, then code removal |

**Overall:** Remaining digits are **obsolete mirrors / orphan legacy**, not active login credentials. Safe to retire the **rows** with a small authorized cleanup; **not** safe to remove plaintext fallback until writers stop creating new digit PINs.

---

## Execution boundary confirmation

- Read-only SQL / code inspection only  
- No credential changes  
- No code implementation  
- No commit / push / deploy  

**STOP.**
