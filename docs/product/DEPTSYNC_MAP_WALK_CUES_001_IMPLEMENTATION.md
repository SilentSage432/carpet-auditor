# DEPTSYNC-MAP-WALK-CUES-001 — Weekly Assignment and Follow-Up Cues in Map

**Status:** COMPLETE locally — not pushed, not deployed  
**Date:** 2026-10-23  
**Mode:** Implement → test → local validation  
**Scope:** Read-only chips on Map aisle bay rows  
**Prior:** [`DEPTSYNC_ALIGN_002_REDESIGN_RECONCILIATION.md`](./DEPTSYNC_ALIGN_002_REDESIGN_RECONCILIATION.md) · bay sheet [`map-bay-context.ts`](../../lib/store-ops/map-bay-context.ts)

No migrations. No assignment, walkthrough, topology, ownership, coverage, or publication writes. AUTO-008 latch and cron are unchanged.

---

## 1. Data sources reused

| Cue | Authoritative evidence | Read |
|-----|------------------------|------|
| Assigned this week | `sunday_bay_assignments` joined to the operational week’s active rotation. Same row the bay sheet reads by `bay_id` = `weekly_rotations.id`, and the same `mapRow` specialist id This Week already uses. | `GET /api/weekly-rotations` (`assigned_week` + rotations), then one `fetchStoreWeekSundayAssignments` for that week. |
| Open follow-up | `walkthrough_follow_ups.status = 'open'`. Place is the parent observation’s `department_id`, `aisle`, and `bay`. Same status the bay sheet uses in `composeMapBayFollowUpAttention`. | `GET /api/walkthroughs?view=open-places`. |

Not used for either cue: section ownership, temporary coverage, the aisle readiness overlay, observation text, closed follow-ups, or the truncated walkthrough inbox (`listWalkthroughInbox` caps observations at 40 and follow-ups at 60).

The operational week is `assigned_week` from the weekly-rotations response. That is the week This Week loads. The Map chrome week label (`isoWeekLabel()`) is left on the readiness overlay and is not the cue’s week.

---

## 2. Cue semantics

A bay row may show neither chip, **Assigned**, **Follow-up**, or both. There is no “Unassigned” chip and no “complete” chip.

| Evidence | Chip |
|----------|------|
| A non-superseded rotation whose `assigned_week` equals the operational week, with a Sunday row for that rotation id in this store and `week_starting`, and a non-empty specialist id | **Assigned**. Accessible name adds “Assigned this week”. |
| Rotation in another week, cleared assignment, empty specialist id, missing aisle or bay, or a failed assignment read | No Assigned chip. That does not say the bay is unavailable. |
| At least one open follow-up whose observation is this department, aisle, and bay | **Follow-up**. Accessible name adds “Open follow-up”. Several open rows on one bay stay one chip. |
| Closed follow-up, or an observation with no follow-up row | No Follow-up chip. A note is not an open task. |
| Failed follow-up read | No Follow-up chip. A successful assignment cue can still show. |

Selling and topstock share one physical key (`department`, deduped aisle, bay). Numeric aisle `01` and `1` are the same key. A department’s assignment does not mark another department’s bay.

Readiness tones stay as they were. “This week” on the row still means the location is on the rotation overlay. It does not mean a Sunday assignee exists, and it does not mean the work is done.

---

## 3. UI

`StoreLocationGrid` bay rows (`data-testid="map-bay-row"`) render `map-cue-assigned` and `map-cue-follow-up` beside the existing High, seasonal, and attention chips. The row button still calls `onOpenWalk`, which opens `WalkTheFloorSheet`. Aisle tiles do not gain section chips. Map does not create or close follow-ups.

---

## 4. Performance

Map reload still uses one `Promise.all`. After the week payload returns, it issues one Sunday assignment query for the store and `week_starting` (no department filter, no per-bay request). Open places are one follow-up query (`observation_id`, `status` only) and then observation place columns (`id`, `department_id`, `aisle`, `bay`) in chunks of 100 ids. Observation bodies are not selected. The sheet’s per-place `GET /api/store-locations/bay-context` is not called while painting the aisle.

A failed assignment or follow-up read is caught and withholds that cue. The rest of the map still paints.

Cues refresh when locations, sections, walkthroughs, or Sunday assignments change, through the existing reload. Those listeners do not write.

---

## 5. Tests

| Suite | Result |
|-------|--------|
| `map-walk-cues.test.ts` | **14 PASS** |
| `map-bay-context.test.ts` | **5 PASS** |
| `rd2.floor-command-map.contract` | **7 PASS** |
| `rd5.walkthroughs.contract` | **11 PASS** |
| `walkthroughs.test.ts` | **13 PASS** |
| `walkthroughs.authz.test.ts` | **10 PASS** |
| TypeScript `tsc --noEmit` | **PASS** |
| ESLint on cue module, MapTab, walkthrough route, client, and the new Sunday read | **PASS** (no new findings) |
| `npm run build` | **PASS** |

`StoreLocationGrid.tsx` still reports four pre-existing `react-hooks` findings (a ref write during render, and three effects that set state). This tranche did not change those effects. `sunday-audit.ts` still warns on the unused argument of the existing `getSundayAssignments` stub.

Covered cases: neither cue, current-week assignment, previous week only, open follow-up, closed follow-up, both, several opens as one chip, operational-week selection, missing or partial rows, department separation, empty specialist id, store-scoped queries, `requireStoreOpsActor` before the open-places branch, existing bay navigation, no writes in the cue path, no per-bay bay-context fan-out, cron `0 12 * * 0`, and `WEEKLY_ROTATION_AUTO_PUBLISH = true`.

Signed-in aisle navigation was not exercised in a browser. The Map route requires an operator session, and this environment has no signed-in session.

---

## 6. Authorization

`GET /api/walkthroughs` still calls `requireStoreOpsActor` before either the inbox or `view=open-places`. A missing actor throws `StoreOpsAuthError` with status 401. The store id comes from `resolveStoreByNumber(actor.storeNumber)`. Follow-up and observation queries filter `store_id`. The assignment query filters `store_number` and `week_starting`.

The chip carries no follow-up text and no observation body. Opening the bay still uses the existing sheet, including its department check, before the note is shown. Map continues to list the locations it already listed.

---

## 7. Known limitations

- A withheld cue and a bay with no evidence look the same: no chip. The row does not claim “none” in words.
- This Week’s assignment fetch can be limited to the working department code. The Map cue loads every Sunday row for the store-week, then keeps only rotations in the actor’s week payload. A pinned department on This Week can therefore show a narrower assignment set than the Map.
- The bay sheet treats a non-empty `specialist_name` as assigned. `mapRow` drops a row that has a name but no roster or profile id, so that rare row does not cue. Cleared rows do not cue.
- The first cached paint of the aisle can appear before the cue reload finishes.
- Open follow-ups are presence only. The chip does not say how many are open.
- Historical walkthrough notes and closed follow-ups stay off the row.

---

## 8. Release readiness

Local implementation and validation are complete. **Not released.** Do not push or deploy until a later release authorization. Do not publish W44. Do not change AUTO-008 or the Sunday cron.
