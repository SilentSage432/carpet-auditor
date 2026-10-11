# DEPTSYNC-CLEANUP-001 — Department Workspace Discovery

**Status:** COMPLETE (read-only discovery + design)  
**Date:** 2026-10-11  
**Mode:** Read-only investigation  
**Authority:** Prepare Floor Command for a focused Flooring + Home Decor operational workspace without destroying historical evidence  

**Not authorized by this tranche:** application code, schema migrations, production SQL, data mutations, credential/auth/RLS changes, deployment, commit, push, Map redesign, Sunday staging changes, dual-department automatic assignment activation.

**Related prior art:** [`DEPTSYNC_ALIGN_TOPO_001_TWO_DEPARTMENT_TOPOLOGY_RECONCILIATION.md`](DEPTSYNC_ALIGN_TOPO_001_TWO_DEPARTMENT_TOPOLOGY_RECONCILIATION.md) · [`DEPTSYNC_RD_6_PRODUCT_COMPLETION_AUDIT.md`](DEPTSYNC_RD_6_PRODUCT_COMPLETION_AUDIT.md) · operator inventory script `scripts/sql/align-topo001-topology-inventory-readonly.sql`

---

## Executive verdict

Safe workspace cleanup is **already supported by soft mechanisms**:

| Target | Safe action today | Unsafe action |
|--------|-------------------|---------------|
| Irrelevant aisles/bays | `store_locations.is_active = false` (preserves UUID) | Hard-delete via Clean-Up / Manage (CASCADE / RESTRICT risk) |
| Irrelevant associates | Soft-remove: `is_active=false` + `status=suspended` | Hard DELETE when FKs allow (nulls soft FKs) |
| Foreign departments | `departments.is_active = false` | Dropping department rows |

A **guided mobile bulk workflow does not exist yet**. Today the operator can retire one department+aisle at a time (Bulk Clean-Up) and remove associates one at a time (Roster Remove). Multi-aisle select-and-confirm and multi-associate archive-with-preview are **design gaps**, not missing soft-delete primitives.

**GO / NO-GO (this tranche):**

| Question | Verdict |
|----------|---------|
| Discovery complete? | **GO** |
| Production mutation from this report? | **NO-GO** |
| Implement guided cleanup UI next? | **CONDITIONAL GO** — after operator confirms which aisles/people are out of scope |
| Activate dual-dept Sunday auto-assign after cleanup? | **NO-GO** until **CAPACITY-GUARD-001** (shared 4×3=12) |

Production row counts were **not inspected** here (no authorized production SQL). Repository fixtures are not production truth. Re-use `scripts/sql/align-topo001-topology-inventory-readonly.sql` for live aggregates.

---

## 1. Current topology inventory

### 1.1 Identity stack (IMPLEMENTED)

```text
stores
  └── departments (code UNIQUE per store, name, weekly_bay_target, is_active)
        └── store_locations (UUID, department_id, aisle TEXT, bay INT, type SELLING|TOPSTOCK, is_active, …)
```

| Concept | Owner | Notes |
|---------|-------|-------|
| Active aisle (workspace) | Derived | Aisle with ≥1 active physical bay under a department |
| Retired aisle (workspace) | Derived | All surfaces for that department+aisle have `is_active=false` |
| Department association | `store_locations.department_id` | Binding key; aisle text alone is insufficient |
| Bay identity | `store_locations.id` UUID | Must survive cleanup for history FKs |
| Physical coverage key | `(department_id, aisle, bay)` | `lib/store-ops/physical-bay.ts` |
| Surface uniqueness | `(department_id, aisle, bay, type)` | Bulk upsert conflict target |
| Specialty aisle table | **None** | No `specialty_aisles` relation; “specialty” = dormant tools, not topology |
| Operational Sections | Overlay | `operational_sections` + members keyed by `(department_id, aisle, bay)`; soft-retire independent of location pause |

### 1.2 Department associations (IMPLEMENTED)

- Seed templates (`STORE_DEPARTMENT_TEMPLATES`) still list many enterprise departments; new-store seed sets `is_active: true` **only** for `flooring`.
- Live product still merges Flooring + Home Decor as one department: `code = flooring`, display name `Flooring / Home Decor`.
- No `home_decor` code in hub department codes today.
- Working-department pin filters Map/Floor when pin ≠ `all`.
- **Aisle numbering does not uniquely identify a department.** Schema uniqueness includes `department_id`. Map aisle keys are `${departmentId}:${aisle}`; colliding aisle codes set `aisleCodeCollides` and append department name to the label.

### 1.3 Bay counts (structure)

| Aggregate | How to obtain |
|-----------|---------------|
| Surfaces vs physical bays | Count `store_locations` rows vs distinct `(aisle, bay)` per department |
| Active vs retired surfaces | Filter `is_active` |
| Historical pressure | Locations with `weekly_rotations` / completion attempts / service logs |

Live numbers: **UNRESOLVED** pending operator SQL. Historical PRIORITY-UX-001 snapshot (2026-09-18) saw ~584 active surfaces / ~292 physical bays with **no per-department breakdown** — treat as stale context only.

### 1.4 Specialty aisle relationships

**None in topology.** Specialty product surfaces (appliances, remnants, SIMS) are not aisle ownership records. Cleanup must not invent specialty-aisle retirement.

### 1.5 Operational Section relationships

| Fact | Detail |
|------|--------|
| Model | Named stewardship overlay of physical bays; not weekly assignment |
| Soft-retire | `is_active=false` + `retired_at`; members cleared to events |
| APIs | `PATCH/DELETE /api/operational-sections/[id]` retire; reactivate supported |
| Independence | Retiring a section does **not** pause `store_locations`; pausing locations does **not** auto-retire sections |
| Cleanup implication | After aisle soft-retire, section membership for those bays may already be empty or should be reviewed in a later pass — not required for location pause to take effect on rotation |

### 1.6 Existing aisle / bay retirement mechanisms

| Mechanism | Scope | History-safe? | Citation |
|-----------|-------|---------------|----------|
| Map pause/activate toggle | One surface row `is_active` | **Yes** | `StoreLocationGrid.toggleActive` → `patchStoreLocation` |
| Bulk Clean-Up **retire** | Department + aisle (entire or bay range) | **Yes** | `BulkLocationGenerator.handleCleanup` loops `is_active: false` |
| Bulk Clean-Up **hard delete** | Same ID set; Super Admin | **No** once history exists | `deleteStoreLocations` |
| Manage hard delete | Selected rows / duplicates | **No** | `AisleBayManager` |
| Department pause | `departments.is_active` | **Yes** | Skips inactive depts in Sunday loop |
| Show retired (Map) | Visibility filter | N/A | `composeMapAisleIndex({ showRetired })` |

**Bulk aisle retirement today:** Yes, but **one department+aisle (or range) per Clean-Up action** — not multi-aisle checkbox selection across the store. Always filtered by `department_id` before aisle match.

**Bay retirement:** Same `is_active` flag per surface row (SELLING and TOPSTOCK are separate rows). Soft-retire should retire both surfaces for a physical bay when removing it from the active workspace.

---

## 2. Current roster inventory

### 2.1 Schema / classification (IMPLEMENTED)

| Concern | Fields | Notes |
|---------|--------|-------|
| Active flag | `store_specialists.is_active` | Soft archive / workspace presence |
| Status | `invited \| active \| suspended` | Remove path sets `suspended` |
| Platform role | `Associate \| Supervisor \| MasterAdmin` (+ legacy Specialist normalized) | |
| Floor title | `floor_title` | Specialist / CSA / etc. — orthogonal to platform role |
| Department | `assigned_department`, `home_department`, `accessible_departments[]` | Sunday eligibility uses **home** (→ assigned → default flooring); accessible scope is authority, not labor pool |
| Rotation eligibility | No dedicated column | `is_active` + home-dept match + known ON_DUTY hours > 0; MasterAdmin excluded |
| App access | Derived from PIN/onboarding | Distinct from `is_active` |

### 2.2 Active vs inactive (workspace behavior)

| Surface | Inactive visible? |
|---------|-------------------|
| Roster tab / Floor pickers / Walkthrough pickers | **No** (`is_active !== false`) |
| Sunday / labor workforce load | **No** (`.eq("is_active", true)`) |
| Hub-bridge login | **No** (active-only loads) |
| Local tombstones | Yes, in local storage only (prevents seed revive) |
| “Show retired associates” UI | **Does not exist** |

Live headcount / department assignment aggregates: **UNRESOLVED** pending operator SQL (script §8 already aggregates assigned/home/accessible codes without PII).

### 2.3 Existing archive / deactivation logic

| Path | Behavior | Citation |
|------|----------|----------|
| Roster **Remove** | Soft: `is_active=false`, `status=suspended`; then best-effort hard DELETE; if FK blocks, soft stands | `deleteSpecialist` |
| `setSpecialistActive` | Toggle `is_active` only (does not set suspended) | Rare permanent toggle |
| MasterAdmin Remove | **Blocked in UI** (`showRemove = canManage && role !== "MasterAdmin"`) | `SpecialistEditSheet` |
| Bulk roster archive | **None** | Gap for CLEANUP-001 UX |

### 2.4 Authentication dependencies (must preserve)

| Dependency | Cleanup rule |
|------------|--------------|
| MasterAdmin row + credentials | **Never** soft-remove or hard-delete via cleanup workflow; UI already blocks Remove |
| Hub-bridge PIN verify | Only loads `is_active=true` — archiving others does not touch Master login |
| `profiles` / `auth_user_id` links | Soft-delete preferred; hard delete nulls walkthrough/section soft FKs |
| Invited / suspended associates | Already excluded from login; safe archival targets if out of scope |

**Preserve operator MasterAdmin identity and credentials** — cleanup must exclude that row by hard rule, not rely on operator checkbox discipline alone.

### 2.5 Historical assignment references

| Artifact | Specialist link | Soft-archive effect | Hard-delete effect |
|----------|-----------------|---------------------|--------------------|
| `sunday_bay_assignments` | `roster_specialist_id` text + denorm name; profile SET NULL | Rows remain | Rows remain (text id may dangle) |
| `weekly_rotations` | `completed_by` text | Intact | Intact |
| Walkthroughs | companion / associate / responsible → SET NULL | Links preserved | UUID FKs null; text creator fields remain |
| Operational Sections | `primary_owner_specialist_id` SET NULL | Preserved | Nulls |
| `associate_shift_days` | soft text id | Orphans possible | Orphans |

**Preferred cleanup:** soft archive only. Do not pursue hard DELETE as the workspace cleanup path.

---

## 3. Historical integrity

### 3.1 Relationships that must remain intact

| Domain | Must keep | Why |
|--------|-----------|-----|
| Location UUIDs | Soft-retire, never hard-delete historied bays | `weekly_rotations.location_id`, service logs, seasonal relevance, exceptions CASCADE on location delete |
| Completion attempts | Parent rotation RESTRICT | Hard-delete of location can **fail** or erase evidence |
| Rotation history | Supersede model, not delete | Week ownership / verification truth |
| Sunday assignments | Survive specialist soft-archive | Named history + bay_id → rotation id |
| Bay verification | `last_completed_at` / week completion on location UUID | Soft-retire preserves cycle memory on UUID |
| Walkthrough observations / follow-ups | Place as `(department_id, aisle, bay)` soft refs; specialist SET NULL | Independent of rotation; do not rewrite bodies |
| Operational Sections events | Event history after section retire | Stewardship audit |
| Associate identities | Soft `is_active` tombstone | Prevents revive; keeps UUID for soft FKs |

### 3.2 Risk matrix

| Action | History risk | Recommendation |
|--------|--------------|----------------|
| Soft-retire locations | **Low** | Primary aisle cleanup path |
| Soft-archive associates | **Low** | Primary roster cleanup path |
| Hard-delete locations | **Critical** | Forbidden as cleanup primary path |
| Hard-delete associates | **Medium** | Avoid; nulls soft FKs |
| Reassign `department_id` on locations | **Medium** | Denorm drift on `weekly_rotations.department_id`; prefer soft-retire + fresh create under correct dept |
| Mid-week geography change under open ownership | **Medium** | Freeze/complete/supersede open weeks first |
| Full DB reset | **Critical** | Rejected |

### 3.3 Display hiding ≠ delete

Map can hide aisles with zero active bays when “Show retired” is off. That is presentation only. Soft-retire is what removes bays from rotation eligibility (`isEligibleRotationLocation`).

---

## 4. Proposed mobile cleanup workflow

**Goal:** One-time guided cleanup suitable for Samsung phone. Bulk, explicit confirm, minimal chrome. Compose existing soft APIs — do not invent hard-delete.

### 4.1 Placement (design)

- Entry: **More → Workspace cleanup** (one-time / advanced), MasterAdmin (or Supervisor+Master) only.
- Not on Map tiles (avoids accidental retire while walking).
- Not Sunday staging.

### 4.2 Flow A — Retire irrelevant aisles

```text
1. Review active aisles
   - List department name + aisle code + bay count
   - Key = departmentId:aisle (never aisle alone)
   - Optional filter: non-flooring departments first
2. Multi-select aisles (checkbox)
3. Preview consequences
   - N aisles · M physical bays · S surface rows
   - Will set is_active=false (UUIDs kept)
   - Rotation eligibility removed; history retained
   - Note open-week / staged ownership if any selected locations are on this week’s board
4. Explicit confirm
   - Type or hold-confirm: “Retire N aisles”
   - Default action = soft-retire only (no hard-delete option in this guided flow)
5. Execute patch loop (existing patchStoreLocation semantics)
6. Summary: retired counts; link to Map with Show retired available
```

### 4.3 Flow B — Archive irrelevant associates

```text
1. Review active roster (exclude MasterAdmin from selectable list)
2. Multi-select members
3. Preview consequences
   - Removed from Roster / Floor / Sunday eligibility / login
   - Historical Sunday + walkthrough links retained (soft)
   - Credentials on those rows become inert (cannot login) — Master untouched
4. Explicit confirm: “Archive N people”
5. Execute soft-remove (deleteSpecialist soft path; skip hard DELETE in guided flow)
6. Summary
```

### 4.4 Safety rules for the guided flow

1. Soft-retire / soft-archive only.  
2. MasterAdmin never selectable.  
3. Require confirm step; no swipe-to-delete bulk.  
4. Preview must show department+aisle, not aisle alone.  
5. Prefer between-week timing; warn if selected locations appear on current week rotations.  
6. Optional Phase-0: pause foreign `departments.is_active` when entire foreign dept is out of scope.  
7. No credential, auth, or RLS changes in the cleanup tranche.

### 4.5 What already exists vs what to build

| Need | Today | Build later |
|------|-------|-------------|
| Soft-retire surfaces | Bulk Clean-Up (single aisle) + Map toggle | Multi-aisle select + preview |
| Soft-archive people | Per-member Remove | Multi-select + preview; suppress hard DELETE |
| Confirm gate | Clean-Up confirm checkbox | Stronger bulk confirm copy |
| Consequence preview | Physical bay count on Clean-Up | History/open-week warnings |
| Master protection | UI Remove hidden | Enforce in API/workflow too |

---

## 5. Map presentation opportunities (FUTURE — do not implement now)

**Milestone note only.** No Map redesign in CLEANUP-001.

### 5.1 Status conflation (current)

Aisle cards use `classifyMapReadiness` → rose “Needs attention” for **both**:

- Open barriers (`hasBarrier`)
- Stale / never-verified coverage (`last_completed_at` null or age > 7 days)

Scheduled work (`scheduled` / amber) and verified coverage (`verified` / green) are distinct tones, but aisle **progress text** only shows covered + attention counts — omitting “this week” and “remaining.”

SI-001 attention (pressure / actionability) paints bay-row Med/High chips and Walk sheet — **not** aisle-tile glyphs. Operators can experience two “attention” languages at bay level.

### 5.2 Data already available for clearer distinctions

| Distinction | Existing inputs |
|-------------|-----------------|
| Uncovered / stale | `last_completed_at`, `BAY_STALE_DAYS` |
| Actual exceptions | `barrierLocationIds` / exception summary |
| Scheduled work | `weekRotationLocations` / `inCurrentWeekRotation` |
| Verified coverage | week completion + `last_completed_at` in ISO week |
| Stewardship | `BaySectionLookup` (sheet only today) |
| Department identity | `department_id` / name / code (collision labels only on tiles) |

No new schema required for a later Map clarity pass — compose existing readiness inputs without collapsing barrier vs stale.

### 5.3 Mobile card hierarchy observations

| Issue | Observation |
|-------|-------------|
| Truncated aisle labels | `truncate` on `formatMapAisleLabel`; collision labels add `· {departmentName}` on narrow 2-col tiles |
| Department identification | UUID never shown; name only on collision; code on Walk sheet chrome only |
| Operational Section visibility | Fetched on Map; shown on Walk sheet only — not aisle tiles or bay rows |
| Card hierarchy | Glyph + cadence strip → aisle title → bay/coverage meta → optional High chip |

**Defer** to a future Map experience milestone (post-cleanup / post-topology cutover).

---

## 6. Rotation dependencies

### 6.1 Canonical intended capacity

```text
4 people × 3 bays = 12 bays TOTAL
shared across Flooring + Home Decor
NOT 12 bays per department
```

### 6.2 Implemented today

| Layer | Behavior |
|-------|----------|
| Engine | `resolveAutomaticWeeklyBayTarget(eligible) = eligible × 3` **per active department** |
| Sunday loop | `runSundayDispatchForAllDepartments` stages each `departments.is_active=true` independently |
| Presentation | `SHARED_TEAM_CAPACITY_SLOTS = 4` / capacity 12 cited; engine does not enforce shared pool |
| Current merge accident | Single `flooring` dept prevents live double×3 — risk appears when second dept auto-stages |

### 6.3 Cleanup effects on rotation

| Cleanup action | Effect |
|----------------|--------|
| Soft-retire foreign aisles | Removes them from PENDING/draw pools — **required** before dual-dept geography |
| Soft-archive inactive associates | Reduces `eligibleCount` inflation — **required** for honest ×3 |
| Pause foreign departments | Skips them in Sunday loop |
| Does **not** create shared 12-bay guard | Still need **CAPACITY-GUARD-001** before second-dept auto-stage |

### 6.4 Explicit non-goals for cleanup follow-on

- Do **not** modify Sunday Stage+Assign core.  
- Do **not** activate dual-department automatic assignment.  
- Do **not** change `BASE_WEEKLY_BAY_QUOTA`.  

### 6.5 Dependencies to resolve before dual-dept auto-assign

```text
Operator aisle/people map
  → Soft-retire out-of-scope aisles
  → Soft-archive out-of-scope associates (keep MasterAdmin)
  → Pause foreign departments (optional but recommended)
  → Freeze/complete/supersede open staged weeks
  → CAPACITY-GUARD-001 (shared ≤12 / no double×3)   ← blocking
  → Additive Home Decor + bulk rebuild (ALIGN-DEPT / TOPO cutover)
  → Dual-dept automatic assignment
```

---

## 7. Implementation recommendations

### 7.1 Recommended next tranche (when authorized)

**CLEANUP-002 — Guided Workspace Cleanup (mobile)**  

Scope:

1. More → Workspace cleanup wizard (aisles then roster).  
2. Multi-select + preview + confirm.  
3. Soft-retire locations only; soft-archive associates only (no hard DELETE).  
4. Hard-exclude MasterAdmin.  
5. Department+aisle identity in all copy.  
6. Tests for eligibility exclusion + Master protection + no hard-delete path.  
7. Docs: journal / handoff / roadmap.

Out of scope for CLEANUP-002: Home Decor department insert, capacity guard, Map redesign, auth, RLS, Sunday engine, hard-delete UI.

### 7.2 Operator prep before CLEANUP-002

1. Run `scripts/sql/align-topo001-topology-inventory-readonly.sql` (or authorize read-only inspection).  
2. Mark aisles: keep (Flooring / Home Decor) vs retire.  
3. Mark associates: keep vs archive (Master stays).  
4. Prefer cutover between weeks.

### 7.3 Sequencing relative to ALIGN-DEPT / capacity

| Order | Tranche | Role |
|-------|---------|------|
| 1 | CLEANUP-001 (this) | Discovery |
| 2 | CLEANUP-002 | Guided soft cleanup UX |
| 3 | Operator executes cleanup | Active workspace = intended geography/people |
| 4 | CAPACITY-GUARD-001 | Shared 4×3 before second auto-stage |
| 5 | ALIGN-DEPT / TOPO cutover | Additive Home Decor + bulk rebuild |
| Later | Map clarity milestone | Barrier vs stale vs scheduled vs verified |

### 7.4 Reuse, do not duplicate

- Location pause: existing `patchStoreLocation({ is_active })`.  
- Associate archive: existing soft path of `deleteSpecialist` (guided flow should **stop before** hard DELETE).  
- Inventory script: already written for TOPO-001.  
- Do not build a second topology delete engine.

---

## 8. GO / NO-GO assessment

| Gate | Verdict | Notes |
|------|---------|-------|
| CLEANUP-001 discovery | **GO — COMPLETE** | Report only; stop here |
| Production SQL / mutations | **NO-GO** | Explicit exclusion |
| Hard-delete as cleanup | **NO-GO** | History CASCADE / RESTRICT |
| Guided soft-cleanup implementation | **CONDITIONAL GO** | Needs operator keep/retire lists |
| Map redesign | **NO-GO** (deferred) | Observations recorded in §5 |
| Dual-dept Sunday auto-assign | **NO-GO** | Blocked on CAPACITY-GUARD-001 |
| MasterAdmin credential changes | **NO-GO** | Preserve identity |

---

## 9. Verification performed

| Check | Result |
|-------|--------|
| Topology / Bulk Clean-Up / Map pause | Inspected |
| Operational Sections retire model | Inspected |
| Roster soft-delete + Master UI guard | Inspected |
| Walkthrough / rotation / Sunday FK posture | Inspected |
| Map readiness conflation | Inspected (`map-readiness.ts`, `StoreLocationGrid`) |
| Sunday eligible×3 + dual-dept loop | Inspected (`sunday-dispatch.ts`, `week.ts`) |
| ALIGN-TOPO-001 / RD-6 alignment | Cross-read |
| Production inventory SQL this tranche | **Not executed** |
| Application code / migrations / deploy / commit | **None** |

---

## Appendix — Safe cleanup cheat sheet

```text
KEEP identities: store_locations.id · store_specialists.id (MasterAdmin always)

RETIRE aisles:  is_active = false on all surfaces for department+aisle
ARCHIVE people: is_active = false, status = suspended (skip MasterAdmin)
PAUSE depts:    departments.is_active = false for out-of-scope codes

NEVER as primary cleanup: DELETE store_locations · DELETE store_specialists
NEVER: aisle-number-only selection · mid-week blind reassignment · double×3 auto-stage
```

---

*End of DEPTSYNC-CLEANUP-001. Stop after reporting.*
