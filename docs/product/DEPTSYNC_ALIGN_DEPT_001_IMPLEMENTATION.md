# DEPTSYNC-ALIGN-DEPT-001 — Flooring + Home Decor Operational Alignment

**Status:** COMPLETE — **released** via [`DEPTSYNC_ALIGN_DEPT_001_RELEASE.md`](./DEPTSYNC_ALIGN_DEPT_001_RELEASE.md) (`57334ee`)  
**Date:** 2026-10-14  
**Mode:** Focused discovery + evidence-based implementation  
**Authority:** Mission brief · Redesign-001 · MAP-001/004 · TOPO-001 · CAPACITY-GUARD · Constitution Art. II-A · RELEASE-006 accepted baseline  
**Production baseline:** store **2587** · four Operational Sections · **160** bay memberships · Sunday auto-stage **OFF**

**Not authorized by the implementation tranche (release later separately):** production migrations, aisle redistribution, section rebuild, Home Decor department insert, dual-department auto-stage enablement.

---

## 1. Current department architecture

| Layer | Evidence | Reality |
|-------|----------|---------|
| Active Floor Command department | TOPO-001; CAPACITY-GUARD-001 prod read; `STORE_DEPARTMENT_TEMPLATES` | One row: `code = flooring`, name **Flooring / Home Decor** |
| Separate Home Decor department | TOPO-001; inventory SQL probe; hub codes | **Does not exist** — no `home_decor` in `STORE_OPS_DEPARTMENT_CODES` |
| Intra-department Flooring vs Home Decor signal | Schema / locations | **None** — no aisle/bay ownership column |
| Hub meta | `DEPARTMENT_META.flooring` | `label = "Flooring / Home Decor"` (merged); compact `shortLabel = "Flooring"` |
| Seed history | `20260809_weekly_rotation_cron.sql` | Explicit absorb: Flooring absorbs Home Decor |
| Architecture tag (this tranche) | `FLOOR_COMMAND_DEPARTMENT_ARCHITECTURE` | `merged_flooring_home_decor` |

```text
stores
  └── departments (flooring = "Flooring / Home Decor")   ← sole active FC dept
        ├── store_locations (department_id, aisle, bay, type, location_type)
        ├── store_aisles (registry shells, incl. named specialty codes)
        ├── operational_sections (department_id + primary_owner)
        │     └── operational_section_members (department_id, aisle, bay)
        ├── weekly_rotations / sunday_bay_assignments (department-scoped)
        └── walkthroughs / follow-ups / week bay priorities (place → department_id)
```

**Flooring representation:** the merged `flooring` department and all of its active aisle/bay topology.  
**Home Decor representation today:** same department row and same geography — not a separate department, not a persisted aisle partition.

---

## 2. Flooring coverage

| Concern | Status |
|---------|--------|
| Map aisle→bay navigator | Covered under `flooring` |
| Operational Sections (4) | Covered; stewardship aisles Tyson 5·6 / Nate 7·39·40 / Nick 43·44 / Tracy 41·42 |
| 160 bay memberships | Covered; zero-overlap production invariant from SECTION-ROTATION-003 |
| Weekly rotation + shared capacity | Covered; CAPACITY-GUARD-002 store-week shared capacity live |
| Walkthroughs / follow-ups / MAP-002 context / MAP-003 priorities | Covered |
| Named specialty non-rotation (MAP-004) | Covered for documented codes |

Stewardship aisles above are **section ownership**, not a Flooring-vs-Home-Decor partition. This tranche did **not** redistribute them.

---

## 3. Home Decor coverage

| Capability | Classification | Notes |
|------------|----------------|-------|
| Store Map | **ALREADY SUPPORTED** | Same Map under merged dept; dual-dept collision labels already coded if two depts ever exist |
| Operational Sections | **ALREADY SUPPORTED** | Department-scoped; HD places would use same membership model if present under `flooring` |
| Weekly Rotation | **ALREADY SUPPORTED** | Eligible `STANDARD` bays in merged dept |
| Walkthrough observations | **ALREADY SUPPORTED** | Place-bound via `department_id` + aisle + bay |
| Follow-up tracking | **ALREADY SUPPORTED** | WALK-005/006 |
| Supervisor priorities | **ALREADY SUPPORTED** | MAP-003 week priorities |
| Bay history | **ALREADY SUPPORTED** | MAP-002 bay-context |
| Existing reporting surfaces | **ALREADY SUPPORTED** | Cycle / audit paths under flooring scope |
| Separate Home Decor department row | **OPERATOR DECISION REQUIRED** | TOPO-001 §L code + cutover |
| Authoritative aisle/bay Flooring vs HD map | **OPERATOR DECISION REQUIRED** | Cannot invent from repo |
| Hub `home_decor` DepartmentScope registration | **CODE CHANGE REQUIRED** (deferred) | Blocked on operator code choice |
| Dual-dept Sunday auto-stage | **CONFIGURATION REQUIRED** | Guard exists; auto-stage remains OFF; second dept must not silently double×3 |

**Verdict:** Under the **merged** model, Home Decor already uses Floor Command. First-class **separation** is not implemented and must not be guessed.

---

## 4. Existing reusable capabilities

| Capability | Owner | Reuse decision |
|------------|-------|----------------|
| Physical bay key `(department_id, aisle, bay)` | `physical-bay.ts` | Keep — no parallel identity |
| Operational Sections | `operational-sections.ts` | Keep — do not invent second stewardship engine |
| Section-bound ownership | OPERATIONAL-011/012 | Keep |
| Shared week capacity | `shared-week-capacity.ts` | Keep — prerequisite for any future dual-dept stage |
| Map collision labels | `formatMapAisleLabel` | Keep — ready when two depts exist |
| Named specialty zones | MAP-004 / `aisle.ts` | Keep — non-rotating defaults |
| Walkthrough place bind | `walkthroughs.ts` | Keep |
| Working-department pin | `admin-department-context` | Keep — no new global selectors |

Prefer composition of these contracts over new department engines.

---

## 5. Confirmed gaps

| Gap | Type | Blocker |
|-----|------|---------|
| Which aisles/bays are Flooring vs Home Decor vs neither | OPERATOR | No persisted membership signal |
| Exact Home Decor `departments.code` | OPERATOR | Design default `home_decor` unconfirmed |
| Keep vs rebuild Flooring geography at cutover | OPERATOR | TOPO-001 §L |
| Roster homes/access after split | OPERATOR | Constitution staffing vs merged codes |
| Open-week cutover timing | OPERATOR | Complete / supersede / freeze |
| Dual-dept auto-stage policy | CONFIG after decisions | Capacity guard shipped; auto-stage hard OFF |
| Hub registration of `home_decor` | CODE (later tranche) | Must follow operator code lock |
| Joint carpet-wall stewardship as first-class | DEFERRED | AREAS-001; not this tranche |

---

## 6. Implemented changes

App-only coherence for the **current merged** model. No schema. No membership writes. No topology invention.

| Path | Change |
|------|--------|
| `lib/store-ops/department-alignment.ts` | Architecture contract, capability matrix, label helpers |
| `lib/store-ops/align-dept-001.department-alignment.test.ts` | Focused regressions |
| `lib/types.ts` | Roster CSA option label → **Flooring / Home Decor CSA**; Supervisor/CSA/Specialist titles respect Constitution under `flooring` |
| `components/hub/tabs/FloorTab.tsx` | This Week title + context strip use `resolveOperationalDepartmentLabel` |
| `lib/nav-hub.ts` | This Week nav title uses full merged label |
| `components/sections/CycleAuditSection.tsx` | Audit report department label uses helper |
| `components/admin/WalkTheFloorSheet.tsx` | Bay-sheet department chip falls back to merged label |

### Explicit non-changes

- No new Operational Sections; no bay membership edits  
- No `home_decor` department seed/activation  
- No aisle ownership map invented  
- No Map redesign / department selectors on every screen  
- No specialty → rotation conversion  
- No remnant / sheet-vinyl geography invented  
- Sunday auto-stage remains **OFF**  
- Shared capacity / section ownership / Zebra independence preserved  

---

## 7. Required operator decisions

Carry-forward from TOPO-001 §L (still blocking separation cutover):

1. **Authoritative aisle/bay map** — Flooring vs Home Decor vs neither (partial bay ranges if any).  
2. **Home Decor department code** — accept `home_decor` or supply Lowe’s-style code.  
3. **Keep vs rebuild Flooring geography** at cutover.  
4. **Disposition of other departments’ locations** (already largely cleaned; confirm).  
5. **Roster home/access codes** after split (Specialists / CSA / operator).  
6. **Cutover timing** for open staged weeks.  
7. **Dual-department capacity rule** while auto-stage stays OFF (shared pool recommended).  
8. **Confirm live inventory** if any drift since CAPACITY-GUARD / CLEANUP inspections.

Until these are answered, **do not** insert a Home Decor department or redistribute sections.

---

## 8. Database migration requirements

| Item | Status |
|------|--------|
| New migration | **None** |
| Schema change | **None** |
| Production SQL | **Not required / not applied** |
| Section / membership data | **Unchanged** |
| Future separation | Additive `departments` insert + hub wiring + operator bulk rebuild — **separate authorized tranche** after §7 |

---

## 9. Regression results

```bash
npx vitest run \
  lib/store-ops/align-dept-001.department-alignment.test.ts \
  lib/store-ops/map-004.named-zones.test.ts \
  lib/store-ops/shared-week-capacity.test.ts \
  lib/store-ops/section-ownership-enforcement.test.ts
# → 4 files / 55 tests PASS

npx tsc --noEmit                                 # PASS
npx eslint lib/store-ops/department-alignment.ts \
  lib/store-ops/align-dept-001.department-alignment.test.ts \
  lib/nav-hub.ts lib/types.ts                    # PASS (touched new/core paths)
npm run build                                    # PASS (Next.js 16.2.12)
```

| Check | Result |
|-------|--------|
| ALIGN-DEPT-001 + MAP-004 + capacity + ownership tests | **55 PASS** |
| TypeScript | **PASS** |
| Lint (new contract + nav/types) | **PASS** |
| Production build | **PASS** |
| Pre-existing `WalkTheFloorSheet` / `FloorTab` react-hooks lint | Unrelated; unchanged pattern (MAP-004 note) |
| Four sections / 160 memberships | Untouched (no membership writers added) |
| Weekly capacities / section-bound rotation | Untouched |
| Supervisor approval + auto-stage OFF | Untouched (`STRICT_SECTION_OWNERSHIP_AUTO_STAGE = false`) |
| MAP-002 / MAP-003 / MAP-004 | Untouched contracts |
| Walkthrough workflows | Untouched |
| MasterAdmin authorization / store isolation | Untouched |

Specialty boundaries preserved: `CARPET-WALL`, `SHOW-L`, `SHOW-R`, `CLOTHING` remain named non-rotation defaults; Zebra remains independent.

---

## 10. Release readiness

| Gate | Verdict |
|------|---------|
| Discovery complete | **YES** |
| Safe merged-model coherence shipped | **YES** — production `57334ee` |
| Home Decor first-class separation | **NO** — blocked on operator §7 |
| Migration review | N/A (none) |
| Deploy | **DONE** — see ALIGN-DEPT-001-RELEASE |
| Phone / operator acceptance | Optional for label UX; no data cutover |

**GO** for app-only merged-model coherence (released).  
**NO-GO** for department split, topology rewrite, membership changes, or inventing aisle ownership.

### Completed implementation vs unresolved product decisions

| Completed now | Still unresolved |
|---------------|------------------|
| Evidence-locked merged architecture contract | Aisle/bay Flooring vs Home Decor map |
| Capability matrix (ALREADY / CONFIG / CODE / OPERATOR) | Home Decor department code + insert |
| Operator-facing merged labels on Floor Command surfaces | Dual-dept cutover weekend plan |
| Constitution-aligned roster titles under `flooring` | Hub registration + dual-dept auto-stage policy |

---

## 11. Stop

Implementation and documentation complete. Do not deploy. Do not apply migrations. Do not invent aisle ownership or create a Home Decor department row without operator decisions in §7.
