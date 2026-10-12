# DEPTSYNC-MAP-001 — Map Vision and Product Roadmap Reconciliation

**Status:** COMPLETE (read-only discovery)  
**Date:** 2026-10-12  
**Mode:** Focused discovery — no implementation, migrations, production mutations, or deployment  
**Production baseline:** https://deptsync-hub.vercel.app · Supabase `fmeinlwhixngednabhgy`  
**Authority:** [`DEPTSYNC_REDESIGN_001_COMPLETE_PRODUCT_EXPERIENCE_BLUEPRINT.md`](./DEPTSYNC_REDESIGN_001_COMPLETE_PRODUCT_EXPERIENCE_BLUEPRINT.md) §D.2 · Constitution · ALIGN-002 · post–RD-1…RD-5 production path · RD-6 audit · WALK / ZEBRA / SECTION / TOPOLOGY reports

**Not authorized:** Map redesign, schema change, topology mutation, auto-stage enablement, commit/push/deploy.

---

## 1. Executive summary

The **canonical Floor Command Map vision is largely implemented** as an aisle→bay physical geography navigator with week readiness overlays, Operational Section context on the bay sheet, walkthrough place history, and place-bound Record Observation (WALK-002…006). It is **not** a floorplan CAD surface, **not** a department switcher, and **not** a weekly assignment board (This Week owns that).

What remains for Map is **not a rebuild**. Remaining Map work is a short list of **relationship affordances and walking ergonomics** on top of the existing navigator:

1. Richer bay-sheet **location history** (rotations / verifies / barriers) — blueprint §D.2 still only partly present (walkthrough history is real; full history is not).  
2. Optional **follow-up / open-work cues** at place level without merging Walkthroughs into Map.  
3. **Named zone topology** (carpet wall, showrooms, etc.) as operator-documented aisle codes — substrate exists; geography incomplete.  
4. Restore or relocate **Pin to this week** (code exists; Map forces `canMutate={false}`).  
5. Dual-department / Home Decor cutover remains **operator-blocked** (ALIGN-TOPO / ALIGN-DEPT); Map already supports dual-dept collision labels when two depts exist.

Broader Floor Command destination gaps (auth simplify, specialty disposition, SEC-OPS-010 plaintext disable, CI, phone acceptances) are **outside Map** but must not be forgotten.

**Verdict: CONDITIONAL GO** for a focused Map affordance tranche after phone acceptance of WALK-006 / pending Map phone items — **NO-GO** for Map architecture rewrite, floorplan geometry, or merging Walkthroughs / Zebra / Sections into one workflow.

---

## 2. Original Map vision

From Redesign-001 §D.2 and RD-2 authority:

| Intent | Source |
|--------|--------|
| Answer: “Where is the department, and what is the state of each place?” | Blueprint §D.2 |
| Navigate **aisles → physical bays**, not department accordions | Blueprint §D.2; RD-2 |
| Internal `department_id` for integrity only (Flooring / Home Decor) | Blueprint; TOPO-001 |
| Bay sheet: identity, section chip/link, history (rotations, verifies, barriers, walkthroughs), actions | Blueprint §D.2 |
| Sections overlay geography; not a sixth tab; create from Map multi-select **or** More | Blueprint §D.2 / §E |
| Active locations default; Show retired disclosure | Blueprint; RD-2 |
| Soft-retire preferred over hard delete | Blueprint; TOPO-001 |
| Topology mutation primarily More / Bulk (Map may deep-link setup) | Blueprint; UX-REDUCE-003 |
| Cross-links: Map bay ↔ This Week person; Map bay ↔ Section; Walkthrough place ↔ Map | Blueprint §C |

**Explicit non-goals (do not invent):** floorplan adjacency geometry; Map as scoring surface; Map as Zebra task board; inventing undocumented aisles/bays.

---

## 3. Current Map architecture

```text
/admin/store-map  (page shell → null)
        └── WorkflowTabShell keep-alive
              └── MapTab.tsx
                    ├── loads: departments, store_locations, store_aisles,
                    │         this-week rotations, barriers, seasonal,
                    │         attention (dept-scoped), operational sections
                    └── StoreLocationGrid.tsx
                          AISLE INDEX → AISLE DETAIL → bay list
                                └── WalkTheFloorSheet.tsx
                                      identity · readiness · attention
                                      · section slot · walkthrough history
                                      · Record Observation (Supervisor+)
                                      · High priority · walk intensity
```

| Layer | Path | Role |
|-------|------|------|
| Route | `app/(workflow)/admin/store-map/page.tsx` | Keep-alive shell stub |
| Tab | `components/hub/tabs/MapTab.tsx` | Data load + chrome |
| Navigator | `components/admin/StoreLocationGrid.tsx` | Aisle index / detail / bay list |
| Composition | `lib/store-ops/map-aisle-navigation.ts` | Index, collision labels, registry merge |
| Readiness | `lib/store-ops/map-readiness.ts` | Covered / This week / attention / remaining |
| Focus deep-link | `lib/store-ops/map-bay-focus.ts` | This Week → Map aisle/bay |
| Bay sheet | `components/admin/WalkTheFloorSheet.tsx` | Place context + actions |
| Capture | `components/walkthroughs/WalkthroughCaptureSheet.tsx` | Place-locked observation |
| Contracts | `lib/rd2.floor-command-map.contract.test.ts`, RD-3/RD-5 map contracts, topology-registry tests | |

Canonical implementation report: [`DEPTSYNC_RD_2_FLOOR_COMMAND_MAP.md`](./DEPTSYNC_RD_2_FLOOR_COMMAND_MAP.md) (COMPLETE). Later wiring: RD-3 sections, RD-5/WALK walkthroughs, TOPOLOGY-REGISTRY `store_aisles`.

---

## 4. Feature completion matrix

| Capability | Classification | Evidence |
|------------|----------------|----------|
| Aisle-first navigator (index → detail → bay) | **COMPLETE** | `StoreLocationGrid.tsx`; RD-2 |
| Dual-dept collision labels | **COMPLETE** | `formatMapAisleLabel` / `map-aisle-navigation.ts` |
| Active-only default + Show retired | **COMPLETE** | RD-2; Map UI |
| Aisle search / fast jump | **COMPLETE** | `map-aisle-search` |
| Bay list chunking (36 + Show more) | **COMPLETE** | `BAY_CHUNK` |
| Week readiness glyphs (This week / Covered / attention) | **COMPLETE** | `map-readiness.ts`; legend |
| Barrier overlay | **COMPLETE** | `barrierLocationIds` → attention |
| High / Standard priority from Map | **COMPLETE** | `canMutateRotationPriority`; PRIORITY-UX-002 |
| Seasonal badges | **COMPLETE** | MapTab seasonal load |
| Attention investigation strip | **COMPLETE** | `map-attention-investigation.ts` |
| `store_locations` geography | **COMPLETE** | `fetchStoreLocationsDetailed` |
| `store_aisles` registry merge / empty zones | **COMPLETE** | TOPOLOGY-REGISTRY-003/004 |
| Topology mutation on Map | **MISSING on Map (by design)** | `canMutate={false}`; Settings owns Bulk/Edit |
| Add bay from empty registry aisle | **COMPLETE** | `AddBaySheet` when `canManageMapConsole` |
| Operational Section on bay sheet | **COMPLETE** | `walk-sheet-section-slot`; RD-3 |
| Section chips on aisle tiles / bay rows | **MISSING (deliberate)** | RD-3 contract forbids aisle-tile clutter |
| Map multi-select → create section | **MISSING on Map** | Multi-select lives in `OperationalSectionsPanel` (More) |
| Walkthrough place history | **COMPLETE** | `walk-sheet-walkthrough-history`; RD-5 |
| Record Observation from Map | **COMPLETE** | WALK-002…004; `walk-sheet-record-observation` |
| Open follow-up cues on Map tiles | **MISSING** | No Map follow-up overlay; Overview/Walkthroughs own inbox |
| Full location history (rotations / verifies / barriers list) | **PARTIAL** | Readiness tones + attention; no unified history list on sheet |
| Pin to this week from Map | **PLACEHOLDER / gated** | UI exists; Map passes `canMutate={false}` |
| This Week → Map bay focus | **COMPLETE** | `buildMapBayFocusHref` on ownership board |
| Map → This Week person card | **PARTIAL** | No direct person deep-link from bay sheet |
| Map → Section details | **COMPLETE** | Link to Settings `#operational-sections` |
| Zebra handoff on Map | **MISSING (correct)** | Zebra on This Week / assignment domain; independent |
| Floorplan / adjacency geometry | **MISSING (deferred)** | Not in DB; RD-2 known limitation |
| Specialty (SIMS / remnants / appliances) on Map | **MISSING (REDUCE-004)** | Everyday disconnected; dormant runtime |
| Snap Bay / Visual Bay Scan on Map | **MISSING (disconnected)** | REDUCE-004 comments in MapTab / sheet |
| Engine section preference (draw) | **PARTIAL (engine)** | SECTION-ROTATION / OPERATIONAL-011 shipped; auto-stage **OFF** — not a Map UI gap |
| Associate Bay locator mode | **COMPLETE** | Simplified title path retained |

---

## 5. Physical topology findings

### 5.1 What Map represents today

| Concept | Representation | Notes |
|---------|----------------|-------|
| Flooring / Home Decor | One active merged dept `flooring` (“Flooring / Home Decor”) in production | ALIGN-TOPO-001; separate Home Decor **UNRESOLVED** |
| Aisles / zones | `store_locations.aisle` TEXT + `store_aisles` registry | Alphanumeric (`5`, `39`, `BW`, …) |
| Physical bays | `(department_id, aisle, bay)` + SELLING/TOPSTOCK faces | Physical-bay-first coverage |
| Named locations | Same aisle TEXT codes | TOPOLOGY-AREAS-001: prefer `CARPET-WALL`, `SHOW-L`, not fake numbers |
| Carpet wall / showrooms / clothing | **Representable, not fully documented** | Operator still documenting; do not invent |
| Sheet vinyl | No first-class Floor Command surface | RD-6 specialty findings |
| Appliances / SIMS | Specialty runtime dormant; not Map geography | REDUCE-004 |
| Remnants / catalog | Disconnected everyday | REDUCE-002 |

### 5.2 Physical vs rotatable

| Layer | Rotates weekly? | Evidence |
|-------|-----------------|----------|
| Active `STANDARD` physical bays | Eligible for Sunday draw | `location-eligibility.ts`, physical-bay engine |
| `SHOWROOM_STACKOUT` | **Excluded** from weekly aisle draw | RD-6 / TOPOLOGY-AREAS-001 |
| Soft-retired (`is_active=false`) | Not eligible; optional Map show | Soft-retire primary |
| Registry-only aisle (zero bays) | Geography placeholder; not a rotation unit until bays exist | TOPOLOGY-REGISTRY |
| Specialty inventory areas | Not Map rotation units | REDUCE boundary |

**Law preserved:** Do not assume every named location participates in weekly rotation. Document zones before inventing them.

Production store 2587 (prior read-only inspections): active Operational Sections **4** with **160** member bays; stewardship aisles Tyson 5·6 / Nate 7·39·40 / Nick 43·44 / Tracy 41·42 — Map can show these places; it does not own membership.

---

## 6. Operational integration findings

| Domain | Map relationship today | Gap |
|--------|------------------------|-----|
| **Operational Sections** | Bay sheet shows section name + owner; link to More | No aisle-tile chips (intentional); no Map multi-select create |
| **Weekly rotation** | Readiness tones from this-week rotations; High priority | Pin-to-week gated off; no assignee name on bay row |
| **Assignment completion** | Covered glyph when verified | No complete action on Map (correct — This Week owns) |
| **Supervisor verification** | Covered / attention tones | Verify UI remains This Week |
| **Zebra handoff** | Not on Map | Correct independence; This Week owns zebra entry |
| **Walkthrough observations** | History + Record Observation | Open follow-ups not surfaced as Map cues |
| **Follow-up history** | Via Walkthroughs / Overview | Map does not list open follow-ups for a bay |

**Do not merge:** Sections establish continuous ownership; rotation structures weekly work; Walkthroughs record conditions; Zebra remains independent; Sunday auto-stage remains **OFF** (`STRICT_SECTION_OWNERSHIP_AUTO_STAGE = false`).

Cross-navigation that **works:** This Week bay → Map focus.  
Cross-navigation that is **weak:** Map bay → This Week person; Map → open follow-ups for that place.

---

## 7. Mobile usability gaps

Prioritized for walking usefulness (not aesthetic polish):

| Issue | Severity | Notes |
|-------|----------|-------|
| Two-step aisle→bay before any place action | Low–Med | Intentional RD-2 model; search mitigates |
| Long aisles require “Show more” after 36 bays | Low | Chunking prevents overload |
| Bay sheet density (attention + walkthrough + section + priority + intensity) | Med | Risk of scroll fatigue on phone |
| No open-follow-up badge at aisle/bay list | Med | Operator may miss place-bound open work while walking |
| Full rotation/verify history absent on sheet | Med | Blueprint history incomplete |
| Pin-to-week invisible on Map | Low | Rare action; Settings/This Week alternatives exist |
| Attention SI needs working-dept pin for Master “all” | Low | Existing SI constraint |
| No swipe-between-aisles gesture | Optional | Not required by blueprint |
| Incomplete named-zone geography | P1 product (topology), not Map UI | Operator documentation |

Touch targets (≥48px), sticky aisle header, keep-alive tab, IndexedDB warm cache: **already present** (RD-2 / PERF-LOAD-002).

---

## 8. Recommended Map implementation phases

Smallest coherent sequence — **no architecture rewrite**.

### MAP-002 — Bay sheet operational completeness (app only; likely no migrate)

**Required functional corrections / planned improvements**

1. Add a concise **place history** block: recent rotation / verify / barrier evidence already available via existing store-ops APIs (compose, do not invent).  
2. Surface **open walkthrough follow-ups for this place** (read from inbox/place query) with link to Walkthroughs — not a new task system.  
3. Show **this-week assignee** (if any) as read-only context + link to This Week.  
4. Decide Pin-to-week: either enable for Supervisor on Map via a dedicated flag (not full topology `canMutate`), or remove dead UI and document This Week as the pin surface.

**Acceptance:** On a phone, open a bay and see section, week owner (if any), open follow-ups (if any), recent history — without leaving Map for basic context.

### MAP-003 — Walking cues (optional presentation)

1. Subtle bay-row / aisle markers for “open follow-up at this place” and “assigned this week” without section-chip clutter on aisle tiles.  
2. Keep Overview attention as the overdue inbox; Map cues are place-local only.

### MAP-004 — Named zone geography (operator-driven; no invent)

1. Operator documents carpet wall / showroom / clothing zones as aisle codes (TOPOLOGY-AREAS-001).  
2. Bulk / Create Location / registry path already ships — Map merge shows them when documented.  
3. Eligibility: `STANDARD` if they must rotate; specialty types remain non-rotating unless product decision changes.

### Explicitly deferred / optional

| Item | Class |
|------|-------|
| Floorplan geometry / adjacency | Deferred — no DB |
| Specialty revival on Map | Deferred — SPECIALTY-DISP decision |
| Snap Bay remount | Deferred / retired path (SNAP-RETIRE) |
| Map multi-select → create section | Optional — More already has aisle-first multi-select |
| Section chips on aisle tiles | Optional — previously rejected for clutter |
| Home Decor dept cutover | ALIGN-DEPT — blocked on operator map; not Map UI |

---

## 9. Remaining Floor Command roadmap

Reconciled against Redesign-001 §L, RD-6 §L, and post–RD-6 production reality (CAPACITY-GUARD, SECTION-ROTATION, ZEBRA, OPERATIONAL, WALK, TOPOLOGY-REGISTRY).

| Area | Original intent | Current verified | Remaining gap | Priority | Dependencies | Acceptance |
|------|-----------------|------------------|---------------|----------|--------------|------------|
| **Overview** | Week / attention / people / follow-ups | Real plan + walkthrough inbox | Broader redesign deferred; review hint for opportunities OK | P3 polish | — | Land and know status without hunting |
| **Map** | Aisle→bay geography + overlays | COMPLETE core; history/cues PARTIAL | MAP-002/003; named zones | P2 | WALK phone OK | Walk department with place context |
| **This Week** | 4×3 ownership, complete/verify | Board + zebra handoff shipped | Phone acceptances; capacity UX clarity | P1 field | SECTION-ROTATION-007 phone | Four people × capacity without double count |
| **Walkthroughs** | Observe → follow-up → close | RD-5 + WALK-005/006 released | Phone acceptance; photos/offline deferred | P2 field | Real walk use | Capture + follow-up later + close |
| **More / Settings** | Team, sections, topology, capacity, device | Present; hash deep-links PARTIAL | MORE-IA-FIX-001; copy drift | P2 | — | Predictable `#` deep-links |
| **Mobile nav** | Five tabs | Shipped RD-1 | — | — | — | Overview default |
| **Offline / PWA** | Resilient floor use | Complete/assign queue; verify/walk online-only | OFFLINE-VERIFY only if pain | P2 | Field evidence | No privilege elevation on replay |
| **Operational reporting** | Attention / coverage | Map readiness + Overview | Not a dashboard rewrite | P3 | — | Evidence-backed cues only |
| **Dual-dept topology** | Flooring + Home Decor | Merged flooring; capacity guard shipped | ALIGN-DEPT + cutover | P1 | Operator §L map | Active Map = operator geography; no double×3 |
| **Auth simplify** | Operator-only login | Multi-role still live; SEC-OPS series advanced | SEC-OPS-010 + AUTH inventory | P1 | Operator login verify | Team = records |
| **Specialty** | OOS everyday | Disconnected / dormant | Disposition decision | P1 decision | Operator | Keep / revive / delete |
| **CI** | PR gates | None | CI-001 | P1 eng | — | tsc+test+build on PR |
| **Auto-stage** | Optional Sunday | **OFF** | Remains OFF until GO | — | Strict ownership | No silent Sunday stage |
| **Engine section preference** | Prefer section focus | Hybrid preference + strict ownership released; auto-stage OFF | Activation policy / phone | P1 field | Operator GO | Preference ≠ exclusion |
| **Visual polish** | Design system pass | Tokens / themes exist | RD-10 after core | P3 | — | Comfort, not novelty |

**Do not mark complete solely because a component exists.** Example: Pin-to-week UI exists but is unreachable on Map (`canMutate={false}`).

---

## 10. Dependencies and risks

| Risk | Mitigation |
|------|------------|
| Map “history” rewrite invents states | Compose from existing rotation / barrier / walkthrough reads only |
| Follow-up cues duplicate Overview attention | Place-local cues ≠ overdue attention count |
| Merging Zebra into Map | Forbidden — keep This Week |
| Enabling second dept without capacity guard | Capacity guard already shipped; still **NO-GO** dual-dept auto-stage without ALIGN-DEPT |
| Inventing carpet-wall bays | Operator documents; TOPOLOGY-AREAS-001 |
| Auto-stage ON during Map work | Keep `STRICT_SECTION_OWNERSHIP_AUTO_STAGE = false` |
| Scope creep into floorplan CAD | Explicit deferred |
| Phone acceptance debt stacking | Finish WALK-006 / Zebra / Section phone gates before large Map polish |

---

## 11. Acceptance criteria

### Map destination (practical)

Operator on phone can:

1. Open Map and jump to an aisle by code without a department switcher.  
2. Open a bay and see **physical identity**, **section + steward** (or honest unsectioned), **this-week assignment state**, and **walkthrough history**.  
3. Record a place-bound observation and return to Map without losing place context.  
4. See whether that place has an **open follow-up** without treating every observation as a task.  
5. Navigate This Week → Map focused bay and back.  
6. Never create rotation, section ownership, or Zebra state as a side effect of Map browsing.

### Broader Floor Command (from Redesign-001 §M — status)

| # | Criterion | Status |
|---|-----------|--------|
| 1 | Overview week/attention/people | **Met** (polish OK later) |
| 2 | Map aisle→bay + topology rebuild | **Mostly met** (history/cues gap) |
| 3 | This Week 4×3 without double-count | **Partially met** (capacity guard yes; dual-dept geography unresolved) |
| 4 | Sections with permanent owners | **Met** (joint stewardship deferred) |
| 5 | Walkthrough capture → close | **Met** (phone acceptance pending) |
| 6 | More without Master archaeology | **Mostly met** (deep-link polish) |
| 7 | Operator-only auth | **Not met** |
| 8 | Deterministic evidence | **Met** |
| 9 | One-handed phone | **Mostly met** |
| 10 | History + fail-closed security | **Partially met** (SEC-OPS-010 pending) |

---

## 12. Operator decisions genuinely required

1. **Is Map bay-sheet history (rotations/verifies/barriers) worth a tranche now**, or is readiness tone + Walkthroughs enough for walking?  
2. **Should open follow-ups appear as Map place cues**, or stay Overview/Walkthroughs-only?  
3. **Pin to this week on Map:** restore for Supervisor, or delete dead control?  
4. **Named zones** (carpet wall, showrooms): approve codes and document bays before Map “area” work.  
5. **ALIGN-DEPT / Home Decor cutover:** still blocked on aisle/bay ownership map (TOPO-001 §L).  
6. **SEC-OPS-010** plaintext fallback disable — operator login verification.  
7. **Specialty disposition** before any Map specialty surface.  
8. **Phone acceptances** still pending: WALK-006, Zebra handoff, Section ownership / capacity, Topology registry.  
9. **CI-001** authorize GitHub Actions.  
10. **Sunday auto-stage** remains OFF until explicit GO (not a Map decision).

---

## 13. GO / CONDITIONAL GO / NO-GO

| Path | Verdict |
|------|---------|
| Preserve current Map architecture | **GO** |
| MAP-002 bay-sheet completeness (history + place follow-ups + week owner context) | **CONDITIONAL GO** after operator priority vs other phone acceptances |
| MAP-003 walking cues | **CONDITIONAL GO** after MAP-002 |
| Named zone documentation via existing bulk/registry | **CONDITIONAL GO** — operator-driven |
| Map rebuild / floorplan geometry | **NO-GO** |
| Merge Walkthroughs / Zebra / Sections into Map workflow | **NO-GO** |
| Enable Sunday auto-stage as part of Map work | **NO-GO** |
| Invent undocumented topology | **NO-GO** |
| Dual-dept Home Decor cutover as Map-only UI | **NO-GO** — needs ALIGN-DEPT |

**Overall: CONDITIONAL GO** — Map vision is substantially delivered; remaining work is focused place-context and topology documentation, not a new Map product.

**STOP. Do not implement changes in this tranche.**
