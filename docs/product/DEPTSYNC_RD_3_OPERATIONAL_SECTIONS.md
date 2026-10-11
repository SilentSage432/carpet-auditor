# DEPTSYNC-RD-3 — Operational Sections Implementation Report

**Status:** COMPLETE (local implementation)  
**Date:** 2026-10-10  
**Authority:** [`DEPTSYNC_REDESIGN_001_COMPLETE_PRODUCT_EXPERIENCE_BLUEPRINT.md`](./DEPTSYNC_REDESIGN_001_COMPLETE_PRODUCT_EXPERIENCE_BLUEPRINT.md) §E; Constitution Art. V-A  
**Prerequisite:** RD-1 shell + RD-2 Map (phone-approved)  
**Not authorized:** commit, push, deploy, production migration execution, production topology/roster mutation, auth rewrite, Sunday engine rewrite

---

## A. Existing structures discovered

| Structure | Finding |
|-----------|---------|
| Product Operational Section | Approved target only — **no prior table/API** |
| Hub `HubSection` / `components/sections/*` | UI chrome modules — not domain |
| `operational_contexts` | Seasonal cadence — **different domain**; reused RLS/API shape |
| Physical bay | `(department_id, aisle, bay)` via `physicalBayKey` — membership grain |
| `store_locations` | Dual SELLING/TOPSTOCK surfaces; soft-retire `is_active` |
| Roster | `store_specialists` UUID rows — owner FK with `ON DELETE SET NULL` |
| Map bay sheet | RD-2 `walk-sheet-section-slot` placeholder — replaced |
| More → Department Setup | Natural home for section CRUD beside Aisles & bays |
| Sunday / weekly rotations | Separate ownership — **not** overloaded |

No competing ownership system was introduced. Weekly assignment remains authoritative for labor.

---

## B. Files changed

| Path | Change |
|------|--------|
| `supabase/migrations/20261011_operational_sections.sql` | **New** additive tables + RLS |
| `lib/store-ops/operational-sections.ts` | Domain list/create/update/retire/members + pure helpers |
| `lib/store-ops/operational-sections.test.ts` | Unit tests |
| `lib/rd3.operational-sections.contract.test.ts` | Source contracts |
| `app/api/operational-sections/route.ts` | GET list / POST create |
| `app/api/operational-sections/[id]/route.ts` | PATCH meta/lifecycle / DELETE soft-retire |
| `app/api/operational-sections/[id]/members/route.ts` | Add/remove members |
| `lib/store-ops/client.ts` | Browser clients + `STORE_OPS_SECTIONS_CHANGED_EVENT` |
| `lib/rbac.ts` | `canManageOperationalSections` |
| `components/admin/OperationalSectionsPanel.tsx` | **New** mobile management UI |
| `components/sections/SettingsSection.tsx` | More → Operational Sections accordion |
| `components/admin/WalkTheFloorSheet.tsx` | Real section / unsectioned + deep link |
| `components/admin/StoreLocationGrid.tsx` | Pass bay section lookup into sheet |
| `components/hub/tabs/MapTab.tsx` | Load active section index (non-blocking) |
| `lib/rd2.floor-command-map.contract.test.ts` | Placeholder text expectation relaxed |
| Docs | Journal / handoff / roadmap / state |

---

## C. Data model and invariants

```text
operational_sections
  store_id, department_id, name, description?,
  primary_owner_specialist_id?, is_active, retired_at

operational_section_members   -- ACTIVE membership only
  section_id, store_id, department_id, aisle, bay
  UNIQUE (department_id, aisle, bay)   ← one active section per physical bay

operational_section_events    -- append-only history
  created | renamed | owner_changed | member_added |
  member_removed | retired | reactivated
```

| Invariant | Enforcement |
|-----------|-------------|
| ≤1 active section per physical bay | Trigger normalizes aisle (`normalizeAisle`); unique expression index on `(department_id, normalize(aisle), bay)` |
| Members match section department | App validation + department_id on section |
| Cross-aisle OK | Membership is bay-keyed, not aisle-keyed |
| Unsectioned bays valid | Absence from members |
| Soft-retire | Members cleared to history events; `is_active=false`; name reusable when retired |
| Owner optional | `primary_owner_specialist_id` nullable (mission); stewardship ≠ weekly labor |

Membership references **physical bay identity**, not a single `store_locations.id` (avoids SELLING/TOPSTOCK split bugs).

---

## D. Migration details

**File:** `supabase/migrations/20261011_operational_sections.sql`  
**Additive only.** Not executed against production in this tranche.

- FKs: `stores` CASCADE, `departments` RESTRICT, `store_specialists` SET NULL  
- Section delete cascades members/events only (API uses soft-retire, not hard delete)  
- Aisle normalize trigger + expression unique index (case/whitespace) — RD-3-FIX-001  
- Partial unique active name per `(store_id, department_id, lower(name))`  
- No authenticated write policies

---

## E. Authorization and RLS

| Action | Gate |
|--------|------|
| List / Map read | Store Ops actor + service role query; RLS SELECT store-scoped via `jwt_matches_store` |
| Create / update / members / retire | `requireSupervisorOrAdmin` → actor `store_id` → `loadOperationalSectionForStore` → `assertActorCanAccessDepartmentId` |
| Associates | Cannot mutate; Map shows section when present |

Client-supplied `store_id` is ignored. Service role never substitutes for operator authorization. Cross-store section IDs return `not_found`.

---

## F. Mobile management experience

**More → Department Setup → Operational Sections** (`#operational-sections`)

- List / create / rename / notes / owner select  
- Retire / reactivate  
- **Aisle-first bay picker** (reuses RD-2 `composeMapAisleIndex`) — no department accordion  
- Claimed bays in other sections disabled  
- Phone-sized targets (`min-h-12`)

---

## G. Map integration

- Aisle index **unchanged** (no section clutter)  
- Bay detail sheet: section name + owner, or **Unsectioned**  
- “Open section details” → `/settings?section=<id>#operational-sections`  
- Copy clarifies stewardship ≠ this week’s assignment  
- Section fetch failures are non-blocking (empty index)

---

## H. Roster ownership behavior

- Owner picker from `fetchSpecialists` (existing roster records)  
- No new accounts, auth flows, or duplicate identities  
- Clearing owner allowed; ownership changes emit `owner_changed` events  
- Owner does **not** attribute completions or block Cross Ownership work

---

## I. Rotation compatibility

**Untouched:** Sunday generation, weekly capacity (12), completion evidence, historical rotations, assignment APIs/selectors.  
Section domain code does not import or call rotation selection.

---

## J. Verification results

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | Pass |
| Relevant RD-3 / RD-2 tests | Pass |
| `npm test -- --run` | **1385 passed** (104 files) |
| `npm run build` | Pass — routes include `/api/operational-sections*` |
| Lint | No new lint rule debt introduced by design; pre-existing hub `set-state-in-effect` noise unchanged |

---

## K. Known limitations

- Migration **must** be applied before production API use (else 503 `missing_relation`; Map degrades gracefully).  
- Sections scoped to one `department_id` (Constitution); merged Flooring/Home Decor uses current flooring dept until TOPO split.  
- Reactivate restores empty membership (history retained in events; no automatic re-hydrate).  
- Engine section preference deferred (blueprint RD-6 / later).  
- Overview people-row section chips deferred.  
- Owner optional in UI (mission) while Constitution prefers continuous owner — operator can always assign.

---

## L. Production rollout requirements

1. Operator authorizes commit/push/deploy separately.  
2. Apply `20261011_operational_sections.sql` to the **existing** Supabase project (not a new project).  
3. Confirm RLS policies present; no secrets invented.  
4. Smoke: create section, add cross-aisle bays, open Map bay sheet, retire section.  
5. Do **not** run Sunday rotation/bootstrap as part of section rollout.

---

## M. Phone review instructions (local / post-migration)

1. More → Department Setup → **Operational Sections** → New section.  
2. Assign optional owner from roster; add bays via aisle picker (two aisles).  
3. Map → aisle → bay → confirm section name/owner; try unsectioned bay.  
4. Open section details from sheet; retire/reactivate.  
5. Confirm This Week stage/assign/verify unchanged.

**STOP — wait for release authorization. Do not begin RD-4 / topology migrate / walkthrough storage.**
