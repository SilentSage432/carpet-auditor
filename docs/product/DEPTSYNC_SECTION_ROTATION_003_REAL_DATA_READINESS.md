# DEPTSYNC-SECTION-ROTATION-003 — Real-Data Rotation Readiness Verification

**Status:** COMPLETE (read-only production discovery + local evaluation)  
**Date:** 2026-10-11  
**Mode:** READ-ONLY production inventory + isolated local dry-run  
**Store:** 2587  
**Supabase:** `fmeinlwhixngednabhgy`  
**Application:** https://deptsync-hub.vercel.app (unchanged)  
**References:**  
[`DEPTSYNC_SECTION_ROTATION_001_DISCOVERY.md`](DEPTSYNC_SECTION_ROTATION_001_DISCOVERY.md) ·  
[`DEPTSYNC_SECTION_ROTATION_002_IMPLEMENTATION.md`](DEPTSYNC_SECTION_ROTATION_002_IMPLEMENTATION.md) ·  
[`DEPTSYNC_CAPACITY_GUARD_003_RELEASE.md`](DEPTSYNC_CAPACITY_GUARD_003_RELEASE.md) ·  
[`DEPTSYNC_TOPOLOGY_REGISTRY_004_RELEASE.md`](DEPTSYNC_TOPOLOGY_REGISTRY_004_RELEASE.md)

**Strict exclusions honored:** No production mutations; no schedule/assignment/section/topology/schema changes; no capacity RPC changes; no Sunday dispatch; no feature-flag flips; no automatic staging activation; no production deployment.

---

## 1. Executive summary

Production Operational Sections for store 2587 are **populated and steward-aligned** with the operator’s aisle map (Nate 39/40/7; Tyson 5/6; Nick 43/44; Tracy 41/42). Membership covers all **160** active flooring physical bays with **zero overlaps**, **zero unsectioned active bays**, and **zero retired-bay memberships**. Named showroom / carpet-wall registry aisles exist with **0 bay rows** and are correctly outside weekly bay rotation.

The **blocking readiness failure** is schedule data for the target week: **2026-W42** (`week_starting` Monday **2026-10-12**, Denver Sunday staging) has **0** `associate_shift_days` rows. Under existing eligibility rules that yields **0 eligible operational associates** and **shared capacity 0**. No accurate weekly proposal can be produced for the real target week until schedules exist.

Diagnostic dry-runs (hypothetical eligibility + existing Hybrid selector) confirm stewardship is a **soft preference**, not exclusive ownership. When stage candidates are drawn coverage-first (current Sunday path) or via section-preference stage helper (not wired to Sunday), the first drawn aisle absorbs the shared draw, so only the steward of that aisle receives `steward_match` rows; others receive `section_coverage` on that same aisle. Capacity caps (3×eligible), uniqueness, and MasterAdmin exclusion behave correctly in local composition.

| Gate | Result |
|------|--------|
| Production read access | **PASS** (Management API ephemeral DB password + psql; no mutations) |
| Section membership vs operator aisle map | **PASS** (confirmed records) |
| Named zones excluded from bay rotation (0 bay rows) | **PASS** |
| Target-week schedule eligibility (W42) | **FAIL — DATA GAP** |
| Section-aware auto-stage | **HARD OFF** (`SECTION_AWARE_ROTATION_AUTO_STAGE = false`) |
| Production preview flag | **OFF** (unset) |
| Capacity RPC compatibility (composition) | **PASS** (unchanged; not executed for writes) |
| Typecheck / suite / build | **PASS** (`tsc`; **1658** tests; `next build`) |
| Full-repo lint | **FAIL (pre-existing)** — 116 errors outside this tranche; rotation files lint clean |

**Verdict: NO-GO** for activating section-aware Sunday staging or Production preview.  
**Section membership readiness: GO** (data complete for aisles).  
**Weekly proposal readiness for 2026-W42: NO-GO** until schedules are entered.  
**Algorithm fairness for multi-aisle stewardship under current stage+assign composition: CONDITIONAL** — soft preference works, but stage-order concentration prevents balanced steward matches across sections when all candidates share one priority tier.

---

## 2. Actual production section inventory

**Confirmed production records (A):**

| Section | Active | Steward | Member bays | Distinct aisles |
|---------|--------|---------|-------------|-----------------|
| CSA | yes | Nate | 60 | 7 (18), 39 (21), 40 (21) |
| Myself | yes | Tyson | 34 | 5 (16), 6 (18) |
| Specialist-A | yes | Nick | 35 | 43 (14), 44 (21) |
| Specialist-B | yes | Tracy | 31 | 41 (17), 42 (14) |

Also present: inactive section **Section A** (steward Nick) — not counted in active inventory.

**Flooring department:** active (`flooring`). Other specialty departments inactive.

**Active associates (operational):** Nate, Nick, Tracy, Tyson.  
**Administrative (excluded from rotation):** Master Admin / MasterAdmin.

---

## 3. Associate stewardship mapping

| Associate | Role | Section | Rotation aisles (prod) | Operator-described extras |
|-----------|------|---------|------------------------|---------------------------|
| Nate | Associate | CSA | 39, 40, 7 | — (three aisles intentional) |
| Nick | Associate | Specialist-A | 43, 44 | Left showroom + shared carpet wall |
| Tracy | Associate | Specialist-B | 41, 42 | Right showroom + shared carpet wall |
| Tyson | Supervisor | Myself | 5, 6 | Clothing showroom |

**A = confirmed:** aisle memberships above.  
**B = operator context:** showroom / carpet-wall / clothing responsibilities.  
**C = incomplete relative to B:** registry has `SHOW-L`, `SHOW-R`, `CARPET-WALL` with **0 bay rows** (intentional empty shells; not weekly bay-rotation candidates). No separate clothing-showroom aisle/bay inventory was found in active physical bays.

Aisle count is **not** weekly assignment capacity. Nate’s three aisles do not imply a higher weekly quota.

---

## 4. Eligible bay inventory

| Metric | Value |
|--------|------:|
| Active physical flooring bays | 160 |
| Active section memberships | 160 |
| Membership overlaps | 0 |
| Unsectioned active physical bays | 0 |
| Memberships on retired/missing surfaces | 0 |
| Active flooring aisles with bays | 9 (5,6,7,39–44) |
| Named registry aisles with 0 bay rows | 3 (`SHOW-L`, `SHOW-R`, `CARPET-WALL`) |

Snapshot bay attributes used for tiering: `carried_over`, `priority_override`, `velocity_tier`, `location_type`. In the sanitized snapshot used for dry-run, all 160 candidates classified as **aging** (no carry / high / velocity flags in the exported physical rows). W41 staged rotations were `location_type=STANDARD`, `velocity_tier=standard`, not carried.

Eligible surfaces in inventory SQL (two faces per bay) remain documentation of topology density; weekly assignment still keys physical bay identity.

**Showroom / carpet wall:** not excluded by inventing alphanumeric bans. Existing rules already omit zero-bay registry shells from bay staging. No new exclusion rules introduced.

---

## 5. Schedule eligibility

Eligibility follows existing store-ops rules: operational associates with `associate_shift_days` **ON_DUTY** and usable start/end times in the target ISO week; **MasterAdmin excluded**; section stewardship does **not** grant eligibility.

| Week | Shift rows | Eligible (ON_DUTY + times) | Notes |
|------|------------|----------------------------|-------|
| **2026-W42** (target) | **0** | **none** | No future shift rows beyond W41 either |
| 2026-W41 (prior) | Tracy 6 / Tyson 6 | Tracy (4 days), Tyson (3 days) | Nate, Nick had no W41 qualifying shifts |

**W42 actual:**

- Eligible: _(empty)_  
- Ineligible: Nate, Nick, Tracy, Tyson — **no schedule rows**  
- MasterAdmin: not a rotation participant  

---

## 6. Exact target rotation week

Store timezone: **America/Denver**.  
`sunday_auto_generate = true`, `sunday_auto_stage_time = 23:59:00`.

Canonical boundary (`sundayStagingWeekLabel`): on a **Sunday** local day, stage the **upcoming Monday’s** ISO week.

Evaluation instant: **Sunday 2026-10-11** (Denver) → target week **`2026-W42`**, week starting **2026-10-12**.

---

## 7. Shared capacity calculation

Formula (unchanged): `shared_target = 3 × eligible_operational_associates`.

| Scenario | Eligible | Shared target |
|----------|----------|---------------|
| Actual W42 | 0 | **0** |
| W41 labor pattern (diagnostic) | 2 (Tracy, Tyson) | **6** |
| All four scheduled (diagnostic) | 4 | **12** (maximum when all qualify) |

Capacity is store-week shared across the operational workspace. Per-person cap remains 3. Nate’s three aisles do not increase his weekly cap.

---

## 8. Read-only dry-run methodology

1. Read-only production SQL via established Management API ephemeral DB password + local psql 17 (password wiped after inventory; never committed).  
2. Sanitized snapshot written to ephemeral `/tmp/sr003-snapshot/prod-sanitized.json` (associates, sections, memberships, active physical bays, schedule summary counts — **no PINs / hashes**).  
3. Isolated local harness: `scripts/section-rotation-003-dry-run.mts`  
   - Composes `composeSectionAwareWeeklyPreview` / `selectBaysWithSectionPreference` from `lib/store-ops/section-aware-rotation.ts`.  
   - **Does not** call assignment RPCs, Sunday dispatch, or any writer.  
   - Stage modes: `coverage_first` (numeric aisle/bay order approximating current Sunday coverage stage) vs `section_preference` (ROTATION-002 helper, **not** wired into Sunday auto-stage).  
4. Scenarios: actual W42 (empty eligible); W41-pattern diagnostic; all-four diagnostic under both stage modes.

Production feature flags remain off. No preview records persisted.

---

## 9. Proposed assignments by associate

### A) ACTUAL_W42_NO_SCHEDULES (authoritative for activation)

| Result | Value |
|--------|------:|
| Eligible | 0 |
| Shared target | 0 |
| Proposed | **0** |

No weekly proposal can be issued for the real target week.

### B) DIAGNOSTIC_W41_PATTERN_COVERAGE_STAGE (Tracy + Tyson, draw 6, coverage-first)

| Associate | Total | Steward match | Outside section | Aisles |
|-----------|------:|--------------:|----------------:|--------|
| Tracy | 3 | 0 | 3 (`section_coverage`) | 5×3 |
| Tyson | 3 | 3 | 0 | 5×3 |

### C) DIAGNOSTIC_ALL_FOUR_COVERAGE_STAGE (draw 12, coverage-first)

| Associate | Total | Steward match | Outside | Aisles |
|-----------|------:|--------------:|--------:|--------|
| Nate | 3 | 0 | 3 | 5×3 |
| Nick | 3 | 0 | 3 | 5×3 |
| Tracy | 3 | 0 | 3 | 5×3 |
| Tyson | 3 | 3 | 0 | 5×3 |

### D) DIAGNOSTIC_ALL_FOUR_SECTION_STAGE (draw 12, section-preference stage helper)

| Associate | Total | Steward match | Outside | Aisles |
|-----------|------:|--------------:|--------:|--------|
| Nate | 3 | 3 | 0 | 39×3 |
| Nick | 3 | 0 | 3 | 39×3 |
| Tracy | 3 | 0 | 3 | 39×3 |
| Tyson | 3 | 0 | 3 | 39×3 |

**W41 production contrast (section-aware OFF):** 6 owned assignments for Tracy/Tyson on aisles 5,7,42,43,44 — not steward-aligned. Confirms live Sunday path is still coverage-first, not Hybrid section preference.

---

## 10. Section preference results

Stewardship is a **preference**, not an exclusive rule (`planSectionAwareFlatAssignments`: steward boost among associates with remaining capacity; same-aisle secondary; specialist_id tie-break).

| Question | Finding |
|----------|---------|
| Enough eligible section bays per steward? | **Yes** — each steward has ≥31 active member bays; quota is only 3 |
| Why outside-section selections? | Stage draw concentrated all candidates into **one aisle** (5 under coverage-first; 39 under section-preference stage). Non-stewards of that aisle still receive those bays as `section_coverage` because capacity remains and preference cannot invent other staged bays |
| Priority override of stewardship? | Snapshot had a single **aging** tier — no carry/high/velocity leapfrog observed in dry-run |
| Nate’s three aisles treated as higher quota? | **No** — still capped at 3 when eligible |
| Two-aisle sections | Same soft preference; fairness limited by stage concentration, not aisle count |

---

## 11. Priority-tier behavior

Authoritative order preserved in selector: carry → seasonal → high → velocity → aging.  
Dry-run candidates were aging-only; tier leapfrog could not be exercised against live W42 flags. Unit contracts from ROTATION-002 remain the authority for multi-tier behavior (**1600+ suite still green**).

---

## 12. Duplicate prevention

Dry-run stage helpers de-duplicate physical keys before assign. Preview skips already-owned rotation ids. Production capacity RPC uniqueness / store-week lock unchanged and not invoked. No duplicate bay keys appeared in diagnostic proposal rows.

---

## 13. Data gaps

| Gap | Class | Severity |
|-----|-------|----------|
| **Zero W42 (and future) associate schedules** | **DATA GAP** | **Blocking** — capacity 0; no real proposal |
| Clothing showroom not represented as bay membership | DATA / topology context | Non-blocking for aisle rotation; confirm whether it should remain registry-only / non-rotating |
| Showroom L/R + carpet wall = 0 bay rows | Expected (B vs A) | Non-blocking; correctly out of bay rotation |
| W41 only Tracy+Tyson scheduled | Historical pattern | Risk if W42 repeats partial schedules — capacity becomes 6, not 12 |
| Inactive “Section A” remnant | Hygiene | Non-blocking |

Section membership for the nine numeric aisles is **not** a gap.

---

## 14. Algorithm gaps

| Finding | Class | Confirmed defect? |
|---------|-------|-------------------|
| Soft steward preference cannot redistribute when stage set is single-aisle | **ALGORITHM / INTEGRATION** | **Confirmed behavior** under Hybrid design — preference among remaining caps, not exclusive section fill |
| `selectBaysWithSectionPreference` stage helper not wired into Sunday auto-stage; Sunday still `selectPhysicalBayCoverage` | **INTEGRATION GAP** | Confirmed by ROTATION-002 contracts + code |
| Section-preference stage with string aisle ordering can bias early aisles (e.g. `"39"` before `"5"`) | ALGORITHM bias if that helper is activated for staging | Confirmed in diagnostic D; **not live** while auto-stage hard-off |
| Coverage-first stage + flat assign → steward of first aisle gets matches; others work that aisle | Expected under current Hybrid | Confirmed in B/C — may **not** match operator fairness expectations for multi-section weekly proposals |

No exclusive-assignment rewrite was performed (per mission).

---

## 15. UX / integration gaps

| Gap | Class |
|-----|-------|
| Operator cannot see a PROPOSED section-aware plan in Production (preview env unset; auto-stage hard-off) | **UX GAP** (intentional gate) |
| Correct Hybrid preview still confirms through existing capacity RPC path only when opt-in UI enabled | Integration intact; activation gated |
| Diagnostic harness is local-only (`scripts/section-rotation-003-dry-run.mts`); not an operator surface | UX / ops tooling |

---

## 16. Security findings

| Check | Result |
|-------|--------|
| Production mutations | None |
| PIN / credential retrieval | None |
| Ephemeral DB password | Used for read-only inventory; wiped from `/tmp` after use |
| MasterAdmin excluded from rotation capacity | Preserved |
| Capacity RPC | Untouched |
| Feature flags | Untouched |

No new security defects found in this tranche. Activation of preview/auto-stage remains gated.

---

## 17. Test / build results

| Check | Result |
|-------|--------|
| `npm run typecheck` | **PASS** |
| Relevant eslint (`section-aware-rotation*`, dry-run harness) | **PASS** (0 issues) |
| `npm run lint` (full repo) | **FAIL** — 116 errors / 38 warnings, predominantly pre-existing under `tmp/` and unrelated surfaces |
| `npm test` | **PASS — 1658 / 1658** (133 files) |
| `npm run build` | **PASS** |

No production deploy of diagnostic harness or docs.

---

## 18. Recommended next implementation

1. **Operator data:** Enter W42 (and ongoing) schedules for Nate, Nick, Tracy, Tyson as applicable — without this, capacity remains 0.  
2. **Re-run ROTATION-003-style dry-run** after schedules exist (still read-only).  
3. **Product decision before activation:** Whether weekly proposals should **fill steward sections first** (stronger than soft preference) or keep Hybrid soft preference + coverage stage. Current behavior will **not** produce balanced steward matches when the stage draw collapses to one aisle.  
4. If stronger section fill is approved: implement a dedicated tranche (stage composition and/or assign pass) — do **not** flip `SECTION_AWARE_ROTATION_AUTO_STAGE` or Production preview until that decision and phone review.  
5. Keep capacity RPC / shared 3×eligible / uniqueness unchanged.  
6. Confirm clothing showroom / showroom / carpet-wall remain intentional non-rotating responsibilities.

---

## 19. GO / CONDITIONAL GO / NO-GO

| Decision | Verdict |
|----------|---------|
| Section membership completeness (numeric aisles) | **GO** |
| Capacity-guard compatibility of existing Hybrid composer | **GO** (composition; RPC untouched) |
| Real-data weekly proposal for **2026-W42** | **NO-GO** (no schedules → capacity 0) |
| Activate section-aware Sunday auto-stage | **NO-GO** |
| Enable Production section-aware preview env | **NO-GO** |
| Overall activation readiness | **NO-GO** |

**Primary blocker:** missing W42 schedules (**DATA GAP**).  
**Secondary blocker before fair activation:** stage+soft-preference composition does not yet produce multi-section steward-balanced weekly draws (**ALGORITHM/INTEGRATION** — confirm product intent before coding).

**STOP.**
