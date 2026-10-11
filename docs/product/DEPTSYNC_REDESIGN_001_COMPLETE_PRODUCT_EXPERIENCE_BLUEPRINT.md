# DEPTSYNC-REDESIGN-001 — Complete Product & Experience Blueprint

**Status:** COMPLETE (product design + architectural discovery)  
**Date:** 2026-10-10  
**Mode:** Design only — destination fully defined; implementation later in controlled tranches  

**Not authorized:** application code, schema mutations, production SQL execution, auth changes, deploy, commit, push.

---

## Layer legend

| Tag | Meaning |
|-----|---------|
| **IMPLEMENTED** | Running today in `carpet-auditor` |
| **APPROVED TARGET** | Ratified (ALIGN-001 → ALIGN-002 / Constitution) |
| **PROPOSED** | This blueprint’s product/experience specification (awaiting operator approval) |
| **DEFERRED** | Destination-compatible; not in near implementation sequence |
| **UNRESOLVED** | Operator decision still required before a later tranche |

Do not treat APPROVED TARGET or PROPOSED as shipped.

---

## A. Executive product definition

### A.1 What DeptSync is

**PROPOSED / APPROVED TARGET:** DeptSync is a **personal operational command center** for one Department Supervisor responsible for Flooring and Home Decor.

It converts management intent into sustainable, trackable, verifiable coverage — so the department stays ready year-round without frantic cleanup culture.

It is **not:** multi-tenant SaaS, multi-supervisor platform, associate-facing app, employee scoring system, Zebra/task-dashboard replacement, or AI-dependent operational engine.

### A.2 Who uses it

| Role | Product reality |
|------|-----------------|
| **OPERATOR** | Sole authenticated user — Department Supervisor |
| **TEAM_MEMBER ×3** | Two Flooring Specialists + one Home Decor CSA — **roster records only**; no login required |
| Operator also participates in Home Decor staffing | Per Constitution staffing model |

### A.3 Operating doctrine

> Small, bounded, recurring work creates continuous readiness.  
> DeptSync manages the rotation; Lowe’s manages the task; the operator validates the work.  
> Permanent ownership ≠ weekly assignment ≠ temporary coverage ≠ work performed.  
> Deterministic rules + observable evidence; human authority always wins.

### A.4 Finished product character

One integrated system with five primary surfaces:

**Overview · Map · This Week · Walkthroughs · More**

Every surface answers a different question about the **same** operational truth. No orphan modules. Mobile-first on the floor; fully usable on desktop.

Initial weekly default: **four people × three bays** (operator-configurable later). Internal Flooring/Home Decor separation **must not** double that workload.

---

## B. Existing application assessment

### B.1 Implemented chrome and routes

| Surface | Route / owner | Reality |
|---------|---------------|---------|
| Floor (This Week-ish) | `/dashboard` · `components/hub/tabs` Floor ownership board | People → physical bays; stage/assign/verify/+1 |
| Map | `/admin/store-map` · `MapTab` → `StoreLocationGrid` | Coverage geography; `canMutate=false` |
| Roster | `/roster` | People + schedules + call-out |
| More / Settings | `/settings` | Floor Pad, topology bulk, seasonal, collapsed Master Admin |
| Nav owner | `lib/nav-hub.ts`, `BottomNav.tsx` | Floor · Map · Roster · More |
| Auth | Hub PIN / Master PIN / QR pair / gate cookie | Multi-role still live (ALIGN-SEC hardened) |
| Engine | `rotations.ts`, `sunday-dispatch.ts`, `weekly-rotations.ts`, `physical-bay.ts` | Deterministic eligible×3, carry-over, verification attempts |
| Topology | `store_locations`, Bulk Generator, Edit Bay | Physical-bay-first BOTH surfaces |
| Observational | Floor Pad / Walk & Talk (`manager_notes`, `shift_walk_tasks`) | **PROTECTED** pending FLOORPAD-001 |
| Departments | Merged `flooring` / “Flooring / Home Decor” | Separation APPROVED TARGET; TOPO-001 hybrid design proposed |

### B.2 Strengths to preserve

- Physical bay coverage law (BAY-UNIT-002)
- Deterministic Sunday stage + assign + verify + completion attempts
- Carry-over / barrier / High priority as evidence (not AI)
- Bulk aisle/bay creation (BULK-SETUP-002)
- Map as geography (UX-REDUCE-003) vs Floor as weekly ownership (UX-REDUCE-002)
- Fail-closed security stabilization (ALIGN-SEC-001…007 path)
- Theme token system + handheld density prefs (`lib/theme.ts`)

### B.3 Structural mismatches vs destination

| Mismatch | Tag |
|----------|-----|
| Nav labels Floor · Roster instead of Overview · This Week · Walkthroughs | IMPLEMENTED ≠ APPROVED TARGET |
| Multi-role associate chrome / PIN/QR as product assumption | IMPLEMENTED debt |
| Department-centric Map pin / multi-dept templates | IMPLEMENTED |
| No Operational Section entity | APPROVED TARGET missing |
| No Overview composition surface | APPROVED TARGET missing |
| Walkthroughs not first-class; Floor Pad is adjacent observational capture | PROTECTED / unresolved belonging |
| Capacity not operator-configurable in UI | APPROVED TARGET missing |
| Specialty / Master Admin residue in More | Partially retired; still dense |

### B.4 Constitutional anchors (APPROVED TARGET)

`DEPTSYNC_CONSTITUTION.md` Art. I–V-B, II-A, III-A, XV–XVIII, XXV; ALIGN-002 ratification; TOPO-001 hybrid topology path; REDUCE-002A Floor Pad protection.

---

## C. Finished navigation architecture

### C.1 Primary nav (exactly five)

| Tab | Job | Landing? |
|-----|-----|----------|
| **Overview** | Situation awareness + attention | **Yes** (default post-login) |
| **Map** | Physical geography (Aisle → Bay) | No |
| **This Week** | Weekly plan, ownership, verify | No |
| **Walkthroughs** | Collaborative floor conversations + follow-ups | No |
| **More** | Team, sections, history, config, settings | No |

No sixth top-level tab without demonstrated need. Sections, history, capacity, archived locations live under Map context sheets and/or More.

### C.2 Route mapping (PROPOSED implementation shape)

| Product | Suggested route evolution | Notes |
|---------|---------------------------|-------|
| Overview | `/overview` or repurpose `/dashboard` after This Week moves | IA tranche |
| Map | keep `/admin/store-map` or rename `/map` | Label first; path rename optional |
| This Week | `/this-week` or keep `/dashboard` | Prefer one rename tranche |
| Walkthroughs | `/walkthroughs` | New |
| More | keep `/settings` or `/more` | Consolidate Roster into More → Team |

**PROPOSED:** Roster ceases to be a primary tab; **Team** lives in More (and Overview deep-links to people/week). Transitional: Roster tab may persist until Walkthroughs + Overview ship.

### C.3 Cross-links (one system)

```text
Overview ──needs attention──► This Week / Map bay / Walkthrough follow-up
Map bay sheet ──this week──► This Week person card
Map bay sheet ──section──► Section detail (sheet / More)
This Week bay ──locate──► Map focused aisle/bay
Walkthrough ──place──► Map / Section
More Team ──assignments──► This Week
```

---

## D. Complete experience specifications

### D.1 Overview — operational home

**Question answered:** What deserves my attention right now, and what is the state of this week?

#### Information hierarchy (PROPOSED)

1. **Week strip** — ISO week label, capacity (e.g. 12 of 12 planned), verified / assigned / open counts  
2. **Needs attention** — ordered list from evidence only (see below)  
3. **People this week** — four team slots: name, owned section (if any), this-week bay count, completion ratio  
4. **Open follow-ups** — from Walkthroughs (count + next due)  
5. **Quiet health** — when attention is empty, a single calm “Week on track” state (UX-REDUCE healthy-quieter law)

#### Attention sources (evidence only — no invented AI insights)

| Signal | Source |
|--------|--------|
| Unowned staged bays | `weekly_rotations` + missing Sunday ownership |
| Incomplete / sent-back | verification + completion attempts |
| Carry-forward / barriers | location carry + `rotation_exceptions` |
| Overdue follow-ups | walkthrough follow-up dates |
| No plan for week | empty stage for active scope |
| Call-outs affecting ownership | roster exception + still-owned bays |

#### Primary actions

- Stage / open This Week (if no plan)  
- Review verification queue  
- Open top attention item  
- Start walkthrough  
- Jump to Map

#### Layout

| Viewport | Pattern |
|----------|---------|
| **Mobile** | Single column; week strip sticky; attention first; people as compact rows; follow-ups collapsed until attention clear |
| **Desktop** | Week + attention primary column; people + follow-ups secondary column; no widget grid |

#### Empty states

- New week, nothing staged → CTA “Stage this week”  
- No team records → CTA “Add team in More”  
- No topology → CTA “Build Map”  
- All clear → quiet success, not confetti

#### Explicit non-goals

No decorative KPI mosaic, no leaderboards, no AI “insights” cards, no multi-dept portfolio tiles.

---

### D.2 Map — physical geography

**Question answered:** Where is the department, and what is the state of each place?

#### Primary structure (PROPOSED)

```text
AISLES
  └── BAYS (physical)
        └── optional section chip
        └── this-week / coverage / follow-up cues
```

**Departments are not a Map navigation requirement.**  
Internal `department_id` may remain for integrity (Flooring vs Home Decor storage) — APPROVED TARGET / TOPO-001 — but the operator navigates **aisles**, not department switchers.

#### Operator capabilities

| Capability | Where | Notes |
|------------|-------|-------|
| Bulk-create aisles/bays | Map setup sheet or More → Topology (PROPOSED: reachable from Map empty/setup) | Keep Bulk Generator model |
| Edit location | Bay sheet / Edit | Aisle, bay number; soft fields |
| Retire obsolete | Soft retire (`is_active=false`) primary | Hard delete only when no history pressure |
| Fast aisle jump | Aisle index / search | Alphanumeric codes |
| Open bay | Bay detail sheet | Context + history + actions |
| Section relationship | Chip + link | Max one active section per bay |
| Location history | Sheet section | Rotations, verifies, barriers, walkthrough mentions |

#### Topology simplification (PROPOSED)

- Active Map shows **active** locations only by default; “Show retired” disclosure  
- Sell/Top remain secondary presence (IMPLEMENTED pattern)  
- Rebuild via bulk is accepted; prefer soft-retire over hard-delete when FKs exist (TOPO-001)  
- Foreign-department aisles excluded from active workspace after topology reconciliation  

#### Map ↔ Sections

Sections overlay geography; they do **not** become a sixth nav tab. Create/edit section from Map multi-select or More → Sections.

---

### D.3 This Week — weekly execution

**Question answered:** Who owns which bays this week, and what is done / blocked / verified?

#### Four-person workflow (PROPOSED + APPROVED TARGET)

| Parameter | Value |
|-----------|-------|
| Team size | 4 (operator + 2 specialists + 1 CSA) |
| Initial capacity | **3 physical bays per person per week** |
| Total default volume | **12** physical bays (not 12×2 departments) |
| Capacity UI | Operator-configurable later (DEFERRED UI; design now) |
| Dual-dept rule | Shared capacity pool across Flooring + Home Decor internals |

#### Planning loop (preserve engine)

1. **Stage** — deterministic selection (physical bay, owed/eligible, priority/seasonal/carry)  
2. **Assign** — Sunday / Assign this week ownership to people  
3. **Perform** — work happens in Lowe’s world; DeptSync tracks report/complete signals as appropriate  
4. **Verify** — operator physical verification (strongest close)  
5. **Carry / exception** — incomplete and barriers remain truth  

#### State model (PROPOSED vocabulary — map to storage)

| Product state | Meaning | Evidence anchors (IMPLEMENTED) |
|---------------|---------|--------------------------------|
| **PLANNED** | Bay selected for the week; not yet owned | Staged `weekly_rotations`, no Sunday owner |
| **ASSIGNED** | Person owns the bay this week | `sunday_bay_assignments` + rotation |
| **PERFORMED** | Work reported/done awaiting or without final verify | Completion report / associate complete path; attempt PENDING |
| **VERIFIED** | Operator accepted as complete | `VERIFIED` attempt / verification_status; location cycle advance |

Barriers and send-backs are first-class interruptions, not silent clears.

#### Manual adjustments

- Reassign on call-out (explicit; ownership preserved until chosen)  
- +1 extra bay (ENGINE-PROD-003) — does not raise base quota  
- High/Standard priority on Map among owed bays  
- Force / recovery remain More → advanced (not everyday)

#### Legacy assumptions to remove (PROPOSED)

- Multi-department auto-stage multiplying volume  
- Associate-as-primary-user Floor chrome  
- Hours-proportional auto assignment as default (flat 3 remains)  
- Department pin as Map requirement  
- Treating SELLING/TOPSTOCK as two jobs  

#### Layout

Mobile: people-first board (IMPLEMENTED UX-REDUCE-002 direction).  
Desktop: same board + side inspector for selected person/bay.

---

### D.4 Walkthroughs — collaborative leadership

**Question answered:** What did we observe together, agree to do, and close?

**Not:** scoring, grades, rankings, surveillance.

#### Session flow (PROPOSED)

1. **Start** — pick companion (roster member), optional section/aisle focus  
2. **Walk** — capture cards: Working well · Opportunity · Agreed action  
3. **Place** — bind to aisle/bay/section (picker, not essay)  
4. **Own follow-up** — responsible person + date (optional)  
5. **End** — save session; follow-ups appear on Overview + Walkthroughs inbox  
6. **Close** — mark follow-up done with short completion evidence (note / photo optional later)

#### Mobile interaction (minimize typing)

- Large tap targets for observation type  
- Chip pickers for place and person  
- Voice → **proposed** text only if Floor Pad Gemini path is retained after FLOORPAD-001 — never authoritative without confirm (Constitution)  
- Offline-tolerant draft queue (PROPOSED; compose with existing sync patterns)

#### Relationship to Floor Pad (APPROVED TARGET gate)

- FLOORPAD-001 must decide: reuse `manager_notes` / Walk & Talk as substrate vs dedicated walkthrough tables  
- Until then: Walkthroughs UI may be designed; **new storage not introduced** without that review  
- REDUCE-002A protection remains in force  

#### Explicit bans

Leaderboards, automatic performance judgment, public ranking of associates, silent ownership transfer from walkthrough mentions.

---

### D.5 More — supporting management

**Question answered:** How do I configure the system and see durable management surfaces?

#### Structure (PROPOSED)

| Block | Contents |
|-------|----------|
| **Team** | Roster records, schedules, call-out tools, section ownership assignment |
| **Sections** | Create/edit/retire sections; assign bays; permanent owners |
| **Topology** | Bulk create, edit, retire locations; show retired |
| **Capacity & rotation** | Weekly bay quota per person; Sunday auto-stage prefs |
| **History** | Coverage / verification / walkthrough archives (read) |
| **Seasonal context** | Protected cadence input (keep until replaced) |
| **Settings** | Appearance, store number, account, security recovery |
| **Advanced** | Force recovery, fiscal signal, taxonomies — collapsed |

#### Anti-dumping rules

- If used weekly by operator → Overview, Map, This Week, or Walkthroughs  
- If setup/rare → More  
- If obsolete specialty → retire (already REDUCE-004 dormant)  

Roster primary tab **consolidates here** after Overview/This Week absorb people-week views.

---

## E. Operational Sections design

### E.1 Definition (APPROVED TARGET + PROPOSED detail)

An **Operational Section** is a named stewardship grouping of physical bays.

| Property | Rule |
|----------|------|
| Identity | Stable id + name + optional color/short code |
| Membership | Set of physical bays `(dept, aisle, bay)` or location group keys |
| Cardinality | **≤ 1 active section per physical bay** |
| Unsectioned bays | Remain visible and eligible |
| Permanent owner | One TEAM_MEMBER (or operator) — stewardship, not exclusive labor |
| Lifecycle | Active → Retired (membership preserved historically) |

### E.2 Relationships

| Relates to | How |
|------------|-----|
| Weekly work | Engine SHOULD prefer section-focused selection when sections exist (APPROVED TARGET; engine change separate tranche) |
| Walkthroughs | Session can target a section |
| Follow-ups | May reference section |
| History | Ownership changes and coverage under section are queryable |
| Cross Ownership | Others may be weekly-assigned or help; **must not** silently change permanent owner |

### E.3 CRUD (PROPOSED)

- **Create:** name + owner + add bays (Map multi-select or aisle range)  
- **Edit:** rename, reassign owner (explicit confirm), add/remove bays (bay moves section with confirm)  
- **View:** Map chips; More → Sections list; Overview people row  
- **Retire:** section inactive; bays become unsectioned; history retained  

Sections are **not** a top-level nav item.

---

## F. Four-person weekly workflow

### F.1 Happy path (PROPOSED)

```text
Sunday / Stage
  → select up to 12 distinct physical bays (shared pool)
  → assign ~3 per eligible person (flat)
Mon–Sat
  → people work assigned bays
  → report complete / barriers as needed
Operator
  → verify on floor
  → incomplete → carry / reassign intentionally
Next week
  → debt + cycle memory inform next draw
```

### F.2 Eligibility

Team members with schedule evidence for the week (LAB-WEEK-002). Call-out changes availability; weekly ownership changes only on explicit reassign (TIME-DUTY-003).

### F.3 Capacity configuration (later UI)

Operator sets `bays_per_person` (default 3). System computes `active_eligible × bays_per_person` once across the active operating scope — **never** once per internal department unless operator explicitly opts into separate pools (default: shared).

---

## G. Walkthrough interaction model

### G.1 Objects (PROPOSED domain — storage pending FLOORPAD-001)

| Object | Fields (conceptual) |
|--------|---------------------|
| WalkthroughSession | id, started_at, ended_at, companion_member_id, focus (section/aisles), notes |
| Observation | type (working_well \| opportunity), body, place refs, created_at |
| Agreement / FollowUp | action text, responsible_member_id, due_on, status (open \| done), completion_evidence, place refs |

### G.2 Provenance

- Observation = human (or human-confirmed from interpretation)  
- Follow-up completion = operator/responsible confirmation  
- Never auto-verify weekly bays from walkthrough text  

### G.3 Inbox

Walkthroughs tab = **Active follow-ups** + **Recent sessions**. Overview shows overdue/open count only.

---

## H. Connected domain model

```text
PHYSICAL LOCATION (store_locations / physical bay)
    ↑ membership (≤1 active)
OPERATIONAL SECTION
    ↑ permanent stewardship
PERMANENT OWNER (roster TEAM_MEMBER)
    ≠
WEEKLY ASSIGNMENT (sunday_bay_assignments + weekly_rotations)
    ≠
WORK PERFORMED (completion attempts / reports)
    ≠
VERIFICATION (operator review)
    ≠
WALKTHROUGH SESSION → OBSERVATIONS → FOLLOW-UPS
    ↘ all may reference place/section
HISTORICAL EVIDENCE (attempts, exceptions, service logs, retired locations, past ownership)
```

### H.1 Single sources of truth

| Truth | Owner |
|-------|-------|
| Geography | `store_locations` (+ physical bay composition) |
| Section membership / permanent owner | Section domain (new) |
| This-week plan/ownership | `weekly_rotations` + `sunday_bay_assignments` |
| Verification / rework history | `weekly_rotation_completion_attempts` |
| Barriers | `rotation_exceptions` |
| Walkthrough / follow-ups | Walkthrough domain (after storage review) |
| Team identity | `store_specialists` (records) |

### H.2 Information flow across five areas

| From → To | Carries |
|-----------|---------|
| Map → This Week | Place identity for assignment / High |
| This Week → Overview | Progress + attention |
| Walkthroughs → Overview | Open follow-ups |
| Map → Walkthroughs | Place binding |
| More → all | Team, sections, capacity, topology |
| Overview → any | Deep link to attention target |

Observations are not confirmed outcomes. Verification and follow-up closure are confirmed outcomes.

---

## I. Visual design direction

### I.1 Assessment of current UI (IMPLEMENTED)

- Tokenized themes (`midnight` default, cobalt, emerald, amethyst, solar, …) via `data-theme`  
- Floating pill bottom nav; glass/zinc surfaces; Lucide icons  
- Operational colors often hardcoded (emerald/amber/rose/sky) — good for meaning stability  
- Residual density: More still carries collapsed Master Admin; cards used heavily in settings  

### I.2 Destination identity (PROPOSED) — “Floor Command”

**Character:** Calm, precise, handheld-native command center for one operator. Not a SaaS analytics dashboard. Not neon toy. Not newspaper/broadsheet. Not purple-gradient startup kit.

| Element | Direction |
|---------|-----------|
| **Foundation** | Keep CSS-variable theme architecture; default **Midnight Sapphire / Cyber-Dark** lineage refined for contrast on store fluorescent glare |
| **Accent** | One accent for navigation/focus; **operational semantics stay fixed** (verified/attention/blocked) regardless of theme |
| **Type** | Clear hierarchy: aisle codes slightly tabular/mono; names humanist sans already in stack — avoid Inter-as-brand cliché by leaning on existing Geist with deliberate scale steps |
| **Cards** | Prefer open sections + hairline separators; cards only for interactive sheets (bay, person, walkthrough capture) |
| **Motion** | 2–3 purposeful motions: nav pill slide (exists), sheet present, attention row appear — no ambient particle noise |
| **Map** | Aisle list as primary; bay cells as dense but thumb-reachable; section chip subtle |
| **Empty/loading/error** | Skeleton for board; plain language errors; retry; never blank void |

### I.3 Practical design system (implementable)

| Token group | Purpose |
|-------------|---------|
| `--void`, `--surface`, `--surface-2` | Atmosphere layers |
| `--accent` | Focus / nav |
| `--op-ok`, `--op-warn`, `--op-bad`, `--op-info` | Operational meaning (theme-independent) |
| `--touch-min` | 48px targets |
| Density | Compact toggle retained for desktop preference |

Accessibility: contrast themes kept; don’t encode state by color alone (icons + text).

---

## J. Legacy keep / refine / replace / retire / defer

| Module / concept | Disposition | Notes |
|------------------|-------------|-------|
| Deterministic rotation engine | **KEEP** | Preserve physical bay, carry, verify, attempts |
| Bulk Generator | **KEEP / REFINE** | Aisle-first UX; hide foreign depts |
| Map coverage geography | **KEEP / REFINE** | Drop dept nav requirement; aisle→bay |
| Floor This Week board | **REFINE → This Week** | Rename/IA; people-first kept |
| Roster tab | **REPLACE** (into More → Team + Overview) | After Overview ships |
| Floor Pad / Walk & Talk | **REFINE or REPLACE** via FLOORPAD-001 | Protected until review |
| Associate PIN/QR/SMS | **RETIRE** as product requirement | Auth simplify tranche; keep until verified replacement |
| Multi-dept templates / pins | **RETIRE** from active UX | Rows may remain inactive |
| Specialty scans everyday | **RETIRE** (already dormant) | REDUCE-004 |
| Master Admin sprawl | **REFINE** | Advanced only |
| Seasonal context | **KEEP** (protected cadence) | Until successor |
| Operational Sections | **ADD** (APPROVED TARGET) | New domain |
| Overview | **ADD** | Composition only |
| Walkthroughs tab | **ADD** | After storage gate |
| TeamLab / Orient / LLM ops | **DEFER / OUT** | Art. XXV sovereign |
| Interoperability stubs | **DEFER** | Path only |
| Hard-delete topology cleanup | **DEFER** as primary tool | Soft-retire first (TOPO-001) |
| Section-aware engine preference | **DEFER** slightly after section CRUD | Don’t block section capture |

---

## K. Security simplification strategy

### K.1 Preserve (non-negotiable)

ALIGN-SEC fail-closed gate (`HUB_GATE_SECRET`), bootstrap isolation (`BOOTSTRAP_SECRET`), no arbitrary Bearer bypass, no insecure seed PINs, no secret fallback chains. One operator ≠ weaker security.

### K.2 Target auth model (PROPOSED)

```text
OPERATOR authenticates (Master/DS path as designed)
TEAM_MEMBER rows never require login
Associate chrome / QR pair / invite SMS → removed from product surface after dependency purge
```

### K.3 Simplest safe path

1. Keep current auth **unchanged** while Overview/Map/This Week/Walkthroughs land (operator already authenticates).  
2. Inventory associate-only routes and gates (read-only tranche).  
3. Auth-simplify tranche: disable associate login paths; leave roster records; verify no break of Sunday assign-by-roster-id.  
4. Independently verify; then remove dead chrome.

Do not reintroduce defaults, bypasses, or dual secret fallbacks during redesign.

---

## L. Implementation roadmap

Principles: visible progress; core integrity first; no excessive pre-audits; SQL inventory only when a tranche decision truly depends on live shape (topology cutover does; Overview composition does not).

| Tranche | Scope | Depends on | Acceptance | Tests | Rollback | Auth boundary |
|---------|-------|------------|------------|-------|----------|---------------|
| **RD-0** | Operator approves this blueprint | — | Written GO | — | — | Design only |
| **RD-1 IA Shell** | Nav labels/routes: Overview · Map · This Week · Walkthroughs · More; Overview v1 from existing evidence composers | RD-0 | Five tabs; Overview answers week/attention/people without new schema | Contract tests for nav + composers | Revert nav feature flag | No auth change |
| **RD-2 Map Aisle-First** | Aisle→bay primary; hide dept switcher; active-only default; setup entry to bulk | RD-1 | Operator navigates without dept pin | Map presentation tests | Flag revert | No auth change |
| **RD-3 Topology reconcile** | TOPO hybrid: soft-retire foreign; additive Home Decor; bulk rebuild; shared capacity guard | RD-0 decisions + optional SQL inventory | Active Map = operator geography; no double×3 | Engine capacity tests | Soft-retire reverse / dept inactive | No destructive purge |
| **RD-4 Sections CRUD** | Section entity + Map/More UI; permanent owner; no engine preference yet | RD-2/3 | Create/assign/retire; ≤1 section/bay | Domain tests | Retire sections | No auth change |
| **RD-5 Walkthroughs** | FLOORPAD-001 storage decision → Walkthroughs UI + Overview follow-ups | RD-1 + FLOORPAD-001 | Capture → follow-up → close; no scoring | API + UI contracts | Feature flag off | No auth change |
| **RD-6 Engine section preference** | Selection SHOULD prefer section focus | RD-4 | Deterministic tests for preference without dropping carry/priority laws | Engine suite | Flag off | No auth change |
| **RD-7 Capacity UI** | Operator `bays_per_person` | RD-3 guard | Change 3→N safely | Unit + manual | Default 3 | No auth change |
| **RD-8 Team in More** | Move Roster; polish schedules/call-out | RD-1 | No primary Roster tab | Nav contracts | Restore tab | No auth change |
| **RD-9 Auth simplify** | Operator-only login; retire associate paths | RD-8 + dependency inventory | Only operator authenticates; assignments still work | Auth + assign tests | Re-enable paths | **Separate GO** |
| **RD-10 Visual polish** | Floor Command design system pass | RD-1+ | Consistent tokens, empty/loading, a11y spot-check | Visual smoke | Theme revert | No auth change |

**Avoid:** big-bang rewrite; parallel note systems before FLOORPAD-001; engine rewrite before section data exists.

---

## M. Acceptance criteria (finished destination)

The redesign is accepted when the operator can:

1. Land on **Overview** and know week status, attention, and people without hunting.  
2. Navigate **Map** by aisle→bay, rebuild topology via bulk, soft-retire obsolete places.  
3. Run **This Week** for four people at three bays each without departmental double-counting.  
4. Create **Sections** with permanent owners; help across sections without silent ownership transfer.  
5. Run a **Walkthrough**, capture agreements, and close follow-ups without scoring UX.  
6. Manage team, capacity, and config in **More** without Master Admin archaeology.  
7. Authenticate alone; team members remain records.  
8. Rely on deterministic evidence; no LLM orchestration for operational decisions.  
9. Use comfortably one-handed on phone and fully on desktop.  
10. Preserve historical operational evidence and fail-closed security posture.

---

## N. Genuine unresolved decisions

1. **Home Decor code + aisle/bay ownership map** (TOPO-001 §L) — needed before RD-3 cutover.  
2. **FLOORPAD-001:** reuse Floor Pad storage vs new walkthrough tables.  
3. **Overview route strategy:** new `/overview` vs rename `/dashboard`.  
4. **Default capacity pool:** confirm shared cross-dept pool (blueprint default) vs explicit dual pools.  
5. **Operator as Home Decor weekly assignee** — always / sometimes / never in auto-assign.  
6. **Voice interpretation** in walkthroughs — keep as optional confirm-only after FLOORPAD-001, or text/chips only.  
7. **When to drop Roster primary tab** — with RD-1 or after RD-8.  
8. **Production topology inventory** — run when authorizing RD-3; not a gate for RD-1.

---

## O. Risks and dependencies

| Risk | Mitigation |
|------|------------|
| Dual-dept doubles Sunday volume | Shared capacity guard in RD-3 before enabling second active dept auto-stage |
| Hard-delete erases history | Soft-retire primary; TOPO-001 matrix |
| Parallel notes / Floor Pad conflict | FLOORPAD-001 before Walkthrough persistence |
| IA rename breaks muscle memory | Transitional labels; short field guide |
| Auth simplify breaks assign-by-roster | Dependency inventory; assign tests before disable |
| Section engine preference starves unsectioned | Unsectioned remain eligible; preference not exclusion |
| Scope creep into SaaS | Constitution Art. I / II; this blueprint’s non-goals |
| Visual rewrite churn | Token refine, not new framework |

**Dependencies:** Constitution; ALIGN-002; TOPO-001; REDUCE-002A; ENGINE-PROD-002…004; BAY-UNIT-002; UX-REDUCE-002…005; ALIGN-SEC posture.

---

## P. Evidence references (repository)

| Area | Paths |
|------|-------|
| Constitution / state | `DEPTSYNC_CONSTITUTION.md`, `DEPT_SYNC_STATE.md`, `ARCHITECTURE.md`, `MASTER_ROADMAP.md` |
| ALIGN | `docs/product/DEPTSYNC_ALIGN_002_CONSTITUTIONAL_RATIFICATION.md` (ALIGN-001 ratified therein; no standalone ALIGN-001 file) |
| Topology design | `docs/product/DEPTSYNC_ALIGN_TOPO_001_TWO_DEPARTMENT_TOPOLOGY_RECONCILIATION.md` |
| Nav | `lib/nav-hub.ts`, `components/hub/BottomNav.tsx` |
| Map / topology UI | `components/hub/tabs/MapTab.tsx`, `components/admin/StoreLocationGrid.tsx`, `components/admin/BulkLocationGenerator.tsx`, `components/admin/AisleBayManager.tsx` |
| Engine | `lib/store-ops/rotations.ts`, `sunday-dispatch.ts`, `weekly-rotations.ts`, `physical-bay.ts`, `week.ts` |
| Floor / week UX | Floor ownership composers under `lib/store-ops/*`, dashboard tab |
| Auth / security | `lib/auth-gate.ts`, `proxy.ts`, `docs/product/DEPTSYNC_ALIGN_SEC_001_*.md` |
| Floor Pad protection | `docs/product/DEPTSYNC_REDUCE_002A_FLOOR_PAD_PROTECTION.md` |
| Themes | `lib/theme.ts`, `app/globals.css` |
| Departments | `lib/store-ops/stores.ts`, `lib/store-ops/department-codes.ts`, `lib/types.ts` `DEPARTMENT_META` |

---

## Appendix — Destination one-pager

```text
DeptSync — personal Flooring + Home Decor command center
One operator · four-person team records · five surfaces

Overview     → what needs me
Map          → aisles → bays (sections overlay)
This Week    → 4 × 3 shared capacity · plan → assign → perform → verify
Walkthroughs → observe · agree · follow up (no scoring)
More         → team · sections · topology · capacity · settings

Deterministic evidence. Human authority. Soft-retire history.
Security fail-closed. No LLM operations. No SaaS sprawl.
```

---

*End of DEPTSYNC-REDESIGN-001. Stop for operator review.*
