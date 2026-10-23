# DEPTSYNC-MAP-WALK-CUES-001 — Weekly Assignment and Follow-Up Cues in Map

**Status:** RELEASED — see [`DEPTSYNC_MAP_WALK_CUES_001_RELEASE.md`](./DEPTSYNC_MAP_WALK_CUES_001_RELEASE.md) (`0d45489`)  
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
| A non-superseded rotation whose `assigned_week` equals the operational week, with a Sunday row for that rotation id in this store and `week_starting`, and either a non-empty specialist id or a non-empty stored associate name | **Assigned**. Accessible name adds “Assigned this week”. |
| Name-only legacy row (`specialist_name` set, no roster or profile id, status not cleared) | **Assigned**. Same display rule as the bay sheet (`assigneeName` counts). No id is invented. |
| Rotation in another week, status `cleared`, blank id and blank name, missing aisle or bay, or a failed assignment read | No Assigned chip. That does not say the bay is unavailable. |
| At least one open follow-up whose observation is this department, aisle, and bay | **Follow-up**. Accessible name adds “Open follow-up”. Several open rows on one bay stay one chip. |
| Closed follow-up, or an observation with no follow-up row | No Follow-up chip. A note is not an open task. |
| Failed follow-up read | No Follow-up chip. A successful assignment cue can still show. |

The bay sheet is the Map display contract: `composeMapBayWeekContext` marks the week assigned when a stored name or a specialist id is present. `mapRow`, which This Week uses, still requires a specialist id and drops a name-only row. The Map cue keeps that name. This Week is unchanged, so a name-only legacy row can show **Assigned** on the Map and stay off This Week’s assignment card. Current writers clear the name when they clear the row or when they have no specialist id, so new writes do not create name-only rows.

A cleared row is not an assignment, even if a name is still stored. The sheet loader does not read `status`, so a cleared row that still has a name could say assigned on the sheet. The cue follows the status. Live clears blank the name before that can happen.

Selling and topstock share one physical key (`department`, deduped aisle, bay). Numeric aisle `01` and `1` are the same key. A department’s assignment does not mark another department’s bay.

Readiness tones stay as they were. “This week” on the row still means the location is on the rotation overlay. It does not mean a Sunday assignee exists, and it does not mean the work is done.

---

## 3. UI

`StoreLocationGrid` bay rows (`data-testid="map-bay-row"`) render `map-cue-assigned` and `map-cue-follow-up` beside the existing High, seasonal, and attention chips. The row button still calls `onOpenWalk`, which opens `WalkTheFloorSheet`. Aisle tiles do not gain section chips. Map does not create or close follow-ups.

When an assignment read or a follow-up read fails, one line sits above the aisle index and stays visible inside an aisle (`data-testid="map-cue-availability"`). It names only the read that failed. It is not repeated on each bay. A read that is still pending, or that returned an empty set, stays silent. Navigation is not blocked. The cue that did load still renders.

---

## 4. Performance

Map reload still uses one `Promise.all`. After the week payload returns, it issues one Sunday assignment query for the store and `week_starting` (no department filter, no per-bay request). Open places are one follow-up query (`observation_id`, `status` only) and then observation place columns (`id`, `department_id`, `aisle`, `bay`) in chunks of 100 ids. Observation bodies are not selected. The sheet’s per-place `GET /api/store-locations/bay-context` is not called while painting the aisle.

A failed assignment or follow-up read is caught on its own. The failed cue is withheld. The other cue still paints. The map-level line says which information could not be loaded, so a missing chip is not presented as confirmed absence.

Cues refresh when locations, sections, walkthroughs, or Sunday assignments change, through the existing reload. Those listeners do not write.

---

## 5. Tests

| Suite | Result |
|-------|--------|
| `map-walk-cues.test.ts` | **16 PASS** |
| `map-bay-context.test.ts` | **5 PASS** |
| `rd2.floor-command-map.contract` | **7 PASS** |
| `rd5.walkthroughs.contract` | **11 PASS** |
| `walkthroughs.test.ts` | **13 PASS** |
| `walkthroughs.authz.test.ts` | **10 PASS** |
| This Week ownership and command (`ux-reduce-002`, `rd4` unit and contract) | **28 PASS** |
| `sec-ops-010.authz` + `operational-sections.authz` | **31 PASS** |
| **Total** | **121 PASS** (12 files) |
| TypeScript `tsc --noEmit` | **PASS** |
| ESLint on cue module, MapTab, walkthrough route, client, and the new Sunday read | **PASS** for new code |
| `npm run build` | **PASS** (Next.js 16.2.12) |

ESLint on `StoreLocationGrid.tsx` reports four findings that already exist on `origin/main` (`8d7f026`). This change does not edit those statements. They are not a release blocker.

| Finding | Location | Disposition |
|---------|----------|-------------|
| `react-hooks/refs` — `activeOverlayRef.current = activeOverlay` during render | `StoreLocationGrid.tsx` | Pre-existing. The ref lets a later click read the latest active overlay. Not introduced by the chips. Left as-is. |
| `react-hooks/set-state-in-effect` — clear a selected aisle that disappeared | same file | Pre-existing aisle navigation. Left as-is. |
| `react-hooks/set-state-in-effect` — reset the bay page when the aisle changes | same file | Pre-existing. Left as-is. |
| `react-hooks/set-state-in-effect` — apply a This Week focus once | same file | Pre-existing RD-4 focus. Left as-is. |

`sunday-audit.ts` still warns that `_storeNumber` is unused on the existing `getSundayAssignments` stub. That stub was not part of this change.

Covered cases: neither cue, current-week assignment, previous week only, open follow-up, closed follow-up, both, several opens as one chip, operational-week selection, missing or partial rows, department separation, empty specialist id, name-only legacy row, cleared row that still has a name, independent read failure, store-scoped queries, `requireStoreOpsActor` before the open-places branch, existing bay navigation, no writes in the cue path, no per-bay bay-context fan-out, cron `0 12 * * 0`, and `WEEKLY_ROTATION_AUTO_PUBLISH = true`.

Signed-in aisle navigation was not exercised in a browser. The Map route requires an operator session, and this environment has no signed-in session.

---

## 6. Authorization

`GET /api/walkthroughs` still calls `requireStoreOpsActor` before either the inbox or `view=open-places`. A missing actor throws `StoreOpsAuthError` with status 401. The store id comes from `resolveStoreByNumber(actor.storeNumber)`. Follow-up and observation queries filter `store_id`. The assignment query filters `store_number` and `week_starting`.

The chip carries no follow-up text and no observation body. Opening the bay still uses the existing sheet, including its department check, before the note is shown. Map continues to list the locations it already listed.

---

## 7. Known limitations

- A missing chip after a failed read is not “none.” The map-level line names the failed read. A successful empty read stays quiet, and the row still has no chip.
- This Week’s assignment fetch can be limited to the working department code, and `mapRow` still drops a name-only row. The Map cue loads every Sunday row for the store-week, keeps a stored name without inventing an id, then joins only rotations in the actor’s week payload. A pinned department on This Week can therefore show a narrower assignment set than the Map.
- The first cached paint of the aisle can appear before the cue reload finishes.
- Open follow-ups are presence only. The chip does not say how many are open.
- Historical walkthrough notes and closed follow-ups stay off the row.
- Four pre-existing React hook findings in `StoreLocationGrid.tsx` remain. They do not change cue correctness.

---

## 8. Release readiness

Released. Evidence is in [`DEPTSYNC_MAP_WALK_CUES_001_RELEASE.md`](./DEPTSYNC_MAP_WALK_CUES_001_RELEASE.md). App commit `0d45489`. Do not publish W44. Do not change AUTO-008 or the Sunday cron.
