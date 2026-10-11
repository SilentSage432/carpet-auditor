# DEPTSYNC-RD-1 — Floor Command Application Shell

**Status:** COMPLETE (local implementation)  
**Date:** 2026-10-10  
**Authority:** [`DEPTSYNC_REDESIGN_001_COMPLETE_PRODUCT_EXPERIENCE_BLUEPRINT.md`](./DEPTSYNC_REDESIGN_001_COMPLETE_PRODUCT_EXPERIENCE_BLUEPRINT.md)  
**Not authorized:** deploy, commit, push, schema, auth change, production SQL, engine rewrite, sections storage, walkthrough persistence

---

## A. Files changed

| Path | Change |
|------|--------|
| `lib/nav-hub.ts` | Five-tab Floor Command IA; homeHref; dept-switcher visibility; Team secondary |
| `components/hub/WorkflowTabShell.tsx` | Mount Overview / Walkthroughs; Team via `rosterVisited`; home recovery |
| `components/hub/BottomNav.tsx` | `grid-cols-5`; denser labels |
| `components/hub/HubHeader.tsx` | Optional department switcher |
| `components/hub/NavigationHub.tsx` | Wire switcher visibility |
| `components/hub/NavIcons.tsx` | `calendar` on `NavIconId` |
| `components/hub/tabs/OverviewTab.tsx` | **New** — evidence-only Overview |
| `components/hub/tabs/WalkthroughsTab.tsx` | **New** — intentional empty state |
| `components/hub/tabs/MapTab.tsx` | Aisle geography: all depts/locations (no pin filter) |
| `components/sections/SettingsSection.tsx` | More → Team entry to `/roster` |
| `app/(workflow)/overview/page.tsx` | **New** route shell |
| `app/(workflow)/walkthroughs/page.tsx` | **New** route shell |
| `app/page.tsx` | Post-auth land via `homeHrefForSpecialist` |
| `app/globals.css` | `.hub-floor-command` token polish |
| Contract tests | RD-1 + updated PERF-LOAD / UX-REDUCE / UX-005* IA expectations |
| `DEVELOPMENT_JOURNAL.md` / `CHAT_HANDOFF.md` / `MASTER_ROADMAP.md` / `DEPT_SYNC_STATE.md` | Session pointers |

---

## B. Navigation architecture

| Tab | Route | Role |
|-----|-------|------|
| **Overview** | `/overview` | Operator landing |
| **Map** | `/admin/store-map` | Aisle → bay geography |
| **This Week** | `/dashboard` | Existing Floor ownership board |
| **Walkthroughs** | `/walkthroughs` | Placeholder shell |
| **More** | `/settings` | Setup + Team link |

- **Team** remains `/roster` (secondary). Highlights **More** in the bottom bar.  
- Associates keep **My Shift** (`/dashboard`) + **Map** only.  
- `homeHrefForSpecialist`: Supervisor/Master → `/overview`; Associate → `/dashboard`.  
- PERF-LOAD-002 visit-on-demand + keep-alive preserved.

---

## C. Desktop experience

- Same five-tab bar; Overview uses a two-column layout (`lg:`) — week/attention/actions left, people + follow-ups right.  
- Touch targets remain ≥48px; keyboard focus styles on links/buttons unchanged.  
- Header department pin hidden on Overview / Map / Walkthroughs; available on This Week / More for transitional engine scoping.

---

## D. Mobile experience

- Five-tab pill with `text-[8px]` short labels (Overview · Map · Week · Walk · More).  
- Overview single-column; sticky week strip; attention first.  
- Bottom nav safe-area padding preserved.

---

## E. Existing functionality preserved

- This Week = prior Floor tab (stage/assign/verify/+1/Floor Pad handoff).  
- Map = prior Map tab + StoreLocationGrid (`canMutate=false`).  
- More = SettingsSection (Floor Pad, topology, seasonal, Master Admin).  
- Roster full UI via More → Team.  
- Auth, gate, bootstrap, associate PIN/QR paths untouched.  
- Rotation engine / schema / topology data untouched.

---

## F. Intentional placeholders

| Surface | Behavior |
|---------|----------|
| Walkthroughs | Empty state; links to Floor Pad (current capture) + Overview; **no fabricated sessions** |
| Overview follow-ups | States that walkthrough follow-ups are not stored yet |
| Operational Sections | Not in this tranche |
| Capacity UI / dual-dept split | Not in this tranche |

---

## G. Verification results

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | Pass |
| `npm test -- --run` | **1362 passed** (100 files) |
| `npm run build` | Pass — routes include `/overview`, `/walkthroughs` |
| Lint (touched app sources) | Pre-existing `react-hooks/set-state-in-effect` in SettingsSection / other hub files; **no new lint rules introduced by design**. Full-repo lint still noisy on `tmp/` (pre-existing). |

---

## H. Known limitations

- Overview attention uses This Week ownership evidence only (no separate barrier fetch yet).  
- Map still groups by department internally in StoreLocationGrid; pin chrome removed — full RD-2 aisle index polish deferred.  
- Working-department pin still affects This Week / topology setup.  
- Associate chrome still exists (auth simplify = later tranche).  
- Walkthrough persistence blocked on FLOORPAD-001.

---

## I. Screens / routes for operator review

1. `/overview` — landing after login (DS/Master)  
2. Bottom nav five tabs on phone width  
3. `/admin/store-map` — no department pill; all aisles visible  
4. `/dashboard` — This Week still fully operational  
5. `/walkthroughs` — empty state + Floor Pad link  
6. `/settings` → Open Team → `/roster`  
7. Associate login still lands on My Shift + Map only  

**STOP for operator approval before deploy / commit / push.**
