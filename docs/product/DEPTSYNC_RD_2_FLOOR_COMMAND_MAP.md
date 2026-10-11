# DEPTSYNC-RD-2 — Floor Command Map Implementation Report

**Status:** COMPLETE (local implementation)  
**Date:** 2026-10-10  
**Authority:** [`DEPTSYNC_REDESIGN_001_COMPLETE_PRODUCT_EXPERIENCE_BLUEPRINT.md`](./DEPTSYNC_REDESIGN_001_COMPLETE_PRODUCT_EXPERIENCE_BLUEPRINT.md) §D.2  
**Prerequisite:** RD-1 Floor Command shell (operator phone-approved)  
**Not authorized:** deploy, commit, push, schema, auth change, production SQL, engine rewrite, Operational Sections storage, Sunday rotation/bootstrap

---

## A. Files changed

| Path | Change |
|------|--------|
| `lib/store-ops/map-aisle-navigation.ts` | **New** — aisle-index composition, active/retired filtering, collision labels |
| `lib/store-ops/map-aisle-navigation.test.ts` | **New** — unit tests for aisle → bay helpers |
| `lib/rd2.floor-command-map.contract.test.ts` | **New** — RD-2 Map / Bulk / sheet contracts |
| `components/admin/StoreLocationGrid.tsx` | Aisle index → aisle detail → bay list → Walk sheet (no dept accordion) |
| `components/hub/tabs/MapTab.tsx` | Floor Command chrome; load **all** locations/week rows; title “Map” |
| `components/admin/WalkTheFloorSheet.tsx` | Reserved Operational Section slot (no storage) |
| `components/admin/BulkLocationGenerator.tsx` | Clean-Up default = soft-retire (`is_active=false`); hard delete advanced |
| `lib/store-ops/ux-reduce-003.map-coverage.contract.test.ts` | Map title / physical-bay language updates |
| `lib/store-ops/ux-reduce-004.roster-people.contract.test.ts` | Map aisle-navigator expectations |
| `lib/store-ops/bulk-setup-002.physical-bay-first.test.ts` | Soft-retire Clean-Up contract |
| `DEVELOPMENT_JOURNAL.md` / `CHAT_HANDOFF.md` / `MASTER_ROADMAP.md` / `DEPT_SYNC_STATE.md` | Session pointers |

---

## B. New Map interaction model

```text
AISLE INDEX  →  AISLE DETAIL (bay list)  →  BAY DETAIL (WalkTheFloorSheet)
```

- Navigation is **aisle-first**. Departments are integrity keys only; no department accordion.
- Aisle entries group by `(department_id, aisle)`. Same aisle code in two departments gets a collision label (`Aisle 12 · Flooring`).
- No invented adjacency or store layout — only data present in `store_locations`.
- Topology mutation remains Settings → Store Topology (`canMutate={false}` on Map).

---

## C. Mobile experience

- Two-column aisle tiles (`min-h-[5.5rem]`), 48px+ back/search/toggle targets.
- Sticky aisle header with predictable **Back to aisles**.
- Search field for fast alphanumeric aisle jump (`BW`, `12`, …).
- No horizontal overflow; single-column bay list inside an aisle.
- Light transitions (`active:scale-[0.99]`); no heavy animation.
- Desktop: same navigator, wider aisle grid (`sm:3` / `lg:4` columns).

---

## D. Aisle and bay presentation

| Element | Behavior |
|---------|----------|
| Aisle tile | Code, bay count, coverage progress, readiness glyph, mini cadence strip, High chip when applicable |
| Show retired | Off by default (active surfaces only); on includes paused/inactive bays |
| Bay row | Tag, readiness label, Sell/Top presence, High / seasonal / attention markers |
| Retired bay | Muted + “Retired” chip when shown |

---

## E. Bay detail behavior

Existing `WalkTheFloorSheet` preserved:

- Aisle/bay identity, Selling/Topstock faces  
- Seasonal context, attention evidence, High/Standard priority  
- Walk intensity logging  

**Added:** dashed **Operational section** slot (`walk-sheet-section-slot`) — placeholder only so later section/ownership/walkthrough links can land without redesigning the sheet.

---

## F. Bulk Generator changes

| Mode | Behavior |
|------|----------|
| Manual / CSV | Unchanged — alphanumeric aisles, bay ranges, BOTH surfaces, upsert-safe |
| Clean-Up **Retire (pause)** | **Default** — patches `is_active=false` per matching surface |
| Clean-Up **Permanently delete** | Advanced — existing hard delete + week rotation removal |

No production topology executed during development.

---

## G. Existing functionality preserved

- Location UUIDs, rotation relationships, history  
- Auth / authorization boundaries  
- Map attention investigation + “Show all”  
- Advanced Service cadence (heatmap) disclosure  
- Aisle / bay High priority mutation without topology `canMutate`  
- Route `/admin/store-map`  
- Sunday engine, weekly capacity, department migrations — **untouched**

**Presentation change (reported, not silent removal):** department accordion navigation replaced by aisle index. Department identity remains on collision labels and bay sheet chrome.

---

## H. Performance considerations

- Map loads all locations once (aisle geography); attention may still scope to working department when pinned.  
- Aisle index composed in `useMemo`; only selected-aisle bays mount detail list.  
- Bay list chunked (`BAY_CHUNK=36`) with “Show more”.  
- No new npm dependencies.  
- Cadence classification remains per-location memoized map.

---

## I. Test results

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | Pass |
| Relevant map/bulk/RD-2 tests | Pass |
| `npm test -- --run` | **1374 passed** (102 files) |
| `npm run build` | Pass |
| Lint | Pre-existing hub/settings `react-hooks/set-state-in-effect` noise unchanged; no new lint rule introduced by design |

---

## J. Known limitations

- Attention still needs a working department pin when Master scope is “all” (existing SI behavior).  
- Soft-retire Clean-Up patches surfaces sequentially (no new bulk-retire API).  
- AisleBayManager batch hard-delete in Settings unchanged (still available; Map Clean-Up prefers retire).  
- No aisle adjacency / floorplan geometry (not in DB).  
- Associate Bay locator path retained.

---

## K. Items deferred to Operational Sections

- Section membership chips on Map / bay sheet (slot reserved)  
- Permanent owner display  
- Walkthrough place binding from bay detail  
- Multi-select bay → create section  
- Engine section preference  

---

## L. Operator review instructions

**Local only until authorize commit/deploy.**

1. Open `/admin/store-map` on phone.  
2. Confirm aisle tiles (not department accordion).  
3. Tap an aisle → bay list → back.  
4. Tap a bay → sheet shows identity, Sell/Top, priority, section placeholder.  
5. Toggle **Show retired**; search an aisle code.  
6. Settings → Bulk Generator → Clean-Up: confirm **Retire (pause)** is default; do **not** permanently delete production rows in review.  
7. Confirm This Week / Overview / Walkthroughs still behave as RD-1.

**STOP — wait for operator authorization before commit / push / deploy. Do not begin RD-3.**
