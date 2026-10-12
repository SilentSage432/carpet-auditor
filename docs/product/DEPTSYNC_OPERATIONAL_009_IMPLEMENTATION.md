# DEPTSYNC-OPERATIONAL-009 — Operational Sections UI Repair & Rotation Assignment Completion

**Status:** COMPLETE (local implementation; **no deploy / no production mutations**)  
**Date:** 2026-10-12  
**Mode:** Focused implementation  
**Store (context):** 2587  
**References:**  
[`DEPTSYNC_OPERATIONAL_SECTIONS_008_REGRESSION.md`](DEPTSYNC_OPERATIONAL_SECTIONS_008_REGRESSION.md) ·  
[`DEPTSYNC_SECTION_ROTATION_006_DISTRIBUTION_IMPLEMENTATION.md`](DEPTSYNC_SECTION_ROTATION_006_DISTRIBUTION_IMPLEMENTATION.md) ·  
[`DEPTSYNC_SECTION_ROTATION_005_CAPACITY_IMPLEMENTATION.md`](DEPTSYNC_SECTION_ROTATION_005_CAPACITY_IMPLEMENTATION.md)

**Strict exclusions honored:** No section data rebuild; no W41 rewrite; no production SQL; no Vercel deploy; Sunday auto-stage remains **HARD OFF**.

---

## 1. Confirmed UI fix

**Root cause (008):** Pin Full Store / `all` fell back to `departments[0]` (name-ordered non-flooring). First fetch without filter showed 4 sections; second filtered fetch returned `[]` and cleared the list.

**Fix:**

| Change | Location |
|--------|----------|
| `resolveOperationalSectionsListFilter` — pin `all` ⇒ omit `department_id`; never `departments[0]` | `lib/store-ops/operational-sections-department-filter.ts` |
| Request generation guard — stale responses ignored | `OperationalSectionsPanel` + `shouldApplySectionsFetchResult` |
| Empty states: `none_configured` vs `none_in_department` vs load failure | Panel + `classifySectionsEmptyState` |
| Create/edit still requires an explicit department pin | Panel (`canManageInDepartment`) |

**Preserved:** Section management APIs, membership model, 160 production memberships (untouched).

---

## 2. Root cause of unowned bays (“12 still need an owner”)

**CONFIRMED from repository evidence:**

1. Sunday / recovery **stages** `weekly_rotations` without writing `sunday_bay_assignments` (`handleGenerateFlooring` → `generateRotations` only).  
2. Floor `composeThisWeekOwnership` marks staged rows without assignment as unowned → `needsOwnershipRecovery` → “still need an owner.”  
3. Ownership was a **second** step (`Assign this week` → `handleBalanceAssign`).  
4. Legacy `buildScheduleBalancePlan` could still persist ownership when capacity board was missing or incomplete paths fell through — bypassing stewardship.  
5. Stage draw used `eligible × 3` even when approved shared capacity was lower (e.g. 11), leaving excess staged rows permanently “unowned” after a capacity-correct assign.

**Not the cause:** Deleted Operational Sections (DB still 4×160). Zebra handoff. Silent API→empty on auth errors (error path kept prior sections).

---

## 3. Assignment distribution correction

| Behavior | Implementation |
|----------|----------------|
| Persist path always stewardship when assigning | `handleBalanceAssign` → `composeStewardshipWeeklyProposal` only |
| Require capacity board + `approvals_complete` | Fail closed with explicit errors |
| Every plan item must have `specialist_id` | Guard before `applySundayAssignmentPlan` |
| Partial allocation messaging | Achievable count vs staged unowned; excess beyond capacity explained |
| Stage draw = approved shared target when approved | `resolveWeeklyStageDrawCount` |
| Proposal is the primary Assign preview | Stewardship items own `week-assign-preview` when approvals complete |
| One operator persist action | Still explicit **Assign this week** (no auto-publish) |
| Auto-stage | Remains `SECTION_AWARE_ROTATION_AUTO_STAGE = false` |

Ownership recovery goal on Floor uses approved shared target so excess staged bays beyond capacity do not keep the recovery chrome open after a full capacity fill (`approvedSharedTarget` on `composeThisWeekOwnership`).

---

## 4. Legacy path handling

| Path | Handling |
|------|----------|
| `buildScheduleBalancePlan` | Remains for pre-approval **preview quotas only**; **removed from persist** (`handleBalanceAssign`) |
| Section-aware opt-in preview | Preview-only; Assign does **not** persist via that path |
| Historical W41 assignments | **Untouched** |
| Existing capacity / sections / Zebra evidence | **Untouched** |

---

## 5. Tests and validation

| Suite | Result |
|-------|--------|
| `operational-sections-department-filter.test.ts` | **PASS** (flash/race + empty-state) |
| `weekly-stage-draw.test.ts` | **PASS** (draw count, recovery goal, assign contracts) |
| `stage-assign-cue-001.contract.test.ts` | **PASS** (updated for stewardship persist) |
| `stewardship-week-distribution.test.ts` | **PASS** (18) |
| `approved-week-capacity.test.ts` | **PASS** (18) |
| Related RD-3 / LAB-WEEK / UX-REDUCE / ROTATION-002 | **PASS** |
| Focused total | **82 PASS** |
| `tsc --noEmit` | **PASS** |
| Relevant eslint (new helpers) | Clean; pre-existing set-state-in-effect elsewhere |
| `npm run build` | **PASS** |

---

## 6. Database migration requirements

**None.** No schema changes. No production SQL.

---

## 7. Production release readiness

| Gate | Status |
|------|--------|
| Local implementation | **GO** |
| Data rebuild / membership rewrite | **NO-GO** (not required) |
| Deploy | **Not authorized** — stop after implementation |
| Phone acceptance after deploy | Required later (sections list + Assign this week with approvals) |
| Sunday auto-stage | Must stay **OFF** |

**Verdict:** **CONDITIONAL GO** for a controlled app-only release after operator review. No migration step.

---

## 8. Remaining blockers

1. Operator must still **approve weekly capacity** once per week before Assign (intentional).  
2. Already-staged weeks with `eligible×3` > approved shared need one Assign after deploy; excess beyond capacity stays unassigned by design (recovery chrome respects approved target).  
3. W41 historical non-steward aisles remain historical — do not rewrite.  
4. Deploy not performed in this tranche.

---

**STOP.** No production deploy in OPERATIONAL-009.
