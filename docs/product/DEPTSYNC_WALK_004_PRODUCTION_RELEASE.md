# DEPTSYNC-WALK-004 — Map-Bound Walkthrough Capture Production Release

**Status:** RELEASED — AWAITING PHONE ACCEPTANCE  
**Date:** 2026-10-12  
**Project:** `fmeinlwhixngednabhgy`  
**App:** https://deptsync-hub.vercel.app  
**Source commit:** `d810605ef96cb1a0e8c82c546bd8e1aaebe97dba`  
**Includes:** WALK-001 discovery docs + WALK-002/003 place-bound Map capture

---

## Preflight

| Check | Result |
|-------|--------|
| Repository / branch | `carpet-auditor` · `main` @ `d810605` |
| Scope | WALK-only (excluded SEC-OPS-010 doc dirt, RD-6 audit, tmp/) |
| Focused tests | **39 passed** (`walkthroughs*` + `rd5.walkthroughs.contract`) |
| TypeScript | Pass (`npx tsc --noEmit`) |
| Lint (touched files) | Clean |
| Production build (local) | Pass |
| Database migration | **None required** (RD-5 tables already on prod) |
| Security / data blockers | None for this app-only release |

---

## Release

| Field | Value |
|-------|--------|
| Commit | `d810605` — `WALK-002/003: place-bound Map walkthrough capture` |
| Push | `origin/main` (`fb25563..d810605`, no force) |
| GitHub Production deployment (git integration) | `7017291733` @ `d810605` — **failure** (`dpl_ExXCdtqVspe4W5V4iXGom6jyoV5B`) |
| Recovery deploy | CLI `vercel deploy --prod` from clean `git archive HEAD` |
| Successful deployment ID | `dpl_2BMYcwgu5f9AJzEZFSZGdCqPFoU2` |
| Deploy URL | https://deptsync-a4d47bthl-tyson-zauggs-projects.vercel.app |
| Alias | https://deptsync-hub.vercel.app (**Ready**) |
| Schema changes | **None** |

GitHub-triggered Production deploy failed before a usable build artifact; production was recovered by deploying the exact committed HEAD tree via Vercel CLI and confirming the alias.

---

## Verification results (non-mutating)

| Check | Result |
|-------|--------|
| `GET /login` | **200** |
| `GET /admin/store-map` | **307** → login (gate intact) |
| `GET /walkthroughs` | **307** → login |
| `GET /overview` | **307** → login |
| `GET /api/walkthroughs` | **401** |
| `GET /api/walkthroughs/observations` | **401** |
| `GET /api/walkthroughs/sessions` | **401** |
| `POST /api/walkthroughs/observations` (unauth) | **401** `Unauthorized` |
| `GET /api/operational-sections` | **401** |
| `POST /api/rotations/zebra-entry` (unauth) | **401** |
| Released tree contains `walk-sheet-record-observation` | **Yes** (HEAD archive) |
| `ensureActiveWalkthroughSession` / ownership compose | **Present** in released tree |
| `STRICT_SECTION_OWNERSHIP_AUTO_STAGE` | **false** (unchanged) |
| Sample production observations created | **No** |

Supervisor/Master write gates and store-scoped APIs unchanged from RD-5 + WALK-002/003. No Zebra integration added. Sunday auto-stage remains OFF.

---

## Test results

```bash
npx vitest run \
  lib/store-ops/walkthroughs.test.ts \
  lib/store-ops/walkthroughs.authz.test.ts \
  lib/store-ops/walkthroughs.place.test.ts \
  lib/rd5.walkthroughs.contract.test.ts
```

**39 passed** (4 files). Local `tsc` + `next build` PASS before push.

---

## Data preservation (read-only, store 2587)

| Entity | Count / state |
|--------|----------------|
| `walkthrough_sessions` | **0** |
| `walkthrough_observations` | **0** |
| `walkthrough_follow_ups` | **0** |
| Active operational sections | **4** |
| Section memberships | **160** |
| Stewardship aisles | Tyson 5·6 · Nate 7·39·40 · Nick 43·44 · Tracy 41·42 |

No schema migrate. No permanent test observations written.

---

## Phone acceptance steps

Operator on phone at https://deptsync-hub.vercel.app:

1. Open Floor Command (Supervisor / Master).  
2. Navigate to **Map**.  
3. Select a known bay (e.g. aisle 5 or 39).  
4. Tap **Record Observation**.  
5. Confirm location shows the correct aisle · bay · department.  
6. Confirm **Section owner** matches stewardship (Tyson / Nate / Nick / Tracy) or honest unsectioned/ambiguous copy.  
7. Confirm Positive / Opportunity / General chips work.  
8. Confirm companion / associate / follow-up stay under **More options** and are not required.  
9. Confirm the sheet feels fast enough for a walk.

Creating a real observation is an **operator decision**. Do not fabricate acceptance.

---

## Remaining blockers

1. GitHub→Vercel Production git deployment for `d810605` failed once — root cause not fully diagnosed; CLI recovery succeeded. Monitor next push.  
2. Phone acceptance pending.  
3. WALK-004 follow-up-later UI still deferred (not this release).  
4. Photos / offline drafts deferred.

---

## Release status

**RELEASED — AWAITING PHONE ACCEPTANCE.**

**STOP. Do not implement follow-up improvements in this tranche.**
