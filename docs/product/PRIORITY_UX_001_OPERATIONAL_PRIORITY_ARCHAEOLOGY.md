# PRIORITY-UX-001 — Operational Priority Archaeology

> **Mode:** Read-only product + engine archaeology.  
> **Date:** 2026-09-18  
> **Baseline:** `main` @ `9db22ac` (UX-REDUCE-005 complete).  
> **Runtime:** unchanged. No UI moves, no Map/More/topology/selector/persistence/schema/production mutation.

This report traces what current priority-related controls **actually persist and consume**, before any redesign of placement or vocabulary.

---

## 1. Repository baseline

| Check | Result |
|-------|--------|
| HEAD | `9db22acdc646112e7c1170628725ac08cb276ad0` |
| Branch | `main` = HEAD = `origin/main` |
| Expected commit | `9db22ac feat: simplify More around setup and administration` |
| Prior accepted history | `405c632` UX-REDUCE-002 · `c44881f` UX-REDUCE-003 · `b494b02` UX-REDUCE-004 · `f5d5648` PERF-LOAD-002 · `9db22ac` UX-REDUCE-005 |
| Worktree | Clean except existing untracked `tmp/` |
| This tranche | Docs only. UX-REDUCE-005 was not modified. No PRIORITY-UX-002 implementation. No UX-REDUCE-006 start. |

Accepted shell used as product context (not redesigned here):

| Tab | Job |
|-----|-----|
| Floor | Who has what this week? |
| Map | Where are we across the department? |
| Roster | Who do I have, and when are they scheduled? |
| More | Setup and administration |

Coverage law under test:

> Everything eventually gets touched. Everything does not necessarily need to be touched at the same frequency. Priority may change cadence. Priority must not revoke the coverage obligation owed to everything else.

Provisional distinction (not encoded):

> Topology defines what physical geography exists. Operational priority tells the rotation engine that existing geography should receive increased cadence/selection preference.

---

## 2. Executive finding

**The DS operational need is real, and current controls do not serve it.**

If a DS realizes on the floor that a bay or aisle should be worked more often, today’s path is topology editing:

```text
More → Department Setup → Aisles & bays → expand aisle → find bay → Edit
  → High-Velocity Hotspot
  → Lock Priority Override
  → Custom decay threshold
  → Bay workflow
```

plus aisle-level **Mark aisle high priority / Clear aisle priority** on the same accordion.

That is the wrong job for those controls, **and** the four Edit Bay switches are not one concept.

The architecture **does** already distinguish topology from rotation pressure, but the UI and vocabulary collapse several unrelated models:

| What the DS likely means | What HEAD actually has |
|--------------------------|------------------------|
| “Work this existing bay more often.” | Sticky `store_locations.priority_override` (carry-bucket pin). This is the live durable manual rotation-priority flag. |
| Same intent, aisle-wide | Same flag, fanned out by `POST /api/store-locations/aisle-priority`. No aisle-level table. |
| Seasonal “work this more while Christmas is on” | Ephemeral `operational_context_location_relevance = HIGH`. Never writes `priority_override`. |
| “This bay sells / holes out fast” (IRP walk) | `velocity_tier` + `last_serviced_at` + `bay_service_logs`. Selector input **and** Advanced Map cadence paint. |
| “Try to return about every N days” | `custom_decay_days` (3–21). Selector pressure only. Not an obligation. |
| “What needs attention right now” | SI-001 Current Attention. Derived. **Not** a selector input. |

**The control labelled High-Velocity Hotspot is not a truthful “work more often” switch.** It writes `velocity_tier` (`high`, preserving `critical_hotspot`). It shares a Sunday hot pool with ordinary overdue bays. Age weight inside that pool can prefer a long-owed ordinary bay over a recently covered hotspot. It can also be auto-promoted by walk-the-floor service logs. In current production data it would **not** even change the stored 14-day threshold, because every row already has `custom_decay_days = 14` and Edit Bay does not retune the slider when the hotspot is toggled.

**The control labelled Lock Priority Override is the durable manual rotation pin**, not a lock against intelligence. It does not freeze `velocity_tier`. It does not block seasonal HIGH. It does not prevent walk-log auto-tier. It **does** put the physical bay into the Sunday **carry bucket**, and `physicalBayIsOwed` treats `priority_override` as still-owed **even after COMPLETED**. That is a live starvation vector if many bays are pinned. Call-out carry-over also writes this same flag and assignment only clears `carried_over`, so a call-out can accidentally create a permanent pin.

**Map can become the operational mutation surface for durable manual priority without opening topology mutation**, but **not** by setting existing `canMutate=true`. That flag currently gates Sell/Top topology toggles and Pin-to-week. The required seam is a new, narrow rotation-priority capability that reuses `priority_override` writers.

**Floor should not grow priority mutation.** Floor’s accepted job is weekly ownership.

**No schema/migration is required to start PRIORITY-UX-002** if the canonical everyday control is Standard / High → `priority_override` at physical-bay scope. Production currently has **zero** pins and **zero** sibling disagreements, so there is no live data to normalize first. Call-out pollution and COMPLETED-re-admit semantics are engine debt to disclose, not silently “fix” inside a placement tranche.

---

## 3. Complete priority-state inventory

Canonical table (every priority-like concept found at HEAD):

| Concept | Persisted? | Scope | Human or derived? | Authoritative? | Selector input? | Survives completion? | Survives cycle reset? | Current UI | Recommended future role |
|---------|------------|-------|-------------------|----------------|-----------------|----------------------|-----------------------|------------|-------------------------|
| `store_locations.priority_override` (“Lock Priority Override”, aisle high priority, bulk Priority Lock, call-out stamp) | Yes, boolean, default false | Topology row; composed OR across SELLING/TOPSTOCK; aisle SET/CLEAR fans out to all eligible surfaces in dept+aisle | Human declaration (also written by call-out carry) | Yes, as sticky Sunday pin | **Yes — carry bucket (1)** plus ×4 inside later weighted pick | **Yes — and re-admits COMPLETED into owed pool** | Yes (reset does not touch it) | Edit Bay; aisle Mark/Clear; Bulk Generator; LOCK chip in AisleBayManager | **Canonical durable operational priority** (rename in UI) |
| Aisle high priority | No aisle row. Mutation of many `priority_override` values | Department + aisle, all active non-SHOWROOM surfaces | Human | Yes, via fan-out | Same as override | Same | Same | AisleBayManager only (More) | Keep as aisle convenience over the same flag |
| `store_locations.velocity_tier` (“High-Velocity Hotspot”) | Yes, `standard` \| `high` \| `critical_hotspot` | Topology row; composed as worst sibling | Human toggle **and** auto-promote from walk logs (promote-only) | Yes as IRP cadence class; **not** the reduced “work more often” declaration | **Yes — velocity/cadence hot pool (3)** plus ×3/`×6` weight | Survives as a field; COMPLETED high-tier bays **do not** re-enter until cycle reset | Yes | Edit Bay; Bulk seed; AisleBayManager HIGH/CRITICAL chip; Map Advanced cadence hotspot paint | Demote from everyday DS priority. Keep as advanced service-cadence class if still needed |
| `critical_hotspot` | Same column | Same | Auto-promote from ≥2 `critical_hole` logs in 30 days; Edit Bay will not demote it when hotspot stays on | Same | Same, stronger weight | Same as tier | Yes | Same as hotspot (toggle cannot set it directly) | Keep as measured-walk residue, not a DS vocabulary |
| `store_locations.custom_decay_days` | Yes, integer 3–21 or null | Topology row; composed as **min** sibling | Human (Bulk/Edit always write a number today) | Yes as cadence override | **Yes — overdue joins hot pool (3)**; multiplier in weights | Field survives; overdue pressure only while still owed / in pool | Yes | Edit Bay slider; Bulk seed | Optional advanced cadence; not required for a two-state High/Standard model |
| Velocity-tier default cadence (14d standard / 5d high) | Not a column. Used only when `custom_decay_days` is null/invalid | Same | Derived default | Code default | Same as decay | n/a | n/a | Copy in Bulk Generator | Hidden default. Production currently never uses it (all rows = 14) |
| `store_locations.last_serviced_at` | Yes | Topology row; composed as oldest-or-never | Derived from walk logs | Yes as walk-touch time | Age for decay multiplier / cadence-due; **distinct from** `last_completed_at` | Yes | Yes | Map Advanced cadence; Walk the floor | Service-cadence evidence, not rotation priority |
| `bay_service_logs` intensity | Yes | Per walk event | Human walk action | Yes as walk evidence | Indirect: may promote `velocity_tier` | n/a | n/a | WalkTheFloorSheet | Service-velocity model only |
| `store_locations.manual_priority_count` | Yes, integer ≥0 | Topology row; composed as max sibling | Side effect of pin-to-week / extra-bay staging | Weak. Not a declared High | **Yes — remaining-pool weight (4)** `(1+count)×age×velocity` | Yes | Yes | No everyday control. Pin-to-week gated off on Map | Do not promote to DS vocabulary. Treat as legacy weight residue |
| Pin-to-week | Writes rotation row + increments `manual_priority_count` | This week + durable counter | Human, but Map `canMutate=false` hides it | Assignment is authoritative for the week; counter is sticky weight | Indirect | Counter survives | Counter survives | WalkTheFloorSheet only if `canMutate` | Keep gated. Not the operational High control |
| `store_locations.carried_over` + `status=CARRIED_OVER` | Yes | Topology row | Human explicit Reassign → carry; assignment clears `carried_over` | Yes as true carry-over | **Yes — carry bucket (1)**, ranked above sticky override | Flag cleared on assign/complete; `last_carried_over_at` remains for 14-day badge | Status reset to PENDING does not clear override | Floor / Sunday “Carry-Over Priority” badge | Keep as incomplete-work debt, **separate** from durable High |
| `last_carried_over_at` | Yes | Topology row | Stamp | Provenance for badge | Carry sort only | Badge window 14d | Survives | Same badge | Presentation only |
| Seasonal HIGH location relevance | Yes, `operational_context_location_relevance.relevance` | Context × location id; collapsed to physical-bay key | Human Master declaration | Yes as seasonal claim | **Yes — ephemeral bucket (2)**, still-owed PENDING only | Does **not** re-admit COMPLETED | Independent of cycle; expires by inclusive date window | More → Rotation Setup (Master); Map badges; Floor strip; Walk detail; seasonal aisle assign | Keep. Not durable manual priority |
| Seasonal department relevance | Yes | Context × department | Human Master | Yes as claim | Not a physical-bay selector key (SI may read it) | n/a | n/a | OperationalContextCard; Floor strip | Keep as context, not bay pin |
| Current Attention (SI-001) | No (derived per request) | Location assessment | Derived from evidence + declared seasonal | Intelligence only | **No** | n/a | n/a | Floor summary; Map markers; Walk sheet | Observational only |
| REC-001 staging consideration | No (pure domain, unwired) | Department candidate pool | Derived from Attention | Advisory foundation | **No runtime consumer** | n/a | n/a | None | Do not wire as priority |
| Map “Needs attention” coverage state | No | Physical bay presentation | Derived readiness tone | Presentation | No | n/a | n/a | Map everyday geography | Coverage geography, not priority |
| `store_locations.workflow_type` (“Bay workflow”) | Yes | Topology row | Human | Yes for Floor checklist routing | **No** | Yes | Yes | Edit Bay; Bulk Generator | Unrelated. Stay in topology/setup |
| `audit_frequency_days` / SHOWROOM | Yes | Showroom rows (excluded from aisle rotation) | Human | Showroom Quick Touch due | Not Sunday aisle selector | Yes | Yes | Showroom Quick Touch | Unrelated |
| Coverage age (`last_completed_at`) | Yes | Topology row; composed oldest-or-never | Derived from verified/auto-verified close | Yes as coverage memory | Age weight + cadence-due fallback | Timestamp survives; COMPLETED cools until reset **unless** override | Reset does not clear timestamp | Map Covered/Remaining; SI stale | Coverage-cycle evidence |
| Cycle cool-down (`status=COMPLETED` + `cycle_number`) | Yes | Topology row | System on verify | Yes | Excludes from pending pool unless carry/override evidence | Until department cycle reset | Reset → PENDING, cycle++ | Implicit | Universal coverage mechanism |
| Coverage debt / incomplete week work | Rotations + carry flags | Week / location | Human + system | Yes | True carry-over | Until completed or carried | Independent | Floor ownership; carry badge | Keep distinct from High |

---

## 4. High-Velocity Hotspot semantics

### 4.1 Surface

- UI: `components/admin/EditBayDrawer.tsx` switch **High-Velocity Hotspot**.
- Host: `AisleBayManager` Edit on a physical-bay pair (More → Department Setup → Aisles & bays).
- Bulk cousin: Bulk Generator **High Velocity / Fast Mover (5-day cadence)** via `velocitySeedFromPreset("high")`.

### 4.2 Persist

Toggle ON writes `store_locations.velocity_tier`:

- `"high"` if current is `standard` or `high`
- leaves `"critical_hotspot"` if already critical (`nextVelocityTierForToggle`)

Toggle OFF writes `"standard"` (this **does** demote `critical_hotspot`).

Also always writes whatever the decay slider currently holds (`custom_decay_days`). **Toggling the hotspot does not retune the slider.** If the row already has `custom_decay_days = 14`, saving hotspot ON persists **high + 14**, not the 5-day bulk preset.

Edit Bay loops `faces` and PATCHes each sibling UUID separately.

### 4.3 Schema / API

- Column: `store_locations.velocity_tier` (`20260814_bay_velocity_heatmap.sql`), check `standard|high|critical_hotspot`, default `standard`.
- Comment: *auto-promoted from heavy/critical service logs*.
- PATCH `/api/store-locations` accepts `velocity_tier`.
- **Role gate:** `velocity_tier` is in `mapEdit`. **Department Supervisor cannot write it.** Only `super_admin` (Hub Master). A DS Save on Edit Bay sends aisle/bay/tier/decay/workflow together and receives **403 “Only Super Admin can edit zone / map fields”**.

### 4.4 Auto-change

`lib/store-ops/bay-service.ts` `logBayService`:

- stamps `last_serviced_at`
- `nextVelocityTier`: promote-only from recent `bay_service_logs` (30-day window; 2+ hot intensities → `high`; 2+ `critical_hole` → `critical_hotspot`)
- **does not read `priority_override`**
- **does not demote**
- writes **one** `location_id` (one sibling)

Walk-the-floor can therefore create SELLING/TOPSTOCK split tiers.

### 4.5 Selector effect

`isRotationVelocityPriority` is true for `high` / `critical_hotspot` **or** `priority_override`.

In `selectPhysicalBayCoverage`:

1. Carry bucket (true carry-over **or** `priority_override`)
2. Seasonal HIGH still-owed
3. `pickSundayVelocityPrioritized`: hot pool = velocity-priority **OR** cadence-due; then remaining aging pool

Hotspot alone does **not** enter the carry bucket.

Inside any weighted pick, `adaptiveDrawWeight` multiplies ×3 for `high`, ×6 for `critical_hotspot`.

Quota, cycle obligation, and eligibility filters are unchanged. Hotspot does not inflate people×3.

### 4.6 Lifecycle

Survives assignment, completion, verification, week boundary, and cycle reset as a column. COMPLETED high-tier bays **leave** the owed pool until cycle reset (unlike `priority_override`).

### 4.7 Is “High-Velocity” truthful?

**No, not for the DS sentence “this bay needs worked more often.”**

- It is a persisted **IRP velocity class**, historically for down-stocking heatmap + Sunday hot pool.
- It is **not** measured service velocity when toggled by a human; it **can** later be auto-promoted by measured walk intensity.
- It does **not** guarantee earlier selection than a long-owed ordinary bay (both can sit in the same hot pool; age can win).
- Production rows are all `standard` today; none are live hotspots.

Diagnostic (local, `selectPhysicalBayCoverage`, then removed):

- Fresh ordinary (serviced yesterday) vs `velocity_tier=high` → hotspot selected (hot pool vs rest pool).
- Long-owed ordinary vs recently covered hotspot → ordinary **can** be selected (shared hot pool; age weight).

---

## 5. Lock Priority Override semantics

### 5.1 Name vs field

UI label: **Lock Priority Override**.  
Persisted field: `store_locations.priority_override boolean not null default false`.  
Migration comment: *Manual Sunday-draw pin; rotation engine treats as velocity-priority.*

Nothing in the column name or consumers implements a “lock” against later intelligence.

### 5.2 What is being “locked”?

**Nothing is locked.**

| Candidate | Respected? |
|-----------|------------|
| Freeze `velocity_tier` against walk auto-promote | **No** |
| Freeze against seasonal HIGH | **No** — seasonal is a separate ephemeral bucket |
| Freeze against SI-001 / Gemini | **N/A** — those do not write this flag. Seasonal module explicitly never writes it |
| Keep the bay in the Sunday carry prepend | **Yes** — this is the real behavior |
| Prevent aisle CLEAR from wiping a bay pin | **No** — aisle CLEAR wipes all overrides in the aisle (disclosed) |

“Priority” here means **sticky Sunday-draw pin**, not a 1–n rank, not `manual_priority_count`, not seasonal HIGH.

“Override” is leftover IRP language: treat the location as velocity-priority even if `velocity_tier` is `standard`. `isRotationVelocityPriority` ORs the two. Independently, `isCarryOverDrawLocation` ORs the flag with true carry-over, which is **stronger** than the velocity hot pool.

### 5.3 Writers

| Writer | Sets | Clears |
|--------|------|--------|
| Edit Bay switch | chosen boolean on each face | chosen boolean |
| Aisle Mark / Clear | all eligible aisle surfaces | all, including individual pins |
| Bulk **Priority Lock** preset | true + `velocity_tier=high` + 5-day decay | false on Standard/High presets |
| Call-out Reassign **carry** | `true` plus `carried_over` + `status=CARRIED_OVER` | **does not clear override** |
| Sunday assign / extra-bay stage | — | clears `carried_over` only |
| Cycle reset | — | status/cycle only |
| Seasonal assign | — | never |
| SI-001 | — | never |

### 5.4 Concrete states

**Hotspot ON, Lock OFF**

- Persist: `velocity_tier=high`, `priority_override=false`.
- Later: walk logs may promote to `critical_hotspot`; seasonal HIGH may also apply; completion cools the bay for the rest of the cycle.
- Sunday: not in carry bucket. Competes in velocity/cadence hot pool with overdue ordinary bays.

**Hotspot ON, Lock ON**

- Persist: `high` (or critical) **and** `priority_override=true`.
- Sunday: carry bucket **before** seasonal and before hotspot pool.
- Completion does **not** remove carry-bucket membership.
- Walk logs may still promote tier.

**Seasonal HIGH while lock ON**

- Seasonal does not write or clear the lock.
- Selector: locked bay is picked in bucket 1; seasonal HIGH uses remaining slots.

**Coverage completed, lock ON**

- `status` may be `COMPLETED`.
- `owedPhysicalBaySurfaces` still includes the row because `isCarryOverDrawLocation` is true.
- Next generate loads it via `loadCarryOverPriorityPool` (`priority_override.eq.true` regardless of status).
- It can be selected again **in the same cycle**.

**Cycle reset, lock ON**

- Status returns to PENDING; override remains. Carry-bucket pressure continues in the new cycle.

### 5.5 Still live?

**Yes.** ENGINE-PROD-004 preserved it as sticky manual priority. Aisle UI was added on top of it. It is not dead.

It is **overloaded**: DS aisle High, Edit Bay Lock, bulk Priority Lock, and call-out carry all share one boolean with no provenance.

### 5.6 Reduced-product necessity

A durable “work this existing geography more often” declaration **is** necessary.

A control named Lock Priority Override **is not**. The reduced product needs the **flag’s carry-bucket job**, retargeted as High priority, with call-out pollution and COMPLETED-re-admit called out as engine law (not silently changed in a UX placement tranche).

---

## 6. Custom decay threshold semantics

### 6.1 Persist

- Column: `store_locations.custom_decay_days` (`20260815_custom_decay_days.sql`).
- Range: null or integer 3–21.
- Null → `defaultDecayDaysForTier`: 14 standard, 5 high/critical.
- Edit Bay slider always writes a number (initialized from `resolveDecayDays`).
- PATCH: Master only (`mapEdit`). DS cannot change it via Edit Bay.

### 6.2 Calculation

```text
age = days since last_serviced_at, else last_completed_at
cadence_due  = age != null AND age >= resolveDecayDays(loc)
multiplier   = (ageDays / days); ×2 if overdue; floor 0.5
```

Never-serviced / never-completed: `isCadenceDueForSundayDraw` is **false** (null age). `adaptiveDrawWeight` still treats missing `last_completed_at` as ~365 days for the remaining-pool weight.

### 6.3 Selector

Cadence-due locations join the **same hot pool** as `high` / `critical_hotspot` / `priority_override` (override already left in carry bucket). Reaching N days **does not guarantee** selection. It increases pool membership and weight.

### 6.4 Does this mean “return every N days”?

**No.** It means “once age ≥ N, treat this bay as cadence-due in the Sunday hot pool, and scale its draw weight by age/N.”

It does not create a visit obligation, a quota, or a cycle exemption.

### 6.5 Starvation

If many bays are cadence-due or high-tier, the hot pool can fill the weekly people×3 draw. Ordinary not-yet-due bays wait. Completed high-tier / cadence bays cool until cycle reset, so they cannot occupy the pool forever **unless** they also have `priority_override`. Universal coverage still depends on completing the hot set and on cycle reset. Custom decay alone is weaker than the lock.

### 6.6 Relationship to other knobs

| Other | Relationship |
|-------|----------------|
| Coverage age | Input to age and cadence-due |
| Service cadence | Uses `last_serviced_at` first, then `last_completed_at` |
| Manual lock | Separate, stronger bucket |
| Hotspot | Default 5-day **only if** `custom_decay_days` is null. Production currently stores 14 on every row, so hotspot does not imply 5-day |
| Seasonal HIGH | Separate earlier bucket; no decay write |
| Cycle obligation | Unchanged |

### 6.7 Needed under the reduced product?

Not as an everyday DS control. A two-state High/Standard pin already expresses “work more often.” The numeric threshold is distinct information (cadence length) but is currently undiscoverable, Master-gated, and globally 14 in production. Keep the column; hide it behind advanced setup until a later cadence-design tranche.

---

## 7. Bay workflow relationship

**Unrelated to rotation priority.**

`store_locations.workflow_type`: `STANDARD_MERCH` | `APPLIANCE_SIMS_AUDIT` | `BULK_PALLET_AUDIT`.

It chooses which Floor checklist a bay runs. Selector, seasonal, attention, and velocity do not consume it.

It sits in Edit Bay only because that drawer is a topology editor. Production: 584/584 `STANDARD_MERCH`.

**Do not relocate it with priority.** It should remain Department Setup / topology.

---

## 8. Aisle high-priority semantics

### 8.1 Mutation

`POST /api/store-locations/aisle-priority` → `setAislePriorityOverride`.

Supervisor+ (`requireSupervisorOrAdmin`). **DS can use this path** (unlike Edit Bay hotspot/decay).

SET/CLEAR updates `priority_override` for every **active, non-SHOWROOM** surface in `department_id + aisle` (normalized). One `UPDATE ... IN ids`.

- Both SELLING and TOPSTOCK siblings change.
- Every current physical bay in the aisle changes.
- Future bays **do not inherit** (no aisle table; new rows get Bulk/Add Bay defaults).
- Stored at **location** rows, not aisle level.
- Does **not** write `velocity_tier` or `custom_decay_days`.

### 8.2 Clear (Approach A)

Disclosed: clearing the aisle clears **all** overrides, including individually locked bays. `clear_erases_individual_locks: true`. UI `window.confirm` copy matches.

### 8.3 Selector / cycle / quota

Each physical bay with any sibling override enters the carry bucket. Quota unchanged. Completing a pinned bay does not clear the pin. Cycle reset does not clear the pin.

### 8.4 Precedence vs bay STANDARD

There is no stored aisle-vs-bay pair. After Mark aisle, every surface is HIGH (`priority_override=true`). A later Edit Bay can turn **one physical bay’s faces** back to false. Then:

- that bay is Standard
- neighbors remain High
- no engine “aisle HIGH wins”

Split siblings on one physical bay: composer **ORs** override (High wins for selection). That split can exist if a single-row PATCH happens; aisle SET/CLEAR and Edit Bay pair-save try to keep faces aligned.

---

## 9. Manual bay-priority semantics

All current human-ish “this should come up more” representations:

1. **`priority_override`** — the only sticky boolean pin. Edit Bay Lock, aisle Mark, bulk Priority Lock, call-out carry.
2. **`velocity_tier` high/critical** — IRP class + hot pool. Edit Bay Hotspot, bulk High Velocity, walk auto-promote.
3. **`custom_decay_days`** — numeric overdue threshold.
4. **`manual_priority_count`** — incremented by `assignLocationsToCurrentWeek` (Pin-to-week API + ENGINE-PROD-003 extra-bay staging). No DS-facing “priority” control. Weight only in bucket 4 / inside-pool weights.
5. **Seasonal HIGH** — Master-declared, ephemeral, separate table.
6. **True carry-over** — incomplete-work prepend, not a standing High.

There is no `pinned`, `attention`, or aisle-level priority column.

---

## 10. Physical-bay sibling behavior

BAY-UNIT-002: physical bay = `(department_id, aisle, bay)`. SELLING/TOPSTOCK are topology surfaces of one obligation.

| Control | Writes |
|---------|--------|
| Edit Bay Save | Each mapped face, same override/tier/decay/workflow |
| Aisle SET/CLEAR | All eligible surfaces in aisle (atomic IN-list) |
| Walk service log | **One** `location_id` |
| PATCH one id | That row only |
| Seasonal location relevance | Per location UUID; selector collapses HIGH to one physical key |

Composer (`composePhysicalBayCandidate`):

- `priority_override` = **OR**
- `velocity_tier` = **worst** (critical > high > standard)
- `custom_decay_days` = **min** numeric
- `manual_priority_count` = **max**
- timestamps = oldest-or-never (null wins)

**Split state is possible** and currently legal. Selector treats the physical bay as High/hot if either sibling is. Production (2026-09-18 read-only): **0** sibling disagreements across 292 physical bays (all have both faces).

---

## 11. Seasonal HIGH interaction

ENGINE-PROD-004 Model A is live.

Composition is **tiered buckets**, not score addition and not a single OR:

1. True carry-over / sticky `priority_override`
2. Active seasonal HIGH physical keys among **still-owed PENDING** (not already picked)
3. Velocity / cadence-due hot pool
4. Remaining aging + `manual_priority_count`

Weighted pick is used **inside** seasonal and later pools, not to mix seasonal with carry.

| State | Result |
|-------|--------|
| Manually high only | Carry bucket |
| Seasonally HIGH only | Bucket 2 while owed and window active |
| Both | Carry first; seasonal does not double-count a second slot for the same physical bay |
| Neither | Cadence/velocity then aging |

Seasonal **does not** mutate `priority_override` or `velocity_tier`. Inclusive Gregorian window; influence ends when the date resolve no longer returns HIGH. COMPLETED seasonal bays are not re-admitted (tests in `engine-prod-004.seasonal-priority.test.ts`).

Production: `operational_contexts` count 0; location/department relevance count 0. Engine is live; no declared seasons yet.

---

## 12. Current Attention interaction

SI-001 `location-attention-pressure-v1`:

- Derived, not persisted as priority.
- Explicitly **does not** consume `priority_override` or `manual_priority_count` (contract-tested).
- May **read** `velocity_tier` as a bounded MODIFY when operational need already exists.
- May **read** seasonal claims as CONTEXT/MODIFY.
- REC-001 can theoretically consider MEDIUM/HIGH attention candidates; **no runtime wiring**.

Product law holds at HEAD: intelligence interprets; it does not manufacture selector priority.

Map “Needs attention” is coverage-readiness presentation (`map-coverage-presentation.ts`), another derived geography state, not SI and not the selector.

---

## 13. Service cadence / velocity relationship

UX-REDUCE-003 demoted Map **Velocity Heatmap** to **Advanced · Service cadence** because walk velocity ≠ coverage-cycle age.

That Map view uses `classifyVelocityHeat(last_serviced_at, velocity_tier)`:

- hotspot paint if tier is high/critical
- else fresh ≤7d / decaying 8–18d / untouched >18d or never

**High-Velocity Hotspot belongs to this service-velocity model**, not to durable rotation priority. It wears an IRP name, shares a Sunday hot pool with cadence-due ordinary bays, and can be auto-promoted from walk intensity.

**Lock / aisle High belong to a different model:** sticky rotation pin / carry bucket.

Do not merge them in UX or docs because both say “velocity” or “priority.”

| | Service cadence | Durable rotation priority |
|--|-----------------|---------------------------|
| Primary fields | `last_serviced_at`, `velocity_tier`, `custom_decay_days`, `bay_service_logs` | `priority_override` |
| Clock | Walk touch | Coverage cycle + Sunday draw |
| Completing a bay | Does not clear tier | Should conceptually cool cadence **within** the cycle; **code currently re-admits override** |
| Map today | Advanced disclosure | Not shown |

---

## 14. Coverage debt / age relationship

| Term | Owner | Meaning |
|------|--------|---------|
| Coverage age | `last_completed_at` | Time since verified/auto-verified close. SI stale after `BAY_STALE_DAYS` (7). Selector age weight. |
| Service age | `last_serviced_at` | Walk-the-floor. Preferred for cadence-due / decay multiplier. |
| Coverage debt | Incomplete staged work, carry-over, remaining PENDING in cycle | Art. V. Incomplete work must not vanish. |
| Cycle cool-down | `COMPLETED` until department-wide reset | Prevents immediately re-drawing finished bays — **except** `priority_override` / true carry evidence. |

Priority is supposed to change **when** a still-owed bay is chosen, not whether the department ever owes it. Seasonal HIGH obeys that. Sticky override currently **revokes cool-down**.

---

## 15. Selector precedence / order

`selectPhysicalBayCoverage` (`physical-bay.ts`), used by Sunday generate, extra-bay +1, and (via those) ENGINE-PROD-002/003.

```text
candidate pool = pending PENDING ∪ carry pool (CARRIED_OVER | carried_over | priority_override)
                grouped by physical bay, SHOWROOM/inactive excluded
owed           = any surface carry/override OR status ≠ COMPLETED

1. Carry prepend (deterministic sort):
     true carry-over (status or flag)  >  priority_override
     then last_carried_over_at desc, aisle, bay
2. Seasonal HIGH keys ∩ remaining owed PENDING
     weighted by adaptiveDrawWeight
3. Velocity/cadence hot pool among remaining
     weighted
4. Rest (aging + manual_priority_count)
     weighted
```

`adaptiveDrawWeight`:

```text
(1 + manual_priority_count)
  × ageDays(last_completed_at or ~365d)
  × decayDrawMultiplier(custom_decay / last_serviced_or_completed)
  × 4 if priority_override
  × 6 if critical_hotspot else ×3 if high
```

Quota: people × 3 (ENGINE-PROD-002). Priority never changes draw count.

---

## 16. Priority lifecycle

| Event | `priority_override` | `velocity_tier` / decay | Seasonal HIGH | True carry-over | Attention |
|-------|---------------------|-------------------------|---------------|-----------------|-----------|
| Human set | Sticky until human/aisle clear | Sticky; walk may promote tier | Until date window ends | Until assign/complete | Recomputed |
| Sunday assignment | Survives; `carried_over` cleared | Survives | Unchanged | `carried_over=false` | n/a |
| Completion / verification | **Survives; bay remains owed if override** | Survives; COMPLETED cools unless override | Not re-admitted if COMPLETED | Cleared | Need families update |
| Week boundary | Survives | Survives | Active if dates include op date | Next draw prepends remaining carry | n/a |
| Cycle reset | Survives | Survives | Independent | Status → PENDING; override still pins | n/a |
| Seasonal expiration | Unchanged | Unchanged | Keys empty | Unchanged | Seasonal reasons drop |
| Call-out carry | **Set true** | Unchanged | Unchanged | Set true | n/a |

---

## 17. Starvation / universal-coverage analysis

**Seasonal HIGH and velocity hotspot:** Model A holds if those bays are **completed**. Tests prove seasonal first-draws then, once removed from the owed pool, ordinary bays fill later draws. COMPLETED hotspot is not re-admitted. Weekly volume stays people×3.

**Sticky `priority_override`:** Model A does **not** hold in the same way.

Deterministic local composition (diagnostic, then removed):

- 3 COMPLETED pins + 3 PENDING pins + 6 long-owed ordinary, draw 3 → **all 3 picks are pins**, including COMPLETED ones.
- Aisle of 3 High vs 3 ordinary, draw 3 → **all High**.

If pinned count ≥ weekly quota, ordinary bays wait until humans clear pins or the department can complete pins **and** the engine stops treating COMPLETED+override as owed. Today the engine does not stop.

**Theoretical forever-postpone:** yes, if enough locks remain. That **does** revoke the coverage obligation owed to ordinary geography — a product contradiction with ENGINE-PROD-004 / REDUCE-003A law.

Velocity hotspot + custom decay can **delay** ordinary bays while the hot set remains PENDING, but completion + cycle reset still reaches them.

---

## 18. Current UI placement inventory

| Location | View | Set | Clear | Cadence / velocity inspect | Seasonal inspect | Class |
|----------|------|-----|-------|----------------------------|------------------|-------|
| Floor This Week | Carry-Over Priority badge (carry window, not override). No High chip | No | No | No | Floor seasonal strip (declared context) | OPERATIONAL for ownership; **DISCOVERY POOR** for rotation priority |
| Floor Needs attention / SI summary | Attention pressure | No | No | Indirect (cadence overdue as SI reason) | SI seasonal reasons | OPERATIONAL observational |
| Floor Pad / Walk & Talk | Notes/proposals | No priority write | No | No | No | PROTECTED observational; not priority |
| Map everyday cells | Coverage state; optional SI marker; seasonal badge | No | No | Hidden unless Advanced | Badge + Walk detail | OPERATIONAL geography; **DISCOVERY POOR** for durable High |
| Map Advanced · Service cadence | Heat from walk age + tier | No | No | Yes | Unrelated | ADMIN-ONLY / advanced; **not** High-priority editor |
| Map Walk sheet | Attention + seasonal + walk intensities | Pin-to-week **gated off** (`canMutate=false`) | No | Walk log (mutates service model) | Yes | OPERATIONAL walk; pin is LEGACY/gated |
| Roster | No | No | No | No | No | Unrelated |
| More → Department Setup → AisleBayManager | LOCK chip; HIGH/CRITICAL/STANDARD tier chip | Aisle Mark; Edit Bay (Master-effective for hotspot/decay) | Aisle Clear; Edit Bay | Indirect chips | No | **ADMIN topology** hosting **OPERATIONAL priority** — **DISCOVERY POOR** |
| Edit Bay | All four switches | Yes (API: Master for tier/decay/topology; DS isolated override only if request omits map fields) | Same | Decay slider | No | **LEGACY cockpit inside topology** |
| Bulk Generator | Velocity seed radios | Seeds new geography | n/a | Preset copy | No | ADMIN-ONLY topology create |
| More → Rotation Setup Seasonal Context | Master declare / aisle seasonal assign | Seasonal HIGH/MED/LOW/NONE | By date / relevance | No | Yes | PROTECTED cadence input; **ADMIN-ONLY** (Master) |
| Sunday modal | Carry-Over Priority badge | No durable High | No | No | No | OPERATIONAL week recovery |

---

## 19. Current discovery problems

1. **Wrong job on the wrong surface.** Cadence judgment is buried in topology CRUD.
2. **Four Edit Bay controls look like one “priority” panel.** Only Lock/aisle High is the durable pin. Hotspot is velocity class. Decay is numeric overdue. Workflow is checklist routing.
3. **Aisle High and Lock are the same flag with different words.** Aisle says “high priority”; bay says “Lock Priority Override”; list chip says “LOCK.”
4. **DS vs Master split.** DS can Mark aisle High. DS generally cannot Save Edit Bay (hotspot/decay/aisle/bay/workflow are `mapEdit`). The buried bay editor is not even a working DS tool.
5. **Map already shows geography and seasonal badges but not durable High.** The spatial operational surface cannot express standing cadence intent.
6. **Floor cannot record the judgment formed while working the week.** That is the reported field problem. Adding a full editor there would still be the wrong owner.
7. **Call-out silently uses the same pin** as “this aisle is always high priority.”
8. **Advanced Service cadence looks like the same story as Hotspot** because it paints `velocity_tier` hotspot tone.

---

## 20. Map priority-mutation feasibility

**Yes, with a narrow capability — not `canMutate=true`.**

1. **Reuse existing APIs?**  
   - Aisle: **yes**, `POST /api/store-locations/aisle-priority`.  
   - Physical bay: **yes in principle** — `PATCH /api/store-locations` already allows Supervisor `priority_override` when **no topology/velocity/decay/workflow fields** are sent. Prefer a small physical-bay helper that updates both sibling ids in one `IN` list (mirror aisle-priority) so faces cannot split mid-save.

2. **Would enabling only priority mutation violate Map `canMutate=false` topology boundary?**  
   Not if Map keeps `canMutate=false` for topology. Priority is rotation configuration of existing geography, not creating/renumbering/deleting surfaces.

3. **Can priority mutation be separated from topology mutation?**  
   **Yes. That seam already exists in the PATCH handler** (`mapEdit` vs `priority_override`). Aisle-priority never touches aisle/bay/type.

4. **Role gates?**  
   Preserve Supervisor+ for aisle-priority. Do not grant DS `mapEdit`. Master Seasonal Context stays Master.

5. **Sibling updates atomic/truthful?**  
   Aisle path already is. Per-bay Edit today is sequential per UUID. A Map High/Standard control should write both active faces together. Do not repair historical splits in this investigation; production has none.

6. **New authoritative data?**  
   **No.** Map list already returns `priority_override`, `velocity_tier`, `custom_decay_days`.

7. **Duplicate workflows?**  
   Temporarily: Map operational High + More residual Lock/aisle until More is cleaned. That is acceptable for one tranche if Map becomes canonical for everyday set/clear.

8. **Could More then drop Edit Bay priority controls?**  
   Later, yes, for Lock/Hotspot/Decay **if** Map owns High/Standard and Bulk retains seed-on-create. Workflow stays in More. Do not delete columns.

---

## 21. Exact architectural seam (Map topology stays non-mutating)

Do **not** pass `canMutate={true}` into `StoreLocationGrid` / `WalkTheFloorSheet`.

That flag currently enables:

- Sell/Top surface on/off (topology)
- Pin-to-week (`manual_priority_count` + this-week assign)

Required seam:

```text
canMutateTopology      // today's canMutate — stays false on Map
canMutateRotationPriority  // NEW — Map only
  allows:
    aisle Standard ↔ High   → setAislePriorityOverride
    physical bay Standard ↔ High → priority_override on both eligible siblings
  forbids:
    add/delete/renumber/move bays
    Sell/Top create/toggle
    Pin-to-week
    velocity_tier / custom_decay_days / workflow_type
    seasonal relevance writes (Master / Rotation Setup)
```

Implementation sketch (not built):

- New boolean on Map grid / aisle header / bay sheet, gated like aisle-priority (Supervisor+ / `canManageMapConsole`).
- Reuse aisle-priority route as-is.
- Add or reuse a physical-bay override writer that **only** sets `priority_override` + `updated_at`.
- Presentation: High chip on the coverage cell, distinct from seasonal badge and SI marker.
- Contract tests: Map still contains `canMutate={false}`; new tests assert topology writers are unreachable from Map.

This is compatible with UX-REDUCE-003 Map Coverage Geography Law: Map remains coverage geography, and may **annotate** how existing geography participates in cadence without becoming the topology console.

---

## 22. Floor priority-mutation feasibility

Floor = who has what **this week**.

A priority editor on Floor would:

- help the moment of judgment only if the bay is already on this week’s board
- fail for bays the DS notices while walking unassigned geography (that is Map)
- reintroduce cockpit actions onto a surface that just removed analytics/Stage chrome

**Recommendation:** no Floor mutation. Optional later read-only High marker on owned bays is a presentation question, not required for PRIORITY-UX-002. Do not duplicate Map’s editor “for convenience.”

---

## 23. More / Edit Bay future disposition

After Map owns everyday High/Standard:

| Control | Stay in More? |
|---------|----------------|
| Add/Edit/Delete aisle & bay, Bulk Generator, duplicate prune | **Yes** — topology |
| Bay workflow | **Yes** — topology/checklist |
| Bulk velocity seed on **create** | **Yes** as setup default (vocabulary later) |
| Mark aisle high / Clear / Lock / Hotspot / Decay in Edit Bay | **Move everyday use to Map**; More may keep an advanced residual briefly, then remove duplicate Lock once Map is field-accepted |
| Seasonal Context | **Yes** — Rotation Setup, Master, protected |
| Floor Pad | Unchanged, protected |

Do not turn Department Setup into the operational cadence console.

---

## 24. Vocabulary audit

| Term | Verdict | Notes |
|------|---------|--------|
| High-Velocity Hotspot | **Misleading** | Sounds like measured velocity or “work more often.” Writes IRP `velocity_tier`. |
| Lock Priority Override | **Misleading** | Locks nothing; overrides nothing intelligent; is a sticky pin. |
| Custom decay threshold | **Technically accurate but poor UX** | “Decay” is IRP heatmap language. Behavior is overdue cadence pressure, not guaranteed return. |
| Standard | **Accurate** as default class | Overloaded across velocity_tier, workflow, coverage. |
| High priority (aisle UI) | **Accurate** for `priority_override` | Best existing DS phrase. |
| priority | **Ambiguous** | Many columns. |
| cadence | **Ambiguous** | Used for walk heatmap, decay days, seasonal, and rotation frequency. |
| service cadence | **Accurate** for Map advanced walk view | Keep distinct. |
| coverage age | **Accurate** | `last_completed_at`. |
| attention | **Accurate** as SI/Map derived signal | Must not be used as the High control. |
| Priority Lock (bulk) | **Technically accurate but poor UX** | Sets override+high+5d. “Always eligible for weekly Sunday draw” is closer to carry-bucket truth — and to the starvation hazard. |
| Carry-Over Priority | **Technically accurate but poor UX** | True carry-over, not standing High; 14-day badge also keys `last_carried_over_at`. |

Recommended DS-facing language (UI only; do not rename columns in this program):

| Intent | Say | Do not say |
|--------|-----|------------|
| Standing increase in coverage frequency | **High priority** / **Standard** | Hotspot, lock, override, velocity |
| Aisle convenience | **Mark aisle high priority** / **Clear aisle high priority** | Lock |
| Seasonal | **Seasonal high while {context} is active** | High-velocity |
| Walk frequency paint | **Service cadence** (advanced) | Priority |
| Incomplete last week | **Carried over** | Priority |
| SI | **Needs attention** (derived) | Priority |

---

## 25. Production read-only observations

Authorized SELECT-only against live Supabase (service role). No INSERT/UPDATE/DELETE/DDL/RPC mutation.

Store `store_locations` snapshot 2026-09-18:

| Fact | Count |
|------|-------|
| Rows | 584 |
| Active / aisle-eligible | 584 |
| Physical bays | 292 (every bay has both SELLING and TOPSTOCK) |
| `priority_override=true` | **0** |
| `velocity_tier` | **584 standard** |
| `custom_decay_days` | **584 = 14** (none null, none other values) |
| `manual_priority_count>0` | **0** |
| `carried_over=true` | **0** |
| COMPLETED+override | **0** |
| Sibling disagreements (override / tier / decay) | **0** |
| `workflow_type` | 584 `STANDARD_MERCH` |
| `operational_contexts` | 0 |
| location/department relevance | 0 |

Implications:

- Everyday High has never been used in production yet — discovery failure, not “the store has no hot aisles.”
- Null-decay defaults are unused; 14 is materialized everywhere (Bulk Standard seed).
- No normalization pass is required before a Map High control.
- Seasonal engine is empty-seed valid.

---

## 26. Legacy / dead concepts discovered

| Item | Status |
|------|--------|
| Map Pin-to-week | Live API; **unmounted** on Map (`canMutate=false`). Increments `manual_priority_count`. |
| `manual_priority_count` as a DS concept | Live weight; no UI; extra-bay +1 still bumps it. |
| Edit Bay Hotspot/Lock/Decay as DS tools | Mounted for DS; **Save of map fields is Master-only**. |
| Bulk “Priority Lock (always eligible…)” | Live create-time seed; copies the starvation semantics into new geography. |
| `critical_hotspot` as a user-settable state | Not settable in Edit Bay except by preserving it; walk-log promote only. |
| REC-001 | Unwired. |
| CHAT_HANDOFF “★ Week assigns + bumps priority” | Historical Map mutate path; UX-REDUCE-003 disabled it. |
| Velocity Heatmap everyday chrome | Demoted; data live. |

---

## 27. Product contradictions discovered

1. **Sticky override re-admits COMPLETED bays** while seasonal HIGH and hotspot do not. Contradicts “priority must not revoke universal coverage.”
2. **Call-out carry writes the standing High flag** and assign does not clear it. Incomplete-work debt becomes durable priority.
3. **Aisle “High priority” ≡ bay “Lock Priority Override” ≡ bulk “Priority Lock”** with three vocabularies.
4. **Hotspot is sold as faster cadence** but production decay is 14 for all rows and the toggle does not set 5.
5. **DS can aisle-pin, Master-only can bay-hotspot**, both live in the same More accordion.
6. **Map is the spatial operational surface but cannot record cadence intent**; More is setup and currently owns that intent.
7. **`isRotationVelocityPriority` treats override as velocity**, while `isCarryOverDrawLocation` treats it as carry — two metaphors, one bit.
8. Extra-bay “add another owed bay” **also permanently weights** `manual_priority_count`.

Do not “fix” 1–2 inside a placement-only tranche without an explicit engine mandate.

---

## 28. Recommended canonical priority model

**Topology** (`store_locations` geography, types, workflow, active): what exists.

**Durable operational priority** (everyday DS/Master):

- Values: **Standard** | **High priority**
- Storage: existing `priority_override` at physical-bay scope (both faces)
- Aisle action: fan-out of the same flag (already built)
- Selector: keep current carry-bucket behavior **until a dedicated engine tranche** decides COMPLETED cool-down
- Must not be written by seasonal, SI, or Gemini

**Ephemeral seasonal pressure:** existing HIGH location relevance. Master. Date-bounded.

**Service cadence (advanced):** `last_serviced_at` + `velocity_tier` + optional `custom_decay_days`. Not the everyday High control.

**True carry-over:** incomplete week work. Separate.

**Attention:** derived observation. Separate.

This matches the provisional law:

> Topology defines what exists. Map defines how existing geography participates in coverage.

Engine already almost supports it. The gap is UI ownership + vocabulary + the COMPLETED-pin law.

---

## 29. Recommended DS-facing vocabulary

- **High priority** / **Standard**
- **Mark aisle high priority** / **Clear aisle high priority** (keep disclose-on-clear)
- **Seasonal high** (with context title and dates)
- **Carried over** (not Priority)
- **Service cadence** (advanced)
- **Needs attention** (derived only)

Retire from DS chrome: High-Velocity Hotspot, Lock Priority Override, Custom decay threshold, Priority Lock, Carry-Over Priority (rename).

---

## 30. Recommended future interaction design

**Map (operational):**

- Aisle header: High priority / Clear (Supervisor+)
- Physical bay: Standard | High priority
- Distinct from seasonal badge and attention marker
- Topology still More-only

**Floor:** no editor. Optional later High read-only if a pinned bay is on this week.

**More:** topology + workflow + create-time defaults + Master Seasonal Context.

**Do not** expose hotspot/decay/workflow on Map.

---

## 31. Recommended implementation tranche(s)

| ID | Scope | Notes |
|----|--------|-------|
| **PRIORITY-UX-002** | Map High/Standard + aisle High using existing override APIs; new `canMutateRotationPriority`; DS vocabulary; contract tests that Map topology stays frozen | No schema. No selector change. Do not start UX-REDUCE-006. |
| PRIORITY-UX-003 (later) | Remove duplicate Lock/aisle controls from Edit Bay after Samsung accepts Map; leave workflow + topology | Placement cleanup only |
| PRIORITY-ENGINE-00x (later, separate mandate) | COMPLETED+override cool-down; stop call-out from writing standing High; optional provenance | Product law repair — not a UI move |
| Optional cadence tranche | Whether numeric return window belongs in advanced setup | After everyday High exists |

UX-005D (Map operate vs investigate) remains open and **must not be preempted**; PRIORITY-UX-002 should add a cadence **capability**, not a general operate mode.

---

## 32. Migration / data normalization

**Not required** to implement PRIORITY-UX-002.

Reuse `priority_override` + aisle-priority route + sibling-aware PATCH.

Optional later (not this report’s implementation):

- Provenance column if aisle CLEAR vs individual pin must be distinguished without Approach A
- Repair call-out writer
- Cool-down rule for COMPLETED+override
- Production currently has nothing to backfill

Do not delete `velocity_tier`, `custom_decay_days`, or `manual_priority_count`.

---

## 33. Tests / validation

This archaeology added **no** permanent tests (temporary selector probes were run, then deleted).

Existing coverage relied on:

- `lib/store-ops/engine-prod-004.seasonal-priority.test.ts`
- `lib/store-ops/bay-unit-002.physical-bay.test.ts`
- `lib/store-ops/engine-prod-003.extra-bay-dispatch.test.ts`
- `lib/store-ops/location-attention-pressure.test.ts` (no override consumption)
- `lib/store-ops/ux-reduce-003.map-coverage.contract.test.ts` (`canMutate={false}`)
- `lib/ux-reduce-005.more-setup.contract.test.ts`

Local diagnostic results (HEAD selector, not production simulation):

| Case | Result |
|------|--------|
| A lock vs ordinary | Lock selected (carry bucket) |
| A hotspot vs **fresh** ordinary | Hotspot selected (hot vs rest) |
| A hotspot vs **overdue** ordinary | Overdue ordinary **can** win (shared hot pool) |
| B seasonal vs ordinary | Seasonal selected |
| C manual High + seasonal | Manual High selected first |
| D recent hotspot vs long-owed ordinary | Long-owed **can** win |
| D COMPLETED lock vs ordinary | **Lock re-admitted** |
| D COMPLETED hotspot vs ordinary | Ordinary (hotspot cooled) |
| E aisle of 3 High, draw 3 | All aisle High |
| F split siblings | OR/worst/min; physical bay selected as High |

`npm test` / typecheck / build were **not** run for a repository artifact commit (none besides this docs set). No production mutation.

---

## 34. Git / docs status

- Report: `docs/product/PRIORITY_UX_001_OPERATIONAL_PRIORITY_ARCHAEOLOGY.md` (this file)
- Living docs updated: `CHAT_HANDOFF.md`, `DEVELOPMENT_JOURNAL.md`, `MASTER_ROADMAP.md`, `DEPT_SYNC_STATE.md`, `ARCHITECTURE.md`
- Runtime/code/schema/tests: **unchanged**
- Commit: not created (docs-only archaeology; commit only if requested)

---

## 35. Final assessment

The reduced product already has the right **idea** — topology vs cadence pressure vs seasonal vs attention vs service velocity — but the **everyday DS control** for “this existing bay/aisle should be worked more often” is:

- stored as `priority_override`
- labelled as Lock / Hotspot / High depending on the screen
- buried in More topology
- partly Master-gated
- strong enough to starve ordinary coverage if used as intended
- unused in production (0 pins)

**Map can own that declaration while remaining non-mutating for topology**, through a new rotation-priority capability and existing override APIs.

**Floor should not.**

**High-Velocity Hotspot is not that declaration.** It is durable **service-velocity class** under an old name.

Stop after this report. Do not implement PRIORITY-UX-002 here. Do not start UX-REDUCE-006.

---

## Direct answers

**A. What does High-Velocity Hotspot actually do today?**  
It persists `store_locations.velocity_tier` as `high` (or keeps `critical_hotspot`). That joins the Sunday velocity/cadence hot pool and boosts draw weight. It does not pin the carry bucket, does not change quota, and does not retune a pre-existing 14-day `custom_decay_days`. Walk logs may later promote the same column. DS Save is blocked by the map-field role gate.

**B. Is it really “velocity,” or durable manual rotation priority?**  
**Service-velocity / IRP class under historical vocabulary**, plus a human override of that class. It is **not** the durable rotation-priority pin. That pin is `priority_override`.

**C. What exactly does Lock Priority Override lock?**  
**Nothing.** It sets `priority_override=true`, a sticky Sunday carry-bucket pin. It does not lock velocity, seasonal, SI, or aisle clear.

**D. Is Lock still necessary in the reduced product?**  
The **flag** is necessary as durable High. The **Lock Override** control/name is not. Call-out sharing that flag is harmful.

**E. What exactly does Custom decay threshold do?**  
Stores 3–21 day overdue threshold (null → 14/5 by tier). Overdue bays join the hot pool and get higher weight. No selection guarantee. No visit obligation.

**F. Is custom decay still necessary?**  
Not as everyday DS UX. High/Standard can express “work more often.” Keep the column as advanced/setup residue. In production every row is already 14.

**G. Does aisle high priority affect all physical bays truthfully?**  
All **current** active non-SHOWROOM surfaces in that department aisle, both faces. Not future bays. Not SHOWROOM. Not other departments.

**H. Can SELLING/TOPSTOCK siblings disagree on priority?**  
**Yes, legally.** Composer ORs High. Edit Bay/aisle writers try to keep faces aligned. Production currently has **no** disagreements.

**I. How does manual priority interact with Seasonal HIGH?**  
Tiered: sticky override/carry **before** seasonal HIGH **before** velocity/cadence **before** aging. Both can be true; seasonal never writes the pin. Seasonal expires cleanly.

**J. Can high-priority bays starve ordinary coverage?**  
**Yes if they use `priority_override`**, because COMPLETED pins remain owed and fill the carry bucket. Seasonal/hotspot starve only while still PENDING; completion + cycle reset restores ordinary coverage.

**K. Does priority survive completion and cycle reset?**  
`priority_override`, `velocity_tier`, `custom_decay_days`, `manual_priority_count`: **yes**. True `carried_over`: cleared on assign/complete. Seasonal: date-bounded, not cycle-bounded. Override also **re-selects after completion**.

**L. Does Current Attention affect authoritative selection?**  
**No.**

**M. Is service cadence/velocity the same model as manual priority?**  
**No.** Walk age + `velocity_tier` vs sticky `priority_override` carry pin.

**N. Is More → Edit Bay the wrong operational location?**  
**Yes** for standing cadence intent. Correct for topology, workflow, and create-time defaults.

**O. Can Map safely own manual priority mutation while remaining non-mutating for topology?**  
**Yes**, via `canMutateRotationPriority` ≠ `canMutate`. Do not set `canMutate=true`.

**P. Should Floor expose any priority mutation?**  
**No.** Ownership surface, not geography cadence editor.

**Q. What should the DS-facing vocabulary become?**  
**Standard / High priority** (aisle: mark/clear high priority). Keep Seasonal high, Carried over, Service cadence, Needs attention as separate words.

**R. What should remain in More → Department Setup after priority controls move?**  
Aisle/bay topology CRUD, Bulk create, workflow, duplicate prune. Seasonal stays Rotation Setup (Master). Advanced velocity seed on create may remain.

**S. Does implementation require schema/data normalization?**  
**No** for PRIORITY-UX-002. Reuse `priority_override`. Production has zero pins and zero sibling splits. Engine cool-down/call-out repair is a later mandate, not a migration.

**T. What is the smallest safe PRIORITY-UX-002 implementation?**  
Map-only Supervisor+ High/Standard on aisle + physical bay; reuse aisle-priority API + override-only sibling writer; new capability flag; High chip distinct from seasonal/attention; contract-test Map topology `canMutate=false`; no selector change; no hotspot/decay/workflow move; no Floor editor; no schema; do not start UX-REDUCE-006.

---

*End of PRIORITY-UX-001.*
