# DEPTSYNC-ALIGN-SEC-002 — Vercel Production Security Readiness

**Status:** READINESS AUDIT COMPLETE  
**Date:** 2026-10-10  
**Deployment / production mutation / commit / push:** NOT AUTHORIZED  
**Recommendation:** **NO-GO** until operator confirms required Vercel Production secrets (see §J / §K)

---

## Distinction legend

| Tag | Meaning |
|-----|---------|
| **LOCAL** | Verified in repository / Vitest / local build |
| **DEPLOYED** | Verified against live Vercel configuration |
| **OPERATOR** | Requires operator confirmation in Vercel / Supabase UI |
| **UNKNOWN** | Not observable from this environment |

---

## A. Vercel configuration readiness

### Repository deploy config (**LOCAL**)

| Item | Evidence |
|------|----------|
| Cron | `vercel.json`: `/api/cron/weekly-rotation` @ `0 11 * * 0` (Sunday 11:00 UTC) |
| Edge proxy | `proxy.ts` — cron paths pass at edge; handler requires `CRON_SECRET` |
| Required secrets (ALIGN-SEC-001) | `HUB_GATE_SECRET`, `BOOTSTRAP_SECRET`, plus existing `HUB_MASTER_PIN`, `CRON_SECRET`, Supabase trio |

### Vercel Production env presence

| Variable | Deployed status |
|----------|-----------------|
| `NEXT_PUBLIC_SUPABASE_URL` | **OPERATOR** — confirm in Vercel → Project → Settings → Environment Variables (Production) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **OPERATOR** |
| `SUPABASE_SERVICE_ROLE_KEY` | **OPERATOR** |
| `HUB_MASTER_PIN` | **OPERATOR** |
| `CRON_SECRET` | **OPERATOR** (Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`) |
| `HUB_GATE_SECRET` | **OPERATOR — CRITICAL** must be set **before** deploying ALIGN-SEC-001 code |
| `BOOTSTRAP_SECRET` | **OPERATOR — CRITICAL** for HTTP recovery after deploy; must not equal `CRON_SECRET` |

**This environment:** Vercel CLI not installed; no authorized remote env read. **DEPLOYED = UNKNOWN.**

### Local `.env.local` key presence (names only; not Production)

| Variable | Local |
|----------|-------|
| Supabase trio | SET |
| `CRON_SECRET` | SET |
| `HUB_MASTER_PIN` | MISSING_OR_EMPTY |
| `HUB_GATE_SECRET` | MISSING_OR_EMPTY |
| `BOOTSTRAP_SECRET` | MISSING_OR_EMPTY |

Local files **must not** be treated as Vercel Production.

---

## B. Operator login verification

Flow (**LOCAL** code + tests):

```text
PIN → POST /api/auth/hub-bridge (public edge)
    → Supabase session (setSession)
    → AccessGate.enterWorkspace → syncHubGateCookie
    → POST /api/auth/gate (public edge; requires JWT; needs HUB_GATE_SECRET)
    → deptsync_hub_gate cookie
    → /dashboard + protected /api/* (edge requires verified gate cookie)
```

| Check | Status |
|-------|--------|
| Valid mint/verify with `HUB_GATE_SECRET` | **LOCAL** pass (SEC-001/002 tests) |
| Invalid / tampered cookie rejected | **LOCAL** pass |
| Missing `HUB_GATE_SECRET` fails closed | **LOCAL** pass |
| Prior-secret cookies rejected; remint restores | **LOCAL** pass |
| Expired cookie rejected (TTL 8h = session timeout) | **LOCAL** pass |
| Invalid PIN / hub-bridge failure | **LOCAL** code path (hub-bridge returns 401); full live login **OPERATOR** |
| End-to-end browser login against Production | **OPERATOR** / **UNKNOWN** |

---

## C. Recovery verification

| Check | Status |
|-------|--------|
| `/api/auth/bootstrap-admin` edge-public (no gate cookie) | **LOCAL** pass |
| Requires `BOOTSTRAP_SECRET` Bearer | **LOCAL** pass |
| Rejects `CRON_SECRET` substitute | **LOCAL** pass |
| Invalid bootstrap credentials fail | **LOCAL** pass |
| Local script `scripts/bootstrap-admin.mjs` viable without BOOTSTRAP_SECRET | **LOCAL** (code path; uses service role + `HUB_MASTER_PIN`) |
| Recovery does not require broken gate cookie | **LOCAL** pass |
| Execute recovery against Production | **NOT AUTHORIZED** / not done |

---

## D. API / proxy authorization matrix

**Edge rule (ALIGN-SEC-001):** arbitrary Bearer **cannot** bypass. Classes:

| Edge class | Paths |
|------------|-------|
| **Public** | `/api/auth/*`, `/api/invite/*`, login/pair HTML |
| **Cron** | `/api/cron/*` — edge pass; handler `CRON_SECRET` |
| **Operator gate** | All other `/api/*` + operate HTML — verified hub gate cookie |
| **Recovery** | `/api/auth/bootstrap-admin` (public edge + `BOOTSTRAP_SECRET` handler) |

**61** API route modules inventoried. Handler-level auth (sample):

- Mutations generally use `resolveStoreOpsActor` + `requireSupervisorOrAdmin` / `requireSuperAdmin`
- Cron: `authorizeCron`
- Bootstrap: `authorizeBootstrapRequest`
- Gate mint: `getRequestAuthUser`
- Hub-bridge: service-role PIN verify (intentionally public edge)

**Note:** Passing the proxy ≠ authorization for service-role handlers (unchanged law).

Full path list is reproducible via `find app/api -name route.ts` (see audit session).

---

## E. Cron continuity

| Check | Status |
|-------|--------|
| `vercel.json` schedule unchanged | **LOCAL** |
| Proxy still edge-allows `/api/cron/*` without gate cookie | **LOCAL** |
| Handler still requires `CRON_SECRET` | **LOCAL** |
| Arbitrary Bearer alone cannot reach other APIs | **LOCAL** |
| Production cron invocation | **NOT AUTHORIZED** / not triggered |

Sunday Stage+Assign should continue **if** Production `CRON_SECRET` remains set (same as today). ALIGN-SEC-001 does not change cron auth.

---

## F. RLS script review

File: `scripts/sql/align-sec001-rls-verify-readonly.sql`

| Property | Result |
|----------|--------|
| Mutating DDL/DML | **None** (comments mention verbs; executable body is SELECT-only) — **LOCAL** verified |
| No operational row content | Inspects `pg_class` / `pg_policies` only |
| No credentials | No `pin_code` / password columns |
| Production execution | **OPERATOR** — not executed here |

### Operator instructions (Supabase SQL Editor)

1. Open the canonical Supabase project → **SQL Editor**.  
2. Paste the full contents of `scripts/sql/align-sec001-rls-verify-readonly.sql`.  
3. Run.  
4. Review: RLS enabled flags; policy list; “potentially permissive” hits (`USING true` / anon roles).  
5. Do not apply fixes from this script — it is inspection only.

---

## G. Deployment checklist

**Order matters.**

### Phase 0 — Pre-deploy (Vercel UI; no code deploy yet)

- [ ] Confirm Production has Supabase trio + `HUB_MASTER_PIN` + `CRON_SECRET`  
- [ ] **Generate and set** Production `HUB_GATE_SECRET` (long random; dedicated; **not** cron/service/anon)  
- [ ] **Generate and set** Production `BOOTSTRAP_SECRET` (long random; **≠** `CRON_SECRET`)  
- [ ] Optionally set same on Preview if Preview is used for smoke  
- [ ] Record that local recovery script path remains available offline  

### Phase 1 — Deploy ALIGN-SEC-001 code

- [ ] Deploy only after Phase 0 secrets are saved on Production  
- [ ] Expect existing hub gate cookies signed with prior fallback secret to fail verify → login redirect (**safe**)  

### Phase 2 — Immediate post-deploy verification (operator device)

- [ ] Fresh login (PIN → workspace) succeeds  
- [ ] `/dashboard` loads (gate cookie minted)  
- [ ] One protected API action works (e.g. Floor refresh / Map)  
- [ ] Logged-out / cleared cookie redirects to `/login`  
- [ ] Confirm cron still listed in Vercel → Cron (no need to wait for Sunday if schedule visible)  

### Phase 3 — Follow-up (not blocking first deploy)

- [ ] Run read-only RLS SQL in Supabase  
- [ ] If historical demo PINs suspected, rotate via bootstrap / PIN reset (**separate** ops)  

---

## H. Rollback procedure

### If deploy breaks operator login

1. **Do not** wipe `HUB_GATE_SECRET` without a plan — empty secret fail-closes minting on SEC-001 code.  
2. Prefer **redeploy previous production deployment** (Vercel → Deployments → … → Promote/Rollback to pre-SEC-001).  
3. Pre-SEC-001 code may again accept fallback signing; sessions minted under new `HUB_GATE_SECRET` will not verify on old code if old code uses a different secret chain — **fresh login required after any rollback**.  
4. HTTP recovery: if SEC-001 code is live and gate is broken but `BOOTSTRAP_SECRET` is set, bootstrap remains edge-reachable.  
5. Local recovery: `node --env-file=.env.local scripts/bootstrap-admin.mjs` with service role + `HUB_MASTER_PIN` (does not fix Vercel env; repairs roster/auth linkage).

### Secret-change implication

Rolling back **code** does not restore cookies signed under a different secret. Always plan on **fresh authentication** after secret or code rollback.

---

## I. Test results (this audit)

| Check | Result |
|-------|--------|
| Typecheck | (run in session) |
| SEC-001 + SEC-002 security/readiness tests | (run in session) |
| Full suite | (run in session) |
| Production build | (run in session) |
| Lint | Reported separately; pre-existing debt |

---

## J. Unresolved blockers

1. **Vercel Production `HUB_GATE_SECRET` presence UNKNOWN** — missing → operator lockout after deploy.  
2. **Vercel Production `BOOTSTRAP_SECRET` presence UNKNOWN** — missing → HTTP recovery unavailable (script still OK locally).  
3. End-to-end Production login not exercised (boundary).  
4. Production RLS posture not inspected (script ready; not run).  
5. Local `.env.local` also lacks the new secrets — local E2E login against fail-closed gate not possible until configured.

---

## K. GO / NO-GO

# **NO-GO**

**Reason:** Required Production environment variables for ALIGN-SEC-001 cannot be confirmed from this environment, and deploying fail-closed gate/bootstrap code without `HUB_GATE_SECRET` (and preferably `BOOTSTRAP_SECRET`) risks locking out the sole operator.

**Becomes GO when operator confirms (checkbox):**

- [ ] Production `HUB_GATE_SECRET` is set to a dedicated non-empty value  
- [ ] Production `BOOTSTRAP_SECRET` is set to a dedicated value ≠ `CRON_SECRET`  
- [ ] Existing Production `HUB_MASTER_PIN`, `CRON_SECRET`, and Supabase trio remain set  
- [ ] Operator is ready to perform a **fresh login** immediately after deploy  

Then follow §G Phase 1–2. Authorization to deploy remains a **separate** operator decision.

---

*End of ALIGN-SEC-002.*
