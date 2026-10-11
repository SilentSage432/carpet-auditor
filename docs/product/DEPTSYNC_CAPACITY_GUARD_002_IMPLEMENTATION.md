# DEPTSYNC-CAPACITY-GUARD-002 — Shared Store-Week Capacity Enforcement

**Status:** COMPLETE (local implementation + tests; no production deploy / SQL apply)  
**Date:** 2026-10-11  
**Mode:** Controlled implementation  
**Reference:** [`DEPTSYNC_CAPACITY_GUARD_001_DISCOVERY.md`](DEPTSYNC_CAPACITY_GUARD_001_DISCOVERY.md)  
**Application:** https://deptsync-hub.vercel.app (unchanged)  
**Supabase:** `fmeinlwhixngednabhgy` (migration **not** applied)

**Strict exclusions honored:** No production SQL, no production assignments, no cron schedule changes, no roster/topology mutations, no second-department auto-stage activation, no production deployment.

---

## Executive verdict

| Gate | Result |
|------|--------|
| Capacity composer + writer wiring | **PASS** |
| Atomic concurrency boundary (migration file) | **PASS** (local) |
| Migration applied to production | **NOT DONE** (correct for this tranche) |
| Typecheck / tests / build | **PASS** (`tsc`; **1575** tests; production build) |
| Dual-dept auto-stage activation | **NO-GO** (unchanged) |

**Production release:** **CONDITIONAL GO** — apply migration `20261014_capacity_guard_002_store_week_lock.sql` **before** deploying app writers (writers fail-closed if RPC missing).

---

## 1. Selected capacity architecture

### Authority

| Concept | Implementation |
|---------|----------------|
| Store identity | `store_number` on assignments + capacity composition |
| Week boundary | ISO week label → `week_starting` Monday (`isoWeekToMondayDate`) |
| Eligible associates | Union of LAB-WEEK-002 allocatable roster ids across participating (active) department codes |
| Shared target | `eligible_count × BASE_WEEKLY_BAY_QUOTA` (3) — **not** hard-coded 12 |
| Per-person base max | 3 non-cleared owned assignments per roster id / store-week |
| Consumed capacity | All non-cleared `sunday_bay_assignments` for store+week (all departments), including `completed` |
| Remaining | `shared_target − owned_total`; per-person `3 − owned` |

**Module:** `lib/store-ops/shared-week-capacity.ts`  
**DB boundary:** `upsert_sunday_bay_assignments_with_capacity` (advisory `pg_advisory_xact_lock` + validate + upsert in one transaction)

### Why a migration was required

PostgREST auto-commits each statement. Check-then-upsert in application code cannot hold a lock across concurrent Vercel invocations. A weaker client-side count would violate the mission. Therefore an additive SECURITY DEFINER RPC was authored locally — **not** applied to production in this tranche.

---

## 2. Assignment-writing paths covered

| Path | File | Enforcement |
|------|------|-------------|
| Sunday automatic Stage+Assign | `sunday-dispatch.ts` → `applySundayAssignmentPlanAdmin` | Shared draw cap + capacity RPC |
| Manual Balance Assign / plan | `sunday-audit.ts` → `applySundayAssignmentPlan` | Capacity RPC batch |
| Single bay assign / reassign / clear | `sunday-audit.ts` → `executeSundayAssignLive` | Capacity RPC (clear always allowed) |
| Offline queue replay | same `executeSundayAssignLive` | Capacity RPC |
| Extra bay (+1) | `extra-bay-dispatch.ts` | RPC with `allow_over_base` + `allow_over_shared` (explicit DS override) |
| Call-out redistribute | `call-out.ts` → `applySundayAssignmentPlan` | Capacity RPC |

### Documented non-additive / free paths

| Path | Behavior |
|------|----------|
| Force Draw / week reset clears | `rotations.ts` `resetStagedWeekRotations` — clears/supersedes assignments (frees capacity; not an additive writer) |
| Direct PostgREST upsert bypass | Removed from `applySundayAssignmentPlanAdmin` and `executeSundayAssignLive`. Any unknown future writer must call `writeSundayAssignmentsWithCapacity`. |

---

## 3. Store-week boundary semantics

1. Load active workforce + Mon–Sun shift evidence once per store-week.  
2. For each participating department code (`departments.is_active=true` in the Sunday loop), compose labor eligibility; **union** roster ids.  
3. MasterAdmin never enters the union.  
4. Missing schedules → not eligible (not archived).  
5. Count non-cleared assignments across **all** departments for that store+week.  
6. Department stage draw = `min(deptEligible×3, remaining_shared, sum(person remaining))`.  
7. After each department pass, reload capacity before the next.  
8. Retries / repeated Sunday runs: existing complete plans short-circuit; RPC rejects additive overflow.

**Production context preserved:** with 2 schedule-eligible associates, shared target = 6; with 4 scheduled of the intended team, target = 12. Five roster rows ≠ five participants (Master excluded).

---

## 4. Eligibility rules

| Layer | Rule |
|-------|------|
| Active roster | `is_active !== false` |
| Schedule-backed eligibility | Known ON_DUTY hours > 0 in week (call-outs excluded) |
| MasterAdmin | Excluded from automatic participation |
| Assignment capacity | Independent of eligibility once historical rows exist — midweek schedule loss does **not** delete owned bays |
| Sections | Untouched — not used for automatic assignment |

---

## 5. Identity handling

- Canonical capacity identity = `roster_specialist_id` (`store_specialists.id`).  
- Optional verified link: `profiles.id` → `profiles.specialist_id` when roster id missing on a row.  
- **No** name-based merging.  
- Duplicate workforce rows with the same id count once.

---

## 6. Concurrency guarantees

| Mechanism | Guarantee |
|-----------|-----------|
| `pg_advisory_xact_lock(hashtext('store_week_capacity:'\|\|store\|\|':'\|\|week))` | Serializes writers for that store-week inside the RPC transaction |
| Validate + upsert in same function | Concurrent observers cannot both consume the last slot |
| App fail-closed if RPC missing | No unguarded upsert substitute |
| JWT store check for `authenticated` | Cross-store write rejected |
| `service_role` | Allowed for cron / admin |

---

## 7. Idempotency guarantees

| Case | Behavior |
|------|----------|
| Same owner rewrite | Allowed; no capacity change |
| Reassignment of owned bay | Allowed; shared total unchanged; new owner checked against person quota |
| Clear | Always allowed |
| Repeated Sunday when plan complete | `ALREADY_COMPLETE` / shared-filled skip |
| Shared capacity already filled | Refuse additive staging (`remaining_shared <= 0`) |
| Existing over-capacity week | Flagged; additive automatic fills refuse; no silent deletes |

---

## 8. Topology and section safety

- Bay selection still uses `is_active` + non-SHOWROOM pools (`generateWeeklyRotations` / `isEligibleRotationLocation`).  
- Retired aisles/bays remain excluded.  
- Operational Sections unchanged — no section-aware automatic assignment.

---

## 9. Test results

| Gate | Result |
|------|--------|
| Focused `shared-week-capacity.test.ts` | **23 PASS** |
| ENGINE-PROD-002 / 003 + balance contracts | **PASS** |
| Full suite | **1575 PASS** (125 files) |
| `tsc --noEmit` | **PASS** |
| `npm run build` | **PASS** |

Coverage includes: 1/2/4 eligible; 5 roster / 4 humans; missing schedules; 3/person; shared 12; one/two departments; completed + cleared; plan filter; RPC fail-closed; person/shared errors; migration contract; writer routing; no second-dept activation; retired eligibility gate; concurrent lock contract.

---

## 10. Migration requirements

**File (local only):** `supabase/migrations/20261014_capacity_guard_002_store_week_lock.sql`

**Must apply to production before app deploy**, otherwise assignment writers return fail-closed errors (`CAPACITY_RPC_MISSING`).

**Does:** create/replace one SECURITY DEFINER function; grants to `authenticated` + `service_role`.  
**Does not:** mutate rows, change cron, alter roster/topology, enable departments.

**Suggested release order**

1. Operator applies migration on `fmeinlwhixngednabhgy`  
2. Verify RPC via `select public.upsert_sunday_bay_assignments_with_capacity(... empty array ...)` smoke  
3. Deploy app  
4. Observe next Sunday / manual assign under capacity

---

## 11. Remaining risks

| Risk | Notes |
|------|-------|
| Hub dept code vs DB code (`paint` vs `D24P`) | Pre-existing labor match issue for non-flooring codes; production active dept is `flooring` only |
| Explicit +1 can exceed shared target | Intentional DS override (`allow_over_shared`) |
| Reset/clear path outside RPC | Frees capacity; acceptable; must not be used for additive assigns |
| Migration not yet live | App deploy without migration = assignment writes fail closed |

---

## 12. GO / CONDITIONAL GO / NO-GO

| Question | Verdict |
|----------|---------|
| Local implementation complete? | **GO** |
| Production SQL apply this tranche? | **NO-GO** (deferred to operator) |
| Production app deploy this tranche? | **NO-GO** |
| Production release after migration apply? | **CONDITIONAL GO** |
| Dual-department automatic staging? | **NO-GO** |
| Treat 5 roster rows as 5 participants? | **NO-GO** (Master excluded; schedules required) |

---

**STOP AFTER REPORTING.** No production deployment. No production mutations.
