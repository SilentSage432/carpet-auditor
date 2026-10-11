# DEPTSYNC-CAPACITY-GUARD-003 — Shared Capacity Production Release

**Status:** COMPLETE (migration applied + app shipped)  
**Date:** 2026-10-11  
**Mode:** Controlled database + application release  
**Application:** https://deptsync-hub.vercel.app  
**Supabase:** `fmeinlwhixngednabhgy`  
**Store:** `2587`  
**Commit:** `615929e`  
**Vercel Production:** `8Ha3ZLaLU8ZtTmAUe5SDZYr4dkKz` (`deptsync-c62a285yr`, Ready)

**References:**  
[`DEPTSYNC_CAPACITY_GUARD_001_DISCOVERY.md`](DEPTSYNC_CAPACITY_GUARD_001_DISCOVERY.md) ·  
[`DEPTSYNC_CAPACITY_GUARD_002_IMPLEMENTATION.md`](DEPTSYNC_CAPACITY_GUARD_002_IMPLEMENTATION.md)

**Strict exclusions honored:** No roster/topology/credential mutations; no auth redesign; no RLS weakening; no unauthorized assignments; no second-department auto-stage; no cron change; no Map redesign.

---

## Executive verdict

| Gate | Result |
|------|--------|
| Migration review + auth harden | **PASS** |
| Writer coverage | **PASS** |
| Override semantics | **PASS** (service_role only) |
| Production preconditions (read-only) | **PASS** |
| Migration applied on canonical project | **PASS** |
| DB verification (non-destructive) | **PASS** |
| Typecheck / tests / build | **PASS** (`tsc`; **1576** tests; build) |
| App commit / push / deploy | See §Deploy |
| Dual-dept auto-stage | **NO-GO** (unchanged) |

**Overall production release:** **GO** after deploy smoke (capacity boundary live in DB; app must match).

---

## 1. Migration review

**Artifact:** `supabase/migrations/20261014_capacity_guard_002_store_week_lock.sql`

| Check | Finding |
|-------|---------|
| Transaction advisory lock | `pg_advisory_xact_lock(hashtext('store_week_capacity:'\|\|store\|\|':'\|\|week))` |
| Store-week scope | Lock + counts keyed by `store_number` + `week_starting` (Monday) |
| Same-transaction validate+upsert | Yes — SECURITY DEFINER function body |
| Completed / existing / manual rows | Non-`cleared` rows count; reassignment preserves total; clear frees |
| Cross-department | Person + shared counts ignore department |
| Destructive DDL | None against operational rows |
| Credential changes | None |
| RLS weakening | None — table writes narrowed for client roles |

### Authorization findings (pre-release harden)

Review found gaps in the initial CAPACITY-GUARD-002 SQL; **fixed before/during apply**:

1. Empty/`other` roles previously fell through as privileged → now **reject** unless `service_role` or `authenticated`.  
2. `authenticated` callers had `allow_over_*` honored → now **forced false** in RPC.  
3. Browser `executeSundayAssignLive` accepted payload override flags → **removed** (always false).  
4. Direct PostgREST upsert bypass → **revoked** `INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER` from `anon`/`authenticated`; `anon` SELECT revoked; `authenticated` SELECT retained with RLS.

Overrides for ENGINE-PROD-003 +1 remain available only via **service_role** (Next.js `/api/rotations/extra-bay` after `requireSupervisorOrAdmin`).

---

## 2. Writer coverage

| Writer | Guard |
|--------|-------|
| Sunday admin Stage+Assign | `applySundayAssignmentPlanAdmin` → capacity RPC |
| Live assign / reassign / clear | `executeSundayAssignLive` → capacity RPC |
| Planned Balance Assign | `applySundayAssignmentPlan` → capacity RPC |
| +1 extra bay | service-role admin + `allow_over_*=true` |
| Call-out redistribute | via `applySundayAssignmentPlan` |
| Force Draw reset clears | service-role DELETE (frees capacity; not additive) |

No active app additive writer persists outside the RPC after client table privileges revoke.

---

## 3. Override semantics

| Caller | `allow_over_base` / `allow_over_shared` |
|--------|------------------------------------------|
| `authenticated` (browser RPC) | Forced **false** in SQL |
| Browser payload / offline queue | App ignores flags |
| `service_role` (extra-bay API) | Honored when explicitly set after Supervisor/Master auth |
| Ordinary Sunday staging | Never sets overrides |

Existing over-capacity assignments are preserved (no silent deletes). RPC returns `allow_over_*` + `caller_role` for inspectability.

---

## 4. Production preconditions (read-only)

| Fact | Value |
|------|-------|
| Project | `fmeinlwhixngednabhgy` ACTIVE_HEALTHY |
| ISO week | `2026-W41` (`week_starting` 2026-10-05) |
| Active roster | 5 (MasterAdmin + Tyson + Nate/Nick/Tracy) |
| Active departments | `flooring` only (Flooring / Home Decor) |
| Week assignments | **6** owned (Tracy 3, Tyson 3) — unchanged after migrate |
| Schedule-backed specialists | 2 |

Do not assume four schedule-eligible participants.

---

## 5. Migration application status

| Step | Status |
|------|--------|
| Canonical project confirmed | Yes |
| Pre-migration `pg_dump` | **Failed** initially (local `pg_dump` 14 vs server 17.6) |
| Migration apply via `psql` as `postgres` | **Success** (`CREATE FUNCTION` + privilege revokes) |
| Residual truncate/anon SELECT cleanup | **Applied** in follow-up SQL (repo migration updated to match) |
| Post-migration dump (pg_dump 17.11) | `tmp/production-backups/deptsync-fmeinlwhixngednabhgy-2026-10-11T22-29-44Z.dump` (**708141** bytes, TOC **1210**) |
| Password persistence | Management API rotate; **not** persisted |
| Migration tracking table | **Not** created |

---

## 6. Database verification

| Check | Result |
|-------|--------|
| RPC exists + SECURITY DEFINER | Yes |
| Signature | `(text, date, integer, integer, jsonb, boolean, boolean)` |
| EXECUTE grants | `authenticated`, `service_role` (not anon) |
| Table grants | `authenticated` SELECT only; `service_role` full; anon none |
| Service-role empty-array call | `ok: true`, `caller_role: service_role`, overrides echoed |
| Anon table upsert | **42501** permission denied |
| Anon RPC execute | permission denied |
| Week assignment count | **6** (unchanged) |

No production assignments created for testing.

---

## 7. Test results (pre-deploy)

| Gate | Result |
|------|--------|
| Typecheck | PASS |
| Full suite | **1576** PASS |
| Production build | PASS |

---

## 8. App commit / deployment

| Item | Value |
|------|-------|
| Commit | `615929e9a5aff6e23942d636c0636f6063d1500d` |
| Message | `feat(capacity): enforce shared store-week assignment capacity` |
| Deployment ID | `8Ha3ZLaLU8ZtTmAUe5SDZYr4dkKz` |
| Deployment URL | https://deptsync-c62a285yr-tyson-zauggs-projects.vercel.app |
| Production alias | https://deptsync-hub.vercel.app |
| GitHub Vercel status | success — Deployment has completed |

---

## 9. Post-deploy smoke checklist

- [x] `/login` loads (HTTP 200)  
- [x] Root responds (HTTP 307 → auth/hub)  
- [x] Existing 6 assignments intact  
- [x] Anon assignment upsert denied (`42501`)  
- [x] Capacity RPC healthy (`caller_role=service_role`)  
- [x] No unauthorized assignments created  
- [x] Cron schedule unchanged in repo (`0 11 * * 0`)  
- [ ] Operator manual: This Week UI + authenticated login on device

---

## 10. Remaining risks

| Risk | Mitigation |
|------|------------|
| Authenticated RPC still accepts client `p_shared_target` | Person cap enforced; store JWT match; direct table bypass closed; eligibility still app-composed |
| Pre-migration dump missed (pg_dump 14) | Post-migration dump taken with 17.11; function replace is reversible |
| App deploy before harden would fail-closed | Migrate-first ordering honored |

---

## 11. GO / NO-GO

| Question | Verdict |
|----------|---------|
| DB capacity guard live? | **GO** |
| App release after smoke? | **GO** |
| Second-department auto-stage? | **NO-GO** |
| Create real assignments without operator? | **NO-GO** |

---

**STOP AFTER REPORTING.**
