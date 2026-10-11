# DEPTSYNC-ALIGN-SEC-005 — Master Recovery Credential Compatibility

**Status:** INVESTIGATION COMPLETE  
**Date:** 2026-10-10  
**Mode:** Read-only investigation + local tests  
**Deployment / production mutation / commit / push:** NOT AUTHORIZED  
**Production secrets:** Never read, requested, displayed, or logged  

**Recommendation:** **COMPATIBLE — GO for 64-hex `HUB_MASTER_PIN`** (recovery + bootstrap paths). Ordinary DB PIN login unchanged. Residual security hardening listed in §E/§F — optional follow-on; not required for credential shape compatibility.

---

## A. Compatibility findings

| Check | Result |
|-------|--------|
| Credential truncation in `getHubMasterPin` / `isHubMasterPin` / `requireHubMasterPin` | **None** — trim whitespace only; no max length |
| Four-digit-only server validation on Master env credential | **None** — Master path does not use `isValidPermanentPin` |
| Database column constraints (`pin_code` / `pin_hash`) | **Compatible** — unconstrained `text` |
| Hashing behavior for 64-hex | **Compatible** — `hashPin` / `verifyStoredPin` accept arbitrary strings; bootstrap stores **plaintext** `pin_code` (equality path) |
| Client login / unlock password fields | **Compatible** — no `maxLength`; Master with username uses password field (`hasQuickPin` false when `pin_code` stripped) |
| Digit keypad unlock | **Not used** for Master recovery when username present or secret is non-`^\d{4}$`; keypad still caps at 8 / auto-submits at 4 for true 4-digit quick PIN members |
| Bootstrap HTTP + local script | **Compatible** — writes full `HUB_MASTER_PIN` to `pin_code`; sets Auth password to same value |
| Hub-bridge recovery | **Compatible** — `isHubMasterPin(pin)` after DB verify; full-string compare |
| Ordinary 4–6 digit PIN validation | **Unchanged** — `isValidPermanentPin` still gates invite/redeem/reset-new-PIN paths only |

**Verdict:** A Production `HUB_MASTER_PIN` generated with `openssl rand -hex 32` (64 hex chars) is supported by the existing master recovery mechanism. Everyday database-backed PIN login does not depend on that env value matching a 4-digit shape.

---

## B. Recovery dependency graph

```
Vercel env HUB_MASTER_PIN (64-hex)
        │
        ├─ getHubMasterPin / requireHubMasterPin / isHubMasterPin
        │         │
        │         ├─ POST /api/auth/bootstrap-admin  (Bearer BOOTSTRAP_SECRET)
        │         │         └─ ensureMasterAdminBootstrap
        │         │                   ├─ store_specialists.pin_code ← full pin (plaintext today)
        │         │                   └─ auth.users.password ← full pin (bootstrap path)
        │         │
        │         └─ scripts/bootstrap-admin.mjs  (service role; no BOOTSTRAP_SECRET)
        │                   └─ same pin_code / Auth password write
        │
        └─ POST /api/auth/hub-bridge
                  ├─ verifyStoredPin(pin, pin_hash|pin_code)  → mint session
                  └─ else isHubMasterPin(pin) → mintExistingMasterWithHubPin()

Operator UI
  AuthWall login / unlock password TextField  → hub-bridge (full paste OK)
  Everyday associate PIN paths                 → DB pin_hash / 4–6 digit rules (separate)
```

Hub gate (`HUB_GATE_SECRET`) and bootstrap authorize (`BOOTSTRAP_SECRET`) are orthogonal secrets; they do not reshape `HUB_MASTER_PIN`.

---

## C. Input / storage / hash constraints

| Layer | Constraint | Impact on 64-hex Master |
|-------|------------|-------------------------|
| `hub-master-pin.ts` | Non-empty after trim | Pass |
| `hub-bridge.ts` | Non-empty trim; then DB verify or env match | Pass |
| `isValidPermanentPin` | `^\d{4,6}$` | **Not applied** to Master env path |
| `hashPin` | SHA-256 `salt:pin` → `salt.digest` | Works if used; bootstrap does not hash Master pin today |
| `verifyStoredPin` | Salted hash or plaintext equality | Works for plaintext 64-hex `pin_code` |
| Schema | `pin_code text`, `pin_hash text` | No length CHECK |
| AuthWall login/unlock password | No `maxLength` | Paste OK |
| Unlock digit keypad | Max 8 digits; auto-submit at 4 | Only when `hasQuickPin` (`^\d{4}$` or no username) — not Master recovery default |
| Associate reset / change PIN | Exactly 4 digits | Ordinary PIN lifecycle only |
| Supabase Auth password (bootstrap) | 64 chars &lt; typical GoTrue/bcrypt limits | Expected OK |

---

## D. Synthetic credential test results

Fixture (synthetic only): 64-char lowercase hex repeating `0123456789abcdef` — **not** a Production value.

| Suite | Result |
|-------|--------|
| `lib/store-ops/hub-master-pin.align-sec005.test.ts` | **16/16 pass** |
| `npm run typecheck` | **Pass** |
| Full `npm test` | **1341/1341 pass** |
| `npm run build` | **Pass** |

Covered: no truncation; env match; reject truncated candidates; hash round-trip; plaintext verify; ordinary 4-digit still valid; `hasQuickPin` / AuthWall / schema / hub-bridge / bootstrap source contracts.

---

## E. Required corrections (if any)

**None required for 64-hex compatibility.**

Smallest safe follow-ons (optional; separate authorization; do **not** silently change auth):

1. **Hash Master `pin_code` on bootstrap** — today plaintext env secret is written to `store_specialists.pin_code`. Prefer `hashPin` + `pin_hash`, clear plaintext `pin_code`. Compatibility preserved if hub-bridge keeps `isHubMasterPin` env fallback.
2. **Stop returning raw `pin` in bootstrap HTTP JSON** — recovery UX convenience vs secret echo; prefer `pin_configured: true` only.
3. **Unlock UX** — if a member ever shows digit keypad while operator needs env Master recovery, ensure “password” mode or full login remains reachable (already true via “Sign in as a different user” + login TextField).

---

## F. Remaining security risks

| Risk | Severity | Notes |
|------|----------|-------|
| Bootstrap stores Master credential plaintext in `pin_code` | Medium | Compatible but weak storage |
| Bootstrap HTTP returns Master PIN in response body | Medium | Bearer-protected; still an echo |
| Hub-bridge / login lack rate limits | Medium | Pre-existing (SEC-003) |
| `isHubMasterPin` uses `===` not timing-safe compare | Low | Length mismatch short-circuits |
| Digit keypad cannot enter 64-hex | Low | Master path uses password field when username present |
| Align-SEC-001 code not yet deployed | Process | Operator deploy authorization separate |

---

## G. Final deployment recommendation

**COMPATIBLE — operator may keep Production `HUB_MASTER_PIN` as `openssl rand -hex 32` (64 hex).**

- Recovery: paste full value into AuthWall **Password / PIN** (login or unlock password mode) → hub-bridge `isHubMasterPin` / stored pin verify.  
- Bootstrap: HTTP with `BOOTSTRAP_SECRET` or local `scripts/bootstrap-admin.mjs` stores the full credential.  
- Everyday DB-backed PIN login: **unaffected**.  

This tranche does **not** authorize commit, push, or Production deploy. Optional hardening in §E requires a separate authorized implementation tranche.

---

*End of ALIGN-SEC-005. STOP for operator review.*
