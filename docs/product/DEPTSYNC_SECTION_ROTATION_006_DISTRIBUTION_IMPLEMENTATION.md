# DEPTSYNC-SECTION-ROTATION-006 — Stewardship-Aware Weekly Bay Distribution

**Status:** COMPLETE (local implementation + tests; no production SQL / deploy / assignments / auto-stage)  
**Date:** 2026-10-11  
**Mode:** Controlled local implementation  
**Store (acceptance fixture):** 2587  
**Week fixture:** 2026-W42 (2026-10-12 … 2026-10-18)  
**Supabase production:** `fmeinlwhixngednabhgy` — **no SQL applied in this tranche**  
**Application:** https://deptsync-hub.vercel.app (unchanged)

**References:**  
[`DEPTSYNC_SECTION_ROTATION_001_DISCOVERY.md`](DEPTSYNC_SECTION_ROTATION_001_DISCOVERY.md) ·  
[`DEPTSYNC_SECTION_ROTATION_002_IMPLEMENTATION.md`](DEPTSYNC_SECTION_ROTATION_002_IMPLEMENTATION.md) ·  
[`DEPTSYNC_SECTION_ROTATION_003_REAL_DATA_READINESS.md`](DEPTSYNC_SECTION_ROTATION_003_REAL_DATA_READINESS.md) ·  
[`DEPTSYNC_SECTION_ROTATION_004_AVAILABILITY_DISCOVERY.md`](DEPTSYNC_SECTION_ROTATION_004_AVAILABILITY_DISCOVERY.md) ·  
[`DEPTSYNC_SECTION_ROTATION_005_CAPACITY_IMPLEMENTATION.md`](DEPTSYNC_SECTION_ROTATION_005_CAPACITY_IMPLEMENTATION.md)

**Strict exclusions honored:** No production SQL; no Vercel deploy; no production assignment creation; no automatic Sunday staging; no production capacity approvals inserted; Sunday auto-stage remains **HARD OFF**.

---

## 1. Executive summary

Completed the section-aware weekly rotation **proposal engine** on top of ROTATION-005 operator-approved capacity. The planner now considers operational priority, associate section stewardship, approved individual weekly capacity, existing assignments, eligible documented bays, and geographic (aisle) distribution — producing deterministic, explainable weekly assignment proposals for operator review before Zebra entry.

| Gate | Result |
|------|--------|
| ROTATION-005 preserved + committed | **PASS** (`6b5ff6a`) |
| Concentration root cause confirmed | **PASS** (documented below) |
| Within-tier steward fill + aisle diversity | **PASS** |
| Approved capacity integration | **PASS** |
| Explainable selection (no LLM) | **PASS** |
| Sunday drawer proposal UI | **PASS** |
| Freshness gate on confirm | **PASS** |
| Auto-stage / production preview | **OFF** |
| Production SQL / deploy / assignments | **NOT DONE** (correct) |

**Local readiness:** **GO** for review.  
**Production release:** **CONDITIONAL GO** — after ROTATION-005 migration + operator week approvals + phone acceptance of distribution UX; keep auto-stage/preview OFF.

---

## 2. ROTATION-005 commit and validation

| Item | Value |
|------|--------|
| Commit | `6b5ff6a` |
| Message | `SECTION-ROTATION-005: operator-approved weekly capacity` |
| Scope | Capacity approvals schema/domain/API/UI + tests + 005 report |
| Excluded from commit | Unrelated SEC-OPS / RD_6 docs, `tmp/`, SEC-OPS-010 edits |
| Roster TTL failure | Reproduced on clean `main` without 005 files when Supabase env present → **pre-existing test-isolation defect**, not a 005 regression |

---

## 3. Confirmed concentration root cause

**Confirmed:** After coverage-first tier ranking, candidate draw used lexicographic / take-first-N ordering within a priority tier (`rankBaysWithinPriorityTier` + slice). That collapses the shared weekly draw into the earliest aisle keys **before** soft steward preference at assign time can act. Steward preference then only reassigns among an already aisle-concentrated set.

**Not the cause:** Randomness; equal aisle quotas; absolute section ownership; inventing new priority tiers.

**Fix (ROTATION-006):** Replace within-tier take-first-N with:

1. **Phase A** — round-robin stewards who still have remaining approved capacity, picking their stewarded bays in stable aisle/bay order.  
2. **Phase B** — aisle-diverse coverage among remaining equivalent-tier candidates (minimize aisle count already selected, then stable aisle/bay key).

Priority tiers are never leapfrogged.

---

## 4. Selection algorithm changes

**Module:** `lib/store-ops/stewardship-week-distribution.ts`

| Function | Role |
|----------|------|
| `selectBaysWithStewardshipDistribution` | Within-tier steward capacity fill → aisle-diverse coverage |
| `composeStewardshipWeeklyProposal` | Capacity gate + distribute + soft-assign + explanations + fingerprint |
| `classifyBayPriorityTier` | Map staged/candidate bays into existing tier buckets |
| `assertStewardshipProposalFresh` | Fingerprint + actionable check before confirm |
| `STEWARDSHIP_WEEK_DISTRIBUTION_AUTO_STAGE` | `false` (hard off) |

Assign still uses `planSectionAwareFlatAssignments` (soft steward preference among remaining caps). Persistence remains `applySundayAssignmentPlan` → capacity RPC.

---

## 5. Priority preservation

`SECTION_AWARE_TIER_ORDER` unchanged: `carry → seasonal → high → velocity → aging`. Distribution runs **inside** each tier only; no new operational priority tiers; no equal aisle/section quotas.

---

## 6. Section preference behavior

- Stewarded bays preferred when the steward has remaining capacity (Phase A).  
- Outside-section selection remains possible when stewarded inventory is exhausted or only other sections remain (Phase B + soft assign).  
- Unavailable associates (0 remaining capacity) receive no proposals; their section membership is not rewritten; workload is **not** forcibly redistributed as a full transfer of their stewardship.  
- Zero-bay named locations (SHOW-L, SHOW-R, CARPET-WALL) are never fabricated.

---

## 7. Capacity integration

Consumes ROTATION-005 via `buildPreviewCapacityCaps` + `assertApprovalsReadyForAssignment`:

```
remaining_capacity = approved_weekly_capacity − existing assignments
```

Shared draw ≤ `remaining_shared` and ≤ sum of per-person remaining. Missing/stale/incomplete approvals → `actionable: false` (blocked proposal, not silent assign). W42 acceptance fixture: 3+3+3+2 = **11**.

---

## 8. Proposal explanation model

Each item carries `SelectionExplanation` with deterministic `codes` + `summary` derived from evidence only:

- priority tier  
- steward section match / section coverage / coverage fallback  
- aisle distribution consideration  
- remaining capacity after pick  

No LLM. No invented overdue claims.

---

## 9. UI integration

**Surface:** existing `SundayAuditAssignmentModal` (no new primary nav).

- Loads operational sections when the drawer opens (feeds distribution).  
- When a capacity board exists, shows `data-testid="stewardship-week-proposal"` with approved capacity context, proposed items, explanations, remaining capacity.  
- **BLOCKED** vs **PROPOSED** headers distinguish non-actionable diagnostic from actionable plan.  
- Confirm still **"Assign this week"** → `handleBalanceAssign` → when approvals complete, recomposes stewardship proposal, freshness-checks fingerprint, then `applySundayAssignmentPlan` (capacity RPC remains authoritative).  
- Display alone never creates assignments.

---

## 10. Freshness protection

Fingerprint includes store, week, rotation ids, assignee ids, section member keys, owned total, remaining shared, eligible ids (`buildSectionAwarePreviewFingerprint`). Confirm path calls `assertStewardshipProposalFresh`. Stale capacity/assignments/sections/candidates reject with an explicit refresh message. DB/RPC constraints remain authoritative even if UI is stale.

---

## 11. Test results

**Focused:** `lib/store-ops/stewardship-week-distribution.test.ts` — covers acceptance items 1–20 (capacity 11, per-person caps, existing ownership, missing/stale/zero capacity, duplicates, priority, aisle diversity, stewardship preference, outside-section, unavailable ownership preserved, no fabricated topology, determinism, stale confirm, auto-stage OFF, empty-section fallback).

**Also run:** approved-week-capacity, section-aware-rotation, stage-assign-cue, section-rotation-002 contracts.

| Check | Result |
|-------|--------|
| `tsc --noEmit` | **PASS** |
| Focused stewardship + rotation contracts | **PASS** (66) |
| Full vitest | **1693 PASS** / **1 FAIL** (`roster-life001` TTL 5000ms — pre-existing isolation defect; not introduced by 006) |
| `npm run build` | **PASS** |
| Lint (changed files) | **PASS** |

---

## 12. Remaining production blockers

1. ROTATION-005 migration **not** applied on production.  
2. No production capacity approvals for W42 (must be operator-entered).  
3. App not deployed with ROTATION-006 UI/planner.  
4. Sunday auto-stage / section-aware production preview must stay **OFF**.  
5. Phone acceptance of stewardship proposal UX.  
6. Live section inventory may drift from ROTATION-003 snapshot — re-verify before activation.  
7. Roster-life TTL test isolation defect remains open (pre-existing).

---

## 13. Recommended release sequence

1. Apply ROTATION-005 migration on production (authorized tranche).  
2. Deploy app including ROTATION-005 + ROTATION-006.  
3. Operator approves W42 capacities in Sunday drawer.  
4. Review stewardship proposal; confirm Assign this week only after review.  
5. Keep `SECTION_AWARE_ROTATION_AUTO_STAGE` / `STEWARDSHIP_WEEK_DISTRIBUTION_AUTO_STAGE` false; do not enable production section-aware preview flag until separately authorized.

---

## 14. GO / CONDITIONAL GO / NO-GO

| Scope | Verdict |
|-------|---------|
| Local engineering completeness | **GO** |
| Production SQL / deploy / auto-stage / preview | **NO-GO** (this tranche) |
| Production release after 005 migrate + approvals + phone review | **CONDITIONAL GO** |

**STOP** after reporting. No push. No deploy. No production SQL.
