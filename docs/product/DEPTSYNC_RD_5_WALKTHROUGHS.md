# DEPTSYNC-RD-5 — Floor Command Walkthroughs & Follow-Through

**Status:** COMPLETE (local implementation) + **RD-5-FIX store relationship integrity**  
**Date:** 2026-10-11  
**Authority:** [`DEPTSYNC_REDESIGN_001_COMPLETE_PRODUCT_EXPERIENCE_BLUEPRINT.md`](./DEPTSYNC_REDESIGN_001_COMPLETE_PRODUCT_EXPERIENCE_BLUEPRINT.md) §D.4 / §G; Constitution Art. V-B  
**Not authorized:** production migrate, commit, push, deploy, auth change, rotation rewrite, RD-6

---

## A. Existing Floor Pad capabilities discovered

| Capability | Persistence | Fit for RD-5 |
|------------|-------------|--------------|
| Executive Floor Pad freeform notes | `manager_notes` | Freeform DS notes + optional JSON `action_items` / soft `metadata.follow_up_date` — **not** session/observation/follow-up inbox |
| Walk & Talk voice → shift tasks | `shift_walk_tasks` | Shift-board dispatch (priority windows, assignees) — **not** collaborative agreements / close-with-evidence |
| Gemini extractTasksAndTag | proposal only | Must stay confirm-only; not used as walkthrough authority in RD-5 |
| Speech helpers | client UX | Reusable later; not required for text capture MVP |

**FLOORPAD-001 storage decision (made in RD-5 discovery):**  
Reuse Floor Pad for freeform / voice-adjacent capture. **Do not** overload `manager_notes` or `shift_walk_tasks` as the walkthrough substrate. Introduce a **dedicated walkthrough domain** so Overview open follow-ups are queryable truth. Floor Pad remains PROTECTED and linked from Walkthroughs (“Open Floor Pad”).

No fundamental conflict that blocks implementation — parallel freeform notes vs structured walkthrough domain.

---

## B. Reused vs newly implemented

| Reused | New |
|--------|-----|
| Store-ops auth (`requireStoreOpsActor` / `requireSupervisorOrAdmin`) | Tables: `walkthrough_sessions`, `walkthrough_observations`, `walkthrough_follow_ups` |
| Store resolve + department scope asserts | `lib/store-ops/walkthroughs.ts` domain |
| Operational Sections list for optional binding | `/api/walkthroughs/**` |
| Roster `store_specialists` for optional companion / associate / responsible | Walkthroughs home + capture + close sheets |
| Map bay focus hrefs + bay sheet slot pattern | Place history on Map bay sheet |
| Floor Command styling | Overview real follow-up inbox |

---

## C. Files changed

| Path | Change |
|------|--------|
| `supabase/migrations/20261012_walkthroughs.sql` | Additive schema + store-scoped RLS SELECT |
| `lib/store-ops/walkthroughs.ts` | Domain types, validators, inbox, persistence |
| `lib/store-ops/walkthroughs.test.ts` | Unit tests |
| `lib/rd5.walkthroughs.contract.test.ts` | Surface / independence contracts |
| `app/api/walkthroughs/**` | Inbox, sessions, observations, follow-ups |
| `lib/store-ops/client.ts` | Client fetch/mutate helpers + change event |
| `components/hub/tabs/WalkthroughsTab.tsx` | Functional home (replaces placeholder) |
| `components/walkthroughs/WalkthroughCaptureSheet.tsx` | Mobile capture |
| `components/walkthroughs/FollowUpCloseSheet.tsx` | Close with evidence |
| `components/hub/tabs/OverviewTab.tsx` | Real open / attention follow-ups |
| `components/admin/WalkTheFloorSheet.tsx` | Bay walkthrough history |
| `docs/product/DEPTSYNC_RD_5_WALKTHROUGHS.md` | This report |
| `DEVELOPMENT_JOURNAL.md` / `CHAT_HANDOFF.md` / `MASTER_ROADMAP.md` | Session pointers |

---

## D. Walkthrough interaction model

Conceptual stages (not mandatory workflow states):

**OBSERVE → DISCUSS → AGREE → FOLLOW THROUGH**

1. **Begin walkthrough** / **Add observation** opens capture.  
2. Operator picks type (Positive / Opportunity / General) + description.  
3. Optional: companion, associate mentioned, section, aisle/bay.  
4. Optional: follow-up action, responsible roster member, target date.  
5. Save creates/uses a session + observation (+ optional follow-up).  
6. End active session when the walk is done.  
7. Close follow-ups later with completion evidence / resolution notes.

---

## E. Observation capture experience

- Large type chips; short textarea; optional pickers.  
- Associate **not** required.  
- Place **not** required.  
- Follow-up **not** required.  
- Timestamps from server `observed_at` / `now()` — not fabricated.  
- No AI-generated judgments in this tranche.

---

## F. Follow-up behavior

- Linked to the creating observation (`observation_id` + `session_id`).  
- Status: `open` | `done`.  
- Completion requires evidence and/or resolution notes.  
- Past `due_on` → “Needs attention” (reminder language only — **not** performance grade).  
- Does not auto-verify bays, change assignments, or mutate sections.

---

## G. Map and Operational Sections integration

- Observations may reference `section_id` and/or physical `department_id` + aisle + bay (existing identities only).  
- Map bay sheet shows recent walkthrough history for that physical bay + link to `/walkthroughs`.  
- Aisle index on Map is unchanged (no walkthrough clutter).  
- Observation cards can deep-link to Map via `buildMapBayFocusHref`.

---

## H. Team relationships

- Optional companion on session start / capture.  
- Optional associate on observation (recognition / conversation subject).  
- Optional responsible person on follow-up.  
- All via existing `store_specialists.id`.  
- No scores, rankings, grades, disciplinary labels, or associate app accounts.

---

## I. Persistence and authorization

- Writes: service role after Supervisor/Master API checks; store_id from actor store — never trusted from client as sole scope.  
- Reads: authenticated SELECT with `jwt_matches_store` (same pattern as Operational Sections).  
- Store-scoped load helpers always filter `store_id`.  
- No service-role credentials on the client.

---

## J. Migration requirements

| Item | Detail |
|------|--------|
| File | `supabase/migrations/20261012_walkthroughs.sql` |
| Production | **Not executed** in this tranche |
| Local | Apply before expecting persisted records (UI shows clear empty / missing-relation messaging) |
| Destructive | None — additive tables/indexes/policies only |

---

## K. Verification results

| Check | Result |
|-------|--------|
| Typecheck | Pass (`npx tsc --noEmit`) |
| Relevant + full tests | **1425 passed** (109 files) including `walkthroughs.test.ts` + `rd5.walkthroughs.contract.test.ts` |
| Production build | Pass — routes include `/walkthroughs`, `/api/walkthroughs*` |
| New lint debt | None introduced by design; pre-existing hub `react-hooks/set-state-in-effect` debt elsewhere unchanged |

---

## L. Known limitations

- No offline draft queue yet.  
- No voice → proposed text in Walkthroughs (Floor Pad path unchanged).  
- Photos not attached to completion evidence.  
- Production DB must receive migration before phone review sees durable history.  
- FLOORPAD-001 full archaeology (Gemini belonging / Floor Pad retirement) remains open — RD-5 only decided storage separation.

---

## M. Production rollout requirements

1. Commit reviewed RD-5 diff (separate release tranche).  
2. Dump-before-migrate on production Supabase.  
3. Apply `20261012_walkthroughs.sql`.  
4. Deploy app that knows the new APIs.  
5. Non-mutating smoke: `/walkthroughs`, Overview follow-ups, Map bay history.  
6. Do not run Sunday rotation or mutate weekly ownership as part of rollout.

---

## N. Phone review instructions (local / after future deploy)

1. Sign in as Department Supervisor.  
2. Open **Walkthroughs** → **Begin walkthrough**.  
3. Capture a Positive without naming an associate; save.  
4. Capture an Opportunity with optional bay + follow-up; save.  
5. Confirm home shows recent observations, open follow-ups; Overview shows open count.  
6. Open Map → bay with a place-bound observation → see Walkthrough history.  
7. Close follow-up with evidence. Confirm overdue copy is reminder-only.  
8. Confirm This Week assignments / verification unchanged.

**STOP. Do not begin RD-6.**

---

## RD-5-FIX — Store relationship integrity

**Status:** COMPLETE (local)  
**Authority:** DEPTSYNC-RD-5-RELEASE-READINESS blockers  
**Not authorized:** commit, push, deploy, production SQL, RD-6

### A. Root cause

Walkthrough **entity** rows were store-scoped (`load*ForStore` + actor `store_id`), but optional soft references (`associate_specialist_id`, `companion_specialist_id`, `responsible_specialist_id`, `section_id`, `focus_section_id`) accepted any existing UUID via global FKs. On multi-store project `fmeinlwhixngednabhgy`, a Supervisor could attach another store’s roster member or Operational Section without reading/modifying that store’s walkthrough rows.

### B. Validation changes

| Reference | Canonical check |
|-----------|-----------------|
| Specialist IDs | `assertRosterSpecialistForStore` — `store_specialists.id` + `store_number` via `storeNumberQueryValues` (same hub store identity as roster) |
| Section IDs | `assertOperationalSectionForStore` → `loadOperationalSectionForStore` (RD-3 pattern) |
| Optional/null | Still allowed (no-op success) |
| Errors | Generic `not_found` — “Team member not found” / “Section not found” (no foreign store disclosure) |

Applied on: `startWalkthroughSession`, `createWalkthroughObservation`, `createWalkthroughFollowUp`. APIs pass `store.store_number` from actor-resolved store.

### C. Authorization paths covered

- Foreign session end → `not_found`, no update  
- Foreign observation → cannot create follow-up  
- Foreign follow-up complete → `not_found`, no update  
- Foreign specialist attach (companion / associate / responsible) → rejected  
- Foreign section attach (focus / observation) → rejected  
- Same-store refs + null optional refs → succeed  

### D. Regression tests added

`lib/store-ops/walkthroughs.authz.test.ts` — behavioral domain mocks (not source-text-only).  
Contract updated in `lib/rd5.walkthroughs.contract.test.ts` for FIX helpers + API `store_number` wiring.

### E. Follow-up completion independence

Behavioral test asserts completion requires evidence; updates only `walkthrough_follow_ups` with store-scoped filters; source observation row unchanged; never touches `weekly_rotations`, `sunday_bay_assignments`, or Operational Section tables.

### F. Migration impact

**None.** Domain/API validation only. `20261012_walkthroughs.sql` unchanged. No production migration executed.

### G. Verification results

| Check | Result |
|-------|--------|
| Typecheck | Pass |
| Relevant + full tests | **1436 passed** (110 files) including `walkthroughs.authz.test.ts` |
| Production build | Pass |
| New regressions | None |

### H. Remaining release blockers

None from RELEASE-READINESS soft-ref gaps. Release still requires operator-authorized migrate + deploy (not this tranche).

### I. GO / NO-GO recommendation

**CONDITIONAL GO** for RD-5-RELEASE after operator authorization — engineering integrity blockers closed. Still require: dump-before-migrate on `fmeinlwhixngednabhgy`, apply `20261012_walkthroughs.sql`, deploy app, non-mutating smoke, phone review.
