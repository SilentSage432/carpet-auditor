# DeptSync Constitution

**Status:** Canonical governing law  
**Established:** 2026-09-04  
**Baseline:** `main` @ `d6d580617a0b8f78abe48c888613a6d8b6b527e8`  
**Scope:** Product purpose, authority boundaries, and architectural invariants for DeptSync (`carpet-auditor`)

**Amendment:** **ALIGN-002 — Constitutional Ratification** (2026-10-10).  
Ratifies the product identity and architectural direction approved from DEPTSYNC-ALIGN-001.  
Does **not** authorize application code, schema, UI, auth, or production changes.

This document is not a README, roadmap, feature inventory, changelog, or subsystem manual.  
It answers: *Does this proposed change belong in DeptSync, and does it preserve the system’s architectural laws?*

When lower-level documentation conflicts with this Constitution, flag the conflict.  
When implementation conflicts with this Constitution, record **constitutional debt** — do not silently weaken the law to match imperfect code.

> **Historical note (superseded identity):** Prior to ALIGN-002, Article I described DeptSync as broader store-operations / multi-role floor technology. That language remains historical context in journals and pre-ALIGN product docs. Current law is this file as amended.

---

## Normative language

| Term | Meaning |
|------|---------|
| **MUST** | Mandatory. Violation is unconstitutional without amendment. |
| **MUST NOT** | Prohibited. |
| **SHOULD** | Strong default. Deviation requires stated operational evidence. |
| **MAY** | Permitted; not required. |

---

## Article I — Preamble (Why DeptSync Exists)

DeptSync is a **sovereign personal operational intelligence system** for one Department Supervisor responsible for **Flooring** and **Home Decor**.

It exists to reduce operational and administrative friction while supporting departmental awareness, continuous maintenance, collaborative leadership, and historical continuity.

**Operating doctrine:** Small, bounded, recurring work can create continuous department readiness without turning ordinary maintenance into an overwhelming project.

DeptSync converts management intent into sustainable, trackable, verifiable operational coverage — supporting year-round readiness rather than frantic pre-inventory cleanup.

**Canonical character:**

- ONE authenticated application **operator**
- Associates and specialists are **operational team members**, not application users
- Deterministic domain intelligence remains independently functional
- Not a SaaS product, multi-supervisor platform, employee-facing application, employee performance scoring system, enterprise-system replacement, or AI-dependent operational engine

---

## Article II — Canonical Operating Boundary

> **DeptSync manages the rotation; Lowe’s manages the task; the operator validates the work.**

### II.1 What DeptSync MAY do

DeptSync MAY:

- select and stage operational coverage (weekly rotations, Sunday assignment planning)
- assist the operator in assigning coverage to workforce context
- maintain workforce planning context (roster, schedules, availability, call-out redistribution)
- track coverage debt, carry-over, and cycle history
- record barriers and exceptions
- preserve operational history
- support physical verification by the authenticated operator
- calculate operational health and other **derived** measures from recorded state
- define and maintain Operational Sections over physical topology
- record permanent section ownership distinct from weekly rotational assignment
- support collaborative walkthrough records (observations, priorities, follow-ups)
- expose a future bounded interoperability surface without relocating domain authority
- provide department-specific tools only when they serve the active Flooring / Home Decor operating scope (specialty expansion is not a standing mandate)

### II.2 What DeptSync need not own

DeptSync MUST NOT treat the following as core product responsibilities merely for architectural completeness:

- replacing Lowe’s Zebra workflow
- replacing Lowe’s task dashboard
- becoming an associate surveillance system
- becoming the system of record for every action performed inside Lowe’s
- becoming a multi-tenant SaaS or multi-supervisor platform

**No-Zebra integration** is currently intentional (product boundary). Future authorized integration MAY be considered if it serves the operating doctrine — that is a product decision, not an eternal prohibition. The **boundary of responsibility** above remains constitutional regardless of integration choices.

---

## Article II-A — Active Department Scope

The product’s **active** operating departments are:

1. **Flooring**
2. **Home Decor**

They MUST eventually exist as separate first-class operational departments.

The internal department abstraction MUST remain for topology and the rotational engine. Domain logic MUST NOT hardcode department display names as the sole identity mechanism.

Other department rows, codes, and historical data MAY remain in storage. They SHOULD be excluded from active application workflows.

Historical data MUST NOT be deleted without an explicit, separately reviewed migration plan.

> **Implemented reality (ALIGN-002):** Flooring and Home Decor are currently represented as one merged department (`code = flooring`, display “Flooring / Home Decor”). Separation is **approved target architecture**. Migration strategy is **UNRESOLVED** and MUST NOT be assumed without topology analysis and operator-provided mapping evidence. See `DEPT_SYNC_STATE.md` and `docs/product/DEPTSYNC_ALIGN_002_CONSTITUTIONAL_RATIFICATION.md`.

---

## Article III — Human Authority

### III.1 Conceptual roles

| Conceptual role | Intent |
|-----------------|--------|
| **OPERATOR** | Sole authenticated application user; Department Supervisor for Flooring and Home Decor; full operational and administrative authority within the product |
| **TEAM_MEMBER** | Operational workforce representation (e.g. Flooring Specialist, CSA); may receive section ownership and weekly rotational assignment; MUST NOT require application access |

**Approved operational team (target staffing model):**

| Department | Members |
|------------|---------|
| Flooring | Two Flooring Specialists |
| Home Decor | Department Supervisor (operator) + one CSA |

### III.2 Transitional implementation (descriptive debt)

Current hub labels (MasterAdmin, Supervisor, Associate chrome, PIN/QR pair, invite SMS) MAY persist until a separately authorized auth-simplification tranche removes dependencies safely. They MUST NOT be treated as product requirements of the single-operator identity.

### III.3 Authority rules

1. The **OPERATOR** is the sole application authority. Authentication MUST remain fail-closed (Article XVIII).
2. **TEAM_MEMBER** records preserve stable identifiers and operational history.
3. Workforce representation does not imply application access.
4. Temporary coverage or assistance MUST NOT silently alter permanent section ownership (Article III-A).
5. Expanding additional application users requires constitutional amendment and Article XXI evidence — not convenience.

> **Workforce representation does not imply application access.**

> **Application authority and workforce participation are distinct concepts even where current storage models share records.**

---

## Article III-A — Cross Ownership and Respect

Permanent section ownership assigns **stewardship**, not exclusive labor.

Everyone on the operational team shares responsibility for maintaining departmental standards.

DeptSync MUST distinguish:

- permanent section ownership
- weekly rotational assignment
- temporary coverage
- actual work performed

These MUST NOT be collapsed into a single relationship.

Temporary assistance MUST NOT silently transfer permanent ownership.  
Meaningful operational changes MAY be recorded without requiring trivial activity logging.

DeptSync MUST NOT become an employee scoring, leaderboard, or automatic performance-judgment system (see also Article XIX).

---

## Article IV — Absence Resilience

> **The system SHOULD preserve operating intent as institutional memory the operator can resume.**

For the single-operator product, absence resilience means: configured topology, sections, staged rotations, assignment history, barriers, verification state, and walkthrough continuity persist so the OPERATOR can resume without reconstructing institutional memory — not that multiple supervisors are a product requirement.

This is **not** autonomous management. Human judgment and physical verification remain required (Articles VIII–IX).

---

## Article V — Rotation Law

### V.1 Conceptual truths

1. **Assignment is planned work** — staging and Sunday assignment express intent for coverage.
2. **Incomplete work remains coverage debt** — uncompleted staged work MUST NOT disappear from operational truth.
3. **Completion SHOULD advance physical coverage** — closing verified work advances location/cycle state according to defined rules.
4. **Verified completion is stronger evidence than assignment or self-reported completion.**
5. **Broad coverage matters** over repeatedly servicing only convenient locations.
6. **Cycle history MUST preserve** what has and has not been touched.
7. **Barriers MUST NOT silently disappear** from operational truth.
8. **Workload SHOULD remain sustainable** relative to available capacity and compatible with Flooring Specialists’ sales responsibilities.

### V.2 Capacity

> **Capacity is an operating constraint, not a universal fixed quota.**

> **The rotation SHOULD seek sustainable coverage without hiding uncompleted work.**

The historical **three-bay weekly baseline** remains the **initial default**. Weekly capacity MUST eventually be configurable by the OPERATOR.

Department weekly targets, hours-based proportional assignment, and similar controls are **configuration / operating** decisions. They MUST NOT be constitutionalized as fixed universal quotas.

DeptSync MUST NOT automatically multiply rotational workload across departments solely from headcount (e.g. four people × three bays is not a constitutional departmental volume).

### V.3 Section-focused rotation (approved target behavior)

The deterministic rotation engine MUST remain independently functional.

Preserve: physical bay identity, priority selection, coverage history, carry-over, Sunday staging, completion attempts, verification evidence, and operational exceptions.

Weekly selection SHOULD prefer focused rotational work within assigned Operational Sections when sections exist, without discarding the preserved engine properties above.

**No engine changes are authorized by ALIGN-002 documentation alone.**

---

## Article V-A — Operational Section Law

An **Operational Section** is a named collection of existing physical locations within **one** department.

A section MAY contain complete aisles, partial aisles, bay ranges, or non-contiguous locations when necessary.

The physical topology (`store_locations` / physical bay identity) remains authoritative. Sections **overlay** topology; they MUST NOT duplicate or replace it.

A physical bay MAY belong to **no more than one** active operational section at a time.

Bays not assigned to any section MUST remain visible and eligible for explicit operational attention.

Each section has a continuously assigned responsible owner (TEAM_MEMBER or OPERATOR). Ownership is independent of weekly rotational assignments.

The OPERATOR MUST eventually be able to create, name, bound, assign, reassign, inspect coverage of, and historically preserve section ownership — and to edit team membership and operational configuration.

Historical ownership changes SHOULD be preservable as evidence.

---

## Article V-B — Collaborative Walkthrough Law

DeptSync MUST support recurring collaborative walkthroughs as **leadership conversations**, not inspections or employee evaluations.

A walkthrough record SHOULD preserve: date, department, section (when known), participants, positive observations, improvement opportunities, agreed priorities, follow-up actions, and historical continuity.

The experience MUST remain lightweight. DeptSync MUST NOT require excessive documentation or introduce employee scoring, rankings, or surveillance through walkthroughs.

**Target architecture:** use a dedicated walkthrough domain model where necessary; reuse existing Floor Pad capabilities where practical.

**Storage gate:** new walkthrough storage MUST NOT be introduced until existing `manager_notes` and `shift_walk_tasks` dependencies have been reviewed (Article XX). FLOORPAD-001 remains the gate before Floor Pad retirement or redesign.

---

## Article VI — Completion and Verification Law

### VI.1 State classes (normative)

| Class | Meaning |
|-------|---------|
| **ASSIGNED / staged** | Planned coverage for a period (intent). |
| **COMPLETED / reported complete** | Work reported done (`is_completed` / associate or actor submit). |
| **VERIFIED** | Authorized operator closed review (`VERIFIED_COMPLETE` or equivalent). |
| **BLOCKED / BARRIER** | Explicit exception preventing or documenting inability to complete. |

Current week-item review terms include: `PENDING` → `PENDING_VERIFICATION` → `VERIFIED_COMPLETE` on `weekly_rotations`, with location `COMPLETED` reserved for verified closure when the two-stage path is active.

### VI.2 Laws

> **Assignment is intent, not evidence of completion.**

> **Reported completion is not equivalent to physical verification.**

> **Physical verification is the strongest DeptSync evidence that scheduled operational work was actually completed.**

> **Unverified work MUST NOT silently advance authoritative readiness as though it were verified.**

The OPERATOR who personally completes a bay MAY be treated as verifying in the same act (human verifier present). Automated or predicted “verification” MUST NOT substitute for that authority (Articles XII–XIII).

**Constitutional debt** related to derived completion metrics treating reported-complete as verified is recorded in Appendix A — do not “fix” wording here to pretend metrics already distinguish perfectly.

---

## Article VII — Data Authority Law

### VII.1 Authoritative operational state

Facts recorded about the store world and intentional operations. Examples:

- stores, departments, locations (topology)
- operational sections and section ownership (when implemented)
- assignments and weekly rotations
- completion and verification records
- barriers / exceptions
- workforce / roster records
- collaborative walkthrough records (when implemented)
- configured targets and schedules
- specialty audit records retained as historical / dormant evidence

Authoritative state MUST be written through authorized actors and defined persistence paths.

### VII.2 Derived state

Mathematical transformations of authoritative state. Examples: percentages, age since service, completion rate, stale counts, coverage debt, capacity calculations, variance.

> **Derived values MUST be reproducible from identified inputs and defined rules.**

Presentation MUST NOT invent a second competing formula for the same named measure when a canonical derivation owner exists.

### VII.3 Intelligence outputs

Interpretations, patterns, predictions, scores, priorities, and recommendations.

These are **not** authoritative operational facts.

> **Intelligence MAY interpret evidence, but it MUST NOT manufacture evidence.**

> **Prediction is never authoritative state.**

> **A recommendation MAY influence a human decision; it MUST NOT silently mutate operational truth.**

---

## Article VIII — Provenance Law

> **Operational intelligence MUST be traceable to the evidence and method that produced it.**

Every meaningful derived or intelligent output SHOULD retain enough structure for explanation and audit (inputs, method, scope, time).

UI surfaces NEED NOT dump formulas on every screen. Hidden, unrecoverable scoring is unconstitutional for material operational claims (e.g. “Coverage risk: HIGH” without recoverable basis).

Illustrative provenance inputs for coverage risk might include: eligible locations, verified completion cadence, coverage debt, weekly target, available capacity, carry-over, barriers.

---

## Article IX — Intelligence Architecture

Canonical conceptual stack (layers may be thin or absent in a given release; order of authority MUST NOT invert):

```text
AUTHORITATIVE OPERATIONAL STATE
        ↓
DETERMINISTIC DERIVATION
        ↓
PATTERN / TEMPORAL SIGNALS
        ↓
FORECAST INTELLIGENCE
        ↓
DECISION INTELLIGENCE
        ↓
OPTIONAL EXPLANATION
        ↓
UI EXPRESSION
```

| Layer | Name | Role |
|-------|------|------|
| 0 | Authoritative Operational State | What was recorded / configured |
| 1 | Deterministic Derivation | Exact calculations (coverage %, age, variance, weekly completion, capacity, stale counts) |
| 2 | Pattern / Temporal Intelligence | Historical structure (recurring carry-over, repeated barriers, imbalance, abnormal deterioration, cadence) |
| 3 | Forecast Intelligence | Future estimates with appropriate uncertainty |
| 4 | Decision Intelligence | Ranked / prioritized recommendations for human action |
| 5 | Optional Explanation | Human-readable explanation of already-produced evidence/intelligence |
| 6 | UI Expression | Present facts/signals/recommendations on the correct operational surface |

Lower layers MUST NOT be overridden by higher layers. Explanation and UI MUST NOT create Layer 0 facts.

The deterministic engine and Layer 0–4 intelligence MUST remain independently functional without any specific AI model (Article XXV).

---

## Article X — Generative AI Law

DeptSync is **not** designed around a chatbot. Conversational AI is **not** an architectural requirement.

> **Generative AI is not an authority layer.**

If generative AI is used, appropriate roles MAY include:

- explaining structured results
- summarizing existing evidence
- translating computed intelligence into useful language
- assisting bounded interpretation where provenance remains visible

Generative AI MUST NOT independently determine:

- whether physical work occurred
- whether verification occurred
- authoritative inventory counts
- authoritative role / access state
- completion state as operational truth
- safety-critical operational truth

Prefer deterministic computation, pattern recognition, forecasting, scoring, and evidence-backed decision support where those methods fit.

Existing Gemini (or successor) call sites that narrate compact packets, parse structured input for human confirmation, or assist visual estimates remain subordinate to this Article.

---

## Article XI — Intelligence Placement Law

> **Intelligence belongs where the decision is made.**

DeptSync MUST NOT create a separate “AI tab” merely because intelligence exists.

Examples of correct placement (target surfaces):

| Signal | Surface |
|--------|---------|
| Department condition / outstanding issues | Overview |
| Section boundaries / ownership / priority aisle·bay | Map |
| Focused rotational work / verification lag | This Week |
| Collaborative observations / follow-ups | Walkthroughs |
| Workload / capacity risk | This Week / More (team) |
| Configuration / security | More |

Intelligence SHOULD augment Articles XV–XVII rather than invent an unrelated experience.

---

## Article XII — Specialty Module Law

DeptSync supports shared operational foundations plus department-specific tools **within the active Flooring / Home Decor scope**.

> **A department-specific workflow SHOULD extend the shared operational model rather than force every department into an identical interaction.**

> **Specialty modules MAY differ in workflow while preserving common authority, provenance, verification, and store/department boundaries.**

Historical specialty surfaces (appliances continuous scan, generic multi-department audit, etc.) are **illustrative legacy**, not a mandate to restore multi-department SaaS scope. REDUCE-era dormancy remains compatible with this Article when it serves Article II-A.

---

## Article XIII — Store and Department Scope Law

> **Client-supplied scope MUST never outrank authenticated authority.**

Store and department scope for mutations and privileged reads MUST be actor-bound (authenticated identity / profiles / JWT claims and server resolution). Client headers, local pins, or UI filters MUST NOT expand authority.

- The **OPERATOR** holds application authority for the product’s active departments.
- Working-department pins and chrome filters are **views**, not grants of new authority.
- Transitional multi-role labels (Master / Supervisor / Associate) MUST NOT expand authority beyond authenticated actor resolution.

This Article does not redesign RBAC in ALIGN-002; it constrains how scope may be trusted.

---

## Article XIV — Local-First / Offline Law

DeptSync intentionally supports floor operation under imperfect connectivity.

### XIV.1 Architectural intent (constitutional)

1. Temporary connectivity loss SHOULD NOT unnecessarily stop floor work that the product has committed to support offline.
2. Queued writes MUST retain identity and provenance sufficient for authorized replay.
3. Reconnection MUST NOT silently transform unauthenticated local assumptions into authoritative cloud truth.
4. Server / cloud authority remains relevant for **shared** operational state.

### XIV.2 Current limitations (not promises)

As of the baseline, Store Ops list caches (IndexedDB) are **read caches**, not write authority. Sync-queue domains (audits, catalogs, remnants, some Store Ops mutations) differ from online-only supervisor workflows (e.g. some shift tasks, schedules, manager notes, topology CRUD). Conflict handling is primarily last-write / explicit local-vs-server choice — not a full multi-device CRDT.

The Constitution MUST NOT promise conflict semantics the system does not guarantee. Gaps belong in state docs and Appendix A when they violate intent.

---

## Article XV — UI / Information Hierarchy Law

Operational surfaces SHOULD answer, in order:

1. **WHAT IS HAPPENING?**
2. **WHAT NEEDS MY ATTENTION?**
3. **WHAT SHOULD I DO NEXT?**
4. **WHAT TOOLS DO I NEED?**

> **Operational information first. Configuration second. Diagnostics last.**

### Surface levels

| Level | Role |
|-------|------|
| **Level 1** | Operational headline (readiness, week status, attention) |
| **Level 2** | Work objects (bays, assignments, map cells, team rows, walkthroughs) |
| **Level 3** | Utilities / configuration / diagnostics |

Configuration MUST NOT visually compete with daily execution on primary operate surfaces. Intelligence SHOULD augment these levels (Article XI).

### Target operator experience (ALIGN-002)

Conceptual primary areas (not mandatory route names):

| Area | Job |
|------|-----|
| **Overview** | Department conditions, priorities, outstanding issues — **intended landing experience** |
| **Map** | Physical topology, bulk aisle/bay creation, section configuration, ownership visibility |
| **This Week** | Rotational work, completion, carry-over, availability |
| **Walkthroughs** | Collaborative observations, follow-up continuity |
| **More** | Team roster, configuration, security, advanced tools |

**ALIGN-002 does not authorize new routes or UI components.** Historical Floor · Map · Roster · More remains valid transitional chrome until an authorized IA tranche lands.

### Map coverage geography law (UX-REDUCE-003)

> **Map represents coverage geography, not topology implementation.**

The operator thinks in department / aisle / physical bay — not raw `store_locations` rows, SELLING/TOPSTOCK record counts, or topology tags. Sibling SELLING and TOPSTOCK surfaces MAY appear as secondary detail under one physical bay; they MUST NOT present as two independent coverage obligations on everyday Map.

Everyday Map identity is department coverage geography. Service/velocity evidence MAY remain as secondary advanced disclosure; it MUST NOT compete as an equal peer Map identity. Ordinary owed / remaining coverage is normal continuous-coverage state, not failure. Exceptional attention (barrier / truthful investigation) SHOULD be louder than healthy remaining.

Manual coverage priority (PRIORITY-UX-002) MAY appear on Map as a narrow operational declaration (Standard / High) on existing physical bays. That capability MUST NOT be implemented by enabling generic topology mutation (`canMutate=true`). High MUST increase selection pressure among currently owed/eligible coverage and MUST NOT independently re-admit completed coverage into the active cycle.

Call-out and absence evidence MUST NOT write `priority_override`. Existing High remains High; Standard remains Standard. Unresolved coverage remains owed through weekly ownership and carryover — not by manufacturing manual High.

This Week answers who has what this week. Map answers where coverage stands across the department — and, when implemented, where sections and ownership sit.

### Team participation law (evolved from UX-REDUCE-004)

> **Team roster represents operational participation and schedule evidence, not employment administration or application-user management.**

Capability is not availability. Schedule says when someone is expected; current time determines whether now falls inside the schedule interval; call-out/absence evidence overrides expected availability. DeptSync MUST NOT pretend it has Lowe’s actual punch data.

Transitional `accessible_departments` app-authority chips are implementation debt under single-operator identity — not proof of secondary workforce capability (do not invent WORKFORCE-SCOPE-001 policy in presentation).

---

## Article XVI — Mobile-First Law

DeptSync is intended as serious floor technology on personal phones.

> **Persistent application chrome MUST never make operational work unreachable.**

Conceptual shell contract:

```text
persistent header
scrollable work surface
persistent bottom navigation
```

Exact CSS is implementation. Reachability, one-handed usability, and appropriate density are constitutional concerns. The work surface MUST be the scroll owner for primary operational content; fixed chrome MUST clear touch targets.

Primary elevated chrome (conceptual target): **Overview · Map · This Week · Walkthroughs · More**.  
Transitional chrome (**Floor · Map · Roster · More**) MAY persist until an authorized IA tranche. Route implementation MAY differ from labels.

### Handheld personalization law (HANDHELD-UX-002)

> **Personalization may change how DeptSync feels. It may not change what DeptSync means.**

> **Theme changes personality. Semantic state preserves meaning.**

Appearance, density, contrast, sound, and haptics MAY change device-local feel. They MUST NOT change operational meaning. Theme accent MAY own navigation, selection, primary actions, decorative glow, and focus personality. Theme accent MUST NOT own Covered, This week, Needs attention, Remaining, High priority, Seasonal, Called out, On now, destructive, success, warning, failure, or offline/sync state. Visual personalization MUST NOT regress operational P0 render.

---

## Article XVII — Configuration vs Operation Law

> **Low-frequency configuration MUST NOT compete visually with high-frequency operational work.**

Illustrative (not eternal route law):

| Operate | Configure / administer / diagnose |
|---------|-----------------------------------|
| Overview / Map / This Week / Walkthroughs | More / management surfaces |

Tools may move between surfaces when hierarchy improves; the principle remains.

---

## Article XVIII — Security Law

Principles (not an implementation guide):

1. Authentication MUST fail closed.
2. Secrets MUST NOT ship with unsafe production defaults.
3. Actor authority outranks client assertions (Article XIII).
4. Store and department boundaries MUST be enforced for user-driven access.
5. Privileged service-role database access MUST NOT bypass actor authorization for user-driven mutations.
6. Public internet reachability requires production-safe credentials and configuration.

> **One operator does not justify weaker security.**

ALIGN-001 security findings (gate-secret fallbacks, permissive API Bearer edge pass, seed credentials, unverified production RLS state) are **priority implementation debt**. Remediation requires a separately authorized security tranche. ALIGN-002 MUST NOT modify authentication infrastructure, access production secrets, or change production configuration.

---

## Article XIX — Observability Without Surveillance

DeptSync needs accountability and historical operational evidence.

> **Measure work outcomes and operational state, not unnecessary human activity.**

Appropriate evidence includes: assignment, completion, verification, barrier, coverage cadence, workload/capacity, section ownership history, walkthrough follow-ups.

DeptSync MUST NOT become minute-by-minute worker surveillance. Telemetry MUST earn its place through operational need (Article XX).

---

## Article XX — Simplicity / Non-Drift Law

> **Architecture MUST earn its complexity through a demonstrated operational need.**

> **Do not introduce infrastructure, abstractions, intelligence layers, roles, workflows, or integrations solely because they are architecturally fashionable.**

> **Existing simple architecture SHOULD NOT be replaced without evidence that it blocks a constitutional requirement.**

Examples of unjustified complexity: orchestrators without need; custom LLMs without need; device-identity systems without a real requirement; splitting workforce/auth schemas solely for conceptual purity during pilot; enterprise observability stacks without an operational need; parallel note systems before reviewing Floor Pad / walk-task storage.

---

## Article XXI — Evidence Requirement for Change

Before significant architectural work, ask:

1. What observed operational problem exists?
2. What evidence demonstrates it?
3. Which constitutional principle requires or permits change?
4. Can the current architecture solve it with a smaller intervention?
5. Does the change create a new authority boundary?
6. Does it alter authoritative data semantics?
7. Does it increase operator burden?
8. How will success be observed?

Failure to answer these is grounds to defer the change.

---

## Article XXII — Constitutional vs Implementation Decisions

| Normally implementation only | May require constitutional review |
|------------------------------|-----------------------------------|
| Button labels, copy polish | Allowing AI to mutate completion/verification state |
| Weekly target default values | Removing physical verification as authority |
| Moving a tool within More | Making associates mandatory app users |
| Scoring coefficients / forecast tuning | Replacing operator judgment with autonomous assignment |
| Internal library replacements | Changing store/department authority boundaries |
| | Treating predicted state as observed state |
| | Making Lowe’s task workflow a core DeptSync responsibility |
| | Collapsing permanent ownership into weekly assignment |
| | Weakening authentication because there is one operator |

---

## Article XXIII — Amendment Process

Keep intentional, not bureaucratic:

1. Identify conflict or new requirement.
2. Gather repository and field evidence.
3. State the law being changed.
4. Explain why existing law no longer serves product purpose.
5. Amend this Constitution deliberately (version note + date).
6. Update dependent architecture / state docs afterward.

The goal is intentional evolution, not immutability.

---

## Article XXIV — Relationship to Other Documents

Document authority order:

```text
DEPTSYNC_CONSTITUTION.md          ← governing laws (this file)
        ↓
DEPT_SYNC_STATE.md                ← current implementation truth (+ target intent blocks)
        ↓
ARCHITECTURE.md / APP_LAYOUT_MAP.md / subsystem docs
        ↓
MASTER_ROADMAP.md                 ← intended future work
        ↓
DEVELOPMENT_JOURNAL.md / CHAT_HANDOFF.md  ← historical / session memory
```

| Document | Owns |
|----------|------|
| Constitution | Laws, authority, anti-drift tests |
| DEPT_SYNC_STATE | What is true in the running system now; clearly labeled target intent |
| Architecture / layout docs | Module ownership and UI mechanics |
| Roadmap | Planned work |
| Journal / handoff | History and session continuity |
| `docs/product/DEPTSYNC_ALIGN_002_*` | ALIGN-002 ratification record and topology investigation |

Lower docs MUST NOT silently override this Constitution. Implementation gaps → Appendix A.

---

## Article XXV — Sovereign Intelligence and Interoperability

DeptSync owns its operational truth.

Domain intelligence MUST remain independently functional without:

- Orient
- TeamLab Studio
- a personal assistant
- any specific LLM
- external orchestration

Future systems MAY access **authorized** capabilities. They MUST NOT duplicate or override DeptSync’s domain authority.

A future path MAY include capability discovery, authenticated access, provenance, and bounded actions. **No integrations are authorized by ALIGN-002.**

---

## Appendix A — Constitutional Debt

Known gaps where current reality only partially fulfills a law. **Do not “fix” by weakening the Constitution.** Population is evidence-backed only.

### A-1 — Derived weekly completion vs verification

| Field | Value |
|-------|--------|
| **LAW** | Art. VI — Unverified work MUST NOT silently advance authoritative readiness as though verified. |
| **CURRENT REALITY** | Associate completion sets `is_completed` + `PENDING_VERIFICATION` without closing location to `COMPLETED`. Store health and Floor “complete” counts largely key off `is_completed`, so reported-complete advances completion % / week-complete headlines before `VERIFIED_COMPLETE`. |
| **RISK** | Operators may read pace/readiness as physically closed when review is still open. |
| **STATUS** | Open — presentation/derivation debt; two-stage review path exists. |

### A-2 — Offline authority is partial

| Field | Value |
|-------|--------|
| **LAW** | Art. XIV — temporary connectivity loss SHOULD NOT unnecessarily stop committed floor work; reconnection MUST NOT elevate unauthenticated local assumptions. |
| **CURRENT REALITY** | Audits and selected Store Ops mutations queue; many supervisor workflows remain online-only; IndexedDB is read cache; multi-device merge is limited. Queue replay still depends on live auth for Store Ops completes. |
| **RISK** | Uneven floor resilience; operators may assume full offline parity. |
| **STATUS** | Open — intentional phased matrix; document in state, do not over-promise. |

### A-3 — Dual roster / auth storage vs single-operator identity

| Field | Value |
|-------|--------|
| **LAW** | Art. III — OPERATOR is sole app user; TEAM_MEMBER does not require app access. |
| **CURRENT REALITY** | Multi-role hub (Master/Supervisor/Associate), PIN/QR pair, invite paths, shared `store_specialists` / `profiles` storage. |
| **RISK** | Contributors may treat associate app access as required product law. |
| **STATUS** | Open ALIGN debt — do not delete auth infrastructure until dependency inventory + security tranche. |

### A-4 — Merged Flooring / Home Decor vs two active departments

| Field | Value |
|-------|--------|
| **LAW** | Art. II-A — Flooring and Home Decor are separate first-class active departments. |
| **CURRENT REALITY** | Single `departments.code = flooring` named “Flooring / Home Decor”; no Home Decor code; topology does not distinguish the two. |
| **RISK** | Silent reassignment or assumed aisle split would corrupt history. |
| **STATUS** | Approved target; **migration UNRESOLVED** — see ALIGN-002 topology investigation. |

### A-5 — Missing Operational Section overlay

| Field | Value |
|-------|--------|
| **LAW** | Art. V-A — Sections overlay topology with exclusive active membership and permanent ownership. |
| **CURRENT REALITY** | No section entity; weekly ownership via `sunday_bay_assignments` + physical bay. |
| **RISK** | Conflating weekly assignment with permanent stewardship. |
| **STATUS** | Approved target; not implemented. |

### A-6 — Walkthrough product job unresolved vs Floor Pad / Walk & Talk

| Field | Value |
|-------|--------|
| **LAW** | Art. V-B — Collaborative walkthroughs; storage reuse review before new tables. |
| **CURRENT REALITY** | `manager_notes` (Floor Pad) and `shift_walk_tasks` (Walk & Talk) exist; FLOORPAD-001 deferred. |
| **RISK** | Parallel note systems or premature Floor Pad deletion. |
| **STATUS** | Approved target; storage review deferred. |

### A-7 — Auth gate secret fallback + permissive API Bearer edge pass

| Field | Value |
|-------|--------|
| **LAW** | Art. XVIII — fail closed; no unsafe production defaults; one operator ≠ weaker security. |
| **CURRENT REALITY** | **ALIGN-SEC-001 remediated in repository code:** `HUB_GATE_SECRET` only; proxy no longer accepts arbitrary Bearer; bootstrap requires `BOOTSTRAP_SECRET`; schema seed demo PINs removed. Production env deployment and live RLS verification remain operator actions (not authorized in ALIGN-SEC-001). |
| **RISK** | Deploy without configuring new required secrets would lock out gate minting; historical demo PINs may remain in live DBs until rotated. |
| **STATUS** | Code remediated — production config + RLS evidence still open. |

---

## Appendix B — Change-test scenarios (adoption checks)

| ID | Proposal | Constitutional guidance |
|----|----------|-------------------------|
| A | Chatbot for “how is the department doing?” | MAY explain Layer 1–4 outputs; MUST NOT become intelligence authority (Arts. IX–X, XXV). |
| B | Auto-verify bays above 95% confidence | MUST NOT — predicted verification is not physical verification (Arts. VI, VII.3, X). |
| C | Every associate must install DeptSync | MUST NOT as product law (Art. III); requires amendment + Art. XXI evidence. |
| D | LLM chooses next week’s bays | MAY advise (Layer 4); MUST NOT silently write authoritative rotation state without human staging rules (Arts. V, VII.3, X). |
| E | Microservices “because we may scale” | Blocked without demonstrated need (Art. XX). |
| F | Default weekly workload 3 → 4 | Implementation / configuration (Arts. V.2, XXII) — not an amendment. |
| G | Restore multi-department SaaS scope | Conflicts with Arts. I / II-A unless amended. |
| H | Forecast “inventory readiness 92%” | MUST distinguish forecast from observed readiness and retain provenance (Arts. VII–VIII, IX Layer 3). |
| I | Temporary help auto-changes section owner | MUST NOT (Art. III-A). |
| J | Orient/TeamLab reimplements rotation selection | MUST NOT override domain authority (Art. XXV). |
| K | Weaken auth because N=1 | MUST NOT (Art. XVIII). |

---

*End of DeptSync Constitution.*
