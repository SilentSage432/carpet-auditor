# DEPTSYNC-OPS-OVERVIEW-001 — Supervisor Command Center

**Status:** COMPLETE locally — **not deployed**  
**Date:** 2026-10-14  
**Mode:** Evidence-based implementation (no production deploy / no migrations)  
**Authority:** Redesign-001 §D.1 · MAP-001 · ALIGN-DEPT-001 · WALK-005/006 · MAP-002/003/004 · RD-1 Overview  
**Production baseline preserved:** store 2587 · merged `flooring` · 4 sections / 160 memberships · auto-stage OFF

---

## 1. Existing Overview capabilities

Inspected `components/hub/tabs/OverviewTab.tsx` (RD-1) before this tranche:

| Surface | Classification |
|---------|----------------|
| Sticky week strip + ISO week chrome | **ALREADY IMPLEMENTED** |
| Progress line from `composeThisWeekOwnership` | **ALREADY IMPLEMENTED** |
| Needs attention: no plan / unowned / verify / barriers | **ALREADY IMPLEMENTED** |
| Aggregate overdue follow-up attention count → `/walkthroughs` | **ALREADY IMPLEMENTED** |
| People this week (name + verified/total) | **ALREADY IMPLEMENTED** |
| Open follow-up count + 3 text rows | **ALREADY IMPLEMENTED** (weak links) |
| Review-opportunity hint (not open work) | **ALREADY IMPLEMENTED** |
| Primary actions: This Week / Map / Walkthroughs | **ALREADY IMPLEMENTED** |
| Event reload on locations / walkthroughs change | **ALREADY IMPLEMENTED** |
| Quiet “Week on track” empty attention | **ALREADY IMPLEMENTED** |
| Per-item Map / observation deep-links | **NEEDS CONNECTION** → implemented |
| Section owner on location-bound attention | **NEEDS CONNECTION** → implemented |
| Next-week MAP-003 priorities on Overview | **NEEDS CONNECTION** → implemented |
| Follow-up load failure vs honest empty | **NEEDS UX IMPROVEMENT** → implemented |
| People stewardship section label | **NEEDS CONNECTION** → implemented |
| Capacity approval strip / staging CTA UI | **NOT WARRANTED** this tranche (This Week owns) |
| Invented urgency scores / KPI mosaic | **NOT WARRANTED** |
| Rebuild Overview IA / nav | **NOT WARRANTED** |

---

## 2. Confirmed operational gaps (pre-change)

1. Follow-ups were count/text only — no observation or Map navigation.  
2. Overdue items did not show section ownership context.  
3. MAP-003 next-week priorities were invisible on Overview.  
4. Walkthrough inbox failure collapsed to “No open follow-ups” (misleading zero).  
5. People strip lacked stewardship section hint even when membership evidence existed.  
6. Review opportunities were hint-only without actionable observation links.

---

## 3. Implemented changes

| Path | Change |
|------|--------|
| `lib/store-ops/overview-command.ts` | Pure composers: attention, open follow-ups, review rows, priorities, people, owner labels, deep-links |
| `lib/store-ops/ops-overview-001.command.test.ts` | Focused regressions |
| `components/hub/tabs/OverviewTab.tsx` | Command-center wiring; priorities; actionable follow-ups; honest failure states |
| `lib/store-ops/walkthroughs.ts` | Enrich follow-up views with place keys (`department_id`, `aisle`, `bay`, `section_id`) from linked observation |
| `components/hub/tabs/WalkthroughsTab.tsx` | Honor `?observation=` deep-link after inbox load |

### Explicit non-changes

- No schema / migrations / production SQL  
- No section membership or ownership writes  
- No rotation / capacity / Zebra / auto-stage changes  
- No urgency scoring  
- Review opportunities still **not** counted as open/overdue work  
- Completed follow-ups remain out of outstanding lists (`composeWalkthroughInbox` semantics preserved)

---

## 4. Authoritative data sources

| Evidence | Source |
|----------|--------|
| Week plan / assignment / verify / barriers | `fetchThisWeekRotations` + `fetchSundayAssignments` → `composeThisWeekOwnership` |
| Open / overdue / review follow-ups | `fetchWalkthroughInbox` → `composeWalkthroughInbox` |
| Section stewardship | `fetchOperationalSections({ includeMembers: true })` → `indexBaySectionLookups` + section owner names |
| Next-week priorities | `fetchWeekBayPriorities({ week_label: next ISO week })` (MAP-003) |
| Map place navigation | `buildMapBayFocusHref` (existing) |
| Walkthrough detail | `/walkthroughs?observation=<id>` |

---

## 5. Attention-state semantics

| Signal | When shown | Not treated as |
|--------|------------|----------------|
| Week no plan / unowned / verify / barrier | From This Week plan flags | Completion of Zebra tasks |
| Follow-up overdue | `status=open` **and** `due_on < today` | Observation without follow-up |
| Open follow-ups (sidebar) | Open rows only | Done follow-ups |
| Review opportunities | Opportunity with **zero** follow-up rows | Open work / overdue |
| Next-week priorities | Active MAP-003 rows for next ISO week | Approved assignment / guaranteed draw |

Law preserved: observation without follow-up ≠ overdue task; completed follow-up ≠ outstanding.

---

## 6. Ownership resolution

- Location-bound Overview rows show section + owner from **Operational Section** metadata (`section_id` / section list).  
- Does **not** infer ownership from Sunday rotation assignees.  
- Missing owner → “No section owner” when section id known without steward.  
- Ambiguous ownership language available in composer (`Section ownership unclear`) when callers pass the flag.  
- People strip shows dominant section name among that person’s owned bays when `baySectionByKey` evidence exists.

Four sections / 160 memberships untouched (read-only consumption).

---

## 7. Navigation behavior

| Item | Primary href | Secondary |
|------|--------------|-----------|
| Week attention (plan) | `/dashboard` | — |
| Overdue / open follow-up | `/walkthroughs?observation=…` | Map bay focus when place known |
| Review opportunity | `/walkthroughs?observation=…` | Map when place known |
| Next-week priority | Map bay focus | Intent copy only |
| Primary actions | This Week / Map / Walkthroughs | Unchanged |

No dead-end count cards for loaded follow-ups.

---

## 8. Mobile UX changes

- Kept single-column mobile / two-column desktop shell.  
- Sticky week strip retained.  
- Attention items denser but still ≥44px touch targets; Map secondary link under item.  
- Priorities section added without Map redesign.  
- No new animations / polling intervals (event-driven reload only).  
- Visual language matches existing zinc/amber Overview tokens.

---

## 9. Performance considerations

- Parallel fetch of assignments + sections after week rotations.  
- Walkthrough inbox + priorities fetched sequentially after plan (failures isolated).  
- No background polling.  
- Composition is pure / memoized in the tab.  
- Sections with members loaded once per Overview reload (same pattern as FloorTab).

---

## 10. Test results

```bash
npx vitest run \
  lib/store-ops/ops-overview-001.command.test.ts \
  lib/rd5.walkthroughs.contract.test.ts \
  lib/store-ops/map-004.named-zones.test.ts \
  lib/store-ops/section-ownership-enforcement.test.ts \
  lib/store-ops/align-dept-001.department-alignment.test.ts
# → 51 PASS (ops-overview 9 + companions)

npx tsc --noEmit        # PASS
npm run build           # PASS
```

Lint: new `overview-command` / enrichment paths clean. Pre-existing `react-hooks/set-state-in-effect` on Overview/Walkthroughs `reload()` mount pattern unchanged (same class as prior Floor Command tabs).

Regression invariants checked via contracts: merged Flooring/Home Decor, auto-stage OFF, MAP-004 specialty codes, WALK review ≠ attention.

---

## 11. Remaining gaps (not implemented)

| Gap | Why deferred |
|-----|----------------|
| Approved shared capacity number on week strip | Requires Overview-specific capacity fetch; This Week already owns approvals UI |
| Deep-link to a specific This Week person card | No established person deep-link contract |
| Priority “included in proposal” outcome strip | Sunday drawer owns MAP-003 outcomes; avoid duplicating |
| Offline Overview cache | Not required by mission; PERF-LOAD already scopes visit-on-demand |
| Operator aisle Flooring vs Home Decor partition | ALIGN-DEPT-001 — OPERATOR DECISION |

---

## 12. Production release readiness

| Gate | Verdict |
|------|---------|
| Implementation complete locally | **YES** |
| Migrations | **None** |
| Data mutations | **None** |
| Deploy | **STOP — do not deploy automatically** |
| Phone acceptance | Recommended after authorize (Overview mobile scan) |

**CONDITIONAL GO** for later app-only release after authorize.  
**NO-GO** auto-deploy, topology changes, or inventing urgency/ownership.

---

## Stop

Implementation and documentation complete. Do not deploy. Do not begin another feature tranche from this report.
