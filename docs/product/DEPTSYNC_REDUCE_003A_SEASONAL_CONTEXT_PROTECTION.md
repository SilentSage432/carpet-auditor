# DEPTSYNC-REDUCE-003A — Seasonal Context Protection

**Status:** DOCS-ONLY PRODUCT-BOUNDARY AMENDMENT · **COMPLETE (docs)**  
**Date:** 2026-09-15  
**Amends:** [DEPTSYNC_REDUCE_002_BOUNDARY_AND_DECOUPLING_SPEC.md](./DEPTSYNC_REDUCE_002_BOUNDARY_AND_DECOUPLING_SPEC.md)  
**Companion:** [REDUCE-002A Floor Pad protection](./DEPTSYNC_REDUCE_002A_FLOOR_PAD_PROTECTION.md) remains in force  
**Runtime:** unchanged by this amendment alone · **Commit:** authorized only as part of repository reconciliation

---

## 1. Purpose

Correct the reduction contract so **Seasonal Context / seasonality intelligence** is not swept away by specialty retirement.

Canonical disposition:

> **PROTECTED — ROTATION CADENCE INPUT**  
> **KEEP** where it provides evidence-backed deterministic cadence input to continuous coverage.

Seasonal UI: **PROTECTED FROM GENERIC DELETION**; presentation may be reconsidered during later rotation-focused UI simplification — **not redesigned here**.

---

## 2. Why it belongs in the reduced product

Seasonality answers:

> Does current seasonal context provide evidence that some physical locations should receive **increased coverage cadence**?

It may influence eligibility timing, relative cadence, deterministic attention, and selection pressure.

It must **not**: revoke baseline coverage obligation · permanently starve ordinary locations · manufacture physical evidence · complete/verify work · override DS authority · become a task system · invent work merely because a season exists.

Laws preserved:

> Everything eventually gets touched.  
> Everything does not necessarily need to be touched at the same frequency.  
> Priority may change cadence. Priority must not revoke the coverage obligation owed to everything else.

---

## 3. Current runtime ownership (no redesign)

| Layer | Owners |
|-------|--------|
| Domain | `lib/store-ops/operational-context.ts` (FS-002), location relevance APIs in same module family |
| Floor presentation | `floor-operational-context.ts`, `FloorOperationalContextStrip` |
| Map presentation | `map-location-context.ts`, Map badges / Walk sheet detail |
| Attention coupling | SI-001 may consume seasonal **effect** as evidence (deterministic); does not write rotation |
| Admin UI | `OperationalContextCard` (More → Settings, Master) |
| APIs | `GET /api/operational-contexts`, `/api/admin/operational-contexts*` |
| Schema | `operational_contexts`, `operational_context_department_relevance`, `operational_context_location_relevance` (**LIVE**; empty seed valid) |

**Seam note:** Map/`WalkTheFloorSheet` also host OOS Visual Bay Scan mounts — future subtraction must remove Snap mounts **without** removing seasonal detail. Floor strip is CORE-adjacent presentation; Settings card is admin. Fiscal calendar (`fiscal_*`) remains supporting time authority for strips — do not confuse fiscal with seasonal declaration.

Protection applies to the **capability**, not a blank check that every surrounding widget is permanently frozen.

---

## 4. Reduction sequence implication

Nav/specialty deletion and specialty runtime retirement **MUST NOT** remove:

- operational context domain/APIs/schema  
- Floor/Map seasonal presentation required to express declared relevance  
- SI seasonal evidence inputs that are already deterministic  

…merely because “intelligence surfaces” are being reduced.

FLOORPAD-001 remains independent. Schedule-aware allocation remains a later CORE tranche. Do not wire seasonality into Force Draw silently in this tranche.

---

## 5. Floor Pad unchanged

REDUCE-002A stands: Walk & Talk / Executive Floor Pad remain **PROTECTED — ROTATION OBSERVATIONAL CAPTURE EVALUATION PENDING**. Gemini is not globally KEEP.

---

*End of REDUCE-003A.*
