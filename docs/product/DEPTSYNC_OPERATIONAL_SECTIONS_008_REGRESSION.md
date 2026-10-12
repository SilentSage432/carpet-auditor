# DEPTSYNC-OPERATIONAL-SECTIONS-008 — Production Regression Investigation

**Status:** DIAGNOSIS COMPLETE (read-only)  
**Date:** 2026-10-12  
**Mode:** READ-ONLY diagnostic — **no implementation, migrations, deploy, or production mutations**  
**Store:** 2587  
**Supabase:** `fmeinlwhixngednabhgy`  
**Production app:** https://deptsync-hub.vercel.app  

**Symptoms investigated**

1. More → Operational Sections briefly shows sections, then they disappear.  
2. Weekly aisle assignments appear incorrect vs stewardship map.

Treat as potentially related; evidence shows **two distinct causes**.

---

## 1. Production database truth

**CONFIRMED** via service-role SELECT on `fmeinlwhixngednabhgy` (no writes).

| Metric | Value |
|--------|------:|
| `operational_sections` rows (store) | **5** |
| Active sections | **4** |
| Inactive / retired | **1** (`Section A`) |
| `operational_section_members` | **160** |
| Store ID consistency | All sections + members → `2ce36733-8843-4554-ae67-1ace71900449` (store 2587) |
| Department of active sections | All → flooring `8d741e55-4dd8-40fc-ab24-89e63429e903` |

### Active stewardship (actual)

| Section | Active | Steward | Member bays | Aisles |
|---------|--------|---------|------------:|--------|
| Myself | yes | **Tyson** (`aebd0398-…`) | 34 | **5, 6** |
| CSA | yes | **Nate** (`4b48f9b1-…`) | 60 | **7, 39, 40** |
| Specialist-A | yes | **Nick** (`6f79f577-…`) | 35 | **43, 44** |
| Specialist-B | yes | **Tracy** (`2d65fa60-…`) | 31 | **41, 42** |

Inactive: **Section A** (Nick) — not in active inventory.

**Data preservation:** Expected 4 sections + 160 memberships **still present**. No orphaned memberships detected in the active inventory (aisles match prior ROTATION-003 inventory). Records were **not** deleted by Zebra handoff or capacity releases.

---

## 2. Expected versus actual stewardship

| Associate | Expected aisles | Actual section aisles | Match |
|-----------|-----------------|----------------------|-------|
| Tyson | 5, 6 | Myself → 5, 6 | **YES** |
| Nate | 39, 40, 7 | CSA → 7, 39, 40 | **YES** |
| Nick | 43, 44 | Specialist-A → 43, 44 | **YES** |
| Tracy | 41, 42 | Specialist-B → 41, 42 | **YES** |

**CONFIRMED:** Database stewardship configuration is intact and matches operator expectation. The UI disappearance is **not** because sections were wiped from production.

---

## 3. UI disappearance root cause

**CONFIRMED (code + production department ordering + query simulation).**

### Execution path

Surface: `SettingsSection` → Accordion `#operational-sections` → `OperationalSectionsPanel`.

```text
Panel mount
  → reload() always scheduled (useEffect)
  → departmentId =
        workingDepartmentId(specialist, departments)
        ?? departments[0]?.id
        ?? ""
  → fetch GET /api/operational-sections?department_id=…
  → setSections(response.sections)
```

Critical lines (`OperationalSectionsPanel.tsx`):

- `departmentId` fallback to `departments[0]?.id` when working pin is **Full Store / `all`** (`workingDepartmentId` returns `undefined`).
- `reload` uses `departmentId || undefined` — when `departmentId === ""`, the request has **no** `department_id` filter and returns **all** store active sections (4).
- Successful responses always `setSections(sec.sections ?? [])` — an empty success **clears** prior rows.
- Empty UI copy: **"No Operational Sections yet"** — does not say “filtered to a department with zero sections.”
- **No in-flight request race guard** (no abort / generation token).

### Why sections flash then vanish

**CONFIRMED mechanism:**

1. Accordion opens → `needTopologyGraph` true → `reloadDepts()` starts; panel may mount with `departments = []` → `departmentId = ""`.  
2. First `reload()` fires **without** `department_id` → API returns **4 active sections**.  
3. Departments arrive (ordered by **name**): first row is **Appliances** / `building_materials`-class inactive dept — **not** flooring.  
   Production name-order first codes include `appliances`, `building_materials`, …; flooring (`Flooring / Home Decor`) is **not** first.  
4. For MasterAdmin pin **`all`**: `departmentId` becomes `departments[0].id` (wrong department).  
5. Second `reload()` filters `department_id=<non-flooring>` → **0 sections** (simulated: wrong dept → 0; flooring → 4; no filter → 4).  
6. `setSections([])` → list replaced by empty-state copy.

That matches “briefly displays, then disappears.”

**Also CONFIRMED:** If the working pin is already a non-flooring department, the list can appear empty **without** a flash (same filter miss; no prior unfiltered success).

**NOT the cause (ruled out for data loss):**

- Sections deleted in DB  
- Zebra handoff migration dropping sections  
- Auth error silently mapped to empty **on error path** — `catch` sets `error` and does **not** clear `sections`. Disappearance requires a **successful empty** payload (or unmount).

### Error visibility defect

**CONFIRMED:** A successful filtered empty list is presented as “No Operational Sections yet,” which implies none are configured. That is false when sections exist under another department. Authorization/network failures do set an error string, but the empty-success path is the observed UX failure mode here.

---

## 4. Relevant API / query evidence

| Request shape | Active sections returned |
|---------------|--------------------------|
| No `department_id`, `is_active=true` | **4** |
| `department_id=flooring` | **4** |
| `department_id=first name-ordered dept` (e.g. appliances / building_materials) | **0** |

API route (`GET /api/operational-sections`) correctly scopes by actor store and optional department; it does **not** invent emptiness — the client supplies the wrong filter after the `departments[0]` fallback.

Floor / Sunday loaders call `fetchOperationalSections` **without** department filter (non-blocking on Floor). Section data for stewardship composition can still load there even when More → Sections looks empty.

---

## 5. Rotation proposal data flow

```text
Sunday modal open
  → fetchOperationalSections({ includeMembers: true })  // no dept filter
  → indexBaySectionLookups → baySectionByKey
  → if capacity approvals complete:
        composeStewardshipWeeklyProposal(... baySectionByKey ...)
     else if SECTION_AWARE preview flag:
        section-aware preview path
     else:
        legacy flat / hours path
  → persist only on explicit Assign via capacity RPC
```

| Input | Production evidence |
|-------|---------------------|
| Sections loaded for proposal | Unfiltered fetch — can see all 4 even if More UI empty |
| W42 assignments | **0** |
| W42 capacity approvals | **4** (sum 11) — approvals exist; week not yet assigned |
| W41 assignments | **6** — Tracy/Tyson mixed aisles 5,7,42,43,44 |
| Section-aware auto-stage | **`false`** |
| Preview flag | Off unless env set |

---

## 6. Cause of incorrect aisle assignments

**CONFIRMED for persisted W41 rows; HYPOTHESIS clarified for “current week” perception.**

### Persisted W41 (`week_starting` 2026-10-05) — actual aisles

| Associate | Bays (aisle-bay) | Steward home aisles | Steward-aligned? |
|-----------|------------------|---------------------|------------------|
| Tracy | 5-15, 5-17, 43-7 | 41, 42 | **No** |
| Tyson | 7-9, 42-8, 44-15 | 5, 6 | **No** |

Names on older rows include hour suffixes (`Tracy · 22h`, etc.) on W40 — consistent with **legacy hours-proportional / coverage-first** assignment, **before** stewardship distribution was the assign path.

**CONFIRMED:** W41 was not written by ROTATION-006 stewardship confirm (or equivalent). It matches the pre-stewardship behavior already documented in ROTATION-003 (§ W41 contrast).

### W42

- **0** `sunday_bay_assignments` — nothing incorrect persisted for W42 yet.  
- Incorrect-looking “assignments” for W42 are either empty state, a **proposal preview**, or the operator is still viewing **W41** history.

### Relation to disappearing sections

**Related indirectly, not the same bug:**

- More UI filter bug can make operators believe sections are gone.  
- Floor/Sunday still load sections without that broken fallback (usually).  
- Wrong weekly aisles on W41 are **historical assign-path**, not proof sections were deleted.

If Sunday section fetch failed, code sets `baySectionByKey` to empty Map and logs — stewardship would degrade to non-steward matching. That is a **possible** contributor to a bad **new** assign, but W41 evidence points to legacy path timing, not current DB section loss.

---

## 7. Recent release involvement

| Release | Touch Operational Sections retrieval UI? | Touch stewardship assign? | Involvement |
|---------|------------------------------------------|---------------------------|-------------|
| SECTION-ROTATION-005 | No | Capacity approvals gate | Enables stewardship path when approvals complete |
| SECTION-ROTATION-006 (`c3b2317`) | No panel filter change | **Yes** — `stewardship-week-distribution` | Correct path for *new* assigns; does not rewrite W41 |
| SECTION-ROTATION-007 | Deploy/migrate capacity | No section wipe | Data still 4×160 after release |
| ZEBRA-HANDOFF-002/004 (`ef593f0`) | **No section files in commit** | No | **Not involved** in section disappearance |

**CONFIRMED:** Zebra handoff did not modify `operational_sections` / panel / list API.

**CONFIRMED:** The More → Sections filter fallback (`departments[0]`) predates Zebra (panel history includes RD-3 / SECTION-UX commits such as `7bec21e`, `33a088b`, `b702b94`). Regression may feel “new” when Full Store pin + multi-dept topology graph is opened more often after recent Map/More topology work.

---

## 8. Data preservation assessment

| Asset | Status |
|-------|--------|
| 4 active sections + owners + aisles | **Preserved** |
| 160 memberships | **Preserved** |
| W41/W42 assignments | **Unchanged by this investigation** |
| Capacity approvals | **Preserved** (4) |
| Completion / verification history | **Untouched** |
| Sunday auto-stage | Remains hard-off in app |

**No data repair or rebuild is required for sections.**

---

## 9. Smallest safe correction (do not implement yet)

1. **OperationalSectionsPanel department resolution**  
   - When working pin is `all`, either: omit `department_id` filter (list all store sections the actor can access), **or** prefer the active flooring department id, **never** blind `departments[0]`.  
   - Prefer active departments when resolving a fallback.

2. **Race safety**  
   - Ignore stale `reload()` responses (abort or monotonic request id).

3. **Empty-state honesty**  
   - If filter returns 0 but store has sections in other departments, show “None in this department” + pin guidance — not “No Operational Sections yet.”

4. **Weekly aisles**  
   - Do **not** recreate sections.  
   - For new weeks: assign only via stewardship path after approvals (already gated).  
   - Treat W41 as historical legacy; optionally document or leave until natural week rollover.  
   - Do not auto-restage or mutate W41/W42 in a panic fix.

5. **Out of scope / do not do**  
   - Rebuild memberships, delete/recreate sections, enable auto-stage, Zebra changes, Walkthroughs.

---

## 10. Required tests (for a later fix tranche)

| Test | Intent |
|------|--------|
| Panel + pin `all` + multi-dept list ordered by name | Still shows flooring sections (or clear filtered-empty message) |
| Race: unfiltered response after filtered request | Must not clobber newer empty/wrong state incorrectly; prefer generation guard |
| Empty state copy when other departments have sections | Must not claim “none configured” |
| Stewardship proposal with live baySectionByKey | Unchanged capacity/priority rules |
| Regression: Zebra handoff files do not alter section list API | Contract |

Existing suites run this diagnosis: `rd3.operational-sections.contract` **7 PASS**; `operational-sections.authz` **11 PASS**; `stewardship-week-distribution` **18 PASS** (**36** total).

---

## 11. GO / CONDITIONAL GO / NO-GO

| Question | Verdict |
|----------|---------|
| Are section records safe / present? | **GO** — no restore needed |
| Root cause of UI disappearance identified? | **GO** — confirmed filter fallback + race/empty-success UX |
| Root cause of wrong W41 aisles identified? | **GO** — legacy non-stewardship assignments; W42 empty |
| Safe to implement the small UI fix? | **CONDITIONAL GO** — after operator accepts this diagnosis |
| Safe to rebuild sections / mutate assignments now? | **NO-GO** |
| Zebra release rollback needed? | **NO-GO** — not causal |

**Overall:** **CONDITIONAL GO** for a focused follow-up fix tranche on More → Operational Sections department filtering / empty-state / reload races only. **NO-GO** on data rebuild or assignment rewrites in this investigation.

---

### Finding classification summary

| Item | Class |
|------|--------|
| DB 4 sections + 160 members intact | **CONFIRMED** |
| Stewardship map matches expectation | **CONFIRMED** |
| UI empty after flash due to `departments[0]` + unfiltered→filtered reload | **CONFIRMED** |
| Empty copy misrepresents “none configured” | **CONFIRMED** |
| Zebra handoff caused data loss | **REFUTED** |
| W41 aisles not steward-aligned | **CONFIRMED** |
| W41 written by stewardship-006 path | **REFUTED** (legacy pattern) |
| W42 wrong persisted assignments | **REFUTED** (count 0) |

**STOP.** No fixes implemented in this tranche.
