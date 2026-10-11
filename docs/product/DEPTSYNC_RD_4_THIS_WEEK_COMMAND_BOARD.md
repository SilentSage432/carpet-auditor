# DEPTSYNC-RD-4 — This Week Command Board

**Status:** PRODUCTION REVIEW (RD-4-RELEASE)  
**Date:** 2026-10-11  
**Authority:** [`DEPTSYNC_REDESIGN_001_COMPLETE_PRODUCT_EXPERIENCE_BLUEPRINT.md`](./DEPTSYNC_REDESIGN_001_COMPLETE_PRODUCT_EXPERIENCE_BLUEPRINT.md) §D.3  
**Prerequisite:** RD-1 shell · RD-2 Map · RD-3 Operational Sections (production)  
**App:** https://deptsync-hub.vercel.app

---

## A. Existing workflow discovered

| Layer | Finding |
|-------|---------|
| Plan storage | `weekly_rotations` (staged physical bays) |
| Ownership | `sunday_bay_assignments` keyed by rotation id |
| Completion evidence | `is_completed` + `verification_status` via rotation-metrics helpers |
| Barriers | `rotation_exceptions` / exception summary → barrier rotation ids |
| Composer | `composeThisWeekOwnership` (UX-REDUCE-002) — people → physical bays |
| Surface | `FloorTab` (`/dashboard`) + `ThisWeekOwnershipBoard` |
| Capacity engine | `resolveAutomaticWeeklyBayTarget(eligible) = eligible × 3` (`BASE_WEEKLY_BAY_QUOTA`) |
| Sections | RD-3 overlay; not weekly labor |
| Map | Aisle-first geography; attention investigate query already existed |

**Supported states mapped (no new workflow invented):** planned (staged), assigned (Sunday owner), reported / awaiting verification, verified, barrier.

---

## B. Files changed

| Path | Change |
|------|--------|
| `lib/store-ops/this-week-ownership.ts` | Command summary; assignment vs evidence labels; section attach; roster placeholders; shared capacity constants |
| `lib/store-ops/map-bay-focus.ts` | **New** This Week → Map aisle/bay focus href |
| `components/store-ops/ThisWeekCommandSummary.tsx` | **New** weekly command summary card |
| `components/store-ops/ThisWeekOwnershipBoard.tsx` | Team board polish; section + Map link; evidence labels |
| `components/hub/tabs/FloorTab.tsx` | Mount summary; load sections; include unassigned roster |
| `components/hub/tabs/MapTab.tsx` | Resolve bay-focus query → grid |
| `components/admin/StoreLocationGrid.tsx` | Apply focus aisle/bay once |
| `lib/store-ops/rd4.this-week-command.test.ts` | **New** unit coverage |
| `lib/rd4.this-week-command.contract.test.ts` | **New** contracts |
| `lib/store-ops/ux-reduce-002.this-week-ownership.test.ts` | Progress-line wording |
| Docs | Journal / handoff / roadmap / this report |

---

## C. Weekly summary behavior

`composeThisWeekCommandSummary` answers:

1. **Planned** — staged physical bay count  
2. **Assigned** — bays with Sunday owners (not completion)  
3. **Verified** — operator-accepted evidence; reported-but-unverified called out separately  
4. **Remaining** — open / barrier coverage still owed  

UI note: *“Assignment names responsibility… a scheduled bay is not proof that work occurred.”*

---

## D. Team presentation

- People-first expandable board retained.  
- Supervisor board may include active associate roster members with **zero** bays (coordination placeholders).  
- Supervisors / MasterAdmin not auto-inserted as empty rows.  
- No rankings, scores, or productivity comparisons.  
- Per-person: assigned count, verified count, attention (verify / barrier).

---

## E. Assignment detail experience

Each bay card shows:

- Aisle/bay label  
- Assignment responsibility  
- Completion evidence state  
- Operational Section name (or Unsectioned) + optional section steward (distinct from weekly assignee)  
- Map deep link  
- Existing Actions: Facing check / Barrier / Downstock (+1 on owner when eligible)

---

## F. Operational Sections integration

Floor loads `fetchOperationalSections` non-blocking (same cache-friendly pattern as Map). Lookups attach via `physicalBayKey`. Missing/failed section fetch → empty map; board still works.

---

## G. Map navigation

`buildMapBayFocusHref({ aisle, bay, departmentId })` → `/admin/store-map?aisle=&bay=&deptId=`.  
MapTab resolves intent; StoreLocationGrid selects aisle and opens bay sheet when present.

---

## H. Existing actions preserved

| Action | Path |
|--------|------|
| Complete / barrier / downstock | `ThisWeekOwnershipBoard` existing clients |
| +1 extra bay | unchanged suggest/dispatch |
| Verify / send-back | `SupervisorAuditSummaryModal` |
| Stage / Assign recovery | `SundayAuditStagingCard` / drawer |
| Floor Pad / showroom | secondary tools unchanged |

No new mutation endpoints.

---

## I. Capacity model verification

| Claim | Reality |
|-------|---------|
| Blueprint 4 × 3 = 12 shared | Cited in UI as shared team capacity |
| Engine volume | **`eligibleAssociateCount × 3`** — not a hard-coded 12 |
| Dual-department double count | **Not present today** — Flooring/Home Decor still merged as one `flooring` dept |
| `weekly_bay_target` | Legacy/admin override only; Floor does not drive it |

**Discrepancy reported, not rewritten:** when fewer/more than four eligible associates are on for Sunday dispatch, staged volume is 9/15/… not always 12. RD-4 presentation cites the shared 12-bay model without changing Sunday selection.

---

## J. Performance considerations

- Sections fetch is parallel/non-blocking beside locations; does not gate ownership paint.  
- Summary + ownership derive from one `composeThisWeekOwnership` memo.  
- No new dependencies.  
- Map focus applies once per intent key (no loop).

---

## K. Test results

| Check | Result |
|-------|--------|
| `npm run typecheck` | Pass |
| RD-4 / ownership tests | Pass |
| `npm test` | **1407 passed** (107 files) |
| `npm run build` | Pass |
| Lint debt | No new lint introduced by design; pre-existing hub noise unchanged |

---

## L. Known limitations

- Team “four people” placeholders require roster rows loaded; empty roster → owners-from-assignments only.  
- Section steward may be null (owner optional in RD-3).  
- Map focus no-ops if aisle not in active geography.  
- Shared capacity UI is declarative citation — not a live eligible-count readout from Sunday cron.  
- Working-department pin still scopes This Week when set (transitional).

---

## M. Phone review instructions (local)

1. Open **This Week** (`/dashboard`) as Supervisor.  
2. Confirm weekly command card: Planned / Assigned / Verified / Remaining + evidence note.  
3. Expand a teammate → bay shows assignment vs evidence, section line, **Map** link.  
4. Tap Map → lands on aisle (and bay sheet when present).  
5. Confirm Facing check / Barrier / Review verify / +1 still work.  
6. Confirm Overview / Map / More unchanged; no Sunday force without recovery intent.

**STOP — wait for release authorization. Do not begin RD-5.**
