# DEPTSYNC-CAPACITY-GUARD-001 — Shared Weekly Rotation Capacity Discovery

**Status:** COMPLETE (read-only architectural investigation)  
**Date:** 2026-10-11  
**Mode:** Read-only — no implementation, no production mutations, no schema, no cron changes, no deployment  
**Application:** https://deptsync-hub.vercel.app  
**Supabase:** `fmeinlwhixngednabhgy`  
**Pilot store:** `2587`

**References:**  
[`DEPTSYNC_CLEANUP_001_WORKSPACE_DISCOVERY.md`](DEPTSYNC_CLEANUP_001_WORKSPACE_DISCOVERY.md) ·  
[`DEPTSYNC_CLEANUP_002_GUIDED_WORKSPACE_CLEANUP.md`](DEPTSYNC_CLEANUP_002_GUIDED_WORKSPACE_CLEANUP.md) ·  
[`DEPTSYNC_CLEANUP_003_RELEASE_VERIFICATION.md`](DEPTSYNC_CLEANUP_003_RELEASE_VERIFICATION.md) ·  
[`DEPTSYNC_ALIGN_TOPO_001_TWO_DEPARTMENT_TOPOLOGY_RECONCILIATION.md`](DEPTSYNC_ALIGN_TOPO_001_TWO_DEPARTMENT_TOPOLOGY_RECONCILIATION.md) ·  
[`DEPTSYNC_RD_6_PRODUCT_COMPLETION_AUDIT.md`](DEPTSYNC_RD_6_PRODUCT_COMPLETION_AUDIT.md)

**Not authorized by this tranche:** rotation engine changes, cron changes, new assignments, roster/topology mutations, production SQL writes, dual-department automatic staging, schema migrations, deployment, commit, push.

---

## 1. Executive summary

The Sunday engine already implements **per-department** automatic volume as:

```text
eligible associates (LAB-WEEK-002) × BASE_WEEKLY_BAY_QUOTA (3)
```

That calculation runs independently inside `dispatchWeeklyPlanForDepartment`, and the cron loop invokes it once per active department. Floor Command UI already cites a **shared** 4×3=12 planning model, but the engine does **not** enforce a cross-department pool.

**Production (store 2587, inspected read-only 2026-10-11):**

| Count | Value | Meaning |
|-------|------:|---------|
| Active roster | **5** | MasterAdmin + Supervisor + 3 Associates |
| Intended operational team | **4** | Exclude MasterAdmin |
| Rotation-eligible this ISO week (with schedule evidence) | **2** | Tracy + Tyson |
| Staged/owned this week | **6** | Matches 2 × 3 |
| Active departments | **1** | `flooring` named “Flooring / Home Decor” |
| Separate Home Decor department | **None** | Still merged |

Workspace cleanup has already narrowed the roster and retired foreign aisles. Double×3 is **not live today** because only one department is active — but it becomes the blocking risk the moment a second department auto-stages.

**Verdict**

| Question | Result |
|----------|--------|
| Discovery complete? | **GO** |
| Implement shared capacity guard next? | **CONDITIONAL GO** — design below is sufficient to authorize an implementation tranche |
| Dual-department Sunday auto-stage now? | **NO-GO** until guard ships and is tested |
| Production mutation from this report? | **NO-GO** |

---

## 2. Verified active roster

### 2.1 Production facts (store 2587)

Read-only SELECT against `fmeinlwhixngednabhgy` (service-role). No writes.

**Active roster (5):**

| Name | Role | Status | Home / assigned | Active |
|------|------|--------|-----------------|--------|
| Master Admin | MasterAdmin | active | home `null`, assigned `all` | yes |
| Tyson | Supervisor | active | home `flooring`, assigned `flooring` | yes |
| Nate | Associate | invited | home `null`, assigned `flooring` | yes |
| Nick | Associate | invited | home `null`, assigned `flooring` | yes |
| Tracy | Associate | invited | home `null`, assigned `flooring` | yes |

**Inactive / suspended:** 30 rows (`is_active=false`, `status=suspended`) — consistent with guided soft-archive after CLEANUP-002/003 capability release.

**Departments (store 2587):** only `flooring` (`Flooring / Home Decor`) is `is_active=true`. All other store departments are inactive. No `home_decor` code.

**Topology after cleanup (flooring):** 192 active surfaces, 0 inactive flooring surfaces, **96** active physical bays (eligible), aisles `5, 7, 41, 42, 43, 44`. Foreign departments show retired surfaces only (e.g. Paint 0/118, Electrical 0/236, Cabinets 0/38).

**This week (ISO `2026-W41`, Mon `2026-10-05`–Sun `2026-10-11`):**

- Active `weekly_rotations`: 6 (all `verification_status=PENDING`, none completed)
- `sunday_bay_assignments`: 6 (`status=assigned`) — Tracy 3, Tyson 3
- Nate / Nick: 0 shift rows → not rotation-eligible this week
- Tracy: known ON_DUTY hours ≈ 43; Tyson ≈ 26.5

### 2.2 Distinguish three counts

| Concept | Production now | Notes |
|---------|---------------:|-------|
| **Active roster count** | 5 | `is_active !== false` |
| **Intended operational team** | 4 | Operator model: four people; MasterAdmin out |
| **Rotation-eligible count** | 2 this week | Active + non-Master + home dept match + known ON_DUTY hours > 0 |

Do **not** assume four eligible associates every Sunday. Eligibility is evidence-driven (`composeWeekLaborAvailability` → `allocatable`).

### 2.3 Role / eligibility rules (code)

| Rule | Behavior | Citation |
|------|----------|----------|
| Active | `is_active !== false` only (status `invited` does not block) | `labor-availability.ts` `isActiveMember` ~L189–191 |
| MasterAdmin | Never eligible | `isEligibleAggregateMember` ~L324–331 |
| Supervisor | Eligible when home-scoped + hours | Same; ENGINE-PROD-002 includes Supervisor |
| Home department | `specialistHomeDepartment`: prefer `home_department`, else `assigned_department`, else default `flooring` | `lib/types.ts` ~L337–350 |
| Hours | Known ON_DUTY duration > 0 somewhere Mon–Sun; call-out days excluded | `composeWeekLaborAvailability` ~L675–746 |
| Sections | Stewardship only — not eligibility | `operational_sections` comments; RD-3 |

### 2.4 Eligibility inconsistencies (observation only)

1. **Nate / Nick** are active roster members on flooring but have **no** `associate_shift_days` for the current week → excluded from automatic dispatch until schedules exist.  
2. Three associates remain `status=invited` while active — login/onboarding state, not rotation gating.  
3. MasterAdmin correctly excluded; participates as operator, not bay owner.  
4. No Home Decor-specific home codes yet — all four operational people resolve to `flooring`.

---

## 3. Current Sunday staging architecture

### 3.1 Execution path

```text
vercel.json cron  "0 11 * * 0"
  → GET /api/cron/weekly-rotation          (CRON_SECRET)
    → runWeeklyRotationForAllDepartments   (rotations.ts ~1286)
      → runSundayDispatchForAllDepartments (sunday-dispatch.ts ~860)
        → for each active store:
             evaluateSundayAutoRun (sunday-schedule)
             for each departments.is_active=true:
               dispatchWeeklyPlanForDepartment
                 → labor eligibility (eligibleCount)
                 → resolveAutomaticWeeklyBayTarget(eligibleCount)   ★ per dept
                 → ALREADY_COMPLETE short-circuit
                 → generateWeeklyRotations(..., targetBays)
                 → planFlatBayAssignmentsWithCaps (remaining ≤ 3)
                 → applySundayAssignmentPlanAdmin (upsert)
```

| Stage | File | Lines (approx.) |
|-------|------|-----------------|
| Cron schedule | `vercel.json` | L2–6 |
| Cron HTTP | `app/api/cron/weekly-rotation/route.ts` | L26–57 |
| Cron adapter | `lib/store-ops/rotations.ts` | L1286–1315 |
| Multi-dept loop | `lib/store-ops/sunday-dispatch.ts` | L860–915 |
| Per-dept Stage+Assign | same | L444–854 |
| `eligible × 3` | `lib/store-ops/week.ts` `resolveAutomaticWeeklyBayTarget` | L25–32 |
| Call site | `sunday-dispatch.ts` | L554–558 |
| Bay selection | `rotations.ts` `generateWeeklyRotations` → `selectPhysicalBayCoverage` | L845–1047; `physical-bay.ts` L214+ |
| Ownership write | `sunday-dispatch.ts` `applySundayAssignmentPlanAdmin` | L197–256 |
| Manual Stage API | `app/api/rotations/generate/route.ts` | SuperAdmin generate (count override / force) |
| Manual Assign UI | `components/admin/SundayAuditAssignmentModal.tsx` | Balance Assign / flat planner |

### 3.2 Where `eligible × 3` is calculated

```25:32:lib/store-ops/week.ts
export function resolveAutomaticWeeklyBayTarget(
  eligibleAssociateCount: number,
  quotaPerPerson = 3
): number {
  const n = Math.max(0, Math.floor(Number(eligibleAssociateCount) || 0));
  const q = Math.max(0, Math.floor(Number(quotaPerPerson) || 0));
  return n * q;
}
```

Called **inside** `dispatchWeeklyPlanForDepartment` after department-scoped labor composition:

```554:558:lib/store-ops/sunday-dispatch.ts
    const eligibleCount = plannerMembers.length;
    const targetBays = resolveAutomaticWeeklyBayTarget(
      eligibleCount,
      BASE_WEEKLY_BAY_QUOTA
    );
```

**Independence:** Yes — each active department computes its own `eligibleCount` and `targetBays`. The outer loop (`runSundayDispatchForAllDepartments` L902–911) does not share a budget.

### 3.3 Duplicate prevention / retry / errors

| Mechanism | Behavior |
|-----------|----------|
| Early complete | `planIsComplete` → `ALREADY_COMPLETE` / short `INSUFFICIENT_BAYS` without rewrite (`sunday-dispatch.ts` L599–621) |
| Stage skip | `generateWeeklyRotations` `skipIfExists` when rotations already present (L858–868) |
| Race reload | If generate skipped but local count empty, refresh (L640–646) |
| Ownership preserve | Only unowned staged bays get new assignments; remainingCap = 3 − owned (L662–748) |
| Upsert key | `(store_number, department, week_starting, bay_id)` — bay-level idempotent, not person-level |
| Force overwrite | Cron never sets `forceOverwrite`; Force Draw / admin generate can |
| Errors | Caught → `status: ERROR` with reason; does not invent labor |

### 3.4 Current production safety accident

Single active `flooring` department prevents live double×3. Risk materializes when a second active department enters the Sunday loop with overlapping eligible people.

---

## 4. Existing weekly capacity semantics

### 4.1 Truth tables

| Dimension | Owner | Semantics |
|-----------|-------|-----------|
| Week boundary | ISO week label `YYYY-Www` on `weekly_rotations.assigned_week` | Mon–Sun via `isoWeekCalendarRange` / `isoWeekToMondayDate` |
| Assignment week key | `sunday_bay_assignments.week_starting` | Monday date of that ISO week |
| Store scope | `store_number` (+ `store_id` on rotations) | Must isolate capacity per store |
| Department scope | `departments.id` / code on assignments | Today capacity is **per department** |
| Associate identity | `roster_specialist_id` (primary) / `assigned_specialist_id` | Ownership |
| Bay identity | `weekly_rotations.id` stored as `bay_id`; physical key = `department_id\|aisle\|bay` | One physical bay per active rotation row (BAY-UNIT-002) |
| Assignment status | `pending` / `assigned` / `completed` / `cleared` | Cleared ≠ owned |
| Staged plan | Active `weekly_rotations` (`superseded_at IS NULL`) | Historical supersedes preserved |
| Manual + auto | Same tables | Manual Assign / +1 / Force Draw write same rows |
| Completion | `weekly_rotations.is_completed` + verification_status | Work evidence — not capacity release |

### 4.2 What should count toward shared weekly capacity

**Recommendation (architectural — not implemented):**

Count every **non-cleared** `sunday_bay_assignments` row for `(store_number, week_starting)` whose `bay_id` points at an **active** (non-superseded) `weekly_rotations` row for that week — **across Flooring + Home Decor**.

| Case | Consumes capacity? |
|------|--------------------|
| Staged + owned (`assigned`) | **Yes** |
| Assignment `status=completed` | **Yes** — completion does not free the week’s slot |
| Rotation `is_completed` / verified | **Yes** — completed work still used this week’s quota |
| `status=cleared` | **No** |
| Superseded rotations / Force Draw cleared | **No** (assignments cleared with reset) |
| Extra bay (+1 ENGINE-PROD-003) | **Yes** for person/store week (explicit DS override above base 3 — see §7) |
| Open-only counting | **Reject** — would allow restaging after completion |

Presentation already separates planned / assigned / verified (`this-week-ownership.ts`); capacity accounting must not equate “remaining open work” with “remaining assignable capacity.”

### 4.3 UI citation vs engine

```31:38:lib/store-ops/this-week-ownership.ts
/**
 * Blueprint shared team model: four people × three bays = 12.
 * Engine stages `eligibleAssociateCount × BASE_WEEKLY_BAY_QUOTA` (not a hard
 * constant). Presentation cites the shared model without rewriting dispatch.
 */
export const SHARED_TEAM_CAPACITY_SLOTS = 4;
export const SHARED_TEAM_WEEKLY_CAPACITY =
  SHARED_TEAM_CAPACITY_SLOTS * BASE_WEEKLY_BAY_QUOTA;
```

`ThisWeekCommandSummaryCard` states one pool across Flooring and Home Decor while also admitting Sunday stages `eligible × 3` without a fixed 12-bay lock — accurate today for a single department, misleading once two departments auto-stage.

---

## 5. Operational Section relationships

| Question | Finding |
|----------|---------|
| How sections group bays | Named overlay of physical keys `(department_id, aisle, bay)` via `operational_section_members` |
| Stewards | Optional `primary_owner_specialist_id` on `operational_sections` — **not** weekly ownership |
| Affects rotation eligibility today? | **No** — dispatch never reads sections |
| Department relation | Section belongs to exactly one `department_id`; members must match (Art. V-A) |
| Retired aisles/bays | Soft-retire locations does not auto-retire sections; members may be empty |
| Span departments? | **No** — schema + API reject cross-dept members |

**Production:** one active section “Section A” on flooring, steward Nick, **0 members**. Irrelevant to capacity math.

**Non-goals preserved:** sections remain operational groupings — not scores, not automatic weekly assignments.

---

## 6. Bay eligibility findings

Selection path: `generateWeeklyRotations` → pending/carry pools (`is_active=true`, not SHOWROOM) → `selectPhysicalBayCoverage`.

| Check | Enforced? | Where |
|-------|-----------|-------|
| Active aisle/bay surfaces | Yes | `loadPendingLocations` / carry pool `.eq("is_active", true)` |
| Active bay eligibility helper | Yes | `isEligibleRotationLocation` — active + not `SHOWROOM_STACKOUT` |
| Department scope | Yes | All queries filtered by `department_id` |
| Existing assignment exclusion | Partial | Skip generate if week already staged; does not exclude other departments’ bays (N/A same physical key under other dept) |
| Rotation history / cycle | Yes | Cycle PENDING pool + carry-over / seasonal / High / velocity order |
| Specialty exclusions | SHOWROOM_STACKOUT only | No specialty-aisle table |
| Retired topology | Soft-retire removes from pool | Cleanup correctly zeroed foreign active surfaces |

**Cleanup impact (verified):** Foreign department surfaces are inactive → not in draw pools. Flooring candidate pool is aisles 5/7/41–44 (96 physical). Do not reactivate retired locations for capacity work.

---

## 7. Shared capacity design recommendation

### 7.1 Intended law

```text
Max 3 base automatic assignments per eligible associate per store-week
Shared pool = (distinct eligible associates across Flooring + Home Decor) × 3
Expected operating model with 4 eligible: 12 total — not 12 per department
```

### 7.2 Smallest safe change (design only)

Introduce a **store-week capacity composer** consumed by Sunday orchestration **before** per-department generate/assign. Prefer composition over a second allocator.

**Proposed ownership**

| Concern | Owner |
|---------|-------|
| Shared eligibility union + remaining caps | New pure composer in `lib/store-ops/` (e.g. `shared-week-capacity.ts`) |
| Sunday orchestration | `runSundayDispatchForAllDepartments` / `dispatchWeeklyPlanForDepartment` |
| Persistence truth | Existing `sunday_bay_assignments` + active `weekly_rotations` |
| Presentation | `this-week-ownership` / This Week UI (later tranche) |

**Algorithm (conceptual)**

1. Resolve store + ISO week.  
2. Load active workforce once; compose labor **per coverage department**, then union specialists who are allocatable in **any** participating department (Flooring / Home Decor allowlist).  
3. `sharedEligibleCount = |union|`.  
4. `sharedTarget = sharedEligibleCount × BASE_WEEKLY_BAY_QUOTA`.  
5. Load **all** non-cleared assignments for `store_number + week_starting` joined to active rotations in participating departments.  
6. Per associate: `remaining = max(0, 3 − ownedAcrossDepts)` for **base** automatic fill.  
7. Shared remaining slots: `sharedTarget − ownedAcrossDeptsTotal` (or sum of remaining caps — same when every owner is in the eligible union).  
8. When staging department D:  
   - Draw at most `min(owedInD, remainingSharedSlots, sum(remainingCaps))`.  
   - Assign only using cross-dept remaining caps (`planFlatBayAssignmentsWithCaps` already accepts a cap map).  
9. After department D finishes, refresh shared counters before department D+1.  
10. Serialize store-week writers (see §8).

**What not to do**

- Do not hard-code 12 as the only legal total (eligible may be &lt; 4).  
- Do not double-count the same associate once per department.  
- Do not treat section stewards as automatic assignees.  
- Do not silently delete over-capacity history.  
- Do not activate second-dept auto-stage in the same PR as the guard without tests.

### 7.3 Manual + automatic overflow

- Base automatic dispatch respects shared caps.  
- ENGINE-PROD-003 “Add another bay” remains an **explicit DS override** above base 3 — either:  
  - **(A recommended)** still increments shared consumed count and surfaces over-base clearly, or  
  - **(B)** tagged `extra` and excluded from base completeness but still shown in capacity UI.  
- Prefer A for honesty: capacity display = all non-cleared owned bays; base completeness still checks ≈3 per eligible unless extras flagged.

### 7.4 Schema

**Prefer no migration first:** enforce in the service-role Sunday/manual writers with store-week serialization.  
**Optional later:** DB trigger or advisory lock helper; partial unique / check constraints are awkward for “≤3 per person across departments.” A `pg_advisory_xact_lock(hashtext(store||week))` RPC is additive and safe if needed.

---

## 8. Concurrency and idempotency risks

| Risk | Today | Guard need |
|------|-------|------------|
| Two departments stage in one cron pass | Sequential loop, but each ignores the other’s volume | Shared remaining after each dept |
| Concurrent cron + Force Draw / generate | No advisory lock; bay upsert only | Serialize store-week Stage+Assign |
| Client-side capacity check only | Insufficient | Server/service-role enforcement |
| Per-bay unique `(store, dept, week, bay_id)` | Prevents duplicate bay rows; **allows** 3+3 for same person across depts | Person-week cap in writer |
| Retry after COMPLETE | `ALREADY_COMPLETE` per dept | Must become shared-complete aware |
| Race on empty generate | Reload path exists | Keep; add shared recount |

**Existing tools that help:** upsert on bay key; `skipIfExists`; remainingCap map; ALREADY_COMPLETE.  
**Missing:** cross-department recount; store-week lock; person-week constraint.

---

## 9. Exception handling recommendations

| Case | Safe behavior |
|------|---------------|
| Manual override / Assign this week | Allow within shared remaining; if over, fail closed with clear reason — do not invent people |
| Associate absence / call-out | Existing LAB-WEEK: day excluded from hours; may drop eligibility → lower shared target; do not auto-rebalance completed plan |
| Ineligible associates | Skip; do not substitute |
| Midweek roster archive | Do not delete their existing week assignments; stop new automatic fills to them; operator reassigns intentionally |
| Retired bays midweek | Do not reactivate; Force Draw / supersede incomplete rows only under Master authority |
| Reassignment | Upsert new owner on same bay_id; capacity moves with ownership; no duplicate bay |
| Existing over-capacity weeks | Surface conflict on This Week; refuse automatic additive staging; never silent delete |
| MasterAdmin | Never auto-assigned |
| Fewer than four eligible | Shared target = N×3 (e.g. 2×3=6 as in production this week) |
| Declared weekly plan | Do not auto-rewrite operator Force Draw / manual plan to “fix” capacity |

---

## 10. This Week presentation opportunities

Existing surface: `FloorTab` → `composeThisWeekCommandSummary` → `ThisWeekCommandSummaryCard`.

**Future mobile-friendly additions (do not implement now):**

1. **Shared capacity** — `used / sharedTarget` (and cite blueprint 4×3 only when eligible≥4).  
2. **Per person** — assigned count vs base 3 (and extras).  
3. **Remaining assignable** — shared slots left (not “open work”).  
4. **Unassigned eligible bays** — staged unowned + owed-not-staged (separate lines).  
5. **Staging readiness** — schedule evidence missing for Nate/Nick style cases.  
6. **Over-capacity conflicts** — amber when ownedAcrossDepts > sharedTarget or any person > 3 base without explicit extra.

Prefer one compact strip + per-person rows already on the team board — avoid dashboard card sprawl.

---

## 11. Required regression tests

Do not implement in this tranche. Required coverage for CAPACITY-GUARD implementation:

| # | Scenario | Expectation |
|---|----------|-------------|
| 1 | One department, 4 eligible | Stage/own 12 total |
| 2 | Two departments, 4 eligible shared | Total ≤ 12 across both — not 24 |
| 3 | Four eligible associates | Each base ≤ 3 |
| 4 | Fewer than four eligible (e.g. 2) | Total ≤ 6 |
| 5 | Three assignments per person | Cap enforced across departments |
| 6 | Twelve total with four eligible | Exact complete plan |
| 7 | Repeated Sunday staging | Idempotent; no growth |
| 8 | Manual + automatic | Combined ≤ shared rules; overflow fail-closed |
| 9 | Concurrent staging requests | No over-allocation (lock/serialization) |
| 10 | Completed assignments | Still consume week capacity |
| 11 | Midweek roster changes | No silent deletes; eligibility changes only future fills |
| 12 | Retired aisles | Not drawn |
| 13 | Retired bays | Not drawn |
| 14 | Cross-store isolation | Store A capacity ≠ Store B |
| 15 | Reassignment | Same bay, new owner; counts move |
| 16 | Existing over-capacity week | Detect + refuse automatic additive fill |

Also retain ENGINE-PROD-002/003 contracts: Master exclusion, schedule fail-closed, physical-bay unit, +1 explicit path.

---

## 12. Proposed implementation sequence

1. **CAPACITY-GUARD-001A** — Pure composer + unit tests (no prod, no cron change).  
2. **CAPACITY-GUARD-001B** — Wire composer into `dispatchWeeklyPlanForDepartment` + store-week loop; serialize writers; keep single-dept behavior identical when only one active dept.  
3. **CAPACITY-GUARD-001C** — Manual Assign / generate / +1 paths honor shared remaining (fail closed).  
4. **CAPACITY-GUARD-001D** — This Week capacity presentation (optional same release).  
5. **Gate** — Dual-department auto-stage / Home Decor department activation only after 001B+C green.  
6. **ALIGN-DEPT / TOPO cutover** — additive Home Decor geography remains a separate authorized tranche.

---

## 13. GO / CONDITIONAL GO / NO-GO

| Gate | Verdict |
|------|---------|
| Discovery / design report | **GO** |
| Production mutations / engine changes in this tranche | **NO-GO** (honored) |
| Authorize implementation tranche CAPACITY-GUARD-001A/B | **CONDITIONAL GO** — after operator accepts shared-eligibility union + completed-work-still-counts + fail-closed overflow |
| Dual-department Sunday auto-stage | **NO-GO** until guard implemented + tests listed in §11 pass |
| Assume four eligible every week | **NO-GO** — production currently 2 with schedule evidence |

### Separated fact vs recommendation

| Verified production / code fact | Recommendation (not built) |
|---------------------------------|----------------------------|
| Engine computes `eligible×3` per active department | Compose shared store-week budget first |
| UI cites 4×3=12 without enforcement | Enforce in service-role writers |
| Store 2587: 5 active, 4 operational, 2 eligible this week, 6 owned | Target scales with eligibility evidence |
| One active department (`flooring` merge) | Guard before splitting Home Decor auto-stage |
| Bay upsert unique; no person-week unique | Add serialization + remainingCap across depts |
| Sections do not affect eligibility | Keep it that way |
| Cleanup retired foreign aisles / archived 30 associates | Candidate pool already narrowed correctly |

---

**STOP AFTER REPORTING.** No implementation. No production mutations.
