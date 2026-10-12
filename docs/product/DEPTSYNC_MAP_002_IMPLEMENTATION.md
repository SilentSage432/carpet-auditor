# DEPTSYNC-MAP-002 — Bay Context and Attention

**Status:** COMPLETE (local implementation)  
**Date:** 2026-10-12  
**Authority:** [`DEPTSYNC_MAP_001_ROADMAP_RECONCILIATION.md`](./DEPTSYNC_MAP_001_ROADMAP_RECONCILIATION.md) · Redesign-001 §D.2 · RD-5 / WALK-005 follow-up contracts · RD-3 sections  
**Not authorized:** production deploy, schema redesign, commit/push, MAP-003/004

Improves the existing Map bay detail sheet. Does not rebuild Map. Does not mutate ownership, rotation, or Zebra.

---

## 1. Existing components reused

| Asset | Reuse |
|-------|--------|
| `WalkTheFloorSheet` | Extended in place — aisle→bay entry unchanged |
| `listWalkthroughPlaceHistory` / place ownership resolve | Composed inside bay-context loader |
| `annotateObservationFollowUpState` / `isFollowUpNeedingAttention` / review decision helper | WALK-005 RD-5 contracts |
| `weekly_rotations` + `sunday_bay_assignments` | Read-only for week status + history |
| `resolveVerificationStatus` / rotation metric helpers | Status labels without inventing states |
| `WalkthroughCaptureSheet` place-locked | Record Observation preserved |
| Section slot + Settings deep-link | RD-3 stewardship display preserved |
| This Week route `/dashboard` | Navigation only — no Map write forms |

---

## 2. Bay context improvements

New read API: `GET /api/store-locations/bay-context?department_id&aisle&bay` (store-ops actor + department scope).

Bay sheet now shows, in order:

1. **Follow-up attention** (when present) — overdue / open / needs-decision  
2. **This week** — lifecycle label, assignee if assigned, link to This Week  
3. **Walkthrough** — section owner line + Record Observation  
4. **Operational section** — stewardship (unchanged slot)  
5. **History** — progressive disclosure (rotations · observations · completed follow-ups)

Missing data is shown as honest empty / unavailable states — never fabricated.

---

## 3. Follow-up attention behavior

| Kind | Treatment |
|------|-----------|
| Open follow-ups | Listed under Follow-up attention |
| Overdue (`due_on` past + open) | Listed first with “Overdue” |
| Completed follow-ups | Under History disclosure only |
| Opportunities with no follow-up rows | “Needs follow-up decision — not open work yet” |
| Positives / generals | Not auto-outstanding |

Does **not** duplicate Overview’s attention inbox counts. Place-local cues only. Link → `/walkthroughs` for action.

---

## 4. Rotation and walkthrough history

| Stream | Display |
|--------|---------|
| Current week rotation | Lifecycle: not in plan / planned / assigned / reported / awaiting verification / verified |
| Assignment owner | From `sunday_bay_assignments` when present |
| Prior weeks | History list with week label + verification status |
| Walkthrough observations | History list with type, date, follow-up chip |
| Completed follow-ups | Separate history subsection |

Streams stay distinct — not merged into one fake lifecycle.

Note: legacy Super Admin–only `/api/store-locations/history` is **not** used (Supervisor cannot call it). MAP-002 adds a store-scoped bay-context read instead.

---

## 5. Mobile experience

- Attention items first when present  
- Large `min-h-12` / `min-h-14` actions  
- History collapsed by default (toggle)  
- Links to This Week / Walkthroughs / Sections — no duplicated forms  
- Record Observation remains primary capture CTA  
- Max sheet height unchanged (`88dvh`)

---

## 6. Files changed

| Path | Change |
|------|--------|
| `lib/store-ops/map-bay-context.ts` | **New** — compose + `listMapBayContext` |
| `lib/store-ops/map-bay-context.test.ts` | **New** — week + follow-up composition tests |
| `app/api/store-locations/bay-context/route.ts` | **New** — Supervisor-readable GET |
| `lib/store-ops/client.ts` | `fetchMapBayContext` |
| `components/admin/WalkTheFloorSheet.tsx` | Context UI + progressive history |
| `lib/rd2.floor-command-map.contract.test.ts` | MAP-002 contracts |
| `lib/rd5.walkthroughs.contract.test.ts` | Sheet loader → `fetchMapBayContext` |
| `docs/product/DEPTSYNC_MAP_002_IMPLEMENTATION.md` | This report |
| `DEVELOPMENT_JOURNAL.md` / `CHAT_HANDOFF.md` / `MASTER_ROADMAP.md` | Session pointers |

---

## 7. Database changes

**None.**

---

## 8. Test results

```bash
npx vitest run \
  lib/store-ops/map-bay-context.test.ts \
  lib/rd2.floor-command-map.contract.test.ts \
  lib/rd5.walkthroughs.contract.test.ts \
  lib/store-ops/walkthroughs.test.ts \
  lib/store-ops/walkthroughs.place.test.ts
```

| Suite | Result |
|-------|--------|
| `map-bay-context.test.ts` | 5 passed |
| `rd2.floor-command-map.contract.test.ts` | 6 passed |
| `rd5.walkthroughs.contract.test.ts` | 11 passed |
| `walkthroughs.test.ts` | 13 passed |
| `walkthroughs.place.test.ts` | 8 passed |
| **Total** | **43 passed** |

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | Pass |
| IDE lint (touched files) | Clean |
| `npx next build` | Pass — `/api/store-locations/bay-context` present |

Covered: week lifecycle distinctions; overdue vs open vs completed follow-ups; positives not auto-outstanding; Map architecture contracts; Record Observation preserved; no Zebra/ownership mutation on Map sheet.

---

## 9. Release readiness

**CONDITIONAL GO** for a later controlled app-only deploy after operator phone review of the bay sheet.

| Item | Status |
|------|--------|
| Local implementation | Complete |
| Schema migrate | Not required |
| Production deploy | **Not done** |
| Auth / store isolation | Preserved (`requireStoreOpsActor` + dept assert) |
| Auto-stage | Unchanged OFF |

---

## 10. Remaining blockers / deferred

1. MAP-003 walking cues on aisle/bay tiles — not this tranche.  
2. MAP-004 named zone documentation — operator-driven.  
3. Pin-to-week still gated (`canMutate={false}`) — intentional deferral.  
4. Barrier rows not yet a dedicated history stream (attention SI still separate).  
5. Phone acceptance of bay-sheet context pending.

**STOP. Do not deploy. Do not begin MAP-003 or MAP-004.**
