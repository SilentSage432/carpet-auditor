# DEPTSYNC-SECTION-OWNERSHIP-001 — Schedule-Free Roster & Flexible Section Assignment

**Status:** DISCOVERY COMPLETE (design only)  
**Date:** 2026-10-18  
**Mode:** Evidence-based discovery and implementation design  
**Store context:** 2587 · standing capacity Tyson/Nate/Nick/Tracy **3/3/3/3 = 12**  

**Strict exclusions honored:** No production deploy · no migrations · no standing-capacity changes · AUTO-008 left enabled · no cron/assignment/section mutations · no second rotation engine · no employee scheduling product · no specialty · no Orient.

**AUTO-008 boundary:** First unattended Sunday publication remains **2026-10-25T12:00:00Z → 2026-W44**. This design must not disrupt that acceptance event.

---

## 1. Executive summary

Floor Command already has most of the durable bones for a schedule-free rotation system:

| Need | Already present? |
|------|------------------|
| Permanent Operational Sections + bay geography | **Yes** — RD-3 |
| Permanent section primary owner | **Yes** — `primary_owner_specialist_id` + UI + events |
| Strict ownership on assign / auto-publish | **Yes** — OPERATIONAL-011 RPC + AUTO-002 stage |
| Shift-independent eligibility | **Yes** — AUTO-005A/005B |
| Standing weekly capacity (no repeated weekly clicks) | **Yes** — AUTO-008A/008B + MasterAdmin v1 |
| Automatic Sunday publish | **Yes** — AUTO-008 dual-gate **ENABLED** |
| Add associate to roster | **Yes** — `createRosterMember` / roster APIs |
| Soft-deactivate associate | **Partial** — workspace cleanup archive; not a first-class rotation UX |
| Temporary week-specific section coverage | **No** — gap |
| Schedule-free supervisor UX (no shift calendars in rotation path) | **Partial** — shifts not required; UI still surfaces schedule evidence |

**Product intent confirmed:** Floor Command is an **operational rotation system**, not an employee scheduling app. Employees turn over; sections and bay history endure.

**Operator selected both:**

- **A. Permanent section ownership** (already modeled; needs UX polish + roster lifecycle clarity)  
- **B. Temporary weekly coverage** (missing; must compose into the **same** ownership resolution used by AUTO-008)

**Smallest safe destination model:**

```text
OPERATIONAL SECTION (durable geography)
        ↓
effective responsibility for week W
  = temporary coverage(W) ?? permanent owner
        ↓
section-balanced bay selection (existing)
        ↓
associate capacity 0–3 (standing / explicit week)
        ↓
authoritative assignment RPC (existing)
```

Do **not** invent a parallel rotation engine. Do **not** change standing-policy semantics in the first implementation tranche.

---

## 2. Confirmed current architecture

### 2.1 Associate roster

| Asset | Reference |
|-------|-----------|
| Table | `public.store_specialists` |
| Soft active flag | `is_active` (plus `status` in cleanup inventory) |
| Auth containment | SEC-OPS-002 revoke + column grants — `supabase/migrations/20261013_sec_ops_002_rls_containment.sql` |
| Create | `lib/onboarding/create-roster-member.ts` → `POST /api/roster/members` |
| Edit workforce fields | `PATCH /api/roster/members/[id]` (name/phone/floor_title only; no role escalation) |
| Soft archive | `POST /api/workspace-cleanup` `archive_associates` — `lib/store-ops/client.ts` `archiveWorkspaceCleanupAssociates` |
| UI | `components/admin/AssociateRosterPanel.tsx`, `components/hub/tabs/RosterTab.tsx` |

Create path still optionally stamps **today’s** `associate_shift_days` (`onDuty` default true) — convenience for “on duty” display, **not** required for AUTO-008 eligibility.

### 2.2 Operational Sections

| Asset | Reference |
|-------|-----------|
| Sections | `operational_sections` — `supabase/migrations/20261011_operational_sections.sql` |
| Permanent owner | `primary_owner_specialist_id` → `store_specialists(id)` ON DELETE SET NULL |
| Membership | `operational_section_members` (department_id, aisle, bay) — one active section per bay |
| Provenance | `operational_section_events` includes `owner_changed` with previous/next owner |
| Domain | `lib/store-ops/operational-sections.ts` — `updateOperationalSection` writes owner + event |
| UI | `components/admin/OperationalSectionsPanel.tsx` — “Primary owner” select (`data-testid="sections-owner"`) |
| Explicit product note | UI copy: joint stewardship **not** available — **one primary owner per section** |

### 2.3 Ownership enforcement (automatic + write path)

| Layer | Behavior | Reference |
|-------|----------|-----------|
| Stage | Selects bays only where `primary_owner_specialist_id === specialist` | `lib/store-ops/section-balanced-stage.ts` |
| Stewardship / strict assign | Same owner boundary; shortfalls explicit | `lib/store-ops/section-ownership-enforcement.ts` |
| DB write | RPC resolves bay → section → owner; rejects mismatch | `supabase/migrations/20261018_operational_011_section_ownership.sql` |
| AUTO-008 publish | Uses same compose + RPC path when dual-gate ON | `lib/store-ops/sunday-dispatch.ts`, `authoritative-week-cycle.ts` |

**Critical implication:** temporary coverage **must** feed the same owner map the planner and RPC see for week W. Changing only presentation would fail closed at the RPC.

### 2.4 Capacity

| Layer | Reference |
|-------|-----------|
| Weekly approvals | `store_week_capacity_approvals` + `upsert_store_week_capacity_approvals` |
| Standing policy | `store_standing_capacity_policies` / `_items` / provenance — AUTO-008A |
| Materialize before Sunday load | `materializeStandingCapacityForWeek` in sunday-dispatch |
| Cap range | 0–3 per associate per week; shared sum = store-week target |

Standing policy is **associate-scoped**, not section-scoped. That is the correct foundation for coverage math (see §9).

### 2.5 Assignment persistence & protections

| Concern | Mechanism |
|---------|-----------|
| Weekly ownership rows | `sunday_bay_assignments` (`roster_specialist_id`, `supervisor_locked`, status) |
| Rotations | `weekly_rotations` (completion / verification attribution) |
| Supervisor edits | `supervisor_locked` — AUTO-003 |
| Protected publish | Skip owned / locked / completed / verified — AUTO-003/006 |
| History on owner change | Permanent owner change does **not** rewrite past SBA/rotations (events only) |

### 2.6 Shifts / schedules

| Concern | Status |
|---------|--------|
| Eligibility for weekly bays | **Shift-independent** (AUTO-005A/005B) — verified by `weekLaborToAssignmentMembers` |
| Still loaded | Fingerprints, Sunday drawer “dept days / hours”, Floor “on duty”, call-outs (TIME-DUTY) |
| Table | `associate_shift_days` — `supabase/migrations/20260815_associate_shift_days.sql` |

---

## 3. Existing reusable capabilities

1. **Permanent owner mutation** with audit events — extend UX; do not redesign schema.  
2. **Strict section-balanced stage + stewardship** — inject *effective* owner map for week W.  
3. **OPERATIONAL-011 RPC** — either resolve effective owner inside RPC for week label, or pass ownership that already matches effective map (prefer single resolve helper consumed by stage + RPC callers).  
4. **Standing capacity materialization** — leave semantics unchanged.  
5. **Roster create + soft archive** — promote archive/reactivate into rotation-facing roster actions without a second identity system.  
6. **Supervisor locks / protected ids** — temporary coverage must never rewrite locked/completed work.  
7. **AUTO-008 dual-gate publish loop** — add one resolve step; do not add a publisher.

---

## 4. Actual gaps

| Gap | Severity | Notes |
|-----|----------|-------|
| No week-scoped section coverage override | **P0 for intent B** | Permanent owner is the only responsibility signal today |
| Roster deactivate not first-class in rotation UX | P1 | Cleanup wizard exists; leaving employees mid-week needs unfinished-work surfacing |
| Reactivate does not reclaim old assignments | Desired — already true if soft archive only flips `is_active` | Document as contract |
| Schedule evidence still prominent in Sunday capacity UI | P2 UX | Encourages schedule maintenance even though not required |
| Create roster defaults `onDuty` shift row | P2 | Optional friction; should not be framed as required for rotation |
| Joint stewardship | Explicitly out of scope | One primary + optional weekly cover is enough |
| Section workload target ≠ associate capacity | Future | Do not split in first tranche |

---

## 5. Proposed ownership model

### Durable

- **Section** owns geography (members).  
- **Permanent owner** = `operational_sections.primary_owner_specialist_id`.  
- Changes are prospective for **future** weeks’ automatic selection; never rewrite historical assignment rows.

### Week-effective (new)

```text
effectiveOwner(section, week) =
  active temporary coverage(section, week)?.covering_specialist_id
  ?? section.primary_owner_specialist_id
```

Properties:

- Temporary coverage does **not** mutate `primary_owner_specialist_id`.  
- Missing coverage → permanent owner.  
- Expired / next week without override → permanent owner again.  
- One covering associate per section per week (initial).  
- Covering associate must be `is_active` and store-scoped.

### Recommended coverage scope (initial)

**A. Entire section’s weekly workload** — simplest safe design.

Defer **B. selected individual bays** until operators prove section-wide cover is insufficient. Bay-level cover duplicates supervisor bay edit (`supervisor_locked`) already available for exceptions.

---

## 6. Roster lifecycle

| Action | Behavior |
|--------|----------|
| **Add** | Existing `createRosterMember` — valid `store_specialists` row; store/dept scope; no auth bypass; optional pairing later |
| **Deactivate** | Soft `is_active=false` (reuse cleanup archive semantics); drop from future eligibility / standing materialization eligible set; **preserve** historical SBA/rotations/attribution |
| **Unfinished work** | Surface This Week / Sunday bays still owned by deactivated id → supervisor reassign or clear+lock; never silent delete |
| **Reactivate** | `is_active=true` via authorized supervisor/Master action; does **not** auto-reclaim past bays or auto-restore section ownership |

Do **not** create a parallel people table. Auth identity remains the existing roster/session model (SEC-OPS-010).

---

## 7. Permanent ownership

Supervisor UI (mobile-first), building on `OperationalSectionsPanel`:

| Section | Permanent owner |
|---------|-----------------|
| Aisles 5–6 | Tyson |
| Aisles 7, 39, 40 | Nate |
| Aisles 43–44 | Nick |
| Aisles 41–42 | Tracy |

Requirements already mostly met by `updateOperationalSection` + `owner_changed` events:

- Supervisor/Master authorized API (existing sections routes).  
- Active associate only.  
- Store/department scoped.  
- Geography unchanged.  
- History preserved.  
- Future AUTO-008 weeks use new permanent owner when no temporary cover applies.

**Constraint evolution:** none required for permanent-only changes. Digests (`buildSectionOwnershipDigest`) already track owner identity for freshness.

---

## 8. Temporary weekly coverage

### Proposed additive table (design only — not applied)

`operational_section_week_coverage` (illustrative):

- `(store_id, section_id, week_label)` PK  
- `covering_specialist_id` (active roster)  
- `established_by_specialist_id`, `established_at`, `note`  
- Optional `revoked_at` for audit  

Or store_number-keyed to match capacity tables — follow existing store scoping conventions at implementation time.

### Semantics

| Rule | Behavior |
|------|----------|
| Authorization | Supervisor or MasterAdmin |
| Week | Explicit ISO week label |
| Persistence | Does not rewrite permanent owner |
| Assignments already published | Protected; coverage affects **future** stage/publish for that week only |
| Locks / completed / verified | Untouched |
| Audit | Insert/revoke events (table or `operational_section_events` extension) |

### Example

- Permanent: Section B → Nate  
- Cover: `2026-W45` → Tracy  
- W45 effective owner B = Tracy  
- W46 without cover → Nate again  

---

## 9. Capacity & coverage conflict handling

**Standing policy remains associate-scoped 3/3/3/3 = 12. Do not change standing semantics in this program’s first build.**

### Authoritative rule (recommended)

> An associate’s approved capacity for week W is a **personal bay budget** for that week.  
> Temporary coverage changes **which section pools** they may draw from — it does **not** multiply their budget.

Example: Tracy owns D (permanent) and covers B for W45 with capacity 3:

- Stage pool for Tracy = bays in B ∪ D (effective ownership).  
- She still receives **at most 3** bays total.  
- Shortfalls on B and/or D are **explicit** (`insufficient_eligible_bays` / unfilled capacity reasons) — never silent 6.

If Nate is covered away from B and has no other section:

- Nate’s pool is empty → shortfall / zero staged for Nate unless supervisor sets capacity 0 (cleaner) via explicit week override.

### Supervisor levers (existing + clarified UX)

1. Explicit week capacity override (already exists) — raise Tracy / zero Nate when covering.  
2. Accept honest shortfall while capacity stays 3/3/3/3.  
3. Permanent owner change (if cover becomes the new normal).

### Future (not now)

Separate **section workload targets** from **associate capacity** only if operators repeatedly need “section owes 3” independent of who covers. That is a larger model change — defer.

---

## 10. Rotation continuity

| Event | Bay rotation memory |
|-------|---------------------|
| Associate leaves | Soft-deactivate; bay history rows remain attributed |
| Permanent owner change | Prospective only; past weeks unchanged |
| Temporary cover | Week-effective owner only; does not reset physical-bay priority / aging inputs |
| Re-select risk | Stage still uses existing physical-bay priority order inside the **section pool**; ownership swap must not invent a new pool identity — pool = section members, not owner id |

Reuse `selectSectionBalancedPhysicalBayCoverage` with an **effective** `baySectionByKey` (owner field overridden for week W). Avoid a second planner.

---

## 11. Schedule removal (friction, not data deletion)

| Class | Examples | Recommendation |
|-------|----------|----------------|
| Required for rotation | ~~Shift hours for eligibility~~ | **Already removed** (AUTO-005A) — keep tests green |
| Display / fingerprint | Sunday capacity “dept days · hours”; schedule fingerprints | Keep data; **demote copy** (“optional schedule evidence”) |
| Unrelated / protected | Shift Briefing, call-outs (TIME-DUTY), Floor on-duty | Leave intact; out of rotation critical path |
| Create-roster onDuty default | Writes today’s shift | Make opt-in or background; never block add-associate |

**Do not** build a replacement scheduling system. Orient remains future/out of scope.

---

## 12. AUTO-008 compatibility

Activated sequence today (enabled; first run **2026-10-25Z → W44**):

1. Determine operational week (`sundayStagingWeekLabel`)  
2. Materialize standing capacity  
3. Load capacity / sections  
4. Section-balanced stage  
5. Stewardship compose + capacity/ownership RPC (when dual-gate ON)  
6. Preserve protected work  

### Required design insertion (future implementation — **not now**)

Between (2) and (4):

**3a. Resolve week-effective section responsibility**  
`permanent owner ⊕ temporary coverage(week)` → effective `baySectionByKey`.

Touch points (implementation later):

| Component | Change |
|-----------|--------|
| Sunday cron / `sunday-dispatch` | Load coverage rows for target week; build effective map |
| `section-balanced-stage` | Consume effective owners (API unchanged if map is pre-resolved) |
| Stewardship / ownership enforcement | Same |
| Assignment RPC | Must accept assignments consistent with effective owners for that week — **design carefully** so permanent-only DB join does not reject valid covers |
| Capacity validation | Unchanged associate caps |
| Supervisor editing | Manual assign/clear still stamps locks; cover UI separate |
| This Week | Show permanent vs covering label when cover active |

### Absolute for this discovery

Do **not** modify production automation before/during the first unattended W44 run. Implement coverage resolution only in a **later authorized tranche** after FIRST SCHEDULED PUBLICATION VERIFIED (or explicitly deferred past that milestone by the operator).

---

## 13. Proposed UI (mobile-first)

Prefer one supervisor surface (Sections + thin Roster), not parallel dashboards:

1. **Roster** — list active; Add; Deactivate; Reactivate.  
2. **Sections** — each row: name / aisles summary / **Permanent owner** dropdown.  
3. **This week cover** — per section: optional “Covering for week W” associate + clear.  
4. Capacity conflict banner when cover ∪ permanent pools share one associate over budget risk (informational; enforcement remains capacity RPC).  
5. Minimal confirms; no shift calendar in this path.

Avoid: weekly capacity re-approval loops (standing handles), scheduling screens, dual ownership boards.

---

## 14. Phased implementation plan

### Phase 0 — Hold for AUTO-008 acceptance (now)

| Item | Detail |
|------|--------|
| Scope | Observe **2026-10-25T12:00Z → W44** first automatic publication |
| Changes | **None** |
| Risk | Any ownership/coverage schema mid-flight could confound acceptance |

### Phase 1 — Roster lifecycle clarity (smallest)

| Item | Detail |
|------|--------|
| Scope | First-class deactivate/reactivate on roster UI; unfinished-work list for deactivated owners |
| Reuse | `store_specialists.is_active`, workspace-cleanup archive semantics, This Week queries |
| Schema | Likely **none** |
| Auth | Supervisor/Master; MasterAdmin protected |
| Tests | Deactivate removes future eligibility; history intact; reactivate no reclaim |
| Rollout | App-only; after W44 acceptance preferred |
| Rollback | Revert app |

### Phase 2 — Permanent owner UX polish

| Item | Detail |
|------|--------|
| Scope | Mobile section→owner matrix; validate active associate; show provenance |
| Reuse | `updateOperationalSection`, events, `OperationalSectionsPanel` |
| Schema | **None** |
| Tests | Owner change prospective; digest/freshness; RPC still enforces |
| Rollout | App-only |

### Phase 3 — Temporary weekly coverage (core gap)

| Item | Detail |
|------|--------|
| Scope | Coverage table + resolveEffectiveOwners + Sunday/This Week/UI |
| Reuse | Stage/stewardship/AUTO-008 path; capacity unchanged |
| Schema | Additive coverage table + RLS; **no** rewrite of permanent owner |
| Auth | Supervisor/Master establish/revoke |
| RPC | Must recognize effective week ownership (dedicated design spike before code) |
| Tests | Cover week; next week reverts; locks preserved; capacity not doubled; concurrent cron idempotent |
| Migration risk | Medium — RPC ownership join is the sharp edge |
| Rollout | Migrate → deploy latch-ON store only after Phase 0 evidence; feature-flag if needed |
| Rollback | Revoke coverage rows; env/feature off; RPC forward-compatible |

### Phase 4 — Schedule friction demotion

| Item | Detail |
|------|--------|
| Scope | Copy/IA: optional schedule evidence; stop prompting shift entry for rotation |
| Reuse | Keep `associate_shift_days` for Orient/call-out/fingerprint |
| Schema | None |
| Tests | AUTO-005A regressions remain PASS |

---

## 15. Risks and unresolved decisions

| Risk / decision | Notes |
|-----------------|-------|
| RPC permanent-owner join vs weekly cover | Highest implementation risk — spike before Phase 3 coding |
| Covering associate already at capacity | Shortfall UX must be obvious on phone |
| Deactivated owner mid-week | Reassignment workflow must be explicit |
| W43 SBA gap observed at AUTO-008 enablement | Unrelated cleanup; do not conflate with this design |
| Joint stewardship | Still deferred (carpet-wall specialty separate) |
| Section workload vs person capacity | Deferred |
| Whether coverage should auto-zero permanent owner capacity | **Recommend no** — supervisor uses explicit week override |

---

## 16. Recommended next implementation tranche

**After** AUTO-008 **FIRST SCHEDULED PUBLICATION VERIFIED** (or operator explicitly prioritizes earlier):

1. **SECTION-OWNERSHIP-002** — Roster deactivate/reactivate + unfinished-work surfacing (Phase 1).  
2. Then **SECTION-OWNERSHIP-003** — Temporary weekly coverage design spike (RPC effective-owner) + implementation (Phase 3), with Phase 2 polish bundled if cheap.

Do **not** start Phase 3 schema work before the W44 acceptance window unless the operator accepts confounding risk.

---

## GO / NO-GO (this tranche)

| Decision | Verdict |
|----------|---------|
| Discovery / design | **GO** |
| Implement / migrate / deploy now | **NO-GO** |
| Disrupt AUTO-008 first run | **NO-GO** |
| Change standing 3/3/3/3 | **NO-GO** |

### Bottom line

Permanent ownership is largely **already built**. Temporary weekly coverage is the **real gap**, and must compose into the **same** effective-owner map AUTO-008 uses — without multiplying associate capacity. Schedule elimination is mostly **UX demotion** atop AUTO-005A. Preserve **2026-10-25Z / W44** as a clean automatic publication acceptance event.

**STOP AFTER DISCOVERY REPORT.**
