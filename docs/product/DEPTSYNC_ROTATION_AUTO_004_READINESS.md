# DEPTSYNC-ROTATION-AUTO-004 — Automatic Weekly Assignment Production Readiness

**Status:** READINESS REVIEW COMPLETE — **no deploy · no migrate · no auto-publish enable · no production assignment writes**  
**Date:** 2026-10-16  
**Mode:** Evidence-based validation and release planning  
**Authority:** AUTO-001 discovery · AUTO-002 engine · AUTO-003 publication/edit safety  
**Store context:** 2587 · merged Flooring / Home Decor · capacity **Tyson 3 / Nate 2 / Nick 3 / Tracy 3 = 11** (unchanged)

**Legend**

| Tag | Meaning |
|-----|---------|
| **VERIFIED (code)** | Confirmed in repository source |
| **VERIFIED (tests)** | Confirmed by focused vitest this pass |
| **VERIFIED (fixture)** | Confirmed on disposable local Postgres harness |
| **DOCUMENTED** | Prior product docs; not re-proven against production this pass |
| **DIVERGENCE** | Remaining intentional or residual gap |

---

## 1. Executive summary

AUTO-002 and AUTO-003 form **one coherent Stage → stewardship Assign → capacity RPC** path. With enough per-section eligible bays, representative simulation reaches the authoritative **11** fill (3/2/3/3). Supervisor locks, protected-id retries, dual-gate activation, cron CRON_SECRET-only authority, and Zebra-outstanding visibility are implemented and tested.

**Automatic publication is correctly hard-off today** (`WEEKLY_ROTATION_AUTO_PUBLISH = false`; env ignored while latch false). Production remains on manual **Assign this week** after cron stage (`STAGED_AWAITING_ASSIGN`).

| Decision | Verdict |
|----------|---------|
| Code path ready for a **controlled** production release sequence | **CONDITIONAL GO** |
| Enable automatic publication now | **NO-GO** |
| Apply supervisor_lock migration to production now | **NO-GO** (prepared + fixture-validated only) |
| Deploy / mutate production assignments this tranche | **NO-GO** |
| Capacity change to 12 | **NO-GO** (document only; operator chooses who gains +1) |
| Prefer first auto-publish Sunday for a **future** week | **GO** (recommended) |

**Bottom line:** Ship the app + migration under latch OFF first; activate dual gates only after phone acceptance, capacity approvals timing is settled, and the first publish Sunday targets a future operational week. Do not activate against an in-flight week with existing supervisor edits unless an explicit recovery plan is authorized.

---

## 2. Implementation reconciliation

### 2.1 Coherent execution path (**VERIFIED code**)

```text
Manual Stage
  POST /api/rotations/generate
    → generateWeeklyRotations → finishGenerate
         → loadAuthoritativeStageContext (approvals + sections)
         → selectSectionBalancedPhysicalBayCoverage   [AUTO-002]
         → weekly_rotations (flat fallback if context missing)

Manual Assign this week
  SundayAuditAssignmentModal
    → composeStewardshipWeeklyProposal
    → capacity RPC + OPERATIONAL-011 ownership
    → stampSupervisorAssignmentLock (edit/clear)   [AUTO-003]

Sunday cron (Vercel 0 11 * * 0)
  GET /api/cron/weekly-rotation  (CRON_SECRET Bearer only)
    → runWeeklyRotationForAllDepartments
    → evaluateSundayAutoRun (store schedule gate)
    → dispatchWeeklyPlanForDepartment
         → same section-balanced stage generate path
         → collectProtectedRotationIds (owned | locked | completed/verified)
         → resolveWeeklyRotationAutoPublishEnabled()
              false → STAGED_AWAITING_ASSIGN (today)
              true  → composeAuthoritativeAssignmentProposal
                      → filterProposalAwayFromProtected
                      → filterPlanItemsToCapacity
                      → applySundayAssignmentPlanAdmin (capacity RPC)
                      → clearSupervisorLocksForPublishedBays (new fills only)
                      → publication_summary (Zebra outstanding, no claims)
```

| Surface | AUTO-002 | AUTO-003 | Unified? |
|---------|----------|----------|----------|
| Section-balanced staging | Yes | Consumes | **Yes** |
| Sunday scheduler | Stage via generate | Publish gated | **Yes** |
| Manual assignment | Stewardship | Lock stamp + lock-aware skip | **Yes** |
| Automatic publication | Hard-off latch | Dual-gate resolver | **Yes** (OFF) |
| Stewardship composer | `composeAuthoritativeAssignmentProposal` wraps UI composer | Same | **Yes** |
| Authoritative assignment RPC | Capacity + ownership | Unchanged signature | **Yes** |
| Supervisor lock protection | Owned-skip only | `supervisor_locked` + protected set | **Yes** |
| Assignment history | `superseded_at` stage history | Untouched by lock column | **Yes** |
| Retry behavior | Fill unowned when publish ON | Skip protected/locked/cleared-hold | **Yes** |

### 2.2 Remaining divergence

| Item | Severity | Notes |
|------|----------|-------|
| Latch OFF → cron does not persist ownership | **Intentional** | Manual Assign this week still required until activation |
| `planIsComplete` early-skip uses natural `eligible × 3` (**12**) not approved shared (**11**) | **Low / residual** | Fully owned 11/11 week reports `INSUFFICIENT_BAYS` (skipped) rather than `ALREADY_COMPLETE`. Safe (no rewrite); status naming not aligned with approved capacity |
| Post-publish “perfect” check still expects every owner at base quota 3 | **Low / residual** | Nate@2 path correctly falls through to shared-capacity `COMPLETE` when `owned_total >= shared_target` |
| Migration not applied in production | **Blocker for lock durability** | Code fail-opens (edits work; locks skipped until migrate) |
| Approvals must exist before Sunday publish window | **Operational** | Unchanged from AUTO-001; W42 approvals landed after typical cron |
| Capacity 11 vs operator mental model 12 | **Expectation** | Authoritative target remains 11; no code change |

Flat assign (`planFlatBayAssignmentsWithCaps`) remains **retired** from sunday-dispatch (**VERIFIED code**).

---

## 3. Migration validation

**File:** `supabase/migrations/20261021_rotation_auto_003_supervisor_lock.sql`  
**Harness:** `scripts/sql/rotation-auto-003-supervisor-lock-local-validation-harness.sql`

| Check | Result |
|-------|--------|
| Additive `boolean not null default false` | **PASS** (SQL + fixture) |
| Existing seeded assignments remain valid | **PASS** (fixture) |
| Existing completed row preserved unlocked | **PASS** (fixture) |
| Defaults safely unlocked for all pre-migration rows | **PASS** (fixture) |
| Store isolation (2587 vs 9999) | **PASS** (fixture) |
| Lock stamp is store+week+bay scoped | **PASS** (fixture) |
| Ownership rewrite that omits `supervisor_locked` preserves lock | **PASS** (fixture; matches capacity RPC `ON CONFLICT DO UPDATE` column list) |
| RPC signature unchanged | **PASS** (code review of `upsert_sunday_bay_assignments_with_capacity` — no signature change required) |
| Production apply | **NOT DONE** (forbidden this tranche) |

**Rollback / recovery (local + planned prod):**

```sql
drop index if exists public.sunday_bay_assignments_supervisor_locked_idx;
alter table public.sunday_bay_assignments drop column if exists supervisor_locked;
```

App behavior after rollback: stamp/clear/select fail-open on missing column; edits continue; auto-publish (if somehow enabled) loses cleared-hold protection — therefore **never enable publish without this column live**.

**Fixture run (2026-10-16):** disposable local DB `auto004_supervisor_lock_validate` → harness **PASS** → database dropped. Docker daemon unavailable; local Postgres used. **No production connection.**

---

## 4. Capacity findings

| Associate | Authoritative approved capacity |
|-----------|--------------------------------:|
| Tyson | **3** |
| Nate | **2** |
| Nick | **3** |
| Tracy | **3** |
| **Total** | **11** |

**VERIFIED (tests + prior prod read-only AUTO-001):** configuration remains **3/2/3/3 = 11**. This tranche **did not change** capacity.

Operator previously expected **12** (legacy natural `4 × 3`). That is **not** the approved shared target.

### Exact configuration change required for 12 (document only — do not apply)

Shared target becomes 12 only when MasterAdmin re-approves store-week capacity so that **one** associate’s `approved_capacity` increases by **+1**, subject to hard ceiling `MAX_APPROVED_WEEKLY_BAY_CAPACITY = 3`.

| Option | Change | New sum |
|--------|--------|--------:|
| A | Nate **2 → 3** | **12** |
| B | *(impossible without exceeding ceiling)* raise someone already at 3 | — |

**Only feasible +1 under the current ceiling is Nate 2 → 3** (everyone else is already at 3). This readiness review **does not choose** that change; MasterAdmin must approve via existing `/api/week-capacity` for the target week. Section-balanced stage would then request 3 for Nate when eligible CSA bays exist.

---

## 5. Assignment simulation results

| Scenario | Result | Evidence |
|----------|--------|----------|
| W42 flat-stage gap reproduction (8/11) | **PASS** — achievable 8, unownable 3 | AUTO-002 test |
| Balanced stage fills 11 when candidates exist | **PASS** — 3/2/3/3 per section | AUTO-002 test |
| Full stewardship proposal of 11 | **PASS** — actionable 11 items | AUTO-003 test |
| Capacity respected | **PASS** | Stage slots + capacity RPC + tests |
| Shortfalls explicit (`insufficient_eligible_bays`, `no_section`) | **PASS** | AUTO-002/003 tests |
| No cross-section stage/assign | **PASS** | AUTO-002 + ownership RPC |
| No duplicate overwrite of owned | **PASS** — protected ids skipped | AUTO-002/003 tests |
| Priority order preserved inside section pools | **PASS** — reuses `selectPhysicalBayCoverage` | AUTO-002 code |
| Showroom exclusion | **PASS** | AUTO-002 test |

**Regression coverage for previous 8/11 shortfall:** present and passing (`explainFlatStageOwnershipGap` + balanced fill contrast).

---

## 6. Publication safety

| Control | Status |
|---------|--------|
| Production activation requires deliberate authorization | **PASS** — dual gate |
| Product latch `WEEKLY_ROTATION_AUTO_PUBLISH = false` | **PASS** (code + tests) |
| Env `DEPTSYNC_WEEKLY_ROTATION_AUTO_PUBLISH=1` ignored while latch false | **PASS** (tests) |
| Cron cannot elevate via query/body | **PASS** — route has no `request.json` / `publishAssignments`; tests assert |
| Publish uses authoritative stewardship path | **PASS** |
| Repeated execution idempotent | **PASS** — skip complete / fill non-protected unowned only |
| Concurrent execution | **PASS** (contract) — capacity RPC advisory lock |
| Partial failure recoverable | **PASS** (design + code) — reload; fill remaining fillable |
| Auto-publish **not activated** this review | **Honored** |

---

## 7. Supervisor edit safety

| Capability | Status |
|------------|--------|
| Replace assigned bay | Stamp lock after capacity RPC write |
| Remove / clear where permitted | Stamp lock; held-clear protected from refill |
| Select another eligible bay | Sunday drawer + stewardship; locked ids skipped |
| Section ownership | OPERATIONAL-011 RPC |
| Weekly capacity | Capacity RPC |
| Completed / verified evidence | Protected statuses |
| Edit → cron retry | Protected; not overwritten |
| Locked → retry | Protected |
| Completed / verified → retry | Protected |
| Interrupted publication → retry | Reload; fill only remaining fillable unowned |

**No automatic execution may silently undo an intentional supervisor edit** — enforced when migration is live + publish enabled. Pre-migrate: owned-row preservation still applies; cleared-hold protection soft until column exists.

---

## 8. Security findings (SEC-OPS-010)

| Control | Preserved? |
|---------|------------|
| Trusted scheduler identity (`CRON_SECRET` Bearer) | **Yes** |
| Store scoping on writers | **Yes** |
| Department scoping | **Yes** |
| Section ownership at RPC | **Yes** |
| Capacity enforcement at RPC | **Yes** |
| Supervisor-only edit authority (associates do not assign) | **Yes** |
| MasterAdmin protection / capacity approve | **Yes** |
| No unrestricted service-role mutation path | **Yes** — cron still uses capacity RPC writers only |
| SEC-OPS-010 authz regressions | **20 PASS** this suite |

PIN-only auth (AUTH-006) untouched. No client-trusted publish elevation.

---

## 9. Zebra handoff verification

| Requirement | Status |
|-------------|--------|
| Published assignments identifiable as needing manual Zebra entry | **Yes** — `zebra_entered_at IS NULL` → visibility `zebra_handoff_required` |
| Manual per-bay Zebra handoff | **Preserved** (ZEBRA-HANDOFF-002 API/UI) |
| Handoff actor attribution | **Preserved** (`zebra_entered_by`) |
| Handoff timestamp | **Preserved** (`zebra_entered_at`) |
| No false Zebra completion claims | **Yes** — publication path never sets Zebra fields; visibility counts outstanding only |
| Orient integration | **Out of scope** (not built) |

Zebra handoff regressions: **14 PASS** this suite.

---

## 10. Production release sequence

**Do not execute this sequence in the AUTO-004 tranche.** Planning only.

### Phase A — Prerequisites (safe, latch OFF)

1. Phone / field acceptance of AUTO-002 stage balance + AUTO-003 edit-safe publish behavior on staging or controlled local with `publishAssignments` override **only in tests/harness**.
2. Confirm MasterAdmin capacity approvals for the **first target week** (recommend keep **3/2/3/3 = 11** unless operator explicitly raises Nate to 3 for sum 12).
3. Confirm schedules exist **before** Sunday cron so approvals are not stale/missing at gate.
4. Apply migration `20261021_rotation_auto_003_supervisor_lock.sql` to production in an authorized migrate tranche (**after** app code that fail-opens on missing column is already deployed, or deploy app first then migrate — both safe because latch is OFF).
5. Deploy app with `WEEKLY_ROTATION_AUTO_PUBLISH = false` (no env publish flag required yet).
6. Verify one Sunday (or dry observation): cron returns `STAGED_AWAITING_ASSIGN`; no unexpected ownership writes; manual Assign this week still works; supervisor edit stamps lock once migrated.

### Phase B — Activation (future-week preferred)

1. Dedicated enablement commit: flip `WEEKLY_ROTATION_AUTO_PUBLISH` to `true`.
2. Set Production env `DEPTSYNC_WEEKLY_ROTATION_AUTO_PUBLISH=1`.
3. Deploy.
4. **Initial activation timing:** prefer the next Sunday cron after the current operational week is closed. On Sunday local time, `sundayStagingWeekLabel` targets the **upcoming Monday’s ISO week** — so Sunday 2026-10-18 cron stages **W43**, not mid-flight W42. That is the preferred first auto-publish week.
5. **Existing-week protection:** do **not** enable mid-week against a week that already has supervisor edits unless operators accept fill-unowned-only behavior. Owned + locked rows are protected; unowned staged bays **would** receive ownership if publish is ON and cron/harness runs for that week.
6. Confirm `stores.sunday_auto_generate` remains intentional; product latch was the hard-off for ownership writes.
7. Keep Force Draw Master-only; never cron force-overwrite.

### Phase C — Production verification (first auto-publish Sunday)

- Status `COMPLETE` or honest `PARTIAL` with shortfall reasons  
- Owned count vs approved shared target (11 or approved sum)  
- No cross-section owners  
- Supervisor locks preserved on edited/cleared bays  
- Zebra outstanding counts > 0 until manual entry (not auto-claimed)  
- Second cron hit → skip / no destructive rewrite  

### Activation vs current operational week (explicit)

| Question | Answer |
|----------|--------|
| Could activation modify the current operational week? | **Yes, if** publish gates are ON and dispatch runs for that week with fillable unowned staged bays |
| Does normal Sunday cron target the in-flight mid-week plan? | **No** — Sunday gate stages the **next** week label |
| Recommendation | Enable gates only when the next Sunday’s target week is the intended first automatic week; avoid ad-hoc mid-week publish runs against W42-like in-flight weeks |

---

## 11. Rollback strategy

| Layer | Action |
|-------|--------|
| Auto-publish | Set env `DEPTSYNC_WEEKLY_ROTATION_AUTO_PUBLISH` ≠ `1` **and/or** redeploy with latch `false` — either gate alone disables publish while latch false; both false is safest |
| App | Redeploy previous revision with latch false |
| Migration | Drop index + column (see §3); only if publish already disabled |
| Assignments | Do **not** bulk-delete; supervisors edit; Force Draw remains Master recovery |
| Stage | Existing skip-if-exists / supersede Force Draw unchanged |

**Order on incident:** disable env → confirm latch false in code → then consider column rollback if required.

---

## 12. Outstanding operator decisions

| # | Decision | Blocking? |
|---|----------|-----------|
| 1 | Accept **11** as success target, or authorize Nate **2→3** for sum **12**? | Expectation / capacity only |
| 2 | Phone-accept section-balanced stage + edit-safe publish? | **Yes** for activation |
| 3 | Authorize production migrate of `supervisor_locked`? | **Yes** before publish ON |
| 4 | Authorize dual-gate enablement commit + env? | **Yes** for automatic Assign |
| 5 | Approvals must land **before** Sunday cron (vs Monday retry policy)? | Timing risk |
| 6 | First auto-publish week = next Sunday’s future week (recommended)? | Safety |
| 7 | Keep Force Draw Master-only (recommended)? | Safety |
| 8 | SPECIALTY-OPS-001 remains paused? | Scope |

---

## 13. GO / CONDITIONAL GO / NO-GO

| Decision | Verdict |
|----------|---------|
| AUTO-004 readiness review complete | **GO** |
| AUTO-002 + AUTO-003 coherent for controlled release | **CONDITIONAL GO** |
| Production deploy (latch OFF) | **CONDITIONAL GO** after phone acceptance |
| Production migration `supervisor_locked` | **CONDITIONAL GO** after deploy of fail-open app (or same release train); **NO-GO tonight** |
| Enable `WEEKLY_ROTATION_AUTO_PUBLISH` + env | **NO-GO** until Phase B decisions |
| Automatic weekly activation this tranche | **NO-GO** |
| Capacity redistribution / cross-section fill | **NO-GO** |
| Orient / auto Zebra claims | **NO-GO** |
| SPECIALTY-OPS-001 | **Paused** |

### Validation results (exact — 2026-10-16)

| Check | Result |
|-------|--------|
| AUTO-002 focused tests | **13 PASS** (`rotation-auto-002.section-balanced.test.ts`) |
| AUTO-003 focused tests | **17 PASS** (`rotation-auto-003.publication.test.ts`) |
| Rotation / dispatch / bay / stewardship / ownership / capacity | **102 PASS** (engine-prod-002, bay-unit-002, stewardship, section-ownership, shared-week-capacity) |
| Authorization (SEC-OPS-010) | **20 PASS** |
| Zebra handoff | **14 PASS** |
| **Suite total this pass** | **9 files / 166 PASS** |
| TypeScript `npx tsc --noEmit` | **PASS** |
| ESLint (AUTO core sources excl. modal) | **PASS** (0 errors) |
| ESLint `SundayAuditAssignmentModal.tsx` | **1 pre-existing error** (`react-hooks/set-state-in-effect` at reload effect) + unused import warning — not introduced by this readiness review |
| `npm run build` | **PASS** (Next.js 16.2.12) |
| Migration local fixture | **PASS** (disposable DB; dropped) |

---

**STOP AFTER READINESS REVIEW.**  
Do not deploy. Do not migrate production. Do not enable automatic publication. Do not modify production assignments.
