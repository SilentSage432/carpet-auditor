# DEPTSYNC-ALIGN-SEC-003 — Final Production Release Gate

**Status:** READINESS GATE COMPLETE  
**Date:** 2026-10-10  
**Deployment / commit / push / production mutation:** NOT AUTHORIZED by this document  
**Recommendation:** **CONDITIONAL GO** (see §I)

---

## A. Environment readiness

### Operator-confirmed (this tranche)

| Variable | Status | Notes |
|----------|--------|-------|
| `HUB_GATE_SECRET` | **OPERATOR CONFIRMED** set in Vercel Production | Value never requested, displayed, or logged |
| `BOOTSTRAP_SECRET` | **OPERATOR CONFIRMED** set in Vercel Production | Value never requested, displayed, or logged |

### Existing variables — remote read unavailable

| Variable | Status |
|----------|--------|
| `HUB_MASTER_PIN` | **OPERATOR CONFIRMATION REQUIRED** |
| `CRON_SECRET` | **OPERATOR CONFIRMATION REQUIRED** |
| `NEXT_PUBLIC_SUPABASE_URL` | **OPERATOR CONFIRMATION REQUIRED** |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **OPERATOR CONFIRMATION REQUIRED** |
| `SUPABASE_SERVICE_ROLE_KEY` | **OPERATOR CONFIRMATION REQUIRED** |

Vercel CLI unavailable in this environment. Local `.env.local` is **not** used as Production evidence.

**Condition for GO:** operator affirms the five existing Production variables remain set (checkbox in §H) immediately before deploy.

---

## B. Auth route security matrix (`/api/auth/*`)

Edge: all `/api/auth/*` are **edge-public** (intentional). Handler auth is authoritative.

| Route | Purpose | Session required? | Handler auth | Privileged effect | Rate limit | Input validation | Unauth intentional? | Risk note |
|-------|---------|-------------------|--------------|-------------------|------------|------------------|---------------------|-----------|
| `POST /hub-bridge` | PIN → Supabase session | No | Valid roster/Master PIN (service role verify) | Mints Auth session | **None** | username/id + pin required | **Yes** (login) | Residual: PIN online guessing — pre-existing |
| `POST /gate` | Mint hub gate cookie | **Yes** (Supabase JWT) | `getRequestAuthUser` | Sets HttpOnly gate cookie | None | JWT present; secret configured | No | Fail-closed without `HUB_GATE_SECRET` |
| `DELETE /gate` | Clear gate cookie | No | None | Clears cookie only | None | — | **Yes** (logout) | Low risk |
| `POST /bootstrap-admin` | Master recovery seed | No | **Bearer `BOOTSTRAP_SECRET`** | Creates/resets Master; may return PIN + session | **None** | Secret + env ready | Edge-public; **secret required** | Protect secret; do not share; returns PIN by design |
| `GET /bootstrap-admin` | Status / optional force | No | **Bearer `BOOTSTRAP_SECRET`** | `?force=1` re-runs bootstrap | None | Secret | Same | Same |
| `POST /redeem-invite` | QR pair preview/redeem | No | Signed pairing token (+ PIN to redeem) | Sets PIN + session + gate | None | Token; PIN 4–6 digits | **Yes** (pairing) | Token possession = capability |
| `GET /verify/[token]` | Consume invite/reset link | No | One-time token hash | Sets short-lived verify cookie | None | Token load/expiry | **Yes** | Single-use consume |
| `GET /verify` | Restore setup preview | Verify cookie | HMAC verify cookie | Read preview | None | Cookie | No | — |
| `POST /verify` | Complete PIN from cookie | Verify cookie | HMAC verify cookie | Sets PIN + session + gate | None | PIN fields | No | — |
| `POST /pin-reset/request` | SMS/link PIN reset | No | Registered phone | Issues reset token + SMS | **None** | Phone | **Yes** | 404 can hint phone presence; `test_mode` harness can return raw token if flagged |
| `POST /phone-reset/lookup` | Pre-SMS phone check | No | None (service role read) | Boolean existence | **None** | Phone E.164 | **Yes** | Enumeration signal (404 vs ok) — pre-existing |
| `POST /phone-reset/confirm` | OTP → new password/PIN | Phone OTP Bearer | `getUser(token)` + phone match | Updates PIN; links profile | None | Phone + password ≥6 | No | — |
| `POST /reset-pin` | Direct Hub PIN change | JWT **or** `current_pin` | Actor / current PIN / super_admin | Writes new PIN | None | 4-digit new PIN; self vs admin | Partially | Self-service requires current PIN knowledge |

### Privileged-without-sufficient-auth?

| Finding | Verdict |
|---------|---------|
| Bootstrap without `BOOTSTRAP_SECRET` | **Blocked** (ALIGN-SEC-001) |
| Gate mint without JWT / without secret | **Blocked** |
| Hub-bridge without PIN | **Blocked** (401) |
| Cron secret as bootstrap | **Blocked** |
| Public PIN-reset / phone-lookup / hub-bridge without rate limits | **Residual accepted risk** (pre-existing; not introduced by SEC-001) — not a deploy blocker for this gate |

No new handler was found that grants Master/admin power without a dedicated secret, valid PIN, valid invite/reset token, or authenticated actor.

---

## C. Operator login verification (**LOCAL**)

| Check | Result |
|-------|--------|
| Sequence PIN → hub-bridge → session → gate → protected access | Code path intact (`AccessGate.enterWorkspace` → `syncHubGateCookie`) |
| Invalid credentials | Hub-bridge 401 path |
| Missing `HUB_GATE_SECRET` | Fail closed (mint null / 503) |
| Expired / old-secret cookies | Rejected; remint restores |
| Fresh authentication possible | Yes, when secrets configured |
| Production browser login | **OPERATOR** post-deploy |

---

## D. Recovery verification (**LOCAL**)

| Check | Result |
|-------|--------|
| HTTP bootstrap without hub cookie | Edge allows |
| Requires `BOOTSTRAP_SECRET` | Pass |
| Rejects invalid / CRON substitute | Pass |
| Local `scripts/bootstrap-admin.mjs` | Usable with service role + `HUB_MASTER_PIN` |
| Production recovery invoked | **Not done** |

---

## E. Cron verification (**LOCAL**)

| Check | Result |
|-------|--------|
| `vercel.json` Sunday `0 11 * * 0` → `/api/cron/weekly-rotation` | Unchanged |
| Edge allows cron without gate cookie | Pass |
| Handler requires `CRON_SECRET` | Pass |
| Production cron invoked | **Not done** |

---

## F. Test results

| Check | Result |
|-------|--------|
| Typecheck | Pass |
| Security / readiness tests (SEC-001/002 + master PIN) | **38/38** |
| Full suite | **1325/1325** |
| Production build | Pass |
| Lint | **135 problems (103 errors, 32 warnings)** — pre-existing; separate from this gate |

---

## G. Remaining blockers / conditions

1. **OPERATOR CONFIRMATION REQUIRED** for the five existing Production env vars (§A).  
2. Residual public-auth rate-limit / phone-enumeration debt — **accepted for this release**, track later hardening.  
3. Post-deploy **fresh login** mandatory (prior fallback-signed cookies will not verify under dedicated `HUB_GATE_SECRET`).  
4. Production RLS script still recommended after deploy (not a code gate).

---

## H. Deployment and rollback checklist

**Do not execute from this tranche — operator/CI only after CONDITIONAL GO conditions met.**

### Pre-flight (operator)

- [ ] Re-confirm Production: `HUB_GATE_SECRET`, `BOOTSTRAP_SECRET` still set  
- [ ] Confirm Production: `HUB_MASTER_PIN`, `CRON_SECRET`, Supabase URL / anon / service role still set  
- [ ] Confirm `BOOTSTRAP_SECRET` ≠ `CRON_SECRET`  
- [ ] Ready to perform immediate fresh login after deploy  

### Commit / push (when operator authorizes separately)

1. Review `git status` / diff (ALIGN-SEC-001 code + docs + tests; exclude secrets / `.env.local`)  
2. Commit on intended branch with message covering security stabilization  
3. Push to remote tracking branch that feeds Vercel Production (or merge via PR per your workflow)  

### Vercel deploy confirmation

4. Wait for Production deployment Ready  
5. Confirm Deployment Environment = Production  
6. Confirm Cron job still listed for `/api/cron/weekly-rotation`  

### Post-deploy smoke (operator device)

7. Sign out / clear site data if needed  
8. Fresh PIN login → lands on Floor/dashboard  
9. Confirm app chrome loads (gate cookie minted)  
10. Exercise one protected API (e.g. Floor refresh, Map load, or Settings read)  
11. Optional: confirm logged-out visit redirects to `/login`  

### Rollback (if smoke fails)

12. Vercel → Deployments → promote/rollback to **pre-ALIGN-SEC-001** deployment  
13. Perform **fresh login** again (cookies may not transfer across secret/code eras)  
14. If gate mint fails on SEC-001 build: do **not** delete `HUB_GATE_SECRET`; fix value or rollback code  
15. HTTP recovery remains available with Bearer `BOOTSTRAP_SECRET` without a hub cookie  

---

## I. Final decision

# **CONDITIONAL GO**

**Cleared vs SEC-002:** Operator confirmed Production `HUB_GATE_SECRET` and `BOOTSTRAP_SECRET`.

**Still required before you authorize commit/deploy:**

1. Affirm the five existing Production variables remain set.  
2. Accept residual public-auth rate-limit / enumeration debt as out-of-scope for this release.  
3. Execute §H smoke (fresh login + one protected API) immediately after deploy.

Local security implementation, tests, and build are ready. This document does **not** authorize deploy, commit, push, or production changes.

---

*End of ALIGN-SEC-003.*
