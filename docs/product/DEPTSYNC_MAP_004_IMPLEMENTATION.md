# DEPTSYNC-MAP-004 — Named Specialty Zones + Non-Rotation Defaults

**Status:** COMPLETE locally — **not deployed**  
**Date:** 2026-10-14  
**Mode:** Focused implementation (after AUTH-006)  
**Authority:** Mission brief · MAP-001/002/003 · TOPOLOGY-AREAS-001 · TOPOLOGY-REGISTRY · location-eligibility  
**Predecessor:** [`DEPTSYNC_MAP_001_ROADMAP_RECONCILIATION.md`](./DEPTSYNC_MAP_001_ROADMAP_RECONCILIATION.md) · [`DEPTSYNC_MAP_003_IMPLEMENTATION.md`](./DEPTSYNC_MAP_003_IMPLEMENTATION.md)

Extend the existing aisle/bay location model so documented named operational zones default to **non–weekly-rotation** when physical bays are created. Preserve aisle/bay geometry, Operational Sections, MAP-002 bay context, and MAP-003 priority behavior. No Map rewrite. No floorplan. No invented ownership.

---

## 1. Existing location contracts

| Asset | Role |
|-------|------|
| `store_locations.aisle` TEXT + `bay` | Canonical physical place key with department |
| `store_aisles` registry | Zero-bay shells / named codes without inventing fake aisle numbers |
| `normalizeAisle` / `formatAisleDisplayLabel` | Alphanumeric codes (`41`, `SHOW-L`, `CARPET-WALL`) |
| `location_type` (`STANDARD` \| `SHOWROOM_STACKOUT`) | Weekly draw gate — stack-out excluded |
| `isEligibleRotationLocation` | Shared eligibility (active + not showroom stack-out) |
| Operational Sections (4 × 160) | Section-bound ownership overlay — unchanged |
| MAP-002 bay-context / MAP-003 priorities | Bay sheet + week-scoped intent — unchanged |

### Product evidence (not invented)

| Zone / concept | Evidence | MAP-004 treatment |
|----------------|----------|-------------------|
| `CARPET-WALL` | TOPOLOGY-AREAS-001 — joint Nick+Tracy responsibility, separate from weekly bay rotation | Named specialty code → default `SHOWROOM_STACKOUT` |
| `SHOW-L` / `SHOW-R` | TOPOLOGY-AREAS-001 showroom sides | Same |
| `CLOTHING` | TOPOLOGY-AREAS-001 clothing showroom | Same |
| Numeric retail aisles (`5`, `41`, …) | Existing 160 bay memberships | Remain `STANDARD` by default |
| Remnant rack / catalog | Specialty inventory (REDUCE); not Map geography | **Not modeled as Map zones** |
| Sheet-vinyl area | MAP-001: no first-class Floor Command surface | **Not invented** |
| Joint Nick+Tracy ownership | TOPOLOGY-AREAS-001 — deferred first-class joint stewards | Carpet wall stays non-rotating; no ownership rewrite |

---

## 2. Named-zone implementation

### Code contract

```ts
// lib/store-ops/aisle.ts
NAMED_SPECIALTY_ZONE_CODES = ["CARPET-WALL", "SHOW-L", "SHOW-R", "CLOTHING"]
isNamedSpecialtyZoneAisle(raw) → boolean
```

### Bulk / Add Bay defaults

`buildBulkLocationRows` / `resolveBulkLocationKind`:

| Aisle code | Default `location_type` | Weekly rotation eligible? |
|------------|-------------------------|---------------------------|
| Named specialty (above) | `SHOWROOM_STACKOUT` | No |
| Numeric / other codes | `STANDARD` | Yes (if active) |
| Explicit override | Honored | Per override |

Add Bay sheet and Bulk Generator both call `bulkGenerateLocations` → same path. UI copy states that specialty zones are showroom stack-out, not weekly rotation bays. Empty Map shells note the same for CARPET-WALL / SHOW-* / CLOTHING.

---

## 3. Specialty location behavior

| Behavior | Result |
|----------|--------|
| Registry-only named zone (0 bays) | Remains a geography shell; not a rotation unit |
| Add bays to specialty code | Rows persist as `SHOWROOM_STACKOUT` by default |
| Sunday / weekly draw | Continues to exclude `SHOWROOM_STACKOUT` via eligibility helpers |
| Explicit `location_type: "STANDARD"` on specialty code | Allowed for rare overrides; not the default path |
| Remnants / appliances / sheet vinyl | Unchanged specialty surfaces; not Map zones |

---

## 4. Ownership and rotation boundaries

| Invariant | Preserved how |
|-----------|----------------|
| Store 2587 / 4 sections / 160 bay memberships | No membership or ownership writes |
| Section-bound associate ownership | Untouched |
| Weekly capacity limits + supervisor approval | Untouched |
| Sunday auto-stage OFF | Untouched |
| Historical assignments | Untouched |
| MAP-002 bay detail / walkthroughs / MAP-003 priority | Untouched |
| Carpet wall ≠ weekly rotation | Default stack-out; joint stewardship still separate (AREAS-001) |
| No cross-section assignment | No assignment engine changes |
| Named specialty ≠ silent rotation-eligible bays | Default `SHOWROOM_STACKOUT` |

**Out of scope this tranche:** joint-steward schema, remnant Map pins, floorplan geometry, inventing undocumented zone codes or ownership.

---

## 5. Database changes

| Item | Status |
|------|--------|
| New migration | **None** |
| Schema change | **None** — reuses existing `location_type` |
| Production SQL | **Not applied / not required** |
| Data backfill of existing rows | **Not performed** — do not invent or rewrite live bay types |

App-only default on **new** bulk/add-bay creates for documented specialty codes.

---

## 6. Tests and build

```bash
npx vitest run lib/store-ops/map-004.named-zones.test.ts   # 4 PASS
npx tsc --noEmit                                           # PASS
npm run build                                              # PASS
```

Focused MAP-004 tests cover:

- Specialty code recognition vs numeric aisles  
- Bulk rows default to `SHOWROOM_STACKOUT` and fail `isEligibleRotationLocation`  
- Numeric aisles remain `STANDARD` / eligible  
- Explicit override still honored  

Repo-wide `npm run lint` still reports pre-existing `StoreLocationGrid` react-hooks findings unrelated to MAP-004 copy; new aisle/locations helpers and AddBay/Bulk copy paths are clean.  

---

## 7. Release readiness

| Gate | Verdict |
|------|---------|
| Implementation complete locally | **YES** |
| Separate from AUTH-006 commit | **Required** |
| Migration review | N/A (none) |
| Deploy | **STOP — do not deploy automatically** |
| Phone / operator acceptance | Pending authorize + release tranche |

**CONDITIONAL GO** for later app-only deploy after authorize. **NO-GO** auto-deploy, ownership edits, or inventing remnant/sheet-vinyl Map zones.

---

## 8. Files touched

| Path | Change |
|------|--------|
| `lib/store-ops/aisle.ts` | `NAMED_SPECIALTY_ZONE_CODES` + `isNamedSpecialtyZoneAisle` |
| `lib/store-ops/locations.ts` | Specialty → `SHOWROOM_STACKOUT` default |
| `lib/store-ops/types.ts` | `BulkGenerateInput.location_type` docs |
| `lib/store-ops/map-004.named-zones.test.ts` | Focused regressions |
| `components/admin/AddBaySheet.tsx` | Operator copy |
| `components/admin/BulkLocationGenerator.tsx` | Operator copy |
| `components/admin/StoreLocationGrid.tsx` | Empty-zone messaging |

---

## 9. Stop

Implementation and documentation complete. Do not deploy. Do not apply migrations. Do not alter approved bay ownership.
