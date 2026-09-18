# PRIORITY-UX-002 — Manual Coverage Priority + Map Placement

> **Mode:** Authorized implementation.  
> **Date:** 2026-09-18  
> **Baseline:** `main` @ `9db22ac` (PRIORITY-UX-001 archaeology complete; UX-REDUCE-005 accepted as prior).  
> **Evidence basis:** [`PRIORITY_UX_001_OPERATIONAL_PRIORITY_ARCHAEOLOGY.md`](PRIORITY_UX_001_OPERATIONAL_PRIORITY_ARCHAEOLOGY.md)

This tranche corrects `priority_override` selector semantics to Model A and places the surviving operational control on Map.

---

## Canonical product law

> Everything eventually gets touched.  
> Everything does not necessarily need to be touched at the same frequency.  
> Priority may change cadence.  
> Priority must not revoke the coverage obligation owed to everything else.

Clarifications encoded here:

- Priority increases selection pressure among eligible owed coverage.
- Priority does not bypass completion and does not independently re-admit completed coverage into the active cycle.
- Completion closes the current coverage obligation regardless of priority.
- Priority survives as a durable characteristic of the physical bay, but it influences selection again only when that bay becomes eligible in a subsequent coverage cycle.

---

## Canonical priority model

| Model | Persistence | Meaning | Must not |
|-------|-------------|---------|----------|
| **A. Manual priority** (this tranche) | Durable `store_locations.priority_override` (`true` = High) | When this physical bay is currently owed/eligible, prefer increased cadence | Re-admit COMPLETED; bypass completion; revoke ordinary obligation; change weekly quota |
| **B. Seasonal HIGH** | Ephemeral `operational_context_location_relevance` | Date-bounded selector pressure | Mutate durable High; persist onto `store_locations` |
| **C. Service / velocity** | `velocity_tier` | IRP/service class; walk logs may auto-promote | Be labeled High priority |
| **D. Overdue pressure** | `custom_decay_days` | Selector overdue weight | Be presented as High/Standard |
| **E. Current Attention** | Derived SI-001 | Observational | Become authoritative selector input or auto-mutate High |

These are not one score.

Internal field name `priority_override` is retained for compatibility. No schema rename. No `physical_bays` table.

---

## Before / after

**Before (PRIORITY-UX-001):** `priority_override` was a sticky Sunday carry-bucket pin. It survived completion and could re-admit COMPLETED bays, starving ordinary coverage. DS had to bury the declaration in More → Edit Bay as “Lock Priority Override.” Production had **zero** pins, so no pin-compatibility migration was required.

**After (PRIORITY-UX-002):**

1. Selector: owed/eligible first → then preference (true carry → seasonal HIGH → manual High → velocity/cadence hot pool → aging).
2. Map owns Standard / High for physical bays and aisle fan-out.
3. More → Edit Bay owns topology identity (aisle/bay/department/workflow/delete). Lock / Hotspot / Custom decay unmounted.
4. Floor remains people-first ownership and does not mutate priority.

---

## Selector correction

Narrowest locations:

- `isCarryOverDrawLocation` — true carry only (`CARRIED_OVER` / `carried_over`). Manual High is not carry.
- `physicalBayIsOwed` / `owedPhysicalBaySurfaces` — COMPLETED is not owed unless true carry. Durable High is not owed evidence.
- `selectPhysicalBayCoverage` — dedicated High pick **after** seasonal, **before** velocity pool, using existing `pickWeightedByPriorityAndAge`.
- `loadCarryOverPriorityPool` — no longer loads `priority_override.eq.true` as carry.

Weekly quota, Sunday cron, assignment ownership, and verification are unchanged.

Call-out carry still writes `priority_override` alongside true carry flags (assignment-ownership path not redesigned). After carry evidence is cleared, leftover High is now Model A pressure rather than a COMPLETED re-admission pin.

---

## Mutation / authorization

Canonical write path:

```text
POST /api/store-locations/physical-bay-priority
  { department_id, aisle, bay, priority: "standard" | "high" }
```

Server: resolve actor → Supervisor or Master → store department exists → `assertActorCanAccessDepartmentId` → sibling IN-list update → re-read → fail if faces disagree.

Aisle path remains `POST /api/store-locations/aisle-priority` with the same department-scope check added.

Authorized roles: `MASTER_ADMIN` / `DEPARTMENT_SUPERVISOR` within authorized department scope. Associates cannot mutate. Topology PATCH (“Only Super Admin can edit zone / map fields”) is unchanged. `canMutate=true` is never set on Map.

Offline: online-only (`storeOpsFetch`, not the mutation queue). Failed writes do not become authoritative local High.

---

## Map seam

`canMutateRotationPriority` is the explicit capability. Map still passes `canMutate={false}` into bay cells and Walk the Floor.

Permitted: physical-bay High/Standard; aisle Mark/Clear.

Not permitted: Sell/Top topology, Edit Bay, Delete Bay, Add Bay, Pin-to-week, weekly assignment.

Quiet presentation: Standard bays have no priority label. High bays show a compact **High** marker, distinct from Current Attention and Seasonal badges.

Mixed aisle: derived (`some High, some Standard`) — never labeled wholesale High. Clear aisle still discloses that individually marked High bays are also cleared (Approach A; no provenance column).

---

## More / Edit Bay disposition

| Control | Disposition |
|---------|-------------|
| Lock Priority Override | Unmounted from Edit Bay. Field retained. Map is canonical. |
| High-Velocity Hotspot | Unmounted from Edit Bay. `velocity_tier` retained. Walk-log auto-promotion unchanged. UX-REDUCE-006 residual: Bulk seed + topology HIGH chip. |
| Custom decay threshold | Unmounted from Edit Bay. `custom_decay_days` retained; selector math unchanged. |
| Bay workflow | Left mounted. Checklist routing; unrelated to rotation priority. UX-REDUCE-006 candidate. |
| Topology create/edit/delete | Remains in More → Department Setup. |
| Aisle Mark/Clear | Moved to Map; removed from AisleBayManager. |
| Bulk “Priority Lock” | Still a topology generator seed. UX-REDUCE-006 candidate. |

---

## Production / schema

No migration. No RLS change. No production mutation. PRIORITY-UX-001 found zero live pins.

---

## Tests

`lib/store-ops/priority-ux-002.manual-coverage-priority.test.ts` plus ENGINE-PROD-004 selector/UI updates.

---

## Out of scope (honored)

UX-REDUCE-006, PERF-LOAD-003, Floor redesign, generic Map mutation, schema rename, velocity/decay deletion, Seasonal CRUD, weekly quota, Sunday cron, assignment ownership, verification, AI priority, Current Attention auto-mutation.
