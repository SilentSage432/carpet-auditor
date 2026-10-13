# DEPTSYNC-AUTH-002-RELEASE — Authentication Reliability Production Release

**Date:** 2026-10-13  
**Mode:** Controlled production release (security-gated)  
**Application:** https://deptsync-hub.vercel.app  
**Supabase:** `fmeinlwhixngednabhgy`  
**Branch:** `main`  
**Repo:** `SilentSage432/carpet-auditor`  

**Predecessors:**  
- [`DEPTSYNC_AUTH_001_RELIABILITY_AUDIT.md`](./DEPTSYNC_AUTH_001_RELIABILITY_AUDIT.md)  
- [`DEPTSYNC_AUTH_002_IMPLEMENTATION.md`](./DEPTSYNC_AUTH_002_IMPLEMENTATION.md)  

**Boundaries:** No schema migrations · No MasterAdmin / credential resets · No RLS weakening · No AUTH-003 · No MAP-004  

---

## 1. Security review findings

### Verdict: **GO** (with identity-binding harden applied before ship)

| Check | Result | Evidence |
|-------|--------|----------|
| PIN verify precedes session mint | **PASS** | `mintHubBridgeSession` only calls `mintSessionForSpecialist` after `verifyStoredPin` / Master PIN path |
| `generateLink` server-side only | **PASS** | `hub-bridge.ts` is `server-only`; route never returns `hashed_token` / `action_link` |
| Service-role never reaches clients | **PASS** | `createAdminClient` / `SUPABASE_SERVICE_ROLE_KEY` server-only; client uses anon + session tokens only |
| `verifyOtp` bound to verified identity | **PASS** | Mint email = `hub.<specialistId>@deptsync.hub`; post-link `user.id` must equal resolved `userId`; post-`verifyOtp` session `user.id` must match or mint throws |
| Authoritative identity resolution | **PASS** | Specialist loaded from `store_specialists` by id/username; Auth user linked via `profiles.specialist_id` |
| MasterAdmin protected | **PASS** | Public path never bootstraps Master; `isHubMasterPin` → existing master only; bootstrap remains secret-gated |
| Store / role claims | **PASS** | `ensureAuthProfileLinked` keeps `profiles.role` / `store_number` / `specialist_id`; JWT app_metadata synced on write |
| Failed PIN cannot mint | **PASS** | Invalid PIN throws before mint; route returns 401 `"Invalid username or PIN"` |
| Rate limiting effective | **PASS** | `touch_auth_rate_limit` admit before verify; fail-closed; IP-only buckets |
| No account-existence leak on bad PIN | **PASS** | Uniform invalid message for bad user/PIN |
| Hub-gate cookie secure | **PASS** | HttpOnly, Secure (prod), SameSite=lax, HMAC `HUB_GATE_SECRET`, minted only with live JWT |
| Session revocation / logout | **PASS** | `clearAuthSession` clears wall + gate cookie + local Supabase signOut |
| Privilege escalation via generateLink | **PASS (hardened)** | Identity mismatch between link user / session user / PIN-verified specialist aborts mint |
| Partial failure OTP→gate | **ACCEPTABLE** | JWT may persist locally if gate mint fails; UI errors (no redirect loop); next boot can resume with JWT — still requires successful PIN for first mint |
| Concurrent attempts | **PASS** | Rate limit consumes attempt slots; non-idempotent mint not auto-retried client-side |
| Biometric not claimed as independent login | **PASS** | “Resume with fingerprint” + refresh requirement; AUTH-003 deferred |

**No authentication bypass or privilege-escalation path found that warrants STOP.**

---

## 2. Released commit

| Field | Value |
|-------|-------|
| Commit | *(filled after push)* |
| Message | `fix(auth): AUTH-002 reliability — bounded login and slim session mint` |
| Parent | `7161796` (`docs(map): record MAP-003 production release`) |

---

## 3. Deployment ID

| Field | Value |
|-------|-------|
| Vercel deployment | *(filled after deploy)* |
| Environment | Production |
| Creator | *(GitHub → Vercel bot expected)* |

---

## 4. Production alias verification

| Check | Result |
|-------|--------|
| Alias | https://deptsync-hub.vercel.app |
| Serves AUTH-002 | *(filled after deploy — SW cache / login 200)* |

---

## 5. Test results

| Suite | Result |
|-------|--------|
| `lib/auth/auth-002.reliability.test.ts` | **PASS** (8) |
| AccessGate / hub bootstrap decision tests | **PASS** |
| SEC-OPS-007B/C/E/F/G | **PASS** |
| AUTH-HARDEN-001 | **PASS** (28) |
| Hub master PIN / bootstrap-admin contracts | **PASS** |
| ALIGN-SEC-001/002 readiness + seed credentials | **PASS** |
| Walkthroughs + operational-sections authz | **PASS** |
| **Focused total** | **17 files / 146 tests PASS** |
| `npm run typecheck` | **PASS** |
| `npm run build` | **PASS** |
| `eslint` on AUTH-002 file set | **PASS** |
| Repo-wide `npm run lint` | **FAIL** (pre-existing outside AUTH-002; not blocking this release) |

---

## 6. Authentication regression results

| Scenario (automated / contract) | Result |
|---------------------------------|--------|
| PIN path still rate-limited before verify | PASS |
| Invited / suspended rejected | PASS (source contracts) |
| Master PIN does not bootstrap | PASS |
| Edge allows `/api/auth/hub-bridge` without gate cookie | PASS |
| Protected HTML requires gate | PASS |
| JWT-first roster (no anon) | PASS |
| Bounded fetch timeout clears | PASS |
| No per-login password rotate | PASS |
| Identity mismatch aborts mint | PASS |

Interactive MasterAdmin PIN login: **operator phone acceptance** (this report §10).

---

## 7. Performance evidence

| Item | Evidence |
|------|----------|
| Client bound | 15s `AUTH_REQUEST_TIMEOUT_MS` |
| Slim mint | `generateLink` + `verifyOtp`; no per-login `updateUserById` password / `signInWithPassword` |
| Safe timings field | hub-bridge JSON `timings.{resolve_user_ms,mint_session_ms,total_ms}` (no secrets) |
| Production success E2E ms | **Not measured** without operator credentials |

---

## 8. MasterAdmin preservation

| Check | Result |
|-------|--------|
| No credential reset | **Yes** |
| No identity rewrite in release SQL | **N/A — no migrations** |
| Public hub-bridge still cannot bootstrap Master | **Yes** |
| Operator PIN / scrypt credential untouched by this release | **Yes** |

---

## 9. Production verification

*(Filled after deploy — unauthenticated probes only.)*

| Probe | Expected | Result |
|-------|----------|--------|
| `GET /login` | 200 | pending |
| `GET /` | 307 → `/login` | pending |
| `GET /dashboard` | 307 → `/login` | pending |
| `POST /api/auth/hub-bridge` `{}` | 400 | pending |
| `POST /api/auth/hub-bridge` invalid PIN | 401 | pending |
| `POST /api/auth/gate` unauth | 401 | pending |
| `GET /sw.js` | contains `deptsync-shell-v8-auth-002` | pending |

No repeated credentialed login attempts. No secrets logged.

---

## 10. Phone acceptance steps

1. Open Floor Command: https://deptsync-hub.vercel.app  
2. Perform **one** normal PIN login (`master_admin` + your PIN).  
3. Confirm login completes promptly (no multi-minute hang).  
4. Confirm the button does **not** stay on “Signing in…” forever.  
5. Close and reopen the browser / PWA.  
6. Confirm valid-session resume (or a clear unlock/PIN prompt — not a stuck splash).  
7. If “Resume with fingerprint” appears, try it once.  
8. If fingerprint is unavailable/expired, confirm a clear PIN fallback message.  
9. Open a protected page (Floor / Overview) and confirm it works.  
10. Logout and confirm you return to sign-in and stay locked out of protected pages.  

**Do not share your PIN, tokens, or screenshots of secrets.**

---

## 11. AUTH-003 remaining requirements

Independent biometric login that **mints** a server session still requires:

- Server-generated WebAuthn challenge  
- Server-side assertion verification  
- Credential registry bound to user + revocation  
- Replay protection, origin/RP-ID checks, rate limits  
- Proper session issuance without depending on a pre-existing JWT  

**Do not begin AUTH-003 in this release tranche.**

---

## 12. GO / NO-GO release result

| Gate | Result |
|------|--------|
| Security preflight | **GO** |
| Reliability preflight | **GO** |
| Tests / typecheck / build | **GO** |
| Scope (AUTH-002 only; no unrelated SEC-OPS-010 / tmp) | **GO** |
| Migrations / credential resets | **None** |
| Deploy | *(pending push)* |
| Operator acceptance | **PENDING** |

**Overall: GO TO DEPLOY** — operator phone acceptance remains the final product confirmation.

---

**STOP AFTER RELEASE.** Do not begin AUTH-003. Do not resume MAP-004.
