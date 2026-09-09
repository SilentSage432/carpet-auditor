# UX-005 — Operational Simplicity Governing Backlog

**Status:** Active program constraints  
**Established:** 2026-09-07 (post UX-005 discovery)  
**Authority:** Discovery audit + this backlog. Lower docs must not silently close open questions.

> **UX-005A / UX-005B are early tranches, not the entire UX-005 program.**

Do not silently resolve, delete, or discard open questions during an early tranche unless that tranche explicitly owns them.

---

## Program sequence

| Tranche | Scope | Status |
|---------|-------|--------|
| **UX-005A** | Appliances operational home simplification | Implemented — real-hardware acceptance pending |
| **UX-005B** | Specialty findability (Appliances-first Floor entry) | Implemented — Samsung acceptance pending |
| **UX-005C** | Floor secondary drawer | Implemented — Samsung acceptance pending |
| **UX-005D** | Map operate vs investigate | Open — do not preempt |
| **UX-005E** | Operational language | Open — do not preempt |
| **UX-005F** | AI earn-your-place review | Open — do not preempt. **Repository-level evidence now supplied by GEMINI-001** (see below) |
| **UX-005G** | Focused workspace navigation suppression | **FIELD ACCEPTED / CLOSED** — bottom nav stands down while a focused workspace owns the viewport (`lib/ui/focused-workspace.ts`; `NavigationHub` is the sole consumer). Added out of sequence from Samsung field evidence, so it preempts nothing: D, E, and F remain untouched. Device acceptance passed for its five surfaces; the single exception is discharged by UX-005G.1 |
| **UX-005G.1** | Add Team Member focused workspace coverage | Implemented — Samsung acceptance pending. Roster → Add Team Member was classified *ambiguous / unchanged* by UX-005G archaeology and left alone pending evidence; the device resolved the classification, and the surface now claims the **existing** occupancy mechanism. **No new architecture, no additional UX-005 identifier consumed** |

Do not preempt later tranches inside an earlier one.

**GEMINI-001 coordination (2026-09-08).** The read-only GEMINI-001 audit recorded in [`OPERATIONAL_INTELLIGENCE_EVOLUTION_PLAN.md`](OPERATIONAL_INTELLIGENCE_EVOLUTION_PLAN.md) §5 Workstream A supplies **repository-level** evidence for UX-005F covering Snap Bay, the predictive/AI questions where applicable, and every remaining Gemini surface. It does **not** close UX-005F. UX-005F's own acceptance conditions require **field** evidence, and none has been produced. No field result has been invented or assumed.

---

## Question its place — field evidence required

| # | Question | Evidence needed | Ownership |
|---|----------|-----------------|-----------|
| 1 | Appliances under More vs elevated specialty entry | Do DS users find Floor entry instinctive? Still use More? Interfere with Floor? | **UX-005B implemented** (Floor contextual entry) — **not field-accepted yet**; More remains secondary path |
| 2 | Dual Start Physical Audit CTAs | Are they always redundant in actual operation? | **Owned by UX-005A** — duplicate competing Start removed; single panel CTA |
| 3 | Ephemeral Visual Bay Scan promotion + Gemini cost | Does *ephemeral* visual scanning materially change real DS decisions? | **Narrowed 2026-09-08 — the question now covers only the surviving ephemeral capability.** **Snap Bay persisting path: RETIRED** (SNAP-DECISION-001 chose RETIRE; **SNAP-RETIRE-001 — IMPLEMENTATION ACCEPTED — CLOSED**), which deleted Bay Audit Validate, its completion gate, and the Floor entry that reached it. Repair was rejected because the intended job — a model verdict gating completion — conflicts with Art. X and Appendix B row B, and because no evidence loop existed to repair. That half is no longer an open question. **Visual Bay Scan: FIELD EVIDENCE NEEDED** — its product value at the three surviving mounts, and whether Floor should host an ephemeral entry at all, remain open for **UX-005F**. Retirement of the persisting path does not imply the ephemeral path is retained permanently |
| 4 | Walk & Talk vs Executive Floor Pad | Two genuine jobs or duplicate mental models? | **Not owned** — remains open (product). **UX-005C did not resolve it**: the two were not merged or renamed |
| 5 | Velocity Heatmap | Used instead of or alongside Standard Map? | **Not owned** — remains open (UX-005D) |
| 6 | Flooring cycle audit vs Floor Sunday | Different Flooring jobs or overlapping concepts? | **Not owned** — remains open (product); **UX-005B did not resolve** |
| 7 | Predictive copilot | Recommendations acted on or routinely ignored? | **Not owned** — remains open (UX-005F). **GEMINI-001 narrowed the scope:** the Predictive Copilot surface is deterministic and has no Gemini dependency, so this is a product-value question, not an AI-cost question |
| 8 | Appliance action bar | Needed in normal counting, or only reset/recovery? | **Partial UX-005A** — demoted under More appliance tools; behavior **not** removed |

---

## UX debt — preserve for later tranches

- Appliances home still can expose some implementation architecture (mitigated by UX-005A spine; further polish may remain)
- Appliances primary specialty no longer *only* under More (UX-005B Floor entry); More remains secondary — field evidence still required before closing #1
- Map errors leak engineering language
- “Sunday Cycle Audit Engine” language
- “Predictive copilot” language
- “Velocity Heatmap” language
- Verification duplicated in secondary Floor drawer (**still open after UX-005C** — Weekly Audit Rollup remains a primary drawer action opening the same verification modal as the Floor strip; UX-005C reordered, it did not de-duplicate verification)
- Executive Floor Pad has dual mental entry
- **WALK-001 — Shift Walk Task Read-Back:** Walk & Talk writes `shift_walk_tasks` via `dispatchShiftWalkTasks`, but `fetchShiftWalkTasks` has no UI consumer. **Deferred — explicitly not owned by UX-005C**, which improved placement only

---

## Product debt — do not solve as pure UI cleanup

- Does Snap Bay earn its ongoing Gemini cost?
- Does Walk & Talk earn its place?
- Do AI briefing / insights surfaces change decisions?
- Does Flooring cycle audit remain a separate product surface?
- Does ad-hoc appliance scanning deserve a peer operational CTA?
- Should associates ever receive specialty-tool access?

These require product evidence, not just visual simplification.

---

## Architecture debt — do not disguise as UX work

- Workflow keep-alive tabs vs specialty hub dual shell (**unchanged by UX-005B**)
- Legacy deep-link aliases
- ~~Snag triage API with no current UI~~ — **RESOLVED (AI-RETIRE-001, 2026-09-08):** the job was retired rather than given a UI; route, classifier, fallback, dispatcher, and client helper deleted
- Floor + Map independent attention fetches
- Deterministic “Predictive copilot” named as if generative AI

**UX-005A/B must not expand into architecture refactoring.** Later UX tranches likewise must not smuggle architecture work unless deliberately scoped.

---

## Do-not-touch guardrails

Preserve unless new field evidence directly disproves them:

- Floor / Map / Roster / More bottom navigation
- Floor verification-first hierarchy
- Current Attention hidden when no meaningful evidence exists
- Appliance consideration hidden when empty
- “Close physical count”
- “Reconcile with Lowe's”
- Topology administration outside everyday Map chrome
- Reduced associate navigation
- Barrier action on the bay row
- Visible offline/queue state without elevating diagnostics

---

## UX-005A compliance note

UX-005A was allowed to:

1. Resolve duplicate Start / Continue CTAs (Question #2)
2. Demote (not delete) appliance action bar and other secondary home controls (Question #8 partial)

UX-005A was **not** allowed to, and did **not**:

- Elevate Appliances out of More
- Change bottom nav
- Redesign Floor / Map / Roster
- Remove Snap Bay, Walk & Talk, Floor Pad, Velocity, Predictive copilot, or Flooring cycle
- Refactor dual shell / attention fetch architecture
- Close any Question Its Place item other than #2 (and demotion-only for #8)

---

## UX-005B compliance note

UX-005B implemented a **department-aware Appliances entry on Floor** using existing `workingDepartment` truth:

- Visible only when Supervisor+/Master, `workingDepartment === "appliances"`, and `canAccessSection(..., "appliances")`
- Navigates to existing `APPLIANCES_OPERATIONAL_HOME_HREF` (`/appliances`)
- More → Department Tools → Appliances remains a secondary path
- No fifth bottom-nav tab
- Appliances-only pilot — no Flooring specialty entry; Question #6 remains open
- No appliance audit-state fetch on Floor
- No dual-shell / specialty-host / schema / API refactor
- Samsung acceptance pending — **do not close Question #1 as field-accepted yet**

---

## UX-005C compliance note

UX-005C reordered the **existing** `ShiftAnalyticsDrawer` so a DS opening it mid-shift
sees actions before reports. Presentation / information architecture only.

**Primary action order (drawer open):**

1. Walk & Talk Floor Pad
2. Flag Downstock
3. Showroom Quick Touch
4. Predictive Copilot
5. Weekly Audit Rollup
6. Snap Bay Photo

**Secondary — `Reports & insights`, collapsed by default, state not persisted:**
Audit Velocity → Store Health → Shift Briefing → Exception Feed.

UX-005C did:

- Preserve the drawer, its collapsed default, and its `#floor-pad` /
  `EXECUTIVE_FLOOR_PAD_OPEN_EVENT` opening mechanism
- Stack actions full-width (removed the Snap/Downstock two-column grid)
- Retain **and demote** Snap Bay Photo to last — Gemini, `bay_audit_logs`, and the
  unwired override helper all left exactly as found
  - **Superseded 2026-09-08 by SNAP-RETIRE-001:** this sixth action has since been
    removed with the capability it opened. The drawer now opens on five actions;
    every other UX-005C guarantee is unchanged. UX-005C's Samsung acceptance —
    still pending — must be run against the five-action drawer.
- Add one nested disclosure (`ShiftAnalyticsReportsGroup`) in the drawer's own file —
  exactly one secondary level, no new global accordion framework
- Remove the duplicate `BayFreshnessGrid` **from this drawer only**
- Suppress Store Health's duplicate `Logged barriers` block **in this context only**,
  via `showLoggedBarriers={false}`; the prop defaults to `true` everywhere else

UX-005C did **not**, and must not be read as having:

- Deleted any capability, component, or engine
- Changed schema, migrations, API routes, Gemini helpers, deterministic engines,
  scoring, rotation/verification semantics, any persistence path, RBAC, or the
  offline queue
- Changed Map / Roster / More IA or bottom navigation (Floor · Map · Roster · More)
- Touched appliance code — **APP-CAT-001A Samsung ESL validation remains pending**
- Implemented **WALK-001** Shift Walk Task Read-Back
- Merged or renamed Walk & Talk and Executive Floor Pad (Question #4 stays open)
- De-duplicated verification (Weekly Audit Rollup still opens the same modal as the
  primary Floor strip — that UX debt remains open)
- Resolved Question #3 — Snap Bay's Gemini cost is still a UX-005F / field question

**Engineering complete ≠ field accepted.** Do not mark UX-005C field accepted until
real-device acceptance is run.

---

*End of UX-005 governing backlog.*
