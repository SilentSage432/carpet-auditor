# DEPTSYNC-TOPOLOGY-REGISTRY-001 — Independent Physical Location Registry

**Status:** COMPLETE (read-only architecture + migration design)  
**Date:** 2026-10-11  
**Mode:** Read-only — no implementation, no schema execution, no production mutations, no deployment  
**Application:** https://deptsync-hub.vercel.app  
**Supabase:** `fmeinlwhixngednabhgy`  
**Store:** `2587`

**References:**  
[`DEPTSYNC_TOPOLOGY_UX_004_IMPLEMENTATION.md`](DEPTSYNC_TOPOLOGY_UX_004_IMPLEMENTATION.md) ·  
[`DEPTSYNC_TOPOLOGY_AREAS_001_DISCOVERY.md`](DEPTSYNC_TOPOLOGY_AREAS_001_DISCOVERY.md) ·  
[`DEPTSYNC_SECTION_UX_002_RELEASE_READINESS.md`](DEPTSYNC_SECTION_UX_002_RELEASE_READINESS.md) ·  
[`DEPTSYNC_SECTION_UX_003_RELEASE.md`](DEPTSYNC_SECTION_UX_003_RELEASE.md) ·  
[`DEPTSYNC_RD_3_OPERATIONAL_SECTIONS.md`](DEPTSYNC_RD_3_OPERATIONAL_SECTIONS.md) (RLS pattern precedent)

**Not authorized:** implementation, migrations applied to production, app deploy, topology/section/assignment mutations, capacity/Sunday/Zebra changes, joint stewardship, section-aware activation.

**Legend**

| Tag | Meaning |
|-----|---------|
| **VERIFIED** | Confirmed in repository schema/source |
| **DESIGN** | Recommended shape for a later authorized implementation tranche |

---

## 1. Executive summary

Floor Command cannot persist an aisle or named zone without bay rows because `store_locations` is a **bay-level** table (`bay integer not null`). The Map and section aisle index only appear when active bay rows exist. SECTION-UX-002/003 correctly accept alphanumeric codes, but zero-bay creation remains impossible without inventing bays.

**Smallest safe extension:** add an additive **aisle/zone registry** table that records physical location identity `(store, department, aisle code)` independently of bay documentation. Keep `store_locations` as the canonical bay record. Soft-join registry ↔ bays by `(department_id, normalize(aisle))` — do **not** rewrite historical bay UUIDs or keys.

| Question | Verdict |
|----------|---------|
| Design complete? | **GO** |
| Implement / migrate / deploy in this tranche? | **NO-GO** |
| Placeholder / fake bays? | **NO-GO** |
| Generalized location hierarchy? | **NO-GO** (unnecessary) |
| Nullable `store_locations.bay`? | **NO-GO** (breaks physical-bay identity) |
| Proceed to implementation tranche when authorized? | **CONDITIONAL GO** |

---

## 2. Verified root cause

| Fact | Evidence |
|------|----------|
| `bay NOT NULL` on `store_locations` | `supabase/migrations/20260809_store_operations_rbac.sql` L89–103 |
| Unique bay identity includes aisle + bay + type | `20260811_alphanumeric_aisle.sql` L21–27; `20260810_store_locations_type_unique.sql` |
| Aisle is TEXT (alphanumeric OK) | `20260811_alphanumeric_aisle.sql` L8–30; `lib/store-ops/aisle.ts` `normalizeAisle` |
| `store_id` required on locations | `20260809_multi_store.sql` L52–62 |
| No aisle-registry table in migrations | TOPOLOGY-UX-004 blocker suite |
| Bulk / Add Bay upsert bay rows only | `app/api/store-locations/bulk/route.ts`; `buildBulkLocationRows` (`locations.ts`); `AddBaySheet.tsx` |
| Map aisle index from bay rows; skips zero active | `composeMapAisleIndex` (`map-aisle-navigation.ts` L65–105) |
| Section aisle expansion from same Map index | `composeDepartmentAisleIndexForSections` (`section-aisle-membership.ts`) |
| Rotation eligibility is per `store_locations` row | `isEligibleRotationLocation` (`location-eligibility.ts`) |
| Phone failure on `CARPET-WALL` | TOPOLOGY-UX-004 / SECTION-UX-003 acceptance |

---

## 3. Recommended registry schema

**DESIGN** table name: `public.store_aisles`

Rationale: matches existing “aisle / zone code” vocabulary (`store_locations.aisle` comment); avoids implying a multi-level area hierarchy (rejected in TOPOLOGY-AREAS-001 Option B/C).

```sql
-- DESIGN ONLY — do not execute in this tranche.
create table public.store_aisles (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null
    references public.stores (id) on delete cascade,
  department_id uuid not null
    references public.departments (id) on delete restrict,
  aisle text not null,
  display_name text null,
  is_active boolean not null default true,
  retired_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint store_aisles_aisle_nonempty_check
    check (char_length(trim(aisle)) > 0),
  constraint store_aisles_retire_consistency_check
    check (
      (is_active = true and retired_at is null)
      or (is_active = false and retired_at is not null)
    )
);

-- Normalize aisle like operational_section_members + app normalizeAisle.
-- Unique active+retired identity per department (one row per code forever;
-- reuse after retire via reactivate, not duplicate insert).
create unique index store_aisles_dept_aisle_uidx
  on public.store_aisles (
    department_id,
    (regexp_replace(upper(trim(both from aisle)), '\s+', ' ', 'g'))
  );

create index store_aisles_store_active_idx
  on public.store_aisles (store_id, is_active);

create index store_aisles_department_idx
  on public.store_aisles (department_id);
```

| Column | Purpose |
|--------|---------|
| `id` | Stable registry PK |
| `store_id` | Store isolation (mirror RD-3) |
| `department_id` | Department scope (Constitution Art. V-A) |
| `aisle` | Canonical code (`41`, `SHOW-L`, `CARPET-WALL`) — stored normalized |
| `display_name` | Optional human label (`Carpet Wall`); null → use `formatAisleDisplayLabel(aisle)` |
| `is_active` / `retired_at` | Soft-retire empty or fully retired locations |
| timestamps | Audit |

**Explicitly omitted from registry (stay bay-level on `store_locations`):**

- `bay`, `type` (SELLING/TOPSTOCK)
- `location_type` / `workflow_type` / velocity / priority  
  (**VERIFIED** rotation eligibility and cadence already read bay rows — `location-eligibility.ts`)

**Do not** add FK from `store_locations` → `store_aisles` in v1.

- Soft join preserves historical bay UUIDs and avoids backfill ordering hazards.
- Bulk upsert paths remain unchanged for bay identity.

---

## 4. Identity and uniqueness

| Layer | Identity |
|-------|----------|
| Registry location | `(department_id, normalize(aisle))` unique; also scoped by `store_id` via department ownership |
| Physical bay (unchanged) | `(department_id, aisle, bay)` / surfaces + `type` |
| Section membership (unchanged) | `(department_id, aisle, bay)` |
| App normalize | `normalizeAisle` — trim, upper, collapse whitespace (`aisle.ts` L10–15) |
| Numeric padding | App dedupe uses `locationDedupeAisleKey` (`"012"` → `"12"`) for bay duplicate detection (`locations.ts` L32–35) |

**DESIGN backfill normalize:** apply the same SQL expression as RD-3  
`regexp_replace(upper(trim(aisle)), '\s+', ' ', 'g')`, then for **digit-only** codes collapse leading zeros to match `locationDedupeAisleKey` (`ltrim` / `::int::text` for `^\d+$` only). Named zones (`CARPET-WALL`) are never numeric-collapsed.

**Cross-department same code:** allowed — Map already supports `aisleCodeCollides` (`map-aisle-navigation.ts`). Separate registry rows per `department_id`.

---

## 5. Bay-to-registry relationship

```text
store_aisles  (existence of aisle/zone; may have 0 bays)
     │ soft join: department_id + normalize(aisle)
     ▼
store_locations  (bay surfaces; bay NOT NULL; history/rotations/FK intact)
```

| Operation | Behavior (**DESIGN**) |
|-----------|------------------------|
| Create empty location | Insert `store_aisles` only |
| Add first / later bays | Existing bulk / Add Bay → `store_locations`; upsert/ensure matching `store_aisles` active |
| Retire all bays (cleanup) | Existing soft-retire on bay rows; optionally set registry `is_active=false` when no active bays remain |
| Retire empty location | Registry soft-retire (no bay rows to touch) |
| Reactivate | Registry `is_active=true`; bays remain independently active/retired |

Historical bay service logs, rotations, and section members continue to reference `store_locations.id` / bay keys — **unchanged**.

---

## 6. Backfill strategy

**DESIGN** idempotent SQL (not executed here):

```sql
insert into public.store_aisles (
  store_id, department_id, aisle, display_name, is_active, retired_at
)
select
  sl.store_id,
  sl.department_id,
  /* normalized aisle code */,
  null as display_name,
  bool_or(sl.is_active = true) as is_active,
  case
    when bool_or(sl.is_active = true) then null
    else coalesce(max(sl.updated_at), now())
  end as retired_at
from public.store_locations sl
where char_length(trim(sl.aisle)) > 0
group by sl.store_id, sl.department_id, /* normalized aisle */
on conflict (department_id, normalized_aisle) do nothing;
```

(Exact conflict target = unique expression index.)

Properties:

- Preserves bays and codes  
- One registry row per department+aisle  
- Active if **any** bay surface active  
- Fully retired aisles backfill as retired (not reactivated)  
- Re-runnable (`DO NOTHING`)  
- No deletes of `store_locations`

---

## 7. Existing data conflict handling

| Case | Handling |
|------|----------|
| Mixed active + retired bays in one aisle | Registry **active**; bay-level partial retire remains (matches cleanup `partially_retired` — `workspace-cleanup.ts` L182–187) |
| All bays retired | Registry **retired** |
| `"01"` vs `"1"` digit padding | Collapse digits-only during backfill normalize; prefer canonical `String(Number(code))` |
| Case/whitespace variants (`show-l` / `SHOW-L`) | Normalize before unique insert |
| Empty / whitespace-only aisle | Skip (check constraint); treat as data defect if present |
| Same aisle code in two departments | Two registry rows |
| Orphan `department_id` | FK `on delete restrict` blocks bad depts; backfill only joins valid departments |
| Missing `store_id` on location | Should not exist post `20260809_multi_store.sql`; if found, derive from `departments.store_id` before insert |
| Registry row already exists (re-run) | `ON CONFLICT DO NOTHING` — do not flip retired→active |
| Operator later creates empty `CARPET-WALL` then adds bays | Registry exists; bay insert ensures aisle match |

---

## 8. RLS and authorization

**DESIGN** mirror RD-3 operational sections (`20261011_operational_sections.sql` L158–248):

| Role | Privilege |
|------|-----------|
| `anon` | No SELECT / no writes |
| `authenticated` | SELECT where `jwt_matches_store(stores.store_number)` on `store_id` |
| `authenticated` | **No** INSERT/UPDATE/DELETE |
| `service_role` | Full access; app routes only |

**API auth (**DESIGN**, match bulk topology writes):**

- Create / retire / reactivate / rename registry → `requireSuperAdmin` (MasterAdmin / `super_admin`) as in `app/api/store-locations/bulk/route.ts` L37  
- Optional later: Supervisor create within department via `requireSupervisorOrAdmin` + `assertActorCanAccessDepartmentId` — **not required for v1** if Bulk remains Master-gated  
- Always verify `department.store_id` matches actor store (same pattern as bulk L68–86)

Do **not** modify existing `store_locations` RLS in this design’s first migration beyond what’s necessary for coexistence (prefer zero changes to bay RLS).

---

## 9. Application compatibility

| Component | Today | After registry (**DESIGN**) |
|-----------|-------|-----------------------------|
| `composeMapAisleIndex` | Bay rows only | Merge registry ∪ bay groups |
| `StoreLocationGrid` | Uses `composeMapAisleIndex` | Same entry; empty shells render |
| `AisleBayManager` | Groups by aisle from locations | Include registry-only aisles |
| `BulkLocationGenerator` | Bays required | Keep bay path; add **Create location** path (registry-only) |
| `AddBaySheet` | Requires bay | Unchanged for adding bays; prefill aisle from empty location |
| `fetchStoreLocations*` | Bay list | Parallel `fetchStoreAisles` (or embed in map payload) |
| Cleanup aisle inventory | From Map index + retired bays | Include registry-only rows |
| Sunday / capacity / rotations | `store_locations` | **Unchanged** — never select from registry for draws |

Transitional read rule (**critical**):

```text
visible_aisles = registry_active ∪ bay_derived_aisles
```

So if registry is empty/missing but bay rows exist, Map still works. If registry has empty zones, they appear. **No deployment window where existing aisles disappear.**

---

## 10. Map integration

**Touch points (**VERIFIED**):**

- `lib/store-ops/map-aisle-navigation.ts` — `composeMapAisleIndex`  
- `components/admin/StoreLocationGrid.tsx` — aisle list, bay drill-in, coverage summary  
- Focus / search: `filterAisleIndexByQuery`, RD-4 focus effect  

**DESIGN presentation:**

| State | UI |
|-------|-----|
| Registry + bays | Current aisle → bay UX |
| Registry, 0 bays | Visible; label via `formatAisleDisplayLabel` / `display_name`; copy **“0 documented bays”**; CTA **Add Bays** |
| Legacy bay-only (no registry row yet) | Still visible via bay-derived merge; backfill should have covered; heal on next bay write |
| Retired registry / all bays retired | Hidden unless `showRetired` |

**False warnings:** coverage / “Needs attention” / SI-001 attention are location-UUID based (`StoreLocationGrid` attention maps). Empty shells have **no** location UUIDs → must not invent attention tones. Coverage summary should exclude or zero-weight empty aisles (not “remaining owed”).

---

## 11. Section editor integration

**VERIFIED:** SECTION-UX-001 expands selected aisles to **active bay refs** only (`expandAisleToActiveBayRefs`); conflicts are bay-keyed; discoverable future bays require explicit re-select (`countDiscoverableBaysForSection`).

**DESIGN:**

| Behavior | Rule |
|----------|------|
| Empty location in picker | Allowed; `zero_active_bays: true` (already modeled) |
| Confirm with only empty aisles | `total_bays_to_add === 0` → clear error: membership requires documented bays |
| Fabricate memberships | **Forbidden** |
| Future bays auto-join | **Forbidden** — keep discoverable banner |
| Stewards / one-section-per-bay | Unchanged |
| Joint stewardship | Out of scope |

---

## 12. Rotation safety

| Control | Design impact |
|---------|---------------|
| Capacity RPC / shared store-week | None — registry not in writers |
| Sunday dispatch / `selectPhysicalBayCoverage` | Continues to read `store_locations` only |
| Eligibility | `isEligibleRotationLocation` on bay rows — empty registry never eligible |
| Assignment uniqueness | Unchanged |
| Section-aware auto-stage | Remains `SECTION_AWARE_ROTATION_AUTO_STAGE = false` |
| Production preview flag | Remains off |
| Zebra | Untouched |

**Invariant:** zero-bay registry rows **cannot** produce weekly assignments.

---

## 13. Deployment order

Preferred sequence (**Option A + B hybrid** — safest for continuous Map):

| Step | Action | Risk control |
|------|--------|--------------|
| 1 | Apply additive migration + RLS + **idempotent backfill** on canonical Supabase | Bay rows untouched; app still bay-only |
| 2 | Deploy app that **merges** registry ∪ bay-derived aisles (read path) | Existing aisles still from bays if registry lag |
| 3 | Ship Create Location (registry write) + empty Map UX + ensure-registry on bay create | No fake bays |
| 4 | Phone acceptance | Empty `CARPET-WALL` → Map → Add Bays later |
| 5 | Optional: cleanup/retire registry sync | Soft-retire only |

**Rejected:** App-only deploy before migration (writes would 404).  
**Rejected:** App that reads **only** registry before backfill (aisles would vanish).

---

## 14. Rollback strategy

| Layer | Rollback |
|-------|----------|
| App | Redeploy prior Vercel build; Map falls back to bay-derived-only if merge code removed |
| Data | Registry drop is last resort; prefer leave table idle (bay truth intact) |
| Migration reverse | `DROP TABLE store_aisles` only if no production dependency; **never** delete `store_locations` |
| Empty zones created in prod | Soft-retire registry rows; no bay history to repair |
| Accidental bay coupling | None in v1 (no FK) |

---

## 15. Test plan (future implementation — not run as feature tests here)

| Area | Cases |
|------|-------|
| Backfill | Distinct aisles; digit padding; case fold; mixed retire; all-retired; cross-dept; idempotent re-run |
| Create | Numeric aisle zero bays; named zone zero bays; duplicate code rejected; auth 401/403; store isolation |
| Map | Empty visible; open empty; no false attention; legacy bay aisle still visible; retired hidden |
| Bays later | Add first bay; add more; registry ensure; history intact |
| Sections | Empty select → 0 membership; no fabricate; conflicts unchanged; discoverable still explicit |
| Rotation | Empty aisle absent from draw fixtures; capacity unchanged |
| Cleanup | Retire empty registry; retire aisle with bays; no hard delete |
| Deploy compat | Merge read with registry empty / full / partial |
| Rollback | App without registry read still serves bay Map |

**Proposed artifacts (names only):**

- `supabase/migrations/YYYYMMDD_store_aisles_registry.sql`  
- `lib/store-ops/store-aisles.ts` (+ tests)  
- `composeMapAisleIndex` merge extension (+ tests)  
- `POST /api/store-aisles` (or `/api/store-locations/aisles`)  
- Bulk / Map Create Location UI  
- Release doc `DEPTSYNC_TOPOLOGY_REGISTRY_002_*`

---

## 16. Implementation tranches

| Tranche | Scope | Gate |
|---------|-------|------|
| **REGISTRY-001** (this doc) | Design only | **COMPLETE** |
| **REGISTRY-002** | Migration + RLS + backfill (no UI) | Operator authorize prod SQL; dump first |
| **REGISTRY-003** | App merge reads + Create Location + empty Map + ensure-on-bay-create + tests | Local GO; phone review |
| **REGISTRY-004** | Controlled production release | Smoke + phone acceptance for `CARPET-WALL` zero-bay |

No rotation/capacity/section-aware/joint-stewardship work in these tranches.

---

## 17. GO / CONDITIONAL GO / NO-GO

| Decision | Verdict |
|----------|---------|
| Architecture design | **GO** |
| Additive `store_aisles` registry (soft-joined) | **CONDITIONAL GO** — implement only after operator authorizes REGISTRY-002 |
| Execute migration / backfill / deploy now | **NO-GO** |
| Placeholder bays / nullable bay / hierarchy rewrite | **NO-GO** |
| Change capacity / Sunday / Zebra / section-aware flags | **NO-GO** |
| Joint stewardship | **NO-GO** (unchanged deferral) |

**Overall:** **CONDITIONAL GO** for a follow-on implementation program; **NO-GO** for any mutation in this tranche.

---

## Appendix A — File reference map

| Concern | Path |
|---------|------|
| Bay NOT NULL schema | `supabase/migrations/20260809_store_operations_rbac.sql` |
| Alphanumeric aisle | `supabase/migrations/20260811_alphanumeric_aisle.sql` |
| store_id on locations | `supabase/migrations/20260809_multi_store.sql` |
| RLS pattern precedent | `supabase/migrations/20261011_operational_sections.sql` |
| Aisle normalize / labels | `lib/store-ops/aisle.ts` |
| Map aisle compose | `lib/store-ops/map-aisle-navigation.ts` |
| Map UI | `components/admin/StoreLocationGrid.tsx` |
| Bulk create | `components/admin/BulkLocationGenerator.tsx`, `app/api/store-locations/bulk/route.ts`, `lib/store-ops/locations.ts` |
| Add Bay | `components/admin/AddBaySheet.tsx` |
| Sections | `lib/store-ops/section-aisle-membership.ts`, `components/admin/OperationalSectionsPanel.tsx` |
| Rotation eligibility | `lib/store-ops/location-eligibility.ts` |
| Cleanup aisle status | `lib/store-ops/workspace-cleanup.ts` |
| UX-004 blocker tests | `lib/store-ops/topology-ux-004.zero-bay.blocker.test.ts` |

---

## Appendix B — Alignment with TOPOLOGY-AREAS-001

TOPOLOGY-AREAS-001 recommended **Option A** (named codes in `aisle` TEXT) and deferred a metadata table until Option A failed a real workflow. **That failure is now confirmed** (zero-bay create). This registry is the minimal metadata/existence table foreshadowed there — **not** Option B area hierarchy or Option C tree.

**STOP.**
