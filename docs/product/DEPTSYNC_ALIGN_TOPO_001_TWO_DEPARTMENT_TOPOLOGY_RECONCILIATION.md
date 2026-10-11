# DEPTSYNC-ALIGN-TOPO-001 — Two-Department Topology Reconciliation

**Status:** COMPLETE (discovery + implementation design only)  
**Date:** 2026-10-10  
**Mode:** Read-only discovery + design  
**Authority:** Constitution Art. II-A; ALIGN-002 C-1 (migration UNRESOLVED); operator direction that active topology may be rebuilt via bulk creation while historical evidence must remain intact  

**Not authorized by this tranche:** application code changes, schema migrations, location delete/archive/reassignment, rotation history reset, production mutation, deploy, commit, push.

---

## Layer legend (do not collapse)

| Layer | Meaning in this report |
|-------|------------------------|
| **IMPLEMENTED** | Running codebase / schema shape today |
| **APPROVED TARGET** | Ratified by ALIGN-001 → ALIGN-002 / Constitution |
| **UNRESOLVED** | Must not be assumed; needs operator decision or production evidence |
| **DEFERRED** | Approved direction but not scheduled for this design |

---

## Executive verdict

The smallest safe path is a **hybrid**:

1. **Retire** obsolete / out-of-scope locations from *active* use with `store_locations.is_active = false` (and deactivate non-scope department rows with `departments.is_active = false`) — **do not hard-delete**.  
2. **Introduce** a distinct Home Decor department row (`code` TBD by operator; design default `home_decor`).  
3. **Rebuild** the desired Flooring and Home Decor active aisle/bay geography through the existing Bulk Generator (physical-bay-first BOTH surfaces).  
4. **Preserve** location UUIDs wherever history already points at them; treat hard delete as unsafe once completion attempts exist.  
5. **Protect** the rotation engine so two active departments do **not** silently run `eligible × 3` twice.

A full database reset is **not** required and is **not** recommended.

---

## A. Current topology architecture

### A.1 Identity stack (IMPLEMENTED)

```text
stores (store_number, id)
  └── departments (id, store_id, code UNIQUE per store, name, weekly_bay_target, is_active)
        └── store_locations (id UUID, department_id, aisle TEXT, bay INT, type SELLING|TOPSTOCK,
                             status, is_active, cycle fields, velocity/priority/seasonal-adjacent fields)
```

| Concept | Owner | Notes |
|---------|-------|-------|
| Department record | `departments` | Seeded via `STORE_DEPARTMENT_TEMPLATES` + migration; `unique (store_id, code)` |
| Department code | `departments.code` | Hub aliases via `lib/store-ops/department-codes.ts` (`flooring` ≡ `D23`) |
| Aisle | `store_locations.aisle` | Alphanumeric TEXT (BW, RW, 12, …) after `20260811_alphanumeric_aisle.sql` |
| Bay | `store_locations.bay` | Integer ≥ 0 |
| Surfaces | `type` ∈ `SELLING` \| `TOPSTOCK` | Topology faces; not separate coverage jobs (BAY-UNIT-002) |
| Location UUID | `store_locations.id` | Stable identity for history FKs |
| Active location | `store_locations.is_active` | Pause flag; excluded from rotation eligibility when false |
| Active department | `departments.is_active` | Cron / draw skip when false (`rotations.ts`) |
| Physical coverage key | `(department_id, aisle, bay)` | `lib/store-ops/physical-bay.ts` — not UUID, not surface type |
| Surface uniqueness | `(department_id, aisle, bay, type)` | Bulk upsert conflict target |

### A.2 How Map identifies and renders locations (IMPLEMENTED)

- Map tab: `components/hub/tabs/MapTab.tsx` → `StoreLocationGrid` with `canMutate=false`.  
- Loads **all** store locations via `fetchStoreLocationsDetailed` (API does **not** filter out `is_active=false` — paused faces remain visible for Manage).  
- Working-department pin (`lib/admin-department-context.ts`) filters visible departments/locations when pin ≠ `all`.  
- Geography language is physical-bay-first (UX-REDUCE-003); Sell/Top are secondary presence.  
- Topology mutation lives in More → Department Setup (`AisleBayManager`, Bulk Generator, Edit Bay) — not on Map.

### A.3 Bulk / edit / delete surfaces (IMPLEMENTED)

| Capability | Where | Behavior |
|------------|-------|----------|
| Bulk create | `BulkLocationGenerator` + `POST /api/store-locations/bulk` | Department · Aisle · Bay range · Odd/Even · Create; internal BOTH (`NORMAL_BULK_SURFACE_TYPES`); upsert on `(department_id,aisle,bay,type)` |
| CSV batch | Same component (power path) | Preserved; not required for normal rebuild |
| Clean-Up | Bulk “cleanup” tab | Hard-deletes matched location IDs via `deleteStoreLocations` |
| Add single bay | `AddBaySheet` | BOTH surfaces |
| Edit | `EditBayDrawer` | Can change aisle / bay / **department_id**; hard-delete faces (Master) |
| Pause / resume | Map/Manage `is_active` toggle | Soft retire from rotation without deleting UUID |
| Hard delete | `DELETE /api/store-locations` | Super Admin; documented as cascading `weekly_rotations` |

### A.4 Seed / template reality (IMPLEMENTED)

`lib/store-ops/stores.ts` `STORE_DEPARTMENT_TEMPLATES` still includes Appliances, Plumbing, Electrical, Paint, Gardens, Millwork, Cabinets, Tools, Building Materials — plus merged **Flooring / Home Decor** (`code = flooring`).

New-store seed sets `is_active: true` **only** for `flooring` (`ignoreDuplicates: true`). Existing production rows seeded by older migrations may still be `is_active = true` for other codes — **production inventory required** (see §J).

---

## B. Department merge assumptions

| Layer | Fact |
|-------|------|
| **IMPLEMENTED** | One department: `code = flooring`, display name `Flooring / Home Decor` |
| **IMPLEMENTED** | Explicit absorb comment in `supabase/migrations/20260809_weekly_rotation_cron.sql`: “Flooring absorbs Home Decor (no separate Home Decor department)” |
| **IMPLEMENTED** | Hub meta: `DEPARTMENT_META.flooring.label = "Flooring / Home Decor"`, description “merged” (`lib/types.ts`) |
| **IMPLEMENTED** | No `home_decor` (or equivalent) in `STORE_OPS_DEPARTMENT_CODES` |
| **IMPLEMENTED** | No location column distinguishing Flooring vs Home Decor inside the merge |
| **APPROVED TARGET** | Flooring and Home Decor as separate first-class departments (Constitution Art. II-A) |
| **UNRESOLVED (pre-this tranche)** | Migration strategy — this report proposes one; operator still must approve mapping + codes |
| **Hardcoded merge signals** | Labels/meta/templates/seeds; roster job options default Home to `flooring`; JWT/hub treat `D23` ≡ `flooring` |

Blind automated split from repository data alone remains **impossible** — there is no durable Flooring-vs-Home-Decor signal inside merged topology.

---

## C. Physical location identity model

### C.1 What must stay stable for history

| Identity | Role |
|----------|------|
| `store_locations.id` (UUID) | FK target for rotations, service logs, seasonal location relevance, appliance scans (nullable), exceptions |
| `(department_id, aisle, bay)` | Physical coverage obligation (BAY-UNIT-002) |
| `(department_id, aisle, bay, type)` | Surface row uniqueness / bulk upsert key |
| `departments.id` | Scoped filters, RLS department matching, rotation `department_id` denormalized on weekly rows |

### C.2 What reassignment changes

Moving `store_locations.department_id` **preserves UUID** but:

- Changes physical-bay key (department is part of the key).  
- Changes which department Map/Floor/rotation pools see the bay in.  
- Leaves historical `weekly_rotations.department_id` potentially **out of sync** with the location’s new department unless rewritten (semantic drift).  
- Triggers `store_locations_sync_department_code` (denormalized `department_code` on location).

**Design rule:** Do not blind-reassign. Prefer soft-retire + fresh create under the correct department when the operator is rebuilding geography anyway.

### C.3 Upsert nuance (useful for rebuild)

Bulk create uses upsert on `(department_id, aisle, bay, type)`. Re-creating the **same** department+aisle+bay+type **preserves the existing UUID** and may reset create-time fields per upsert payload (`status: PENDING`, `cycle_number: 1`, etc.). That is operationally convenient but can **rewrite coverage cycle memory** on matched keys — treat as intentional cutover behavior, not a silent no-op.

---

## D. Historical dependency matrix

For each dependency: **A** what identifies location · **B** UUID ref · **C** department ref · **D** delete cascade · **E** reassignment effect · **F** archive support today.

| Dependency | A | B UUID | C dept | D On delete | E Reassignment / meaning | F Archive today |
|------------|---|--------|--------|-------------|--------------------------|-----------------|
| `store_locations` | Own UUID + physical key | self | `department_id` | Parent of many | Dept move changes key + filters | `is_active` pause only |
| `weekly_rotations` | `location_id` + `assigned_week` | **Yes** FK | `department_id` (denorm) | Location → **CASCADE** rotations | Location dept move leaves rotation dept stale unless updated; week identity stays on UUID | Supersede (`superseded_at`) — not location archive |
| `weekly_rotation_completion_attempts` | Parent rotation id | Indirect | Via parent | Parent rotation → **RESTRICT** | History tied to rotation/location UUID | None (intentional preserve) |
| `rotation_exceptions` | `bay_id` / prod shape `location_id` + `rotation_id` | **Yes** (repo + prod shapes) | `department_id` | Location → **CASCADE** (repo migration) | Barriers follow location UUID; dept filter may drift | None |
| `sunday_bay_assignments` | `bay_id` = **weekly_rotations.id** (text) | Indirect (rotation id) | `department` **text code** | No FK to locations; specialist SET NULL | Survives location UUID if rotation row remains; breaks if rotation cascaded away | Status enum only |
| `bay_service_logs` | `location_id` | **Yes** CASCADE | Denorm `department_code` | Location → **CASCADE** | Walk intensity history deleted with hard delete | None |
| `operational_context_location_relevance` | `location_id` | **Yes** CASCADE | Via location / context | Location → **CASCADE** | Seasonal relevance deleted with hard delete | NONE/UNSET rows, not archive |
| `appliance_scans.location_id` | Optional bay | **Yes** SET NULL | — | Location delete → null | History kept; bay link cleared | Specialty dormant |
| `bay_audit_logs` | Historical specialty | rotation SET NULL | `department_id` CASCADE | Dept delete cascades logs | Preserved as orphan historical table | No runtime owner (SNAP-RETIRE) |
| `manager_notes` | Free-text aisle/bay; `department` / `department_code` text | No UUID FK | Text code | — | Notes remain; code may say `flooring` after split | Floor Pad protected |
| `shift_walk_tasks` | Optional `location_id` **text**; `department` text | Soft / text | Text | — | May dangle if UUID deleted | Walk & Talk protected |
| Roster `store_specialists` | Home / assigned / accessible **codes** | — | Codes | — | Must be coordinated after split | `is_active` on person |
| Coverage fields on location | status, last_completed_at, carry, priority | On UUID | — | Lost on hard delete | Soft-retire preserves | `is_active` |

**Critical safety fact:** Completing a hard delete of a location that still has `weekly_rotations` with completion attempts can **fail** (`ON DELETE RESTRICT` on attempts → blocks rotation delete → blocks location delete). Even when delete “succeeds,” CASCADE erases rotation/service/seasonal evidence. **Display hiding ≠ safe delete.**

---

## E. Delete / archive / reassignment safety

| Action | Safe for history? | Safe for active ops? | Notes |
|--------|-------------------|----------------------|-------|
| `is_active = false` on location | **Yes** — UUID + FKs intact | Removes from eligibility | Map still lists paused faces (by design) |
| `departments.is_active = false` | **Yes** | Skips inactive depts in rotation paths | Does not hide historical rows |
| Reassign `department_id` keeping UUID | Preserves UUID history | Risky without rewriting denorm rotation dept + operator mapping | Forbidden as blind migration |
| Hard delete location | **Unsafe** once attempts/logs/rotations exist | Removes from Map | Clean-Up / Edit delete use this path today |
| Bulk upsert same key | Preserves UUID | May reset PENDING/cycle seeds | Cutover caveat |
| Full DB reset | Destroys evidence | Simple ops | **Rejected** by Constitution + this design |

**Archive:** There is **no** dedicated `archived_at` / soft-delete tombstone beyond `is_active`. Soft-retire via `is_active` is the supported non-destructive “retire from active use” mechanism today.

---

## F. Existing bulk creation capabilities

Inspected: `components/admin/BulkLocationGenerator.tsx`, `lib/store-ops/bulk-mapping-session.ts`, `lib/store-ops/locations.ts`, BULK-SETUP-001/002 docs.

| Need | Supported today? |
|------|------------------|
| Select Flooring or Home Decor | **Partial** — any department in the loaded list; Home Decor row **does not exist** yet |
| Create aisles + bay ranges | **Yes** |
| Alphanumeric aisle IDs | **Yes** (`normalizeAisle` / validation) |
| Selling + Topstock | **Yes** — internal BOTH (BULK-SETUP-002) |
| Duplicate prevention | **Upsert** on unique key (idempotent recreate); Clean-Up hard-deletes ranges |
| Edit mistakes | Edit Bay + Clean-Up + `is_active` pause |
| Retire obsolete locations | **Soft:** `is_active` toggle · **Hard:** Clean-Up / delete (unsafe for history) |
| Operator avoids SQL for normal topology | **Yes** for create/edit/pause within existing departments |

**CSV:** Available but not required for this reconciliation. Prefer extending department list + active-scope filtering over inventing a new import path.

**Gap for target:** Bulk UI cannot select Home Decor until a department row + hub code/meta exist. Soft-retire of *other* departments’ aisles is possible today per-location / Clean-Up, but bulk “retire whole foreign department” is not a first-class guided workflow.

---

## G. Recommended reconciliation strategy

### Approaches compared

| | A. Reassign keeping UUIDs | B. Retire obsolete (soft) | C. Fresh bulk create | D. Hybrid (recommended) |
|--|---------------------------|---------------------------|----------------------|-------------------------|
| Historical integrity | High if UUID kept; dept denorm drift risk | Highest for retired rows | New UUIDs = new history lineage; old rows must remain | High — old UUIDs retained inactive; new active geography clean |
| Operational simplicity | Low without mapping | Medium | High (operator comfort) | High after short prep |
| Migration risk | High if blind | Low | Medium (duplicate keys / cycle reset) | Low–medium |
| Duplicate handling | Conflict if both old+new | Avoids duplicates in draw | Upsert within dept | Soft-retire clears eligibility before create |
| Rotation continuity | Confusing mid-week | Clean if done between weeks | Clean if staged weeks closed first | Close/freeze in-flight weeks, then cut over |
| Implementation complexity | High (rewrite denorm + roster) | Low | Low UI; needs `home_decor` row | Moderate, phased |
| Operator effort | Mapping spreadsheet + verify | Toggle/deactivate | Rebuild aisles intentionally | Mapping + rebuild (accepted) |

### Recommendation: **D — Hybrid**

**Phase intent (design only — not executed here):**

1. **Inventory** production (operator SQL script §J).  
2. **Decide codes + aisle ownership** (operator §L).  
3. **Freeze / complete** in-flight staged weeks for affected departments.  
4. **Soft-retire** out-of-scope locations (`is_active=false`); deactivate non-scope departments.  
5. **Add** Home Decor department (additive insert; rename Flooring display to “Flooring”).  
6. **Bulk-create** active Flooring / Home Decor geography.  
7. **Wire** hub codes, roster homes, accessible departments, active-scope UI filter.  
8. **Rotation capacity guard** so two departments ≠ double automatic workload.  
9. **Leave** historical rows and inactive UUIDs in place indefinitely unless a later reviewed purge plan says otherwise.

**Reject:** full reset; blind reassignment; Clean-Up hard-delete of historically used bays as the primary retire tool.

---

## H. Flooring / Home Decor separation design

### H.1 Department table support (no destructive change required)

The `departments` table **already** supports multiple first-class rows per store (`unique (store_id, code)`). Separation is an **additive insert** + label/code updates, not a table rewrite.

| Row | Proposed (design default — operator may override) | Status |
|-----|---------------------------------------------------|--------|
| Existing | Keep `code = flooring`, rename `name` → `Flooring` | **APPROVED TARGET** naming |
| New | `code = home_decor` (or Lowe’s-style code if operator prefers), `name = Home Decor`, `is_active = true` | **UNRESOLVED** exact code |
| Others | Remain in DB; `is_active = false` for active workspace | **APPROVED TARGET** exclusion from active workflows |

### H.2 Historical association

- Historical rotations / attempts / logs that point at old `flooring` location UUIDs **remain** associated with those UUIDs and the original `weekly_rotations.department_id` unless a later explicit rewrite is approved.  
- Prefer **not** rewriting history when soft-retire + fresh create delivers a clean active map.  
- Floor Pad / walk tasks with text `department = flooring` remain valid historical prose/context.

### H.3 Roster relationship

| Concept | Today | After split (design) |
|---------|-------|----------------------|
| Canonical workspace | `assigned_department` / accessible codes | Operator + CSA → Home Decor; Specialists → Flooring (per Constitution staffing table — confirm) |
| `home_department` | Optional grouping | Align labels; `assigned_department` remains canonical |
| Accessible departments | Often `["flooring"]` | Operator needs **both** codes for dual-department supervision |
| App users | Multi-role chrome still IMPLEMENTED | Team members remain records (APPROVED TARGET); auth simplification DEFERRED |

### H.4 Query / filter assumptions to update (future implementation — not now)

- `STORE_OPS_DEPARTMENT_CODES` / `DEPARTMENT_META` / `HUB_TO_CODE`  
- `STORE_DEPARTMENT_TEMPLATES` + `ensureDepartmentsForStore`  
- Active-scope helpers (new): Map/Floor/Bulk default lists = Flooring + Home Decor only  
- Sunday dispatch / cron: per-department loops must respect shared capacity (§I)  
- JWT / RLS `jwt_matches_department_code` families for new code  
- Roster job option for Home Decor CSA (today only `flooring_csa` / `flooring_specialist`)

### H.5 Active or staged weekly rotations

**UNRESOLVED operational choice** (operator must pick before cutover):

1. Complete/verify current week, then cut over Sunday; or  
2. Supersede/clear staged unowned plans for obsolete geography; or  
3. Freeze draw until rebuild finishes.

Do not mid-week reassign location departments under open ownership.

---

## I. Rotation compatibility requirements

### I.1 What must remain intact (IMPLEMENTED + APPROVED TARGET)

| Rule | Source |
|------|--------|
| Deterministic engine stays independently functional | Constitution / ALIGN-002 |
| Initial default: **3 bays per eligible person per week** | `BASE_WEEKLY_BAY_QUOTA = 3` |
| Four-person operational team | APPROVED TARGET staffing |
| Capacity eventually operator-configurable | APPROVED TARGET (UI DEFERRED) |
| **No automatic workload doubling** because there are two departments | Constitution Art. V.2 |
| Permanent section ownership ≠ weekly assignment ≠ work performed | Art. III-A — section schema DEFERRED |
| Section-aware rotation | APPROVED TARGET — **do not implement in TOPO-001 follow-on without separate tranche** |

### I.2 How topology reconciliation can break the engine

| Risk | Mechanism | Mitigation (design) |
|------|-----------|---------------------|
| Double Sunday volume | Cron/stage runs `eligible × 3` **per active department** | Shared capacity budget across Flooring+Home Decor **or** stage only one “coverage department” until capacity UI exists |
| Empty Home Decor pool | New dept with no active locations | Bulk-create before enabling auto-stage on that dept |
| Stale eligibility | Soft-retired bays left `is_active=true` | Inventory + pause pass |
| Physical-key split | Same aisle/bay numbers under two dept UUIDs | Allowed and desired; ensure UI labels prevent operator confusion |
| Upsert cycle reset | Matched keys reset PENDING/cycle | Prefer soft-retire old keys rather than upsert-reset if cycle memory matters |
| Accessible roster scope | Specialists only on Flooring; CSA on Home Decor | Eligibility composition must still yield sustainable total (not 4×3×2) |

### I.3 Required compatibility work (future tranches — not TOPO-001 code)

1. **Capacity composition law** for dual-department active scope (shared 4×3 unless operator configures otherwise).  
2. Active-department allowlist in Sunday orchestration.  
3. Hub/code registration for `home_decor`.  
4. Explicit non-goal: section-aware selection (SECTION-001 later).

---

## J. Production evidence gaps

| Gap | Evidence status |
|-----|-----------------|
| Live department row set + `is_active` flags | **Not inspected this tranche** (no authorized production SQL execution) |
| Location counts by `department_id` / code | Unknown now; PRIORITY-UX-001 (2026-09-18) saw **584** active surface rows / **292** physical bays — **no per-department breakdown** in that report |
| Whether foreign-department aisles are present | Operator reports Map shows aisles outside responsibility — plausible; confirm with script |
| Open completion attempts / in-flight weeks | Unknown |
| Roster accessible / home codes | Unknown |
| Whether `home_decor` already exists | Repository says no; production should confirm |

**Repository fixtures and seeds are not production truth.**

### Operator script (read-only)

Created for operator execution in Supabase SQL Editor:

`scripts/sql/align-topo001-topology-inventory-readonly.sql`

- SELECT-only  
- No credentials printed  
- Aggregates / metadata only (no personal names, PINs, note bodies)  
- **Do not run from agent tooling without separate authorization**

---

## K. Proposed implementation tranches

| Tranche | Mode | Purpose |
|---------|------|---------|
| **TOPO-001** (this) | Discovery + design | Complete — await operator review |
| **TOPO-001A** | Operator evidence | Run read-only SQL; answer §L decisions |
| **ALIGN-DEPT-001** / **TOPO-002** | Design lock + dry-run plan | Freeze codes, mapping, capacity rule, cutover weekend; still no prod mutation until authorized |
| **TOPO-003** | Additive schema/app | Insert `home_decor`; hub meta/codes; active-scope filter; templates; **no history delete** |
| **TOPO-004** | Operator-led rebuild | Soft-retire obsolete; Bulk create Flooring/Home Decor; pause foreign depts |
| **TOPO-005** | Rotation guard | Shared capacity / dual-dept Sunday safety; verify eligible×3 total |
| **Later** | SECTION-001 etc. | Section ownership overlay — after topology truth exists |

Do not auto-start SECTION-001, walkthrough storage, or auth simplification from this report.

---

## L. Operator decisions genuinely required

1. **Authoritative aisle/bay map** — which aisles (and partial bay ranges, if any) are Flooring vs Home Decor vs neither.  
2. **Home Decor department code** — accept design default `home_decor`, or supply Lowe’s-style code.  
3. **Keep vs rebuild Flooring geography** — soft-retire+recreate all Flooring aisles, or keep matching `flooring` UUIDs and only add Home Decor.  
4. **Disposition of other departments’ locations** — soft-retire only, also set `departments.is_active=false`, or leave rows but hide via UI allowlist.  
5. **Roster home/access codes** after split (Specialists / CSA / operator).  
6. **Cutover timing** for open staged weeks (complete vs supersede vs freeze).  
7. **Dual-department capacity rule** until configurable UI exists: shared `eligible × 3` across both depts (recommended default) vs temporary single-pool staging.  
8. **Confirm production inventory** by running the read-only SQL script and returning aggregates (or authorizing a read-only inspection tranche).

---

## M. Risks and rollback considerations

| Risk | Severity | Rollback |
|------|----------|----------|
| Hard-delete used as “cleanup” | **Critical** — history loss / RESTRICT failures | Avoid; restore only from backups if executed |
| Double Sunday workload | **High** — constitutional violation of sustainable capacity | Disable second dept auto-stage; redeploy capacity guard |
| Upsert resets cycle memory on reused keys | Medium | Soft-retire old keys; create under new dept instead of clobbering |
| Mid-week dept reassignment | Medium — ownership confusion | Cut over between weeks |
| Hub code mismatch (`home_decor` not in JWT/RLS family) | Medium — empty Map / 403 | Keep feature-flagged until codes wired |
| Operator mapping error | Medium | Soft-retire mistaken aisles; bulk recreate; history still on old UUIDs |
| Leaving foreign depts active in UI | Low–Medium — Map clutter (current pain) | `is_active` + allowlist |

Rollback for additive department insert: set new dept `is_active=false`, restore flooring display name, re-point roster codes — **without deleting** new location UUIDs if any history attached.

---

## N. Verification performed

| Check | Result |
|-------|--------|
| Read `DEPTSYNC_CONSTITUTION.md` Art. I / II-A / V | Done — separate first-class depts = APPROVED TARGET; migration was UNRESOLVED |
| Read `DEPT_SYNC_STATE.md` ALIGN-002 A/B/C/D | Done |
| Read `ARCHITECTURE.md` Map/topology ownership | Done |
| Read `MASTER_ROADMAP.md` ALIGN / ALIGN-DEPT-001 | Done — ALIGN-DEPT-001 still NOT STARTED; TOPO-001 feeds it |
| ALIGN-001 blueprint | **No standalone repo file**; direction ratified via ALIGN-002 + Constitution (planning COMPLETE) |
| ALIGN-002 ratification §5 topology investigation | Done — extended here with FK/cascade/bulk/rotation depth |
| Schema/migrations for locations, rotations, attempts, Sunday, service logs, seasonal | Done |
| Bulk Generator + BULK-SETUP-002 | Done |
| Physical bay + eligibility + Sunday dispatch quota | Done |
| Production SQL this tranche | **Not executed** (boundary) |
| Application code / migrations / deploy / commit | **None** |

---

## Appendix — Approach decision summary

```text
Operator comfort: rebuild active topology via bulk
Constitution: preserve historical evidence; two first-class depts; no workload doubling

=> Soft-retire obsolete (is_active)
=> Additive Home Decor department
=> Bulk-create active Flooring + Home Decor
=> Keep old UUIDs for history
=> Guard rotation capacity across both departments
=> No full reset; no blind reassignment; no hard-delete primary path
```

---

*End of DEPTSYNC-ALIGN-TOPO-001. Stop for operator review.*
