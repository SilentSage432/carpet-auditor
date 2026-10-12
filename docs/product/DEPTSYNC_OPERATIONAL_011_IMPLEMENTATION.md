# DEPTSYNC-OPERATIONAL-011 — Strict Section Ownership Enforcement

**Status:** COMPLETE (local implementation; **no deploy / no production migrations / no data mutations**)  
**Date:** 2026-10-12  
**Mode:** Focused implementation  
**Store (acceptance fixture):** 2587  
**References:**  
[`DEPTSYNC_OPERATIONAL_009_IMPLEMENTATION.md`](DEPTSYNC_OPERATIONAL_009_IMPLEMENTATION.md) ·  
[`DEPTSYNC_SECTION_ROTATION_006_DISTRIBUTION_IMPLEMENTATION.md`](DEPTSYNC_SECTION_ROTATION_006_DISTRIBUTION_IMPLEMENTATION.md) ·  
[`DEPTSYNC_RD_3_OPERATIONAL_SECTIONS.md`](DEPTSYNC_RD_3_OPERATIONAL_SECTIONS.md)

**Strict exclusions honored:** No Operational Sections rebuild; no W41 rewrite; no production SQL applied; no Vercel deploy; Sunday auto-stage remains **HARD OFF**.

---

## 1. Root cause and affected code paths

**Root cause:** Weekly distribution treated Operational Sections as a soft stewardship preference. After Phase A steward fill, Phase B aisle-diverse coverage could select any remaining tier bay, and `planSectionAwareFlatAssignments` could assign a bay to a non-owner when the steward was at capacity (`section_coverage` / `coverage_fallback`).

| Path | Prior behavior | OPERATIONAL-011 |
|------|----------------|-----------------|
| `composeStewardshipWeeklyProposal` / `selectBaysWithStewardshipDistribution` | Soft preference + cross-section Phase B | Hard ownership; associate-first within owned sections only |
| `planSectionAwareFlatAssignments` | Soft steward boost | Owner-only; empty membership → zero items |
| `handleBalanceAssign` (Sunday drawer) | Stewardship persist | Same persist writer; proposal now strict + conflict keys |
| `upsert_sunday_bay_assignments_with_capacity` | Capacity only | Capacity **+** section ownership |
| Manual / auto-assign / extra-bay / call-out / Sunday dispatch | Could write cross-section via RPC | RPC rejects mismatch / missing / ambiguous |
| Sunday auto-stage | OFF | Remains OFF |

Authoritative membership remains persisted `operational_section_members` (Store 2587: 4 sections / 160 bays). Aisle maps are not hardcoded into the algorithm.

---

## 2. Ownership enforcement implementation

**New module:** `lib/store-ops/section-ownership-enforcement.ts`

| Capability | Behavior |
|------------|----------|
| `inspectSectionOwnershipEvidence` | Fail closed on missing membership, ownerless memberships, or explicit conflict keys |
| `selectBaysWithStrictSectionOwnership` | Per associate, only owned bays; priority tiers; within-section aisle diversity; never fill from another section |
| `planStrictSectionOwnershipAssignments` | Persist-plan assigner: bay → primary owner only |
| `buildSectionOwnershipDigest` | Fingerprint input so ownership changes stale proposals |
| `explainUnfilledCapacity` | Explains unfilled approved capacity (no section / insufficient eligible bays / blocked) |

**Composer:** `composeStewardshipWeeklyProposal` now requires membership evidence, blocks on conflicts, emits `associate_summaries` + `unfilled_capacity`, and sets `coverage_fallback_count = 0`.

**UI:** `SundayAuditAssignmentModal` shows associate → owned section → approved capacity → proposed count → aisles → unfilled reason. Confirm remains one explicit **Assign this week** action.

---

## 3. Database safeguards

**Migration (local only — not applied to production):**  
`supabase/migrations/20261018_operational_011_section_ownership.sql`

Replaces `upsert_sunday_bay_assignments_with_capacity` with the same capacity/advisory-lock contract plus:

| Exception | When |
|-----------|------|
| `SECTION_OWNERSHIP_MISSING` | No rotation/location evidence, no active membership, or section has no primary owner |
| `SECTION_OWNERSHIP_AMBIGUOUS` | More than one active membership for the physical bay |
| `SECTION_OWNERSHIP_MISMATCH` | Assignee ≠ section primary owner |
| Cleared rows | Ownership checks skipped |

Return payload includes `section_ownership_enforced: true`. Historical assignment rows are not rewritten or deleted.

App error classification extended in `lib/store-ops/shared-week-capacity.ts`.

Local harness notes: `scripts/sql/operational-011-section-ownership-local-validation-harness.sql`.

---

## 4. Proposal behavior

For each eligible associate:

1. Load approved remaining capacity  
2. Resolve owned Operational Section memberships  
3. Select eligible staged/candidate bays **inside that section only**  
4. Preserve priority tiers (`carry → seasonal → high → velocity → aging`)  
5. Prefer aisle diversity **within** the section  
6. Select up to approved remaining capacity  
7. Emit complete owned proposal for one operator confirm  

If eligible owned bays are insufficient → fewer assignments + unfilled reason.  
Unused capacity is never filled from another associate’s section.

Ownership-change invalidation: fingerprint includes `ownership_digest`; confirm uses `assertStewardshipProposalFresh` (regenerate required).

---

## 5. Legacy path protection

| Path | Protection |
|------|------------|
| Legacy `buildScheduleBalancePlan` | Still preview-only; not used by `handleBalanceAssign` persist |
| Soft section-aware opt-in preview | Hard ownership when membership present; empty map assigns nothing |
| Manual / Auto-Assign All to Me | Write boundary RPC rejects cross-section |
| Extra-bay / call-out / admin plan writers | Same RPC |
| Sunday Stage+Assign dispatch planner | Auto-stage remains OFF; any future write still hits RPC |

No silent unrestricted fallback when ownership evidence is missing.

---

## 6. Test results

| Suite | Result |
|-------|--------|
| `section-ownership-enforcement.test.ts` | **PASS** (17) — Tyson/Nate/Nick/Tracy owned-only, cross-section refused, capacity, priority, aisle diversity, unfilled, missing/overlap fail closed, stale ownership, legacy/RPC contracts, history intact, Zebra independent, auto-stage OFF |
| `stewardship-week-distribution.test.ts` | **PASS** (18) — updated for hard ownership |
| `section-aware-rotation.test.ts` | **PASS** (21) — updated for owner-only assign |
| `stage-assign-cue-001` / `weekly-stage-draw` / `approved-week-capacity` / `section-rotation-002` | **PASS** |
| Focused total | **92 PASS** |
| `tsc --noEmit` | **PASS** |
| Relevant eslint | Pre-existing modal set-state-in-effect / unused import; new helpers clean |
| `npm run build` | **PASS** |

---

## 7. Migration requirements

| Item | Status |
|------|--------|
| `20261018_operational_011_section_ownership.sql` | Written locally |
| Apply to production | **NOT DONE** (explicit stop) |
| Section / membership data rebuild | **Not required** |
| W41 / historical assignment rewrite | **Not required / forbidden** |

Release sequence later: app deploy may ship first only if RPC already enforces; preferred controlled release applies migration before relying on DB fail-closed in production.

---

## 8. Release readiness

| Gate | Status |
|------|--------|
| Local implementation | **GO** |
| Production migration applied | **NO-GO** (not authorized this tranche) |
| Deploy | **NO-GO** (stop after implementation) |
| Phone acceptance | Pending after controlled release |
| Sunday auto-stage | Must stay **OFF** |
| Data preservation (4 sections / 160 members / schedules / approvals / history / Zebra) | **Preserved** (untouched) |

**Verdict:** **CONDITIONAL GO** for a later controlled release (app + migration). **STOP** after local implementation.

---

## 9. Remaining blockers

1. Production migration not applied — DB does not yet reject cross-section writes live.  
2. Deploy not performed.  
3. Call-out redistribute to peers outside a bay’s section will fail closed at RPC after migration (carry path remains).  
4. Operator must still approve weekly capacity before Assign (intentional).  
5. Phone acceptance of ownership proposal UX after release.
