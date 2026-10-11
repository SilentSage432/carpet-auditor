# DEPTSYNC-SEC-OPS-007G — Authenticated Bootstrap Repair

**Date:** 2026-10-11  
**Mode:** Controlled production hotfix  
**Canonical Supabase:** `fmeinlwhixngednabhgy`  
**Application:** https://deptsync-hub.vercel.app  
**Production SQL:** none  
**References:** SEC-OPS-007F · SEC-OPS-007D  

---

## Root cause

Browser bootstrap called `fetchSpecialists()` → PostgREST `store_specialists` as PostgreSQL role **`anon`**. SEC-OPS-002 intentionally revoked anon table privileges → HTTP **401** / PG **42501**. Hub `loadStoreData()` had no JWT gate and no catch → uncaught rejection → permanent “Loading DeptSync secure session…”.

Roster projection was already non-secret; grants for **authenticated** were sufficient. The defect was **sequencing / error handling**, not missing anon access.

---

## Selected authorization architecture

**Approach A — existing hub-bridge Supabase Auth session.**

| Fact | Decision |
|------|----------|
| Browser is intended to hold a Supabase JWT after PIN via `/api/auth/hub-bridge` + `setSession` | **Yes** |
| Hub wall session / hub-gate cookie alone authorizes roster SELECT | **No** |
| Existing GET roster server endpoint | **None** — do not invent a second auth mechanism |
| Restore anon SELECT | **NO-GO** |
| Expose service role to browser | **NO-GO** |

Protected roster reads remain: **authenticated JWT + non-secret column projection + store-scoped RLS**.

---

## Changed files

| File | Change |
|------|--------|
| `app/page.tsx` | JWT-first boot; `decideHubPageBoot`; generation guard; catch roster failures; `loadStoreData` never queries as anon |
| `lib/auth/hub-page-bootstrap.ts` | **New** — `canFetchProtectedRoster` + `decideHubPageBoot` (reuses 007D table) |
| `lib/auth/hub-page-bootstrap.test.ts` | **New** decision tests |
| `lib/auth/access-gate-bootstrap.ts` | Comment: shared 007D/007G decision ownership |
| `public/sw.js` | Cache `deptsync-shell-v7-auth-boot` (drop stale v6 shells on activate) |
| `lib/store-ops/sec-ops-007g.hub-bootstrap.test.ts` | **New** source contracts |
| `lib/store-ops/sec-ops-007e/f` diagnostic tests | Updated for repaired hub / SW version |
| Docs / journal / handoff / roadmap | This report + program records |

AccessGate **007D** retained unchanged in behavior.

---

## Bootstrap state transitions

| Condition | Hub `/` outcome |
|-----------|-----------------|
| Missing / expired hub wall session | `login` + redirect `/login` |
| Hub session, no Supabase JWT | `unlock` — **no** `fetchSpecialists` |
| JWT + roster OK | `enter` → unlock workspace / home redirect |
| JWT + roster 401/42501 / auth reject | `unlock` + local Supabase `signOut` |
| JWT + network failure | `unlock` (keep JWT for retry) |
| Unexpected throw | `login` + `/login` |
| Effect cleanup / logout mid-boot | stale responses ignored (`bootGenRef`) |

Never grants workspace entry on failed restore. No infinite retry loop.

---

## Regression tests

| Suite | Result |
|-------|--------|
| `hub-page-bootstrap.test.ts` | PASS |
| `sec-ops-007g.hub-bootstrap.test.ts` | PASS |
| `access-gate-bootstrap` / 007C / 007E / 007F | PASS (updated) |
| Full `npm test` | **PASS — 120 files / 1507 tests** |
| `npm run typecheck` | **PASS** |
| `npm run build` | **PASS** |

---

## Commit SHA

_(filled after commit)_

---

## Vercel deployment ID

_(filled after deploy)_

---

## Real-device findings

| Check | Result |
|-------|--------|
| ADB device attached | **Yes** — `R3GYC07NBZN` (SM_S948U) |
| Chrome DevTools Protocol (`adb forward` → `9222/json`) | **Unavailable** (timeout; inspectable tab / remote debugging not exposed) |
| Device storage cleared | **No** |
| Tokens / credentials extracted | **No** |
| PIN login attempted | **No** |

Post-deploy: operator should hard-reload `/login` (new SW cache name helps drop v6). Confirm Network Authorization is authenticated after PIN, not anon.

---

## Production verification

_(filled after deploy)_

---

## Operator login status

**OPERATOR LOGIN PENDING** — final authenticated Floor Command entry requires operator PIN participation.

---

## Remaining risks

1. Phones that never activate the new SW may keep an in-memory old tab until reload.  
2. `WorkflowTabShell` still lacks `.catch` on post-auth roster refresh (does not block splash).  
3. Other `select("*")` helpers in `specialists.ts` remain a separate authenticated-column risk (out of scope).  
4. Live authenticated JWT smoke against production still depends on operator login.

---

## Security invariants preserved

- No production SQL  
- No anon table grants  
- No PIN / MasterAdmin / credential changes  
- No RLS / rate-limit / plaintext-fallback changes  
- No service-role exposure to browser  

**Rollback:** redeploy prior Vercel deployment; do **not** restore anon grants.

---

## GO / NO-GO

| Action | Verdict |
|--------|---------|
| Hotfix ship | **GO** (when deploy completes) |
| Anon grants / SQL / credential changes | **NO-GO** |
| Operator login confirmed | **PENDING** |

**STOP** after deploy verification + this report finalized.
