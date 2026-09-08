# DeptSync Operational Intelligence Evolution Plan

**Program ID:** OIE-000
**Status:** PROGRAM FOUNDATION COMPLETE · GEMINI-001 DISCOVERY COMPLETE · AI-REDUCE-001 FIELD ACCEPTED — CLOSED · AI-REDUCE-002 IMPLEMENTATION ACCEPTED — CLOSED · AI-RETIRE-001 IMPLEMENTATION ACCEPTED — CLOSED · AI-SAFETY-001 IMPLEMENTATION ACCEPTED — CLOSED
**Established:** 2026-09-08
**Last updated:** 2026-09-08 — AI-SAFETY-001 implementation accepted and closed; no field gate required (§5 A1.4 / A1.5 / A1.11 / A1.12)
**Evidence basis:** RA-001 Repository Archaeology (read-only audit, baseline `25b6ed2`) · GEMINI-001 Generative Cost & Necessity Audit (read-only)
**Authority:** Subordinate to [`DEPTSYNC_CONSTITUTION.md`](../../DEPTSYNC_CONSTITUTION.md). Where this document and the Constitution conflict, the Constitution governs and the conflict must be flagged, not silently resolved.

> **Every future tranche in this program MUST read both `DEPTSYNC_CONSTITUTION.md` and this document before analysis or implementation.**

This document is a program map. It is not a specification, not an approval, and not a commitment to implement any item listed in it. Items recorded here are **candidates with evidence**, not scheduled work.

---

## 1. Program Mission

RA-001 audited the repository by operational job rather than source folder and reached one dominant conclusion:

**DeptSync's primary gap is not missing capability.**

The repeating repository pattern is:

```text
evidence exists
  → deterministic derivation exists
    → sometimes a recommendation exists
      → user-facing read-back / action is missing or weak
```

The chain terminates one step before the Department Supervisor. Engines compute structured output and a surface consumes two integers from it. Evidence is persisted permanently and no screen reads it back. Recommendations are produced and no affordance acts on them.

> **The next unit of product value is connection, not construction.**

This program exists to close those loops systematically — and, equally, to decide deliberately which loops should be closed at all, which should be retired, and which should stay parked until field evidence arrives.

### What this program is not

- It is **not** a mandate to surface every orphaned capability (OIE Law 9).
- It is **not** a cleanup program. Cleanup is recorded in Workstream J and explicitly deprioritised beneath product loops.
- It is **not** an AI expansion program. Workstream A exists to *reduce* generative dependency where deterministic evidence already suffices.
- It does **not** supersede UX-005. UX-005 remains an active governing program with its own open questions and field gates. Where the two overlap — notably UX-005F "AI earn-your-place review" — this document records the relationship rather than replacing the canonical ID.

---

## 2. Definition of Operational Intelligence

### 2.1 Canonical layer numbering

The Constitution (Article IX) already defines DeptSync's intelligence stack. **That numbering is canonical.** This program adopts it verbatim and does not introduce competing terminology.

| Layer | Constitutional name | Role |
|---|---|---|
| **0** | Authoritative Operational State | What was recorded / configured |
| **1** | Deterministic Derivation | Exact calculations — coverage %, age, variance, weekly completion, capacity, stale counts |
| **2** | Pattern / Temporal Intelligence | Historical structure — recurring carry-over, repeated barriers, imbalance, abnormal deterioration, cadence |
| **3** | Forecast Intelligence | Future estimates with appropriate uncertainty |
| **4** | Decision Intelligence | Ranked / prioritised considerations for human action |
| **5** | Optional Explanation | Human-readable explanation of already-produced evidence/intelligence |
| **6** | UI Expression | Present facts / signals / considerations on the correct operational surface |

### 2.2 Terminology reconciliation

Program discussion sometimes uses informal names for these layers. They map as follows and **must not** be treated as a second numbering system:

| Informal name | Canonical layer |
|---|---|
| Authoritative evidence | Layer 0 |
| Mathematics / deterministic derivation | Layer 1 |
| Signals | Layer 1 output consumed at Layer 2 boundary (SI-001 sits here) |
| Historical patterns | Layer 2 |
| Recommendations / considerations | Layer 4 |
| Optional generative interpretation | Layer 5 |
| UI expression / DS decision surface | Layer 6 |

Layer 3 (Forecast) is thin-to-absent in the current system. That is acceptable — the Constitution states layers may be thin or absent in a given release, provided **order of authority is never inverted**.

### 2.3 Conceptual flow

```text
facts
  → mathematics
    → derived signals
      → patterns
        → considerations
          → optional human-readable explanation
            → decision surface
```

### 2.4 Explicit statements

**Generative AI is NOT the intelligence layer by default.** It occupies Layer 5 (Optional Explanation) and, legitimately, the unstructured-input boundary *into* Layer 0. It is never Layers 1–4.

**A deterministic system may be highly intelligent.** SI-001 attention pressure, appliance audit consideration, velocity decay, and proportional labor clustering are all sophisticated intelligence containing no generative model whatsoever. Sophistication is not a synonym for AI.

**Prediction is never authoritative state** (Constitution Art. VII.3). **Intelligence may interpret evidence, but it may not manufacture evidence** (Art. VII.3, Art. IX).

### 2.5 Canonical principles

> **DeptSync identifies the pattern. The DS determines what the pattern means.**

> **Intelligence may interpret evidence, but it may not manufacture evidence.**

> **If DeptSync can derive the answer deterministically from known evidence, do not pay a generative model to guess or rewrite it.**

> **Use generative AI primarily at unstructured-input boundaries where deterministic parsing is insufficient. Validate model output deterministically before any authoritative action.**

---

## 3. RA-001 Executive Evidence

Findings recorded here are the evidence basis for this program. Confidence qualifiers from RA-001 are preserved deliberately — do not promote an inference to a fact in a later tranche without new evidence.

### 3.1 Hidden Floor tier

`components/hub/tabs/FloorTab.tsx:826` passes `hideChrome` unconditionally to `ZebraChecklist`. Every block gated on `!hideChrome` is therefore unreachable on the primary Floor surface, approximately seven built surfaces:

- Assigned-rotation banner (`ZebraChecklist.tsx:775-792`)
- Weekly pace pill from `forecastWeeklyPace` (`:793-810`)
- `BayHealthScorecard` (`:814`)
- Rotation / Downstock queue tab pair (`:816-850`)
- `AuditLocationModeToggle` — Selling vs Topstock (`:852-859`)
- Per-associate shift filter chips (`:861-887`)
- Sunday-bays-first handoff affordance label (`:932-936`)

Downstream consequence: because `queueFilter` can never become `"downstock"`, `assignOptions` is permanently `[]`, so the CSA overhead-pull assignment control (`:1274-1293`) and its live writer `assignDownstockPull` (`:637-676`) are unreachable.

**`lockedQueue` and `compact` were built for the Stock tab, which is now `redirect("/dashboard")`.** This state appears to be a consequence of route consolidation rather than a product decision — but that is an inference about history, not a verified fact.

> **This finding means each surface deserves individual product review. It does NOT prescribe restoring any of them, and explicitly does not prescribe removing `hideChrome`.** See OIE-B1 and OIE Law 9.

### 3.2 Parked intelligence engines

Two large, tested Layer-4 foundations exist with zero runtime consumers. Verified by symbol grep across `app/`, `components/`, and `lib/` excluding tests — each exported composer appears exactly once, at its own definition.

| Engine | Location | Method ID | Tests |
|---|---|---|---|
| **REC-001** `composeDepartmentStagingConsideration` | `lib/store-ops/staging-consideration.ts:307` | `department-staging-consideration-v1` | 46 |
| **LAB-001** `composeDepartmentLaborAvailability` | `lib/store-ops/labor-availability.ts:363` | `department-scheduled-labor-v1` | 53 |

**Their existence is not a defect.** Both are recorded as deliberately parked in `MASTER_ROADMAP.md` and `DEVELOPMENT_JOURNAL.md` with the explicit note "Not LIVE (no runtime consumer)."

> **They must not be activated merely because they exist.** See OIE Law 9 and Workstream F.

Both display unusual epistemic discipline worth preserving: REC-001 refuses to rank or truncate its qualifying pool and distinguishes `NO_ADDITIONAL_STAGING_NEEDED` from `UNAVAILABLE`; LAB-001 returns `null` rather than zero for unknown evidence and emits `CONFLICTING_SHIFT_DAY` without inventing a winner.

### 3.3 Historical evidence read-back gap

DeptSync persists substantial operational history. Several datasets have weak or no human read-back:

| Dataset | Write path | Read-back status |
|---|---|---|
| `weekly_rotation_completion_attempts` | 5 live writers | Only reader path is an uncalled client wrapper |
| Send-back / coaching notes | `rotation-review.ts` | Visible one cycle on the parent row, then nulled; permanent copy unreadable |
| `bay_service_logs` | `bay-service.ts:102,125` | Read only by Predictive Copilot, severe intensities only |
| Superseded rotation provenance | `rotations.ts` | Used as a filter only; never displayed |
| Verification timing (`completed_at` → `verified_at`) | rotation lifecycle | `verificationLagHours` exists; verified zero importers |
| `appliance_reconciliation_snapshots` | reconcile route | **Fully closed loop** — see 3.4 |
| `bay_audit_logs` | `bay-audit-logs.ts:30` | Join key likely always NULL — see below |
| `shift_walk_tasks` | `shift-tasks.ts:223` | Read functions built; contract-tested as unimported |

`app/api/store-locations/history/route.ts` composes rotations, supersede provenance, and per-rotation completion attempts into a per-bay narrative. Its typed client wrapper `fetchBayLocationHistory` (`lib/store-ops/client.ts:541`) has **zero callers** (verified). The route is `requireSuperAdmin`, which may explain why it was never wired.

**Originally recorded as strong static inference. VERIFIED by GEMINI-001 (2026-09-08) — see A1.3.** RA-001 traced three independent breaks in the `bay_audit_logs` lifecycle — `FloorTab.tsx:1002-1008` supplies `auditContext` without `rotation_id`; the callback early-returns on `!payload.rotation_id` (`:1010`); `image_url` is never passed. GEMINI-001 confirmed all three by exhaustive call-site enumeration and additionally proved the FAIL gate is unreachable because both maps feeding the verdict are permanently empty. The lifecycle state is **SEVERED**. One correction to the original reading: the `bay_audit_logs` insert happens **server-side and unconditionally**, so rows *are* written — with `rotation_id: null` — rather than not written at all. Decision ownership moves to **SNAP-DECISION-001**.

### 3.4 Appliance closed-loop exemplar

Appliances is the strongest current example of a complete evidence loop:

```text
physical observation (appliance_scans, explicit audit membership)
  → reconciliation (audits/[id]/reconcile)
    → historical snapshot (appliance_reconciliation_snapshots)
      → deterministic consideration (appliance-audit-consideration-v1)
        → next decision (Consider checking again strip)
```

`lib/appliances/audit-consideration.ts` demonstrates the target discipline: `STALE_THRESHOLD_DAYS: null` so staleness is never invented, catalog hints that "decorate display — they do not create eligibility," and per-item `reasons[]` carried to the surface.

> **Other modules should learn from this pattern without cloning appliance UX.** The transferable asset is the loop shape and the epistemic discipline, not the interface.

---

## 4. Program Laws / Non-Negotiables

These are program rules. They sit beneath the Constitution and above individual tranche decisions.

### OIE Law 1 — Evidence Before Intelligence
Do not generate a pattern before validating the evidence feeding it. If the underlying dataset is incomplete, mis-wired, or unverified, the pattern built on it is not intelligence — it is confident noise.

### OIE Law 2 — Read Before Build
Before creating a new engine, search for an existing producer, derivation, API, component, or persisted dataset that already performs the job. RA-001 demonstrated the repository frequently already contains the producer.

### OIE Law 3 — Deterministic First
Structured facts plus deterministic logic are preferred over paid generative calls when they can answer the operational question faithfully.

### OIE Law 4 — AI at Unstructured Boundaries
Retain generative AI when its unique value is parsing genuinely unstructured input — images, free-form human language, speech — and only when the underlying product job itself earns its place.

### OIE Law 5 — Explainability
Considerations should expose why they exist. Prefer:

> "Consider checking Bay 12 — 2 recent carryovers · HIGH current attention · last verified 18 days ago"

over an opaque score or generative prose with hidden reasoning. This aligns with Constitution Art. VIII (Provenance Law): hidden, unrecoverable scoring is unconstitutional for material operational claims.

### OIE Law 6 — No Cause Inference Without Evidence
DeptSync may identify **recurrence, direction, magnitude, timing, and correlation**. It may not invent causal explanations. "Sent back 3 of 5 times" is evidence. "Because the associate is undertrained" is manufactured.

### OIE Law 7 — Historical Evidence Belongs at Decisions
Do not build generic history dashboards by default. Historical evidence should appear where it can change a DS decision, consistent with Constitution Art. XI (Intelligence Placement Law).

### OIE Law 8 — Field Acceptance
Field-facing changes are **engineering-complete** before field testing and **field-accepted** only after practical store/device validation when feasible. These are distinct states and must never be conflated in documentation.

### OIE Law 9 — Visibility Is Not Validation
An orphaned or hidden capability does not automatically deserve to be surfaced. Every recovered capability must still earn its place under Constitution Art. XX (Simplicity / Non-Drift).

### OIE Law 10 — No Leapfrogging
Do not build a new intelligence layer while a prerequisite evidence or read-back loop remains broken. This mirrors the existing appliance-program discipline ("do not leapfrog evidence foundations").

---

## 5. Workstream Map

---

## WORKSTREAM A — GENERATIVE AI NECESSITY

### OIE-A1 / GEMINI-001 — Generative Cost & Necessity Audit

**Status:** **DISCOVERY COMPLETE — DISPOSITIONS RECORDED** (2026-09-08)

**Relationship to existing IDs:** This is the discovery instrument for **UX-005F (AI earn-your-place review)**, which remains the canonical UX-005 tranche ID. GEMINI-001 does not replace UX-005F; it supplies its evidence. UX-005 Question #3 (Snap Bay Gemini cost) and Question #7 (Predictive Copilot) remain open and owned by UX-005F.

**Purpose:** For every remaining Gemini-backed capability, determine whether Gemini adds information unavailable to deterministic DeptSync logic.

**Audit dimensions applied (all required per capability):** trigger · input · existing structured evidence · deterministic fallback · model-specific value · authoritative consequence · persistence · human confirmation · approximate call frequency / cost exposure · offline behavior · product job · whether the job itself earns its place.

---

### A1.1 — Canonical conclusion

> **DeptSync is almost entirely independent of Gemini for operational intelligence. Gemini is used primarily for input interpretation and prose, not for the deterministic intelligence stack.**

No Gemini call exists anywhere in the rotation engine, the attention engine (SI-001), the appliance consideration composer, the health calculations, the velocity decay, or the labor balancer. Every Layer 1, Layer 2, and Layer 4 producer in this repository is deterministic TypeScript.

The governing boundary for this program:

> **Generative AI may help interpret evidence or intent, but operational intelligence should remain reproducible from deterministic evidence whenever practical.**

This is subordinate to, and does not replace, the constitutional statements already binding on this program:

> **Intelligence may interpret evidence, but it may not manufacture evidence.**

> **DeptSync identifies the pattern. The DS determines what the pattern means.**

**Scope discovered:** nine live call paths plus one confirmed-dead tombstone. RA-001 named eight candidates; GEMINI-001 found a ninth. `VisualBayScannerModal` has **two** backends — three mount sites call the ephemeral `/api/store-ops/ai-bay-scan`, while the Floor mount calls a separate endpoint, `/api/ai/bay-audit/validate`, with its own schema and a database write. These are distinct capabilities requiring distinct dispositions.

**Shared-helper consequence:** all nine paths funnel through `callGeminiFlash` (`lib/ai/gemini.ts`). Removing any single capability does not reduce transport dependency. Reduction here means fewer calls and less exposure, not less code.

---

### A1.2 — Canonical AI Capability Disposition Map

Evidence-backed dispositions. Every row is a **recorded finding**, not approved implementation work.

| Capability | Current Role | Disposition | Reason | Implementation Action | Field Gate | Safety / Integrity Note |
|---|---|---|---|---|---|---|
| **1. Pre-Flight location parse** | Input interpretation — free-text → bay rows | **RETAIN AI** | Genuinely unstructured input; no equivalent deterministic parser exists; model extracts structure rather than calculating intelligence; normalizer validates institutional fields; human confirmation required before DB write; low call exposure | None | None | Aisle validation weak; bay range has no meaningful upper bound; confirmation accepts the generated batch as a whole. **Bounded follow-up evidence only — no work item created** |
| **2. Floor-Walk Copilot** | Input interpretation — speech text → task structure | **OPTIONAL AI** | Browser speech recognition produces text locally (audio never sent to Gemini); Gemini structures natural language; deterministic parser/fallback already exists; closed enums enforced by deterministic code; human dispatch required before authoritative write | None | **WALK-001 / FE-004 preserved** | Unknown/invented location tags may persist with null foreign keys |
| **3. Executive Floor Pad extract** | Input interpretation — note text → tasks/tags | **OPTIONAL AI** | Natural-language interpretation is a legitimate AI boundary; deterministic fallback exists for the missing-key path; human-provided aisle/bay outrank model values | **AI-SAFETY-002** (queued) | None | Model output autosaves without a separate confirmation step; `metadata` is effectively unvalidated JSON; configured-Gemini failure has asymmetric fallback behavior |
| **4. Shift Briefing** | ~~Prose rewrite of computed findings~~ → **deterministic producer** | **REPLACE DETERMINISTICALLY — DONE** (AI-REDUCE-001, 2026-09-08) | Deterministic and Gemini paths had identical output shape; **zero Gemini-only fields**; hotspot selection was already deterministic before the model call; local brief was already the default render; UI itself called it an "optional AI rewrite" | **AI-REDUCE-001 — FIELD ACCEPTED — CLOSED** (2026-09-08) | **MET** — real DS-device operational state-change test (A1.7) | Display-only — no authoritative write on this path. Gemini dependency removed; briefing now derives solely from store-health evidence |
| **5. Flooring Insights** | Explanation over local math | **OPTIONAL AI** | Measurement math is not performed by Gemini; item identity / aging / variance are local authoritative or deterministic; Gemini contributes prose, priority ordering, and a model-selected markdown percentage; model cannot invent new remnant entities because the merge is constrained to local candidates | **FLOORING-AI-001** (discovery pending) | None | `recommended_percent` is a model-originated number that can reach `carpet_remnants` on supervisor Apply |
| **6. Visual Bay Scan — ephemeral** | Image interpretation | **FIELD EVIDENCE NEEDED** | Image interpretation is genuinely non-deterministic / multimodal; result is not persisted; no correctness feedback loop; no historical comparison; no accuracy capture; output disappears on close | None | **UX-005F / field gate preserved** | Model correctness is structurally unevaluable. **No deterministic computer-vision replacement proposed** |
| **7. Bay Audit Validate — persisting** | Image interpretation + DB write | **FIELD EVIDENCE NEEDED — WITH CRITICAL LIFECYCLE DEFECT** | Lifecycle state verified **SEVERED** (see A1.3). Product value cannot be judged while the loop is broken | **SNAP-DECISION-001** | **UX-005F / field gate preserved** | Paid inference currently produces orphaned rows no surface can read |
| **8. Catalog Taxonomy** | ~~Static folder generation~~ → **registry displayed directly** | **REPLACE DETERMINISTICALLY — DONE** (AI-REDUCE-002, 2026-09-08) | Input was effectively static; the deterministic registry already covered all catalog codes; regeneration did not learn from previous results; the stored result was `localStorage`-only; repeated identical inference was possible indefinitely; no human correction mechanism existed | **AI-REDUCE-002 — IMPLEMENTATION ACCEPTED — CLOSED** (2026-09-08) | **None required** — no field-facing operational surface changed (A1.8) | Department identity is now pinned to application state; the model-set-department-code defect is closed. **A1.8 records the escalation GEMINI-001 understated:** generated folder names could reach a persisted audit's `sub_category` |
| **9. Snag Triage** | ~~Orphaned classification~~ → **retired** | **REMOVE JOB — DONE** (AI-RETIRE-001, 2026-09-08) | Route/helper/dispatcher existed with **zero invocation path ever**; deterministic fallback was exclusively owned; capability could write three authoritative tables with no human confirmation | **AI-RETIRE-001 — IMPLEMENTATION ACCEPTED — CLOSED** (2026-09-08) | **None required** — no user-reachable surface existed to change (A1.10) | Job retired, not replaced. **A1.10 records the escalation GEMINI-001 understated:** the route required only *any* signed-in actor, so the three-table write was reachable at the lowest auth tier |
| **10. Note Summary** | — | **RETIRED** | Route returns HTTP 410; no Gemini dependency remains; no paid call is structurally possible | None | None | Verified genuinely dead — no Gemini import in the module graph |

**Constraint preserved for capabilities 2 and 3:**

> **AI interprets language. DeptSync determines operational meaning.**

---

### A1.3 — Snap Bay lifecycle verification

RA-001 recorded the lifecycle severance as a strong static inference. GEMINI-001 **verified it** by exhaustive call-site enumeration.

**Lifecycle state: SEVERED.**

Verified findings:

- **`rotation_id` is structurally guaranteed `null`** for all current writes. `validateBayAudit` has exactly one caller, and the only mount supplying `auditContext` passes `department_id` alone.
- **`image_url` is never persisted.** The column exists; the modal never passes a value.
- **Supervisor read-back cannot join the audit row.** The reader keys on `rotation_id`.
- **The FAIL completion gate cannot fire.** Both maps feeding the verdict are permanently empty — `setAuditByRotation` is called only to *delete* keys, and the external map is never populated because its callback early-returns on the always-absent `rotation_id`.
- **Current model output cannot be evaluated later.** The only feedback signal, `supervisor_override`, is written only on a FAIL override that can never occur.
- **Floor calls can produce paid inference and orphaned DB rows.**

> **This finding does not decide the outcome.** SNAP-DECISION-001 must choose **REPAIR LIFECYCLE** or **RETIRE CAPABILITY** on product value and field evidence. The severance makes the decision urgent; it does not make the answer "repair."

---

### A1.4 — Shared AI safety findings

#### AI-SAFETY-001 — Bounded Gemini Transport

**Evidence as recorded by GEMINI-001:** no Gemini path had an explicit timeout, an `AbortSignal`, a bounded upstream execution time, or a retry ceiling. Verified across the shared transport and all eight live routes.

**Status: IMPLEMENTATION ACCEPTED — CLOSED** (2026-09-08). Every clause of the finding was re-verified at HEAD and held. See **A1.11** for the implementation record, including the correction that "no retry ceiling" meant *no retry existed at all*, so none was added.

**This is not an AI reduction.** It is resilience / bounded failure behavior, and it caps worst-case exposure across all nine paths at one change site.

#### Model output runtime validation

`asGeminiSchema` is a TypeScript cast, not runtime validation. Deterministic normalizers currently provide the real enforcement in several paths — notably the walk-parse enum coercions and the snag-triage membership tests.

> **Do not create a universal schema architecture without evidence.** Track only where material to authoritative consequences.

#### Config drift

`.env.example` and the code default refer to different Gemini model names.

**Classification: TRUTH / CONFIGURATION DEBT.** Recorded, not changed.

---

### A1.5 — Approved AI reduction sequence

Evidence-backed order.

1. **AI-REDUCE-001** — Deterministic Shift Briefing — **FIELD ACCEPTED — CLOSED** (2026-09-08)
2. **AI-REDUCE-002** — Deterministic Catalog Taxonomy — **IMPLEMENTATION ACCEPTED — CLOSED** (2026-09-08)
3. **AI-RETIRE-001** — Retire Snag Triage — **IMPLEMENTATION ACCEPTED — CLOSED** (2026-09-08)
4. **AI-SAFETY-001** — Bound Gemini Transport Failure — **IMPLEMENTATION ACCEPTED — CLOSED** (2026-09-08)
5. **SNAP-DECISION-001** — Repair-or-Retire Snap Bay

**This ordering is NOT absolute.** Truth/security defects may preempt it. **SNAP-DECISION-001 is not an implementation task** — it is a product/truth decision.

**Deliberately excluded from the reduction sequence:** the two language copilots (capabilities 2 and 3) and Flooring Insights. They sit at legitimate unstructured-input boundaries, carry low or moderate exposure, and their deterministic fallbacks already prove the product survives without the model. Reducing them would trade real interpretation value for little cost relief.

---

### A1.6 — Long-term AI role

> **Gemini earns a narrow role at unstructured-input boundaries where DeptSync cannot reasonably derive the same interpretation from structured evidence.**

Currently earning or potentially earning that role:

- free-text topology interpretation
- natural-language task structuring
- potentially image interpretation, **if** product value and lifecycle are proven

Gemini should generally **NOT** be used for:

- deterministic math
- recurrence detection
- rotation reasoning
- labor balancing
- attention signals
- health metrics
- static taxonomy generation
- rewriting already-computed intelligence merely to sound more natural

Optional human-readable explanation may still be appropriate where it earns its cost.

**Goal of Workstream A (restated after discovery):** reduce paid AI dependency without reducing useful intelligence.

---

### A1.7 — AI-REDUCE-001 field acceptance (2026-09-08)

**Status: FIELD ACCEPTED — CLOSED.** The first fully closed implementation tranche under this program.

**Field test performed** on a real DS device, after the deterministic Shift Briefing shipped:

- 12 bays were staged
- the workflow was exercised as though those bays had been worked
- the staged work was cleared / completed
- DeptSync was observed updating itself to reflect the changed operational state

**What this validates — and only this:**

> **When underlying operational evidence changes, DeptSync recomposes its state and intelligence from that evidence rather than depending on a Gemini rewrite.**

That was the core requirement for AI-REDUCE-001, and it is met. The deterministic briefing and Floor operational state responded correctly to changed evidence with no Gemini path present.

**Recorded conclusions:**

- the deterministic Shift Briefing remained operational after Gemini removal
- operational state continued to respond to changed evidence
- no Gemini dependency was required for that response
- no new intelligence architecture was needed
- the reduction preserved the intended operational behavior

**Scope limits on this evidence.** Nothing beyond the four observations above was reported and nothing further may be inferred. This result covers the evidence-response requirement for **this capability only**. It is **not** transferable to any other Gemini capability — Floor-Walk Copilot, Executive Floor Pad, Flooring Insights, Visual Bay Scan, Bay Audit Validate, and Catalog Taxonomy retain their own dispositions and their own gates. It also does not close UX-005F.

> **Less machinery. Same truth. Same usefulness. Lower dependency.**

---

### A1.8 — AI-REDUCE-002 deterministic Catalog Taxonomy (2026-09-08)

**Status: IMPLEMENTATION ACCEPTED — CLOSED.** The second closed implementation tranche under this program, and the first closed **without** a field gate.

**Premise verified at HEAD.** Every GEMINI-001 statement held: the prompt packet was built from `getDefaultTaxonomy` (the model was shown the defaults and asked to expand them), `DEFAULT_DEPARTMENT_TAXONOMIES` covers all ten catalog codes, generated output persisted only to the `deptsync_catalog_taxonomies` localStorage key, generation was repeatable indefinitely, and no correction or teaching loop existed. Gemini contributed **no unique capability** — it never saw catalog records, audit history, or store-specific evidence, so it could not classify unstructured input, learn store-specific vocabulary, reconcile unknown categories, or teach the system anything durable.

**One finding GEMINI-001 understated.** GEMINI-001 recorded the generated taxonomy as `localStorage`-only, which is true of the taxonomy itself but understates the consequence. `DepartmentAuditSection` reads the effective taxonomy — defaults merged with the stored override — renders it as the folder drill-down, and on log writes the selected folder into the audit record:

```
sub_category: taxonomySelection?.subcategory?.trim() || taxonomySelection?.category.name || ""
```

So a model-invented folder name could reach a **persisted audit record's `sub_category`**. The taxonomy was display metadata; its labels were not. Under Article "intelligence may interpret evidence but may not manufacture evidence," this strengthened the case for removal rather than weakening it.

**Department-identity defect found and fixed.** GEMINI-001 flagged that the model could set `department_code`. Tracing that through to storage showed it was live, not theoretical: `mergeTaxonomies` resolved identity as `incoming.department_code || base.department_code`, so a stored payload could redefine which department a read returned. A blob stored under `D25` carrying `department_code: "D35"` made `getTaxonomyForDepartment("D25")` return a tree labelled D35. Identity is now pinned to application state in two places — the override map keys identity from the storage key, and `getTaxonomyForDepartment` restores the caller's identity after merging. Stored folders may still **expand** a tree; they may never **rename** the department. A test asserts this directly.

**Persisted-state ownership decision.** The override map had exactly one writer — the AI generate handler — and no editor existed anywhere in the repository. Stored overrides are therefore provably **machine output, not user-authored work**. They are nonetheless left in place: nothing is deleted, no migration was invented, and the existing clear affordance is retained so an admin can drop stale generated folders. `saveTaxonomyOverride` is removed, so nothing can write new overrides; the read and clear paths remain.

**Product behavior chosen (A + D).** The Generate interaction is removed because it performed no useful job, and the canonical department registry is presented directly. No editor was added to compensate, and no new taxonomy engine was built.

**Recorded conclusions:**

- catalog folder browse remains fully functional from the shipped registry
- department audit folder filtering and `sub_category` capture are unchanged
- generated folder names can no longer enter audit evidence
- stored department identity can no longer override application state
- no user-authored state was destroyed
- appliance catalog teaching was untouched and does not consume this registry

**Field acceptance: not required, and none was invented.** Under OIE Law 8 the gate applies to changed field-facing operational behavior. The only surface changed is the Master-Admin-only Catalog Taxonomies modal in Settings — not a floor surface, not part of rotation, audit, verification, or shift work. The department-audit consumer continues to read the same deterministic taxonomy contract, and the folder tree an associate sees renders byte-identical to the previous default path. No field-facing gesture or network behavior changed. Nothing in the aisle changed, so there is nothing in the aisle to smoke test.

This establishes the counterpart to AI-REDUCE-001: **the field gate is earned by changed field-facing behavior, not by the act of removing AI.** AI-REDUCE-001 required a gate because the briefing card lives on the supervisor's phone and its refresh gesture changed. AI-REDUCE-002 does not, because an admin-only management surface changed and the floor surface did not.

> **Less machinery. Same truth. Same usefulness. Lower dependency.**

---

### A1.9 — Legacy generated `sub_category` provenance (adjacent finding, NOT a work item)

Recorded from AI-REDUCE-002. **This is a truth/provenance observation, not remediation scope.**

Because the removed generator's folder labels could be selected in the department-audit drill-down and written to a persisted audit's `sub_category` (A1.8), **devices that previously used Generate may already hold audit rows whose `sub_category` came from a model-authored folder name.**

Two facts, and nothing beyond them:

- **No new machine-generated taxonomy labels can be created.** The Gemini generator is removed and no writer for taxonomy overrides remains, so the path that produced them is closed.
- **Existing historical audit values remain untouched, deliberately.** Provenance is not sufficient to distinguish a model-authored `sub_category` from an operator-selected registry folder or a hand-entered value. Guessing would manufacture evidence about evidence.

**Explicitly out of scope and not performed:** no row migration, no rewriting of historical audit evidence, no inference about which values were AI-generated, no mass-normalization of `sub_category`, no cleanup migration, and no repair UI.

If this is ever picked up, it must be framed narrowly as **historical provenance/truth discovery, not automatic remediation.** No work item is opened here.

---

### A1.10 — AI-RETIRE-001 Snag Triage retired (2026-09-08)

**Status: IMPLEMENTATION ACCEPTED — CLOSED.** The first **retirement** under this program, as distinct from a reduction, and the third closed implementation tranche.

**Orphan status proved, not assumed.** Every GEMINI-001 statement held at HEAD, and the search was run by symbol, route URL, request and response field names, written table names, distinctive prompt text, and the `source: "snag_triage"` marker. Results: the route had **no first-party caller, no hidden or dev trigger, no deep link, no cron or background caller, no documented external integration, and no offline replay path** — the sync queue replays a closed `SyncActionType` enum that never contained a snag action, and the service worker treats `/api/` as network-only rather than replayable. A client helper `triageSnagReport` existed in `lib/store-ops/client.ts` and was **never called by anything**. The whole stack — route, contracts, classifier, fallback, dispatcher, client helper — referenced only itself.

**The escalation GEMINI-001 understated: authorization tier.** GEMINI-001 recorded that dispatch could write three authoritative tables with no human confirmation, and that unreachability mitigated the risk. Reading the route showed the gate was `requireStoreOpsActor` — **any signed-in store-ops actor, including a DeptFloor associate.** Not supervisor, not admin. So the three-table write was reachable at the lowest authenticated tier by anyone who knew the URL, with `dispatch: true` creating operational records directly. The mitigation was obscurity, which is not a control. This is now closed by deletion rather than by adding a role check to a job nobody uses.

**Authoritative write audit.** Each dispatch target was traced separately. `downstock_queue` — upsert guarded by `onConflict: store_number,department,assigned_week,rotation_id`, so retry was idempotent; required a `rotation_id`. `rotation_exceptions` — written indirectly through the **shared** `reportRotationBarriers`, and could set `markCarriedOver` on P1; required a `location_id`. `shift_walk_tasks` — upsert on a freshly generated `id`, tagged `source: "snag_triage"`, making those rows the only distinguishable ones. Writes were **not transactional across targets**, but each dispatch hit exactly one target, so partial multi-table dispatch was not possible.

**Product-job classification: ORPHANED.** The job had evidence input and interpretation, but **no user trigger, no human review, no read-back, no correction path, and no lifecycle closure.** It could create operational state that no surface could attribute back to it. Retirement authorized.

**Overlap is evidence, not a merge instruction.** Every action Snag Triage could take already has a clearer human-owned workflow: Flag Downstock owns `downstock_queue`, the barrier/exception flow owns `rotation_exceptions`, and Walk & Talk owns `shift_walk_tasks`. Those workflows were **not consolidated, extended, or touched**.

**Deterministic fallback retired with the job.** `buildLocalSnagTriage` was `normalizeSnagTriageResult({}, input)` and had no consumer outside the retired route. Per the canonical principle, a deterministic implementation does not justify a product job that has not earned its place. No deterministic Snag Triage UI was built, and the fallback was not wired into Floor, Map, Walk & Talk, or Predictive Copilot.

**Preserved.** Shared Gemini transport and `GEMINI_TOKEN_BUDGET.copilot` (shared with Floor-Walk Copilot and Executive Floor Pad), `reportRotationBarriers`, `createWalkTaskId`, and all five surviving Gemini routes.

**No tombstone.** The repository's one AI tombstone (`ai-note-summary`, 410) exists to redirect **real prior consumers** to a replacement owner. Snag Triage never had a consumer and has no replacement to name, so a tombstone would serve nobody and would falsely imply the job once shipped. Deleted outright.

**Historical state untouched.** No migration, no cleanup SQL, no data rewrite. Existing `downstock_queue`, `rotation_exceptions`, and `shift_walk_tasks` rows belong to their owning tables and keep their existing provenance — including any row carrying `source: "snag_triage"`, which is left exactly as recorded.

**Field acceptance: not required, and not invented.** Law 8 gates changed field-facing behavior. **No user-reachable surface existed to change** — there was no button, screen, deep link, or gesture anywhere in the product that reached this job. Nothing an associate or supervisor can do behaves differently. This is a stronger basis than AI-REDUCE-002's, where an admin surface at least changed.

**Accepted findings.** The authority finding is canonical: the route's `requireStoreOpsActor` gate meant any authenticated Store Ops actor — including the lowest DeptFloor / workforce tier — could invoke it if they knew the URL, and `dispatch: true` could then create operational state with no separate human confirmation. **The removed route must not be reintroduced behind a stricter authorization gate.** The product job was proven unnecessary, so the correct remedy was removing the job, not hardening it. Equally, **no deterministic Snag Triage replacement may be built.**

> **A deterministic implementation does not justify a product job that has not earned its place.**

---

### A1.11 — AI-SAFETY-001 bounded Gemini transport (2026-09-08)

**Status: IMPLEMENTATION ACCEPTED — CLOSED.** The program's first pure **resilience** tranche — not a reduction, not a retirement. No Gemini capability was removed, added, or re-dispositioned. Reviewed and accepted with **no field gate**; the transport contract below is now canonical.

> **An optional intelligence dependency may fail. DeptSync's operational workflow may not fail with it.**

**Surviving Gemini surface confirmed from code: exactly six live consumers, one shared transport, one 410 tombstone.** GEMINI-001 counted nine; AI-REDUCE-001, AI-REDUCE-002, and AI-RETIRE-001 have since closed three. The six are Pre-Flight location parse, Floor-Walk Copilot, Executive Floor Pad extract, Flooring Insights, Visual Bay Scan (ephemeral), and Bay Audit Validate (persisting). Five are API routes; the Floor Pad is a Server Action, not a route — so "five surviving routes" and "six surviving consumers" are both true and must not be conflated. `callGeminiFlashJson` has exactly six invocation sites and `lib/ai/gemini.ts` is the only runtime importer of `@google/generative-ai` (`lib/ai/gemini-schema.ts` is type-only). **No bypass exists.**

**The premise held, with one important correction.** Verified at HEAD: no timeout, no `AbortController`, no `AbortSignal` reaching `fetch`, and no bounded execution time. The correction concerns retry. The work-item language mentions a "retry ceiling," which invites adding retries. Reading the SDK shows `makeRequest` performs exactly one `fetch` and has no retry logic anywhere, and no consumer, route, or the offline sync queue retries a Gemini call. **There was no retry to bound.** The safe policy was therefore **one attempt + finite timeout + explicit failure**, and **zero automatic retry was introduced**. Adding retries would have increased paid exposure while calling it a safety fix.

**Why the fetch was genuinely unbounded — mechanism, not inference.** The SDK builds `fetch` options in `buildFetchOptions`, which attaches a signal *only* when the caller supplies `signal` or `timeout`. `callGeminiFlash` supplied neither, so `fetchOptions.signal` was `undefined` and the request lived as long as the platform allowed. Only the cron route declares `maxDuration`; the five AI routes inherit the platform default, so the effective ceiling was environment-dependent rather than a product decision.

**Transport contract chosen (smallest that bounds failure).** The transport owns its own `AbortController` and deadline, passes `signal` to `generateContent`, and clears the timer in `finally` on every exit path. It deliberately does **not** pass the SDK's own `timeout` option, because that path calls `setTimeout(() => controller.abort(), timeout)` with **no `clearTimeout`** — using it would have satisfied the timeout requirement while leaking a timer on every successful call.

**Abort ownership: timeout only (option D).** No consumer supplies cancellation today, and `GeminiCallOptions` exposes no `signal`. Signal composition was not invented; a contract test asserts it stays uninvented so a future need is a deliberate decision rather than drift.

**Timeout value: 20 000 ms, from repository evidence rather than taste.** `lib/store-ops/client.ts` already declares `STORE_OPS_FETCH_TIMEOUT_MS = 20_000` — DeptSync's own existing answer to how long a floor-facing network call may take before the operator is told to try again. Reusing that number avoids introducing a second, competing network-patience vocabulary. A test pins the constant to the client-side one so the two cannot silently diverge. Honest limitation: where the serverless ceiling is shorter than 20 s the platform still terminates first; the transport bound is the only ceiling DeptSync controls, and it removes "as long as the platform permits" from every environment, including local and self-hosted.

**Error contract: one new type, nothing more.** `GeminiTimeoutError` (with `timeoutMs`) is the only addition, answering the audited gap that callers could not distinguish failure classes. Non-2xx keeps the SDK's `GoogleGenerativeAIFetchError` with its `.status`, so 429/quota remains distinguishable from 400; network failure, malformed JSON, and not-configured messages are byte-identical to before. The timeout message — *"AI request timed out after 20s — check the connection and try again"* — is operational copy carrying no endpoint URL, model name, or key wording. It is also deliberately checked against `humanizeSupabaseMessage`, which relabels any message containing `does not exist`, `schema cache`, `jwt`, `failed to fetch`, or `networkerror` as a schema/credential/connectivity fault; a timeout must pass through unrewritten, and a test asserts it does.

**Request-count safety: one user action → at most one Gemini attempt, per transport invocation.** Proved behaviourally (one `fetch` per helper call, still one after a timeout and after a network failure) and structurally (a single `generateContent` call site, no loop, no backoff).

**Consumer semantics preserved — nothing in any consumer was changed.** No prompt, schema, normalizer, token budget, persistence path, confirmation boundary, or fallback was touched. Each consumer keeps owning its own `isGeminiConfigured()` branch; the transport still throws the same `GEMINI_API_KEY is not configured` error and never starts a timer on that path. The one *behavioural* improvement is a consequence rather than an edit: `VisualBayScannerModal` sets `phase` inside `try`/`catch` with no `finally`, so a hung request previously stranded the "Scanning bay…" overlay permanently with capture controls disabled. The request now rejects at 20 s, the existing `catch` runs, and the modal returns to `capture` with a visible error — the component is unmodified.

**Field acceptance: NOT REQUIRED.** Under OIE Law 8 the gate is earned by changed field-facing operational behavior. The successful path is unchanged — same request, same prompts, same schemas, same parsing, same UI, no added latency. No gesture, screen, or persisted write changed. What changed is only the *failure* boundary, and every part of it is deterministically testable with mocked `fetch` and fake timers, which is how it is tested. The one field-visible difference is strictly recovery from a state that previously had no recovery. Requiring a Samsung gate would mean asking an operator to reproduce a hung upstream request on store Wi-Fi to observe a timeout that unit tests already prove — evidence deterministic tests supply completely.

**Explicitly not done, and still owned elsewhere:** Executive Floor Pad model-output autosave and unvalidated `metadata` remain **AI-SAFETY-002**; Snap Bay's severed lifecycle remains **SNAP-DECISION-001**; `recommended_percent` ownership remains **FLOORING-AI-001**. No exponential backoff, circuit breaker, retry queue, health service, provider abstraction, telemetry platform, fallback model routing, or request scheduler was built. The `.env.example` model-name drift remains recorded configuration debt, unchanged.

> **Transport safety is infrastructure. Fallback behavior is product behavior.** The dependency may now fail on a clock DeptSync controls; what each surface does about that failure is unchanged.

---

### A1.12 — Adjacent findings from AI-SAFETY-001 (NOT work items)

Recorded observations. **No work item is opened here and nothing was changed.**

- **Floor-Walk Copilot can double-dispatch one gesture.** `finishListening` in `TacticalVoiceFloorPad` has no idempotence guard, and `runParse` has no in-flight guard. If `recognition.stop()` throws, the `catch` calls `finishListening` synchronously and the browser's `onend` then calls it again, producing up to **two** concurrent `parseFloorWalk` requests from one Stop tap. `FloorPadEditor` already solves the same problem with a `finishedRef` latch. This is a **consumer** request-count concern, not a transport retry — the transport still issues exactly one attempt per invocation — and Floor-Walk product behavior is out of scope for this tranche. Belongs to whoever next owns Floor-Walk (WALK-001 / FE-004 remain field-gated).
- **Bay Audit Validate persists before the client can abandon.** `insertBayAuditLog` runs server-side with no confirmation step, so a client that gives up still leaves a row once the server completes. Transport bounding does not change this. Owned by **SNAP-DECISION-001**.
- **`storeOpsFetch` has no client-side timeout.** The 20 s `mutationAbortSignal` is applied only to `/api/rotations/complete`. Five of the six Gemini calls therefore still have an unbounded *client* wait even though the server leg is now bounded. Not in scope: the server bound caps the paid dependency, which is what AI-SAFETY-001 exists to do. A client-side bound is a separate resilience question.
- **`ChunkErrorBoundary` matches Gemini quota text but has zero importers** (re-verified). Its `/429|quota|generativelanguage/i` test is currently dead code. Already recorded as **RESILIENCE-001**.
- **`asGeminiSchema` remains a TypeScript cast, not runtime validation.** Unchanged, as GEMINI-001 recorded. No universal schema architecture was built.

---

## WORKSTREAM B — FLOOR CAPABILITY RECOVERY

### OIE-B1 / FLOOR-HIDDEN-001 — Suppressed Floor Tier Product Review

**Status:** QUEUED AFTER GEMINI-001 DISCOVERY

Evaluate each suppressed surface **individually**:

- Bay Health Scorecard
- Weekly pace pill
- Rotation / Downstock queue controls
- Selling vs Topstock toggle
- Associate filter chips
- Assigned-rotation banner
- CSA overhead-pull assignment reachability

Classify each: `RESTORE / REPOSITION` · `ALREADY REPRESENTED ELSEWHERE` · `FIELD TEST` · `RETIRE` · `NEEDS PRODUCT DECISION`.

> **Explicit prohibition: do NOT simply remove `hideChrome` and restore everything.** Wholesale restoration would violate OIE Law 9, Constitution Art. XV (information hierarchy), and the UX-005 guardrail that Floor keeps a verification-first hierarchy. Several of these surfaces may be correctly absent.

Note for the reviewer: `BayHealthScorecard` is not fully dormant — its `riskScore` already feeds `SundayAuditAssignmentModal`. "Invisible on Floor" is not the same as "unused."

### OIE-B2 / WEEKLY-METRIC-001 — Weekly Progress Semantic Integrity

**Status:** DISCOVERY NOT STARTED

RA-001 found two competing weekly-completion percentages rendering simultaneously with different numerators:

| Formula | Location | Numerator | Surface |
|---|---|---|---|
| `computeDepartmentCompletionPct(verified, assigned)` | `lib/store-ops/health.ts:89` | verified | `StoreHealthCard` |
| `forecastWeeklyPace().actual_pct` | `lib/store-ops/week.ts:163` | reported | ZebraChecklist pace pill |

Both may currently present as generic completion percentages. **This is a truth / semantic problem, not a math problem**, and it is a live instance of Constitution Appendix A-1 (derived weekly completion vs verification) rather than a new defect.

**Future goal:** give distinct operational language to distinct measures. `audit-summary.ts` already models the correct approach by emitting `completion_pct` and `reported_pct` under separate names.

> **Do not collapse the two measures unless product evidence says one should be removed.** Note that OIE-B1 may make the pace pill visible again; these two items must be reviewed together.

### OIE-B3 / BARRIER-001 — Barrier Vocabulary Integrity

**Status:** DISCOVERY NOT STARTED

`BarrierReasonChips` is invoked without `showAll` (`ZebraChecklist.tsx:1301-1304`), so only three quick reasons are tappable from Floor. Unreachable from Floor: **Freight / Pallets In Aisle**, **Short Staffed**, **High Customer Volume**, **Other**.

Downstream consequence: `bucketReason` (`health.ts:117-124`) buckets barriers into Freight / Staffing / Traffic / Other to build the Bottleneck Summary. Three of four buckets cannot be populated from Floor, so that summary is expected to read predominantly "Other."

**Goal:** evidence vocabulary should be rich enough to support downstream deterministic intelligence.

> **Better evidence before better intelligence** (OIE Law 1). This item is a prerequisite for trusting any barrier-derived pattern in Section 6.

---

## WORKSTREAM C — HISTORICAL OPERATIONAL READ-BACK

### OIE-C1 / HISTORY-001 — Bay History Decision-Surface Discovery

**Status:** HIGH PRIORITY DISCOVERY — NOT STARTED

**Already exists:** history API route, typed client wrapper, rotation history, supersede provenance, completion attempts, send-back notes.

**Likely host:** Walk-the-Floor / Map bay investigation sheet. RA-001 noted the route's own doc comment names "Store Map bottom sheet," and that sheet exists and currently shows current state only. This is a hypothesis about placement, not an approved design.

**Questions this tranche must answer:**

- What historical facts actually change a DS decision?
- How much history is useful on a phone?
- Which evidence should remain expandable rather than default-visible?
- What authorization should DS accounts have? (The route is currently `requireSuperAdmin`; changing that is an authority decision under Constitution Art. XIII, not a UI decision.)

> **Do NOT build a generic history module unless evidence requires one** (OIE Law 7).

### OIE-C2 — Completion / Coaching Read-Back

**Potential evidence:** repeated send-backs, notes, recurrence counts, observed coaching themes.

> **Do not automatically create associate performance scoring. Do not create surveillance.**

Evidence here is about **work and rework and coaching context**, not employee ranking. This is bounded by Constitution Art. XIX (Observability Without Surveillance): measure work outcomes and operational state, not unnecessary human activity.

A recorded caution: RA-001 observed that Predictive Copilot's `pace` pattern already derives per-associate completions and surfaces a named associate. That existing behavior is flagged for governance review under this item — it is reported, not resolved, and no disposition is proposed here.

### OIE-C3 — Bay Service History

**Existing:** `bay_service_logs` with `light_touch` / `heavy_packdown` / `critical_hole` plus free-text notes.

**Potential deterministic statements:** repeated heavy packdown · repeated critical hole · recent service frequency.

> **No cause inference** (OIE Law 6).

### OIE-C4 — Verification Latency

**Existing:** `completed_at` / `verified_at` on the rotation row, and `verificationLagMs` / `verificationLagHours` (`rotation-metrics.ts:138,148`) — exported, tested, verified zero importers.

Investigate operational usefulness only.

> **Do not create manager performance scoring.** Use only to identify workflow bottlenecks, and only if it earns its place.

### OIE-C5 — Restaging / Supersede History

**Existing:** typed provenance `FORCE_DRAW` / `ADMIN_RESET` / `CONFLICT_CLEAR` on superseded `weekly_rotations` rows, currently used only as a filter.

Determine whether restaging history matters to a DS decision. Note the adjacent known debt already recorded in `MASTER_ROADMAP.md`: "Sunday assignment history across Force Draw / rebalance — known P1."

---

## WORKSTREAM D — WALK / TASK LOOP

### OIE-D1 / WALK-001 — Shift Walk Task Read-Back

**Status:** DEFERRED UNTIL FIELD EXPERIMENT — canonical ID preserved from `MASTER_ROADMAP.md` and the UX-005 backlog

**Current state:** Walk & Talk persists `shift_walk_tasks` via `dispatchShiftWalkTasks`. Read / open / resolve functions already exist (`fetchShiftWalkTasks`, `openShiftWalkTasks`, `resolveShiftWalkTask`, `subscribeShiftTasks`). No UI consumer. `lib/ux005c.floor-operational-simplicity.contract.test.ts:255-266` asserts the read helpers stay unimported from Floor and the drawer — that contract remains in force and is **not** to be weakened by this program without an explicit owning tranche.

**Required field evidence (FE-004):** run an actual Walk & Talk, return the next shift, attempt to work from the previous tasks, and observe what external workaround is used instead.

> **Do not implement merely because read functions exist** (OIE Law 9). The workaround a DS reaches for is the actual requirement.

---

## WORKSTREAM E — APPLIANCE TEACHING

### OIE-E1 / APP-TEACH-001 — Catalog Teaching Workflow

**Status:** FIELD EVIDENCE PENDING

**Canonical distinction:**

- **TEACH** = establish durable item / identifier knowledge.
- **COUNT** = record physical evidence inside an audit.

**What RA-001 proved:** catalog teaching and physical observation are **already separable at the API and data layer**. `POST /api/appliances/catalog/identifiers` states in its own header that it "does not rewrite scans." `POST /api/appliances/catalog/ensure` is idempotent and non-destructive. `ApplianceCatalogManageSheet.handleSave` calls `saveApplianceCatalogItem` and never `commitScan`.

**Where they are fused:** one UI callback. `handleQuickAdded` (`components/sections/ApplianceScanForm.tsx:443-460`) unconditionally calls `commitScan(item)` after every teach outcome — Link Existing, Create New, and Finish Classification. The button labels reflect it: "Save, Log Scan & Continue" and "Save classification & log scan."

**The practical gap is input method, not capability.** Pure teaching exists today through Manage appliance mappings, but that surface has no wedge listener — identifiers must be typed. Wedge scanning is bound exclusively to the observation-producing surface.

**Product hypothesis:** "Ad-hoc Scan" may conceal a more valuable **Teach Items** workflow.

**Do not implement until both are complete:**

1. **APP-CAT-001A ESL field revalidation** — still pending on Samsung hardware; the three quarantined records remain preserved and must not be retried, discarded, or cleared.
2. **Teach-ahead field experiment (FE-001).**

**Potential future principle (candidate, not adopted):**

> **Teach once. Count quickly later.**

### OIE-E2 — Ad-Hoc Observation

Preserve deliberate unbound physical observation as a valid capability.

RA-001 confirmed this path is correctly and deliberately defended: `handleAdHocScan` sets `ignoreCachedAuditSession`, and the server enforces "Explicit membership only (APP-AUD-002B). Omitted `audit_session_id` → unbound. Never infer the store's ACTIVE audit." A deliberate ad-hoc scan during an active audit produces an unbound observation and cannot contaminate the count.

> **Do not accidentally eliminate this if APP-TEACH-001 changes naming or flow. Teaching and observing are distinct jobs.**

### OIE-E3 — Appliance Identifier Architecture

Maintain: **many scannable identifiers → one canonical Lowe's item.**

> **Do not assume ESL encoding semantics without field evidence.** APP-CAT-001B (bulk catalog promotion) remains deferred.

---

## WORKSTREAM F — PARKED DETERMINISTIC INTELLIGENCE

### OIE-F1 / REC-001 — Runtime Admission Review

Engine exists and is tested. **Do not wire automatically.**

Determine:

- The correct decision surface.
- Required evidence maturity before its output would be trustworthy.
- Whether a DS would actually act differently because of the consideration.
- **Whether Current Attention (SI-001) already answers enough of the question.** This is the decisive question — SI-002 was already deferred on exactly this reasoning, and `MASTER_ROADMAP.md` records that "Current Attention remains the final current-state intelligence until recommendation architecture needs a stronger intermediate boundary."

Noted for the reviewer: REC-001's inputs already exist on Floor (`weekMetrics.stagingDeficit` and `fetchLocationAttention`), with staged location ids derivable from `displayRotations`. Wiring difficulty is low. **Low wiring cost is not an argument for wiring it** (OIE Law 9).

### OIE-F2 / LAB-001 — Runtime Admission Review

Engine exists and is tested. **Do not wire automatically.**

RA-001 found a natural evidence source: `associate_shift_days`, already written by `upsertShiftDay` / `upsertShiftWeek` including forward-dated weeks. `LabPersistedShiftDayInput` is field-for-field identical to `AssociateShiftDay`.

RA-001 also found that call-out redistribution currently assigns every on-duty peer a flat `hours: 8` (`lib/store-ops/call-out.ts:126-132`) despite actual day-schedule evidence being available two lines above — so the hours-proportional balancer is effectively uniform in the call-out path. LAB-001 exists specifically to refuse that fallback.

> **Do not wire until the current labor / call-out workflow is field evaluated.** The goal is **operational capacity reasoning, not productivity surveillance**. CAP-001 remains deferred; `weekly_bay_target` remains desired staging volume, not capacity.

A compatibility note for whoever eventually wires it: `memberMatchesDepartment` (`labor-availability.ts:312-322`) uses strict `===` rather than `departmentCodesMatch`, so D23-vs-`flooring` aliasing will need attention at that time.

---

## WORKSTREAM G — SPATIAL INTELLIGENCE

### OIE-G1 / SPATIAL-001 — Predictive Copilot / Map Relationship

Existing adjacency logic (`adjacent()`, `predictive-copilot.ts:95` — the only true geographic-proximity function in the codebase) sits in Predictive Copilot, which renders on **Floor**, inside a collapsed drawer. Map owns the actual spatial investigation surface and the rendered aisle/bay geometry.

Investigate whether spatial considerations belong in Map context, consistent with Constitution Art. XI ("Priority aisle / bay context → Map").

> **No new adjacency engine.** Also note UX-005D (Map operate vs investigate) is open and must not be preempted by this item.

### OIE-G2 — Bay Freshness

`composeBayFreshness` and `BayFreshnessGrid` already exist and are complete. `FloorTab` currently consumes two integers (`cells.length`, `staleCount`) from a composition that also returns per-cell ages, warm/fresh counts, stale tags, and a most-stale-aisle focus recommendation.

> **Do not rebuild.** UX-005C intentionally removed the duplicate drawer presentation only; a contract test deliberately preserves both the component and the freshness math in the repository.

Any future use must prove it answers a DS decision **not already handled by Current Attention**. RA-001 noted three independent staleness taxonomies over the same two timestamp columns (bay-tracker thresholds, velocity decay, readiness/attention). Their separation is documented and intentional, but no surface explains the difference to a DS — which is itself a UX-005E (operational language) concern, not an engine concern.

---

## WORKSTREAM H — RESILIENCE / RECOVERY

### OIE-H1 / SYNC-UX-002 — Sync Recovery Product Language

`SyncQueuePanel` is functionally an incident recovery console — quarantine list with per-item retry and discard, plus the offline capability matrix. It is named and placed as a diagnostic.

Investigate naming / placement **after more field evidence**. Note that APP-SYNC-UX-001 already improved this path (attention copy reworded to "sync issues," made navigable to `/settings#sync-queue`, per-operation subject identity) and remains Samsung-acceptance pending.

> **Do not reduce supervisor safety controls.** Constitution Art. XV places diagnostics last, so any elevation must be argued, not assumed.

### OIE-H2 / RESILIENCE-001 — ChunkErrorBoundary

`components/hub/ChunkErrorBoundary.tsx` is built and has zero importers (verified). The app relies heavily on `dynamic()` imports, so a failed chunk fetch on store Wi-Fi may surface as a blank region rather than a recoverable retry.

Investigate whether store Wi-Fi / PWA chunk failures warrant wiring it.

> **This is resilience, not intelligence.** It does not compete with product loops for priority, and it is not an intelligence-layer item.

### OIE-H3 / CACHE-SAFETY-001 — Clear Local Cache Semantics

RA-001 found the Settings "Clear Local Cache" action clears three keys (`appliance_scans_offline`, `carpet_remnants_offline`, `carpet_hub_sync_queue`) and does **not** clear the IndexedDB durable cache or several other `deptsync_*` keys — while silently purging the sync queue, which discards unsynced work.

The label may therefore **overstate cache coverage while understating destructive effect**.

> **Treat as safety / product-truth debt, not cleanup.** Requires a focused audit before any change. This is a Rule 3 (trust) concern and belongs in the SECURITY / TRUTH category of Section J, not the CLEANUP category.

---

## WORKSTREAM I — SPECIALTY / FLOORING

### OIE-I1 / FLOORING-AI-001 — Flooring Insights AI Necessity

**Status after GEMINI-001:** DISCOVERY PENDING / NOT STARTED. Disposition recorded as **OPTIONAL AI** (see A1.2).

**Open question this item now owns:** should Gemini remain only an explanation layer, and should `recommended_percent` become deterministic or human-declared? GEMINI-001 verified that Gemini performs no measurement math and cannot invent a remnant, but `recommended_percent` is a model-originated number that reaches `carpet_remnants` when a supervisor applies it.

Part of GEMINI-001. Separate the layers explicitly:

- calculations / math (Layer 1)
- structured inventory evidence (Layer 0)
- unstructured interpretation (candidate AI boundary)
- consideration (Layer 4)
- generative explanation (Layer 5)

RA-001 noted the existing architecture is already strong here: the route runs `buildLocalFlooringInsights` **first**, sends only a compacted packet, and `normalizeFlooringInsights` drops any candidate not in the local map and re-derives `days_old` / `aging_tier` / `aging_band` from the actual record — so the model is structurally incapable of inventing a remnant or restating its age.

> **Do not use Gemini for deterministic math.**

### OIE-I2 — Specialty Primitive Reuse

RA-001 identified several flooring-scoped modules that are already cross-department in practice (`barcode.ts`, `hardware-scanner.ts`, `scan-feedback.ts`, `catalog/taxonomies.ts`) and one that is not (`RollMeasurementPad`, single importer).

> **Do not abstract existing Flooring primitives merely because reuse is possible. Require a confirmed second consumer** (Constitution Art. XX).

---

## WORKSTREAM J — LOW-PRIORITY / CLEANUP / SECURITY DEBT

Recorded for completeness. **Do NOT prioritize over product loops.** These three categories must not be conflated.

### PRODUCT VALUE
| Item | Note |
|---|---|
| ~~Snag Triage reachability~~ | **RESOLVED by AI-RETIRE-001 (2026-09-08)** — job retired, not rebuilt; route, classifier, fallback, dispatcher, and client helper deleted (A1.10) |
| Orphan `POST /api/push/dispatch` | Implemented, Super-Admin gated, no client caller. "Tell the department something now" has no button |
| `WeeklyRotationList` dead shim | 10-line re-export, zero importers |

### SECURITY / TRUTH
| Item | Note |
|---|---|
| Edge protection uncertainty on `/api/v1/*` | Route handlers contain no in-route authorization. `CHAT_HANDOFF.md` asserts an edge gate. **Unverified — middleware/edge config not audited.** Must be confirmed before anyone relies on it |
| Possible `sunday_bay_assignments.assigned_week` production mismatch | `app/api/rotations/verify/route.ts:86-89` queries a column absent from every migration; the destructure discards `error`. If correct, the DS verification queue shows the literal fallback "Associate" for every bay. **Strong inference, not database-confirmed** |
| CACHE-SAFETY-001 | Cross-listed from OIE-H3 |
| Hardcoded `canMutate={false}` Map behavior | `StoreLocationGrid.tsx:597,703` disables bay activate/pause and "Pin to this week" by literal, while `canManageMapConsole` is imported and used only for empty-state copy. Whether this is intentional lockdown or drift is unresolved |

### CLEANUP
| Item | Note |
|---|---|
| Orphan `/api/v1/topology/ingest` | Honestly documented as a stub in four places; returns literal `processed_bays: 1` |
| Orphan `/api/v1/freight/stage` | Same |
| Stale SMS / invite residue | `issueRosterInvite`, all of `lib/onboarding/load-invite.ts` — QR pairing won; this is residue, not capability |
| Obsolete RBAC exports | ~10 exports superseded by `lib/nav-hub.ts`, incl. `visibleNavTabs`, `canMutateStoreMap` |

---

## 6. Historical Pattern Intelligence Candidates

These are Layer-2 candidates built from evidence that **already exists**. They are **NOT approved features**. Each requires an owning tranche, an evidence-maturity check under OIE Law 1, and a decision surface under OIE Law 7.

### Rework Recurrence
> "Bay 14 was sent back in 3 of its last 5 completion attempts."

**Evidence:** `weekly_rotation_completion_attempts`.
**Prerequisite:** OIE-C1 read-back must exist first. **Gated by OIE-C2 surveillance constraints.**

### Repeated Service Burden
> "This bay recorded heavy packdown 4 times in the last 30 days."

**Evidence:** `bay_service_logs`.

### Verification Backlog
> "7 completed bays are awaiting verification."

**Evidence:** current rotation state (Layer 1, already derivable). The lowest-evidence-risk candidate in this list.

### Verification Lag
> "Median wait from reported complete to verified is X hours."

**Evidence:** `completed_at` / `verified_at`; `verificationLagHours` exists.
Only if operationally useful. **Do NOT attribute lag to a person.**

### Manual Intervention Pattern
> "This bay was manually selected 5 times this cycle."

**Evidence:** `store_locations.manual_priority_count`, rotation history.
Relevant because `adaptiveDrawWeight` already consumes this value as a draw weight without telling anyone. **Do not infer cause.**

### Restaging Instability
> "This week's plan was superseded twice."

**Evidence:** supersede provenance.

### Appliance Recurrence
Continue existing APP-ROT / APP-INT discipline: variance recurrence, follow-up recurrence, physical observation changes. **APP-INT-001 remains gated on longitudinal evidence** per `MASTER_ROADMAP.md` — this section does not accelerate it.

---

### Standing constraint for every candidate above

> **Pattern ≠ cause.**
> **Pattern ≠ prediction.**
> **Pattern ≠ performance score.**

---

### 6.1 — No-cost intelligence finding (GEMINI-001)

**Seven of eleven audited operational intelligence candidates already have deterministic engines:**

- verification backlog
- verification lag
- bay freshness
- current attention pressure
- staging consideration
- labor availability
- appliance recurrence

> **The absence of Gemini does not reduce these capabilities.**

The remaining four have supporting data but **no engine**, and they remain **candidates only** — this finding does not approve them:

- rework recurrence
- service burden recurrence
- restaging instability
- manual intervention frequency

---

## 7. Generative AI Decision Standard

A reusable test. Answer all ten before **adding OR retaining** a Gemini call.

1. Is the input genuinely unstructured?
2. Can deterministic code already answer the operational question?
3. Does the model add new useful information, or merely rewrite existing information?
4. Is the result validated against authoritative rules?
5. Does a human confirm before authoritative mutation?
6. Is the model output persisted?
7. Can its accuracy / value be evaluated later?
8. What happens offline?
9. What is the approximate call frequency?
10. Does the product job itself earn its place?

**Decision outcomes:** `RETAIN AI` · `OPTIONAL AI` · `REPLACE DETERMINISTICALLY` · `REMOVE JOB` · `FIELD EVIDENCE NEEDED`

**Observed pattern from RA-001, offered as calibration:** every capability that currently earns its place shares three properties — genuinely unstructured input with no deterministic peer (Q1/Q2), a mandatory human confirmation before authoritative write (Q5), and a normalizer that validates every model claim against institutional rules (Q4). Capabilities failing Q1 tended to be duplicative. Capabilities failing Q7 tended to be unprovable rather than unhelpful.

---

## 8. Field Experiment Register

Experiments require **no repository change**. Results must be recorded honestly; **do not invent results**.

### FE-001 — Appliance Teach-Ahead
Teach a small appliance category before a formal audit (Manage appliance mappings, typed identifiers) and observe the resolution rate during the subsequent audit.

- **STATUS:** PENDING
- **DATE:** —
- **RESULT:** —
- **PRODUCT CONSEQUENCE:** Gates OIE-E1 / APP-TEACH-001. Distinguishes whether value lies in teach-ahead *as a workflow* or specifically in teach-ahead *by scanning*.

### FE-002 — Barrier Vocabulary
Use Floor barriers for one week; record every real situation that could not be expressed with the three available reasons.

- **STATUS:** PENDING
- **DATE:** —
- **RESULT:** —
- **PRODUCT CONSEQUENCE:** Gates OIE-B3 / BARRIER-001 and determines whether Bottleneck Summary is currently trustworthy.

### FE-003 — Send-Back History
Send a bay back with a note; later attempt to retrieve that context.

- **STATUS:** PENDING
- **DATE:** —
- **RESULT:** —
- **PRODUCT CONSEQUENCE:** Gates OIE-C1 / HISTORY-001 and OIE-C2.

### FE-004 — Walk & Talk Continuity
Dispatch actual Walk & Talk tasks; return the next shift and attempt to work from them; observe the external workaround used.

- **STATUS:** PENDING
- **DATE:** —
- **RESULT:** —
- **PRODUCT CONSEQUENCE:** Gates OIE-D1 / WALK-001. The workaround observed defines the read-back requirement.

### FE-005 — Ad-Hoc Isolation
During an active physical audit, deliberately ad-hoc scan known units and confirm the audit reconciliation count does not change.

- **STATUS:** PENDING
- **DATE:** —
- **RESULT:** —
- **PRODUCT CONSEQUENCE:** Confirms APP-AUD-002B unbound-observation behavior in the field. A count change would be a serious integrity finding requiring immediate attention.

---

## 9. Program Sequence

| Phase | Contents | Status |
|---|---|---|
| **PHASE 0** — Program Foundation | OIE-000 canonical plan | Complete |
| **PHASE 1** — Understand AI Cost / Necessity | **GEMINI-001 — DISCOVERY COMPLETE** | Dispositions recorded (A1.2) |
| **PHASE 1A** — First approved AI reduction | **AI-REDUCE-001 — Deterministic Shift Briefing** | **FIELD ACCEPTED — CLOSED** (2026-09-08) — first fully closed OIE implementation tranche |
| **PHASE 1B** — Second approved AI reduction | **AI-REDUCE-002 — Deterministic Catalog Taxonomy** | **IMPLEMENTATION ACCEPTED — CLOSED** (2026-09-08) — no field gate required; closed a department-identity defect (A1.8) |
| **PHASE 1C** — First approved AI retirement | **AI-RETIRE-001 — Retire Orphaned Snag Triage** | **IMPLEMENTATION ACCEPTED — CLOSED** (2026-09-08) — job retired, not rebuilt; closed a lowest-tier three-table write path (A1.10) |
| **PHASE 1D** — Shared AI resilience | **AI-SAFETY-001 — Bound Gemini Transport Failure** | **IMPLEMENTATION ACCEPTED — CLOSED** (2026-09-08) — no field gate required; one bounded attempt, zero retry added, no consumer changed (A1.11) |
| **PHASE 2** — Recover Existing Operational Value | FLOOR-HIDDEN-001, HISTORY-001 | **Still queued — priority unchanged**; order within phase may change from evidence |
| **PHASE 3** — Repair Evidence Quality | Weekly-progress semantics, barrier vocabulary, any proven audit-linkage / data-integrity issue | — |
| **PHASE 4** — Close Existing Loops | WALK-001 if field proven; historical decision read-back; spatial intelligence placement where earned | — |
| **PHASE 5** — Admit Parked Intelligence | REC-001 review, LAB-001 review — **only after evidence / read-back prerequisites are healthy** | — |
| **PHASE 6** — Appliance Workflow Evolution | APP-TEACH-001 after ESL + teach-ahead evidence | Timing may move independently |
| **PHASE 7** — Reliability / Cleanup | Recovery language, chunk error boundary, dangerous cache semantics, orphan / stub / security cleanup | — |

**Appliance timing may move independently** of this sequence because field access determines when evidence becomes available.

> **The sequence is evidence-sensitive, not rigid. A production defect or a strong field discovery may preempt it.**

Two standing exceptions: a confirmed **security or truth** finding from Workstream J may preempt any phase; and UX-005 field acceptances (UX-005B, UX-005C) remain independently outstanding and are not blocked by this program.

**Phase 1A note:** the program now has a low-risk AI reduction available before Phase 2. This does **not** demote FLOOR-HIDDEN-001 or HISTORY-001 — both retain their recorded priority, and HISTORY-001 remains a HIGH PRIORITY DISCOVERY. AI-REDUCE-001 was sequenced first only because it was isolated, evidence-complete, and required no field evidence *before* starting; it has since been field accepted and closed (A1.7).

---

## 10. Work Item Status Table

`Implementation Status` values follow existing repository convention. **Engineering complete ≠ field accepted** (OIE Law 8).

| ID | Work Item | Type | Evidence | Status | Dependencies | Field Gate | Implementation Status |
|---|---|---|---|---|---|---|---|
| **OIE-000** | Operational Intelligence Evolution Program | Program foundation | RA-001 | PROGRAM FOUNDATION COMPLETE | — | None (docs) | Documentation only |
| **GEMINI-001** | Generative Cost & Necessity Audit | Discovery | RA-001 §9 | **DISCOVERY COMPLETE — DISPOSITIONS RECORDED** | OIE-000 | Snap Bay + Visual Bay Scan remain field-gated | Discovery only — no runtime change |
| **AI-REDUCE-001** | Deterministic Shift Briefing | AI reduction | GEMINI-001 A1.2 — zero Gemini-only fields; field evidence A1.7 | **FIELD ACCEPTED — CLOSED** (2026-09-08) | GEMINI-001 | **MET** — real DS-device operational state-change test | Route + client AI path removed; 20 contract tests; 784/784 suite green; field accepted |
| **AI-REDUCE-002** | Deterministic Catalog Taxonomy | AI reduction | GEMINI-001 A1.2 — static input, registry ships; escalation in A1.8 | **IMPLEMENTATION ACCEPTED — CLOSED** (2026-09-08) | GEMINI-001 | **None required** — no field-facing operational surface changed (A1.8) | Route + AI module + Generate interaction removed; department-identity defect fixed; 18 contract tests; 802/802 suite green; accepted without a field gate |
| **AI-RETIRE-001** | Retire Orphaned Snag Triage | Retirement | GEMINI-001 A1.2 — zero invocation path; escalation in A1.10 | **IMPLEMENTATION ACCEPTED — CLOSED** (2026-09-08) | GEMINI-001 | **None required** — no user-reachable surface existed (A1.10) | Route + classifier + fallback + dispatcher + client helper deleted; 14 contract tests; 816/816 suite green; no historical rows touched |
| **AI-SAFETY-001** | Bound Gemini Transport Failure | Resilience | GEMINI-001 A1.4 — no timeout/abort/retry ceiling; premise re-verified at HEAD (A1.11) | **IMPLEMENTATION ACCEPTED — CLOSED** (2026-09-08) | — | **None required** — successful path unchanged; failure semantics fully testable deterministically (A1.11) | 20 s bound + transport-owned `AbortController` + timer cleanup in `finally`; **zero retry added because none existed**; `GeminiTimeoutError` the only new type; 27 transport tests; 843/843 suite green; **no consumer file changed** |
| **AI-SAFETY-002** | Executive Floor Pad Model-Output Boundary | Safety / truth | GEMINI-001 A1.2 — autosave without confirm; unvalidated metadata | **QUEUED — NOT STARTED** | — | None | Not started |
| **SNAP-DECISION-001** | Snap Bay Repair-or-Retire Decision | Product / truth decision | GEMINI-001 A1.3 — lifecycle SEVERED | **HIGH PRIORITY PRODUCT/TRUTH DECISION — NOT STARTED** | UX-005F evidence | **Yes — UX-005 Question #3** | Not started — outcome must be REPAIR LIFECYCLE *or* RETIRE CAPABILITY |
| **FLOOR-HIDDEN-001** | Suppressed Floor tier product review | Discovery + product decision | RA-001 §3.1 | QUEUED | GEMINI-001 discovery | Yes — per-surface | Not started |
| **HISTORY-001** | Bay history decision-surface discovery | Discovery | RA-001 §3.3 | HIGH PRIORITY DISCOVERY | — | FE-003 | Not started |
| **WEEKLY-METRIC-001** | Weekly progress semantic integrity | Truth / semantics | RA-001 §6; Constitution App. A-1 | DISCOVERY NOT STARTED | Review with FLOOR-HIDDEN-001 | Yes | Not started |
| **BARRIER-001** | Barrier vocabulary integrity | Evidence quality | RA-001 §10 | DISCOVERY NOT STARTED | — | FE-002 | Not started |
| **WALK-001** | Shift walk task read-back | Loop closure | RA-001 §5.3; UX-005 backlog | DEFERRED UNTIL FIELD EXPERIMENT | — | **FE-004 required** | Not started — contract test asserts non-implementation |
| **APP-TEACH-001** | Appliance catalog teaching workflow | Workflow evolution | RA-001 §8 | FIELD EVIDENCE PENDING | APP-CAT-001A ESL revalidation | **FE-001 + ESL revalidation** | Not started |
| **REC-001** | Department staging consideration | Runtime admission review | RA-001 §3.2 | FOUNDATION IMPLEMENTED — NOT LIVE | Phase 2–4 prerequisites | Yes | Engine + 46 tests; no runtime consumer (intentional) |
| **LAB-001** | Department scheduled labor availability | Runtime admission review | RA-001 §3.2 | FOUNDATION IMPLEMENTED — NOT LIVE | Labor / call-out field evaluation | Yes | Engine + 53 tests; no runtime consumer (intentional) |
| **SPATIAL-001** | Predictive Copilot / Map relationship | Placement | RA-001 §4.5 | DISCOVERY NOT STARTED | Must not preempt UX-005D | Yes | Not started |
| **SYNC-UX-002** | Sync recovery product language | Naming / placement | RA-001 §4.10 | DEFERRED — FIELD EVIDENCE | APP-SYNC-UX-001 acceptance | Yes | Not started |
| **RESILIENCE-001** | ChunkErrorBoundary wiring | Resilience | RA-001 §11 | RECORDED — NOT PRIORITISED | — | Yes | Not started; component orphaned |
| **CACHE-SAFETY-001** | Clear Local Cache semantics | Safety / product truth | RA-001 §10 | RECORDED — AUDIT REQUIRED | Focused audit | Yes | Not started |
| **SNAP-001** | Snap Bay lifecycle + product value | Integrity + product | RA-001 §5.2; **GEMINI-001 A1.3** | **LIFECYCLE VERIFIED SEVERED** — superseded for decision by SNAP-DECISION-001 | — | Yes | Not started; UX-005 Question #3 open |
| **FLOORING-AI-001** | Flooring insights AI necessity | AI necessity | RA-001 §9; GEMINI-001 A1.2 | **DISCOVERY PENDING — NOT STARTED** (disposition OPTIONAL AI) | GEMINI-001 | Yes | Not started — open question is `recommended_percent` ownership |

**Existing canonical IDs referenced but not owned by this program:** UX-005D, UX-005E, UX-005F (UX-005 backlog) · APP-CAT-001A, APP-CAT-001B, APP-ROT-001, APP-INT-001, APP-OBS-001, APP-AUD-002 (appliance roadmap) · SI-001, SI-002, CAP-001, FS-001A, FS-003 follow-ups (master roadmap).

---

## 11. "Do Not Build Yet" Register

- **No new generic intelligence engine.**
- **No generic history dashboard.**
- **No replacement bay-freshness engine.**
- **No new AI surface.**
- **No deterministic computer-vision replacement for Snap Bay.**
- **No REC-001 runtime wiring yet.**
- **No LAB-001 runtime wiring yet.**
- **No WALK-001 before field evidence (FE-004).**
- **No APP-TEACH-001 before ESL revalidation + teach-ahead evidence (FE-001).**
- **No flooring abstraction without a confirmed second consumer.**
- **No wholesale restoration of `hideChrome` surfaces.**
- **No causal employee scoring.**
- **No productivity surveillance.**
- **No universal risk score.**
- **No new fifth bottom nav tab.**

Added by GEMINI-001 (2026-09-08):

- **No deterministic UI replacement for Snag Triage** — retire the job, do not rebuild it.
- **No wiring of Snag Triage merely because its local fallback works.**
- **No universal runtime schema-validation architecture for model output** without evidence that a specific path's authoritative consequence requires it.
- **No Snap Bay repair before SNAP-DECISION-001** — the answer may be retirement.
- **No AI reduction of the language copilots or Flooring Insights** — deliberately excluded from the reduction sequence (A1.5).

Added by AI-SAFETY-001 (2026-09-08):

- **No Gemini retries.** The transport performs one bounded attempt. No retry existed before this tranche and none was added; reintroducing one requires evidence that a specific consumer needs it, not the phrase "retry ceiling."
- **No exponential backoff, circuit breaker, retry queue, AI health service, provider abstraction, AI telemetry platform, fallback model routing, or request scheduler.**
- **No caller-supplied `AbortSignal` on the transport** until a consumer actually needs cancellation. A contract test asserts it stays uninvented.
- **No second network-patience constant.** The Gemini bound is pinned to `STORE_OPS_FETCH_TIMEOUT_MS`; do not fork a competing timeout vocabulary.
- **No persistence, authority, or product decision inside `lib/ai/gemini.ts`.**

Inherited prohibitions that remain in force: SI-002 ranking must not be revived · CAP-001 inferred bay capacity remains rejected · APP-CAT-001B bulk promotion remains deferred · the UX-005 do-not-touch guardrails remain active in full.

---

## 12. Acceptance Standard

Every implementation tranche in this program must report:

1. **Constitutional Articles** engaged.
2. **OIE work item** ID.
3. **Evidence** supporting the change.
4. **Existing capability reused** (OIE Law 2 — state what was searched for and found).
5. **Whether AI was added / retained / removed.**
6. **Authoritative vs derived vs intelligence boundaries** touched.
7. **Test gate** — contracts added, full suite result, typecheck, build, lint parity.
8. **Diff scope** — explicitly including what was *not* changed.
9. **Documentation update** — journal, handoff, roadmap, and any owning backlog.
10. **Field acceptance requirement** — and whether it is met or pending.

> **A tranche is not complete merely because it compiles.**

---

## 13. Program North Star

> **DeptSync should not try to look intelligent. It should become useful enough that its intelligence is obvious from the decisions it helps a Department Supervisor make.**

> **Every visible feature must earn its place.**
> **Every invisible engine must earn its complexity.**
> **Every recommendation must be traceable to evidence.**
> **Every paid AI call must contribute something deterministic DeptSync cannot already know.**

---

*End of DeptSync Operational Intelligence Evolution Plan.*
