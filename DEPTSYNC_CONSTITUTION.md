# DeptSync Constitution

**Status:** Canonical governing law  
**Established:** 2026-09-04  
**Baseline:** `main` @ `d6d580617a0b8f78abe48c888613a6d8b6b527e8`  
**Scope:** Product purpose, authority boundaries, and architectural invariants for DeptSync (`carpet-auditor`)

This document is not a README, roadmap, feature inventory, changelog, or subsystem manual.  
It answers: *Does this proposed change belong in DeptSync, and does it preserve the system’s architectural laws?*

When lower-level documentation conflicts with this Constitution, flag the conflict.  
When implementation conflicts with this Constitution, record **constitutional debt** — do not silently weaken the law to match imperfect code.

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

DeptSync began as practical department inventory tooling and evolved into a **Department Supervisor operational system**.

**Operating doctrine:** Small, bounded, recurring work can create continuous department readiness without turning ordinary maintenance into an overwhelming project.

DeptSync exists to convert management intent into sustainable, trackable, verifiable operational coverage — supporting year-round readiness rather than frantic pre-inventory cleanup.

DeptSync is floor technology for store operations. It is not a general-purpose enterprise platform, surveillance product, or chatbot product.

---

## Article II — Canonical Operating Boundary

> **DeptSync manages the rotation; Lowe’s manages the task; the DS validates the work.**

### II.1 What DeptSync MAY do

DeptSync MAY:

- select and stage operational coverage (weekly rotations, Sunday assignment planning)
- assist a Department Supervisor in assigning coverage to workforce context
- maintain workforce planning context (roster, schedules, on-duty, call-out redistribution)
- track coverage debt, carry-over, and cycle history
- record barriers and exceptions
- preserve operational history
- support physical verification by authorized supervisors
- calculate operational health and other **derived** measures from recorded state
- provide specialty department tools that extend the shared operational model

### II.2 What DeptSync need not own

DeptSync MUST NOT treat the following as core product responsibilities merely for architectural completeness:

- replacing Lowe’s Zebra workflow
- replacing Lowe’s task dashboard
- becoming an associate surveillance system
- becoming the system of record for every action performed inside Lowe’s

**No-Zebra integration** is currently intentional (pilot and product boundary). Future authorized integration MAY be considered if it serves the operating doctrine — that is a product decision, not an eternal prohibition. The **boundary of responsibility** above remains constitutional regardless of integration choices.

---

## Article III — Human Authority

### III.1 Conceptual roles

| Conceptual role | Intent |
|-----------------|--------|
| **MASTER_ADMIN** | Store-wide operational and administrative authority |
| **DEPARTMENT_SUPERVISOR** | Authorized department-scope operation and validation |
| **WORKFORCE_MEMBER** | Operational workforce representation; may receive work through Lowe’s normal systems |

### III.2 Mapping to current implementation (descriptive, not redesign)

| Conceptual | Current hub / Store Ops labels (illustrative) |
|------------|-----------------------------------------------|
| MASTER_ADMIN | Hub `MasterAdmin` / Store Ops `super_admin` / view role `MASTER_ADMIN` |
| DEPARTMENT_SUPERVISOR | Hub `Supervisor` / Store Ops `department_supervisor` / view role `DEPARTMENT_SUPERVISOR` |
| WORKFORCE_MEMBER | Roster rows (including roster-only); floor titles such as Specialist / CSA; app-paired associates may use simplified associate chrome |

Implementation storage and role enums MAY evolve. Conceptual authority MUST remain clear.

### III.3 Authority rules

1. **MASTER_ADMIN** MAY enter and operate authorized or all departments, and MAY administer the system. Master MUST NOT be required as the runtime bottleneck for normal department operation.
2. **DEPARTMENT_SUPERVISOR** operates authorized department scope(s): stages/plans work, manages workforce context within scope, validates physical completion, and uses specialty tools appropriate to that department.
3. **WORKFORCE_MEMBER** MAY exist solely as an operational workforce record.

> **Workforce representation does not imply application access.**

> **Application authority and workforce participation are distinct concepts even where current storage models share records.**

Associates are not required to install DeptSync for the rotation model to function. Expanding mandatory app access requires evidence (Article XXIV), not fashion.

---

## Article IV — Absence Resilience

> **The system SHOULD preserve operating intent without making a specific human its runtime dependency.**

Normal department operation MUST NOT require the creator, Master Admin, or a particular supervisor to manually reconstruct the weekly process from scratch when that person is absent.

Configured targets, topology, staged rotations, assignment history, barriers, and verification state SHOULD persist as institutional operating memory.

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
8. **Workload SHOULD remain sustainable** relative to available capacity.

### V.2 Capacity

> **Capacity is an operating constraint, not a universal fixed quota.**

> **The rotation SHOULD seek sustainable coverage without hiding uncompleted work.**

Department weekly targets, hours-based proportional assignment, and similar controls are **configuration / operating** decisions. They MUST NOT be constitutionalized as fixed universal quotas (e.g. “3 bays per associate per week” is a useful historical baseline hypothesis, not law).

---

## Article VI — Completion and Verification Law

### VI.1 State classes (normative)

| Class | Meaning |
|-------|---------|
| **ASSIGNED / staged** | Planned coverage for a period (intent). |
| **COMPLETED / reported complete** | Work reported done (`is_completed` / associate or actor submit). |
| **VERIFIED** | Authorized supervisor closed review (`VERIFIED_COMPLETE` or equivalent). |
| **BLOCKED / BARRIER** | Explicit exception preventing or documenting inability to complete. |

Current week-item review terms include: `PENDING` → `PENDING_VERIFICATION` → `VERIFIED_COMPLETE` on `weekly_rotations`, with location `COMPLETED` reserved for verified closure when the two-stage path is active.

### VI.2 Laws

> **Assignment is intent, not evidence of completion.**

> **Reported completion is not equivalent to physical verification.**

> **Physical verification is the strongest DeptSync evidence that scheduled operational work was actually completed.**

> **Unverified work MUST NOT silently advance authoritative readiness as though it were verified.**

DS/Master actors who themselves complete a bay MAY be treated as verifying in the same act (human verifier present). Automated or predicted “verification” MUST NOT substitute for that authority (Articles XII–XIII).

**Constitutional debt** related to derived completion metrics treating reported-complete as verified is recorded in Appendix A — do not “fix” wording here to pretend metrics already distinguish perfectly.

---

## Article VII — Data Authority Law

### VII.1 Authoritative operational state

Facts recorded about the store world and intentional operations. Examples:

- stores, departments, locations (topology)
- assignments and weekly rotations
- completion and verification records
- barriers / exceptions
- workforce / roster records
- configured targets and schedules
- specialty audit records (flooring audits, appliance scans, remnants, etc.)

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

Examples of correct placement:

| Signal | Surface |
|--------|---------|
| Coverage / verification lag | Floor |
| Priority aisle / bay context | Map |
| Workload / capacity risk | Roster / Sunday planning |
| Appliance anomaly | Appliances specialty |
| Inventory variance | Relevant specialty tool |
| Store-wide risk | Future Master health surface (when justified) |

Intelligence SHOULD augment Articles XVI–XVIII rather than invent an unrelated experience.

---

## Article XII — Specialty Module Law

DeptSync supports shared operational foundations plus department-specific specialty tools.

> **A department-specific workflow SHOULD extend the shared operational model rather than force every department into an identical interaction.**

> **Specialty modules MAY differ in workflow while preserving common authority, provenance, verification, and store/department boundaries.**

Today’s specialty list (flooring cycle / remnants, appliances continuous scan, generic department audit, etc.) is **illustrative**, not constitutional inventory.

---

## Article XIII — Store and Department Scope Law

> **Client-supplied scope MUST never outrank authenticated authority.**

Store and department scope for mutations and privileged reads MUST be actor-bound (authenticated identity / profiles / JWT claims and server resolution). Client headers, local pins, or UI filters MUST NOT expand authority.

- **MASTER_ADMIN** MAY legitimately operate across broader store scope.
- **DEPARTMENT_SUPERVISOR** authority remains constrained to authorized department scope(s), including explicitly granted accessible departments.
- Working-department pins and chrome filters are **views**, not grants of new authority.

This Article does not redesign RBAC; it constrains how scope may be trusted.

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
| **Level 2** | Work objects (bays, assignments, map cells, roster rows) |
| **Level 3** | Utilities / configuration / diagnostics |

Configuration MUST NOT visually compete with daily execution on primary operate surfaces. Intelligence SHOULD augment these levels (Article XI).

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

Primary elevated chrome (conceptual): **Floor · Map · Roster · More** (route implementation MAY use `/settings` while labeling **More**). Associates MAY see a reduced operate set (e.g. My Shift + Map).

---

## Article XVII — Configuration vs Operation Law

> **Low-frequency configuration MUST NOT compete visually with high-frequency operational work.**

Illustrative (not eternal route law):

| Operate | Configure / administer / diagnose |
|---------|-----------------------------------|
| Floor / Map / Roster | More / management surfaces |

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

---

## Article XIX — Observability Without Surveillance

DeptSync needs accountability and historical operational evidence.

> **Measure work outcomes and operational state, not unnecessary human activity.**

Appropriate evidence includes: assignment, completion, verification, barrier, coverage cadence, workload/capacity.

DeptSync MUST NOT become minute-by-minute worker surveillance. Telemetry MUST earn its place through operational need (Article XX).

---

## Article XX — Simplicity / Non-Drift Law

> **Architecture MUST earn its complexity through a demonstrated operational need.**

> **Do not introduce infrastructure, abstractions, intelligence layers, roles, workflows, or integrations solely because they are architecturally fashionable.**

> **Existing simple architecture SHOULD NOT be replaced without evidence that it blocks a constitutional requirement.**

Examples of unjustified complexity: orchestrators without need; custom LLMs without need; device-identity systems without a real requirement; splitting workforce/auth schemas solely for conceptual purity during pilot; enterprise observability stacks without an operational need.

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
| Scoring coefficients / forecast tuning | Replacing DS judgment with autonomous assignment |
| Internal library replacements | Changing store/department authority boundaries |
| | Treating predicted state as observed state |
| | Making Lowe’s task workflow a core DeptSync responsibility |

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
DEPT_SYNC_STATE.md                ← current implementation truth
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
| DEPT_SYNC_STATE | What is true in the running system now |
| Architecture / layout docs | Module ownership and UI mechanics |
| Roadmap | Planned work |
| Journal / handoff | History and session continuity |

Lower docs MUST NOT silently override this Constitution. Implementation gaps → Appendix A.

---

## Appendix A — Constitutional Debt

Known gaps where current reality only partially fulfills a law. **Do not “fix” by weakening the Constitution.** Population is evidence-backed only.

### A-1 — Derived weekly completion vs verification

| Field | Value |
|-------|--------|
| **LAW** | Art. VI — Unverified work MUST NOT silently advance authoritative readiness as though verified. |
| **CURRENT REALITY** | Associate completion sets `is_completed` + `PENDING_VERIFICATION` without closing location to `COMPLETED`. Store health and Floor “complete” counts largely key off `is_completed`, so reported-complete advances completion % / week-complete headlines before `VERIFIED_COMPLETE`. |
| **RISK** | Operators may read pace/readiness as physically closed when DS review is still open. |
| **STATUS** | Open — presentation/derivation debt; two-stage review path exists. |

### A-2 — Offline authority is partial

| Field | Value |
|-------|--------|
| **LAW** | Art. XIV — temporary connectivity loss SHOULD NOT unnecessarily stop committed floor work; reconnection MUST NOT elevate unauthenticated local assumptions. |
| **CURRENT REALITY** | Audits and selected Store Ops mutations queue; many supervisor workflows remain online-only; IndexedDB is read cache; multi-device merge is limited. Queue replay still depends on live auth for Store Ops completes. |
| **RISK** | Uneven floor resilience; operators may assume full offline parity. |
| **STATUS** | Open — intentional phased matrix; document in state, do not over-promise. |

### A-3 — Dual roster / auth storage

| Field | Value |
|-------|--------|
| **LAW** | Art. III — Application authority and workforce participation are distinct. |
| **CURRENT REALITY** | Distinct *conceptually* (roster-only rows, QR pair for app access) but often shared `store_specialists` (and linked `profiles`) storage. |
| **RISK** | Future contributors may conflate roster presence with app entitlement or over-split schemas for purity. |
| **STATUS** | Accepted pilot compromise — not a mandate to redesign schema. |

---

## Appendix B — Change-test scenarios (adoption checks)

| ID | Proposal | Constitutional guidance |
|----|----------|-------------------------|
| A | Chatbot for “how is the department doing?” | MAY explain Layer 1–4 outputs; MUST NOT become intelligence authority (Arts. IX–X). |
| B | Auto-verify bays above 95% confidence | MUST NOT — predicted verification is not physical verification (Arts. VI, VII.3, X). |
| C | Every associate must install DeptSync | Requires evidence under Art. XXI; Art. III does not require app access for workforce representation. |
| D | LLM chooses next week’s bays | MAY advise (Layer 4); MUST NOT silently write authoritative rotation state without human staging rules (Arts. V, VII.3, X). |
| E | Microservices “because we may scale” | Blocked without demonstrated need (Art. XX). |
| F | Default weekly workload 3 → 4 | Implementation / configuration (Arts. V.2, XXII) — not an amendment. |
| G | Garden seasonal specialty workflow | Permitted specialty extension (Art. XII). |
| H | Forecast “inventory readiness 92%” | MUST distinguish forecast from observed readiness and retain provenance (Arts. VII–VIII, IX Layer 3). |

---

*End of DeptSync Constitution.*
