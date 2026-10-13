# DEPTSYNC-MAP-003 — Supervisory Bay Priority for Weekly Rotation

**Status:** COMPLETE — **released via MAP-003 production release** (`bd9bbab`; migration applied)  
**Date:** 2026-10-13  
**Mode:** Focused implementation → controlled production release  
**Authority:** Mission brief · OPERATIONAL-011/012 · SECTION-ROTATION-005/006 · MAP-001/002 · PRIORITY-UX-002 (distinct durable High)  
**Production:** [`DEPTSYNC_MAP_003_PRODUCTION_RELEASE.md`](./DEPTSYNC_MAP_003_PRODUCTION_RELEASE.md)

Week-scoped supervisor intent that a Map bay receive preferential consideration in the existing ownership-bound weekly proposal. Not an assignment. Does not increase capacity, transfer ownership, or create Zebra tasks.

**Note on naming:** MAP-001’s earlier “MAP-003 walking cues” presentation tranche is **superseded in product sequencing** by this supervisory priority mission. Walking cues remain deferred (optional presentation) and are not started here.

---

## 1. Existing contracts reused

| Asset | Reuse |
|-------|--------|
| `composeStewardshipWeeklyProposal` / `classifyBayPriorityTier` | Preferential draw + explainable proposal (no second engine) |
| `selectBaysWithStrictSectionOwnership` / OPERATIONAL-011 | Owned-section-only selection; never cross-section fill |
| `assertStewardshipProposalFresh` + fingerprint | Stale proposal / ownership / priority digest invalidation |
| `store_week_capacity_approvals` + capacity RPC | Hard capacity limits unchanged |
| `upsert_sunday_bay_assignments_with_capacity` | Only writer for confirmed assignments; priorities never write SBA |
| `listOperationalSections` / `indexBaySectionLookups` | Resolve section ownership at prioritize time (no hardcoded aisles) |
| `canMutateRotationPriority` / `requireSupervisorOrAdmin` | Supervisor + Master write gate (same class as High) |
| `SundayAuditAssignmentModal` **Assign this week** | Single confirmation for complete proposal |
| Durable High (`priority_override`) | Left alone — distinct from week-scoped intent |
| Pin-to-week / Zebra | Untouched; Map still does not assign |

---

## 2. Priority persistence

**Table:** `store_week_bay_priorities`  
**Migration (local only):** `supabase/migrations/20261019_map_003_week_bay_priorities.sql`

| Property | Behavior |
|----------|----------|
| Week-specific | `week_label` + `week_starting` (ISO week); Map default = next ISO week |
| Inspectable | Active rows listable by store/week/bay; proposal outcomes explain inclusion |
| Revocable | Soft revoke via `revoked_at` / `revoked_by_specialist_id` |
| Deduplicated | Unique active index on store/week/department/aisle/bay |
| Attributable | `prioritized_by_specialist_id` required |
| Ownership snapshot | `section_id` / `section_name` / `owner_specialist_id` at prioritize time; proposal re-resolves live ownership |
| No silent carry | Composer filters `priority.week_label === proposal.week_label` |

Writes go through service-role API after Supervisor/Master auth. Authenticated clients get store-scoped SELECT only (JWT store match), matching capacity-approval RLS pattern.

---

## 3. Map interaction

Bay sheet (`WalkTheFloorSheet`) when `canMutateRotationPriority`:

- **Prioritize for Next Week** → `POST /api/store-locations/week-bay-priority`
- Active state shown with week label + section context
- **Remove next-week priority** → `DELETE` revoke
- Copy states intent only (not assignment / capacity / ownership transfer)
- Durable High toggle remains separate
- Pin-to-week remains gated (`canMutate={false}` on Map)

Ownership is resolved from persisted Operational Sections; missing/ambiguous ownership refuses the priority.

---

## 4. Rotation integration

`composeStewardshipWeeklyProposal` accepts `supervisorPriorities` for the proposal week.

1. Matching staged candidates elevate to tier **`supervisor`** (after `carry`, before `seasonal` / `high` / `velocity` / `aging`).
2. Selection still runs `selectBaysWithStrictSectionOwnership` — owned section only, approved remaining capacity, aisle diversity within section.
3. Fingerprint includes `#prio:` digest so priority changes stale the UI proposal.
4. Outcomes emitted as `supervisor_priorities` with status + reason (included / not included / already assigned).
5. Auto-stage flags remain **hard OFF**.

Priorities never invent staged rotations, never write `sunday_bay_assignments`, and never bypass RPC ownership/capacity guards.

---

## 5. Proposal review behavior

Sunday drawer shows a **Supervisor priorities (intent only)** block distinguishing:

| Status | Meaning |
|--------|---------|
| Priority requested / Included in proposal | Preferential pick present in PROPOSED items — not assigned until confirm |
| Not included + reason | Capacity exhausted, not staged, ownership missing/changed, owner ineligible, etc. |
| Already assigned | Bay already owned this week |

Proposed items that came from supervisor intent show a **priority requested** marker. One **Assign this week** confirmation still persists the full proposal.

---

## 6. Ownership / capacity enforcement

| Rule | Enforcement |
|------|-------------|
| Operational Section ownership | Prioritize refuses missing/ambiguous; proposal uses live membership; RPC still fail-closed on write |
| Approved capacity | Unchanged hard limits; excess priorities → `capacity_exhausted` explanation |
| No cross-section fill | Strict ownership selector unchanged |
| Already assigned | Skipped via `ownedRotationIds`; outcome `already_assigned` |
| Ownership changed after priority | Outcome `owner_changed`; live owner used for any pick |
| Unauthorized / cross-store | `requireSupervisorOrAdmin` + department scope + store_number on rows |

---

## 7. Migration requirements

| Item | Status |
|------|--------|
| `20261019_map_003_week_bay_priorities.sql` | Written locally |
| Apply to production | **NOT DONE** (forbidden this tranche) |
| App-only deploy without migrate | Prioritize API returns schema-missing / empty list fail-closed |
| Preferred release later | Apply migration before relying on Map priority persistence in production |

---

## 8. Test results

```bash
npx vitest run \
  lib/store-ops/week-bay-priority.test.ts \
  lib/store-ops/stewardship-week-distribution.test.ts \
  lib/store-ops/section-ownership-enforcement.test.ts \
  lib/rd2.floor-command-map.contract.test.ts \
  lib/store-ops/section-aware-rotation.test.ts
```

| Suite | Result |
|-------|--------|
| `week-bay-priority.test.ts` | **14 PASS** |
| `stewardship-week-distribution.test.ts` | **18 PASS** |
| `section-ownership-enforcement.test.ts` | **17 PASS** |
| `rd2.floor-command-map.contract.test.ts` | **7 PASS** |
| `section-aware-rotation.test.ts` | **21 PASS** |
| **Total** | **77 PASS** |

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | Pass |
| IDE lint (touched files) | Clean |
| `npx next build` | Pass — `/api/store-locations/week-bay-priority` present |

Covered: preferential inclusion, capacity exhaustion, not staged, ownership missing/changed, already assigned, different week labels (no silent carry), Map/API/migration contracts, auto-stage OFF, existing ownership regression suites.

---

## 9. Release readiness

**CONDITIONAL GO** for a later controlled release (migration + app) after operator phone review.

| Gate | Status |
|------|--------|
| Local implementation | **GO** |
| Production migration | **NO-GO this tranche** |
| Production deploy | **NO-GO this tranche** |
| Sunday auto-stage | Remains **OFF** |
| Second rotation engine | **Not introduced** |

---

## 10. Remaining blockers

1. Local/production apply of `20261019_map_003_week_bay_priorities.sql` not authorized.  
2. Phone acceptance of Map prioritize + Sunday priority review pending.  
3. MAP-001 walking-cues presentation (optional aisle/bay markers) still deferred.  
4. MAP-004 named zone geography — not started.  
5. Pin-to-week on Map remains gated (intentional).  

**STOP. Do not deploy. Do not begin MAP-004.**
