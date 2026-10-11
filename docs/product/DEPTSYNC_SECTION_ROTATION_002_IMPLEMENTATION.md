# DEPTSYNC-SECTION-ROTATION-002 — Deterministic Section-Aware Selection and Preview

**Status:** COMPLETE (local implementation + tests; no production deploy / activation)  
**Date:** 2026-10-11  
**Mode:** Controlled local implementation  
**Reference:** [`DEPTSYNC_SECTION_ROTATION_001_DISCOVERY.md`](DEPTSYNC_SECTION_ROTATION_001_DISCOVERY.md)  
**Application:** https://deptsync-hub.vercel.app (unchanged)  
**Supabase:** `fmeinlwhixngednabhgy` (no SQL / no mutations)

**Strict exclusions honored:** No production SQL, no roster/schedule/topology/section mutations, no schema/RLS/auth changes, no capacity-guard weakening, no cron changes, no second-department auto-stage, no production deployment, no automatic section-aware Sunday staging.

---

## 1. Executive summary

Implemented a **pure Hybrid** section-aware preference layer and an **opt-in PROPOSED preview** on the existing Assign this week cue.

| Gate | Result |
|------|--------|
| Priority tiers preserved (carry → seasonal → High → velocity → aging) | **PASS** |
| Steward preference only within tiers / among remaining caps | **PASS** |
| Empty membership / missing stewards degrade to coverage-first | **PASS** |
| Preview does not persist ownership | **PASS** |
| Persistence still via capacity RPC only | **PASS** |
| Sunday auto-stage section preference | **HARD OFF** (`SECTION_AWARE_ROTATION_AUTO_STAGE = false`) |
| Production UI section-aware workflow | **OFF by default** (`NEXT_PUBLIC_DEPTSYNC_SECTION_AWARE_PREVIEW` unset) |
| Typecheck / tests / build | **PASS** (`tsc`; **1600** tests; production build) |

**Production readiness for automatic section-aware staging:** **NO-GO**  
**Local capability + opt-in preview readiness:** **CONDITIONAL GO** (activate only after section membership is populated and operator accepts preview UX)

---

## 2. Files changed

| Path | Change |
|------|--------|
| `lib/store-ops/section-aware-rotation.ts` | **New** — Hybrid ranking, flat assign with steward soft preference, PROPOSED preview + fingerprint |
| `lib/store-ops/section-aware-rotation.test.ts` | **New** — unit/regression fixtures |
| `lib/store-ops/section-rotation-002.contract.test.ts` | **New** — activation / modal / cron contracts |
| `components/admin/SundayAuditAssignmentModal.tsx` | Opt-in PROPOSED preview panel; confirm path recomputes + stale-checks when env enabled |
| `docs/product/DEPTSYNC_SECTION_ROTATION_002_IMPLEMENTATION.md` | This report |

**Untouched (by design):** `sunday-dispatch.ts`, `rotations.ts`, cron route, capacity RPC, Operational Section writers, topology/roster.

---

## 3. Selection architecture

```text
Known candidate bays (staged / supplied — never invented)
    ↓
Priority tiers (authoritative order)
    ↓
Within-tier rank: stewarded-by-eligible → sectioned → unsectioned → stable key
    ↓
Flat multi-associate assign with remaining caps
    + steward match soft score among associates with capacity
    ↓
PROPOSED preview (fingerprint)
    ↓ [opt-in confirm only]
applySundayAssignmentPlan → upsert_sunday_bay_assignments_with_capacity
```

Core exports:

| Function | Role |
|----------|------|
| `rankBaysWithinPriorityTier` / `selectBaysWithSectionPreference` | Stage-candidate ordering helper (not wired into Sunday auto-stage) |
| `planSectionAwareFlatAssignments` | Ownership distribution with steward soft preference |
| `composeSectionAwareWeeklyPreview` | PROPOSED plan + capacity citation + fingerprint |
| `assertSectionAwarePreviewFresh` | Stale preview rejection |
| `SECTION_AWARE_ROTATION_AUTO_STAGE` | Hard `false` |
| `isSectionAwarePreviewEnabled` | Env opt-in for UI |

---

## 4. Priority preservation

Tier order is fixed:

`carry` → `seasonal` → `high` → `velocity` → `aging`

Section preference **cannot** promote a lower-tier bay above a higher-tier bay. Tests assert aging stewarded bays still follow carry. No arbitrary ML scores.

---

## 5. Steward preference behavior

| Rule | Behavior |
|------|----------|
| A Preserve tiers | Yes |
| B Within tier / among caps | Prefer assignee = section steward when that associate has remaining capacity |
| C Fallback | Ordinary coverage / flat assign when no steward match |
| D No steward on section | Section does not restrict; treated as section geography or unsectioned signal |
| E Unsectioned bays | Remain eligible (`coverage_fallback`) |
| F Empty sections | No membership keys → preference inert |
| G Retired bays | Not invented; only supplied candidates considered |
| H Capacity | Per-person remaining caps + shared preview caps; RPC enforces on write |
| I No duplicates | Owned rotation ids skipped in preview; writer upserts by bay |
| J Deterministic | Stable specialist_id / physical key ordering; no randomness |

Stewardship is **not exclusive** — other associates may receive stewarded-section bays when the steward is at capacity (`section_coverage`).

---

## 6. Multi-associate distribution

**Fairness approach:** Iterate coverage-clustered bays; for each bay pick among associates with remaining capacity. Steward match is a score boost (`×10000`), not a first-associate greedy claim of the entire desirable pool.

| Scenario | Result (tests) |
|----------|----------------|
| 1 associate | Caps at remaining (≤3) |
| 2 stewards / 2 sections | Each gets 3; steward matches on own section bays |
| 4 eligible | 12 total, 3 each |
| Steward section > capacity | Overflow to other eligible (`section_coverage`) |
| No memberships | Load sizes match `planFlatBayAssignmentsWithCaps` |

**Tradeoff:** Same-aisle clustering still applies; when many stewarded bays cluster early, the steward fills their 3 first (intended), then others receive remaining section/unsectioned bays. This preserves capacity fairness better than “sort all steward bays first then assign greedily.”

---

## 7. Incomplete topology handling

- Preview/selection only consume **supplied** staged/candidate bays.  
- No aisle-range inference; no invented undocumented locations.  
- `topology_note` on every preview states incomplete membership degrades to coverage-first.  
- Empty production-like membership (Section A, 0 members) → preference has no effect.

---

## 8. Preview integration

Reuses **Assign this week** cue (`SundayAuditAssignmentModal`):

| Default (env unset) | Existing `week-assign-preview` loads + confirm → flat `buildScheduleBalancePlan` |
| Opt-in `NEXT_PUBLIC_DEPTSYNC_SECTION_AWARE_PREVIEW=1` | Additional **PROPOSED · section-aware** panel (associate, bay, section, preference kind, capacity) |

Labels clearly use **PROPOSED** (not ASSIGNED). Preview composition does not write `sunday_bay_assignments`.

No durable draft table introduced.

---

## 9. Stale-preview protection

Fingerprint covers: store, week, proposed rotation ids, assignee ids, section member keys, owned_total, remaining_shared, eligible ids.

On opt-in confirm:

1. Recompute preview from current bays / labor / sections / capacity caps  
2. If a displayed preview exists, `assertSectionAwarePreviewFresh` must pass  
3. Persist only recomputed items via existing `applySundayAssignmentPlan` (capacity RPC)

Schedule, assignment, section membership, or capacity drift → operator must refresh (error message), not silent commit of stale proposals.

---

## 10. Capacity RPC integration

- Confirm path still calls `applySundayAssignmentPlan` → `writeSundayAssignmentsWithCapacity` → `upsert_sunday_bay_assignments_with_capacity`.  
- No second writer.  
- Preview caps are presentation-only; RPC remains authoritative (person ≤3, shared target, completed counts, advisory lock, auth restrictions).

---

## 11. Activation boundary

| Boundary | State |
|----------|-------|
| `SECTION_AWARE_ROTATION_AUTO_STAGE` | `false` (compile-time const) |
| `sunday-dispatch.ts` / `rotations.ts` / cron | **Do not import** section-aware module (contract-tested) |
| Preview UI | Off unless `NEXT_PUBLIC_DEPTSYNC_SECTION_AWARE_PREVIEW=1` |
| Second-department auto-stage | Unchanged **NO-GO** |

This milestone prepares capability; it does **not** activate production automatic section-aware assignments.

---

## 12. Test results

| Gate | Result |
|------|--------|
| Focused section-aware + contracts | **24 PASS** |
| Full suite | **1600 PASS** (127 files) |
| `npx tsc --noEmit` | **PASS** |
| `npm run build` | **PASS** |

Coverage includes: tier preservation, steward within tier, cross-section fallback, empty sections, missing stewards, unsectioned, missing schedules, 1/2/4 associates, capacity consumed, duplicate/owned skip, deterministic ties, preview non-persistence, stale fingerprint, cross-store fingerprint isolation, coverage-first fallback, auto-stage hard-off, dispatch/cron non-wiring.

---

## 13. Remaining risks

| Risk | Mitigation / next step |
|------|------------------------|
| Empty section membership in production | Preference inert until operator maps bays into sections |
| Incomplete aisle/bay topology | Engine never invents bays; operator continues documentation |
| Opt-in confirm without displayed preview | Uses recomputed plan; when displayed, fingerprint enforced |
| Future accidental auto-stage wiring | Contracts forbid dispatch/rotations/cron imports; keep const false until authorized tranche |
| Preview capacity is approximate vs RPC | RPC still rejects overflow; fingerprint includes owned/remaining |

---

## 14. Production readiness verdict

| Question | Verdict |
|----------|---------|
| Local Hybrid selector + tests | **GO** |
| Opt-in local preview (env flag) | **CONDITIONAL GO** — after membership populated; operator review of UX |
| Ship / deploy this tranche to production | **NO-GO** (mission) |
| Enable section-aware Sunday automatic staging | **NO-GO** |
| Enable default production preview UI | **NO-GO** until activation tranche |
| Weaken capacity guard / dual-dept auto-stage | **NO-GO** |

**STOP — implementation complete locally. No production activation.**
