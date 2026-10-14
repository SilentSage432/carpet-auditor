# DEPTSYNC-AUTH-006 — Login Simplification

**Date:** 2026-10-14  
**Mode:** Focused implementation (no deploy)  
**Branch:** `main`  
**AUTH-003 archive:** `archive/auth-003-independent-webauthn` @ `a4ac66b`

---

## Verdict

### **CONDITIONAL GO** for app-only production release of PIN-only AuthWall

PIN authentication (AUTH-002) preserved. Biometric UI removed from all AuthWall surfaces. Unreleased AUTH-003 WebAuthn is **isolated on an archive branch** and is **not** on `main` (no routes, no migration, no SimpleWebAuthn deps).

**Do not deploy automatically** — release only after operator authorization.

---

## 1. UI changes

| Surface | Change |
|---------|--------|
| Login form | Removed “Resume with fingerprint”, enroll banner, biometric state |
| Unlock form | Removed fingerprint unlock button and copy |
| Setup form | Removed post-setup biometric enroll prompt |
| Auth copy | PIN/password-primary messaging only |
| Phone reset | Unchanged |

No other auth surfaces referenced biometric CTAs after cleanup.

---

## 2. Preserved PIN behavior (AUTH-002)

| Control | Status |
|---------|--------|
| Hub-bridge PIN verify + slim mint | Unchanged on `main` |
| 15s `boundedFetch` | Unchanged |
| `submittingRef` + busy `finally` | Unchanged |
| AccessGate hub-gate sync fail-closed | Unchanged |
| MasterAdmin / store isolation / RLS | Unchanged |
| Session restore via live JWT refresh | Unchanged (AccessGate path) |

`lib/biometric-auth.ts` remains in tree but is **not imported by AuthWall**; header documents AUTH-006 UI retirement.

---

## 3. AUTH-003 isolation evidence

| Artifact | On `main`? | On archive branch? |
|----------|------------|--------------------|
| `app/api/auth/webauthn/**` | **No** | Yes |
| `lib/auth/webauthn/**` + client | **No** | Yes |
| `20261020_auth_003_webauthn.sql` | **No** | Yes |
| `@simplewebauthn/*` deps | **No** | Yes |
| AUTH-003/004/005 docs | **No** (docs remain on archive) | Yes |
| AuthWall biometric / independent login | **No** | Yes (historical) |

Isolation method: committed AUTH-003 WIP to `archive/auth-003-independent-webauthn`, then returned `main` to HEAD and applied PIN-only AuthWall. A production deploy from `main` **cannot** ship WebAuthn endpoints or the WebAuthn migration.

Historical AUTH docs are retained on the archive branch; this file records the product decision on `main`.

---

## 4. Security regression results

| Check | Result |
|-------|--------|
| AUTH-002 + auth-gate + auth-harden | **46 PASS** |
| `tsc --noEmit` | **PASS** (after clearing stale `.next` WebAuthn validators) |
| ESLint AuthWall / biometric-auth / auth-002 test | **PASS** |
| `next build` | **PASS** — no `/api/auth/webauthn/*` routes |
| AuthWall source contracts | No fingerprint / WebAuthn CTA strings |

---

## 5. Release readiness

| Item | Status |
|------|--------|
| Production migrations | **None** |
| Credential resets | **None** |
| AUTH-003 deploy risk on `main` | **Mitigated** (absent from tree) |
| App deploy of AuthWall PIN-only | **CONDITIONAL GO** after checks + operator authorize |

**STOP — do not deploy from this tranche automatically.**
