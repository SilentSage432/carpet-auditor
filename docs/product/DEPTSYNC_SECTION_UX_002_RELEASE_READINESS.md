# DEPTSYNC-SECTION-UX-002 — Named Zone Compatibility and Release Readiness

**Status:** COMPLETE (controlled local implementation + verification; no production deploy)  
**Date:** 2026-10-11  
**Mode:** Controlled implementation + release verification  
**Application:** https://deptsync-hub.vercel.app (unchanged this tranche)  
**Supabase:** `fmeinlwhixngednabhgy` (no SQL apply; no data mutations)  
**Store:** `2587`

**References:**  
[`DEPTSYNC_TOPOLOGY_AREAS_001_DISCOVERY.md`](DEPTSYNC_TOPOLOGY_AREAS_001_DISCOVERY.md) ·  
[`DEPTSYNC_SECTION_UX_001_IMPLEMENTATION.md`](DEPTSYNC_SECTION_UX_001_IMPLEMENTATION.md) ·  
[`DEPTSYNC_SECTION_ROTATION_001_DISCOVERY.md`](DEPTSYNC_SECTION_ROTATION_001_DISCOVERY.md) ·  
[`DEPTSYNC_SECTION_ROTATION_002_IMPLEMENTATION.md`](DEPTSYNC_SECTION_ROTATION_002_IMPLEMENTATION.md) ·  
[`DEPTSYNC_CAPACITY_GUARD_003_RELEASE.md`](DEPTSYNC_CAPACITY_GUARD_003_RELEASE.md)

**Strict exclusions honored:** No production deployment, no production data mutations, no database schema changes, no new physical-area table, no invented bays/zones, no joint-stewardship schema, no Sunday dispatch rewrite, no section-aware auto-stage activation, no capacity-guard weakening, no Zebra handoff changes.

**Legend**

| Tag | Meaning |
|-----|---------|
| **VERIFIED** | Confirmed in repository tests or source |
| **ASSUMPTION** | Reasonable inference not proven against live production topology |

---

## 1. Executive summary

Floor Command’s aisle identity is already alphanumeric TEXT. SECTION-UX-002 removes remaining **numeric-only presentation assumptions**, clarifies named-zone creation copy, surfaces **explicit** discoverable-bay inclusion for SECTION-UX-001, and verifies Map / Manage / Bulk / Section editor compatibility — without schema or production mutations.

| Gate | Result |
|------|--------|
| Named zone codes via existing aisle TEXT | **PASS** (**VERIFIED**) |
| Map / Manage display without fake “Aisle …” prefix on zones | **PASS** (**VERIFIED**) |
| Bulk / Add Bay accept alphanumeric codes | **PASS** (**VERIFIED**) |
| Bay creation under named zones (local path) | **PASS** (**VERIFIED** — no prod inserts) |
| SECTION-UX-001 aisle-first editor + named zones | **PASS** (**VERIFIED**) |
| Future bay discovery (explicit, never silent) | **PASS** (**VERIFIED**) |
| Joint stewardship | **Deferred** (documented; singular `primary_owner` unchanged) |
| Capacity guard / Sunday dispatch / Zebra | **Untouched** (**VERIFIED**) |
| Section-aware auto-stage / prod preview flag | **HARD OFF** (**VERIFIED**) |
| Typecheck / full tests / production build | **PASS** (`tsc`; **1626** tests; `next build`) |
| Production deploy this tranche | **NO-GO** (explicitly out of scope) |

**Combined SECTION-UX-001 + SECTION-UX-002 ship readiness:** **CONDITIONAL GO** (app deploy after operator phone review).  
**Production topology/data/schema/migrations:** **NO-GO**.  
**Section-aware automatic staging:** **NO-GO**.

---

## 2. Files changed

### SECTION-UX-002 focused deltas

| Path | Change |
|------|--------|
| `lib/store-ops/aisle.ts` | `isNumericAisleCode`, `formatAisleDisplayLabel` |
| `lib/store-ops/map-aisle-navigation.ts` | Map labels via `formatAisleDisplayLabel` |
| `lib/store-ops/map-aisle-navigation.test.ts` | Named-zone label + index tests |
| `components/admin/AisleBayManager.tsx` | Shared display labels (retired “Back Wall” special-case) |
| `components/admin/BulkLocationGenerator.tsx` | Empty default aisle; named-zone copy; text `inputMode` |
| `components/admin/AddBaySheet.tsx` | Zone validation copy |
| `components/admin/EditBayDrawer.tsx` | Zone-aware copy |
| `components/admin/OperationalSectionsPanel.tsx` | Discoverable-bays banner; joint-stewardship limitation copy; fingerprint freeze on toggle |
| `lib/store-ops/section-aisle-membership.ts` | `countDiscoverableBaysForSection` (explicit inclusion only) |
| `lib/store-ops/section-aisle-membership.test.ts` | Multi-zone + discoverable bay tests |
| `lib/store-ops/section-ux-002.named-zones.test.ts` | **New** named-zone contracts |
| `docs/product/DEPTSYNC_SECTION_UX_002_RELEASE_READINESS.md` | This report |

### Bundled prior local work (same working tree; ships together if authorized)

| Path | Milestone |
|------|-----------|
| `lib/store-ops/section-aisle-membership.ts` (+ tests) | SECTION-UX-001 |
| `components/admin/OperationalSectionsPanel.tsx` | SECTION-UX-001 aisle-first editor |
| `lib/rd3.operational-sections.contract.test.ts` | SECTION-UX-001 contracts |
| `lib/store-ops/section-aware-rotation.ts` (+ tests/contracts) | SECTION-ROTATION-002 (preview-only; auto-stage hard-off) |
| `components/admin/SundayAuditAssignmentModal.tsx` | SECTION-ROTATION-002 opt-in preview UI |
| Prior discovery/impl docs under `docs/product/DEPTSYNC_SECTION_*` / `TOPOLOGY_AREAS_001` | Docs |

**Unchanged by design:** capacity RPC, Sunday dispatch writers, RLS, auth, migrations, Zebra handoff, dual-dept auto-stage.

---

## 3. Existing topology compatibility

| Fact | Tag |
|------|-----|
| `store_locations.aisle` is TEXT; normalize = trim + uppercase | **VERIFIED** (`aisle.ts`, migration `20260811_alphanumeric_aisle.sql` per TOPOLOGY-AREAS-001) |
| Example codes `SHOW-L`, `SHOW-R`, `CLOTHING`, `CARPET-WALL` are valid shapes | **VERIFIED** (validation accepts); **not inserted** |
| No new physical-area table introduced | **VERIFIED** |
| Physical identity remains `(department_id, aisle, bay)` | **VERIFIED** |
| Store / department isolation preserved via existing section + location APIs | **VERIFIED** (existing authz; no new bypass) |
| Production store 2587 may not yet contain named zones | **ASSUMPTION** — operator still documenting some bays; no prod inventory mutation here |

Operator physical mapping (Nick 44/43 + left showroom; Tracy 42/41 + right showroom; Nate 40/39/7; Tyson 5/6 + clothing; Nick+Tracy carpet wall) remains an **operator documentation** task — not auto-created.

---

## 4. Named zone creation findings

| Requirement | Finding |
|-------------|---------|
| Accept alphanumeric codes | **VERIFIED** — `isValidAisle` / `normalizeAisle`; Bulk + Add Bay text inputs |
| No special technical knowledge | **VERIFIED** — placeholders cite `41`, `SHOW-L`, `CARPET-WALL`; Bulk no longer defaults aisle to `"1"` |
| Uniqueness / dedupe | **VERIFIED** — `locationDedupeAisleKey` collapses numeric padding only; named codes preserved |
| Store/dept isolation | **VERIFIED** — existing bulk/generate paths scoped by department |
| Duplicate prevention | **VERIFIED** — existing bulk upsert / unique constraints (schema unchanged) |
| Auth + active/retire | **VERIFIED** — no auth/lifecycle changes |
| Clear validation errors | **VERIFIED** — Add Bay error: “Enter an aisle or zone code…” |

---

## 5. Map compatibility

| Behavior | Result |
|----------|--------|
| Create via existing UI | **PASS** (Bulk / Add Bay) |
| Display without truncation/corruption | **PASS** — labels use full normalized code; named zones omit misleading “Aisle” prefix |
| Open / edit / associate bays | **PASS** — aisle key remains string; Manage uses `formatAisleDisplayLabel` |
| Mobile navigation / search | **PASS** — `filterAisleIndexByQuery` matches named codes (**VERIFIED** unit) |
| Distinguished from numbered aisles | **PASS** — `Aisle 41` vs `SHOW-L` |
| Full Map redesign | **Not done** (in scope exclusion) |

Bay tags: numbered → `A41-B07`; named → `CARPET-WALL-B03` (**VERIFIED** `formatBayTag`).

---

## 6. Bay management compatibility

| Requirement | Result |
|-------------|--------|
| Canonical bay identity | Unchanged `(dept, aisle, bay[, type])` |
| Parent aisle need not be numeric | **VERIFIED** |
| Edit / retire exclusion | Existing paths; retired excluded from section active index |
| Service history | Untouched |
| Idempotent retries | Existing bulk generators; no new duplicate path |
| Production bay creation | **Not performed** |

---

## 7. Section editor compatibility (SECTION-UX-001)

| Check | Result |
|-------|--------|
| Multi-select aisles / named zones | **PASS** |
| Active bay counts / expansion / preview | **PASS** |
| Conflicts / zero-bay / partial | **PASS** |
| Additive edit; no silent transfer | **PASS** |
| Explicit membership persistence | **PASS** (existing members API) |
| Store isolation / authorization | **PASS** (existing Supervisor/Master + dept scope) |
| Named zones alongside numbered | **PASS** (natural sort + shared labels) |
| No bay-by-bay requirement | **PASS** |

---

## 8. Future bay inclusion behavior

| Rule | Implementation |
|------|----------------|
| Never silently add new bays | Expansion uses current topology snapshot only |
| Never infer historical aisle membership includes future bays | Empty selection adds zero; discovery is opt-in |
| Prefer small explicit workflow | Detail banner `sections-discoverable-bays` + re-select via **Add aisles** |
| `countDiscoverableBaysForSection` | Counts unassigned active bays in aisles/zones already represented by the section; excludes claimed elsewhere |

**No new subsystem** — reuse SECTION-UX-001 picker.

---

## 9. Known limitations

1. **Joint stewardship** not implemented (singular `primary_owner_specialist_id`).  
2. Named zones must be **operator-created**; no auto-insert of SHOW-L / CARPET-WALL / etc.  
3. Undocumented bays cannot appear in sections until Map/Bulk documents them.  
4. Section-aware Hybrid preference remains **preview-gated**; Sunday auto-stage hard-off.  
5. ESLint `react-hooks/set-state-in-effect` still flags pre-existing detail/focus sync in `OperationalSectionsPanel` (fingerprint sync effect removed this tranche). Does not fail `tsc` / vitest / `next build`.  
6. Live production named-zone inventory not re-queried this tranche (**ASSUMPTION**: may be empty until operator documents).

---

## 10. Joint stewardship boundary

| Item | Status |
|------|--------|
| Carpet wall: one physical location + one section + two stewards | **Future milestone** |
| Duplicate bays/sections for two owners | **Forbidden / not done** |
| `primary_owner` semantics | **Unchanged** |
| Multi-person assignment UI | **Not implemented** |
| UI disclosure | Section picker copy states joint stewardship is not available yet |

---

## 11. Rotation / capacity safety

| Control | Status |
|---------|--------|
| Shared store-week capacity RPC (3/eligible; cross-dept) | **Preserved** — no writer changes |
| Transactional assignment enforcement | **Preserved** (CAPACITY-GUARD-003 production) |
| Duplicate prevention / eligibility | **Preserved** |
| Sunday dispatch | **Not modified** for section preference |
| Section-aware auto-stage | `SECTION_AWARE_ROTATION_AUTO_STAGE = false` |
| Preview flag in production | Must remain unset / not `1` |
| Zebra handoff | **Untouched** |

---

## 12. Tests and build results

| Gate | Result |
|------|--------|
| Focused named-zone + membership + map + rotation contracts | **63 PASS** (earlier focused batch); membership+ux-002 **24 PASS** after fingerprint fix |
| Full suite | **1626 PASS** / **129** files |
| `npx tsc --noEmit` | **PASS** |
| `npx eslint` (changed UX-002 surfaces) | Fingerprint effect cleared; **3 pre-existing** `set-state-in-effect` errors remain on focus/detail sync |
| `npm run build` | **PASS** |

Covered: numeric + alphanumeric IDs, validation, dedupe, bay tags, Map labels/navigation, Bulk defaults, multi-zone section selection, conflicts/partial (UX-001 suite), discoverable bays, no auto-include, store isolation contracts, authz non-regression via existing RD-3 tests, rotation/capacity non-wiring, joint-stewardship deferral copy, mobile min hit targets (UX-001 contracts).

---

## 13. Production release checklist

**Do not execute until operator authorizes a separate deploy tranche.**

- [ ] Operator phone review: create named zone (e.g. one showroom code) on non-prod or intentional Map edit  
- [ ] Confirm numbered aisles still open/edit/navigate  
- [ ] Create/edit Operational Section via aisle multi-select including a named zone  
- [ ] Confirm discoverable-bay banner after adding a bay to a section’s existing aisle  
- [ ] Confirm conflict visibility when bay already in another section  
- [ ] Confirm `NEXT_PUBLIC_DEPTSYNC_SECTION_AWARE_PREVIEW` **not** set to `1` on Production  
- [ ] Confirm no new migrations pending for this ship (none required)  
- [ ] Auth/RLS unchanged smoke: `/login` 200; anon containment intact  
- [ ] Capacity guard smoke: assignments still fail-closed through RPC  
- [ ] Commit + push + Vercel Production Ready (separate authorization)  
- [ ] Post-deploy: section create/add aisles; Map named zone; Sunday Assign default path unchanged  

**Migrations:** none for UX-001/UX-002.  
**Env flags:** leave section-aware preview off.  
**Existing production topology:** operator documents zones/bays; agent must not invent rows.

---

## 14. Rollback approach

| Layer | Rollback |
|-------|----------|
| App | Redeploy prior Vercel deployment / revert git commit |
| Data | No schema; membership remains bay-keyed — retiring a bad section or removing members is sufficient |
| Named zones | Soft-retire locations (`is_active=false`) via existing cleanup; do not hard-delete if history exists |
| Section-aware preview | Ensure env flag unset (already default off) |

No irreversible DDL in this tranche.

---

## 15. GO / CONDITIONAL GO / NO-GO

| Decision | Verdict |
|----------|---------|
| Ship SECTION-UX-001 + SECTION-UX-002 together (app code) | **CONDITIONAL GO** — after phone review + deploy authorization |
| Apply DB migrations for this work | **NO-GO** — none required / none authorized |
| Mutate production topology/sections/assignments here | **NO-GO** |
| Enable section-aware automatic staging | **NO-GO** |
| Enable section-aware preview flag in Production | **NO-GO** |
| Implement joint stewardship now | **NO-GO** (documented boundary) |
| Dual-department auto-stage | **NO-GO** (unchanged program constraint) |

**Overall tranche verdict:** **CONDITIONAL GO** for a future app-only production deploy of SECTION-UX-001 + SECTION-UX-002.  
**This session:** verification complete; **no commit / push / deploy** performed.

**STOP.**
