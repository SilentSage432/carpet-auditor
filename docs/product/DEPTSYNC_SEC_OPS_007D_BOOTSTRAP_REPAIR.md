# DEPTSYNC-SEC-OPS-007D — Secure Session Bootstrap Repair

**Date:** 2026-10-11  
**Mode:** Controlled production hotfix  
**Canonical Supabase:** `fmeinlwhixngednabhgy`  
**Application:** https://deptsync-hub.vercel.app  
**Repository commit:** `75efe828a83bb5820b14d8f4f19678a9f5f2ab09`  
**Production SQL:** none  

---

## Root cause

`AccessGate` kept `mode === "booting"` when a local `deptsync_auth_session` and Supabase JWT were present and `fetchSpecialists()` rejected. The async boot IIFE had no recovery path, so the PIN wall never mounted (SEC-OPS-007C).

---

## Changed files

| File | Change |
|------|--------|
| `lib/auth/access-gate-bootstrap.ts` | **New** — `decideAccessGateBoot` + auth/network classifiers |
| `components/auth/AccessGate.tsx` | Fail-closed boot; generation guard; catch roster/enter failures |
| `lib/auth/access-gate-bootstrap.test.ts` | **New** decision-table tests |
| `lib/store-ops/sec-ops-007c.session-bootstrap.test.ts` | Updated contracts for 007D recovery |

SEC-OPS-007B credential-writer tests retained (still passing).

---

## Recovery behavior

| Condition | Outcome |
|-----------|---------|
| Missing session | `login` |
| Expired session | `login` + clear hub session |
| Valid session, no JWT | `unlock` (PIN) |
| Valid session + JWT + roster OK | `enter` workspace (after gate cookie) |
| Roster auth rejection (invalid JWT) | `unlock` + local Supabase `signOut` |
| Roster network failure | `unlock` (keep JWT for retry; no auto-enter) |
| `enterWorkspace` failure | `unlock` |
| Any unexpected throw | `login` |
| Effect cleanup / logout mid-boot | stale responses ignored (`bootGenRef`) |

**Never** grants workspace entry on failed restoration. Unrelated local app data is not wiped on roster failure (only invalid JWT cleared on auth rejection; expired hub session cleared on expiry).

---

## Security invariants

- No PIN / MasterAdmin / scrypt changes  
- No plaintext reintroduction  
- No plaintext-fallback change  
- No RLS / rate-limit / SQL / topology / rotation changes  
- Unverified stored session never treated as authenticated workspace access  

**Rollback:** fix forward preferred. Do **not** roll back to `e36bfb5` (pin:null) or pre-AUTH-HARDEN builds.

---

## Regression tests

| Suite | Result |
|-------|--------|
| `access-gate-bootstrap.test.ts` | PASS (8) |
| `sec-ops-007c.session-bootstrap.test.ts` | PASS (2) |
| `sec-ops-007b` + `sec-ops-005` | PASS (retained) |
| Full `npm test` | **PASS — 116 files / 1487 tests** |
| `npm run typecheck` | **PASS** |
| `npm run build` | **PASS** |

---

## Commit SHA

`75efe828a83bb5820b14d8f4f19678a9f5f2ab09`  
Message: `fix(auth): recover AccessGate bootstrap from session restore failures`  
Push: `2972305..75efe82` → `origin/main`

---

## Vercel deployment ID

| Field | Value |
|-------|--------|
| SHA | `75efe828a83bb5820b14d8f4f19678a9f5f2ab09` |
| Vercel status | **success** |
| Vercel URL | https://vercel.com/tyson-zauggs-projects/deptsync-hub/FqTvT3XYWuHTE55u8e7ZfRdoLAgj |
| Deployment id | `FqTvT3XYWuHTE55u8e7ZfRdoLAgj` |

Deployed source includes `decideAccessGateBoot` in `AccessGate.tsx`.

---

## Production verification

| Check | Result |
|-------|--------|
| `/login` | **200** — clean session shows PIN login (browser) |
| `/` / `/dashboard` unauth | **307** → login |
| hub-bridge empty / bad | **400** / **401** |
| Anon containment | **401** |
| Rate-limit RPC | **operational** |
| Live invalid-JWT inject on prod alias | **Not re-run** in this tranche (safe unit coverage + 007C repro pattern; no operator-device injection) |

---

## Operator login status

**OPERATOR LOGIN PENDING**

Operator should reload https://deptsync-hub.vercel.app/login. If a prior stuck splash remains, one site-data clear may still be needed once; subsequent invalid JWT restores should show Unlock/Login instead of infinite splash.

---

## Remaining risks

1. Hub `app/page.tsx` boot still awaits `loadStoreData` without the same helper (lower risk; proxy sends unauth users to `/login`).  
2. Operator confirmation still required for end-to-end Master PIN login.  
3. Network failures go to Unlock (safe) rather than an explicit retry button.

---

## GO / NO-GO

| Action | Verdict |
|--------|---------|
| Hotfix shipped | **GO — SHIPPED** |
| Operator login confirmed | **PENDING** |
| Credential / SQL / fallback changes | **NO-GO** |

**STOP.**
