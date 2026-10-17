# DEPTSYNC-ROTATION-AUTO-001 — Automatic Weekly Assignment Root Cause Discovery

**Status:** COMPLETE (read-only investigation)  
**Date:** 2026-10-15  
**Mode:** Evidence-based discovery — **no implementation, no deployment, no migrations, no production writes**  
**Application:** https://deptsync-hub.vercel.app  
**Supabase:** `fmeinlwhixngednabhgy` (read-only SELECT via service role for this report)  
**Store:** `2587` · Department: merged `flooring` (“Flooring / Home Decor”)  
**Operational week inspected:** `2026-W42` (`week_starting` 2026-10-12)

**Authority / predecessors:**  
ENGINE-PROD-002 · STAGE-ASSIGN-CUE-001 · LAB-WEEK-002 · CAPACITY-GUARD-002/003 · SECTION-ROTATION-002…007 · OPERATIONAL-009/011/012 · SEC-OPS-010 · ZEBRA-HANDOFF-002 · SPECIALTY-OPS-001 (paused)

**Not authorized:** enabling Sunday automation, flipping auto-stage flags, capacity edits, assignment redistributions, schema changes, deploy, commit, push.

**Legend**

| Tag | Meaning |
|-----|---------|
| **VERIFIED (code)** | Confirmed in repository source/tests |
| **VERIFIED (prod read-only)** | Confirmed by SELECT-only query on 2026-10-15 |
| **DOCUMENTED** | Prior product docs; not re-proven this pass |
| **DESIGN** | Proposed shape for a later authorized tranche |

---

## 1. Current rotation execution flow

### 1.1 Two parallel assignment systems (**VERIFIED code**)

Floor Command currently has **two** weekly assignment paths that must not be confused:

| Path | Trigger | Planner | Persist |
|------|---------|---------|---------|
| **A. Cron Stage+Assign** | Vercel `0 11 * * 0` → `GET /api/cron/weekly-rotation` → `runSundayDispatchForAllDepartments` | **Flat** caps (`planFlatBayAssignmentsWithCaps`) | `weekly_rotations` then `sunday_bay_assignments` via capacity RPC |
| **B. Operator Assign this week** | Floor recovery / Sunday drawer → `handleBalanceAssign` | **Stewardship + strict section ownership** (`composeStewardshipWeeklyProposal`) | Same ownership table via `applySundayAssignmentPlan` |

Stage and assign are intentionally separated on the human path (STAGE-ASSIGN-CUE-001):

```text
Stage  → weekly_rotations only   (generateRotations / POST /api/rotations/generate)
Assign → sunday_bay_assignments  (Assign this week confirm)
```

Cron attempts to combine both in one orchestration (`sunday-dispatch.ts`), but still uses the **flat** assign planner — not the stewardship planner the Sunday UI uses.

### 1.2 End-to-end path map

```text
vercel.json cron "0 11 * * 0"
  → app/api/cron/weekly-rotation/route.ts  (CRON_SECRET)
  → runWeeklyRotationForAllDepartments (rotations.ts)
  → runSundayDispatchForAllDepartments (sunday-dispatch.ts)
       ├─ evaluateSundayAutoRun(store)          // sunday_auto_generate + local Sunday + stage time
       ├─ loadStoreWeekCapacity                 // shared store-week + approvals
       └─ dispatchWeeklyPlanForDepartment
            ├─ generateWeeklyRotations → weekly_rotations
            ├─ planFlatBayAssignmentsWithCaps   // NOT stewardship
            └─ applySundayAssignmentPlanAdmin
                 → assertApprovedCapacityReady
                 → writeSundayAssignmentsWithCapacity
                 → RPC upsert_sunday_bay_assignments_with_capacity
                 → sunday_bay_assignments
                 → DB section-ownership guards (OPERATIONAL-011)
```

Operator path (**VERIFIED code**):

```text
FloorTab "Assign this week" / SundayAuditAssignmentModal
  → optional Stage (weekly_rotations)
  → capacity board (Master approve via /api/week-capacity)
  → composeStewardshipWeeklyProposal
       → selectBaysWithStrictSectionOwnership   // never cross-section fill
  → applySundayAssignmentPlan → same capacity RPC + ownership guards
```

### 1.3 What “auto-stage OFF” actually means

| Control | Value | Gates cron? | Gates stewardship auto-publish? |
|---------|-------|-------------|----------------------------------|
| `SECTION_AWARE_ROTATION_AUTO_STAGE` | `false as const` | **No** | Product contract: do not wire section-aware planner into auto Stage+Assign |
| `STRICT_SECTION_OWNERSHIP_AUTO_STAGE` | `false as const` | **No** | Same class of hard-off |
| `STEWARDSHIP_WEEK_DISTRIBUTION_AUTO_STAGE` | `false as const` | **No** | Same |
| `stores.sunday_auto_generate` | **true** (prod) | **Yes** | Opens ENGINE-PROD-002 cron gate |
| `stores.sunday_auto_stage_time` | **23:59:00** (prod) | Cron uses 05:00 fallback when 23:59 unreachable | — |

**VERIFIED (prod read-only):** store 2587 has `sunday_auto_generate=true`, timezone `America/Denver`, `sunday_auto_stage_time=23:59:00`.

So: product language “Sunday auto-stage OFF” means **stewardship/section-aware automatic publish remains hard-off in code**, not that the store toggle is off. The store toggle is **on**; the cron still runs a **flat** Stage+Assign attempt when the Sunday gate opens.

---

## 2. Root cause of assignment shortfall

### 2.1 Operator observation (confirmed)

| Metric | Value |
|--------|------:|
| Staged physical bays (`weekly_rotations`, W42, not superseded) | **11** |
| Owned (`sunday_bay_assignments` rows for those bay_ids) | **8** |
| Unowned staged | **3** |
| Approved shared capacity sum | **11** |

Unowned places (**VERIFIED prod**): `40-15`, `39-11`, `7-13` — **no assignment row** (not cleared; simply never owned).

### 2.2 Cause classification

| Hypothesis | Verdict | Evidence |
|------------|---------|----------|
| Capacity configuration mismatch (expect 12 vs 11) | **Not the W42 shortfall** | Staged **11** = approved sum **11**; natural 4×3=12 is legacy/pre-approval |
| Candidate shortage (no bays) | **No** | 11 staged; 3 remain selectable geography |
| **Section eligibility restriction** | **CONFIRMED root cause** | All 3 unowned bays are in Nate’s **CSA** section; Nate already at approved cap **2** |
| Carry-forward constraints | **Not indicated** | `is_carried_over=false` on owned rows; unowned have no rows |
| Selection algorithm defect (random bug) | **No** — algorithm behaving as designed | Strict ownership **never fills unused capacity from another section** |
| Proposal/approval mismatch | **Contributing context** | Approvals complete; proposal can only achieve 8 given this stage set |
| Persistence failure | **No** | 8 rows persisted successfully; 3 never written |
| Cron flat-assign success | **No evidence of full cron ownership** | Ownership timestamps `2026-10-12T17:53Z` (Mon); approvals `2026-10-12T03:16Z` |

### 2.3 Causal chain (**VERIFIED**)

1. Stage produced **11** bays with heavy concentration in Nate’s CSA section (**5** staged in CSA; **2** each in Myself / Specialist-A / Specialist-B).  
2. Operator/path used **strict section ownership** assign (required after OPERATIONAL-011 / stewardship Assign this week).  
3. Nate’s approved capacity = **2** → only 2 of 5 CSA staged bays can be owned by Nate.  
4. Nick / Tracy / Tyson each have remaining approved capacity (**1** unused each) but **zero additional staged bays inside their own sections**.  
5. Product law forbids cross-section quota filling → those 3 CSA leftovers stay unowned.  
6. Floor still shows recovery / “Assign this week” because staged unowned remain (and/or recovery chrome compares to approved shared target).

This matches the earlier SECTION-ROTATION-003 warning: stage draw concentration prevents balanced steward fill even when shared capacity exists.

**Not a capacity-table bug. Not a silent persistence loss. It is stage composition × strict ownership × approved per-person caps.**

---

## 3. Actual configured capacity

### 3.1 What the system expects

| Model | Formula | W42 value |
|-------|---------|----------:|
| Natural / legacy flat | `eligible × BASE_WEEKLY_BAY_QUOTA(3)` | **12** (4×3) |
| **Authoritative approved shared target** | Sum of `store_week_capacity_approvals.approved_capacity` | **11** |
| Stage draw when approvals complete (operator Stage) | `resolveWeeklyStageDrawCount` → approved shared | **11** |
| Hard ceiling per person | `MAX_APPROVED_WEEKLY_BAY_CAPACITY = 3` | — |

**Authoritative expectation for W42 ownership fill = 11, not 12.**  
Expecting twelve without reading approvals is the outdated natural-quota mental model.

### 3.2 Where capacity is stored / who may change it

| Asset | Role |
|-------|------|
| `store_week_capacity_approvals` | Per specialist, per store-week approved 0–3 + schedule fingerprint |
| MasterAdmin `POST /api/week-capacity` | Only Master approves (SEC-OPS-010) |
| Capacity RPC on assignment writes | Enforces shared + per-person caps atomically |
| Schedules | Fingerprint inputs; do not silently set bay quotas |

**This discovery did not change any capacity values.**

### 3.3 Live W42 approvals (**VERIFIED prod read-only**)

| Associate | Approved capacity | Approved at (UTC) |
|-----------|------------------:|-------------------|
| Tyson | **3** | 2026-10-12T03:16:10Z |
| Nate | **2** | 2026-10-12T03:16:10Z |
| Nick | **3** | 2026-10-12T03:16:10Z |
| Tracy | **3** | 2026-10-12T03:16:10Z |
| **Sum** | **11** | |

Matches previously documented 3/2/3/3 fixture — **still current for W42**.

---

## 4. Per-associate candidate analysis (W42)

Section membership totals (**VERIFIED prod**): CSA 60 · Myself 34 · Specialist-A 35 · Specialist-B 31 (sum **160**). Active sections: **4**.

| Associate | Section | Approved cap | Staged bays **in their section** | Selected / owned | Unfilled capacity | Exact shortfall reason |
|-----------|---------|-------------:|--------------------------------:|-----------------:|------------------:|------------------------|
| **Nate** | CSA | 2 | **5** (`7-9`, `39-10`, `40-15`, `39-11`, `7-13`) | **2** (`7-9`, `39-10`) | **0** | At personal cap; **3** remaining staged CSA bays cannot be taken by others |
| **Nick** | Specialist-A | 3 | **2** (`44-6`, `44-11`) | **2** | **1** | No more staged candidates inside Specialist-A |
| **Tracy** | Specialist-B | 3 | **2** (`41-19`, `41-10`) | **2** | **1** | No more staged candidates inside Specialist-B |
| **Tyson** | Myself | 3 | **2** (`6-2`, `6-18`) | **2** | **1** | No more staged candidates inside Myself |
| **Store** | — | **11** | 11 staged / 0 unsectioned | **8** owned | **3** unused cap + **3** unowned staged | Same structural mismatch |

Zebra confirmations on owned rows: **0** (`zebra_entered_at` null on all 8).

---

## 5. Why manual “Assign This Week” is still required

| Reason | Evidence |
|--------|----------|
| Human confirm is a product gate | STAGE-ASSIGN-CUE-001: Stage ≠ Assign; Floor recovery CTA opens Sunday drawer |
| Stewardship auto-publish hard-off | `SECTION_AWARE_*` / stewardship auto-stage constants `false` |
| Cron does not run the stewardship planner | `planFlatBayAssignmentsWithCaps` in `sunday-dispatch.ts` |
| Approvals landed after typical Sunday cron window | Approvals `03:16Z` Mon; cron is Sunday ~05:00 Denver — assign would fail closed without approvals |
| Partial fill still leaves recovery UI | 3 unowned staged bays keep “need an owner” / Assign this week chrome |
| Even a perfect auto-run of today’s stewardship planner on **this** stage set would stop at **8** | Strict ownership + stage concentration |

**Manual Assign this week is required today because automatic stewardship publish is intentionally not wired, and the staged geography cannot fill approved capacity under strict ownership.**

---

## 6. Existing scheduler capabilities

| Capability | Status | Notes |
|------------|--------|-------|
| Vercel Cron weekly | **IMPLEMENTED** | `vercel.json` → `/api/cron/weekly-rotation` Sunday 11:00 UTC |
| Per-store schedule gate | **IMPLEMENTED** | `evaluateSundayAutoRun` |
| Skip if plan already complete | **IMPLEMENTED** | `ALREADY_COMPLETE` / no force overwrite on cron |
| Preserve owned; fill unowned only | **IMPLEMENTED** (cron) | Does not wipe intentional owners when filling |
| Force Draw overwrite | **IMPLEMENTED** (Master UI) | Stages with `force`; not stewardship Assign |
| Capacity approval gate on write | **IMPLEMENTED** | `assertApprovedCapacityReady` |
| Failure statuses | **IMPLEMENTED** | `PARTIAL`, `SKIPPED_SCHEDULE`, `NO_ELIGIBLE_WORKFORCE`, etc. |
| Stewardship/section-aware auto | **HARD OFF** | Compile-time constants |
| Exactly-one cycle marker / edit lock | **NOT IMPLEMENTED** | No “supervisor finalized” flag distinct from completeness |
| Retry that never overwrites edits | **PARTIAL** | Cron preserves owned rows; Force Draw / restage can still replace staged set |

---

## 7. Proposed automatic assignment design (**DESIGN**)

Intended operator behavior (mission):

1. Floor Command runs weekly automatically.  
2. Persists actual assignments (not stage-only).  
3. No manual Assign this week required for the happy path.  
4. Supervisor can edit afterward.  
5. Retries must not overwrite intentional supervisor changes.

### 7.1 Recommended architecture (smallest coherent)

```text
Sunday gate (existing store schedule)
  → ensure capacity approvals ready (fail closed + report)
  → STAGE with section-balanced draw toward approved shared target
  → ASSIGN with composeStewardshipWeeklyProposal (strict ownership)
  → persist via capacity RPC
  → mark cycle result: COMPLETE | PARTIAL | BLOCKED
  → expose Zebra-entry outstanding on This Week (existing fields)
```

**Replace cron’s flat assign planner with the stewardship planner** (or call a shared orchestration that both cron and recovery use). Do **not** enable today’s flat cron as “done.”

### 7.2 Stage composition requirement

Automatic ownership of the full approved sum (**11**) requires stage composition that places enough candidates **inside each steward’s section** up to each person’s approved cap — **without** stealing another section’s bays and **without** inventing topology.

If stage cannot satisfy that, automation must report **PARTIAL** with per-person reasons (as in §4), not silently leave recovery UI unexplained.

### 7.3 Exactly one effective cycle per week

| Rule | Design |
|------|--------|
| First successful COMPLETE | Persist; subsequent cron hits → `ALREADY_COMPLETE` skip |
| PARTIAL | Allow retry fill of **unowned only** until COMPLETE or operator finalizes |
| Supervisor edit | Treat as intentional; retries must not reassign owned bays |
| Force Draw | Remains Master recovery; must remain explicit, not cron |

---

## 8. Supervisor editing contract

Existing capabilities (**VERIFIED code**):

| Action | Path | Guards |
|--------|------|--------|
| Replace owner on a bay | Sunday modal `handleAssign` → `setSundayBayAssignment` | Capacity RPC + section ownership |
| Clear / reassign | Same + Roster call-out redistrib | SEC-OPS-010 supervisor+ |
| Review plan | This Week / Sunday drawer / Overview week signals | Read paths |
| Extra bay after complete week | ENGINE-PROD-003 | Separate from base week fill |

**Preserve:** completed work, verification, historical rotations (`superseded_at`), Zebra clear-on-owner-change trigger.

**Automatic respect for edits (DESIGN):**

1. Retries only target staged bays with **no** owned assignment (already cron behavior).  
2. Do not re-run Force Draw from cron.  
3. Optional later: `plan_finalized_at` / supervisor lock so PARTIAL retries stop after explicit accept — **not present today**.  
4. Do not weaken SEC-OPS-010 (supervisor/Master mutate; associates do not assign).

---

## 9. Retry / idempotency requirements

| Requirement | Today | Needed for auto |
|-------------|-------|-----------------|
| Skip complete plans | Yes (cron) | Keep |
| Fill unowned only | Yes (cron) | Keep; must use stewardship selection |
| Don’t overwrite owned on retry | Yes for assign fill | Keep; extend to refuse restaging owned weeks without Master force |
| Fail closed without approvals | Yes | Keep; surface to operator |
| Clear failure reporting | Status enums exist | Persist last cycle result for Overview/Settings |
| Interrupted execution recovery | Reload + fill unowned | Same; no destructive rewrite |
| Cross-section flat retry | Would hit ownership RPC errors | **Must not** be the automatic planner |

---

## 10. Zebra handoff implications

Preserve Floor Command ≠ Lowe’s Zebra Dashboard (ZEBRA-HANDOFF-002).

| Need | Existing support |
|------|------------------|
| Assignments requiring Zebra entry | Owned `sunday_bay_assignments` with `zebra_entered_at IS NULL` |
| Per-bay handoff status | This Week UI status + typing aid |
| Handoff actor + timestamp | `zebra_entered_by`, `zebra_entered_at` |
| Reminders | Outstanding nulls; Overview does not currently specialize Zebra strip |

Automatic weekly assign **creates** the ownership rows Zebra handoff consumes. It must **not** set Zebra fields or claim Zebra tasks completed. Owner changes already clear Zebra evidence via trigger.

**W42:** all 8 owned bays still need Zebra entry confirmation (0 confirmed). Orient integration remains out of scope.

---

## 11. Database implications

| Change | Needed for discovery? | Needed for auto design? |
|--------|----------------------|-------------------------|
| New tables for specialty | No | No |
| Capacity value changes | No | No (operator-approved only) |
| Section membership redistrib to fill quota | **Forbidden by mission** | **Forbidden** |
| Possible additive: week cycle run log / finalized flag | No | **Optional** for retry clarity |
| Stewardship planner in cron | Code only | Likely **no migration** if RPC already enforces ownership |
| Section-balanced stage draw | Code / draw selection | Likely **no migration** |

**No migrations in this discovery. Do not apply any.**

---

## 12. Security implications

Preserve SEC-OPS-010:

| Surface | Rule |
|---------|------|
| Cron | `CRON_SECRET` Bearer only; service role after gate |
| Capacity approve | MasterAdmin only |
| Manual assign / edit | Supervisor or Master; store + dept asserts |
| Section ownership RPC | Fail closed on MISSING / AMBIGUOUS / MISMATCH |
| PIN-only auth | Unchanged |
| MasterAdmin / RLS | Untouched by this discovery |

Automatic execution must not introduce client-trusted role/store headers or bypass the capacity RPC.

---

## 13. Required operator decisions

| # | Decision | Why |
|---|----------|-----|
| 1 | Accept **11** (approved sum) as the W42 success target, not **12**? | Aligns expectation with capacity contract |
| 2 | Authorize changing **stage composition** so each section receives enough staged bays for its steward’s approved cap? | Required to auto-fill 11 under strict ownership |
| 3 | If stage cannot balance: accept **PARTIAL** (owned &lt; approved) with explicit reasons, vs temporarily relax cross-section fill (**mission forbids quota filling across sections**)? | Product law |
| 4 | Authorize wiring **stewardship Assign** into Sunday cron (flip auto-stage product constants after phone review)? | Today hard-off |
| 5 | Capacity approval timing: must approvals exist **before** Sunday cron, or allow deferred Monday auto-retry? | Approvals currently after Sunday 05:00 window |
| 6 | What marks a week “supervisor accepted” so retries stop? | Edit-safety |
| 7 | Keep Force Draw as Master-only recovery (recommended)? | Prevents cron destruction |
| 8 | SPECIALTY-OPS-001 remains paused — confirm no specialty work in this stream | Mission |

---

## 14. Smallest safe implementation sequence

SPECIALTY-OPS-001 stays paused.

### R0 — Operator decisions (exit of this discovery)

Answers to §13 items 1–4 minimum.

### R1 — Section-balanced stage draw (no auto enable)

| Field | Content |
|-------|---------|
| User problem | Stage parks too many bays in one section → unownable leftovers |
| Reuse | Stage generate path, section membership index, approved caps |
| New | Draw selection constrained by per-steward remaining approved capacity / section pools |
| DB | None expected |
| Auth | Existing generate auth |
| Acceptance | Dry-run W4x: staged-in-section counts ≥ min(cap, available) per steward; 4×160 unchanged |
| Depends | R0.2 |
| Risks | Starving coverage tiers — preserve priority tier order |

### R2 — Unify Assign planner (cron = stewardship)

| Field | Content |
|-------|---------|
| User problem | Cron flat assign ≠ UI stewardship; ownership RPC rejects cross-section |
| Reuse | `composeStewardshipWeeklyProposal`, capacity RPC, preserve-owned fill |
| New | Cron/orchestration calls stewardship assign; retire flat auto-assign for Sunday |
| DB | None expected |
| Auth | Cron secret + existing RPC |
| Acceptance | Auto path cannot write cross-section owners; matches Sunday modal proposal |
| Depends | R1 preferred; R0.4 |
| Risks | Enabling before balanced stage recreates 8/11 PARTIAL |

### R3 — Automatic weekly execution enablement

| Field | Content |
|-------|---------|
| User problem | Manual Assign this week still required |
| Reuse | `evaluateSundayAutoRun`, skip-if-complete, approvals gate |
| New | Flip authorized auto-stage constant(s) **only after** R1+R2 phone acceptance; failure reporting on Overview/Settings |
| DB | Optional run-log table |
| Auth | Unchanged SEC-OPS-010 |
| Acceptance | Happy path: Sunday → 11 owned without manual Assign; retries don’t steal edited owners; PARTIAL explains shortfalls |
| Depends | R0–R2; approvals timing decision |
| Risks | Enabling constants without R1 |

### R4 — Supervisor finalize + Zebra outstanding polish (optional)

Edit lock / finalize marker; Overview Zebra-null reminders. No Orient.

**Explicit NO-GO in sequence:** cross-section quota filling; capacity silent bumps to force 12; specialty work; Orient.

---

## 15. GO / NO-GO recommendation

| Decision | Verdict |
|----------|---------|
| Discovery complete | **GO** |
| Implement / enable automation in this tranche | **NO-GO** |
| Enable current cron as “automatic weekly assignment done” | **NO-GO** (wrong planner + stage concentration) |
| Expect 12 without capacity change | **NO-GO** (authoritative W42 target is **11**) |
| Fill Nate’s leftover bays by assigning Nick/Tracy/Tyson across sections | **NO-GO** (strict ownership / mission) |
| Proceed to **R1 section-balanced stage** after operator authorize | **CONDITIONAL GO** |
| Proceed to **R2/R3 auto stewardship publish** after R1 acceptance | **CONDITIONAL GO** |
| SPECIALTY-OPS-001 | **Paused** (unchanged) |

### Bottom line

W42’s **8 owned / 3 unowned** is explained: approved capacity is **11**, stage placed **5** bays in Nate’s section against Nate’s cap of **2**, and strict section ownership correctly refused to hand those leftovers to associates with spare capacity. Manual Assign this week remains required because stewardship auto-publish is hard-off and/or cannot complete this stage set. Fully automatic weekly assignment needs **section-balanced staging + stewardship assign on the cron path + edit-safe retries** — not flipping today’s flat Stage+Assign and hoping for 12.

**STOP AFTER DISCOVERY.** Do not modify application behavior. Do not enable Sunday automation. Do not deploy.

---

## Evidence index

| Topic | Source |
|-------|--------|
| Cron / dispatch | `vercel.json`; `app/api/cron/weekly-rotation/route.ts`; `lib/store-ops/sunday-dispatch.ts` |
| Auto-stage hard-off | `section-aware-rotation.ts`; `section-ownership-enforcement.ts`; `stewardship-week-distribution.ts` |
| Store schedule gate | `sunday-schedule.ts`; prod `stores` row store 2587 |
| Assign this week | `SundayAuditAssignmentModal.tsx`; `stage-assign-cue-001.contract.test.ts` |
| Capacity | `approved-week-capacity.ts`; `shared-week-capacity.ts`; prod `store_week_capacity_approvals` W42 |
| Strict ownership | `selectBaysWithStrictSectionOwnership`; OPERATIONAL-011 RPC |
| Stage draw vs approved | `weekly-stage-draw.ts`; OPERATIONAL-009 |
| W42 8/11 geography | Read-only SELECT 2026-10-15 (this report §2–4) |
| Zebra | `20261017_zebra_handoff_002_sunday_bay_entry.sql`; ZEBRA-HANDOFF-002 |
| Prior concentration warning | `DEPTSYNC_SECTION_ROTATION_003_REAL_DATA_READINESS.md` §18 |
