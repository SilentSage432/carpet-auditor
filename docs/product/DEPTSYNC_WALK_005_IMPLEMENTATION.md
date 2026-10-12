# DEPTSYNC-WALK-005 — Walkthrough Follow-Up Lifecycle

**Status:** COMPLETE (local implementation)  
**Date:** 2026-10-12  
**Authority:** [`DEPTSYNC_WALKTHROUGHS_001_DISCOVERY.md`](./DEPTSYNC_WALKTHROUGHS_001_DISCOVERY.md) · [`DEPTSYNC_WALK_002_003_IMPLEMENTATION.md`](./DEPTSYNC_WALK_002_003_IMPLEMENTATION.md) · [`DEPTSYNC_WALK_004_PRODUCTION_RELEASE.md`](./DEPTSYNC_WALK_004_PRODUCTION_RELEASE.md) · Floor Command blueprint §D.4  
**Not authorized:** production deploy, production mutation, schema redesign, commit/push

Reuses RD-5 Walkthroughs. Does not rebuild Walkthroughs. Does not create a parallel task system. Does not mutate rotation, Operational Sections, or Zebra.

---

## 1. Existing functionality reused

| Asset | Reuse |
|-------|--------|
| `POST /api/walkthroughs/follow-ups` | Follow-up-later create (was disconnected from UI) |
| `PATCH /api/walkthroughs/follow-ups/[id]` | Close with evidence / resolution notes |
| `createWalkthroughFollowUp` / `completeWalkthroughFollowUp` | Domain persistence + store asserts |
| `listWalkthroughInbox` / `composeWalkthroughInbox` | Extended in place (annotation + review list) |
| `FollowUpCloseSheet` | Resolution evidence UI unchanged |
| Overview attention inbox | Still overdue open follow-ups only |
| Map place-bound capture (WALK-004) | Untouched |
| Supervisor/Master write gates + RLS SELECT | Unchanged |

---

## 2. Follow-up UI changes

| Surface | Behavior |
|---------|----------|
| Observation cards | Tappable → `ObservationDetailSheet` |
| Detail sheet | Original type / body / place / tagged section / associate; linked open & done follow-ups |
| Add follow-up later | Calls `createWalkthroughFollowUpClient` → existing POST API |
| Close | “Close with evidence” → existing `FollowUpCloseSheet` |
| Follow-up cards | “From: …” opens the source observation when available |
| Status chips | Follow-up open / Follow-up done / Needs decision (opportunities only) |

**Verification gap (documented, not fabricated):** closing a follow-up with evidence *is* the supervisor closure path. There is no separate verify state in the schema (`open` \| `done` only). No second gate added.

---

## 3. Outstanding observation behavior

| Kind | Treatment |
|------|-----------|
| Positive | History only; never auto-outstanding; optional follow-up still available |
| General | History only; not in review queue |
| Opportunity with **no** follow-up rows | **Needs follow-up decision** list (discoverable, not open work) |
| Opportunity / any type with open follow-up | Counted in open / attention follow-up inbox |
| Any with only done follow-ups | Not re-queued as “needs decision” |
| Resolved / verified | Follow-up `done` + evidence/notes only — observation body never overwritten |

**Contract gap:** observations have no open/resolved column. Safe solution: derive follow-up summaries and a review queue from existing follow-up rows; do not invent observation resolution states.

---

## 4. Overview integration

- Attention inbox: **overdue open follow-ups only** (unchanged; no duplicate review entries).
- Follow-ups panel: open count + attention count + link to Walkthroughs.
- Optional hint when `review_count > 0`: opportunities without a follow-up need a decision on Walkthroughs — **explicitly not counted as open work**.

---

## 5. Mobile workflow

1. Walkthroughs → open observation (or open follow-up → source).  
2. Review details + status.  
3. Add follow-up later (short action; optional responsible/date) or close open work with evidence.  
4. Return to Needs attention / Open follow-ups / Needs follow-up decision.  
5. Map **Record Observation** path from WALK-004 preserved.

Large tap targets (`min-h-12`+), progressive add form, minimal required typing (action text only).

---

## 6. Files changed

| Path | Change |
|------|--------|
| `lib/store-ops/walkthroughs.ts` | Annotate follow-up state; `review_observations`; decision helper |
| `lib/store-ops/client.ts` | `createWalkthroughFollowUpClient` |
| `components/walkthroughs/ObservationDetailSheet.tsx` | **New** — review / add later / close |
| `components/hub/tabs/WalkthroughsTab.tsx` | Observation open + review section + status chips |
| `components/hub/tabs/OverviewTab.tsx` | Non-attention review hint |
| `lib/store-ops/walkthroughs.test.ts` | Review / annotation unit tests |
| `lib/rd5.walkthroughs.contract.test.ts` | WALK-005 wiring contract |
| `docs/product/DEPTSYNC_WALK_005_IMPLEMENTATION.md` | This report |
| `DEVELOPMENT_JOURNAL.md` / `CHAT_HANDOFF.md` / `MASTER_ROADMAP.md` | Session pointers |

---

## 7. Schema changes

**None.** RD-5 tables unchanged.

---

## 8. Test results

```bash
npx vitest run \
  lib/store-ops/walkthroughs.test.ts \
  lib/store-ops/walkthroughs.authz.test.ts \
  lib/store-ops/walkthroughs.place.test.ts \
  lib/rd5.walkthroughs.contract.test.ts
```

| Suite | Result |
|-------|--------|
| `walkthroughs.test.ts` | 13 passed |
| `walkthroughs.authz.test.ts` | 10 passed |
| `walkthroughs.place.test.ts` | 8 passed |
| `rd5.walkthroughs.contract.test.ts` | 11 passed |
| **Total** | **42 passed** |

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | Pass |
| IDE lint (touched files) | Clean |
| `npx next build` | Pass — `/walkthroughs` + `/api/walkthroughs*` present |

Covered: follow-up-later client wiring; opportunity review vs positive/general; closed opportunities not re-queued; attention remains overdue follow-ups; rotation independence contracts preserved.

---

## 9. Release readiness

**CONDITIONAL GO** for a later controlled app-only deploy after operator phone review.

| Item | Status |
|------|--------|
| Local implementation | Complete |
| Schema migrate | Not required |
| Production deploy | **Not done** (this tranche) |
| Auth / store isolation | Preserved |
| Map capture regression | Code path untouched; build green |

---

## 10. Remaining blockers / deferred

1. Separate supervisor “verify” state beyond follow-up `done` — not in schema; deferred.  
2. Photos on close — deferred.  
3. Offline walkthrough drafts — deferred.  
4. Hard DB unique “one active session per store” — soft ensure only (WALK-002/003).  
5. Phone acceptance of WALK-004 Map capture still pending.  
6. Production deploy of WALK-005 — **not authorized here**.

**STOP. Do not deploy.**
