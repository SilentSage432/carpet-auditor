# UX-REDUCE-007 — Final Legacy Surface & Residue Retirement

> **Mode:** Authorized bounded implementation tranche.  
> **Baseline:** `main @ c49709f` — `feat: add Royal Amethyst handheld theme`  
> **Date:** 2026-09-18  
> **Samsung field acceptance:** Pending (short plan below).  
> **Not started:** UX-REDUCE-008, PERF-LOAD-003, HANDHELD-UX-003.

This is a retirement tranche, not a redesign. Floor, Map, Roster, More hierarchy, Royal Amethyst, 3-bay automatic plan, coverage-cycle, verification, seasonal HIGH, and Map High/Standard are unchanged in product law.

---

## 1. Baseline

| Item | Truth |
|------|--------|
| Branch | `main` tracking `origin/main` |
| HEAD | `c49709f` |
| Worktree | Clean except untracked `tmp/` |
| Prior accepted | PRIORITY-UX-002 (Map High among owed); HANDHELD-UX-002 Royal Amethyst loved on Samsung |
| Handheld theme | Not modified |

No STOP condition fired. `weekly_bay_target` is not the automatic 3-bay law. Bay Workflow is not required for verification. Taxonomy is not consumed by rotation selection. Fiscal admin is not required to operate the reduced product. Call-out High write was leftover, not an invariant. No schema/migration required.

---

## 2. Executive finding

The mounted product still expressed several specialty/admin leftovers beside the reduced rotation instrument. None of them owned selection, distribution, verification, or coverage memory.

Safe now:

- Unmount misleading controls
- Stop call-out from manufacturing manual High
- Relabel observational copy so “High priority” means Map High

Leave alone:

- Schema, RLS, dormant specialty runtime, engine models (`velocity_tier`, `workflow_type`, `weekly_bay_target`, fiscal tables)
- SpecialtyToolsHost (still mounted for dormant events; deletion would be structural)

After this tranche the everyday product is: **my department, my people, this week’s coverage**, with the engine remembering what is owed and what should return sooner.

---

## 3. Candidate-by-candidate classification

| ID | Candidate | Classification | Why |
|----|-----------|----------------|-----|
| A | Bulk Bay Generator Priority Lock | **RETIRE NOW** | Topology creation was declaring operational High. Map owns High. |
| B | Topology velocity HIGH / CRITICAL | **RECONCILE NOW** | Engine `velocity_tier` stays. Manual radios and HIGH/CRITICAL chips demoted/relabeled. |
| C | Bay Workflow in Edit Bay / Bulk | **RETIRE NOW** (surface) | Checklist routing for unmounted Zebra/SIMS. Not used by selector/verification/coverage. |
| D | Call-out writing `priority_override` | **RETIRE NOW** (correctness) | Manufactured manual High. Carry remains `CARRIED_OVER`. |
| E | “True Hole / High Priority” | **RECONCILE NOW** | Observational hole ≠ rotation High. |
| F | Catalog taxonomy manager | **RETIRE NOW** (launcher) | Rotation/Floor/Map do not consume it. Tables/lib retained. |
| G | Specialty offline/sync chrome | **RETIRE NOW** (labels) | Appliance/remnant cache rows. Core queue/quarantine kept. |
| H | Fiscal administration card | **RETIRE NOW** (card) | Not required to operate. Fiscal context/engine retained. |
| I | `weekly_bay_target` UI | **RETIRE NOW** (control) | Automatic plan is eligible × 3. Field/API/Force seam retained. |
| J | SpecialtyToolsHost | **DEFER STRUCTURAL DELETION** | Still mounted for dormant events; Zebra/SIMS coupling remains in unmounted code. |

---

## 4. Bulk Priority Lock disposition

**RETIRED** from Bulk Generator (manual + AI tabs).

Bulk create remains. Seed is hardcoded `parseVelocitySeedPreset("standard")` → `priority_override=false`, `velocity_tier=standard`.

`velocitySeedFromPreset("priority_lock")` remains in `lib/store-ops/velocity.ts` as a dormant API compatibility helper. Bulk UI no longer sends it.

---

## 5. Velocity controls disposition

**Unmounted:** Bulk “Default velocity tier” radios (Standard / High Velocity / Priority Lock).

**Relabeled:** Aisle & Bays chips: `HIGH` → Fast cadence, `CRITICAL` → Service hotspot, STANDARD chip hidden. Manual High chip remains **High** (from `priority_override`).

**Kept:** `velocity_tier` model, walk-log auto-promotion (`bay-service.ts`), Map advanced service cadence, ENGINE-PROD-004 ordering.

DS/Master no longer need to configure velocity during topology setup for the surviving product to work.

---

## 6. Bay Workflow disposition

**Unmounted:** Edit Bay select; Bulk workflow fieldset; “Apply workflow to all mapped bays”.

**Kept hidden:** `workflow_type` column/API; silent `workflowTypeForDepartmentCode` on bulk create (Appliances still tagged `APPLIANCE_SIMS_AUDIT` for dormant Zebra); `applyDepartmentWorkflowType` client helper.

Not used by selection, distribution, verification, coverage memory, or cadence.

---

## 7. Call-out / `priority_override` correction

`stampCarryOverLocations` no longer sets `priority_override: true`.

It still writes:

- `status: "CARRIED_OVER"`
- `carried_over: true`
- `last_carried_over_at`

Default Roster `recordCallOut` still only upserts `associate_shift_days`. Explicit Reassign pool/auto/carry unchanged except carry no longer manufactures High.

Existing High is not cleared. Standard stays Standard.

Constitution Art. XV now records: call-out MUST NOT write `priority_override`.

---

## 8. Walk / IRP terminology disposition

| Surface | Before | After |
|---------|--------|--------|
| Walk intensity `critical_hole` | True Hole / High Priority | **True hole** |
| Floor Pad `P1_CRITICAL` / `P2_HIGH` / `P3_ROUTINE` | `P1 CRITICAL` / `P2 HIGH` | Urgent observation / Elevated observation / Routine note |
| Map High toggle | Mark high priority | **unchanged** (canonical manual High) |

AI/observational evidence remains non-authoritative. Floor Pad was not redesigned.

---

## 9. Taxonomy manager disposition

**Unmounted** from More (accordion, modal, `#taxonomies` hash is a no-op).

**Retained:** `TaxonomyManagerModal.tsx`, `lib/catalog/taxonomies.ts`, dormant `DepartmentAuditSection` consumers.

Rotation selection / Floor / Map do not depend on catalog taxonomies.

---

## 10. Specialty offline/sync chrome disposition

**Removed rows:** Appliance audit cache, Remnant inventory cache.

**Kept:** Pending queue, Blocked (quarantined), Sync Now, Clear local cache (still silently clears specialty IndexedDB + sync queue), core offline mutation queue / quarantine / IndexedDB / PWA.

Connection test now pings `store_locations` instead of `appliance_scans`.

No offline architecture rewrite.

---

## 11. Fiscal admin disposition

**Unmounted:** `FiscalCoverageCard` from Master Admin.

**Kept:** `fiscal_years` / `fiscal_weeks`, `computeFiscalCoverage`, `GET /api/admin/fiscal-calendar/coverage`, Floor `omitFiscal` composition path.

Not required to configure surviving cadence. Seasonal Context remains the cadence input.

---

## 12. `weekly_bay_target` UI disposition

**Unmounted:** `WeeklyBayTargetCard` / `DepartmentTargetsMatrix` from More.

Automatic Sunday uses `resolveAutomaticWeeklyBayTarget(eligible × 3)`.

**Kept:** column, `PATCH /api/departments`, `resolveWeeklyBayTarget` for Force Draw / `generateRotations`. The UI can no longer contradict the 3-bay law.

---

## 13. SpecialtyToolsHost disposition

**DEFERRED.** Still imported/mounted in `WorkflowTabShell` for dormant contextual events. Everyday launchers already disconnected (REDUCE-004). Deleting the host would be structural and risk Zebra/SIMS remnant coupling.

---

## 14. Protected Floor Pad result

Reachable from More (`data-testid="more-executive-floor-pad"`). Observational capture preserved. Copy no longer collides with manual High. No redesign.

---

## 15. Protected Seasonal result

Still under Rotation Setup (`OperationalContextCard`). Independent of manual High. ENGINE-PROD-004 unchanged.

---

## 16. Map priority preservation

`canMutateRotationPriority` remains. Topology `canMutate={false}` remains. Pin-to-week still gated. High/Standard still atomic physical-bay writes. Sell/Top mutation not reopened.

---

## 17. Floor preservation

Still This Week ownership / verification. No priority, taxonomy, fiscal, topology, or specialty admin added.

---

## 18. Roster preservation

Still People & Schedules. TIME-DUTY On now / Later / Off / Called out / Schedule unknown unchanged. Call-out still does not redistribute by default.

---

## 19. More resulting hierarchy

```text
More
  Floor Pad                         [DS + Master] PROTECTED
  Department Setup                  [map console]
    └─ Aisles & bays
  Rotation Setup                    [Master]
    └─ Seasonal Context             PROTECTED
  Device & Account
    └─ connection / pending queue / quarantined / PIN / theme / push
  Master Admin                      [collapsed]
    └─ Sunday schedule
    └─ Advanced recovery · Generate this week
    └─ Store number
```

Empty taxonomy section removed. Weekly-target and fiscal cards removed. No new settings invented.

---

## 20. `priority_override` writer inventory

| Path | Actor | Purpose | Mounted? | Canonical? |
|------|-------|---------|----------|------------|
| `lib/store-ops/physical-bay-priority.ts` | DS/Master via Map | Physical-bay High/Standard | Yes (Map) | **Yes** |
| `lib/store-ops/aisle-priority.ts` | DS/Master via Map | Aisle High / disclosed clear | Yes (Map) | **Yes** |
| `app/api/store-locations/route.ts` PATCH | Master (and DS boolean on generic PATCH) | Compatibility seam | No UI after 007 | Hidden compatibility |
| `lib/store-ops/locations.ts` bulk insert | Master bulk create | Uses velocity seed (UI now always Standard) | Bulk create yes; lock no | Default Standard |
| `lib/store-ops/velocity.ts` `priority_lock` preset | None mounted | Dormant helper | No | Hidden |
| `lib/store-ops/call-out.ts` | — | **Removed** | — | Must not write |

No call-out/absence path writes it.

---

## 21. `velocity_tier` writer inventory

| Path | Actor | Purpose | Canonical? |
|------|-------|---------|------------|
| `lib/store-ops/bay-service.ts` | Walk log | Observational auto-promote | Yes (engine) |
| `lib/store-ops/locations.ts` | Bulk create | Seeds from preset (now Standard) | Topology default |
| `app/api/store-locations/route.ts` PATCH | Master | Topology compatibility | Hidden |
| `lib/store-ops/velocity.ts` | Helper | Preset mapping | Hidden |

No topology-facing HIGH/CRITICAL radios remain.

---

## 22. `custom_decay_days` writer inventory

| Path | Actor | Purpose |
|------|-------|---------|
| `lib/store-ops/locations.ts` | Bulk seed | Default 14 from Standard preset |
| `app/api/store-locations/route.ts` PATCH | Master | Hidden compatibility |
| `lib/store-ops/velocity.ts` | Helper | Preset mapping |

Edit Bay Custom decay remains unmounted (PRIORITY-UX-002).

---

## 23. `weekly_bay_target` writer inventory

| Path | Actor | Purpose | Mounted? |
|------|-------|---------|----------|
| `app/api/departments/route.ts` PATCH | Master / DS API | Legacy override | No More UI |
| `components/admin/DepartmentTargetsMatrix.tsx` | Would PATCH if mounted | Unmounted | **No** |
| `generateRotations` / Force | Master recovery | Reads field via `resolveWeeklyBayTarget` | Force modal yes |

Automatic Sunday does **not** honor this field as quota.

---

## 24. Mounted stale-copy audit

| Term | Mounted meaning after 007 |
|------|---------------------------|
| Priority Lock | **Gone** |
| Lock Priority Override | Already gone (002); still gone |
| High-Velocity Hotspot | Already gone from Edit Bay; Bulk radios gone |
| HIGH / CRITICAL chips | Relabeled Fast cadence / Service hotspot |
| High priority | **Map manual High only** |
| True hole | Walk observational intensity |
| Specialist | Internal identifiers / dormant; not a More launcher |
| Specialty / Carpet / Appliance / Remnant / Audit | Dormant runtime; Device chrome no longer lists appliance/remnant caches |
| weekly / bay target | Unmounted; Master copy states three physical bays |
| fiscal | Card unmounted; engine retained |
| taxonomy | Launcher unmounted |

---

## 25. Runtime code removed (mounted)

- Bulk Priority Lock + velocity radios
- Bulk Bay Workflow UI + apply-to-department
- Edit Bay Bay Workflow
- More taxonomy accordion/modal mount
- More FiscalCoverageCard mount
- More WeeklyBayTargetCard mount
- Device appliance/remnant cache status rows
- Call-out `priority_override: true`

---

## 26. Runtime code intentionally retained

- Map High/Standard
- Floor Pad / Walk & Talk
- Seasonal Context
- Sunday schedule + Force recovery
- SpecialtyToolsHost
- `velocitySeedFromPreset`, `workflow_type` silent defaults
- Offline queue / quarantine / SyncQueuePanel
- Royal Amethyst / theme system

---

## 27. Persisted/schema artifacts intentionally retained

No migration. Retained: `priority_override`, `velocity_tier`, `custom_decay_days`, `workflow_type`, `weekly_bay_target`, fiscal tables, taxonomy storage key, appliance/remnant IndexedDB.

---

## 28. Tests

- New `lib/store-ops/ux-reduce-007.legacy-residue.test.ts`
- `lab-week-002.call-out.test.ts` — carry does not write `priority_override`
- `time-duty-003` — default recordCallOut still no location patch
- `priority-ux-002` — Edit Bay no longer mounts Bay workflow
- `ux-reduce-005` — fiscal/taxonomy/weekly-target unmounted
- `topo-ux001` — apply-workflow UI no longer emitted

---

## 29. Validation

Focused suites covering UX-REDUCE-007, PRIORITY-UX-002, TIME-DUTY, BAY-UNIT-002, ENGINE-PROD-002/003/004, LAB-WEEK-002, UX-REDUCE-002/003/004/005, PERF-LOAD-002, Floor Pad / Seasonal contracts.

Then `npm test`, `npm run typecheck`, `npm run build`. Secret scan on changed files. Lint baseline out of scope.

---

## 30. Database / production safety

**NO** migration, schema change, RLS change, production mutation. Repository archaeology only.

---

## 31. Remaining structural debt

- SpecialtyToolsHost + Zebra/SIMS dormant path
- `workflow_type` / appliance tagging on bulk create
- `weekly_bay_target` Force/generate seam
- Generic location PATCH still accepts `priority_override`
- Taxonomy/fiscal/appliance tables and files
- UX-REDUCE-006 identifier superseded (not a remaining product surface)

Do not auto-open UX-REDUCE-008.

---

## 32. Field acceptance plan

See Samsung section below. Natural call-out only. Do not manufacture production High/call-out state.

---

## 33. Final reduced-product assessment

The mounted product now cleanly expresses:

> My department. My people. This week’s coverage.

The engine still remembers what has been covered, what remains owed, and what should return sooner (manual High among owed, seasonal HIGH, velocity/service cadence, carryover).

**Stop.** Do not invent more reduction work.

---

## Samsung acceptance (short)

**MORE**

- No Priority Lock, taxonomy manager, fiscal card, weekly-target matrix, appliance/remnant cache rows
- Bulk generate still creates topology (defaults Standard)
- Edit Bay still edits aisle/bay/department; no Bay Workflow
- Floor Pad present
- Seasonal present under Rotation Setup (Master)

**MAP**

- High/Standard still works
- Aisle High/clear still works
- No topology mutation
- “High priority” still means rotation High

**FLOOR**

- Weekly ownership / exactly 3 / verification unchanged
- No new admin clutter

**ROSTER**

- Schedules and current availability unchanged

**CALLOUT**

- Use a natural call-out if one occurs
- Called-out person’s bays must not suddenly become High
- Already-High bays stay High

**SYNC**

- Device status shows pending + quarantined only

---

## Direct answers

**A.** Retired. It wrote the same `priority_override` field with sticky-draw copy and let topology creation declare operational High. Map owns High. Bulk create remains; default Standard.

**B.** No. Topology radios are gone. Remaining chips say Fast cadence / Service hotspot, not HIGH/CRITICAL.

**C.** No. It routed specialty/checklist behavior the reduced product no longer owns. Field retained.

**D.** No.

**E.** No.

**F.** Yes. Call-out does not clear High.

**G.** Map physical-bay High, Map aisle High, generic location PATCH compatibility, bulk insert via Standard seed, dormant `priority_lock` helper (unmounted).

**H.** Yes, in mounted product UI. Observational copy no longer uses that phrase.

**I.** Yes, from the mounted product. Files/tables retained.

**J.** Yes. Appliance/remnant cache rows removed.

**K.** No. Fiscal context remains engine infrastructure; the admin card is not required to operate.

**L.** No, not from More. API/Force seam retained.

**M.** Yes. `BASE_WEEKLY_BAY_QUOTA = 3`; `resolveAutomaticWeeklyBayTarget`.

**N.** Yes. ENGINE-PROD-003 +1 unchanged.

**O.** Yes.

**P.** Yes.

**Q.** Yes.

**R.** Yes: Floor Pad, Department Setup, Seasonal, Device & Account, Master recovery/store number.

**S.** Yes.

**T.** Yes.

**U.** SpecialtyToolsHost, Zebra/SIMS, workflow_type, taxonomy lib, fiscal tables/API, weekly_bay_target field, velocity `priority_lock` helper, appliance/remnant IndexedDB.

**V.** No.

**W.** More leftover-control absence; Map High still obvious; Floor/Roster unchanged; natural call-out must not mint High; sync rows truthful.

**X.** No remaining *mounted* surface that materially contradicts the reduced product. Dormant specialty runtime still exists underneath.

**Y.** Yes. The major product-reduction program for everyday mounted surfaces is complete enough to stop. Do not automatically create UX-REDUCE-008.
