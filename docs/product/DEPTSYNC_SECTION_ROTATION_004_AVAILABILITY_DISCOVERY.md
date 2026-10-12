# DEPTSYNC-SECTION-ROTATION-004 — Weekly Workload & Availability Discovery

**Status:** COMPLETE (read-only architectural + production schedule discovery)  
**Date:** 2026-10-11  
**Mode:** READ-ONLY — no implementation, no production mutations, no deployment, no feature flags, no Sunday dispatch  
**Store:** 2587  
**Supabase:** `fmeinlwhixngednabhgy`  
**Application:** https://deptsync-hub.vercel.app (unchanged)

**References:**  
[`DEPTSYNC_SECTION_ROTATION_001_DISCOVERY.md`](DEPTSYNC_SECTION_ROTATION_001_DISCOVERY.md) ·  
[`DEPTSYNC_SECTION_ROTATION_002_IMPLEMENTATION.md`](DEPTSYNC_SECTION_ROTATION_002_IMPLEMENTATION.md) ·  
[`DEPTSYNC_SECTION_ROTATION_003_REAL_DATA_READINESS.md`](DEPTSYNC_SECTION_ROTATION_003_REAL_DATA_READINESS.md) ·  
[`DEPTSYNC_CAPACITY_GUARD_001_DISCOVERY.md`](DEPTSYNC_CAPACITY_GUARD_001_DISCOVERY.md) ·  
[`DEPTSYNC_CAPACITY_GUARD_002_IMPLEMENTATION.md`](DEPTSYNC_CAPACITY_GUARD_002_IMPLEMENTATION.md) ·  
[`DEPTSYNC_CAPACITY_GUARD_003_RELEASE.md`](DEPTSYNC_CAPACITY_GUARD_003_RELEASE.md)

**Strict exclusions honored:** No schedule/assignment/section/topology/schema changes; no capacity RPC edits; no cron; no preview/auto-stage enablement; no production deploy.

**Legend**

| Tag | Meaning |
|-----|---------|
| **VERIFIED** | Confirmed in repository and/or live read-only production SELECT |
| **REQUIREMENT GAP** | Desired behavior not yet implemented (not a regression of prior design) |
| **CONFIRMED BEHAVIOR** | Current system behaves this way by design / prior tranche |

---

## 1. Executive summary

Floor Command now has **real W42 department schedules** for store 2587. Under the **existing** labor + capacity model, all four operational associates (Tyson, Nate, Nick, Tracy) are schedule-eligible, MasterAdmin is excluded, and the store-week shared target becomes **12** (4 × 3). Nate’s department availability is visibly reduced (**2 ON_DUTY days / 22h** vs peers at 4–6 days / 43–53h), but the engine still grants him the full **3-bay** base quota because eligibility is binary (`known_available_hours > 0`) and **hours do not scale quota** (`planFlatBayAssignments`, ENGINE-PROD-002).

That is the central architectural gap for production activation: the capacity guard correctly enforces a **uniform** per-person max of 3 and a **shared** store-week pool, but it does **not** yet support **reduced individual weekly capacity** while preserving concurrent write safety.

| Gate | Result |
|------|--------|
| Production read access | **PASS** (service-role SELECT on canonical project; no PIN/hash fields) |
| W42 schedules present | **PASS** (27 `associate_shift_days` rows Mon–Sun) |
| Target week resolution | **PASS** — `2026-W42`, week starting **2026-10-12** |
| Existing capacity RPC compatibility | **PASS** for uniform 3 / shared `eligible×3` |
| Reduced individual capacity | **REQUIREMENT GAP** (not DB- or app-enforced) |
| Section stage concentration (from 003) | **CONFIRMED BEHAVIOR** — still unresolved product decision |
| Auto-stage / Production preview | Remain **OFF** |
| Typecheck + focused tests | **PASS** (`tsc`; **119** relevant tests) |

**Verdict: CONDITIONAL GO** for a narrowly scoped capacity-policy implementation tranche after operator decisions below.  
**Verdict: NO-GO** for production rotation activation, Production preview enablement, or Sunday automatic staging.

---

## 2. Current schedule data model

### 2.1 Canonical table

| Item | Path / fact |
|------|-------------|
| Schema | `supabase/migrations/20260815_associate_shift_days.sql` |
| Table | `public.associate_shift_days` |
| Grain | One row per `(store_number, specialist_id, work_date)` |
| Uniqueness | Unique on that triple — **no same-person same-day overlap** |
| Columns | `start_time`, `end_time` (text clocks), `is_scheduled_today`, `is_call_out`, `status ∈ {ON_DUTY, ABSENT_CALLOUT, OFF}` |
| Department column | **None** |
| Persistence owner | `lib/store-ops/shift-status.ts` (`upsertShiftDay`) |

### 2.2 Operational meaning (operator + code)

| Concern | Finding |
|---------|---------|
| Department availability | **Operator convention:** only Flooring / Home Decor shifts are entered. Other-dept UKG time is omitted. |
| System scoping | Eligibility scopes by associate **home/assigned department** vs participating department code (`flooring`), not by a shift-level department field (`labor-availability.ts`) |
| Duration | Computed from `start_time`/`end_time` via `hoursBetween` / `knownShiftHours` when status resolves to ON_DUTY |
| OFF rows | Still store clock tokens (UI defaults); OFF does **not** contribute available hours |
| Call-outs | Excluded from allocatable hours; do not delete ownership |
| Validation | Status derived on save (`deriveStatus`); conflicting duplicate fingerprints fail closed in pure composer |

### 2.3 Labor → capacity path (VERIFIED)

```text
associate_shift_days (Mon–Sun of ISO week)
  → composeWeekLaborAvailability          (labor-availability.ts)
      allocatable ⇔ known_available_hours > 0
  → weekLaborToPlannerMembers
  → composeStoreWeekCapacity              (shared-week-capacity.ts)
      eligible_count = |union|
      shared_target  = eligible_count × BASE_WEEKLY_BAY_QUOTA (3)
      remaining_by_specialist[id] = 3 − owned[id]
  → Sunday stage draw / flat assign / section-aware preview
  → upsert_sunday_bay_assignments_with_capacity  (DB RPC)
```

**Explicit non-behavior (VERIFIED):** hours and shift counts are evidence for eligibility and display; they **do not** reduce the 3-bay base quota (`weekly-rotations.ts` comment: “hours do not scale quota”).

---

## 3. Verified production availability

**Method:** read-only Supabase service-role SELECT against `fmeinlwhixngednabhgy` (project URL host match). No Management API password rotate required for this inspection. No credential/PIN columns selected. No writes.

**Active roster (store 2587):** Nate, Nick, Tracy, Tyson, Master Admin.  
**Operational rotation participants:** Nate, Nick, Tracy, Tyson.  
**MasterAdmin:** excluded by labor eligibility.

### 3.1 Shift presence

| Week window | Observation |
|-------------|-------------|
| 2026-W42 (2026-10-12 … 2026-10-18) | **27** shift rows across four associates |
| Prior W41 | Still present historically (Tracy/Tyson pattern from 003) |
| Later dates through 2026-10-25 | Additional rows exist (ongoing schedule entry) |

### 3.2 Clocks, duration, overlap

| Question | Answer |
|----------|--------|
| Start/end times stored? | **Yes** (text `HH:MM`) |
| Duration calculated? | **Yes** in labor composer for ON_DUTY rows with usable clocks |
| Same-person overlaps? | **Prevented** by unique `(store, specialist, work_date)` |
| Cross-associate same-day overlaps? | **Normal** (multiple people on duty the same day) |
| Availability department-specific in schema? | **No column** — department meaning is operator omission + home-dept eligibility |
| Relation to rotation week | ISO week Mon–Sun via `isoWeekCalendarRange` / `week_starting` Monday |

### 3.3 W42 ON_DUTY department days (actual rows)

| Associate | ON_DUTY dates | Known available hours | OFF / missing notes |
|-----------|---------------|----------------------:|---------------------|
| **Tyson** | Mon–Sat (6) | **53** | Sun OFF |
| **Nick** | Mon–Wed, Fri–Sat (5) | **45** | Thu + Sun OFF |
| **Tracy** | Tue, Thu, Sat, Sun (4) | **43** | Mon/Wed/Fri OFF |
| **Nate** | Mon, Wed (2) | **22** | Tue/Thu–Sat OFF; **Sun row missing** |
| MasterAdmin | — | — | Not a rotation participant |

Nate’s reduced department footprint is **confirmed in production data**, not inferred.

---

## 4. Target rotation week

| Field | Value |
|-------|-------|
| Evaluation instant | Sunday **2026-10-11** evening, America/Denver |
| Canonical helper | `sundayStagingWeekLabel` (`lib/store-ops/sunday-schedule.ts`) |
| Sunday rule | Local Sunday → **upcoming Monday’s** ISO week |
| Store settings | `timezone=America/Denver`, `sunday_auto_generate=true`, `sunday_auto_stage_time=23:59:00` |
| **Target week** | **`2026-W42`** |
| **Week starting** | **2026-10-12** |
| Range | 2026-10-12 … 2026-10-18 |

This matches the prior 003 target; canonical week logic **reconfirmed**, not blindly reused.

### Per-associate capacity under **current** model

| Associate | Dept days | Hours | Eligible now? | Max assignment capacity (current) | Availability reduced vs peers? |
|-----------|----------:|------:|:-------------:|----------------------------------:|:------------------------------:|
| Tyson | 6 | 53 | Yes | **3** | No |
| Nick | 5 | 45 | Yes | **3** | Mildly fewer days; still full cap |
| Tracy | 4 | 43 | Yes | **3** | Fewer days; still full cap |
| Nate | 2 | 22 | Yes | **3** | **Yes — reduced** |
| MasterAdmin | — | — | No | 0 | N/A |

| Capacity snapshot (current composer) | Value |
|--------------------------------------|------:|
| Eligible count | **4** |
| Shared target | **12** |
| W42 owned assignments | **0** |
| Remaining shared | **12** |

Labor processing status for W42 composition: **PARTIAL** (Nate missing Sunday row → `missing_day_count`; still allocatable because Mon/Wed hours > 0). Reasons array empty for conflicts/unknown durations.

---

## 5. Existing eligibility behavior

| Rule | Behavior | Citation |
|------|----------|----------|
| Active roster | `is_active !== false` | `labor-availability.ts` |
| MasterAdmin | Never eligible | `isEligibleAggregateMember` |
| Home department | Prefer `home_department`, else `assigned_department`, else flooring default | `specialistHomeDepartment` |
| Week evidence | Known ON_DUTY duration > 0 somewhere Mon–Sun | `composeWeekLaborAvailability` → `has_allocatable_hours` |
| Call-out days | Not available for new allocation that day | same |
| Missing schedules | Not eligible; **not** archived | `shared-week-capacity.ts` |
| Sections / stewardship | Do **not** grant eligibility | RD-3 / ROTATION-001–003 |
| Quota after eligibility | **Always base 3** when eligible | ENGINE-PROD-002 / `BASE_WEEKLY_BAY_QUOTA` |

**Critical VERIFIED fact:** one (or two) department shifts **do** currently qualify an associate for three bay assignments. That matches prior product law and **conflicts** with the new operational expectation stated in this mission.

---

## 6. Existing capacity enforcement

### 6.1 Where the three-bay maximum is enforced

| Layer | Mechanism | Uniform 3? | Reduced individual? |
|-------|-----------|:----------:|:-------------------:|
| Client / pure composers | `composeStoreWeekCapacity`, `filterPlanItemsToCapacity`, `planFlatBayAssignmentsWithCaps`, section-aware remaining caps | Yes | No |
| Sunday dispatch | Shared draw `min(dept×3, remaining_shared, sum person remaining)` then flat assign | Yes | No |
| Manual Assign UI | Plans through composers; writes via capacity RPC | Yes | No |
| Database RPC | `upsert_sunday_bay_assignments_with_capacity` — `p_quota_per_person` + `p_shared_target` + advisory lock | Yes (single quota for all) | **No** |
| Table constraints | Unique `(store_number, department, week_starting, bay_id)` — duplicate bay ownership key | N/A | N/A |
| Extra-bay (+1) | Explicit `allow_over_base` / `allow_over_shared` (service_role only after harden) | Override path | Override path |

### 6.2 What the transactional guard supports today

| Capability | Supported? | Notes |
|------------|:----------:|-------|
| Per-associate weekly capacity (uniform) | **Yes** | Everyone shares `p_quota_per_person` (default 3) |
| Reduced individual capacity | **No** | No per-roster quota map in RPC or composer |
| Shared weekly capacity | **Yes** | `p_shared_target`; counts all depts for store-week |
| Existing assignment accounting | **Yes** | Non-cleared rows consume, including completed |
| Concurrent assignment creation | **Yes** | `pg_advisory_xact_lock` + validate + upsert in one transaction |
| Eligibility recomputation inside RPC | **No** | Caller supplies targets; RPC does not re-read schedules |

### 6.3 Database-enforced vs application-enforced

| Invariant | DB | App |
|-----------|:--:|:---:|
| Max 3 per associate (uniform) when `allow_over_base=false` | **Yes** | Yes (pre-filter) |
| Shared store-week ceiling | **Yes** | Yes |
| Bay uniqueness per dept-week | **Yes** (unique key) | Yes (plan de-dupe) |
| MasterAdmin exclusion | No | **Yes** (eligibility) |
| Schedule-backed eligibility | No | **Yes** |
| Reduced per-person cap | **No** | **No** |
| Soft section preference | No | Preview / Hybrid only |
| No auto-redistribute unavailable load | Partial (no silent rewrite) | Call-out path is explicit operator/tooling |

---

## 7. Reduced-capacity policy options

Evaluated without selecting invented hour/day thresholds.

### A. Shift-count-based capacity

| Dimension | Assessment |
|-----------|------------|
| Usefulness | Maps intuitively to “how many department days” |
| Predictability | High **after** a day→bay table is chosen |
| Data requirements | ON_DUTY day counts (already composed) |
| Complexity | Low–medium formula + tests |
| Operator workload | Low once automated |
| Overassignment risk | Medium if thresholds are wrong |
| Safeguard fit | Needs per-person caps in composer + RPC |
| Explainability | Good (“2 days → N bays”) **only after** N is approved |
| Fit to mission | **Weak** — requires inventing a mapping the mission forbids choosing arbitrarily |

### B. Scheduled-hours-based capacity

| Dimension | Assessment |
|-----------|------------|
| Usefulness | Uses richest existing evidence (hours already computed) |
| Predictability | Sensitive to long/short shifts; Nate’s 22h vs Tracy’s 43h may invert day intuition |
| Data requirements | Known hours (already) |
| Complexity | Medium (bands / floors) |
| Operator workload | Low if automatic |
| Overassignment risk | Medium–high without bands |
| Safeguard fit | Same per-person plumbing |
| Explainability | Weaker on the floor (“why 2 bays from 22h?”) |
| Fit to mission | **Weak** — invents hour→bay policy |

### C. Explicit operator-approved weekly capacity

| Dimension | Assessment |
|-----------|------------|
| Usefulness | Directly encodes intent (“Nate is 2 this week”) |
| Predictability | Highest — operator is authority |
| Data requirements | Optional; schedules remain eligibility evidence |
| Complexity | Low product surface; medium if persisted |
| Operator workload | **Higher** (weekly confirmation) |
| Overassignment risk | Lowest when enforced at RPC |
| Safeguard fit | Excellent with per-person remaining + shared = sum(caps) |
| Explainability | Excellent |
| Fit to mission | **Strong** — no invented formula |

### D. Hybrid availability calculation with operator review

| Dimension | Assessment |
|-----------|------------|
| Usefulness | Shows days/hours evidence; operator confirms caps before assign |
| Predictability | High after confirm; draft can default to 3 |
| Data requirements | Existing labor evidence + confirm step |
| Complexity | Medium (preview UX + capacity plumbing) |
| Operator workload | Moderate (review, not invent schedules twice) |
| Overassignment risk | Low if confirm required before write |
| Safeguard fit | Same as C once confirmed caps feed RPC |
| Explainability | Best — evidence + decision |
| Fit to mission | **Strongest** — respects “don’t invent formula” while using entered UKG schedules |

---

## 8. Recommended capacity policy

**Recommend Option D (hybrid evidence + operator-approved weekly capacity), with Option C as the enforcement authority.**

Concrete policy shape (design only — not implemented):

1. **Eligibility stays schedule-backed and binary** for pool membership (`known_available_hours > 0`, Master excluded).  
2. **Default individual weekly bay capacity = 3** for eligible associates.  
3. **Operator may lower an individual’s capacity for the week (0–3)** using schedule evidence (days + hours) shown in the proposal review.  
4. **Shared store-week target = sum of individual capacities** for eligible associates (not always `eligible×3` when someone is reduced).  
5. **Do not auto-derive N bays from days/hours** until/unless the operator later ratifies an explicit mapping table.  
6. **Do not redistribute** an unavailable or reduced associate’s unused slots automatically to others unless the operator expands others’ caps or shared fill intentionally.  
7. **Capacity RPC must enforce per-person caps**, not only a uniform quota, for concurrent safety.

This is the smallest approach that:

- honors entered department schedules as evidence,  
- avoids inventing a proportional formula,  
- preserves stewardship / priority / uniqueness / shared-pool safeguards,  
- and unblocks Nate-style reduced availability without pretending 2 department days ≡ 3 bay completions.

---

## 9. Section distribution findings

Reconfirmed from SECTION-ROTATION-003 + code (no selector rewrite):

| Question | Finding |
|----------|---------|
| Why concentration? | Stage draw pulls a capped candidate set; coverage-first orders by physical coverage; section-preference helper still fills early keys first. Soft assign preference cannot invent bays outside the staged set. |
| Do priority tiers justify it? | When all candidates share one tier (e.g. aging), tiering does not diversify aisles. |
| Equivalent-priority bays elsewhere? | Yes in inventory (160 active bays across nine aisles) — but they are not in the **staged draw** once concentration occurs. |
| Where stewardship enters | Within-tier rank + soft assignee preference among remaining caps (`section-aware-rotation.ts`) — **after** candidates exist. |
| Distribute before or after priority ranking? | **Priority tiers remain authoritative first.** Any aisle/section diversification must happen **within** a tier (or across equal-priority candidates), never leapfrog carry/high/velocity. |
| Effect of reduced individual capacity | Fewer slots for a reduced associate; soft steward matches become scarcer for that person; concentration risk for others **increases** unless stage diversification improves. |

**Preserve:** Operational Sections guide selection; they are not absolute assignment boundaries.

---

## 10. Required implementation changes

**Next authorized tranche (design scope only):**

| Change | Why | Smallest? |
|--------|-----|:---------:|
| Operator-visible weekly capacity review showing days/hours + editable 0–3 caps | Policy D | Required |
| `composeStoreWeekCapacity` (and preview composers) accept `capacity_by_specialist` | Shared target = sum; remaining per person | Required |
| Sunday / Assign writers pass per-person caps into RPC | Concurrent safety | Required |
| Extend capacity RPC with optional per-roster quotas | DB enforcement of reduced caps | Required for safe prod |
| Tests for Nate-style 2-day / reduced-cap weeks | Regression | Required |
| Section stage diversification | Fair multi-steward proposals | **Required before fair auto-stage**; can follow capacity tranche if preview stays operator-gated |
| Auto-stage / Production preview flags | Activation | **Defer** (stay OFF) |

**Do not do in the capacity tranche:** invent day/hour formulas; dual-dept auto-stage; weaken uniqueness; rewrite exclusive section ownership; redistribute reduced load automatically.

---

## 11. Database migration requirements

| Need | Necessary? |
|------|:----------:|
| New schedule columns / department on shifts | **No** for this policy (operator convention + home-dept eligibility suffice) |
| New weekly capacity table | **Optional** — caps can travel with the confirmed plan payload |
| Extend `upsert_sunday_bay_assignments_with_capacity` for per-person quotas | **Yes**, if reduced individual capacity must be concurrent-safe in production |
| Change unique bay constraint | **No** |

Suggested RPC shape (design only): keep `p_quota_per_person` as fallback/default max; add optional `p_person_quotas jsonb` map `roster_id → int`; enforce `count(person) < person_quota`; keep `p_shared_target` as caller-supplied sum; preserve advisory lock + CAPACITY-GUARD-003 auth harden.

Without that migration, app-only reduced caps are **not** trustworthy under concurrent or alternate writers.

---

## 12. Security and concurrency considerations

| Topic | Posture |
|-------|---------|
| Production inspection | Read-only SELECT; no PIN/hash access |
| Capacity writes | Remain SECURITY DEFINER RPC only; client table writes stay revoked |
| Reduced caps | Must not be bypassable via authenticated `allow_over_*` (already forced false) |
| Concurrent Sunday / Assign / offline replay | Advisory lock remains mandatory |
| MasterAdmin | Continues excluded from eligibility/capacity union |
| Feature flags | Preview/auto-stage remain off — no silent activation |
| Schedule meaning | Trust operator-entered department omission; do not invent other-dept shifts |

---

## 13. Test findings

| Check | Result |
|-------|--------|
| `npm run typecheck` | **PASS** |
| Focused vitest: `shared-week-capacity`, `section-aware-rotation`, `section-rotation-002.contract`, `engine-prod-002.sunday-dispatch`, `labor-availability` | **PASS — 119 / 119** |
| Production mutations / dispatch / flags | **Not run** (excluded) |

Existing tests explicitly lock **hours do not scale quota** and **BASE_WEEKLY_BAY_QUOTA = 3**. Any reduced-capacity tranche must add new contracts rather than silently invert ENGINE-PROD-002 without product approval.

---

## 14. Minimal production activation sequence

| Step | Required now? | Notes |
|------|:-------------:|-------|
| 1. Capacity policy approval (D/C; Nate W42 intent) | **Yes** | Blocks honest proposals |
| 2. Capacity enforcement implementation (composer + RPC) | **Yes** | Smallest architecture change |
| 3. Section-aware candidate distribution | **Yes before fair auto-stage**; deferrable if operator accepts reviewing soft-preference proposals manually | From 003 |
| 4. Local deterministic tests | **Yes** | |
| 5. Production read-only evaluation | **Yes** | Re-compose after policy ship; schedules already present |
| 6. Operator-visible proposal review | **Yes** | Keep human confirm |
| 7. Controlled production activation | **Later** | Preview env only after 1–6; **Sunday auto-stage stays HARD OFF** |

**Defer:** dual-department auto-stage; automatic redistribution; invented proportional formulas; Production preview enablement before phone review.

---

## 15. Open operator decisions

1. **Confirm Option D/C:** operator-approved weekly bay capacity (default 3), with schedule days/hours shown as evidence only — **no automatic day→bay formula**.  
2. **Nate W42 intent:** given 2 department days / 22h, what weekly bay max should apply (0, 1, 2, or keep 3)?  
3. **Unused reduced capacity:** leave shared target lower (recommended), or allow others to absorb unused slots only via explicit operator increase?  
4. **Section fairness:** keep Hybrid soft preference for now, or authorize a within-tier multi-aisle stage diversification tranche before any auto-stage discussion?  
5. **Persist weekly caps?** session/plan-only vs durable store-week record.  
6. **Missing Sunday row for Nate:** intentional omission vs incomplete entry (does not block eligibility today).

---

## 16. GO / CONDITIONAL GO / NO-GO

| Decision | Verdict |
|----------|---------|
| Discovery complete | **GO** |
| W42 schedule data readiness (presence) | **GO** |
| Current engine ready to express reduced availability | **NO-GO** (uniform 3 after binary eligibility) |
| Implement capacity policy D/C + per-person RPC caps | **CONDITIONAL GO** after operator decisions §15.1–15.3 |
| Section stage diversification | **CONDITIONAL GO** as separate tranche; required before fair automatic multi-section proposals |
| Enable Production section-aware preview | **NO-GO** |
| Enable Sunday section-aware / any auto-stage | **NO-GO** |
| Overall production rotation activation | **NO-GO** |

**Primary blocker shifted from 003:** schedules are present; **capacity policy for reduced individual availability** is now the gating design gap.  
**Secondary blocker (unchanged):** stage concentration vs multi-steward fairness.

**STOP.**
