# DEPTSYNC-ROTATION-AUTO-002 — Section-Balanced Weekly Rotation Engine

**Status:** COMPLETE locally — **not deployed**; **auto-publish remains OFF**  
**Date:** 2026-10-15  
**Mode:** Evidence-based implementation (after AUTO-001 discovery)  
**Authority:** [`DEPTSYNC_ROTATION_AUTO_001_DISCOVERY.md`](./DEPTSYNC_ROTATION_AUTO_001_DISCOVERY.md)  
**Store context:** 2587 · merged Flooring / Home Decor · capacity **3/2/3/3 = 11** (unchanged)

**Strict exclusions honored:** No production deploy · no production migrations · no production assignment mutations · `WEEKLY_ROTATION_AUTO_PUBLISH = false` · SPECIALTY-OPS-001 paused · no capacity redistribution · SEC-OPS-010 preserved.

---

## 1. Root cause addressed

AUTO-001 proved W42’s **8 owned / 3 unowned** came from **flat stage concentration** (5 bays in Nate’s CSA vs Nate’s cap of 2) combined with **strict section ownership** (no cross-section fill).

AUTO-002 fixes the engine so staging selects **per-associate, inside owned Operational Sections, up to remaining approved capacity**. When eligible bays exist for every steward, a full **11** can be staged and later owned without inventing cross-section assignments.

---

## 2. Exact files changed

| Path | Change |
|------|--------|
| `lib/store-ops/section-balanced-stage.ts` | **New** — pure section-balanced stage selection + W42 gap explainer |
| `lib/store-ops/authoritative-week-cycle.ts` | **New** — stage context loader, shared stewardship assign composer, `WEEKLY_ROTATION_AUTO_PUBLISH = false` |
| `lib/store-ops/rotations.ts` | `finishGenerate` prefers section-balanced when capacity + sections exist; flat fallback retained |
| `lib/store-ops/sunday-dispatch.ts` | Retires flat assign; stewardship publish path; cron returns `STAGED_AWAITING_ASSIGN` while auto-publish OFF |
| `lib/store-ops/rotation-auto-002.section-balanced.test.ts` | **New** — W42 / balanced / shortfall / edit-safe / contracts |
| `lib/store-ops/engine-prod-002.sunday-dispatch.test.ts` | Contracts updated for stewardship path |
| `lib/store-ops/bay-unit-002.physical-bay.test.ts` | Allows section-balanced preference beside flat fallback |
| `docs/product/DEPTSYNC_ROTATION_AUTO_002_IMPLEMENTATION.md` | This report |

---

## 3. Selection algorithm

### Stage (`selectSectionBalancedPhysicalBayCoverage`)

For each eligible associate (deterministic specialist-id order):

1. Resolve remaining approved capacity (0–3).  
2. Filter owed eligible bays to those whose Operational Section `primary_owner_specialist_id` matches.  
3. Within that pool, reuse `selectPhysicalBayCoverage` priority order: carry → seasonal High → manual High → velocity/aging.  
4. Select at most remaining capacity.  
5. Never take a bay from another associate’s section.  
6. Emit explicit shortfalls: `no_section` | `insufficient_eligible_bays` | (capacity zero omitted from noise).

### Assign (when publish enabled later)

`composeAuthoritativeAssignmentProposal` → `composeStewardshipWeeklyProposal` → strict section ownership → capacity RPC. Same composer as Sunday **Assign this week**.

---

## 4. Manual / scheduled path alignment

| Step | Manual | Scheduled (cron) |
|------|--------|------------------|
| Stage | `POST /api/rotations/generate` → `generateWeeklyRotations` → section-balanced when context ready | Same generate path inside `dispatchWeeklyPlanForDepartment` |
| Assign planner | `composeStewardshipWeeklyProposal` (Sunday UI) | `composeAuthoritativeAssignmentProposal` (wraps same composer) |
| Persist ownership | `applySundayAssignmentPlan` / capacity RPC | Same admin writer **only if** `WEEKLY_ROTATION_AUTO_PUBLISH` |
| Today’s cron result | — | **`STAGED_AWAITING_ASSIGN`** (ok) — stage only; Assign this week still required |

Competing flat assign (`planFlatBayAssignmentsWithCaps`) removed from sunday-dispatch.

---

## 5. Assignment persistence behavior

- Ownership writes still go through `upsert_sunday_bay_assignments_with_capacity` + OPERATIONAL-011 section ownership RPC.  
- Cron **does not** write ownership while `WEEKLY_ROTATION_AUTO_PUBLISH === false`.  
- Manual Assign this week unchanged (human confirm).  
- Capacity values **not** modified (still operator-approved 11 for W42).

---

## 6. Retry / idempotency guarantees

| Guarantee | Behavior |
|-----------|----------|
| One effective stage set per week | `skipIfExists` / already-staged skip (unchanged) |
| No duplicate ownership overwrite on retry | Proposal skips `ownedRotationIds`; cron fill-unowned only when publish enabled |
| No cross-section assignments | Stage + assign both section-bound |
| No capacity overflow | Capacity RPC + remaining caps |
| Interrupted run | Reload rotations/assignments; fill only unowned when publish enabled |
| Explicit failure | Shortfall reasons on stage; `PARTIAL` / `STAGED_AWAITING_ASSIGN` statuses |

---

## 7. Supervisor edit preservation

| Scenario | Behavior |
|----------|----------|
| Owned bay already assigned | Authoritative proposal skips those rotation ids |
| Cron re-run with auto-publish OFF | Stages only if empty; never rewrites owners |
| Force Draw (Master) | Still explicit destructive restage of incomplete rows (existing) |
| Completed / verified history | Untouched (`superseded_at` / complete paths unchanged) |

**Unresolved (document only):** no separate `plan_finalized_at` supervisor lock yet — retries rely on owned-row preservation. Optional for a later tranche.

---

## 8. Remaining automation blockers

1. **`WEEKLY_ROTATION_AUTO_PUBLISH` must stay false** until operator authorizes enablement + phone acceptance.  
2. Approvals must exist **before** a Sunday publish run (W42 approvals landed after typical cron window).  
3. Section-balanced stage requires **enough owed eligible bays per section** — shortfalls are reported, not fabricated.  
4. Store `sunday_auto_generate` may be true, but product auto-publish remains the new hard-off constant.  
5. SPECIALTY-OPS-001 remains paused (orthogonal).

---

## 9. Database implications

| Item | Status |
|------|--------|
| New migration | **None** |
| Schema change | **None** |
| Production SQL | **Not applied** |
| Capacity / section / assignment rows | **Not mutated by this tranche** |

---

## 10. Test results

```bash
npx vitest run \
  lib/store-ops/rotation-auto-002.section-balanced.test.ts \
  lib/store-ops/engine-prod-002.sunday-dispatch.test.ts \
  lib/store-ops/bay-unit-002.physical-bay.test.ts \
  lib/store-ops/stewardship-week-distribution.test.ts \
  lib/store-ops/section-ownership-enforcement.test.ts \
  lib/store-ops/shared-week-capacity.test.ts \
  lib/store-ops/sec-ops-010.authz.test.ts
# 7 files / 135 PASS

npx tsc --noEmit                 # PASS
npx eslint <touched sources>     # PASS (0 errors; pre-existing unused Department warning in rotations.ts)
npm run build                    # PASS
```

Covered cases: W42 8/11 gap reproduction; balanced full-11 fill; insufficient candidates; no_section; showroom exclusion; edit-safe owned skip; missing approvals; auto-publish hard-off; manual/scheduled source contracts; SEC-OPS-010 regressions.

---

## 11. Production GO / NO-GO

| Decision | Verdict |
|----------|---------|
| Local implementation complete | **GO** |
| Production deploy | **NO-GO** |
| Enable `WEEKLY_ROTATION_AUTO_PUBLISH` | **NO-GO** |
| Production migrations / assignment mutations | **NO-GO** |
| Capacity change to 12 | **NO-GO** |
| Later enablement tranche after phone acceptance | **CONDITIONAL GO** |

**STOP AFTER IMPLEMENTATION.** Do not deploy. Do not enable automatic publication. Do not mutate production assignments.
