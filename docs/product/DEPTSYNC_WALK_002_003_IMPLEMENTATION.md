# DEPTSYNC-WALK-002-003 — Place-Bound Mobile Walkthrough Capture

**Status:** COMPLETE (local implementation)  
**Date:** 2026-10-12  
**Authority:** [`DEPTSYNC_WALKTHROUGHS_001_DISCOVERY.md`](./DEPTSYNC_WALKTHROUGHS_001_DISCOVERY.md)  
**Not authorized:** production deploy, production mutation, schema redesign, commit/push

Reuses RD-5 Walkthroughs. Does not create a new walkthrough system. Does not mutate rotation, Operational Sections, or Zebra.

---

## 1. Files changed

| Path | Change |
|------|--------|
| `lib/store-ops/walkthroughs.ts` | Place ownership compose/resolve; canonical place assert; `ensureActiveWalkthroughSession`; trusted section bind on full place |
| `app/api/walkthroughs/observations/route.ts` | GET returns `place_ownership`; POST uses `ensureActiveWalkthroughSession` |
| `app/api/walkthroughs/sessions/route.ts` | Start path reuses active session via ensure |
| `lib/store-ops/client.ts` | Place history client type includes `place_ownership` |
| `components/walkthroughs/WalkthroughCaptureSheet.tsx` | Fast mobile form; locked place banner; section owner line; More options |
| `components/admin/WalkTheFloorSheet.tsx` | **Record Observation** entry; opens place-bound capture |
| `lib/store-ops/walkthroughs.test.ts` | Ownership compose unit tests |
| `lib/store-ops/walkthroughs.place.test.ts` | **New** — resolve / session reuse / trusted bind |
| `lib/rd5.walkthroughs.contract.test.ts` | Map capture + domain contracts |
| `docs/product/DEPTSYNC_WALK_002_003_IMPLEMENTATION.md` | This report |
| `DEVELOPMENT_JOURNAL.md` / `CHAT_HANDOFF.md` / `MASTER_ROADMAP.md` | Session pointers |

---

## 2. Map capture behavior

From Department Map → bay sheet (`WalkTheFloorSheet`):

1. Shows section-owner context (from place history API ownership, fallback to Map `baySection`).  
2. Supervisor/Master sees **Record Observation** (`data-testid="walk-sheet-record-observation"`).  
3. Opens `WalkthroughCaptureSheet` with locked prefills:
   - `department_id` / department name from bay
   - aisle / bay from bay pair
   - ownership display from trusted resolve (or Map lookup fallback for UI)
4. Save posts to existing `/api/walkthroughs/observations` with that place.  
5. History refreshes on the bay sheet; Overview/Walkthroughs change event still fires.

Associates do not see the Record Observation button (`isSupervisor` gate). Writes remain `requireSupervisorOrAdmin`.

---

## 3. Mobile capture experience

Primary path (place-locked from Map):

- Large location banner (aisle · bay · department)
- **Section owner: [name]** / unsectioned / ambiguous / none assigned
- Three type chips (Positive / Opportunity / General) — min height 56px
- Short note textarea
- **Save observation** — min height 56px + toast + haptic
- Optional fields (companion, associate, follow-up, free place when unlocked) behind **More options**

Follow-up remains optional. No required fields beyond type + note.

Walkthroughs-tab capture still works (unlocked place; same sheet).

---

## 4. Ownership resolution

| Step | Behavior |
|------|----------|
| Source | `operational_section_members` + active `operational_sections` for actor store |
| Display | `composeWalkthroughPlaceOwnership` → `Section owner: …` / honest gaps |
| Persist | On full place (`department_id` + aisle + bay), server **re-resolves** and binds `section_id` |
| Client section_id | Not authoritative when place is complete |
| Associate / follow-up | **Never** auto-set from ownership |
| Ambiguous / unsectioned | `section_id` left null — no guessing |

Canonical place check: full place must exist on `store_locations` (no invented Map places).

---

## 5. Session behavior

| Case | Behavior |
|------|----------|
| Map capture with `session_id: null` | `ensureActiveWalkthroughSession` reuses newest active store session or creates one |
| Walkthroughs tab with active inbox session | Continues to pass that `session_id` |
| `POST /api/walkthroughs/sessions` | Also ensure/reuse (no silent duplicate actives) |
| Provenance | Observation still stores `session_id` + `created_by_specialist_id` |

Does not end other sessions automatically; reuse prevents new duplicates when an active walk already exists.

---

## 6. Database changes

**None.** RD-5 schema unchanged (`aisle` text / `bay` int soft place fields retained). Validated via normalize + `store_locations` existence + membership resolve.

Sunday automatic staging untouched (OFF). No Zebra integration.

---

## 7. Test results

```bash
npx vitest run \
  lib/store-ops/walkthroughs.test.ts \
  lib/store-ops/walkthroughs.authz.test.ts \
  lib/store-ops/walkthroughs.place.test.ts \
  lib/rd5.walkthroughs.contract.test.ts
```

| Suite | Result |
|-------|--------|
| `walkthroughs.test.ts` | 11 passed |
| `walkthroughs.authz.test.ts` | 10 passed |
| `walkthroughs.place.test.ts` | 8 passed |
| `rd5.walkthroughs.contract.test.ts` | 10 passed |
| **Total** | **39 passed** |

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | Pass |
| IDE lint (touched files) | Clean |
| `npx next build` | Pass — `/walkthroughs` + `/api/walkthroughs*` present |

Covered: ownership owned/unsectioned/ambiguous; session reuse; no duplicate session insert; trusted section bind ignores foreign client section; invented place rejected; no auto follow-up; rotation independence contracts.

---

## 8. Release readiness

**CONDITIONAL GO** for a later controlled app-only deploy after operator phone review.

| Item | Status |
|------|--------|
| Local implementation | Complete |
| Schema migrate | Not required |
| Production deploy | **Not done** (this tranche) |
| Phone walk validation | Pending operator |
| Auth / store isolation | Preserved |

---

## 9. Remaining blockers / deferred

1. Follow-up-later UI (WALK-004) — API exists; not in this tranche.  
2. Photos on close — deferred.  
3. Offline walkthrough drafts — deferred.  
4. Hard DB unique “one active session per store” — soft ensure only.  
5. Operator policy: observations without follow-ups as outstanding queue — unchanged (follow-ups only).  
6. Merged `Flooring / Home Decor` department — not split here.

**STOP. Do not deploy.**
