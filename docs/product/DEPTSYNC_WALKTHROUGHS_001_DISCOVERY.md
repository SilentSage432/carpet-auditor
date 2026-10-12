# DEPTSYNC-WALKTHROUGHS-001 — Supervisory Walkthroughs Discovery

**Status:** COMPLETE (read-only)  
**Date:** 2026-10-12  
**Store context:** 2587 · Flooring / Home Decor (merged department) · Supervisor Tyson  
**Mode:** Repository discovery + secure read-only production counts  
**Not authorized:** implementation, migrations, production mutations, deployment

**Prior authority:** RD-5 (`DEPTSYNC_RD_5_WALKTHROUGHS.md`) + RD-5-RELEASE (`DEPTSYNC_RD_5_RELEASE.md`) + RD-5-FIX store-ref integrity

---

## 1. Executive summary

Walkthroughs are a **real, production-migrated domain** — not a placeholder tab. RD-5 shipped sessions, observations, optional follow-ups, store-scoped APIs, Overview inbox wiring, and Map bay history. Production tables exist on `fmeinlwhixngednabhgy` with **zero rows**.

What is missing for a practical 15–20 minute supervisory walk is not the domain substrate; it is **operator speed and place intelligence**:

| Needed for a floor walk | Current reality |
|-------------------------|-----------------|
| Fast issue capture | Works, but every save requires free-text description + a long optional form |
| Correct physical place | Soft free-text aisle/bay; not validated against topology; no Map-side capture |
| Who owns that place | Manual optional section/associate pick; **no auto-resolve from aisle/bay → Operational Section owner** |
| Outstanding issues later | Open follow-up inbox works **only if** a follow-up was created at capture time |
| Verified correction | Follow-up close with text evidence; no photo; no separate verify step |
| Independence from rotation/Zebra | Confirmed — no FK, no mutation paths |

**Verdict: CONDITIONAL GO** for a small UX + binding tranche on top of the existing domain. **NO-GO** for rebuilding Walkthroughs, adding a task platform, or coupling observations to weekly rotation mutation.

---

## 2. Existing Walkthroughs architecture

### 2.1 Surface map

| Layer | Path | Role |
|-------|------|------|
| Route shell | `app/(workflow)/walkthroughs/page.tsx` | Returns `null`; real UI is hub keep-alive |
| Tab UI | `components/hub/tabs/WalkthroughsTab.tsx` | Inbox home |
| Capture | `components/walkthroughs/WalkthroughCaptureSheet.tsx` | Observation + optional follow-up |
| Close | `components/walkthroughs/FollowUpCloseSheet.tsx` | Follow-up completion evidence |
| Overview | `components/hub/tabs/OverviewTab.tsx` | Open / attention follow-ups |
| Map bay sheet | `components/admin/WalkTheFloorSheet.tsx` | Place history (read) |
| Domain | `lib/store-ops/walkthroughs.ts` | Types, validation, persistence |
| Client | `lib/store-ops/client.ts` | Fetch/mutate helpers + change event |
| Nav | `lib/nav-hub.ts` | Primary tab “Walkthroughs” / “Walk” |
| Migration | `supabase/migrations/20261012_walkthroughs.sql` | Additive schema + RLS SELECT |
| Prior docs | `docs/product/DEPTSYNC_RD_5_WALKTHROUGHS.md`, `DEPTSYNC_RD_5_RELEASE.md` | Design + production release |

### 2.2 API endpoints (traced)

| Method | Path | Auth | Persistence |
|--------|------|------|-------------|
| GET | `/api/walkthroughs` | Store-ops actor | `listWalkthroughInbox` |
| POST | `/api/walkthroughs/sessions` | Supervisor/Master | `startWalkthroughSession` |
| PATCH | `/api/walkthroughs/sessions/[id]` | Supervisor/Master | `endWalkthroughSession` (`action: end`) |
| GET | `/api/walkthroughs/observations?department_id&aisle&bay` | Store-ops actor + dept scope | `listWalkthroughPlaceHistory` |
| POST | `/api/walkthroughs/observations` | Supervisor/Master | Start session if needed + `createWalkthroughObservation` + optional follow-up |
| POST | `/api/walkthroughs/follow-ups` | Supervisor/Master | `createWalkthroughFollowUp` |
| PATCH | `/api/walkthroughs/follow-ups/[id]` | Supervisor/Master | `completeWalkthroughFollowUp` |

Writes use **service role after API actor checks**. No authenticated INSERT/UPDATE/DELETE RLS policies. No walkthrough RPCs.

### 2.3 Functionality classification

| Capability | Status | Evidence |
|------------|--------|----------|
| Begin / resume active session via capture | **IMPLEMENTED AND WORKING** | Capture with null `session_id` starts session; active session reused |
| End active session | **IMPLEMENTED AND WORKING** | PATCH sessions + UI button |
| Observation types (positive / opportunity / general) | **IMPLEMENTED AND WORKING** | DB check + UI chips + domain validators |
| Observation notes (body text) | **IMPLEMENTED AND WORKING** | Required non-empty body |
| Optional roster companion / associate / responsible | **IMPLEMENTED AND WORKING** | Soft FKs + RD-5-FIX store assert |
| Optional Operational Section bind | **IMPLEMENTED AND WORKING** | `section_id` / `focus_section_id` + store assert |
| Optional free-text aisle/bay | **IMPLEMENTED AND WORKING** | Normalized aisle trigger; soft place fields |
| Optional follow-up at capture | **IMPLEMENTED AND WORKING** | Inline toggle → create follow-up |
| Open / attention / completed follow-up inbox | **IMPLEMENTED AND WORKING** | `composeWalkthroughInbox` + WalkthroughsTab + Overview |
| Close follow-up with text evidence | **IMPLEMENTED AND WORKING** | Requires evidence and/or resolution notes |
| Map bay walkthrough history | **IMPLEMENTED AND WORKING** | `fetchWalkthroughPlaceHistory` on bay sheet |
| Overview attention for overdue follow-ups | **IMPLEMENTED AND WORKING** | Past `due_on` → “Needs attention” (reminder only) |
| Rotation / Zebra independence | **IMPLEMENTED AND WORKING** | Domain never touches rotation tables |
| Standalone follow-up API after observation | **IMPLEMENTED BUT DISCONNECTED** | `POST /api/walkthroughs/follow-ups` exists; **no client helper / UI** to add follow-up later |
| Explicit `POST /sessions` start | **IMPLEMENTED BUT DISCONNECTED** | API exists; UI always starts via observation POST |
| Capture sheet place prefill props | **PARTIALLY IMPLEMENTED** | `initialAisle` / `initialBay` / `initialDepartmentId` accepted; **WalkthroughsTab and Map never pass them** |
| Capture from Map bay | **MISSING** | Map only links to `/walkthroughs` |
| Auto owner from aisle/bay → section | **MISSING** | No lookup composition |
| Topology validation of aisle/bay | **MISSING** | Free text accepted if format-valid |
| Photos | **MISSING** | No columns, upload, or UI |
| Observation edit / delete | **MISSING** | Insert-only domain; no PATCH observation |
| Observation open/resolved state | **MISSING** | Only follow-ups have `open`/`done` |
| Severity / priority beyond type | **MISSING** | Types only |
| Link to weekly rotation assignment | **MISSING** | No `assignment_id` / rotation FK |
| Offline walkthrough drafts | **MISSING** | No walkthrough offline queue; other app offline systems unrelated |
| Department picker (Flooring vs Home Decor) | **MISSING / N/A today** | Store has merged dept `Flooring / Home Decor` |
| Historical session browser | **PARTIALLY IMPLEMENTED** | Recent observations (12) + follow-ups; no full session archive UI |
| One-active-session guard | **PLACEHOLDER / WEAK** | Inbox picks first `active`; DB allows multiple active sessions |

---

## 3. Current mobile experience

Traced operator path (Supervisor on phone → Floor Command bottom nav **Walk**):

1. **Begin** — large “Begin walkthrough” opens capture sheet (does not call sessions API alone).  
2. **Department selection** — none. Department is inferred only if an Operational Section is chosen (`selectedSection.department_id`).  
3. **Aisle/bay selection** — optional free-text fields; not a Map picker; not aisle chips from known topology.  
4. **Record observation** — type chip + required textarea + optional companion / associate / section / aisle / bay + optional follow-up block.  
5. **Photos** — not supported.  
6. **Notes** — observation `body` is the note; session `notes` column unused by UI.  
7. **Persist** — POST observation; toast “Observation saved”; inbox reload via change event.  
8. **Resume** — if an `active` session exists, button becomes “Add observation” and reuses `session_id`.  
9. **Complete walk** — “End active walkthrough” sets session `ended`. Observations/follow-ups remain.  
10. **Review later** — Walkthroughs inbox (attention → open follow-ups → recent observations → recently completed); Overview shows open follow-up summary.

**Unnecessary friction for a 15–20 minute walk**

- Long capture form forces scrolling past several optional selects before Save.  
- Place entry is typing, not walking-context selection.  
- Ownership is another manual select even when section membership already knows the steward.  
- Follow-up cannot be attached later without a new observation path (API exists, UI does not).  
- Map shows history but cannot start a place-bound observation in place.

**Confirmed vs intended**

| Claim | Confirmed? |
|-------|------------|
| Dedicated walkthrough tables live in production | **Yes** (migrated; empty) |
| Capture persists | **Yes** (code path); **unused** in production (0 rows) |
| Follow-ups are queryable without reopening every session | **Yes** (inbox) |
| Place binds to real topology rows | **No** — soft aisle/bay strings |
| Owner resolved from Operational Sections | **No** — optional manual |
| Photos / offline drafts | **No** |

Associates in simplified view **do not** see the Walkthroughs tab (`navRoleLinks` filters to My Shift + Map). Capture mutations require Supervisor/Master.

---

## 4. Persistence and data model

### 4.1 Tables

```
walkthrough_sessions
  store_id, department_id?, companion_specialist_id?, focus_section_id?,
  status active|ended, notes?, started_at, ended_at, created_by_specialist_id

walkthrough_observations
  store_id, session_id, observation_type positive|opportunity|general,
  body, associate_specialist_id?, section_id?, department_id?,
  aisle?, bay?, observed_at, created_by_specialist_id

walkthrough_follow_ups
  store_id, observation_id, session_id, action_text,
  responsible_specialist_id?, due_on?, status open|done,
  completion_evidence?, resolution_notes?, completed_at?,
  completed_by_specialist_id?, created_by_specialist_id
```

Soft FKs to `stores`, `departments`, `store_specialists`, `operational_sections`.  
`ON DELETE SET NULL` for roster/section; cascade store/session for child rows.  
Aisle normalize trigger on observations.  
Indexes for store/time, place, section, follow-up status.

### 4.2 Retrieval

- Inbox loads last 20 sessions / 40 observations / 60 follow-ups for the actor store, then composes views with specialist + section names.  
- Place history filters `store_id + department_id + aisle + bay`.  
- Missing tables return `missing_relation` → API 503 (graceful empty messaging in UI).

### 4.3 Mutation safety notes

- Observations are **append-only** in the product API (no edit endpoint) — historical body is not silently overwritten by UI.  
- Follow-up completion is idempotent if already `done`.  
- Completing a follow-up does **not** mutate the source observation.  
- Multiple concurrent `active` sessions are possible (no unique partial index) — inbox shows the newest by `started_at` order among loaded rows.

---

## 5. Operational Sections integration

### 5.1 Production stewardship (store 2587, read-only)

Active sections under merged department **Flooring / Home Decor**:

| Section name | Primary owner | Aisles | Member bays |
|--------------|---------------|--------|-------------|
| Myself | Tyson | 5, 6 | 34 |
| CSA | Nate | 39, 40, 7 | 60 |
| Specialist-A | Nick | 43, 44 | 35 |
| Specialist-B | Tracy | 41, 42 | 31 |

Matches the mission’s canonical ownership. Walkthroughs **do not** create or reassign section membership.

### 5.2 What Walkthroughs can bind today

- Optional `section_id` on observation (validated store-scoped).  
- Optional `focus_section_id` on session start.  
- Optional `associate_specialist_id` (conversation subject) — **not** automatically the section primary owner.  
- Optional aisle/bay strings — **not** looked up against `operational_section_members`.

### 5.3 Gap

There is **no composition** that answers: “bay 5-12 → section Myself → owner Tyson” inside capture or inbox. Ownership intelligence already exists in section/rotation composers (`baySectionByKey` patterns) but is **not consumed** by walkthroughs.

**Do not duplicate ownership.** Prefer read-compose from Operational Sections at capture/display time.

---

## 6. Rotation relationship

| Concern | Finding |
|---------|---------|
| Shared tables | None |
| Observation → assignment link | None |
| Auto-modify rotation from observation | Impossible via current domain (and contract-tested against) |
| Conceptual overlap in UI | Low — Walkthroughs copy says observe/discuss/follow through; This Week owns assignment/verify/Zebra |

Architecture **supports independence** today. Optional future soft link (e.g. `related_assignment_id` nullable) is absent and **not required** for MVP usefulness. Do not require every observation to reference a weekly assignment.

---

## 7. Observation and follow-up capabilities

| Capability | Real? | Notes |
|------------|-------|-------|
| Categories | **Yes** | positive / opportunity / general |
| Severity / priority | **No** | Overdue follow-up is reminder language only |
| Notes | **Yes** | Required observation body; optional resolution notes |
| Photos | **No** | |
| Aisle/bay references | **Soft yes** | Free text; place history needs department_id too |
| Responsible associate | **Optional yes** | Follow-up responsible; observation associate is separate |
| Open/resolved | **Follow-ups only** | Observations have no lifecycle state |
| Follow-up dates | **Yes** | `due_on`; attention when past due |
| Resolution evidence | **Text yes** | Required evidence and/or notes to close |
| Supervisor verification | **Partial** | Closing *is* supervisor/Master action; no second verify gate |
| Observation history | **Partial** | Recent list + per-bay history; no edit audit trail |

**Minimum useful supervisory workflow (recommended)**

1. Walk → pick place quickly → short observation (type + note).  
2. System shows section owner when place is known.  
3. Optionally add follow-up (now or later).  
4. Later: open inbox of unresolved follow-ups → close with short evidence.  
5. Observations without follow-ups remain history, not tasks.

---

## 8. Authorization and audit findings

| Control | Finding |
|---------|---------|
| Supervisor/Master mutate | `requireSupervisorOrAdmin` on all write routes |
| Associates | Can GET inbox/place history if they can hit APIs with store-ops actor; simplified nav hides tab; capture UI blocked by `isSupervisor` |
| Store isolation | Actor store → `resolveStoreByNumber`; all loads filter `store_id` |
| Soft-ref store integrity | RD-5-FIX `assertRosterSpecialistForStore` / `assertOperationalSectionForStore` |
| Department scope | `assertActorCanAccessDepartmentId` when department_id present |
| RLS | Authenticated SELECT via `jwt_matches_store`; **no** authenticated writes |
| Anon write probe | Insert denied (`42501` RLS) |
| Observation overwrite | No product edit API — low silent-overwrite risk |
| Follow-up reopen | No reopen API once `done` |
| Audit history | Creator/completer specialist ids + timestamps; no separate audit table |

**Do not weaken authorization.** Future Map capture and owner auto-fill must keep Supervisor/Master write gates and store asserts.

Offline: app has PWA manifest + unrelated offline queues (specialists, some rotation completion). Walkthroughs have **no offline write path** — correctly absent until sync/conflict design exists.

---

## 9. Production data observations

Project `fmeinlwhixngednabhgy` · store **2587** · read-only REST counts (2026-10-12):

| Entity | Count |
|--------|-------|
| `walkthrough_sessions` | **0** |
| `walkthrough_observations` | **0** |
| `walkthrough_follow_ups` | **0** |
| Sessions active / ended | 0 / 0 |
| Follow-ups open / done | 0 / 0 |
| Observations by type | 0 / 0 / 0 |
| Observations with aisle | 0 |
| Observations with section | 0 |
| Active operational sections | **4** (+ 1 inactive) · 160 member bays |

Tables exist and are queryable (migration applied per RD-5-RELEASE). **No historical walkthrough usage yet** — product fit cannot be validated from production evidence, only from code + empty schema readiness.

No unrelated personal data exported beyond section owner first names needed for stewardship mapping (Tyson / Nate / Nick / Tracy).

---

## 10. Confirmed functional gaps

Ordered by supervisory usefulness:

1. **Place-first capture** — Map bay → prefilled observation; aisle chips / bay picker instead of free typing.  
2. **Section ownership compose** — from aisle/bay (and department) show primary owner without reassigning sections.  
3. **Capture form weight** — collapse optional fields; keep type + note + place as the primary path.  
4. **Follow-up later** — wire existing POST follow-ups API to an observation card action.  
5. **Outstanding without follow-up policy** — decide whether observations alone can be “watch items” or only follow-ups are tracked.  
6. **Active session uniqueness** — prevent orphaned multiple actives (product rule + optional DB constraint).  
7. **Photos** — deferred unless operator requires evidence beyond text.  
8. **Rotation soft-link** — deferred; not needed for walk usefulness.  
9. **Offline writes** — deferred.  
10. **Separate Flooring vs Home Decor walk mode** — blocked by merged department topology; not a Walkthroughs-only fix.

---

## 11. Recommended implementation sequence

Smallest coherent sequence (no new platform):

### WALK-002 — Place-bound capture (app only; likely no migration)

1. From Map bay sheet: **Add observation** opens `WalkthroughCaptureSheet` with `initialDepartmentId` / aisle / bay (and section if bay membership known).  
2. Prefill section from `operational_section_members` lookup (read-only compose).  
3. Display primary owner name as read-only context (not a reassignment control).  
4. Keep free-text override optional for unsectioned places.

### WALK-003 — Walk speed UX (app only)

1. Progressive disclosure: type + note + place first; companion/associate/follow-up behind “More”.  
2. Aisle quick-picks from known store aisles / section aisles when online.  
3. Ensure one visible active session; ending or starting cleans ambiguity in UI.

### WALK-004 — Follow-through completeness (app only; API already exists)

1. Client helper for `POST /api/walkthroughs/follow-ups`.  
2. “Add follow-up” on an existing observation.  
3. Keep Overview inbox as the outstanding-work surface.

### Later (only with operator GO)

- Photo evidence on follow-up close.  
- Optional nullable soft link to a Sunday assignment (display only).  
- Session archive browser.  
- Offline draft queue after conflict design.

**Avoid:** task platform, Zebra duplication, section rebuild, rotation engine changes, AI observations, scoring, analytics dashboards.

---

## 12. Operator decisions genuinely required

These cannot be resolved from existing product docs alone:

1. **Is a follow-up required to track an issue, or should a plain observation remain visible as unresolved?**  
   (Today: only follow-ups are inbox-tracked.)  
2. **Should place binding auto-fill the section owner as the default “responsible” person when a follow-up is added?**  
3. **Must capture start from Map during the walk, or is Walkthroughs-tab typing acceptable for v1 polish?**  
4. **Are photos required before this tool is usable on the floor, or is text evidence enough for close?**  
5. **When aisle/bay is typed but not in topology / not sectioned, should save be allowed, warned, or blocked?**  
6. **Should Home Decor ever be a separate walk target before the merged `Flooring / Home Decor` department is split?**

---

## 13. Explicitly deferred functionality

- AI-generated observations or judgments  
- Automatic disciplinary scoring / rankings  
- Complex analytics / heatmaps without usage evidence  
- Offline walkthrough writes  
- Voice → walkthrough draft (Floor Pad remains freeform)  
- Recreating Operational Sections or weekly rotation inside Walkthroughs  
- Zebra / assignment completion from walkthrough close  
- Multi-store or associate-authored walkthrough capture  
- Full inspection checklists / formal audit scoring

---

## 14. Test results

Command:

```bash
npx vitest run \
  lib/store-ops/walkthroughs.test.ts \
  lib/store-ops/walkthroughs.authz.test.ts \
  lib/rd5.walkthroughs.contract.test.ts
```

| Suite | Result |
|-------|--------|
| `lib/rd5.walkthroughs.contract.test.ts` | **9 passed** |
| `lib/store-ops/walkthroughs.test.ts` | **10 passed** |
| `lib/store-ops/walkthroughs.authz.test.ts` | **10 passed** |
| **Total** | **3 files · 29 passed** |

No application code was modified for this discovery.

---

## 15. Product-fit answers

| # | Question | Answer |
|---|----------|--------|
| 1 | Walk a department and quickly record an issue? | **Partially.** Capture works; form + typing make it slower than a 15–20 min walk needs. |
| 2 | Identify correct physical location? | **Weak.** Soft aisle/bay only; Map history yes, Map capture no; no topology validation. |
| 3 | Determine who owns that location? | **Only if manually tagged.** Section ownership exists in production but is not auto-composed into walkthroughs. |
| 4 | Return later and see if addressed? | **Yes, for follow-ups.** Observations without follow-ups are history, not an open queue. |
| 5 | Distinguish observed vs verified corrections? | **Partially.** Follow-up `done` + text evidence; no photo; no separate verify state. |
| 6 | Review outstanding without every historical walkthrough? | **Yes** via open/attention follow-up inbox (+ Overview). |
| 7 | Avoid duplicating rotation / Zebra? | **Yes.** Domains are intentionally independent. |

---

## 16. GO / CONDITIONAL GO / NO-GO

**CONDITIONAL GO** — proceed to a focused **WALK-002/003/004** polish tranche on the existing RD-5 domain after operator answers §12 (especially follow-up-vs-observation tracking and Map capture priority).

| Path | Verdict |
|------|---------|
| Use existing tables/APIs | **GO** |
| Production migrate for basic walkthroughs | **Already done** (empty tables ready) |
| Rebuild Walkthroughs / new task system | **NO-GO** |
| Auto-mutate rotation/sections from observations | **NO-GO** |
| Offline write queue now | **NO-GO** (defer) |
| Implementation without operator §12 decisions | **CONDITIONAL** — can start Map prefill + form collapse; hold policy on unresolved observations / photos |

**STOP. Do not implement fixes in this tranche.**
