# DEPTSYNC-SEC-OPS-010 — Plaintext PIN Fallback Retirement

**Date:** 2026-10-11  
**Mode:** Controlled production configuration release  
**Canonical Supabase:** `fmeinlwhixngednabhgy`  
**Application:** https://deptsync-hub.vercel.app  
**Expected app commit:** `dbf6847` (SEC-OPS-009)  
**Expected app deploy:** `As1U36FuRe89XwQrtkVDai9YgR6y`  
**References:** SEC-OPS-008 · SEC-OPS-009  

---

## Executive closeout

**Configuration change was NOT applied.**

Prechange security gates for inventory, deploy identity, writer closure, and unauthorized credential-update rejection **passed**.  

Production Vercel environment mutation **could not be executed**: the local Vercel CLI / API credential (`com.vercel.cli` auth token) returns `invalidToken` / `403 Not authorized`. No alternate authenticated Vercel configuration channel was available in this session without interactive operator login.

| Action | Verdict |
|--------|---------|
| Prechange verification | **PASS** |
| Credential-update authorization review | **PASS** (identity-bound; see below) |
| Set `DEPTSYNC_ALLOW_PLAINTEXT_PIN_VERIFY=0` | **NOT PERFORMED — BLOCKED** |
| Redeploy for flag pickup | **NOT PERFORMED** |
| Runtime fallback-disabled evidence | **NOT AVAILABLE** (flag unchanged) |
| Operator login verification | **OPERATOR LOGIN PENDING** (N/A until flag change) |
| Overall closeout | **NO-GO — retirement incomplete** |

**STOP.** Operator must re-authenticate Vercel (`vercel login` or dashboard) and authorize a follow-on config-only tranche.

---

## 1. Prechange verification

### Production application identity

| Check | Result |
|-------|--------|
| SEC-OPS-009 commit `dbf6847` Vercel status | **success** → `As1U36FuRe89XwQrtkVDai9YgR6y` |
| Git tip vs app | Tip `9246750` is **docs-only** after `dbf6847` (journals + SEC-OPS-009 report). Auth binary unchanged. |
| Latest GitHub Production deployment | `9246750` (docs deploy after app hotfix) — app auth remains SEC-OPS-009 |

### Credential inventory (read-only, no values)

Project `fmeinlwhixngednabhgy`:

| Table | Finding |
|-------|---------|
| `store_specialists` (35) | **scrypt1 = 1**, null = 34, SHA-256 = 0, digit = 0, unknown = 0 |
| MasterAdmin `f9e36630…` | active / store `2587` / **scrypt1** `pin_code`+`pin_hash` |
| `profiles` / `store_profiles` | empty_string / null only — no plaintext / unknown |

### Writer + tests

| Check | Result |
|-------|--------|
| SEC-OPS-009 server writer (`/api/auth/update-credentials` → `updateHubCredentials` → `rosterSecurePinFields`) | Present in `dbf6847` tree |
| `sec-ops-009` + `auth-harden-001` tests | **43/43 PASS** |
| Public hub-bridge bad PIN | **401** |
| Anon `store_specialists` | **401** `42501` |

---

## 2. Credential-update authorization review

Source: `app/api/auth/update-credentials/route.ts` + `resolveStoreOpsActor` + `updateHubCredentials`.

| Requirement | Enforcement | Evidence |
|-------------|-------------|----------|
| Authenticated caller identity | Bearer → `getRequestAuthUser` → `public.profiles` via `resolveStoreOpsActor` (not client role headers) | Route lines 73–77; `auth-server.ts` |
| Permitted credential-update authority | Own `specialistId` **or** `super_admin` **or** verified `current_password` | Route 75–94; writer 454–463 |
| Store ownership / scope | **Identity-bound:** non–super-admin may only target `actor.specialistId` from profile (specialist has one store). No separate `actor.storeNumber === target.store_number` compare; cross-store update by non-admin requires forging profile `specialist_id` (server-loaded). Super-admin may update any (intentional). | Adequate for single-operator Floor Command |
| Permitted target identity | Body `specialist_id` must match actor for non–super-admin; else **403** | Route 89–94 |
| Reject unauthorized | No JWT + no current_password → **401**; wrong current_password → **401** | Live smoke confirmed both |

**Live negative probes (no MasterAdmin PIN guessing):**

| Request | Status |
|---------|--------|
| update-credentials without auth | **401** `Unauthorized — sign in with Hub Auth, or provide current_password` |
| update-credentials + wrong `current_password` against Master id | **401** `Current PIN is incorrect` |

**JWT validity alone is not sufficient:** route requires specialist ownership / super_admin / current-password proof after actor resolution.

**Gate decision:** Boundary **verified — proceed was authorized** from an authz standpoint. Stop occurred solely on Vercel credential failure.

---

## 3. Environment configuration (attempted)

| Question | Finding |
|----------|---------|
| Flag already exists in Production? | **Unknown** — Vercel API/CLI unauthorized (`invalidToken`) |
| Effective production value | Code default when unset: **enabled** (`plaintextPinVerifyEnabled`, `lib/auth-token.ts` 173–178) |
| Preview/development differ? | **Unknown** (API blocked) |
| Runtime reads flag server-side? | **Yes** — `process.env.DEPTSYNC_ALLOW_PLAINTEXT_PIN_VERIFY` in `verifyStoredPin` |
| Redeploy required after change? | **Yes** — Next.js serverless env is injected at deploy/runtime; Vercel Production env changes require redeploy/restart to be effective |

**Linked project (local `.vercel/project.json`, non-secret):**

- `projectId`: `prj_OztuUVQCkIl1vO5FdsguTxeyrxqr`
- `orgId`: `team_fmAiSj3kflwi5soiiMLq67RY`

**Attempted mechanism:** Vercel CLI / REST API using existing local CLI auth store → **403 invalidToken**. Interactive `vercel login` requires operator browser SSO (not completed).

**No unrelated env vars were listed or modified. No secrets printed in this report.**

---

## 4. Deployment

| Step | Result |
|------|--------|
| Set Production `DEPTSYNC_ALLOW_PLAINTEXT_PIN_VERIFY=0` | **Not performed** |
| Redeploy `dbf6847` | **Not performed** |
| New deployment id | **N/A** |
| Effective fallback-disabled runtime | **N/A** |

---

## 5. Security regression verification

Executed **prechange / baseline only** (flag still default-on in production):

| Check | Result |
|-------|--------|
| Inventory scrypt1 / no plaintext / no unknown | **Pass** |
| Unauthorized credential update rejected | **Pass** |
| Anon roster denied | **Pass** |
| Hub-bridge bad PIN 401 | **Pass** |
| Automated matrix: scrypt/SHA-256 with flag=`0`; plaintext fails when disabled | **Pass** (unit tests — not production runtime) |
| Production plaintext equality fails under flag=`0` | **Not verified** — flag not set |
| Rate limiting / AccessGate / hub bootstrap | Not re-mutated; baseline containment OK |

Negative production PIN probing against MasterAdmin: **not performed** (forbidden).

---

## 6. Operator login verification

**OPERATOR LOGIN PENDING**

No production login claim is made. Operator PIN was not requested, retrieved, displayed, reset, or changed.

After a successful follow-on env disable + redeploy, the operator must personally confirm Floor Command login with the existing MasterAdmin PIN.

---

## 7. Rollback readiness (prepared; unused)

Because the flag was **not** changed, rollback was **not** required.

### Prepared procedure (for the follow-on tranche)

1. **Stop** further auth changes.  
2. In Vercel Project → Settings → Environment Variables → Production:  
   - Remove `DEPTSYNC_ALLOW_PLAINTEXT_PIN_VERIFY`, **or** set to `1`.  
3. Redeploy the last known-good app commit (`dbf6847` / `As1U36FuRe89XwQrtkVDai9YgR6y` or newer docs tip with same app binary).  
4. Confirm hub-bridge still 401 on bad PIN; anon still 42501; Master scrypt1 inventory unchanged.  
5. Operator re-login.  

**Do not:** weaken RLS, grant anon SELECT, reset PINs, or reintroduce client `pin_code` writers.

---

## 8. Operator completion checklist (follow-on)

When Vercel access is restored:

1. Confirm Production env: create/update `DEPTSYNC_ALLOW_PLAINTEXT_PIN_VERIFY` = `0` (Production only, unless Preview should match).  
2. Redeploy application commit `dbf6847` (or current tip if still docs-only atop it).  
3. Prove effective runtime (not dashboard alone), e.g.:  
   - deployment created **after** env save;  
   - unit/regression suite with flag=`0` still green;  
   - operator successful scrypt login.  
4. Re-inventory credentials (expect unchanged).  
5. Record deployment id + **OPERATOR LOGIN CONFIRMED** in an amended SEC-OPS-010 closeout or SEC-OPS-010A note.  
6. Keep equality-branch **code** until a later soak/removal tranche.

---

## GO / NO-GO

| Item | Verdict |
|------|---------|
| Safe to disable plaintext fallback **in principle** (inventory + writers + tests) | **GO** (unchanged from SEC-OPS-009) |
| This tranche’s production configuration retirement | **NO-GO — incomplete** (Vercel auth blocked) |
| Source/DB/PIN/RLS changes | **Not performed** (correct) |

---

## Boundaries honored

- No production SQL  
- No PIN resets / credential modifications  
- No anon grants / RLS weakening  
- No authentication redesign / unrelated features  
- No plaintext fallback disable applied  
- No secrets exposed in this document  

**STOP.**
