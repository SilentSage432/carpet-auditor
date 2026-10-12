# DEPTSYNC-TOPOLOGY-REGISTRY-003 — Create Location + Empty Map Experience

**Status:** COMPLETE (local implementation + verification)  
**Date:** 2026-10-11  
**Mode:** Controlled implementation — **NO production deploy · NO production data mutations**  
**Application:** https://deptsync-hub.vercel.app (unchanged)  
**Supabase:** `fmeinlwhixngednabhgy` (registry already applied via REGISTRY-002B; **not** re-applied)

**References:**  
[`DEPTSYNC_TOPOLOGY_REGISTRY_001_DESIGN.md`](DEPTSYNC_TOPOLOGY_REGISTRY_001_DESIGN.md) ·  
[`DEPTSYNC_TOPOLOGY_REGISTRY_002_IMPLEMENTATION.md`](DEPTSYNC_TOPOLOGY_REGISTRY_002_IMPLEMENTATION.md) ·  
[`DEPTSYNC_TOPOLOGY_REGISTRY_002B_PRODUCTION_APPLY.md`](DEPTSYNC_TOPOLOGY_REGISTRY_002B_PRODUCTION_APPLY.md) ·  
[`DEPTSYNC_TOPOLOGY_UX_004_IMPLEMENTATION.md`](DEPTSYNC_TOPOLOGY_UX_004_IMPLEMENTATION.md)

---

## 1. Executive summary

Operators can create numbered aisles and named zones **without bay numbers** via MasterAdmin **Create Location**, persisting only `store_aisles`. Map and section aisle discovery merge **registry ∪ bay-derived** aisles so empty registered locations appear with **0 documented bays** and an **Add Bays** path. Existing bay identity, RLS (no authenticated writes), capacity/Sunday/Zebra, and section-aware-off flags are preserved.

| Gate | Result |
|------|--------|
| Create Location (zero bays) | **IMPLEMENTED** |
| Authorized server writes (MasterAdmin) | **IMPLEMENTED** |
| Map registry merge + empty UX | **IMPLEMENTED** |
| Bay create / ensure compatibility | **IMPLEMENTED** |
| Section editor empty-safe | **IMPLEMENTED** |
| Production deploy / prod data | **NOT DONE** |
| Typecheck / tests / build | **PASS** (`tsc`; **1658** tests; `next build`) |

**Verdict:** **CONDITIONAL GO** for a later operator-authorized app deploy + phone acceptance. **NO-GO** to deploy or mutate production data in this tranche.

---

## 2. Files changed

| Path | Change |
|------|--------|
| `lib/store-ops/store-aisles.ts` | **New** — normalize/validate/create/ensure/list |
| `app/api/store-aisles/route.ts` | **New** — GET list + POST create (MasterAdmin) |
| `lib/store-ops/map-aisle-navigation.ts` | Merge `registryAisles`; `displayName` / `registryOnly` |
| `lib/store-ops/map-coverage-presentation.ts` | `0 documented bays` copy |
| `lib/store-ops/section-aisle-membership.ts` | Pass registry into section aisle index |
| `lib/store-ops/client.ts` | `fetchStoreAisles` / `createStoreAisle` |
| `app/api/store-locations/bulk/route.ts` | `ensureStoreAisleForBayWrite` after bay upsert |
| `components/admin/CreateLocationSheet.tsx` | **New** — mobile Create Location sheet |
| `components/admin/AisleBayManager.tsx` | Create Location CTA + registry groups |
| `components/admin/StoreLocationGrid.tsx` | Registry merge, empty location, Add Bays |
| `components/hub/tabs/MapTab.tsx` | Fetch `store_aisles` |
| `components/sections/SettingsSection.tsx` | Fetch registry for Manage + sections |
| `components/admin/OperationalSectionsPanel.tsx` | Registry into aisle picker |
| `lib/store-ops/topology-registry-003.contract.test.ts` | **New** functional contracts |
| `lib/store-ops/topology-registry-003.security.test.ts` | **New** auth contracts |
| `lib/store-ops/topology-ux-004.zero-bay.blocker.test.ts` | Updated for registry path |
| `lib/store-ops/section-aisle-membership.test.ts` | MapAisleEntry shape |
| Docs / journal / handoff / roadmap | This report + program records |

**No new migrations.** Registry migration not re-applied.

---

## 3. Create Location workflow

```text
Map → Manage (Settings → Aisles & bays)
  → Create Location
  → Department
  → Identifier (41 / SHOW-L / CARPET-WALL …)
  → Optional display name
  → Save location
```

- Persists **`store_aisles` only** (no `store_locations` rows).
- Does **not** invent illustrative codes (`CARPET-WALL`, etc.) automatically.
- Bulk Generator / Add Bay remain bay-documentation paths.

---

## 4. Server authorization design

`POST /api/store-aisles` (service-role after checks):

1. `resolveStoreOpsActor` → **401** if missing  
2. `requireSuperAdmin` → **403** if not MasterAdmin  
3. Actor store via `resolveStoreByNumber` (client `store_id` mismatch → **403**)  
4. Department must exist under actor store  
5. `assertActorCanAccessDepartmentId`  
6. `validateStoreAisleIdentifier` → **400** malformed/empty  
7. Duplicate / retired existing → **409** (no silent reactivate)  
8. Insert via `getSupabaseAdmin` only — credentials never exposed to client  

`GET /api/store-aisles` — authenticated list, store-scoped; dept actors scoped.

**Postgres RLS unchanged:** authenticated SELECT only; no client INSERT/UPDATE/DELETE policies.

---

## 5. Map registry merge

`composeMapAisleIndex` now accepts `registryAisles`:

```text
visible = (bay-derived active aisles)
        ∪ (active registry shells, including 0-bay)
```

| Rule | Behavior |
|------|----------|
| Legacy bay aisles | Still visible if registry lag/empty |
| Empty registered | Visible; `physicalBayCount = 0`; `registryOnly` |
| Dedup | Same `(department_id, normalize)` → one tile |
| Retired registry | Hidden unless `showRetired` |
| Cross-dept same code | Two entries; collision label retained |
| Attention / coverage | Empty shells have no location UUIDs → no false attention |

---

## 6. Empty-location behavior

Empty detail (`data-testid="map-empty-location"`):

- Label via `display_name` or `formatAisleDisplayLabel`
- **0 documented bays**
- Clear copy: no coverage / weekly assignment until bays exist
- **Add Bays** → existing `AddBaySheet` prefilled (aisle + department)

No fake bays, no fabricated coverage, no weekly assignments from empty shells.

---

## 7. Bay creation compatibility

| Step | Behavior |
|------|----------|
| Create empty location | Registry insert |
| Later Add Bay / Bulk | Existing `store_locations` upsert |
| After bulk success | `ensureStoreAisleForBayWrite` heals/reactivates matching registry row |
| Counts | Map physical bay counts update from bay rows |
| Uniqueness | Unchanged `(department_id, aisle, bay, type)` |

---

## 8. Section editor compatibility

`composeDepartmentAisleIndexForSections` merges registry. Empty aisles appear with `zero_active_bays`; `expandAisleToActiveBayRefs` returns `[]`; preview `total_bays_to_add === 0`. No fabricated memberships; future bays still require explicit re-select. Joint stewardship not implemented.

---

## 9. Lifecycle limitations

| Case | Behavior in this tranche |
|------|--------------------------|
| Active create | Insert active registry row |
| Duplicate active | **409** |
| Duplicate retired | **409** — **no silent reactivate** via Create Location |
| Bay write on retired shell | `ensureStoreAisleForBayWrite` may reactivate (heal path) |
| Hard delete | **Not implemented** |
| Dedicated retire/reactivate UI | **Not implemented** — document for later policy tranche |

---

## 10. Rotation safety

| Control | Status |
|---------|--------|
| Shared capacity RPC | Untouched |
| Sunday dispatch | Untouched; no `store_aisles` reads |
| Assignment eligibility | Bay rows only |
| Section-aware auto-stage | Remains `false` |
| Production preview flag | Remains off |
| Zebra | Untouched |

Empty locations cannot produce rotation assignments.

---

## 11. Security test results

`topology-registry-003.security.test.ts` — **4 PASS**

| Case | Result |
|------|--------|
| MasterAdmin `requireSuperAdmin` | **PASS** |
| Supervisor / Associate / null rejected | **PASS** |
| Route: auth, store scope, dept scope, no key leak | **PASS** |
| Malformed / duplicate / no silent reactivate | **PASS** |
| RLS fail-closed (no authenticated writes) | **PASS** |

---

## 12. Functional test results

`topology-registry-003.contract.test.ts` — **11 PASS**  
UX-004 / Map / sections related suites — **PASS**

Covered: numeric + named zero-bay create validation; merge/dedupe; retired hide; empty section membership; Sunday/capacity isolation; UI wiring; ensure-on-bay-create.

**Full suite:** **1658 PASS** / 133 files.

---

## 13. Build verification

| Gate | Result |
|------|--------|
| `npx tsc --noEmit` | **PASS** |
| Focused eslint (new modules) | **PASS** |
| Full `vitest run` | **1658 PASS** |
| `npm run build` | **PASS** (`/api/store-aisles` present) |

---

## 14. Production release readiness

| Item | Status |
|------|--------|
| Registry migration on prod | Already **APPLIED — VERIFIED** (002B) |
| Re-apply migration | **NO** |
| App deploy this tranche | **NO** |
| Prod data mutations this tranche | **NO** |
| Ready for authorized deploy? | **CONDITIONAL GO** after phone acceptance of Create Location → Map empty → Add Bays |

---

## 15. Known limitations

1. Supervisor cannot Create Location (MasterAdmin only, matches Bulk).  
2. No retire/reactivate UI for empty registry shells.  
3. Create Location will not reactivate a retired code (409).  
4. Registry `is_active` is not continuously synced when all bays soft-retire via cleanup (cleanup sync deferred).  
5. Live JWT store-claim smoke against production not run here (local contracts only).

---

## 16. GO / CONDITIONAL GO / NO-GO

| Question | Verdict |
|----------|---------|
| Local implementation complete? | **GO** |
| Production app deploy now? | **NO-GO** (not authorized) |
| Production SQL / invent zones? | **NO-GO** |
| Authorize deploy after phone review? | **CONDITIONAL GO** |

**STOP.**
