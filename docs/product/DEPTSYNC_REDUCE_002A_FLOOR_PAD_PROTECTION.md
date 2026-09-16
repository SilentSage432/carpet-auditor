# DEPTSYNC-REDUCE-002A — Walk & Talk / Floor Pad Protection

**Status:** DOCS-ONLY PRODUCT-BOUNDARY AMENDMENT · **COMPLETE (docs)**  
**Date:** 2026-09-15  
**Amends:** [DEPTSYNC_REDUCE_002_BOUNDARY_AND_DECOUPLING_SPEC.md](./DEPTSYNC_REDUCE_002_BOUNDARY_AND_DECOUPLING_SPEC.md)  
**Runtime:** unchanged · **APP-UPC-001A:** undisturbed by this amendment · **Companion:** [REDUCE-003A Seasonal Context](./DEPTSYNC_REDUCE_003A_SEASONAL_CONTEXT_PROTECTION.md) · **Commit:** captured via REDUCE-003A repository reconciliation

---

## 1. Purpose

Correct one REDUCE-002 retirement disposition **before product deletion begins**.

Walk & Talk / Executive Floor Pad must **not** be classified for retirement in early specialty cleanup.

They are:

> **PROTECTED — ROTATION OBSERVATIONAL CAPTURE EVALUATION PENDING**

---

## 2. Previous REDUCE-002 disposition (superseded)

Prior to this amendment, REDUCE-002 treated Walk & Talk / Executive Floor Pad / `TacticalVoiceFloorPad` as **out-of-scope / eventual retirement** candidates (disconnect from Floor drawer; delete runtime later; Gemini consumers removable with them). Floor Pad intents living in `lib/specialty-tools.ts` / `SpecialtyToolsHost` were treated as removable with that retirement. Gemini transport was treated as fully retireable after all consumers died.

That disposition is **withdrawn** for these surfaces only.

---

## 3. New canonical disposition

| Surface | Disposition |
|---------|-------------|
| Walk & Talk | **PROTECTED — ROTATION OBSERVATIONAL CAPTURE EVALUATION PENDING** |
| Executive Floor Pad | **PROTECTED — ROTATION OBSERVATIONAL CAPTURE EVALUATION PENDING** |
| `TacticalVoiceFloorPad` | **PROTECTED** until FLOORPAD-001 decides belonging |
| Floor Pad intents / SpecialtyToolsHost Floor-Pad seam | **Preserve during early reduction** — do **not** classify entire SpecialtyToolsHost as CORE; other children (appliances, remnants) may still retire |
| Gemini | **Not globally KEEP.** Transport **cannot be fully retired** until FLOORPAD-001 decides whether AI interpretation earns a place. Unrelated Gemini consumers (e.g. Visual Bay Scan, Flooring Insights, Pre-Flight) may still be removed independently |

Protection applies to the **product capability / interaction idea**, not a blank check that every current artifact, prompt, persistence model, or Gemini behavior must survive redesign.

---

## 4. Product rationale

Potential role inside the reduced rotation thesis:

> A DS walking the physical department can speak naturally about observations. AI may interpret unstructured speech into **proposed** structured operational evidence. The DS must confirm, edit, or ignore before anything becomes authoritative. The deterministic rotation engine then consumes only confirmed evidence under existing laws.

Conceptual chain:

Physical observation → DS speech → AI interpretation → **proposed** structured evidence → DS confirm/edit/ignore → **human-authoritative** evidence → deterministic rotation input → future coverage/cadence decision

Illustrative only — **not implemented** by this tranche.

This is **not** a Lowe’s task system, deadline assigner, photo workflow, Zebra duplicate, surveillance product, or generic chatbot.

Narrow problem it might solve:

> How can a DS communicate useful physical observations to DeptSync while walking without stopping to manually encode fields?

If later evidence shows it does not solve that well, it may still be retired — **only after FLOORPAD-001**.

---

## 5. Authority boundary (absolute)

Constitution Art. VII.3 / IX / X:

> Intelligence may interpret evidence, but it may not manufacture evidence.

**AI may:** interpret language · identify a known location · classify/summarize · propose structured evidence · explain its reading.

**AI may not autonomously:** set authoritative priority · alter cadence · mark velocity · create coverage truth · verify work · invent unsupported conditions · mutate rotation state · make an observation authoritative.

> **AI understands the DS. DeptSync decides according to its laws.**

Human confirmation is the authority boundary. Deterministic rotation remains decision authority after confirmed evidence enters the system.

---

## 6. Reduction sequence correction

Specialty-runtime retirement (**REDUCE-002 sequence step 5**) and early nav disconnect (**step 2**) **MUST EXCLUDE**:

- protected Walk & Talk runtime  
- protected Executive Floor Pad runtime  
- `TacticalVoiceFloorPad` where required by the protected capability  
- Floor Pad–specific intent infrastructure (`EXECUTIVE_FLOOR_PAD_*`, Floor bridge, related More/Settings open paths)  
- Gemini transport **required by** the protected capability  

…until **FLOORPAD-001** resolves disposition.

Other REDUCE-002 conclusions (rotation thesis, Floor/Map/Roster/More, labor/schedule contracts, APP-UPC strategy, sync-queue decoupling, enterprise-first delete, Visual Bay candidacy, dormant schema, no plugin frameworks) **remain in force**.

---

## 7. FLOORPAD-001 — Rotation observational capture archaeology

**Status:** **DEFERRED / REQUIRED BEFORE FLOOR PAD RETIREMENT OR REDESIGN**

**Purpose:** Determine whether existing Walk & Talk / Executive Floor Pad can be reduced into a valuable DS observational-capture layer for the rotation engine.

**Eventually investigate (do not run now):** current Floor Pad + Walk & Talk runtime · voice capture · Gemini prompts/contracts · persistence (`manager_notes`, `shift_walk_tasks`) · intent model · location resolution · provenance · confirmation boundary · which observations may affect cadence · whether durable/manual priority is the right destination · whether a new evidence type is needed · transcript retention · cost/latency/offline · walking ergonomics · failure behavior · whether AI earns its place.

**Not started. Not authorized by REDUCE-002A.**

---

## 8. Runtime / APP-UPC safety

This tranche is **documentation only**. No runtime, schema, migration, Vercel, env, navigation, Floor Pad behavior, or Gemini behavior changes. APP-UPC-001A workspace must remain byte-for-byte undisturbed relative to pre-tranche state.

---

*End of REDUCE-002A.*
