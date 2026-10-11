# DEPTSYNC-TOPOLOGY-AREAS-001 — Physical Areas and Joint Stewardship Discovery

**Status:** COMPLETE (read-only architectural investigation)  
**Date:** 2026-10-11  
**Mode:** Read-only — no implementation, no production mutations, no schema, no deployment  
**Application:** https://deptsync-hub.vercel.app  
**Supabase:** `fmeinlwhixngednabhgy`  
**Pilot store:** `2587`

**References:**  
[`DEPTSYNC_REDESIGN_001_COMPLETE_PRODUCT_EXPERIENCE_BLUEPRINT.md`](DEPTSYNC_REDESIGN_001_COMPLETE_PRODUCT_EXPERIENCE_BLUEPRINT.md) ·  
[`DEPTSYNC_SECTION_ROTATION_001_DISCOVERY.md`](DEPTSYNC_SECTION_ROTATION_001_DISCOVERY.md) ·  
[`DEPTSYNC_SECTION_ROTATION_002_IMPLEMENTATION.md`](DEPTSYNC_SECTION_ROTATION_002_IMPLEMENTATION.md) ·  
[`DEPTSYNC_SECTION_UX_001_IMPLEMENTATION.md`](DEPTSYNC_SECTION_UX_001_IMPLEMENTATION.md) ·  
[`DEPTSYNC_CAPACITY_GUARD_003_RELEASE.md`](DEPTSYNC_CAPACITY_GUARD_003_RELEASE.md) ·  
[`DEPTSYNC_RD_3_OPERATIONAL_SECTIONS.md`](DEPTSYNC_RD_3_OPERATIONAL_SECTIONS.md)

**Not authorized:** topology/section/roster/assignment mutations, migrations, capacity changes, section-aware auto-stage activation, Map redesign, SECTION-UX-001 modification, deployment, commit, push.

**Legend**

| Tag | Meaning |
|-----|---------|
| **VERIFIED** | Confirmed in repository (and prior production inspections where cited) |
| **RECOMMENDATION** | Design judgment for future implementation tranches |

---

## 1. Executive summary

Floor Command already stores physical places as **alphanumeric aisle/zone codes + bay numbers** under a department, with Operational Sections as an explicit bay-membership overlay and a **single optional steward**. The operator’s floor model (numbered aisles, showroom sides, clothing showroom, carpet back wall with Nick+Tracy joint responsibility, occasional two-person roll handling) fits that substrate **without inventing fake aisle numbers** — but **joint stewardship and two-person task requirements are not yet first-class**.

| Concern | Today | Gap vs operator model |
|---------|-------|------------------------|
| Numbered aisles 5–7, 39–44 | Supported as `aisle` TEXT | Operator still documenting some bays |
| Showroom L/R, clothing, carpet wall | Representable as named zone codes | Not yet documented as zones; no separate “area” entity |
| Section membership | Explicit bays; ≤1 active section/bay | Compatible with multi-aisle / multi-zone sections |
| Stewardship | Single `primary_owner_specialist_id` | Cannot express Nick+Tracy joint ownership accurately |
| Two-person work | Not modeled | Stewardship ≠ required participants ≠ weekly assignee |
| Capacity | 3/person; shared store-week RPC | Must not double-count one bay as two slots |

**Verdict**

| Question | Result |
|----------|--------|
| Discovery complete? | **GO** |
| Implement physical-area entity table now? | **NO-GO** — existing aisle/zone TEXT is sufficient first |
| Document named zones (SHOW-L, CARPET-WALL, …) as topology? | **CONDITIONAL GO** — operator-driven Map/bulk; no schema |
| Joint stewardship schema tranche? | **CONDITIONAL GO** — additive stewards relation recommended |
| Two-person assignment / capacity change now? | **NO-GO** — separate later tranche after stewardship |
| Production mutation from this report? | **NO-GO** |

---

## 2. Existing topology findings

### 2.1 Canonical location model (**VERIFIED**)

| Concept | Representation | Citation |
|---------|----------------|----------|
| Department | `departments` (`id`, `code`, `store_id`, `is_active`) | Store Ops schema / RD-3 |
| Aisle / zone | `store_locations.aisle` **TEXT**, nonempty, uppercase normalize | `20260811_alphanumeric_aisle.sql` L8–30; `lib/store-ops/aisle.ts` L9–16 |
| Bay | `store_locations.bay` integer | Unique with type |
| Surface type | `type` SELLING / TOPSTOCK (dual rows per physical bay) | `20260810_store_locations_type_unique.sql` |
| Specialty / showroom rapid-touch | `location_type` `STANDARD` \| `SHOWROOM_STACKOUT` | `types.ts` L18, L82–83; CHAT_HANDOFF showroom note |
| Display vs merch workflow | `workflow_type` (orthogonal) | `types.ts` L84–85 |
| Retired | `is_active=false` soft-retire | Cleanup / Map showRetired |
| History | Rotations, verifies, `bay_service_logs`, barriers, walkthrough place refs | Blueprint §D.2 |

Physical identity for coverage and sections:

```text
(department_id, aisle, bay)  →  physicalBayKey / sectionBayKey
```

(`lib/store-ops/physical-bay.ts`; `operational-sections.ts`)

### 2.2 Are aisle identifiers required to be numeric?

**VERIFIED: No.** Migration comment: *“Alphanumeric aisle / zone code (TEXT), e.g. BW, RW, 12, A1”* (`20260811_alphanumeric_aisle.sql` L29–30).  
`formatBayTag` already formats `BW-B12` style (`types.ts` L223–235).  
Map groups by `(department_id, aisle)` with natural sort (`map-aisle-navigation.ts` L17–28, L61–66; `compareAisles` numeric-aware).

**RECOMMENDATION:** Prefer meaningful codes (`SHOW-L`, `SHOW-R`, `CLOTHING`, `CARPET-WALL`) over fake numbers (`99`, `100`). Fake numbers create false geography and harm Map/section UX.

### 2.3 Can existing structures represent non-aisle spaces?

| Space | Without new schema? | Notes |
|-------|---------------------|-------|
| Showrooms (L/R) | **Yes** — named zone codes + bay sequence | Use `STANDARD` if weekly rotation should include them |
| Back / carpet wall | **Yes** — named zone + bays | Document only known bays; do not invent |
| Clothing showroom | **Yes** — named zone | Same |
| Specialty rapid-touch only | Partial — `SHOWROOM_STACKOUT` | **Excluded from weekly aisle draw** (`location-eligibility.ts` L15–20; `rotations.ts` SHOWROOM filters) |

**VERIFIED tension:** `SHOWROOM_STACKOUT` is intentionally **not** weekly-rotation eligible. Operator showroom/clothing areas that need Sunday assignment should be mapped as `STANDARD` named zones (or a later product decision must extend eligibility — out of scope here).

### 2.4 Incomplete topology (**VERIFIED product constraint**)

Operator is still documenting bays. Engine and SECTION-UX-001 only consume **documented active** locations. Do not invent missing topology (SECTION-ROTATION-001 / SECTION-UX-001 laws).

---

## 3. Physical-area model comparison

### A. Named locations within existing aisle hierarchy

Treat “areas” as **aisle/zone codes** already supported by `store_locations.aisle`.

| Criterion | Assessment |
|-----------|------------|
| Complexity | Lowest — no schema |
| Map compatibility | Native aisle index |
| Section membership | SECTION-UX-001 expands by aisle key |
| Historical integrity | Same location UUID / bay key history |
| Mobile usability | Same aisle list; labels via `formatMapAisleLabel` |
| Rotation | Works if `STANDARD` + active |
| Migration | None |
| Maintainability | High if naming convention is documented |

### B. Explicit physical-area entities containing bays

New `physical_areas` table + membership to bays (or to aisle codes).

| Criterion | Assessment |
|-----------|------------|
| Complexity | Medium–high (CRUD, Map, sections, migrations) |
| Map | New navigation layer |
| Sections | Another overlay on an overlay |
| History | Must dual-write or join carefully |
| Migration | Required |
| Value | Only if areas ≠ aisle codes long-term |

### C. Generalized location hierarchy

Dept → Area → Aisle → Bay (or recursive tree).

| Criterion | Assessment |
|-----------|------------|
| Complexity | Highest |
| Risk | Over-engineering vs one-store Floor Command |
| Migration | Heavy |

### Recommendation

**RECOMMENDATION: Option A** — named zone codes in the existing aisle field.

Optional later (only if labels/metadata outgrow codes): lightweight `aisle_display_name` / zone metadata table keyed by `(store_id, department_id, aisle)` — still not a full area hierarchy.

Do **not** introduce Option B/C until Option A fails a real operator workflow.

---

## 4. Recommended location architecture

```text
Department (merged Flooring / Home Decor today)
  └── Aisle / Zone code (TEXT): "5", "41", "SHOW-L", "CARPET-WALL", "CLOTHING", …
        └── Bay number (integer sequence within zone)
              └── SELLING / TOPSTOCK surfaces (as today)
```

**Suggested operator mapping (illustrative — not production data):**

| Steward focus | Zone codes (examples) |
|---------------|------------------------|
| Nick | `43`, `44`, `SHOW-L` |
| Tracy | `41`, `42`, `SHOW-R` |
| Nate | `7`, `39`, `40` |
| Tyson | `5`, `6`, `CLOTHING` |
| Joint Nick+Tracy | `CARPET-WALL` (bays as documented) |

**Operational Sections** then group those bays:

- Nick’s section(s) / Tracy’s / Nate’s / Tyson’s — single steward each  
- **Carpet Back Wall** section — joint stewards Nick + Tracy (see §6)

**Preserve:** incomplete documentation; only create bays the operator confirms.

---

## 5. Operational Section compatibility

### 5.1 Verified model

| Fact | Evidence |
|------|----------|
| Tables | `operational_sections`, `_members`, `_events` (`20261011_operational_sections.sql`) |
| ≤1 active section per bay | Unique expression index on normalized `(department_id, aisle, bay)` (migration L90–98) |
| Explicit bay membership | Member rows; not aisle-range persistence (RD-3; SECTION-UX-001 expands then stores bays) |
| Steward today | Optional singular `primary_owner_specialist_id` (migration L19–39) |
| History | Events: created, renamed, owner_changed, member_*, retired, reactivated |
| Store / department scope | `store_id` + `department_id`; members must match dept |
| Cross-aisle / multi-zone section | **Allowed** — membership is bay-keyed (RD-3 §C) |
| Editing | SECTION-UX-001 aisle multi-select; no silent moves of conflicted bays |

### 5.2 Multi-area-type membership

**VERIFIED:** One section can already contain bays from aisle `41` and zone `CARPET-WALL` — both are just `(department_id, aisle, bay)` keys.

**Preserve:** do not duplicate carpet-wall bays into Nick’s and Tracy’s personal sections to fake joint ownership.

---

## 6. Joint stewardship options

### 6.1 Product requirement (**operator-verified intent**)

Carpet back wall is **one** place, **one** Operational Section, **two** responsible associates (Nick + Tracy), because roll handling often needs two people. Ordinary inspection/zoning may still be one person.

Blueprint today assumes **one** permanent owner (Blueprint §E.1) — **APPROVED TARGET singular**; joint stewardship is a **new product requirement** beyond RD-3.

### 6.2 Options

| Option | Model | Pros | Cons |
|--------|-------|------|------|
| A. Duplicate sections | Two sections, same bays | — | **Violates** ≤1 section/bay; rejected |
| B. Duplicate bays | Two topology copies | — | Corrupts geography; rejected |
| C. Primary + secondary columns | Two FKs on `operational_sections` | Small | Caps at 2; awkward history |
| D. Stewards junction table | `operational_section_stewards (section_id, specialist_id, role, …)` | N stewards; history; no bay duplication | Additive migration |
| E. Description-only “Nick & Tracy” | Text field | No schema | Not queryable; breaks preference/UI |

### 6.3 Recommendation

**RECOMMENDATION: Option D** — additive `operational_section_stewards`:

```text
section_id → operational_sections
specialist_id → store_specialists  (ON DELETE SET NULL or RESTRICT + soft clear)
role: primary | joint | secondary   (or unordered joint set + optional primary)
UNIQUE (section_id, specialist_id)
```

Compatibility path:

1. Keep `primary_owner_specialist_id` temporarily as denormalized “display primary” synced from stewards, **or**  
2. Migrate existing primary into stewards and deprecate column in a later tranche.

Events: extend `owner_changed` / add `steward_added` / `steward_removed` (schema change to events check constraint).

Deactivation: soft-archive associate should **not** delete history; clear or mark inactive steward rows intentionally (operator action).

Authorization: reuse Supervisor/Master section mutate path + store-scoped load.

Mobile: Map/This Week show “Nick · Tracy” (joint) instead of single steward line (`ThisWeekOwnershipBoard` steward copy today assumes one name).

**Do not implement in this discovery.**

---

## 7. Two-person work requirements

### 7.1 Distinctions (**VERIFIED**)

| Concept | Owner today | Notes |
|---------|-------------|-------|
| Location stewardship | Operational Section steward(s) | Persistent responsibility |
| Weekly assignment ownership | `sunday_bay_assignments` (one roster owner per bay/week) | Capacity-gated |
| Work reported | `weekly_rotations.is_completed` / `PENDING_VERIFICATION` | Not verification |
| Operator verification | `verification_status = VERIFIED_COMPLETE` | Strongest close |
| Walkthrough companion | `companion_specialist_id` on sessions | Observational, not bay labor |

**VERIFIED:** No first-class “required participants” or “actual participants” on weekly bay work.

### 7.2 Where should two-person requirements live?

| Boundary | Fit for carpet-roll handling |
|----------|------------------------------|
| Physical location (always) | **Too strong** — not every visit needs two people |
| Operational Section (always) | **Too strong** — joint stewardship ≠ every task is two-person |
| Task type / work kind | **Good** — e.g. “roll move” vs “zone check” |
| Individual weekly assignment attempt | **Good** — when that week’s work needs two bodies |

**RECOMMENDATION:** Treat two-person need as a **task/assignment attribute** (optional), not as permanent location law and not as a second weekly ownership row that duplicates the bay.

Future shape (design only):

- One bay assignment remains the coverage unit (capacity + Map).  
- Optional `required_participant_count` or linked helper participants on the rotation/assignment attempt.  
- Completion/verification still close **one** physical bay.

**Do not implement joint assignments in the next stewardship tranche.**

---

## 8. Shared capacity implications

**VERIFIED (CAPACITY-GUARD-002/003):**

- Max 3 non-cleared assignments per eligible associate per store-week  
- Shared target = eligible × 3  
- Writer: `upsert_sunday_bay_assignments_with_capacity`  
- Completed rows still consume until cleared  
- One row per `(store, dept, week, bay_id)`

| Joint-work question | Implication |
|---------------------|-------------|
| Physical bay coverage | **One** bay still one coverage obligation |
| Duplicate prevention | Must not create two ownership rows for same bay/week |
| Individual capacity | If both Nick and Tracy are “on” the same bay as assignees, naive double-write **breaks** unique ownership — avoid |
| Completion / verify | Still one bay lifecycle |
| Reassignment | Existing RPC reassignment semantics |

**RECOMMENDATION:** Keep capacity semantics unchanged for now. Joint **stewardship** must not consume capacity. Future two-person **execution** should not inflate shared bay count; if helper labor must count toward personal quota, that needs an explicit later product rule + possibly schema — **STOP and design** before weakening the RPC.

---

## 9. Section-aware rotation implications

**VERIFIED** (`lib/store-ops/section-aware-rotation.ts`):

- Soft preference uses **singular** `primary_owner_specialist_id` (L132–133, L159–160, L309–317)  
- `steward_match` when assignee === that one id  
- Auto-stage remains hard-off (`SECTION_AWARE_ROTATION_AUTO_STAGE = false`)

**Future multi-steward changes (design only):**

1. Resolve steward set from junction (or primary + joints).  
2. `steward_match` if assignee ∈ steward set.  
3. Within-tier ranking: bay preferred if **any** eligible steward matches.  
4. Distribution: still one assignee per bay; prefer a steward with remaining capacity (deterministic id order among joint stewards).  
5. Never duplicate bay selection; never exceed caps; never leapfrog priority tiers.

**Do not activate automatic staging. Do not modify the selector in this discovery.**

---

## 10. Map experience recommendations

**VERIFIED:** Map is aisle → bay (`composeMapAisleIndex`); sections appear on bay sheet, not aisle clutter (RD-2/RD-3).

**RECOMMENDATION (no redesign now):**

- Named zones appear in the **same aisle list** as numeric aisles (natural sort already handles `41` vs `SHOW-L`).  
- Optional later: group header “Aisles” / “Showrooms & walls” via prefix convention (`SHOW-*`, `CARPET-*`) — presentation only.  
- Bay sheet continues to show section + steward list (joint names).  
- Do not require a sixth nav tab for areas.

Preserve mobile-first large targets (SECTION-UX-001 / Map patterns).

---

## 11. Aisle-first editor compatibility (SECTION-UX-001)

**VERIFIED:** SECTION-UX-001 multi-selects Map aisle keys and expands active bays (`section-aisle-membership.ts`). Works for any aisle TEXT code present in active topology.

**Later support for named areas:**

- Once `CARPET-WALL` / `SHOW-L` exist as documented locations, they appear as selectable “aisles” automatically.  
- Partial conflicts / preview / no silent moves remain valid.  
- Joint stewardship editing is **orthogonal** (steward picker), not membership expand.

**Do not modify SECTION-UX-001 in this discovery.**

---

## 12. Migration requirements

| Capability | Migration needed? |
|------------|-------------------|
| Named zone topology (Option A) | **No** — use existing `store_locations` |
| Joint stewardship (Option D) | **Yes** — additive stewards table + optional event types |
| Two-person task requirements | **Likely later** — not in stewardship tranche |
| Capacity semantics change | **Avoid**; if ever needed, new RPC version — high bar |
| Map / SECTION-UX presentation | App-only |

If stewards migration proceeds (future):

- Additive only; backfill from `primary_owner_specialist_id`  
- Preserve members, sections, history  
- Keep RLS store-scoped SELECT; writes via service role + API auth  
- Rollback: stop writing junction; primary column remains until cutover complete  
- No destructive drops of membership/assignment tables

**Do not create or execute migrations in this tranche.**

---

## 13. Recommended implementation sequence

| Stage | Scope | Ships alone? |
|-------|-------|--------------|
| **0** | Operator documents named zones + bays on Map (no eng schema) | Yes |
| **1** | Naming convention + optional Map label polish | Yes |
| **2** | Joint stewardship schema + API + More UI (multi-steward) | Yes — after 0 for Carpet Wall membership |
| **3** | Map / This Week joint steward presentation | With or right after 2 |
| **4** | Section-aware preference reads steward **set** (still flag-gated) | After 2; auto-stage still off |
| **5** | Two-person task/assignment requirements | Separate — after 2–4 proven |
| **6** | Capacity rule for helper labor (only if product demands) | Last; do not bundle |
| **7** | Zebra handoff | Independent later |

Avoid bundling area entities, joint assignments, and capacity rewrites in one PR.

---

## 14. Regression test plan (future tranches)

| Area | Tests |
|------|-------|
| Named zones | Create/read `SHOW-L` / `CARPET-WALL`; normalizeAisle; formatBayTag |
| Numbered aisles | Existing aisle sort + bulk unchanged |
| Area→bay | Expand SECTION-UX select includes only active documented bays |
| Retired topology | Inactive excluded |
| Store isolation | Cross-store section/zone denied |
| Section membership | ≤1 section/bay; multi-zone section OK |
| Multiple stewards | Add/remove joint; unique pair; history events |
| Steward history | owner/steward events append-only |
| Missing associates | SET NULL / clear joint without deleting section |
| Shared responsibility | One section, one membership set, two stewards |
| Two-person task (later) | Requirement flag ≠ duplicate bay assignment |
| Rotation compatibility | SHOWROOM_STACKOUT still excluded unless product changes |
| Capacity | Unchanged RPC contracts; no double bay ownership |
| Duplicate prevention | Same physical key |
| Map compatibility | Named zones in aisle index; bay sheet joint labels |

---

## 15. GO / CONDITIONAL GO / NO-GO

| Gate | Verdict |
|------|---------|
| Discovery complete | **GO** |
| New physical-area entity table | **NO-GO** (prefer named aisle/zone codes) |
| Operator documents named zones in existing topology | **CONDITIONAL GO** |
| Joint stewardship implementation tranche | **CONDITIONAL GO** (additive stewards; no bay duplication) |
| Two-person weekly assignments / capacity change | **NO-GO** now |
| Section-aware auto-stage activation | **NO-GO** |
| Production mutations / migrations from this report | **NO-GO** |

---

## Appendix — Key citations

| Path | Relevance |
|------|-----------|
| `supabase/migrations/20260811_alphanumeric_aisle.sql` | Aisle TEXT / zone codes |
| `supabase/migrations/20261011_operational_sections.sql` | Single steward + bay membership |
| `lib/store-ops/aisle.ts` | normalizeAisle / compareAisles |
| `lib/store-ops/types.ts` L78–83, L223–235 | Aisle docs + bay tags |
| `lib/store-ops/location-eligibility.ts` | SHOWROOM excluded from weekly draw |
| `lib/store-ops/map-aisle-navigation.ts` | Aisle-first Map index |
| `lib/store-ops/section-aisle-membership.ts` | SECTION-UX-001 expand/preview |
| `lib/store-ops/section-aware-rotation.ts` | Singular steward preference |
| `lib/store-ops/shared-week-capacity.ts` | Capacity authority |
| Blueprint §E | Singular permanent owner (to be extended for joint) |

---

## Appendix — Verified vs recommendation

| Item | Kind |
|------|------|
| Aisle is alphanumeric TEXT; numeric not required | VERIFIED |
| Sections are explicit bay membership; ≤1 active/bay | VERIFIED |
| Steward is singular optional FK today | VERIFIED |
| SHOWROOM_STACKOUT excluded from weekly rotation | VERIFIED |
| SECTION-UX-001 expands any aisle code with active bays | VERIFIED |
| Section-aware soft preference assumes one steward; auto-stage off | VERIFIED |
| Prefer named zones over new area entity | RECOMMENDATION |
| Joint stewards junction table | RECOMMENDATION |
| Two-person work as task/attempt attribute, not duplicate bays | RECOMMENDATION |

**STOP — discovery only. No implementation started.**
