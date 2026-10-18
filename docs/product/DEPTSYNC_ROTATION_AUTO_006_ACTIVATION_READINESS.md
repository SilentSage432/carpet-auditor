# DEPTSYNC-ROTATION-AUTO-006 — Controlled Automatic Weekly Publication Activation Readiness

**Status:** READINESS + ACTIVATION ENGINEERING COMPLETE — latch-OFF engineering **deployed via AUTO-007** · **auto-publish still OFF** · no migrate · no production assignment writes in this tranche  
**Date:** 2026-10-17 (engineering); deploy recorded 2026-10-18 in AUTO-007  
**Mode:** Production readiness + activation engineering  
**Application (reference):** https://deptsync-hub.vercel.app  
**Store:** 2587 · Flooring / Home Decor · capacity **Tyson 3 / Nate 3 / Nick 3 / Tracy 3 = 12**  

**Authority:** AUTO-004 readiness · AUTO-005 / 005A / 005B shipped foundation · this tranche · production latch-OFF deploy [`DEPTSYNC_ROTATION_AUTO_007_RELEASE.md`](DEPTSYNC_ROTATION_AUTO_007_RELEASE.md)  

**Strict exclusions honored:** Automatic publication **NOT ENABLED** · product latch remains `false` · Production env publish gate not set for enablement · no migrations · no assignment writes · no Assign This Week / Force Draw / manual cron trigger · no specialty · no Orient.

---

## 1. Executive summary

Floor Command already has a coherent **Sunday stage → stewardship compose → capacity/ownership RPC → This Week → manual Zebra** path. After AUTO-005B, eligibility is shift-independent and production capacity for **2026-W43** is **12**. Automatic ownership persistence is still correctly blocked by the dual-gate latch (`WEEKLY_ROTATION_AUTO_PUBLISH = false`).

This tranche validated activation safety, closed a **year-round Denver cron window** gap (Hobby cron moved **11:00 → 12:00 UTC** locally — **not deployed**), added operator observability (`auto_publish_enabled` on dispatch results), and proved **3/3/3/3 = 12** under zero / partial / complete shifts with protected-id and shortfall fail-closed behavior.

| Decision | Verdict |
|----------|---------|
| Activation readiness review | **GO** |
| Controlled dual-gate enablement (future authorized tranche) | **CONDITIONAL GO** |
| Enable automatic publication **now** | **NO-GO** |
| Latch-OFF engineering deploy | **DONE via AUTO-007** (`20dcc5f`) |
| Migrate / mutate assignments / enable gates | **NO-GO** |
| Specialty / Orient | **NO-GO** |

**Bottom line:** AUTO-006 engineering (cron 12:00 UTC + observability) is on production latch-OFF via AUTO-007. Do not flip either publish gate until (1) phone acceptance of auto-publish behavior is recorded, (2) first Sunday targets a future week with fresh W43-style approvals, (3) dedicated latch+env enablement commit is authorized. Manual Assign this week remains required until then.

---

## 2. End-to-end execution trace

```text
Vercel Cron  (vercel.json: 0 12 * * 0  — Sunday 12:00 UTC)   [production via AUTO-007]
    ↓  GET /api/cron/weekly-rotation
    ↓  authorizeCron: Authorization Bearer CRON_SECRET only
    ↓  (no request body / query publish elevation)
    ↓
runWeeklyRotationForAllDepartments(now)
    ↓
evaluateSundayAutoRun(store settings, now)
    ├─ sunday_auto_generate must be true
    ├─ local weekday must be Sunday in store timezone
    ├─ local clock ≥ effective stage time (default 05:00;
    │    late configured times open via cron-compatible fallback)
    └─ weekLabel = sundayStagingWeekLabel(now, timezone)
           Sunday local → upcoming Monday ISO week
           Mon–Sat local → that day's ISO week (cron skips non-Sunday)
    ↓
For each active department:
  dispatchWeeklyPlanForDepartment(weekLabel, …)
    ↓
  Section-balanced stage (generateWeeklyRotations / finishGenerate
    when approvals + Operational Sections present)
    ↓
  Load sunday_bay_assignments → collectProtectedRotationIds
    (owned | supervisor_locked | completed | verified*)
    ↓
  resolveWeeklyRotationAutoPublishEnabled()
    ├─ false (today) → STAGED_AWAITING_ASSIGN
    │    created_assignments = 0
    │    auto_publish_enabled = false
    │    Manual Assign this week still required
    └─ true (future activation) →
         composeAuthoritativeAssignmentProposal (stewardship)
         → filterProposalAwayFromProtected
         → filterPlanItemsToCapacity
         → applySundayAssignmentPlanAdmin
              → upsert_sunday_bay_assignments_with_capacity
                 (pg_advisory_xact_lock + OPERATIONAL-011 ownership)
         → clearSupervisorLocksForPublishedBays (new fills only)
         → publication_summary + loads
         → COMPLETE | PARTIAL | INSUFFICIENT_BAYS | ALREADY_COMPLETE
    ↓
Supervisor-visible This Week / Sunday surfaces (owned rows)
    ↓
Manual Zebra handoff (zebra_entered_at null → outstanding; no auto API)
```

| Transition | Confirmed |
|------------|-----------|
| Scheduler → local Sunday gate | **Yes** (`evaluateSundayAutoRun`) |
| Gate → next-Monday week on Sunday | **Yes** (`sundayStagingWeekLabel`) |
| Stage → section-balanced when context ready | **Yes** |
| Publish → stewardship composer (not flat) | **Yes** |
| Persist → capacity + ownership RPC only | **Yes** |
| Manual approval click required while latch OFF | **Yes** (`STAGED_AWAITING_ASSIGN`) |
| Manual approval click required when both gates ON | **No** — cron persists ownership |
| Supervisor manual assign remains separate | **Yes** (Sunday UI + lock stamp) |

**Remaining manual dependency today:** dual-gate OFF → operator must still click **Assign this week** after cron stages. That is intentional until activation.

---

## 3. Activation gate findings

| Gate | Default | Behavior |
|------|---------|----------|
| Product latch `WEEKLY_ROTATION_AUTO_PUBLISH` | **`false`** in source | Hard OFF until enablement commit |
| Env `DEPTSYNC_WEEKLY_ROTATION_AUTO_PUBLISH` | unset / not `1` | Ignored while latch false; required `=1` after latch true |
| Dual-gate | Both required | Latch true **and** env `1` |
| Env alone | Cannot activate | **Verified (tests)** |
| Cron body/query | Cannot elevate | **Verified (route + tests)** |
| Test `override: true` | Harness only | Not reachable from HTTP cron |
| Supervisor manual assign | Separate SEC-OPS-010 path | Unchanged |

### Exact activation steps (DO NOT EXECUTE IN THIS TRANCHE)

1. Deploy AUTO-006 engineering with latch still **`false`** (cron 12:00 UTC + `auto_publish_enabled` field).  
2. Confirm Production cron schedule reflects `0 12 * * 0`.  
3. Confirm W43 (or chosen first week) capacity approvals **3/3/3/3 = 12** and fingerprints fresh.  
4. Dedicated enablement commit: set `WEEKLY_ROTATION_AUTO_PUBLISH = true`.  
5. Set Production env `DEPTSYNC_WEEKLY_ROTATION_AUTO_PUBLISH=1`.  
6. Deploy enablement revision.  
7. First eligible Sunday after deploy: observe `COMPLETE` / honest `PARTIAL`, not `STAGED_AWAITING_ASSIGN`.

**Deployment implication of the code latch:** flipping the latch **requires a new application deployment**. Env alone is insufficient and, while latch is false, ignored.

---

## 4. Target-week correctness

| Instant (America/Denver) | Expected week | Result |
|--------------------------|---------------|--------|
| Saturday before Sunday (2026-10-17) | **2026-W42** | **PASS** |
| Sunday before cron | **2026-W43** | **PASS** |
| Sunday at 12:00 UTC cron | **2026-W43** + gate open | **PASS** |
| Sunday after cron | **2026-W43** | **PASS** |
| Monday following | **2026-W43**; gate closed (not Sunday) | **PASS** |
| Month-boundary Sunday | next Monday ISO week | **PASS** |
| Year-boundary Sundays | 2026-W53 / 2027-W01 | **PASS** |
| DST spring-forward Sunday 12:00 UTC | open + next week | **PASS** |
| DST fall-back Sunday 12:00 UTC | open (05:00 MST) | **PASS** |
| DST fall-back at legacy 11:00 UTC | **skipped** (04:00 MST) | **PASS** (documents why cron moved) |
| UTC day ≠ local day | uses zoned parts | **PASS** |

**Scheduler configuration (authoritative in repo / production via AUTO-007):** `vercel.json` → `"0 12 * * 0"`.

**Earliest safe activation window (do not invent):**  
After an authorized enablement deploy lands **before** the next Sunday **12:00 UTC** cron hit, and that Sunday’s `sundayStagingWeekLabel` is the intended first automatic week. With store timezone America/Denver and current calendar (2026-10-17), the next Sunday is **2026-10-18**, targeting **2026-W43**. Activation is **not** authorized this tranche — so that Sunday remains stage-only unless a later enablement completes in time.

---

## 5. Existing-week protections

| Situation | Automatic publication behavior |
|-----------|--------------------------------|
| Week already assigned manually | Protected ids → skip owned; `ALREADY_COMPLETE` / no rewrite |
| Week partially assigned | Fill **only** non-protected unowned staged bays |
| Week automatically assigned | Retry → skip complete / fill remaining only |
| Supervisor-edited week | `supervisor_locked` protected |
| Completed / verified | Protected statuses |
| Locked clear (held empty) | Protected; not refilled |
| Retry after partial failure | Reload state; fill remaining fillable; no destructive redraw |
| Impossible safe continuation | `PARTIAL` / `ok: false` with reason — fail closed |

Automatic publication **never** silently replaces protected ownership. No duplicate invent fills; shortfalls are explicit.

---

## 6. Concurrency and retry evidence

| Concern | Evidence |
|---------|----------|
| Repeated cron | `planIsComplete` / `ALREADY_COMPLETE`; protected-id fill-only |
| Concurrent cron | Capacity RPC `pg_advisory_xact_lock` in OPERATIONAL-011 migration — **transactional DB**, not in-memory |
| Network / DB timeout | Fail returns `ERROR` / `PARTIAL`; retry fills remaining |
| Retry after success | Skip complete; no destructive rewrite |
| Retry after supervisor edits | Locked / owned skipped |
| In-memory-only concurrency | **NO-GO if that were the case** — **not the case** here |

---

## 7. Assignment simulation results

Isolated fixtures (sufficient in-section eligible bays; no invented cross-section fills):

| Scenario | Outcome |
|----------|---------|
| Zero shift rows | **Tyson 3 / Nate 3 / Nick 3 / Tracy 3 = 12** |
| Partial shift rows | **Same 12** |
| Complete shift rows | **Same 12** |
| Existing protected (Tyson owned) | Nate/Nick/Tracy **3 each**; Tyson **0** new |
| Insufficient eligible bays | Assigns available only (≤2); no invent |
| Missing section ownership | **0** items |
| Empty primary owner | **0** items (fail closed) |

---

## 8. Zebra handoff visibility

| Requirement | Status |
|-------------|--------|
| Published owned bays without `zebra_entered_at` → handoff required | **Yes** |
| Per-bay status / entered timestamp / entered-by | **Preserved** (ZEBRA-HANDOFF-002) |
| No automatic Zebra completion claim | **Yes** |
| No Zebra API / Orient | **Out of scope** |

---

## 9. Operational observability

Operator can determine from cron JSON / dispatch rows:

| Question | Field / signal |
|----------|----------------|
| Target week | `assigned_week` / `evaluated_at` |
| Publication attempted? | `auto_publish_enabled` (**new**) + status ≠ staging-only |
| Succeeded? | `status=COMPLETE` + `ok=true` |
| Staged only? | `STAGED_AWAITING_ASSIGN` + `created_assignments=0` + `auto_publish_enabled=false` |
| How many persisted? | `created_assignments`, `owned_count` |
| Who received work? | `loads[]` |
| Shortfall? | `PARTIAL` / `INSUFFICIENT_BAYS` + `reason` / `publication_summary` |
| Error? | `status=ERROR` or `ok=false` + `reason` |

Staging alone is **not** reported as successful publication. Partial persistence returns `PARTIAL` with `ok: false`.

---

## 10. Exact activation procedure (runbook)

### A. Preconditions

- AUTO-005B (or later) on production with shift-independent eligibility  
- `supervisor_locked` column live (AUTO-005 migrate)  
- Operational Sections **4×160** intact  
- Target-week capacity approvals **3/3/3/3 = 12** with non-stale fingerprints  
- Phone acceptance of section-balanced + edit-safe auto-publish  
- AUTO-006 engineering (cron 12:00 UTC + observability) deployed with latch still **false**

### B. Production baseline (read-only)

Capture SBA counts/fingerprint, locks, W43 caps, sections, latch/env, cron schedule.

### C. Activation gates

1. Commit: `WEEKLY_ROTATION_AUTO_PUBLISH = true`  
2. Vercel Production env: `DEPTSYNC_WEEKLY_ROTATION_AUTO_PUBLISH=1`  
3. Deploy enablement revision  

### D. Scheduler verification

- Production cron = `0 12 * * 0`  
- Store timezone America/Denver; `sunday_auto_generate=true`  
- Confirm next Sunday local gate opens at/after 05:00  

### E. First eligible Sunday

- After enablement deploy is Ready on the production alias  
- Prefer a Sunday whose staging week is still **future** relative to in-flight work  

### F. Expected target week

- Sunday local → upcoming Monday ISO week via `sundayStagingWeekLabel`  
- Example (calendar-dependent): Sunday 2026-10-18 → **2026-W43**  

### G. Post-publication verification

- Cron result `COMPLETE` or honest `PARTIAL`  
- `auto_publish_enabled=true`  
- Owned counts vs shared 12  
- No cross-section owners  
- Fingerprint/history not rewritten for protected rows  

### H. Supervisor edit verification

- Edit/clear stamps lock; second cron does not overwrite  

### I. Zebra handoff verification

- Outstanding handoff > 0 until manual entry; no auto claim  

### J. Emergency disable

1. Set env `DEPTSYNC_WEEKLY_ROTATION_AUTO_PUBLISH` ≠ `1` (immediate)  
2. Redeploy latch `false` (durable)  
3. Do not bulk-delete assignments  

### K. Recovery after partial failure

- Inspect `reason` / `publication_summary`  
- Fix capacity / section / bay eligibility  
- Re-run trusted cron or manual Assign this week for remaining fillable unowned only  

---

## 11. Rollback procedure

| Layer | Action |
|-------|--------|
| Env gate | Remove / set ≠ `1` — disables publish when latch true |
| Code latch | Redeploy revision with `WEEKLY_ROTATION_AUTO_PUBLISH = false` |
| Cron schedule | Revert `vercel.json` only if winter window regresses; prefer keep 12:00 UTC |
| Assignments | Supervisor edit / Master Force Draw — no automated wipe |
| Migrations | None required for this activation tranche |

**Incident order:** disable env → confirm latch false in deployed code → then consider further recovery.

---

## 12. Remaining blockers

1. **Gates still OFF** — intentional; activation not authorized.  
2. **Phone acceptance** of fully automatic Sunday publish.  
3. **Approvals timing** — fingerprints must be fresh before cron.  
4. **Pacific winter residual** — 12:00 UTC is year-round safe for America/Denver; `America/Los_Angeles` PST would still see 04:00 local (document if multi-TZ expands).  
5. **AUTO-004 residual** — `planIsComplete` naming vs approved shared target edge cases remain low severity when capacity is already 12.

---

## 13. GO / CONDITIONAL GO / NO-GO

| Decision | Verdict |
|----------|---------|
| AUTO-006 readiness + activation engineering | **GO** |
| Dual-gate enablement when preconditions met | **CONDITIONAL GO** |
| Enable automatic publication in this tranche | **NO-GO** |
| Latch-OFF engineering deploy | **DONE via AUTO-007** |
| Migrate / assignment writes / enable gates | **NO-GO** |
| Specialty / Orient | **NO-GO** |

### Validation (this pass)

| Check | Result |
|-------|--------|
| AUTO-006 activation-readiness | **27 PASS** |
| AUTO-002 / 003 / 005A + rotation / ownership / stewardship / SEC-OPS-010 | Included |
| **Suite total** | **10 files / 180 PASS** |
| `npx tsc --noEmit` | **PASS** |
| ESLint (touched sources) | **PASS** (0 errors) |
| `npm run build` | **PASS** |
| Product latch | **`false`** |

### Engineering (deployed latch-OFF via AUTO-007)

| Change | Purpose |
|--------|---------|
| `vercel.json` cron `0 11` → `0 12 * * 0` | Denver MST winter no longer skips 05:00 gate |
| `SundayDispatchResult.auto_publish_enabled` | Honest staging vs publish observability |
| `rotation-auto-006.activation-readiness.test.ts` | Boundary / protection / simulation / contracts |

**Enablement remains NO-GO.** See [`DEPTSYNC_ROTATION_AUTO_007_RELEASE.md`](DEPTSYNC_ROTATION_AUTO_007_RELEASE.md). Do not migrate. Do not enable automatic publication. Do not modify production assignments. Do not begin specialty or Orient work.
