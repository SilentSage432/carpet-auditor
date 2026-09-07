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
| **UX-005C** | Floor secondary drawer | Open — do not preempt |
| **UX-005D** | Map operate vs investigate | Open — do not preempt |
| **UX-005E** | Operational language | Open — do not preempt |
| **UX-005F** | AI earn-your-place review | Open — do not preempt |

Do not preempt later tranches inside an earlier one.

---

## Question its place — field evidence required

| # | Question | Evidence needed | Ownership |
|---|----------|-----------------|-----------|
| 1 | Appliances under More vs elevated specialty entry | Do DS users find Floor entry instinctive? Still use More? Interfere with Floor? | **UX-005B implemented** (Floor contextual entry) — **not field-accepted yet**; More remains secondary path |
| 2 | Dual Start Physical Audit CTAs | Are they always redundant in actual operation? | **Owned by UX-005A** — duplicate competing Start removed; single panel CTA |
| 3 | Snap Bay multi-promotion + Gemini cost | Does it materially change real verification decisions? | **Not owned** — remains open (UX-005F) |
| 4 | Walk & Talk vs Executive Floor Pad | Two genuine jobs or duplicate mental models? | **Not owned** — remains open (UX-005C / product) |
| 5 | Velocity Heatmap | Used instead of or alongside Standard Map? | **Not owned** — remains open (UX-005D) |
| 6 | Flooring cycle audit vs Floor Sunday | Different Flooring jobs or overlapping concepts? | **Not owned** — remains open (product); **UX-005B did not resolve** |
| 7 | Predictive copilot | Recommendations acted on or routinely ignored? | **Not owned** — remains open (UX-005F) |
| 8 | Appliance action bar | Needed in normal counting, or only reset/recovery? | **Partial UX-005A** — demoted under More appliance tools; behavior **not** removed |

---

## UX debt — preserve for later tranches

- Appliances home still can expose some implementation architecture (mitigated by UX-005A spine; further polish may remain)
- Appliances primary specialty no longer *only* under More (UX-005B Floor entry); More remains secondary — field evidence still required before closing #1
- Map errors leak engineering language
- “Sunday Cycle Audit Engine” language
- “Predictive copilot” language
- “Velocity Heatmap” language
- Verification duplicated in secondary Floor drawer
- Executive Floor Pad has dual mental entry

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
- Snag triage API with no current UI
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

*End of UX-005 governing backlog.*
