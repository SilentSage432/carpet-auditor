# DEPTSYNC-ROTATION-AUTO-003 — Automatic Publication & Supervisor Edit Safety

**Status:** COMPLETE locally — **not deployed**; **auto-publish remains OFF**  
**Date:** 2026-10-15  
**Mode:** Controlled local implementation (after AUTO-001 discovery + AUTO-002 engine)  
**Authority:** [`DEPTSYNC_ROTATION_AUTO_001_DISCOVERY.md`](./DEPTSYNC_ROTATION_AUTO_001_DISCOVERY.md) · [`DEPTSYNC_ROTATION_AUTO_002_IMPLEMENTATION.md`](./DEPTSYNC_ROTATION_AUTO_002_IMPLEMENTATION.md)  
**Store context:** 2587 · merged Flooring / Home Decor · capacity **Tyson 3 / Nate 2 / Nick 3 / Tracy 3 = 11** (unchanged)

**Strict exclusions honored:** No production deploy · no production migrations applied · no production assignment mutations · `WEEKLY_ROTATION_AUTO_PUBLISH = false` · SPECIALTY-OPS-001 paused · no capacity redistribution · SEC-OPS-010 preserved · no Orient integration · no automatic Zebra claims.

---

## 1. Implementation summary

AUTO-003 completes the automatic weekly rotation **execution path** established by AUTO-002:

1. **Automatic publication path** — when deliberately activated, cron uses the same section-balanced stage + stewardship assign composer as Sunday **Assign this week**, then persists ownership through the capacity + section-ownership RPC.
2. **Deliberate dual-gate activation** — product latch `WEEKLY_ROTATION_AUTO_PUBLISH` stays `false`. Env `DEPTSYNC_WEEKLY_ROTATION_AUTO_PUBLISH=1` is **ignored** while the latch is false. Cron never accepts publish flags from query/body. Tests may pass `override: true` only.
3. **Supervisor edit safety** — intentional replace/clear stamps `supervisor_locked` on `sunday_bay_assignments`. Protected ids (owned, locked, completed/verified) are excluded from auto-publish retries so clears and edits are not restored.
4. **Operational visibility** — post-stage/publish summary distinguishes assigned, unfilled, supervisor-edited, supervisor-held-clear, and Zebra handoffs still required (without claiming Zebra entry).

**Default cron behavior today:** section-balanced stage (when context ready) → `STAGED_AWAITING_ASSIGN` — Assign this week still required.

---

## 2. Exact changed files

| Path | Change |
|------|--------|
| `lib/store-ops/authoritative-week-cycle.ts` | Activation resolver, protected-id collector, lock stamp/clear helpers, publication summary, stewardship assign composer |
| `lib/store-ops/week-publication-visibility.ts` | **New** — pure visibility composition (no Zebra claims) |
| `lib/store-ops/sunday-dispatch.ts` | Edit-safe publish path; latch-gated assign; protected fill; visibility on stage/publish results |
| `lib/store-ops/sunday-audit.ts` | Stamp `supervisor_locked` on live assign/clear; map/fetch lock evidence |
| `components/admin/SundayAuditAssignmentModal.tsx` | Treat `supervisor_locked` as owned for planner skip sets |
| `app/api/cron/weekly-rotation/route.ts` | Comment contract: Stage+Assign orchestration; latch-only publish; no body flags |
| `supabase/migrations/20261021_rotation_auto_003_supervisor_lock.sql` | **Local prepare only** — `supervisor_locked` column + index |
| `lib/store-ops/rotation-auto-003.publication.test.ts` | **New** — AUTO-003 focused contracts |
| `lib/store-ops/rotation-auto-002.section-balanced.test.ts` | Latch source-contract regex updated |
| `docs/product/DEPTSYNC_ROTATION_AUTO_003_IMPLEMENTATION.md` | This report |

AUTO-002 foundation files (`section-balanced-stage.ts`, rotations `finishGenerate`, stewardship RPC) remain in force; not re-listed except where touched.

---

## 3. Publication execution path

```
Cron GET /api/cron/weekly-rotation
  └─ CRON_SECRET Bearer only (no body publish flag)
  └─ runWeeklyRotationForAllDepartments
       └─ dispatchWeeklyPlanForDepartment
            ├─ Stage: generateWeeklyRotations → section-balanced when
            │        approvals + Operational Sections exist
            ├─ Load sunday_bay_assignments (supervisor_locked when migrated)
            ├─ collectProtectedRotationIds (owned | locked | completed/verified)
            ├─ resolveWeeklyRotationAutoPublishEnabled()
            │    ├─ false → STAGED_AWAITING_ASSIGN + visibility summary
            │    └─ true (override/test or future latch+env) →
            │         composeAuthoritativeAssignmentProposal
            │         → filterProposalAwayFromProtected
            │         → filterPlanItemsToCapacity
            │         → applySundayAssignmentPlanAdmin
            │              (upsert_sunday_bay_assignments_with_capacity
            │               + OPERATIONAL-011 ownership)
            │         → clearSupervisorLocksForPublishedBays (new fills only)
            └─ publication_summary on COMPLETE / PARTIAL / INSUFFICIENT_BAYS
```

Manual path unchanged: Sunday UI → `composeStewardshipWeeklyProposal` → capacity RPC (same composer wrapped by `composeAuthoritativeAssignmentProposal` for scheduled).

---

## 4. Activation mechanism

| Gate | Behavior |
|------|----------|
| `WEEKLY_ROTATION_AUTO_PUBLISH` | Product latch — **`false`** in source |
| `DEPTSYNC_WEEKLY_ROTATION_AUTO_PUBLISH=1` | Honored **only after** latch is true |
| Cron query/body | **Never** consulted |
| `options.publishAssignments === true` | Test/harness override into `resolveWeeklyRotationAutoPublishEnabled({ override: true })` only — not reachable from HTTP cron |

While latch is false, env alone cannot enable production publish.

---

## 5. Database implications

| Item | Status |
|------|--------|
| Migration | `supabase/migrations/20261021_rotation_auto_003_supervisor_lock.sql` |
| Column | `sunday_bay_assignments.supervisor_locked boolean not null default false` |
| Index | partial on `(store_number, week_starting, supervisor_locked) where true` |
| Production apply | **NOT applied** (LOCAL PREPARE ONLY) |
| Capacity / section / assignment prod rows | **Not mutated by this tranche** |

**Runtime without migration:** stamp/clear/select fail-open on missing column (edits still work; locks skipped until migrate). Auto-publish still OFF.

No additional transactional migration required beyond existing capacity advisory-lock RPC (`upsert_sunday_bay_assignments_with_capacity`) for concurrent writes.

---

## 6. Idempotency guarantees

| Guarantee | Mechanism |
|-----------|-----------|
| No duplicate weekly ownership rewrite | Proposal skips protected ids; fill only non-protected unowned |
| No reassign of published work | Owned + completed/verified protected |
| No capacity overflow | Capacity RPC + `filterPlanItemsToCapacity` |
| No restore of supervisor clear | `supervisor_locked` on clear → protected empty hold |
| No overwrite of supervisor replace | Lock stamped on assign → protected |
| Concurrent cron / writers | Existing store-week advisory lock inside capacity RPC |
| Partial failure / retry | Reload assignments; fill only remaining fillable unowned |
| Stage skip-if-exists | Unchanged weekly stage reuse |

---

## 7. Supervisor editing behavior

| Capability | Status |
|------------|--------|
| Replace assigned bay | Existing `executeSundayAssignLive` + capacity/ownership RPC; now stamps lock |
| Clear / remove when necessary | Clear path stamps lock (not refilled by auto-publish) |
| Select another eligible bay | Existing Sunday drawer / stewardship; planner skips locked ids |
| Section ownership | OPERATIONAL-011 RPC still enforces; cross-section rejected |
| Approved capacity | Capacity RPC still enforces per-person + shared |
| Completion / verification evidence | Completed/verified statuses protected from auto-publish |
| See updated weekly assignment | Existing Sunday / This Week surfaces; lock mapped into assignment views |

Unauthorized edits: unchanged SEC-OPS-010 actor/store/dept gates on mutation APIs — no cron or service-role bypass for supervisors.

---

## 8. Authorization guarantees

| Control | Preserved |
|---------|-----------|
| SEC-OPS-010 | Mutation APIs still JWT→profiles; store/dept bind |
| Cron authority | `CRON_SECRET` Bearer only; narrowly scoped Stage+Assign orchestration |
| No body/query publish elevation | Documented + tested |
| No unrestricted service-role mutate | Cron still uses capacity RPC writers only |
| MasterAdmin protection | Unchanged |
| PIN-only auth | Unchanged (AUTH-006) |
| Store isolation | Writers keyed by `store_number` + week |
| Operational Section ownership | Stage + assign + RPC |
| Capacity 11 (3/2/3/3) | Unchanged; not redistributed |

---

## 9. Test results

```bash
npx vitest run \
  lib/store-ops/rotation-auto-003.publication.test.ts \
  lib/store-ops/rotation-auto-002.section-balanced.test.ts \
  lib/store-ops/engine-prod-002.sunday-dispatch.test.ts \
  lib/store-ops/bay-unit-002.physical-bay.test.ts \
  lib/store-ops/section-ownership-enforcement.test.ts \
  lib/store-ops/sec-ops-010.authz.test.ts
# 6 files / 110 PASS

npx tsc --noEmit                                      # PASS
npx eslint <AUTO-003 core sources>                    # PASS (0 errors)
npm run build                                         # PASS
```

Covered: latch/env disabled; override publish path composition; full 11-bay eligible; insufficient/orphan section honesty; protected owned/locked/completed/verified; supervisor-edit retry skip; visibility (assigned/unfilled/edited/Zebra outstanding); cron no body flags; capacity-RPC writer contract; manual stewardship + lock awareness; SEC-OPS-010 regressions; AUTO-002 foundation regressions.

Repo-wide `npm run lint` still reports many pre-existing errors outside this tranche (not introduced here).

---

## 10. Remaining blockers

1. **Latch must stay false** until an authorized enablement tranche + phone acceptance.  
2. **Migration not applied** — locks are soft until `20261021_…` is applied in a controlled migrate.  
3. Approvals must exist before a Sunday publish run (unchanged).  
4. Section shortfalls remain explicit — no cross-section invent.  
5. Store `sunday_auto_generate` may already be true; product latch is the hard-off for ownership writes.  
6. SPECIALTY-OPS-001 paused (orthogonal).  
7. Orient / automatic Zebra still out of scope.

---

## 11. Production activation prerequisites

1. Phone acceptance of AUTO-002/003 behavior on staging or controlled local.  
2. Apply `20261021_rotation_auto_003_supervisor_lock.sql` to production (authorized migrate tranche).  
3. Confirm W-week capacity approvals (3/2/3/3) before first auto-publish Sunday.  
4. Flip `WEEKLY_ROTATION_AUTO_PUBLISH` to `true` in a dedicated enablement commit.  
5. Set Production env `DEPTSYNC_WEEKLY_ROTATION_AUTO_PUBLISH=1`.  
6. Deploy app with latch+env; verify first cron returns owned assignments without overwriting supervisor locks.  
7. Keep CRON_SECRET rotated; never expose publish via query/body.

---

## 12. GO / NO-GO recommendation

| Decision | Verdict |
|----------|---------|
| Local implementation complete | **GO** |
| Production deploy | **NO-GO** |
| Enable `WEEKLY_ROTATION_AUTO_PUBLISH` | **NO-GO** |
| Apply supervisor_lock migration to production | **NO-GO** (prepared only) |
| Production assignment mutations | **NO-GO** |
| Capacity change to 12 / redistribute | **NO-GO** |
| Later enablement after migrate + phone acceptance | **CONDITIONAL GO** |

### AUTO-002 foundation verification (this tranche)

| Contract | Status |
|----------|--------|
| Section-balanced staging | Confirmed |
| Authoritative Operational Section binding | Confirmed |
| Configured associate capacity 3/2/3/3=11 | Confirmed (untouched) |
| Selection priority preservation | Confirmed (via AUTO-002 selector) |
| Explicit shortfall reporting | Confirmed |
| Unified manual/scheduled planner | Confirmed (stewardship composer) |
| Stewardship / ownership RPC | Confirmed |

**Remaining divergence (intentional):** scheduled path still does **not** persist ownership while latch is OFF (`STAGED_AWAITING_ASSIGN`); manual Assign this week remains the human confirm path until activation.

---

**STOP AFTER IMPLEMENTATION.** Do not deploy. Do not enable automatic publication. Do not mutate production assignments.
