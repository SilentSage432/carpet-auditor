# DEPTSYNC-MAP-002 — Bay Context and Attention Production Release

**Status:** RELEASED — AWAITING PHONE ACCEPTANCE  
**Date:** 2026-10-12  
**Project:** `fmeinlwhixngednabhgy`  
**App:** https://deptsync-hub.vercel.app  
**Source commit:** `b9ae9611becef59e64911b4836333e0616e8b65e`  
**Includes:** MAP-001 reconciliation docs + MAP-002 bay-context implementation

---

## Preflight

| Check | Result |
|-------|--------|
| Repository / branch | `carpet-auditor` · `main` @ `b9ae961` |
| Scope | MAP-001 docs + MAP-002 only (excluded SEC-OPS-010 doc dirt, RD-6 audit, SEC-OPS-010A, tmp/) |
| Focused tests | **43 passed** (`map-bay-context` + rd2 map contract + rd5 walkthroughs + walkthrough place/unit) |
| TypeScript | Pass (`npx tsc --noEmit`) |
| Lint (touched files) | Clean |
| Production build (local) | Pass (`/api/store-locations/bay-context` present) |
| Database migration | **None required** |
| Security / data blockers | None for this app-only read release |
| Sunday auto-stage | `STRICT_SECTION_OWNERSHIP_AUTO_STAGE = false` |

---

## Release

| Field | Value |
|-------|--------|
| Commit | `b9ae961` — `MAP-002: bay context and attention on Map sheet` |
| Push | `origin/main` (`3165187..b9ae961`, no force) |
| Vercel Production deployment | `dpl_EE2iSwmSoY3JxCNk6sYnPksLszAJ` — **READY** |
| Deploy URL | https://deptsync-gt40bazm0-tyson-zauggs-projects.vercel.app |
| Alias | https://deptsync-hub.vercel.app → `dpl_EE2iSwmSoY3JxCNk6sYnPksLszAJ` (**Ready**) |
| gitSource | `github` · `main` · sha `b9ae9611becef59e64911b4836333e0616e8b65e` |
| CLI recovery | **Not used** |
| Schema changes | **None** |

---

## Test results

```bash
npx vitest run \
  lib/store-ops/map-bay-context.test.ts \
  lib/rd2.floor-command-map.contract.test.ts \
  lib/rd5.walkthroughs.contract.test.ts \
  lib/store-ops/walkthroughs.place.test.ts \
  lib/store-ops/walkthroughs.test.ts
```

**43 passed** (5 files). Local `tsc` + `next build` PASS before push.

---

## API authorization verification (non-mutating)

| Check | Result |
|-------|--------|
| `GET /login` | **200** |
| `GET /overview` | **307** → `/login?next=%2Foverview` |
| `GET /walkthroughs` | **307** → `/login?next=%2Fwalkthroughs` |
| `GET /admin/store-map` | **307** → `/login?next=%2Fadmin%2Fstore-map` |
| `GET /dashboard` | **307** → `/login?next=%2Fdashboard` |
| `GET /api/store-locations/bay-context` | **401** `Unauthorized` |
| `GET /api/store-locations/bay-context?department_id&aisle&bay` | **401** `Unauthorized` |
| `POST /api/store-locations/bay-context` (unauth) | **401** `Unauthorized` |
| `GET /api/walkthroughs` | **401** |
| `GET /api/operational-sections` | **401** |
| `POST /api/rotations/zebra-entry` (unauth) | **401** `Unauthorized` |
| Released tree: `requireStoreOpsActor` + `assertActorCanAccessDepartmentId` on bay-context | **Yes** (`b9ae961`) |
| Released tree: `fetchMapBayContext` / `walk-sheet-record-observation` | **Yes** |
| Sample production observations / follow-ups created by this release | **No** |

Supervisor-readable bay-context uses store-ops actor + department scope (not Super Admin–only `/api/store-locations/history`). Store isolation preserved by actor store resolution + department assert. No ownership / Zebra / rotation write paths added.

---

## Data preservation (read-only, store 2587)

| Entity | Count / state |
|--------|----------------|
| Active operational sections (`is_active`) | **4** |
| All operational sections | **5** |
| Section memberships (`operational_section_members`) | **160** |
| `weekly_rotations` (store) | **179** |
| `sunday_bay_assignments` (store_number 2587) | **38** |
| `store_week_capacity_approvals` (2587) | **4** |
| `walkthrough_sessions` | **1** (pre-existing operator session @ 16:19Z; not created by this release) |
| `walkthrough_observations` | **1** (same; positive; not created by this release) |
| `walkthrough_follow_ups` | **0** |
| Zebra evidence (`sunday_bay_assignments.zebra_entered_at` not null) | **0** (unchanged; no Zebra integration in this release) |

No schema migrate. No automatic assignment creation. No ownership changes. Sunday auto-stage remains OFF.

---

## Phone acceptance steps

Operator on phone at https://deptsync-hub.vercel.app (Supervisor / Master):

1. Open **Floor Command**.  
2. Navigate to **Map**.  
3. Select a known aisle and bay.  
4. Confirm the correct **section owner**.  
5. Check **current weekly assignment** status (This week).  
6. Review **follow-up attention**, if present (place-local only).  
7. Expand **operational history** (rotations · observations · completed follow-ups).  
8. Confirm **Record Observation** still works.  
9. Confirm the bay sheet remains easy to use on a phone.

Do **not** fabricate acceptance records. The operator decides whether the added context is practical.

---

## Remaining blockers

1. Phone acceptance pending (practicality of bay context).  
2. MAP-003 aisle/bay walking cues — not started (after MAP-002 phone review).  
3. MAP-004 named zone geography — not started (operator-driven).  
4. Broader Floor Command gaps unchanged (ALIGN-DEPT, SEC-OPS-010, auth simplify, specialty, CI).  
5. Pin-to-week remains gated (`canMutate=false`) — not in this release.

---

## Release status

**RELEASED — AWAITING PHONE ACCEPTANCE.**

**STOP. Do not begin MAP-003 or MAP-004.**
