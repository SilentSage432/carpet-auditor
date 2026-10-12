# DEPTSYNC-TOPOLOGY-UX-004 — Independent Location Creation

**Status:** BLOCKED — NOT IMPLEMENTED (schema constraint proven)  
**Date:** 2026-10-11  
**Mode:** Controlled investigation + stop before schema  
**Application:** https://deptsync-hub.vercel.app  
**Supabase:** `fmeinlwhixngednabhgy`  
**Store:** `2587`

**Trigger:** Real-device phone acceptance failure on SECTION-UX-003 location creation — operator cannot create `CARPET-WALL` without entering bay numbers.

**Strict exclusions honored:** No production deploy, no production data mutations, no fake/placeholder bays, no new physical-area table implemented, no capacity/Sunday/Zebra/section-aware changes.

**Legend**

| Tag | Meaning |
|-----|---------|
| **VERIFIED** | Confirmed in repository schema/source/tests |
| **RECOMMENDATION** | Design for a later authorized tranche |

---

## 1. Root cause

### Phone failure (**VERIFIED**)

All mounted location-creation entry points create **bay rows**, not aisle/zone shells:

| Entry | Behavior |
|-------|----------|
| Bulk Location Generator (Manage / Map topology) | Requires Start Bay + End Bay; CTA **Create physical bays**; calls `expandBayNumbers` → `bulkGenerateLocations` |
| Add Bay sheet | Requires bay integer; creates Selling+Topstock for one bay |
| Edit Bay | Edits existing bay row |
| CSV batch | Requires `start_bay`/`end_bay` (or `bay`) per row |

Named-zone **codes** (`CARPET-WALL`, `SHOW-L`, …) are accepted as aisle TEXT after SECTION-UX-002, but the workflow still cannot save a zone with **zero** bays.

### Persistence model (**VERIFIED** — blocking)

Canonical table `public.store_locations` (migration `20260809_store_operations_rbac.sql`):

```sql
bay integer not null check (bay >= 0),
unique (department_id, aisle, bay, type)
```

Alphanumeric aisle migration (`20260811_alphanumeric_aisle.sql`) changed aisle to TEXT but **kept bay in the identity key**.

There is **no** aisle-registry / physical-area / named-zone table in `supabase/migrations/`.

Therefore:

- Zero-bay locations are **not** supported by the current persistence model.
- The UI requires bays because the API/`buildBulkLocationRows` can only upsert bay-keyed rows.
- This is **not** a display-only bug.

### Map composition (**VERIFIED** — secondary)

`composeMapAisleIndex` builds exclusively from `store_locations` rows and **skips** groups with `activeBayCount === 0` when not showing retired. Even if empty shells existed in memory, today’s Map would not show them without composer changes.

### Mission stop condition

> No database schema changes unless an actual blocking constraint is proven.  
> If a schema change is necessary, STOP and report before implementing it.  
> Do not create a new physical-area table.  
> Do not force operators to create placeholder or fake bays.

**Blocking constraint is proven.** Implementing independent location creation requires an authorized additive schema (aisle/zone registry) or an equally consequential schema redesign. **STOP — no feature implementation in this tranche.**

---

## 2. Files changed

| Path | Change |
|------|--------|
| `lib/store-ops/topology-ux-004.zero-bay.blocker.test.ts` | **New** — root-cause / blocker regression suite |
| `lib/store-ops/map-aisle-navigation.test.ts` | Empty named-zone cannot appear without bay rows |
| `docs/product/DEPTSYNC_TOPOLOGY_UX_004_IMPLEMENTATION.md` | This report |
| `DEVELOPMENT_JOURNAL.md` / `CHAT_HANDOFF.md` / `MASTER_ROADMAP.md` | Program records |

**No application feature code, no migrations, no production mutations.**

---

## 3. Before / after workflow

### Before (production today — SECTION-UX-003)

```text
Create Location (named zone or aisle)
        │
        ├── Enter aisle/zone code  ✓ (alphanumeric OK)
        ├── Enter Start Bay        ✗ required
        ├── Enter End Bay          ✗ required
        └── Create physical bays   → store_locations rows only
```

Operator cannot document `CARPET-WALL` / showrooms before bays are known without inventing bay numbers.

### After (this tranche)

**Unchanged.** Desired target for a later authorized tranche:

```text
Create Location
        │
        ├── Save Location (aisle/zone shell, 0 bays)
        └── Add Bays (optional, later)
```

Bulk “create aisle + bay range” remains a convenience path when bays are known.

---

## 4. Empty location persistence

| Question | Answer |
|----------|--------|
| Supported today? | **No** (**VERIFIED**) |
| Why? | `bay NOT NULL` + unique `(department_id, aisle, bay, type)` |
| Fake bay `0` / sentinel? | **Rejected** — violates “no placeholder or fake bays”; would pollute rotation/coverage |
| Nullable `bay` on `store_locations`? | **Not recommended** — breaks physical-bay identity, rotation selectors, section membership keys |
| **RECOMMENDATION** | Additive aisle/zone registry table (e.g. `store_aisles`: `store_id`, `department_id`, `aisle` TEXT, `is_active`, timestamps) with unique `(department_id, aisle)`. Map merges registry ∪ bay groups. Bays remain in `store_locations`. |

Schema design and migration are **out of scope** until operator authorizes a named schema tranche.

---

## 5. Map visibility

| Today | Target (future) |
|-------|-----------------|
| Only aisles with ≥1 active bay row appear | Empty registered locations visible |
| No “0 documented bays” state | Clear empty state + **Add Bays** |
| — | No false coverage / attention from empty shells |

Composer change required alongside registry (**RECOMMENDATION**).

---

## 6. Section selector behavior

| Rule | Today | Future empty location |
|------|-------|------------------------|
| Visible in aisle-first picker | Only aisles with mapped active bays | May list empty zones (**RECOMMENDATION**) |
| Membership | Explicit bay refs only | Still **zero** memberships when zero bays |
| Fabricated memberships | Not done | Must not invent |
| Coverage counts | Bay-based | Empty ≠ coverage |
| Future-bay auto-include | Never | Never — keep SECTION-UX-001 discoverable re-select |

UI must explain: selecting an empty location cannot establish durable section membership until bays are documented.

---

## 7. Rotation safety

| Control | Status |
|---------|--------|
| Shared capacity RPC | Untouched |
| Assignment writers | Untouched |
| Sunday dispatch | Untouched; no empty-aisle wiring |
| Section-aware auto-stage | Remains `false` |
| Production preview flag | Remains off |
| Zebra | Untouched |
| Empty location → weekly assignment | Impossible today (no rows); future registry must stay non-eligible |

---

## 8. Security review

| Concern | Status |
|---------|--------|
| MasterAdmin / Super Admin bulk auth | Unchanged |
| Store isolation via department.store_id | Unchanged |
| RLS | Unchanged (no schema) |
| Duplicate bay identity | Unchanged |
| Active/retired | Unchanged |
| History | Untouched |
| Fake bays / weakening uniqueness | Not introduced |

---

## 9. Tests and build results

| Gate | Result |
|------|--------|
| Focused TOPOLOGY-UX-004 blocker suite | **9 PASS** |
| Map navigation tests | **9 PASS** |
| Full suite | **1636 PASS** / 130 files |
| `npx tsc --noEmit` | **PASS** |
| Relevant eslint | **PASS** (blocker + map tests) |
| `npm run build` | **PASS** |

Covered evidence: `bay NOT NULL`, no aisle-registry table, Bulk/Add Bay require bays, Map omits zero-bay aisles, section membership bay-keyed, dispatch non-wiring.

---

## 10. Production release readiness

| Decision | Verdict |
|----------|---------|
| Ship independent zero-bay location creation now | **NO-GO** |
| Deploy this tranche | **NO-GO** (nothing to deploy; stop condition) |
| Authorize additive aisle/zone registry schema | **CONDITIONAL GO** for a future named tranche |
| Continue documenting zones by inventing bay numbers | **NO-GO** as product guidance |
| SECTION-UX-003 location-creation phone acceptance | **FAILED** (accepted as real-device failure; feature blocked on persistence) |

---

## 11. Remaining limitations

1. Operators still cannot save empty aisles/zones until a schema tranche lands.  
2. SECTION-UX-001/002 named-zone *identity* works only once ≥1 bay exists.  
3. Joint stewardship still deferred.  
4. Recommended registry design not implemented or migrated.

---

## Recommended next tranche (not started)

**TOPOLOGY-UX-005 (name TBD) — Aisle/zone registry + empty Map shells**

1. Operator-authorized additive migration for aisle/zone registry (no fake bays).  
2. Create Location API (zero bays).  
3. Map empty presentation + Add Bays.  
4. Section picker empty-location messaging.  
5. Rotation eligibility remains bay-row-only.  
6. Controlled production release after phone acceptance.

---

## Final verdict

**BLOCKED — NOT IMPLEMENTED**

Root cause is a proven `store_locations.bay NOT NULL` persistence constraint, not a superficial form validation bug. Schema (or new registry table) is required; mission forbids inventing that change in this tranche.

**STOP.**
