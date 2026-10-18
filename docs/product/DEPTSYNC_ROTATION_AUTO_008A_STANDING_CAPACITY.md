# DEPTSYNC-ROTATION-AUTO-008A — Standing Weekly Capacity Authorization

**Status:** COMPLETE — released to production via AUTO-008B (`5c36621`)  
**Date:** 2026-10-18  
**Mode:** Targeted implementation + validation (release: [`DEPTSYNC_ROTATION_AUTO_008B_RELEASE.md`](DEPTSYNC_ROTATION_AUTO_008B_RELEASE.md))  
**Store policy (operator-authorized):** 2587 · Tyson 3 / Nate 3 / Nick 3 / Tracy 3 = **12**  

**Strict exclusions honored (008A tranche):** No production assignment writes · `WEEKLY_ROTATION_AUTO_PUBLISH` remains **`false`** · no specialty · no Orient. Production migrate/deploy completed in AUTO-008B; MasterAdmin establish of standing 3/3/3/3 still outstanding.

---

## 1. Existing authorization architecture

| Layer | Owner | Role |
|-------|-------|------|
| Weekly approvals table | `store_week_capacity_approvals` | Authoritative per-week 0–3 caps + schedule fingerprints |
| Approval RPC | `upsert_store_week_capacity_approvals` | Advisory-locked write; stale/below-owned fail-closed |
| Assignment RPC | `upsert_sunday_bay_assignments_with_capacity` | Enforces approvals + section ownership |
| App domain | `approved-week-capacity.ts` | Fingerprints, review board, `approvals_complete` |
| Load path | `loadStoreWeekCapacity` → `loadApprovedStoreWeekCapacity` | Eligible = labor.members (AUTO-005A); approvals must be fresh |
| Sunday gate | `sunday-dispatch` / `loadAuthoritativeStageContext` | Requires `approvals_complete` for stage/publish |
| MasterAdmin UI/API | `/api/week-capacity` + Sunday drawer | Explicit **week** approve only (pre-008A) |

**AUTO-008 blocker:** future weeks (e.g. W44) had no approval rows → `approvals_complete=false` → automatic publication fail-closed.

**Smallest safe change:** add store-scoped **standing policy** that **materializes into** the existing weekly approvals contract — no parallel capacity engine.

---

## 2. Standing-policy implementation

| Piece | Path |
|-------|------|
| Domain | `lib/store-ops/standing-week-capacity.ts` |
| Tests | `lib/store-ops/rotation-auto-008a.standing-capacity.test.ts` |
| Migration (local) | `supabase/migrations/20261025_rotation_auto_008a_standing_capacity.sql` |
| API | `app/api/standing-capacity/route.ts` (GET / POST / DELETE) |
| Explicit provenance stamp | `app/api/week-capacity/route.ts` POST |
| Sunday hook | `runSundayDispatchForAllDepartments` → `materializeStandingCapacityForWeek` |
| Client | `fetchStandingCapacityPolicy` / `establishStandingCapacityPolicyClient` |
| UI | Sunday Audit drawer — standing policy panel (MasterAdmin) |

**Operator policy (to be established after migrate, via MasterAdmin):**  
Tyson=3, Nate=3, Nick=3, Tracy=3 · store 2587 · remains effective until MasterAdmin changes/revokes it.

---

## 3. Database changes (required for production later)

**Not applied this tranche.**

Additive tables:

1. `store_standing_capacity_policies` — versioned standing policy; one active per store  
2. `store_standing_capacity_policy_items` — specialist_id → approved_capacity 0–3  
3. `store_week_capacity_approval_provenance` — `explicit` | `standing` + optional `standing_policy_id`

Unique partial index: one `is_active=true` policy per store. RLS: authenticated SELECT via `jwt_matches_store`; writes service-role only.

Does **not** alter `store_week_capacity_approvals` columns or assignment tables.

---

## 4. Policy provenance

| Source | Meaning |
|--------|---------|
| `standing` | Materialized from active standing policy (records `standing_policy_id`, `materialized_at`) |
| `explicit` | MasterAdmin weekly `/api/week-capacity` POST |
| Legacy row, no provenance | Treated as **explicit** — standing materialization will **not** overwrite |

Standing materialization never invents associates outside the policy or outside the eligible labor.members set.

---

## 5. MasterAdmin authorization

| Action | Gate |
|--------|------|
| Establish / replace standing policy | `requireSuperAdmin` on POST `/api/standing-capacity` |
| Revoke standing policy | `requireSuperAdmin` on DELETE |
| Read active policy | Authenticated store actor GET |
| Explicit week override | Existing MasterAdmin week approve (stamps `explicit`) |

Unauthorized writers fail at the API boundary. No request-body role elevation.

---

## 6. Weekly materialization behavior

`planStandingCapacityMaterialization` / `materializeStandingCapacityForWeek`:

1. Load active standing policy (fail closed if missing when schema ready).  
2. Resolve eligible associates (shift-independent membership).  
3. Compute live schedule fingerprints.  
4. **Skip** if week already has owned assignments (`PUBLISHED_WEEK_PROTECTED`).  
5. **Skip** explicit provenance rows (do not overwrite).  
6. Write missing/stale/standing-outdated rows via existing `writeWeekCapacityApprovals` RPC.  
7. Stamp provenance `standing`.

Idempotent: fresh standing rows → `ALREADY_COMPLETE` / nothing to write.

Schema missing → skip with `STANDING_CAPACITY_SCHEMA_MISSING` (weekly path unchanged).

---

## 7. Automatic publication integration

Sunday cron path (still latch **OFF** today):

```text
evaluateSundayAutoRun
  → materializeStandingCapacityForWeek (if schema + active policy)
  → loadStoreWeekCapacity (approvals_complete can become true)
  → dispatchWeeklyPlanForDepartment
       → STAGED_AWAITING_ASSIGN while latch false
       → publish path only when dual-gate ON (future AUTO-008)
```

No bypass of approval enforcement. No manual week approve required **after** standing policy exists and schema is migrated.

---

## 8. Concurrency guarantees

| Concern | Guarantee |
|---------|-----------|
| Repeated Sunday runs | Idempotent plan + approval RPC upsert |
| Concurrent writers | Existing `pg_advisory_xact_lock` in approval RPC |
| Partial failure | Fail closed; retry rematerializes remaining |
| Policy change mid-flight | New version id; rematerializes standing-sourced future weeks only |
| Explicit week override | Preserved across standing rematerialization |
| Published week | Owned assignments → skip materialization |

---

## 9. Regression results

| Suite | Result |
|-------|--------|
| AUTO-008A standing-capacity | **19 PASS** |
| Approved week capacity | **18 PASS** |
| AUTO-006 / 003 / 005A / 002 / ownership / stewardship / sunday-dispatch / SEC-OPS-010 | Included |
| Focused total this pass | **11 files / 199 PASS** |
| `npx tsc --noEmit` | **PASS** |
| ESLint (new/core changed files) | **PASS** (0 errors) |
| `npm run build` | **PASS** |
| Product latch | **`WEEKLY_ROTATION_AUTO_PUBLISH = false`** |

Covered scenarios: W44/W45 3/3/3/3 plans · missing policy fail-closed · zero-shift fingerprints · explicit override survival · published-week protection · prospective policy change · incomplete policy · unauthorized empty items · contracts (no parallel assign RPC, migration additive, MasterAdmin gate).

---

## 10. Production migration requirements

Completed in AUTO-008B (see release report). Remaining for W44 readiness:

1. ~~Apply migration~~ / ~~Deploy app~~ — done in 008B.  
2. MasterAdmin: **Establish standing** Tyson/Nate/Nick/Tracy = 3/3/3/3 (Sunday drawer).  
3. Confirm W44 empty of owned assignments; next Sunday materializes approvals then stages (latch still OFF → no auto-publish).  
4. Only then re-authorize AUTO-008 dual-gate enablement.

**Do not** invent production policy rows via unrestricted SQL.

---

## 11. Remaining blockers

1. **Standing policy not yet established in production** — MasterAdmin UI action required (008B §14).  
2. **AUTO-008 dual-gate still OFF** — intentional.  
3. Fingerprint drift after materialization still invalidates until next rematerialize (by design).  
4. Pre-existing Sunday modal eslint `set-state-in-effect` warning on reload effect (unchanged).

---

## 12. GO / NO-GO verdict

| Decision | Verdict |
|----------|---------|
| Local AUTO-008A implementation | **GO** |
| Production migrate / deploy | **GO** via AUTO-008B |
| Enable automatic publication | **NO-GO** |
| Modify production assignments / W44 | **NO-GO** (honored) |
| Specialty / Orient | **NO-GO** |

### Bottom line

Standing weekly capacity is a **prospective MasterAdmin policy** that materializes into the **existing** weekly approval tables with explicit provenance. Production schema + app are live (008B); operator must still establish 3/3/3/3. Automatic publication remains OFF.

**STOP.** Do not enable automatic publication. Complete MasterAdmin establish per AUTO-008B.
