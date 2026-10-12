# DEPTSYNC-ZEBRA-HANDOFF-001 — Assignment Handoff & Verification Discovery

**Status:** COMPLETE (read-only discovery)  
**Date:** 2026-10-11  
**Mode:** Repository + secure read-only production inspection — **no implementation**  
**Store:** 2587  
**Supabase:** `fmeinlwhixngednabhgy`  
**Application:** https://deptsync-hub.vercel.app  

**Not authorized / not performed:** application code changes, schema migrations, production mutations, deploy, commit, push, Zebra API design, AI/automation for handoff.

**Canonical product context:**  
[`DEPTSYNC_REDESIGN_001_COMPLETE_PRODUCT_EXPERIENCE_BLUEPRINT.md`](DEPTSYNC_REDESIGN_001_COMPLETE_PRODUCT_EXPERIENCE_BLUEPRINT.md) ·  
[`DEPTSYNC_SECTION_ROTATION_001_DISCOVERY.md`](DEPTSYNC_SECTION_ROTATION_001_DISCOVERY.md) §11 ·  
[`DEPTSYNC_SECTION_ROTATION_005_CAPACITY_IMPLEMENTATION.md`](DEPTSYNC_SECTION_ROTATION_005_CAPACITY_IMPLEMENTATION.md) ·  
[`DEPTSYNC_SECTION_ROTATION_006_DISTRIBUTION_IMPLEMENTATION.md`](DEPTSYNC_SECTION_ROTATION_006_DISTRIBUTION_IMPLEMENTATION.md) ·  
[`DEPTSYNC_SECTION_ROTATION_007_PRODUCTION_RELEASE.md`](DEPTSYNC_SECTION_ROTATION_007_PRODUCTION_RELEASE.md)

---

## 1. Executive summary

Floor Command already owns a coherent **weekly bay lifecycle** split across two tables:

| Concern | Owner | Evidence |
|---------|--------|----------|
| Planned work | `weekly_rotations` (active stage) | Stage / Force Draw / assign APIs |
| Who owns it | `sunday_bay_assignments` | Capacity-gated RPC writer |
| Work reported / verified | `weekly_rotations.verification_status` + completion attempts | Complete / verify / send-back APIs |
| Operator This Week UI | Floor tab people→bays board | UX-REDUCE-002 / RD-4 |

**Zebra (Lowe’s task system) is intentionally external.** Blueprint §A.1: DeptSync is not a Zebra replacement. Doctrine: *DeptSync manages the rotation; Lowe’s manages the task; the operator validates the work.*

**Critical gap:** there is **no durable evidence** that an assignment has been manually entered into Zebra. Existing “Sunday assignment handoff” / “live handoff” language in `ZebraChecklist` means **live Sunday ownership queue sync**, not external-system confirmation. That checklist is also **no longer the primary Floor composition** (contract-enforced).

**Distinction already enforced in product language (RD-4):**

- **A. Planned** — staged rotation, may be unowned  
- **B. Assigned** — Sunday owner named (≠ work done; ≠ Zebra entered)  
- **C. Completed / reported** — associate or DS completion report  
- **D. Verified** — supervisor/Master verification  

**B vs Zebra entry are currently conflated by absence** — once assigned, the UI has no “entered in Zebra” step. That is the smallest missing operational state for the canonical workflow.

**Verdict for next implementation tranche:** **CONDITIONAL GO** — proceed with a thin orthogonal handoff confirmation on the existing This Week surface after one operator decision on confirmation granularity (per bay vs per associate batch). Do not invent a Zebra integration or a parallel task platform.

---

## 2. Existing assignment lifecycle

### 2.1 Two-table model (do not collapse)

```text
Stage weekly_rotations
        ↓
Assign sunday_bay_assignments  (ownership)
        ↓
[MISSING] Confirm entered in Lowe’s Zebra
        ↓
Complete → PENDING_VERIFICATION (or auto VERIFIED for DS/Master live)
        ↓
Verify / Send back  (supervisor+)
```

### 2.2 `sunday_bay_assignments` — ownership

**Create:** `supabase/migrations/20260812_sunday_bay_assignments.sql`  
**Status CHECK (final):** `pending | assigned | completed | cleared | CARRIED_OVER | PENDING | ASSIGNED | COMPLETED`  
(`20260816_rls_read_write_parity.sql`)

| Column | Role |
|--------|------|
| `bay_id` | **`weekly_rotations.id`** (not `store_locations.id`) |
| `roster_specialist_id` / `specialist_name` | Hub roster ownership |
| `status` | Ownership row state; writers typically use `assigned` / `cleared` |
| `is_carried_over` | Carry flag; live writer normalizes `CARRIED_OVER` → `assigned` + flag |

**Writes:** client INSERT/UPDATE/DELETE revoked; sole path `upsert_sunday_bay_assignments_with_capacity`  
(`20261014_capacity_guard_002_store_week_lock.sql`, superseded by `20261016_section_rotation_005_approved_capacity.sql`).

**What creates ownership**

| Path | Evidence |
|------|----------|
| Sunday Balance Assign / plan apply | `applySundayAssignmentPlan` → capacity RPC (`sunday-audit.ts`) |
| Single bay assign | `setSundayBayAssignment` → `executeSundayAssignLive` |
| Sunday dispatch (admin) | `sunday-dispatch.ts` / `applySundayAssignmentPlanAdmin` |
| Extra bay | `POST /api/rotations/extra-bay` |
| Section-aware / stewardship proposals | Compose proposals only; persist still via same RPC after operator confirm |

**Section-aware auto-stage:** `SECTION_AWARE_ROTATION_AUTO_STAGE = false` (hard off).  
**Note:** production `stores.sunday_auto_generate = true` with `sunday_auto_stage_time = 23:59:00` still describes the **legacy cron stage path**, not section-aware auto-stage. Product releases treat section-aware auto-stage as OFF; do not conflate the two flags.

### 2.3 `weekly_rotations` — work + verification

**Verification CHECK:** `PENDING → PENDING_VERIFICATION → VERIFIED_COMPLETE`  
(`20260818_weekly_rotation_verification.sql`; typed in `lib/store-ops/types.ts`)

| Transition | Mechanism | Result |
|------------|-----------|--------|
| Stage | generate / dispatch / assign locations | `verification_status=PENDING`, `is_completed=false` |
| Complete | `POST /api/rotations/complete` → `completeWeeklyRotation` | Associate → `PENDING_VERIFICATION`; DS/Master live may auto-`VERIFIED_COMPLETE` |
| Verify | `POST /api/rotations/verify` `review_action=verify` | `VERIFIED_COMPLETE` |
| Send back | `send_back` | Parent returns toward open/`PENDING`; attempt `SENT_BACK` |
| Verify all | `verify_all` | Batch pending |

**History:** `weekly_rotation_completion_attempts` with `review_outcome` ∈ `PENDING | VERIFIED | SENT_BACK`  
(`20260905_weekly_rotation_completion_attempts.sql`). Send-back is the rework signal — there is no `rejected` / `rework` column name.

### 2.4 Presentation lifecycle (not a DB enum)

`PhysicalBayLifecycle` in `lib/store-ops/this-week-ownership.ts`:

`open | reported | awaiting_verification | verified | barrier`

RD-4 labels explicitly separate assignment from completion evidence (`assignmentResponsibilityLabel` / `completionEvidenceLabel`).

### 2.5 Requested vocabulary vs repository

| Asked | Repository reality |
|-------|-------------------|
| Ready | **No** bay/assignment status named `ready` |
| Assigned | Yes — Sunday ownership (`assigned`) |
| Completed | Yes — rotation `is_completed` / attempt path; assignment `completed` allowed but **not** the authority path |
| Verified | Yes — `VERIFIED_COMPLETE` |
| Rejected | **No** |
| Rework | Approximated by `SENT_BACK` |

### 2.6 Mismatch: DB assignment status vs work state vs UI

**Production evidence (store 2587):** all `sunday_bay_assignments.status` values are `assigned` (30/30), including weeks whose rotations are `VERIFIED_COMPLETE`.

| Layer | Behavior |
|-------|----------|
| Assignment `status` | Stays `assigned` through verify; not advanced to `completed` in practice |
| Rotation `verification_status` | Authoritative for complete/verify |
| This Week UI | Reads rotations + ownership map; **ignores** assignment `status` for completion labels |

**Implication:** do **not** overload `sunday_bay_assignments.status` with Zebra handoff. Prefer an orthogonal confirmation field (aligned with SECTION-ROTATION-001 §11.3).

### 2.7 UI-exposed transitions (operator)

| Action | Exposed today | Surface |
|--------|---------------|---------|
| Stage / assign / rebalance | Yes (supervisor/Master; Sunday drawer) | `SundayAuditStagingCard` / `SundayAuditAssignmentModal` |
| Complete bay | Yes | `ThisWeekOwnershipBoard` bay actions → `completeRotation` |
| Barrier / downstock | Yes | Same board |
| Extra bay (+1) | Yes (supervisor) | Same board |
| Verify / send back / verify all | Yes (supervisor+) | `SupervisorAuditSummaryModal` from Floor “Needs attention” |
| Confirm Zebra entry | **No** | — |

Legacy `ZebraChecklist` still implements complete/barrier/Sunday assign for non-primary surfaces; Floor contract forbids mounting it as primary composition (`lib/ux-reduce-002.floor-this-week.contract.test.ts`).

---

## 3. Existing Zebra-related functionality

| Item | Finding | Classification |
|------|---------|----------------|
| Lowe’s Zebra API / deep links | None | MISSING (intentional — DEFERRED forever as product boundary) |
| `zebra_handoff` / `entered_zebra` / `handoff_confirmed` columns | None on `sunday_bay_assignments` or `weekly_rotations` (prod column probe) | MISSING |
| Optional Zebra task identifier | None | MISSING (candidate DEFERRED) |
| UI copy “Sunday assignment handoff” / “live handoff” | `ZebraChecklist.tsx` — means live ownership queue, not external confirm | PRESENT BUT DISCONNECTED (naming only) |
| Zebra Shift Briefing / dashboard chrome | Historical “Zebra” product nickname for Floor handheld UX; deterministic briefing elsewhere | ALREADY IMPLEMENTED (unrelated to Lowe’s handoff) |
| SECTION-ROTATION-001 §11 process map | Documents intended Zebra confirm step; recommends orthogonal flag | PRESENT (docs only) |
| Blueprint doctrine | DeptSync ≠ Zebra task dashboard | ALREADY IMPLEMENTED (product law) |

**Supported today for handoff concerns**

| Capability | Supported? |
|------------|------------|
| Pending Zebra entry | No explicit state (implicitly: assigned ∧ ¬zebra confirm) |
| Confirmed Zebra entry | No |
| Entry timestamp | No |
| Operator confirmation actor | No |
| Associate assignment reference | Yes (`roster_specialist_id` / name) |
| Individual bay reference | Yes (rotation → location aisle/bay) |
| Optional Zebra task id | No |

---

## 4. Existing completion / verification behavior

### 4.1 Authority

| Action | Auth |
|--------|------|
| Complete | Any authenticated store-ops actor with department scope (`requireStoreOpsActor`) |
| Auto-verify on complete | DS / Master, **live only** (offline queue replay never auto-verifies) |
| Verify / send_back / verify_all | `requireSupervisorOrAdmin` on entire `/api/rotations/verify` |
| Generate week | `requireSuperAdmin` |
| Assign locations to week | `requireSupervisorOrAdmin` |
| Persist Sunday ownership | Authenticated + capacity RPC; table writes revoked |

Evidence: `app/api/rotations/complete/route.ts`, `verify/route.ts`, `generate/route.ts`, `assign/route.ts`.

### 4.2 Evidence artifacts

| Artifact | Role |
|----------|------|
| `weekly_rotations.completed_by` / `completed_at` | Report stamps |
| `verified_by` / `verified_at` | Verification stamps |
| `review_note` | Send-back / review note |
| `weekly_rotation_completion_attempts` | Preserved report/review history across send-backs |

Snap Bay / model-gated completion **retired** — completion is human-only (`complete/route.ts` comments; `snap-retirement.test.ts`).

### 4.3 What completion is not

- Not proof of Zebra entry  
- Not a structured pack-out checklist  
- Quick Touch / complete is facing/readiness checkoff via the same complete path  

---

## 5. Current mobile experience

Primary operator phone surface: **Floor** (`/dashboard` → `FloorTab`) — people-first This Week board.

| Operator need | Today |
|---------------|-------|
| See approved weekly assignments | Yes — `ThisWeekCommandSummary` + ownership board when plan exists |
| Group by associate | Yes — `ThisWeekOwnershipBoard` people → bays |
| Open individual assignment | Yes — expand person / bay detail |
| Read required bay work steps | **No structured steps** — only aisle/bay, section/steward, lifecycle labels |
| Identify not-yet-entered-in-Zebra | **No** |
| Confirm handoff | **No** |
| See completion status | Yes — lifecycle labels |
| Verify completed work | Yes — Needs attention → `SupervisorAuditSummaryModal` |
| Sunday planning | Yes — staging card / Assign this week / Advanced recovery (role-gated) |

**Navigation debt (acceptable for this tranche):** Blueprint wants Overview · This Week naming; current nav still Floor-centric. Do **not** redesign IA for handoff — extend This Week board.

**Unnecessary for v1:** rebuilding `ZebraChecklist` as primary UI; multi-step task manager; associate-facing Zebra chrome.

---

## 6. Task granularity findings

### 6.1 What the model assumes today

Evidence shows **one Floor Command ownership row per staged physical bay** (`unique (store_number, department, week_starting, bay_id)` with `bay_id = weekly_rotations.id`). The board groups those bays under associates.

| Hypothesis | Evidence |
|------------|----------|
| One Zebra task per bay | Compatible with FC model; not encoded |
| One Zebra task per associate | Compatible as operator batching; not encoded |
| One Zebra task covering multiple bays | Operator may do this in Zebra; FC still tracks per-bay ownership |
| Explicit task granularity enum | **None** |

**Finding:** Floor Command has **no explicit Zebra task granularity**. Granularity lives only in how the operator types tasks into Lowe’s system.

### 6.2 Recommendation (pending operator decision)

Treat Floor Command confirmation as **per physical bay** (matches durable ownership + verify unit). Allow the UI to offer **“confirm all open bays for this person”** as a convenience that stamps N bay rows — without inventing a parent “Zebra task” entity.

Do **not** create a `zebra_tasks` table for v1.

---

## 7. Bay work requirements

Established weekly bay work (product context):

1. Pull topstock  
2. Zone  
3. Front-face / full pack-out  
4. Consolidate merchandise  
5. Perform bay audit  

| Representation | Finding |
|----------------|---------|
| Structured checklist items in schema | **No** |
| Assignment instructions field | **No** |
| Templates persisted per assignment | **No** |
| Completion evidence per step | **No** — single bay complete |
| Verification criteria per step | **No** — human verify of bay |
| Static descriptive content | Not mounted on This Week bay detail |
| Explicit exclusion | `physical-bay.ts` must not own packdown/front-face/zoning (`bay-unit-002.physical-bay.test.ts`) |

**Operator need when entering Zebra:** a short, static instruction block (the five steps + associate + bay list) as **copy aid**, not a second checklist system.

**Classification:** structured checklists = DEFERRED / avoid duplicate; static Zebra entry copy = small ALREADY-MISSING UX for the handoff tranche.

---

## 8. Authorization and audit findings

| Action | Who today | Handoff implication |
|--------|-----------|---------------------|
| Create / change assignments | Supervisor / Master (+ capacity RPC) | Unchanged |
| Confirm Zebra handoff | **N/A** | Should be supervisor/Master only (operator) |
| Mark complete | Associate + supervisor + admin | Unchanged |
| Verify / send back | Supervisor / Master | Unchanged |
| Reopen / reject | Send-back path only | Unchanged |

**Minimum provenance for handoff confirmation**

- `confirmed_at` (timestamptz)  
- `confirmed_by` (actor id or stable operator identifier already used elsewhere)  
- Scope key: Sunday assignment row or (`store`, `week`, `bay_id` / rotation id)

Optional later: free-text `external_task_ref` — **not required** to distinguish A–D.

**Preserve:** MasterAdmin authority, RLS fail-closed patterns, capacity RPC as sole assignment writer, no associate-facing admin actions for handoff confirm.

---

## 9. Production observations (read-only)

Inspection method: service-role Supabase SELECT aggregates only; no INSERT/UPDATE/DELETE; no personal note/PIN bodies; associate names not exported below.

### 9.1 `sunday_bay_assignments` (store 2587)

| Metric | Value |
|--------|-------|
| Total rows | **30** |
| Status breakdown | **`assigned`: 30** (no `pending` / `completed` / `cleared` rows present) |
| Zebra-ish columns | **None** |
| By week × dept | `2026-09-21` flooring 12 · `2026-09-28` flooring 12 · `2026-10-05` flooring 6 |
| Carry-over flags | 0 in these rows |

### 9.2 Active `weekly_rotations` (store 2587, `superseded_at` null)

| Metric | Value |
|--------|-------|
| Active rows | **30** |
| `VERIFIED_COMPLETE` | **12** (all have `verified_at` + `completed_at`) |
| `PENDING` | **18** |
| `PENDING_VERIFICATION` | **0** |
| Recent weeks | W39: 12 PENDING · W40: 12 VERIFIED_COMPLETE · W41: 6 PENDING |

### 9.3 Completion attempts

| Metric | Value |
|--------|-------|
| Total attempts | **25** |
| Outcomes | **`VERIFIED`: 25** · `SENT_BACK`: 0 · `PENDING`: 0 |

### 9.4 Interpretation

- Historical **completion and verification evidence exists** (W40 fully verified; 25 VERIFIED attempts).  
- **No Zebra handoffs are recorded** (impossible — no columns).  
- Assignment rows remaining `assigned` after verify confirms ownership status ≠ work lifecycle.  
- Current open work is staged/`PENDING`, not stuck in verification queue.

---

## 10. Confirmed gaps

### ALREADY IMPLEMENTED

- Stage → assign → complete → verify (+ send-back) engine  
- Capacity-gated assignment writes  
- This Week people→bays mobile board + command summary  
- Supervisor verification modal  
- RD-4 separation of assignment vs completion evidence  
- Stewardship-aware **proposal** path (ROTATION-006) feeding operator review before external entry  

### PRESENT BUT DISCONNECTED

- “Handoff” wording on demoted `ZebraChecklist` (not external confirm; not Floor primary)  
- SECTION-ROTATION-001 §11 Zebra process (docs ahead of product)  
- Assignment `status=completed` allowed in CHECK/RPC but unused as authority  

### MISSING (required for canonical workflow)

1. Durable **Zebra entry confirmation** (orthogonal to assigned / completed / verified)  
2. Operator UI to see **not entered vs entered** and confirm on phone  
3. Static **bay work instruction** copy for Zebra typing aid  

### MISSING (intentional / out of scope)

- Direct Lowe’s Zebra integration / APIs  

### Defects vs improvements

| Item | Class |
|------|-------|
| No Zebra confirm evidence | **Gap** (blocks workflow step 5) — not a latent bug in complete/verify |
| Assignment status not advanced on verify | **Drift / unused path** — not blocking if handoff stays orthogonal |
| `ZebraChecklist` “handoff” naming | **Cosmetic debt** — do not restore as platform |

---

## 11. Operator decisions genuinely required

| # | Decision | Why it matters | Suggested default |
|---|----------|----------------|-------------------|
| **D1** | Confirmation unit: **per bay** only, or per bay + **confirm-all for associate** convenience? | UI shape; still recommend per-bay durable stamps | Per-bay stamps + optional confirm-all |
| **D2** | Capture optional **Zebra task identifier** in v1? | Extra field/noise vs traceability | **No** for v1 (DEFER) |
| **D3** | Should handoff confirm be **required before** associates are expected to execute, or advisory? | Whether UI blocks/nags vs quiet badge | Advisory badge + Needs-attention count; do not block complete/verify |

No decision required on inventing Zebra APIs, new task entities, or new primary nav.

---

## 12. Minimal implementation recommendation

**Goal:** cohesive mobile-first handoff on existing This Week — not a task platform.

### 12.1 Preserve

- Existing assignment + verification states  
- Capacity RPC / RLS  
- Floor people→bays board  
- Complete / verify / send-back semantics  
- No AI, no Zebra API, no parallel checklist engine  

### 12.2 Smallest durable evidence

Add orthogonal confirmation on the ownership unit (prefer `sunday_bay_assignments` or a 1:1 evidence side-table keyed to it):

- `zebra_entered_at timestamptz null`  
- `zebra_entered_by text null` (operator actor)

Clearing ownership (`cleared`) should clear confirmation. Reassignment should require a fresh confirm (or explicit preserve — default **clear on reassign**).

**Do not** add `ready` / reuse `verification_status` / advance assignment `status` to mean Zebra.

### 12.3 UI (phone-first, Floor only)

1. Command summary chip: **Entered in Zebra N / Assigned M** (or “K not entered”).  
2. On each bay detail: lifecycle line + **Not in Zebra** / **Entered in Zebra · {time}** + Confirm button (supervisor+).  
3. Optional person-level **Confirm all for {name}** stamping each bay.  
4. Static five-step work blurb (display-only) above Confirm — copy aid for Zebra entry.  
5. Needs attention: include “not entered in Zebra” when assigned and unconfirmed.

### 12.4 Distinguishing A–D after change

| State | Evidence |
|-------|----------|
| A Planned | Active rotation, no Sunday owner |
| B Assigned (FC) | Sunday owner present |
| B′ Entered in Zebra | `zebra_entered_at` set |
| C Completed / reported | `PENDING_VERIFICATION` or reported complete |
| D Verified | `VERIFIED_COMPLETE` |

### 12.5 Suggested tranche name

**DEPTSYNC-ZEBRA-HANDOFF-002** — orthogonal confirm + This Week UX + tests. Schema only if D1/D2 settled; prefer one migration with two columns over a new task subsystem.

---

## 13. Explicitly deferred functionality

- Lowe’s Zebra API / SSO / deep links  
- Persisted per-step bay checklists / photo evidence per step  
- Zebra task ID / multi-bay parent task entity (unless D2 flips)  
- Blocking associates from complete until Zebra confirm  
- Restoring `ZebraChecklist` as primary Floor composition  
- Full Blueprint IA rename (Overview / This Week tabs)  
- AI-generated Zebra task text  
- Changing Sunday cron / section-aware auto-stage flags as part of handoff  

---

## 14. Validation results

Read-only test runs (no source modifications):

| Suite | Result |
|-------|--------|
| `lib/rd4.this-week-command.contract.test.ts` | **4 PASS** |
| `lib/ux-reduce-002.floor-this-week.contract.test.ts` | **11 PASS** |
| `lib/store-ops/thesis001a.verification-authority.test.ts` | **20 PASS** |
| `lib/store-ops/shared-week-capacity.test.ts` | **24 PASS** |
| `lib/store-ops/bay-unit-002.physical-bay.test.ts` | **25 PASS** |
| `lib/rd5.walkthroughs.contract.test.ts` | **9 PASS** |
| `lib/store-ops/engine-prod-003.extra-bay-dispatch.test.ts` | **16 PASS** |
| **Total this discovery** | **109 PASS / 0 FAIL** |

Production: SELECT-only aggregates reported in §9. No mutations.

---

## 15. GO / CONDITIONAL GO / NO-GO

| Gate | Verdict |
|------|---------|
| Discovery completeness | **GO** — lifecycle, gaps, prod evidence, and mobile surface identified |
| Immediate implementation without operator input | **CONDITIONAL GO** — blocked only on **D1** (and optionally D2/D3) |
| Zebra API / task platform build | **NO-GO** |
| Overloading `verification_status` or assignment `status` for Zebra | **NO-GO** |
| Schema-heavy redesign before UI spike | **NO-GO** — keep orthogonal and thin |

**Overall:** **CONDITIONAL GO** to implement DEPTSYNC-ZEBRA-HANDOFF-002 after operator confirms D1 (default: per-bay confirm + optional confirm-all).

---

**STOP.** No implementation in this tranche.
