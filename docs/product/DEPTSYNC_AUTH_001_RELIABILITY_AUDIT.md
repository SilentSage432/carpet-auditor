# DEPTSYNC-AUTH-001 — Authentication Reliability and Experience Audit

**Date:** 2026-10-13  
**Mode:** Focused root-cause investigation (read-only)  
**Application:** https://deptsync-hub.vercel.app  
**Supabase:** `fmeinlwhixngednabhgy`  
**Framework:** Next.js 16 / React 19 / Supabase Auth + Postgres  
**Operator surface:** Floor Command (Android Chrome / PWA)  
**Operator identity:** Protected MasterAdmin (`master_admin`) — **not modified**  
**Repo tip at audit:** `7161796`  

**Boundaries honored:** No implementation · No migrations · No production mutations · No deployment · No credential submission · No MasterAdmin reset · No secrets exposed  

**Related prior work:** SEC-OPS-007B/C/D/E/F/G · AUTH-HARDEN-001 · SEC-OPS-008 · SEC-OPS-010A  

---

## 1. Executive summary

Floor Command authentication is a **three-layer stack** that operators experience as one login:

1. **Hub wall session** — `localStorage` (`deptsync_auth_session`), 8h idle  
2. **Supabase Auth JWT** — minted by `POST /api/auth/hub-bridge`, persisted in `localStorage`, auto-refresh enabled  
3. **Hub gate cookie** — HTTP-only HMAC cookie (`deptsync_hub_gate`), 8h, enforced by `proxy.ts`

Username/PIN login is slow because every successful PIN path **re-mints** a Supabase user password, re-links profiles/metadata, signs in, then mints the gate cookie — many sequential network hops with **no client timeout**.

Fingerprint login is **WebAuthn platform authenticator + localStorage binding only**. It does **not** create a server session. It only proceeds when a Supabase JWT is already present. When the JWT expires or is cleared, fingerprint “works” (sensor succeeds) then fails with a PIN request — matching “works temporarily, then becomes unreliable.”

The UI can remain on **“Signing in…” indefinitely** because `AuthWall` sets `busy=true` around `establishHubBridgeSession` / `finishLogin`, and the client `fetch` to hub-bridge has **no AbortSignal / timeout**. Any hung serverless mint or stalled mobile network leaves the button stuck until the tab is killed.

Production read-only probes (this audit): `/login` **200** (~130ms), unauth `/` **307→/login**, empty hub-bridge **400**, unauth gate **401**, invalid-PIN hub-bridge **401** in **~1.1–1.3s**, service worker `deptsync-shell-v7-auth-boot`. Successful MasterAdmin login was **not** timed (no credentials submitted). Vercel function logs and current deployment SHA via CLI were **unavailable** (local Vercel CLI auth expired per SEC-OPS-010A; GitHub deployments API forbidden from this environment).

**Verdict: CONDITIONAL GO** for a dedicated reliability tranche that simplifies the login critical path, bounds loading states, and makes biometric restore a real session resume — without weakening MasterAdmin, RLS, or gate security.

---

## 2. Current authentication architecture

### 2.1 Surfaces

| Surface | Role |
|---------|------|
| `/login` → `AccessGate` → `AuthWall` | Public sign-in / unlock / setup |
| `/` hub page | JWT-first bootstrap; redirects to `/login` when wall session missing |
| Workflow routes (`SessionGate`) | Require wall session; redirect to `/login` if missing/expired |
| `proxy.ts` | Edge gate: public auth paths open; everything else needs valid hub-gate cookie |
| `POST /api/auth/hub-bridge` | Canonical PIN verify + Supabase session mint |
| `POST /api/auth/gate` | Mint/clear HTTP-only hub-gate cookie from live JWT |
| `lib/biometric-auth.ts` | Device-local WebAuthn credential id ↔ specialist id |

### 2.2 Trust boundaries (confirmed)

| Layer | Authority | Storage |
|-------|-----------|---------|
| PIN verify | Server service-role on `store_specialists` via `verifyStoredPin` | DB hashes (scrypt1 for MasterAdmin per SEC-OPS-008) |
| Store Ops API actor | Supabase JWT → `profiles` (`resolveStoreOpsActor`) | Auth cookies / Bearer |
| Edge crawl/session gate | HMAC hub-gate cookie (`HUB_GATE_SECRET`) | HTTP-only cookie |
| Hub wall UX session | Client `deptsync_auth_session` | `localStorage` |
| Biometric | Local WebAuthn assertion; **not** server auth | `localStorage` key `deptsync_biometric_credential` |

Client `findSpecialistByLogin` / `verifyPin` are **not** Store Ops authority. On cold `/login`, roster is often empty; PIN always goes through hub-bridge.

### 2.3 MasterAdmin resolution (confirmed)

```
username master_admin (+ aliases)
  → hub-bridge loadSpecialistByLogin / specialist_id
  → verifyStoredPin against store_specialists
  → OR isHubMasterPin(env HUB_MASTER_PIN) → findExistingMasterSpecialist()
  → mintSessionForSpecialist
  → ensureAuthUserForSpecialist (profiles.specialist_id link)
  → linkAuthUserToSpecialistProfile (profiles.role = super_admin; JWT app_metadata role = master_admin)
  → rotate random Auth password + signInWithPassword
  → client setSession + startAuthSession + syncHubGateCookie
```

Public hub-bridge **does not bootstrap** a new MasterAdmin (SEC-OPS / hub-master-pin contract). Recovery remains `POST /api/auth/bootstrap-admin` (`BOOTSTRAP_SECRET`).

---

## 3. Exact login request sequence

### 3.1 Cold username/PIN login (operator screenshot path)

```
1. GET /login                          (public; ~130ms observed)
2. AccessGate boot                     (no wall session → mode=login, roster=[])
3. User submits username + PIN
4. AuthWall busy = true → "Signing in…"
5. findSpecialistByLogin(empty roster) → null
6. POST /api/auth/hub-bridge
     body: { username, pin, store_number? }
7. Server:
     a. touch_auth_rate_limit(attempt)     // fail-closed RPC
     b. load specialist (username / scan)
     c. verifyStoredPin / Master PIN path
     d. optional pin upgrade persist
     e. ensureAuthUserForSpecialist
     f. admin.updateUserById(new random password)   // EVERY login
     g. linkAuthUserToSpecialistProfile (+ claim roster)
     h. signInWithPassword(email, password)
     i. touch_auth_rate_limit(success)
8. Client supabase.auth.setSession(tokens)
9. finishLogin → (optional biometric enroll prompt)
10. onAuthenticated → startAuthSession
      - write localStorage wall session
      - markWorkspaceUnlocked (sessionStorage)
      - void syncHubGateCookie()   // also awaited again in AccessGate
11. AccessGate.enterWorkspace:
      - await syncHubGateCookie()
          → getSession → POST /api/auth/gate (Bearer) → Set-Cookie hub gate
      - router.replace(/dashboard)   // default next
12. proxy allows /dashboard with gate cookie
13. SessionGate reads wall session → workspace
14. AuthWall finally: busy = false
```

### 3.2 Returning user with wall session + JWT

```
AccessGate: getSession → fetchSpecialists (JWT) → decideAccessGateBoot(enter)
  → syncHubGateCookie → router.replace(destination)
```

### 3.3 Returning user with wall session, no JWT

```
decideAccessGateBoot → unlock (reason: no_jwt)
  → PIN/password via hub-bridge again
  → biometric may show but requires JWT (see §5)
```

### 3.4 Unnecessary / duplicated work (confirmed)

| Issue | Evidence |
|-------|----------|
| Password rotated on **every** successful mint | `mintSessionForSpecialist` always `updateUserById` + `signInWithPassword` |
| Profile link called multiple times per mint | `ensureAuthUser…` + again inside `mintSessionForSpecialist` |
| Gate cookie sync fired twice on success path | `startAuthSession` voids `syncHubGateCookie`; `enterWorkspace` awaits it again |
| Cold login cannot use local roster pre-check | AccessGate clears roster when session missing |
| Possible `listUsers({ perPage: 1000 })` on auth-user collision | `ensureAuthUserForSpecialist` fallback after `createUser` error |
| Login alias fallback may `select` up to 200 active specialists | `loadSpecialistByLogin` when username miss |

---

## 4. Evidence-backed root causes

Legend: **CONFIRMED** = code/production probe · **HYPOTHESIS** = consistent with symptoms, not proven on operator device this session.

### RC-1 — Unbounded “Signing in…” (CONFIRMED capability; HYPOTHESIS for current lockout)

- `AuthWall.handleLogin` sets `busy` until `establishHubBridgeSession` / `finishLogin` settle.  
- `hub-bridge-client` `fetch` has **no timeout / AbortSignal**.  
- Server mint path is long and sequential; mobile networks can stall without rejecting.  
- **Therefore the UI can remain in loading state indefinitely** until navigation away or process kill.  
- `finally { setBusy(false) }` only runs when the promise settles — hang ⇒ stuck label.

### RC-2 — PIN login critical path is inherently heavy (CONFIRMED)

Successful mint always includes rate-limit RPC + roster verify + Auth password rotate + profile/metadata upsert + password sign-in + client `setSession` + gate mint. Invalid-PIN reject alone is already **~1.1–1.3s** from this environment. Success path must be longer; operator “consistently slow” is expected under current design.

### RC-3 — Biometric is not server authentication (CONFIRMED)

`authenticateWithBiometric` returns the **stored specialist id** after a local WebAuthn assertion. AuthWall then requires `supabase.auth.getSession().access_token`. No hub-bridge call. Challenge is **client-generated** (not server-verified). This is “unlock local identity,” not “mint session.”

### RC-4 — Fingerprint works briefly then fails (CONFIRMED mechanism)

After PIN login, JWT + refresh token live in `localStorage` with `autoRefreshToken: true`. Biometric succeeds while JWT (or refresh) remains valid. When JWT/refresh is gone (idle wipe, signOut, storage clear, refresh failure, multi-day gap), biometric still unlocks the device credential but AuthWall shows:

> “Fingerprint unlocked the Hub — enter your PIN/password once to unlock Store Ops.”

UI copy advertises **8h idle** for the wall session; biometric silently depends on a **shorter / independent** Supabase Auth lifecycle. That mismatch produces “unreliable fingerprint.”

### RC-5 — Dual TTL / dual storage causes repeated re-auth (CONFIRMED)

| Artifact | TTL / lifetime |
|----------|----------------|
| Wall session | 8h idle (`AUTH_SESSION_TIMEOUT_MS`) |
| Hub gate cookie | 8h (`HUB_GATE_TTL_MS`) |
| Tab unlock flag | `sessionStorage` — **lost on PWA/browser restart** |
| Supabase access token | Provider default (typically ~1h) + refresh token |
| Biometric record | Until localStorage cleared / store mismatch hide |

AccessGate **never auto-enters** without JWT (`reason: no_jwt` → unlock). PWA restart often preserves localStorage wall session but still forces unlock if JWT refresh fails — feels like “I just logged in yesterday.”

### RC-6 — Post-login navigation can fail closed without clearing operator confusion (CONFIRMED partial)

`enterWorkspace` **ignores** `syncHubGateCookie()` boolean. If gate mint fails (503 secret, 401 race before `setSession` visible to gate route), `router.replace('/dashboard')` still runs → `proxy` redirects back to `/login`. Operator may see splash ↔ login churn rather than a clear error. Distinct from “Signing in…” but compounds lockout perception.

### RC-7 — Rate limit amplifies retry storm (CONFIRMED policy)

Hub-bridge admits via shared IP bucket (**8 attempts / 15 minutes**, fail-closed). Stuck UI + operator retries consume slots. After limit: **429** with “Too many sign-in attempts.” Limiter infra failure: **503**. This can make a slow/hung path become a hard temporary lockout **without** incorrect PIN.

### RC-8 — Service worker (LOW risk for POST hang; residual shell risk)

`public/sw.js` uses network-only for `/api/*` and Supabase hosts; navigations are network-first with cache fallback. Unlikely to hang POST hub-bridge. Stale HTML shell possible briefly after deploy (`CACHE_VERSION = deptsync-shell-v7-auth-boot` confirmed live).

### RC-9 — Prior splash infinite-boot bug (HISTORICAL; mitigated in code)

SEC-OPS-007C documented permanent “Loading DeptSync secure session…” when roster fetch threw. SEC-OPS-007D/007G added fail-closed try/catch + JWT-first fetch. Current `AccessGate` / hub page match that repair. Screenshot evidence (“Signing in…”) points to AuthWall busy path, not splash — unless operator conflates loading states.

---

## 5. Biometric lifecycle findings

| Question | Finding | Confidence |
|----------|---------|------------|
| WebAuthn / passkeys? | Yes — `navigator.credentials.create/get`, platform authenticator, `userVerification: "required"` | CONFIRMED |
| Unlock local credentials only? | Yes — stores credentialId + specialistId in `localStorage` | CONFIRMED |
| Creates server session? | **No** | CONFIRMED |
| Registration | After successful PIN login if platform available and no binding for specialist | CONFIRMED |
| Persistence | `localStorage` only; hidden (not deleted) on store-number mismatch | CONFIRMED |
| Browser / PWA restart | Credential usually survives; JWT may not → PIN required | CONFIRMED mechanism |
| App deployment | Same hostname OK; different host breaks `rpId` | CONFIRMED |
| Stale credential | Missing roster match / inactive → clear storage + error | CONFIRMED |
| Failure / cancel | `NotAllowedError` → “cancelled”; other → message | CONFIRMED |
| Why temporary then stops | JWT/session gone while WebAuthn binding remains | CONFIRMED |

**Security note:** Client-side WebAuthn challenge without server verification is acceptable only as a **device UX accelerator** atop an existing JWT — never as sole auth. Do not store raw PINs for biometric convenience.

---

## 6. Session lifecycle findings

| Scenario | Behavior |
|----------|----------|
| Valid wall + JWT + roster | Auto-enter workspace (AccessGate / hub) |
| Valid wall, expired/missing JWT | Unlock UI (PIN); biometric usually insufficient |
| Expired wall (8h idle) | Full login; wall cleared |
| Browser / PWA restart | localStorage may keep wall + JWT + biometric; sessionStorage unlock lost; JWT refresh may fail → unlock |
| Network interruption mid-login | Possible indefinite “Signing in…” (RC-1) |
| Deployment | Gate/JWT remain if secrets stable; SW may briefly serve old shell |
| Biometric failure | PIN fallback on same form |
| Logout | Clears wall, gate cookie, local Supabase session, appliance unresolved queue |
| Idle expiration | 8h touch watchdog on hub `gate=======ready` |

**Why returning users re-authenticate often:** auto-enter requires **both** non-expired wall session **and** live JWT. Fingerprint does not restore JWT. Gate cookie alone does not authorize roster/API. The product promises 8h continuity while Store Ops authority is JWT-bound.

---

## 7. Performance bottlenecks

### Measured (this audit — not fabricated)

| Probe | Result |
|-------|--------|
| `GET /login` | **200**, total ≈ **0.13s**, TTFB ≈ **0.13s** |
| `GET /` unauth | **307** → `/login` ≈ **0.12s** |
| `POST hub-bridge` empty body | **400** ≈ **0.43s** (earlier probe) |
| `POST hub-bridge` invalid PIN (`master_admin` / `0000`) | **401** ≈ **1.12s** |
| `POST hub-bridge` unknown user | **401** ≈ **1.27s** |
| `POST /api/auth/gate` unauth | **401** ≈ **0.61s** |
| Successful MasterAdmin login E2E | **NOT MEASURED** (no credentials) |

### Critical-path cost centers (code-confirmed, untimed success)

1. **Authentication latency:** password rotate + `signInWithPassword` every success  
2. **Database / Auth Admin:** profile upsert, metadata update, optional `listUsers(1000)`, optional 200-row roster scan  
3. **Rate-limit RPC:** every attempt before verify  
4. **Network:** mobile RTT × many sequential awaits  
5. **Client:** `setSession` + dual gate sync + client navigation  
6. **Rendering:** minor vs network; AuthWall is light  

**Do not treat reject-path ~1.2s as success-path estimate.** Success adds Auth Admin + sign-in + gate.

---

## 8. Security findings

### Preserve (do not weaken)

- Hub-bridge service-role PIN verify on `store_specialists`  
- Supabase JWT for Store Ops / RLS  
- Hub-gate cookie at edge (`HUB_GATE_SECRET` fail-closed)  
- MasterAdmin bootstrap only via secret-gated recovery  
- Rate limiting fail-closed  
- No raw PIN in `localStorage` for biometric  
- Anon roster SELECT remains revoked (SEC-OPS-002 / 007G)

### Issues / risks (not bypass recommendations)

| Finding | Severity | Notes |
|---------|----------|-------|
| Biometric ≠ server auth but UX implies full login | Medium (UX/security confusion) | Can train operators to trust fingerprint when JWT is dead |
| Client WebAuthn challenge not server-bound | Low given JWT gate | Do not elevate biometric to sole factor |
| `findSpecialistByLogin` returns username match when `pin_code` absent | Low | Still requires hub-bridge before workspace; do not treat as auth |
| Password rotated every login | Medium (availability) | Increases Auth API load / race surface under concurrent attempts |
| Rate-limit retry storm during hung UI | Medium (availability) | Soft-lockout without wrong PIN |
| Gate sync failure ignored | Medium (availability) | Redirect loop / false “logged in” perception |

No MasterAdmin bypass or credential exposure was introduced or recommended.

---

## 9. Proposed simplified architecture

**Goal:** one store, frequent mobile use — reliability first; simplify layers rather than add more.

### Target mental model

1. **PIN (or recovery)** establishes Supabase Auth session (source of truth for APIs).  
2. **Hub gate cookie** continues to protect HTML/API at the edge (keep).  
3. **Wall session** becomes a thin UX cache of specialist identity aligned to JWT claims — not a second authority.  
4. **Fingerprint** means: “assert device binding → **refresh or re-mint server session via a bounded server ceremony**,” or clearly degrade to “Unlock with PIN” when session cannot be restored.  
5. **Every loading state has a timeout** and an actionable error.

### Prefer

- Reuse existing hub-bridge / gate / profiles — **remove password rotation on every login** (mint via admin generateLink / magic session APIs or stable managed secret rotation only when needed).  
- Single client entry: `login → session → navigate` with one gate sync.  
- Auto-resume: if refresh token valid, enter without PIN; if not, PIN (fingerprint only when it can restore JWT).  
- Bound `fetch` (e.g. 12–15s) + cancel + clear `busy`.  
- Keep 8h idle / revocation semantics; align copy with real JWT refresh behavior.

### Avoid

- Raw PIN in localStorage  
- Permanent bearer tokens  
- Disabling expiration  
- Anon roster restore  
- Second parallel auth system  

---

## 10. Immediate lockout recovery options

**Do not reset MasterAdmin. Do not assume PIN is wrong.**

| Option | When | Risk |
|--------|------|------|
| Wait **15 minutes** if rate-limited (429) | Many taps during hang | None |
| Force-stop PWA / Chrome → clear site data for deptsync-hub → reopen `/login` | Stuck busy / stale SW / corrupt local session | Loses local biometric binding + local wall session; PIN still required |
| Unregister service worker + hard reload | Suspect stale shell | Low |
| Try desktop Chrome once | Isolate Android/PWA networking | Low |
| Confirm network (store Wi‑Fi / cellular) | Hung fetch | None |
| Ops-only: `POST /api/auth/bootstrap-admin` with `BOOTSTRAP_SECRET` | Identity/link breakage suspected | Controlled; does not replace operator PIN casually |
| Ops-only: inspect Vercel function logs for `/api/auth/hub-bridge` duration / 503 / 429 | Current hang | Read-only |
| Ops-only: confirm Production env still has `HUB_GATE_SECRET`, Supabase keys, `HUB_MASTER_PIN` | Gate 503 / Master env path | Read-only names; no values in chat |

**Operator immediate steps (recommended order):** wait for rate-limit window if recently spamming → clear site data → single careful PIN attempt → if still stuck past ~20s, stop retrying and escalate to function logs.

---

## 11. Implementation sequence

Recommended tranche order (future work — **not this audit**):

1. **AUTH-001A — Bound login UX**  
   Client timeouts, always clear busy, map 429/503 to plain language, cancel in-flight.  
2. **AUTH-001B — Slim hub-bridge mint**  
   Eliminate per-login password rotation; reuse linked auth user; remove `listUsers(1000)` fallback; tighten specialist lookup.  
3. **AUTH-001C — Single post-login handoff**  
   One gate sync; fail with visible error instead of redirect loop; destination = `homeHrefForSpecialist` for MasterAdmin (`/overview`).  
4. **AUTH-001D — Honest biometric**  
   Either server-assisted session resume after WebAuthn, or UI that never claims fingerprint equals full login; clear stale binding messaging.  
5. **AUTH-001E — Session resume policy**  
   Document and implement: refresh-token resume silently; PIN only when refresh fails; keep 8h idle revoke.  
6. **AUTH-001F — Observability**  
   Safe server timings (no PIN logging): rate-limit admit → verify → mint → total.

---

## 12. Required migrations, if any

| Change | Migration? |
|--------|------------|
| Client timeouts / UX / biometric honesty | **No** |
| Slim mint / remove password rotate | **No** (Auth Admin API behavior) |
| Rate-limit policy tweak | Optional env only (`DEPTSYNC_AUTH_RATE_LIMIT_*`); table already exists |
| Schema soften `profiles.pin` NOT NULL | Optional later; unrelated to hang if SEC-OPS-007B empty-string fix remains deployed |
| New WebAuthn server verify tables | Only if elevating biometric to cryptographic server factor — **prefer not** for v1 |

**Default for reliability tranche: zero SQL migrations.**

---

## 13. Regression test requirements

### Existing coverage run (this audit)

| Suite | Result |
|-------|--------|
| `lib/auth/access-gate-bootstrap.test.ts` | PASS |
| `lib/auth/hub-page-bootstrap.test.ts` | PASS |
| `lib/store-ops/sec-ops-007b.login-hotfix.test.ts` | PASS |
| `lib/store-ops/sec-ops-007c.session-bootstrap.test.ts` | PASS |
| `lib/store-ops/sec-ops-007g.hub-bootstrap.test.ts` | PASS |
| `lib/store-ops/sec-ops-007e.device-auth-diagnostic.test.ts` | PASS |
| `lib/store-ops/sec-ops-007f.roster-auth-diagnostic.test.ts` | PASS |
| `lib/store-ops/auth-harden-001.test.ts` | PASS |
| `lib/auth-gate.align-sec001.test.ts` | PASS |
| **Total** | **9 files / 73 tests PASS** |

### Missing coverage (gap analysis)

| Scenario | Current |
|----------|---------|
| Successful PIN login E2E (client) | Missing / contract-only |
| Invalid PIN UI | Partial (API contracts) |
| Network timeout → busy clears | **Missing** |
| Server 500/503 → clear error | Partial (rate-limit messages) |
| Biometric success with JWT | **Missing** |
| Biometric cancel | **Missing** |
| Stale biometric credential | **Missing** |
| Expired wall session | Covered in bootstrap decision tests |
| Valid-session resume (JWT+wall) | Covered in decision tests |
| Concurrent auth requests | **Missing** |
| Gate mint failure vs redirect loop | **Missing** |
| Loading-state recovery | **Missing** |

---

## 14. Remaining uncertainties

| Unknown | Why |
|---------|-----|
| Exact cause of **current** operator hang (timeout vs 429 vs gate loop vs mint error) | No operator DevTools / Vercel logs this session; no credentialed probe |
| Successful login wall-clock on production | Intentionally not measured |
| Whether MasterAdmin auth user / profile link is currently healthy | Would require privileged read of `auth.users` / `profiles` (not done) |
| Whether operator IP is rate-limited now | Needs Production log/RPC peek for their IP bucket |
| Live Supabase JWT expiry / refresh token settings | Project dashboard; not read here |
| Vercel deployment SHA currently serving production | CLI auth expired (SEC-OPS-010A); GitHub deployments API forbidden here |
| Android Chrome WebAuthn intermittency beyond JWT expiry | Device-specific; not reproduced |

---

## 15. GO / CONDITIONAL GO / NO-GO

| Question | Verdict |
|----------|---------|
| Continue operating on current auth architecture without change | **NO-GO** for reliability goals — architecture predicts slow PIN + flaky biometric + unbounded busy |
| Proceed to implement AUTH-001 reliability tranche (bounded UX + slim mint + honest biometric) | **CONDITIONAL GO** |
| Reset MasterAdmin / change PIN / weaken gate / store PIN locally | **NO-GO** |
| DB migrations required to start reliability work | **NO-GO** (not required) |
| Production credentialed login testing by agents | **NO-GO** without explicit operator authorization |

### CONDITIONAL GO conditions

1. Operator recovers access via §10 (or confirms still locked) before measuring success-path latency.  
2. Implementation tranche starts with **AUTH-001A** (timeouts / busy recovery) to stop indefinite “Signing in…”.  
3. No plaintext PIN local storage; no gate/JWT bypass; MasterAdmin protections unchanged.  
4. Add regression tests for timeout busy-clear + biometric-without-JWT messaging before calling complete.  
5. Re-establish Vercel log access (SEC-OPS-010A) for post-fix validation.

---

## Appendix A — Key files

| File | Ownership |
|------|-----------|
| `components/auth/AuthWall.tsx` | Login / unlock / biometric UI + busy state |
| `components/auth/AccessGate.tsx` | `/login` bootstrap + enterWorkspace |
| `lib/auth/access-gate-bootstrap.ts` | Fail-closed boot decisions |
| `lib/biometric-auth.ts` | WebAuthn local binding |
| `lib/store-ops/hub-bridge-client.ts` | Browser hub-bridge fetch + `setSession` |
| `lib/store-ops/hub-bridge.ts` | Server PIN verify + session mint |
| `app/api/auth/hub-bridge/route.ts` | Rate limit + mint HTTP |
| `app/api/auth/gate/route.ts` | Hub-gate cookie mint/clear |
| `lib/auth-session.ts` | Wall session + 8h idle |
| `lib/auth-gate.ts` / `proxy.ts` | Edge gate |
| `lib/store-ops/link-auth-profile.ts` | profiles + JWT claims |
| `public/sw.js` | PWA shell cache v7 |

## Appendix B — Production probes (2026-10-13)

| Check | Result |
|-------|--------|
| `/login` | 200 |
| `/` | 307 → `/login?next=%2F` |
| `/dashboard` unauth | 307 → login |
| hub-bridge `{}` | 400 validation |
| hub-bridge invalid PIN | 401 ~1.1s |
| gate unauth | 401 |
| `/sw.js` | 200, `deptsync-shell-v7-auth-boot` |
| Vercel CLI / deployment SHA | Unavailable (auth recovery pending) |
| Function logs | Unavailable |

---

**STOP AFTER REPORTING.** No implementation or deployment performed.
