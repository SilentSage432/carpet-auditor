# DEPTSYNC-WALK-006 — Walkthrough Follow-Up Lifecycle Production Release

**Status:** RELEASED — AWAITING PHONE ACCEPTANCE  
**Date:** 2026-10-12  
**Project:** `fmeinlwhixngednabhgy`  
**App:** https://deptsync-hub.vercel.app  
**Source commit:** `cbaac900be7052dc484adcdc8dba8efd585ee85f`  
**Includes:** WALK-005 follow-up lifecycle on existing RD-5 Walkthroughs

---

## Preflight

| Check | Result |
|-------|--------|
| Repository / branch | `carpet-auditor` · `main` @ `cbaac90` |
| Scope | WALK-005 only (excluded SEC-OPS-010 doc dirt, RD-6 audit, SEC-OPS-010A, tmp/) |
| Focused tests | **42 passed** (`walkthroughs*` + `rd5.walkthroughs.contract`) |
| TypeScript | Pass (`npx tsc --noEmit`) |
| Lint (touched files) | Clean |
| Production build (local) | Pass |
| Database migration | **None required** (RD-5 tables already on prod) |
| Security / data blockers | None for this app-only release |
| Sunday auto-stage | `STRICT_SECTION_OWNERSHIP_AUTO_STAGE = false` |

### WALK-004 GitHub deploy failure — cause identified

Prior failure `7017291733` / `dpl_ExXCdtqVspe4W5V4iXGom6jyoV5B` @ `d810605`:

| Field | Value |
|-------|--------|
| Vercel `readyState` | `ERROR` |
| `errorCode` | **`git_info_fail`** |
| Meaning | GitHub metadata fetch failed before a usable build artifact |
| App build fault? | **No** — not a TypeScript/Next compile failure |
| Recovery used then | CLI `vercel deploy --prod` from clean `git archive HEAD` |

Subsequent Production deploy for docs commit `808ea48` succeeded via GitHub integration. This release also succeeded on the GitHub → Vercel path without CLI recovery.

---

## Release

| Field | Value |
|-------|--------|
| Commit | `cbaac90` — `WALK-005: wire follow-up lifecycle on Walkthroughs` |
| Push | `origin/main` (`808ea48..cbaac90`, no force) |
| Vercel Production deployment | `dpl_BvF6rSuu7Lbw5KAh1ouSF3z6qwvh` — **READY** |
| Deploy URL | https://deptsync-853gn9g3q-tyson-zauggs-projects.vercel.app |
| Alias | https://deptsync-hub.vercel.app → `dpl_BvF6rSuu7Lbw5KAh1ouSF3z6qwvh` (**Ready**) |
| gitSource | `github` · `main` · sha `cbaac90…` |
| CLI recovery | **Not used** |
| Schema changes | **None** |

GitHub Deployments API had not yet listed a new Production deployment row for `cbaac90` at verification time (prior rows still end at `808ea48`). Vercel Production alias assignment and `gitSource.sha` confirm the intended commit is live.

---

## Verification results (non-mutating)

| Check | Result |
|-------|--------|
| `GET /login` | **200** |
| `GET /walkthroughs` | **307** → `/login?next=%2Fwalkthroughs` |
| `GET /overview` | **307** → `/login?next=%2Foverview` |
| `GET /admin/store-map` | **307** → `/login?next=%2Fadmin%2Fstore-map` |
| `GET /api/walkthroughs` | **401** |
| `GET /api/walkthroughs/observations` | **401** |
| `GET /api/walkthroughs/sessions` | **401** |
| `GET /api/walkthroughs/follow-ups` | **401** |
| `POST /api/walkthroughs/observations` (unauth) | **401** `Unauthorized` |
| `POST /api/walkthroughs/follow-ups` (unauth) | **401** `Unauthorized` |
| `GET /api/operational-sections` | **401** |
| `POST /api/rotations/zebra-entry` (unauth) | **401** `Unauthorized` |
| Released tree contains `ObservationDetailSheet` / `observation-add-follow-up` | **Yes** (`cbaac90`) |
| Released tree contains `walkthrough-review-observations` | **Yes** |
| Map `walk-sheet-record-observation` | **Yes** (unchanged from WALK-004) |
| `STRICT_SECTION_OWNERSHIP_AUTO_STAGE` | **false** |
| Sample production observations / follow-ups created | **No** |

Supervisor/Master write gates and store-scoped APIs unchanged. No Zebra / rotation mutation paths added. Overview attention remains overdue open follow-ups only.

---

## Test results

```bash
npx vitest run \
  lib/store-ops/walkthroughs.test.ts \
  lib/store-ops/walkthroughs.authz.test.ts \
  lib/store-ops/walkthroughs.place.test.ts \
  lib/rd5.walkthroughs.contract.test.ts
```

**42 passed** (4 files). Local `tsc` + `next build` PASS before push.

---

## Data preservation (read-only, store 2587)

| Entity | Count / state |
|--------|----------------|
| `walkthrough_sessions` | **0** |
| `walkthrough_observations` | **0** |
| `walkthrough_follow_ups` | **0** |
| Active operational sections | **4** |
| Section memberships | **160** |
| `weekly_rotations` (store) | **179** (unchanged by this release) |

No schema migrate. No permanent test observations written.

---

## Phone acceptance steps

Operator on phone at https://deptsync-hub.vercel.app (Supervisor / Master):

1. Open **Walkthroughs**.  
2. If any observation exists, open it and confirm original details render.  
3. Confirm **Add follow-up later** (or optional follow-up on positives) is available.  
4. Confirm the add-follow-up form is usable on a phone (short action; optional responsible/date).  
5. Confirm **Needs follow-up decision** (if any opportunities without follow-ups) is distinct from **Open follow-ups** / **Needs attention**.  
6. Confirm Overview still treats overdue follow-ups as attention — opportunities-without-follow-up are not counted as open work.  
7. Open **Map** → known bay → **Record Observation** still available (WALK-004 path).

Production currently has **0** walkthrough rows. Do **not** fabricate acceptance records. Operator may exercise the workflow during a real department walk.

---

## Remaining gaps

1. Separate supervisor verify state beyond follow-up `done` — not in schema.  
2. Photos / offline drafts — deferred.  
3. GitHub Deployments API row for `cbaac90` not observed at smoke time (Vercel alias verified).  
4. Phone acceptance pending.  
5. Hard DB unique “one active session per store” — soft ensure only.

---

## Release status

**RELEASED — AWAITING PHONE ACCEPTANCE.**

**STOP. Do not begin Map implementation.**
