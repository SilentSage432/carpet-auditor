# DEPTSYNC-AUTH-002 — Authentication Reliability and Session Correction

**Date:** 2026-10-13  
**Mode:** Focused local implementation (no production deploy)  
**Predecessor:** [`DEPTSYNC_AUTH_001_RELIABILITY_AUDIT.md`](./DEPTSYNC_AUTH_001_RELIABILITY_AUDIT.md)  
**Application:** https://deptsync-hub.vercel.app (unchanged this tranche)  
**Supabase:** `fmeinlwhixngednabhgy` (no migrations / no credential resets)  

---

## 1. Confirmed root causes addressed

| AUTH-001 root cause | Status | How addressed |
|---------------------|--------|---------------|
| RC-1 Unbounded “Signing in…” | **Fully corrected** | `boundedFetch` (15s AbortController); AuthWall `submittingRef` + `finally` always clears busy; timeout vs auth failure distinguished |
| RC-2 Heavy per-login mint | **Fully corrected** | Removed per-login password rotate + `signInWithPassword`; mint via `generateLink` + `verifyOtp`; skip profile rewrite when claims current; no `listUsers(1000)` |
| RC-3/4 Biometric ≠ server auth / flaky fingerprint | **Partially corrected** | Honest UX (“Resume with fingerprint”); only shown when refreshable Auth session hint exists; post-assert `refreshSession`; **full server WebAuthn deferred** |
| RC-5 Dual TTL / repeated re-auth | **Partially corrected** | Boot/resume uses `resolveLiveSupabaseSession` (getSession → refresh); clearer copy; gate sync single-flight |
| RC-6 Gate mint ignored | **Fully corrected** | `enterWorkspace` / hub `handleAuthenticated` require `syncHubGateCookie()` success or surface error |
| RC-7 Rate-limit retry storm | **Partially corrected** | Duplicate-submit guard + no blind retry of non-idempotent mint; 429 copy improved (policy unchanged) |
| RC-8 Stale SW shell | **Fully corrected** (local) | Cache bumped to `deptsync-shell-v8-auth-002` (takes effect on deploy) |

---

## 2. Authentication flow changes

### Before (AUTH-001)

```
PIN → hub-bridge → rate limit → verify PIN
  → ensureAuthUser (+ full profile link)
  → updateUserById(random password)     // every login
  → linkAuthUserToSpecialistProfile     // again
  → signInWithPassword
  → client setSession
  → startAuthSession (+ fire-and-forget gate)
  → enterWorkspace await gate again
  → navigate
```

### After (AUTH-002)

```
PIN → bounded hub-bridge (15s) → rate limit → verify PIN
  → ensureAuthUser (+ ensureAuthProfileLinked; skip if current)
  → generateLink(magiclink) + verifyOtp   // no password rotate
  → timings in JSON (ms only)
  → client setSession (bounded)
  → startAuthSession (wall only)
  → await syncHubGateCookie (once; fail → error)
  → navigate homeHrefForSpecialist | ?next=
```

PIN verification authority unchanged: `verifyStoredPin` on `store_specialists`. MasterAdmin bootstrap still secret-gated only.

---

## 3. Session lifecycle changes

| Artifact | Role (documented) |
|----------|-------------------|
| **Supabase JWT + refresh** | Store Ops / RLS / roster authority. Auto-refresh coordinated via `resolveLiveSupabaseSession`. |
| **Hub-gate cookie** | Edge HTML/API gate (`proxy.ts`). Minted once after live JWT via `POST /api/auth/gate`. |
| **Wall session** (`deptsync_auth_session`) | UX identity + 8h idle clock. Not sufficient alone for roster/API. |
| **Biometric local binding** | Device resume accelerator only when refreshable Auth session may exist. |

**Resume path:** wall session present → `resolveLiveSupabaseSession` → if JWT → roster → enter → single gate sync.  
**Expired JWT / no refresh:** unlock / login with PIN (clear recovery copy).  
**Gate mint failure:** no redirect loop; operator-visible error.

---

## 4. Biometric implementation status

| Requirement | Status |
|-------------|--------|
| Honest UX (not presented as full login) | **Done** |
| Hide when no refreshable session hint | **Done** |
| Attempt `refreshSession` after WebAuthn | **Done** |
| Server-generated challenge | **Deferred** |
| Server-side WebAuthn verification | **Deferred** |
| Credential DB + revocation + rate limit | **Deferred** |
| Independent session issuance without live JWT | **Deferred** |

**Classification: Partially corrected — deferred for security reasons.**

Independent biometric login that mints a server session requires a dedicated WebAuthn ceremony (server challenge store, origin/RP-ID validation, credential public-key registry, replay protection, rate limits). Improvising that in this tranche would risk a false sense of security. Track as **AUTH-003 (security review)** before claiming fingerprint login is “fixed.”

---

## 5. Login UX improvements

- Primary action remains username + PIN  
- Fingerprint demoted to “Resume with fingerprint” and only when usable  
- Idle / fingerprint copy no longer promises 8h biometric login  
- Busy keypad/buttons disabled; “Signing in…” / “Resuming…” labels  
- Duplicate submission blocked  
- Timeout and network errors are actionable  
- Gate failure banner on AccessGate / hub  
- Default post-login destination: `homeHrefForSpecialist` (MasterAdmin → `/overview`) when `?next=` absent  

---

## 6. Performance evidence

| Measurement | Result |
|-------------|--------|
| Client request bound | **15_000 ms** hard timeout (code) |
| Per-login password rotate | **Removed** (code contract tests) |
| `listUsers(1000)` collision path | **Removed** (generateLink resolve) |
| Double gate sync on startAuthSession | **Removed** |
| Production success-path wall-clock | **Not measured** (no deploy / no credentialed probe this tranche) |
| Prior invalid-PIN reject (AUTH-001) | ~1.1–1.3s (baseline only; success path expected faster after slim mint once deployed) |

Do not invent production timing deltas until deployed and probed.

---

## 7. Security invariants

Preserved:

- MasterAdmin identity and credentials (untouched)  
- Hub-bridge PIN verify + rate limit fail-closed  
- Supabase Auth session for Store Ops  
- Hub-gate HMAC cookie at edge  
- No raw PIN in localStorage  
- No auth bypass / permanent bearer shortcut  
- RLS / role / store isolation unchanged  
- Bootstrap-admin remains secret-gated recovery  

---

## 8. Files changed

| File | Change |
|------|--------|
| `lib/auth/bounded-fetch.ts` | **New** — AbortController timeout helper |
| `lib/auth/live-session.ts` | **New** — refresh-aware live session probe |
| `lib/auth/auth-002.reliability.test.ts` | **New** — contracts |
| `lib/store-ops/hub-bridge.ts` | Slim mint (`generateLink`/`verifyOtp`), timings, no listUsers |
| `lib/store-ops/hub-bridge-client.ts` | Bounded fetch, error codes, no blind retry |
| `lib/store-ops/link-auth-profile.ts` | `ensureAuthProfileLinked` skip-if-current |
| `app/api/auth/hub-bridge/route.ts` | Return safe timings |
| `lib/auth-gate-client.ts` | Bounded fetch |
| `lib/auth-session.ts` | Wall session no longer fire-and-forget gate |
| `components/auth/AccessGate.tsx` | Live resume, single gate, fail closed, home href |
| `components/auth/AuthWall.tsx` | Busy/timeout UX, honest biometric, duplicate guard |
| `app/page.tsx` | Live resume + awaited gate before unlock |
| `lib/biometric-auth.ts` | AUTH-002 ownership comment |
| `public/sw.js` | `deptsync-shell-v8-auth-002` |
| `lib/store-ops/sec-ops-007e/f/g*.test.ts` | Contracts updated for live session / SW |

---

## 9. Migration requirements

**None.** No SQL. No credential resets. No production env changes in this tranche.

---

## 10. Test results

| Check | Result |
|-------|--------|
| `lib/auth/auth-002.reliability.test.ts` | **PASS** (8) |
| Focused auth suites (007B/C/E/F/G, harden, gate, bootstrap, AUTH-002) | **PASS** |
| `npm run typecheck` | **PASS** |
| `npm run build` | **PASS** |
| `npm run lint` (repo-wide) | **FAIL** — pre-existing errors outside AUTH-002 (tmp/, preferences-context, etc.) |
| `eslint` on AUTH-002 touched files (after UnlockForm key fix) | AuthWall effect issue cleared; `app/page.tsx` visited-sections effect is pre-existing |

---

## 11. Production release readiness

| Gate | Status |
|------|--------|
| Local implementation complete | **Yes** |
| Deployed | **No** (explicit STOP) |
| Operator credentialed verification | **Pending post-deploy** |
| Vercel log access | Still blocked if CLI auth expired (SEC-OPS-010A) |
| Independent biometric server login | **Not ready** — AUTH-003 |

**Release readiness: CONDITIONAL GO** after deploy + one successful MasterAdmin PIN login + confirm no indefinite “Signing in…” on slow network.

---

## 12. Remaining blockers

1. **AUTH-003** — Server-verified WebAuthn session mint (security review required).  
2. Production deploy + operator confirmation.  
3. Optional: measure success-path timings from hub-bridge `timings` in Production logs (no secrets).  
4. Vercel CLI auth recovery if env/log inspection needed.

### Classification summary

| Area | Class |
|------|-------|
| Bounded login / busy terminal states | Fully corrected |
| Slim PIN mint path | Fully corrected |
| Gate sync / redirect failure handling | Fully corrected |
| Valid-session resume (refresh) | Partially corrected (improved; still JWT-dependent) |
| Biometric independent login | Deferred for security reasons |
| Production latency proof | Deferred until deploy |

---

**STOP AFTER IMPLEMENTATION.** No deployment. No credential resets.
