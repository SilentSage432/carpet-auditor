# DEPTSYNC-SECTION-ROTATION-001 — Operational Section-Aware Weekly Rotation Discovery

**Status:** COMPLETE (read-only architectural investigation)  
**Date:** 2026-10-11  
**Mode:** Read-only — no implementation, no production mutations, no schema, no cron changes, no deployment  
**Application:** https://deptsync-hub.vercel.app  
**Supabase:** `fmeinlwhixngednabhgy`  
**Pilot store:** `2587`

**References:**  
[`DEPTSYNC_REDESIGN_001_COMPLETE_PRODUCT_EXPERIENCE_BLUEPRINT.md`](DEPTSYNC_REDESIGN_001_COMPLETE_PRODUCT_EXPERIENCE_BLUEPRINT.md) ·  
[`DEPTSYNC_CAPACITY_GUARD_001_DISCOVERY.md`](DEPTSYNC_CAPACITY_GUARD_001_DISCOVERY.md) ·  
[`DEPTSYNC_CAPACITY_GUARD_002_IMPLEMENTATION.md`](DEPTSYNC_CAPACITY_GUARD_002_IMPLEMENTATION.md) ·  
[`DEPTSYNC_CAPACITY_GUARD_003_RELEASE.md`](DEPTSYNC_CAPACITY_GUARD_003_RELEASE.md) ·  
[`DEPTSYNC_RD_3_OPERATIONAL_SECTIONS.md`](DEPTSYNC_RD_3_OPERATIONAL_SECTIONS.md)

**Not authorized by this tranche:** section-aware assignment generation, roster/schedule/topology/section mutations, assignment create/delete, cron changes, migrations, RLS/auth changes, dual-department auto-stage, Zebra integration, deployment, commit, push.

**Legend**

| Tag | Meaning |
|-----|---------|
| **VERIFIED** | Confirmed in repository (and prior production read-only inspections where cited) |
| **RECOMMENDATION** | Design judgment for a future implementation tranche |

---

## 1. Executive summary

Floor Command already connects physical topology, schedule-backed eligibility, weekly staging, flat ownership assignment, shared store-week capacity, and operator verification. Operational Sections exist as a **stewardship overlay** of explicit physical-bay membership — but the rotation engine **does not read them**.

| Layer | Reality today |
|-------|----------------|
| Physical topology | `store_locations` → physical bay `(department_id, aisle, bay)` |
| Operational Sections | RD-3 tables + APIs + Map/This Week labels |
| Associate schedules | LAB-WEEK-002 `composeWeekLaborAvailability` → allocatable |
| Weekly rotation history | Location aging / carry / High / seasonal + `weekly_rotations` |
| Shared store-week capacity | CAPACITY-GUARD-002/003 live (`shared-week-capacity.ts` + RPC) |
| Operator review | Stage → client plan preview → Assign this week → verify queue |

**Production context (from CAPACITY-GUARD-001/003, store 2587):** one merged Flooring / Home Decor department; intended team Tyson / Nate / Nick / Tracy (MasterAdmin administrative only); capacity derived from verified weekly eligibility (recent inspection: 2 schedule-eligible → 6 bays); one active section “Section A” stewarded by Nick with **0 members**.

**Implication:** section-aware selection cannot deliver operational value until sections have real bay membership. Stewardship alone is not enough.

**Verdict**

| Question | Result |
|----------|--------|
| Discovery complete? | **GO** |
| Implement automatic section-aware generation now? | **NO-GO** |
| Next design tranche (preview + hybrid preference)? | **CONDITIONAL GO** — after sections have membership, reuse existing Stage/Assign/capacity writers |
| Bypass or replace capacity guard? | **NO-GO** |
| Dual-department auto-stage? | **NO-GO** (unchanged) |
| Production mutation from this report? | **NO-GO** |

---

## 2. Verified Operational Section model

### 2.1 Canonical structures

| Structure | Role | Citation |
|-----------|------|----------|
| `operational_sections` | Named section identity + optional steward | `supabase/migrations/20261011_operational_sections.sql` L9–39 |
| `operational_section_members` | Active physical-bay membership | same file L45–66 |
| `operational_section_events` | Append-only stewardship history | same file L113–145 |
| Domain module | List/create/update/retire/members | `lib/store-ops/operational-sections.ts` |
| Types | `OperationalSectionRow`, `MemberRow`, `BaySectionLookup`, `View` | `operational-sections.ts` L12–63 |

### 2.2 Field inventory

| Concern | Verified fact | Citation |
|---------|---------------|----------|
| Section identity | UUID `id` | migration L10 |
| Section name | `name` (nonempty); active unique per `(store_id, department_id, lower(trim(name)))` | migration L17, L154–156 |
| Store association | `store_id` → `stores` | migration L11–13 |
| Department association | `department_id` → `departments`; members must match | migration L14–16, L41–42; `validateSectionCreateInput` L137–142 |
| Assigned steward | Optional `primary_owner_specialist_id` → `store_specialists`, `ON DELETE SET NULL` | migration L19–21, L38–39 |
| Associated aisles/bays | Explicit member rows `(department_id, aisle, bay)` | migration L56–62 |
| Section ordering | **No `sort_order` column.** List orders by `name` asc; members by aisle/bay | `listOperationalSections` L254; members L305–306 |
| Active/inactive | `is_active` + `retired_at` consistency check | migration L22–32 |
| Historical relationships | `operational_section_events` (`created`, `renamed`, `owner_changed`, `member_added`, `member_removed`, `retired`, `reactivated`) | migration L130–141 |

### 2.3 Membership shape

| Question | Verified answer |
|----------|-----------------|
| Explicit bay membership? | **Yes** — discrete `(department_id, aisle, bay)` rows |
| Aisle membership? | **No** — aisle is part of the bay key, not an aisle-level membership object |
| Ordered bay ranges? | **No** — UI may pick many bays; persistence is discrete members |
| Derived topology relationships? | **No** — code comments forbid inventing membership from aisle/department labels (`operational-sections.ts` L1–6) |
| Can a bay belong to multiple active sections? | **No** — unique expression index on `(department_id, normalize(aisle), bay)` (migration L90–98); conflict code `bay_conflict` (`addOperationalSectionMembers` L722–728) |
| Unsectioned bays? | Valid and eligible — absence from members (`formatUnsectionedLabel`, RD-3 report §C) |

### 2.4 How membership changes persist

| Action | Persistence | History |
|--------|-------------|---------|
| Add bays | Upsert into `operational_section_members` | `member_added` events L739–748 |
| Remove bays | Delete matching member rows | `member_removed` events L790–798 |
| Retire section | Delete all active members, set `is_active=false` | `member_removed` (detail `section_retired`) + `retired` L541–602 |
| Reactivate | Clears `retired_at`; **does not re-hydrate members** | `reactivated` L650–654; RD-3 §K |

**VERIFIED:** Reactivate restores an empty membership shell; historical membership lives only in events unless the operator re-adds bays.

---

## 3. Stewardship semantics

### 3.1 Product language (existing)

| Surface | Language |
|---------|----------|
| Schema comment | “Optional roster steward … Independent of sunday_bay_assignments” (migration L38–39) |
| More accordion | “Persistent bay stewardship · not weekly assignment” (`SettingsSection.tsx` ~L454) |
| This Week board | “· steward {name}” beside section chip (`ThisWeekOwnershipBoard.tsx` ~L506–511) |
| Ownership composer | “Section stewardship ≠ weekly ownership” (`this-week-ownership.ts` L8–9) |
| Blueprint | Permanent owner = stewardship, not exclusive labor; Cross Ownership allowed (Blueprint §E.1–E.2) |

### 3.2 Assignment rules

| Question | Verified answer | Citation |
|----------|-----------------|----------|
| Stewardship mandatory? | **No** — nullable FK; create/update accept null | migration L19; `updateOperationalSection` L471–473 |
| One person multiple sections? | **Yes allowed** — no unique constraint on `primary_owner_specialist_id` | migration schema |
| Sections unassigned? | **Yes** — clear owner to null; emits `owner_changed` | `updateOperationalSection` L509–521 |
| Inactive associates as historical stewards? | FK remains until specialist row deleted (`ON DELETE SET NULL`). Soft-archive (`is_active=false`) does **not** clear stewardship automatically | migration L19–21; cleanup soft-archive path separate |
| Influences weekly rotation today? | **No** — dispatch/selection never import section preference | RD-3 §I; CAPACITY-GUARD-001 §5; `rd3.operational-sections.contract.test.ts` asserts domain does not match `selectPhysicalBayCoverage` |

**IMPORTANT (product law preserved):** stewardship = operational responsibility overlay. It must **not** be treated as exclusive weekly assignment ownership.

---

## 4. Existing rotation architecture

### 4.1 End-to-end automatic path

```text
vercel.json cron  "0 11 * * 0"
  → GET /api/cron/weekly-rotation
    → runWeeklyRotationForAllDepartments          (rotations.ts)
      → runSundayDispatchForAllDepartments        (sunday-dispatch.ts ~860+)
        → for each active department:
             dispatchWeeklyPlanForDepartment      (L482–879)
               1. load workforce + shift days
               2. composeWeekLaborAvailability → eligibleCount
               3. loadStoreWeekCapacity (shared pool)
               4. resolveDepartmentStageDrawCount
               5. generateWeeklyRotations(drawCount)   ★ bay discovery
               6. preserve owned; planFlatBayAssignmentsWithCaps(unowned)
               7. filterPlanItemsToCapacity
               8. applySundayAssignmentPlanAdmin → capacity RPC
```

### 4.2 Candidate bay discovery (`generateWeeklyRotations`)

| Step | Behavior | Citation |
|------|----------|----------|
| Department filter | All location queries `.eq("department_id", …)` | `rotations.ts` L896–905, L952–956 |
| Active topology | Pending/carry pools `is_active=true` | L952–956 |
| Showroom exclusion | `isEligibleRotationLocation` / non-SHOWROOM | `location-eligibility.ts` L15–21; `physical-bay.ts` |
| Existing week | Skip if staged unless Force Draw | `generateWeeklyRotations` L858–892 |
| Selection | `selectPhysicalBayCoverage` | `rotations.ts` L1042–1047 |
| Persistence (stage) | `store_locations.status=ASSIGNED` + `weekly_rotations` insert | `finishGenerate` L1055+ |

### 4.3 Selection ordering (`selectPhysicalBayCoverage`)

Deterministic tiers (`physical-bay.ts` L195–309):

1. True carry-over (incomplete-work debt)  
2. Active seasonal HIGH (still owed)  
3. Durable manual High among owed  
4. Velocity / cadence-due hot pool  
5. Remaining aging + `manual_priority_count` weights (`pickSundayVelocityPrioritized` / `pickWeightedByPriorityAndAge`)

Aging uses composed `last_completed_at` / `last_serviced_at` (oldest-or-never across sibling surfaces) — `physical-bay.ts` L126–137, L184–189.

### 4.4 Ownership distribution

| Step | Behavior | Citation |
|------|----------|----------|
| Eligibility | Active, non-MasterAdmin, home dept match, known ON_DUTY hours > 0 | `labor-availability.ts` L324–331, L746 |
| Caps | Per-person remaining + shared remaining | `planFlatBayAssignmentsWithCaps` (`weekly-rotations.ts` L453+) |
| Flat quota | Base 3; hours do not scale quota | ENGINE-PROD-002 / `planFlatBayAssignments` |
| Aisle clustering | Soft preference for same-aisle clustering during flat assign | `weekly-rotations.ts` ~L394–401, L488–493 |
| Persistence | Capacity RPC only | `applySundayAssignmentPlanAdmin` L218–288 |

### 4.5 Where section information could influence selection (safely)

**RECOMMENDATION — influence points (do not bypass safeguards):**

| Layer | Safe influence? | Notes |
|-------|-----------------|-------|
| Before owed/active filters | **No** | Must not re-admit retired/SHOWROOM/completed |
| Inside `selectPhysicalBayCoverage` after tier gates | **Yes (preferred)** | Soft-rank within an equal tier: prefer bays in stewarded sections of eligible associates, then unsectioned / other sections |
| After selection, before capacity draw count | **No** | Draw count remains capacity-derived |
| Inside `planFlatBayAssignmentsWithCaps` | **Yes (secondary)** | When assigning unowned staged bays, prefer matching steward when caps allow |
| Alternate persistence path | **No** | Must use `writeSundayAssignmentsWithCapacity` |

Blueprint APPROVED TARGET: “Engine SHOULD prefer section-focused selection when sections exist” (Blueprint §E.2) — deferred as RD-6 in the redesign sequence; this discovery prepares that tranche without implementing it.

---

## 5. Shared capacity integration

### 5.1 Authority (released)

| Concept | Implementation | Citation |
|---------|----------------|----------|
| Composer | `composeStoreWeekCapacity` | `lib/store-ops/shared-week-capacity.ts` L125–222 |
| Eligible count | Union of LAB-WEEK-002 allocatable roster ids across participating department codes | L138–177 |
| Shared target | `eligible_count × BASE_WEEKLY_BAY_QUOTA` (3) — not hard-coded 12 | L177–178; L36–38 in `this-week-ownership.ts` for UI citation only |
| Consumed | All non-`cleared` `sunday_bay_assignments` with roster owner (includes `completed`) | `isOwnedCapacityRow` L96–102; RPC L218–237 |
| Remaining | `shared_target − owned_total`; per person `quota − owned` | L198–206 |
| Writer | `writeSundayAssignmentsWithCapacity` → RPC | L341–425 |
| DB lock | `pg_advisory_xact_lock(hashtext('store_week_capacity:'\|\|store\|\|':'\|\|week))` | `20261014_capacity_guard_002_store_week_lock.sql` L94–96 |
| Concurrent serialization | Validate + upsert in one SECURITY DEFINER transaction | migration L21–297 |
| Manual assignments | Same RPC via `executeSundayAssignLive` / `applySundayAssignmentPlan` | CAPACITY-GUARD-002 §2 |
| Completed rows | Still consume capacity until cleared | shared-week-capacity L60–61; RPC excludes only `cleared` |
| Reassignment | Same bay, new owner: shared total unchanged; new owner checked vs person quota | migration L229–245; CAPACITY-GUARD-002 §7 |

### 5.2 Section-aware generation constraint

**VERIFIED law:** any future section-aware plan that persists ownership must call the existing capacity boundary. Creating a second assignment writer is **out of scope and unsafe**.

Department stage draw already composes:

```text
min(deptEligible×3, remaining_shared, sum(person remaining))
```

(`resolveDepartmentStageDrawCount`, shared-week-capacity.ts L225–245; sunday-dispatch.ts L610–613)

---

## 6. Selection strategy comparison

Evaluate against fairness, usefulness, predictability, coverage, eligibility, capacity, stewardship, missing stewards, small teams, retired topology, and history.

### A. Steward-first

Prefer bays in sections stewarded by the eligible associate before other owed bays.

| Criterion | Assessment |
|-----------|------------|
| Fairness | Weak when one steward owns many bays / others have empty sections |
| Operational usefulness | High **only when** membership is populated and stewards match eligible set |
| Predictability | High if steward map is complete |
| Rotation coverage | Weak — can starve high-need unsectioned / other-section bays |
| Schedule eligibility | Compatible if restricted to eligible set |
| Capacity | Compatible if post-filtered by shared caps |
| Missing stewardship | **Fails open badly** — production Section A has 0 members; Nate/Nick may lack schedules |
| Small eligible teams | Risk concentrating work in one steward’s geography |
| Retired topology | Safe if owed filters preserved |
| Historical patterns | Ignores aging unless layered under existing tiers |

### B. Coverage-first (current engine)

Existing carry → seasonal → High → velocity/aging; sections ignored.

| Criterion | Assessment |
|-----------|------------|
| Fairness | Strong for rotation debt |
| Operational usefulness | Strong for readiness; weak for “my section” accountability |
| Predictability | Already shipped and tested |
| Rotation coverage | Best among the three for owed debt |
| Stewardship | None |
| Missing stewardship | Unaffected |
| Small teams | Works with 1–4 eligible |

### C. Hybrid (recommended)

Keep existing owed/priority tiers. Within a tier (or as a soft score boost that cannot leapfrog carry/seasonal/High), prefer:

1. Bay in a section stewarded by an associate who is schedule-eligible this week and under remaining capacity  
2. Else bay in any active section (coverage of stewarded geography without requiring assignee = steward)  
3. Else unsectioned owed bay via existing aging weights  

Then assign with flat caps, optionally preferring steward match among eligible owners with remaining slots.

| Criterion | Assessment |
|-----------|------------|
| Fairness | Preserves coverage law; stewardship is preference not exclusivity |
| Operational usefulness | Aligns weekly work with section responsibility when data exists |
| Predictability | Deterministic; no ML |
| Rotation coverage | Preserves carry/High/seasonal supremacy |
| Capacity / eligibility | Unchanged authoritative boundary |
| Missing stewardship / empty members | Degrades to coverage-first automatically |
| Small teams / retired / history | Inherits existing safeguards |

### Recommendation

**RECOMMENDATION:** Strategy **C (Hybrid)** — smallest deterministic strategy supported by actual data.

Do **not** invent section priority ranks the operator has not declared. Do **not** use AI/agentic inference. Do **not** treat steward as exclusive assignee.

**Prerequisite:** populate Operational Section membership for store 2587; empty members make Hybrid ≡ Coverage-first.

---

## 7. Rotation history evidence

### 7.1 Signals available

| Signal | Where | Reliable for auto-selection? |
|--------|-------|------------------------------|
| Location owed / COMPLETED | `store_locations.status`, carry flags | **Yes** — gates pool (`physicalBayIsOwed`) |
| Last completion timestamp | `store_locations.last_completed_at` | **Yes** — aging weights; set on DS verify / auto-verify close (`map-readiness.ts` comment) |
| Last serviced | `store_locations.last_serviced_at` | **Yes (secondary)** — composed into candidate |
| Manual High / seasonal HIGH | location flags / seasonal keys | **Yes** — explicit operator/context evidence |
| Carry-over debt | `CARRIED_OVER` / `carried_over` | **Yes** — tier 1 |
| Weekly assignment row | `sunday_bay_assignments` | **Ownership only** — not proof of service |
| Assignment frequency | Derivable from historical assignments | **Weak alone** — may count unworked assignments |
| Rotation completion | `weekly_rotations.is_completed` | **Reported work**, not verified |
| Verification | `verification_status` | **Strongest close** when `VERIFIED_COMPLETE` |
| Section coverage | Join members ↔ rotations/assignments | **Presentational / future preference** — not currently used |

### 7.2 Distinctions (must preserve)

| State | Meaning | Evidence |
|-------|---------|----------|
| **Assigned** | Person owns the bay this week | `sunday_bay_assignments` non-cleared + roster id |
| **Completed** (performed/reported) | Work reported | `is_completed` and/or `PENDING_VERIFICATION` (`rotation-metrics.ts` L88–96) |
| **Verified** | Operator accepted | `verification_status = VERIFIED_COMPLETE` (L66–71) |

**VERIFIED product law:** Assignment ≠ proof of work. Completion ≠ operator verification (`this-week-ownership.ts` L8–9; Blueprint §D.3 / §H).

**Reliable for automatic selection:** owed/active topology + carry + High + seasonal + aging from last completion/service.  
**Not reliable alone:** mere assignment frequency, section steward identity, unverified completion claims.

---

## 8. Weekly preview capabilities

### 8.1 What exists today

| Capability | Present? | Evidence |
|------------|----------|----------|
| Draft assignments table / durable draft | **No** | No draft schema; Stage writes `weekly_rotations` immediately |
| Preview before staging | **Partial** | Master Stage is immediate write; no pure preview API |
| Preview before ownership persist | **Yes** | `SundayAuditAssignmentModal` `balancerPlan.loads` list + **Assign this week** confirm (`week-assign-preview` / `week-assign-confirm`, ~L716–757) |
| Operator approval for assign | **Yes** | Explicit confirm button (STAGE-ASSIGN-CUE-001) |
| Per-associate review | **Yes (light)** | Preview lists person → N bays / aisles; This Week board after persist |
| Manual substitution | **Yes** | Live assign/reassign/clear via sunday-audit; +1 extra bay |
| Capacity display | **Partial** | This Week cites shared 4×3=12 model + planned/assigned/verified counts (`ThisWeekCommandSummary`); engine uses eligible×3 |
| Section context | **Yes (label only)** | This Week / Map show section + steward; not used in planning |
| Assignment confirmation | **Yes** for ownership; Stage is not a soft draft |

### 8.2 Smallest safe preview approach (recommendation)

**RECOMMENDATION — do not invent a draft persistence subsystem first.**

Smallest safe path:

1. **Pure preview composer** (new pure function): given owed pool + sections + eligible + capacity snapshot → proposed `{bay, assignee?, section?, reason}` list.  
2. Operator reviews on This Week / Sunday drawer (extend existing assign cue).  
3. On confirm: existing `generateWeeklyRotations` (or stage-selected ids) + `planFlatBayAssignmentsWithCaps` + `writeSundayAssignmentsWithCapacity`.  
4. Refuse confirm when preview fingerprint ≠ recompute (concurrent capacity / schedule change).

Optional later: staged-but-unowned already acts as a weak “plan shell”; keep preserving owned bays (sunday-dispatch L755–766).

---

## 9. Schedule eligibility findings

| Question | Verified answer | Citation |
|----------|-----------------|----------|
| What qualifies for weekly rotation? | Active; not MasterAdmin; home/assigned dept matches; known ON_DUTY hours > 0 in ISO week (call-out days excluded) | `labor-availability.ts` L189–214, L324–331, L675–746 |
| Do shift dates set assignment dates? | **No** — assignments are week-scoped (`week_starting` Monday); shifts only gate eligibility/hours | sunday assignments + capacity composer |
| Stewardship × eligibility? | **None today** | CAPACITY-GUARD-001 §2.3 |
| Missing schedules? | Not eligible; **not** auto-archived | shared-week-capacity.ts L7–8, L122–123 |
| Midweek schedule change? | Does not delete owned bays; capacity still counts existing non-cleared rows | CAPACITY-GUARD-002 §4 |

**Preserve:** schedule-backed eligibility. Do not invent shifts. Do not auto-archive for missing schedules.

Intended full-team capacity (4×3=12) remains an **operating model citation**; actual shared target stays `eligible × 3`.

---

## 10. Edge-case analysis

| Case | Required behavior |
|------|-------------------|
| Four eligible | Shared target 12; Hybrid prefers stewarded geography within tiers |
| Two eligible | Target 6 (production-like); do not pad to 12 |
| One eligible | Target 3; steward preference limited to that person |
| No eligible | `NO_ELIGIBLE_WORKFORCE`; no invented owners |
| Sections without stewards | Treat as section geography without steward boost; still cover via Hybrid step 2/3 |
| Associate stewards multiple sections | Allowed; preference may span those member sets; capacity still max 3 base |
| Sections with insufficient eligible bays | Fall back to other owed bays; never invent topology |
| Bays outside sections | Remain eligible (Unsectioned) |
| Retired aisles/bays | Excluded by `is_active` / eligibility helpers |
| Already-assigned bays | Preserve ownership; only fill unowned staged |
| Repeated Sunday staging | `ALREADY_COMPLETE` / skipIfExists; no destructive rewrite |
| Midweek manual assignment | Capacity RPC; preserves others |
| Reassignment | Shared total unchanged; person caps apply to new owner |
| Completed work | Still consumes capacity until cleared; verification separate |
| Existing over-capacity weeks | Flagged; refuse additive automatic fills; **no silent deletes** |
| Section membership changes | Affect future preference only; do not rewrite past assignments |
| Cross-department assignments | Sections cannot span departments; shared capacity still cross-dept when dual-dept exists — dual auto-stage remains **NO-GO** |

**Preserve existing assignments. No silent deletion. No automatic reassignment.**

---

## 11. Zebra handoff readiness

### 11.1 Intended future process (product intent — not implemented)

1. Floor Command prepares weekly work  
2. Operator reviews assignments  
3. Operator enters corresponding tasks into Lowe’s Zebra Work system  
4. Operator confirms Zebra entry inside Floor Command  
5. Associates execute tasks  
6. Operator verifies completed work  

### 11.2 Existing states that could support this

| DeptSync state | Maps toward |
|----------------|-------------|
| Staged, unowned (`weekly_rotations`, no Sunday owner) | Plan prepared / not committed to people |
| Assigned (`sunday_bay_assignments` status `assigned`) | Ownership ready for external task entry |
| Reported / `PENDING_VERIFICATION` | Work claimed done — awaiting operator |
| `VERIFIED_COMPLETE` | Operator verification (step 6) |
| Barrier / send-back | Interruption — not Zebra-specific |

### 11.3 Missing evidence / states

| Gap | Notes |
|-----|-------|
| Zebra-entered confirmation | **No** status/field for “entered in Zebra” |
| Zebra task ids / deep links | **None** |
| Direct Zebra API | **None** — DeptSync is explicitly not a Zebra replacement (Blueprint §A.1) |
| Draft-before-persist weekly plan | Soft preview only for Assign; Stage already persists |

**RECOMMENDATION:** Do not modify assignment status semantics in the section-rotation tranche. A future Zebra handoff can add an explicit operator-confirmed evidence flag **orthogonal** to Assigned / Completed / Verified — after section-aware planning ships.

---

## 12. Recommended architecture

```text
PHYSICAL BAYS (active, owed)
    ↑ explicit membership (≤1)
OPERATIONAL SECTIONS (+ optional steward)
    ↑ preference input only
HYBRID SELECTOR  →  selectPhysicalBayCoverage tiers + soft steward/section rank
    ↓ drawCount from shared capacity
WEEKLY_ROTATIONS (stage)
    ↓ planFlatBayAssignmentsWithCaps (+ optional steward match)
OPERATOR PREVIEW / CONFIRM
    ↓
writeSundayAssignmentsWithCapacity  ★ sole persistence boundary
    ↓
This Week board (section labels already present)
    ↓
Complete → Verify (existing)
```

**Ownership**

| Concern | Owner |
|---------|-------|
| Section membership / stewardship | `operational-sections` domain (unchanged semantics) |
| Owed bay discovery + priority tiers | `physical-bay` / `rotations` |
| Section preference composition | New pure helper beside physical-bay (compose, don’t fork engine) |
| Eligibility | `labor-availability` |
| Capacity + persistence | `shared-week-capacity` + RPC |
| Presentation / preview | This Week + Sunday assign cue |

Prefer composition over a second allocator or draft table.

---

## 13. Implementation sequence

**RECOMMENDATION — smallest safe sequence (future tranches only):**

| Step | Scope | Depends on |
|------|-------|------------|
| 0 | Operator populates section membership + stewards (product data, not engine) | RD-3 UI already shipped |
| 1 | Pure Hybrid candidate ranking helper + unit tests (no persistence change) | Step 0 valuable; tests with empty members = coverage-first |
| 2 | Wire preference into `selectPhysicalBayCoverage` options (flagged / behind tests) | Step 1; preserve carry/High/seasonal |
| 3 | Optional steward-aware flat assign tie-break inside caps | Steps 1–2 |
| 4 | Operator preview surface (extend Assign cue / This Week) — confirm before ownership write | Steps 1–3 |
| 5 | Shared capacity enforcement | **Already shipped** — reuse only |
| 6 | Assignment persistence | **Existing RPC only** |
| 7 | Zebra handoff evidence | **Later** — after planning UX stable |
| 8 | Verification workflow | **Already shipped** — do not redefine |

**Migrations:** none required for preference + preview if membership already exists.  
**Avoid:** second-department auto-stage; AI ranking; mandatory stewardship; draft DB until preview UX proves insufficient.

---

## 14. Regression test requirements

| Area | Required tests |
|------|----------------|
| Section membership resolution | Bay → at most one active section; unsectioned; dept mismatch rejected |
| Steward preference | Eligible steward’s section bays rank above equal-tier others |
| Cross-section fallback | Empty/missing steward → coverage-first equivalent |
| Schedule eligibility | Missing hours excluded; Master excluded; invited+active included |
| Shared weekly capacity | eligible×3; completed counts; clear frees; over-capacity refuse additive |
| Rotation history ordering | Carry > seasonal > High > velocity/aging unchanged when sections absent |
| Retired topology | `is_active=false` never selected |
| Missing stewardship | Null owner sections still contribute geography preference only if Hybrid step 2 enabled |
| Unassigned bays | Unsectioned remain eligible |
| Duplicate prevention | Same physical bay not staged twice; one section per bay invariant |
| Repeated staging | ALREADY_COMPLETE / skipIfExists |
| Preview consistency | Confirm refuses stale fingerprint when capacity/eligibility changed |
| Manual overrides | Reassign/clear/+1 still capacity-gated |
| Concurrent writes | RPC lock contract (existing shared-week-capacity tests) |
| Cross-store isolation | JWT store mismatch / store-scoped section loads |
| Assignment history preservation | No silent deletes; reassignment preserves shared total |

Reuse/extend: `shared-week-capacity.test.ts`, ENGINE-PROD-002/003/004 suites, `operational-sections*.test.ts`, `rd4.this-week-command*`.

---

## 15. GO / CONDITIONAL GO / NO-GO

| Gate | Result |
|------|--------|
| Architectural discovery complete | **GO** |
| Capacity guard preserved as sole write boundary | **GO** (already production) |
| Automatic section-aware generation in this tranche | **NO-GO** |
| Next implementation tranche (Hybrid preference + operator preview) | **CONDITIONAL GO** — requires populated section membership; must not bypass capacity RPC; must not auto-stage second department |
| Zebra integration / status semantic change | **NO-GO** now |
| Production mutations from this report | **NO-GO** |

---

## Appendix A — Key file map

| Path | Role |
|------|------|
| `supabase/migrations/20261011_operational_sections.sql` | Section schema |
| `lib/store-ops/operational-sections.ts` | Section domain |
| `lib/store-ops/physical-bay.ts` | Bay selection |
| `lib/store-ops/rotations.ts` | Stage generation |
| `lib/store-ops/sunday-dispatch.ts` | Sunday Stage+Assign orchestration |
| `lib/store-ops/weekly-rotations.ts` | Flat assignment planner |
| `lib/store-ops/shared-week-capacity.ts` | Capacity composer + RPC client |
| `supabase/migrations/20261014_capacity_guard_002_store_week_lock.sql` | Authoritative writer |
| `lib/store-ops/labor-availability.ts` | Schedule eligibility |
| `lib/store-ops/this-week-ownership.ts` | This Week composition |
| `components/hub/tabs/FloorTab.tsx` | This Week surface |
| `components/admin/SundayAuditAssignmentModal.tsx` | Assign preview + confirm |
| `components/store-ops/ThisWeekOwnershipBoard.tsx` | People → bays + section/steward labels |

---

## Appendix B — Verified vs recommendation checklist

| Item | Kind |
|------|------|
| Sections are explicit bay membership overlay; ≤1 active section per bay | VERIFIED |
| Steward optional; ≠ weekly ownership | VERIFIED |
| Engine ignores sections today | VERIFIED |
| Shared capacity RPC is production authority | VERIFIED |
| No durable draft assignment mechanism | VERIFIED |
| Assign-this-week client preview exists | VERIFIED |
| Production section membership empty (CAPACITY-GUARD-001) | VERIFIED (prior read-only) |
| Hybrid preference is the right next strategy | RECOMMENDATION |
| Preview-before-persist via pure composer | RECOMMENDATION |
| Defer Zebra state until after section-aware planning | RECOMMENDATION |

**STOP — discovery only. No implementation started.**
