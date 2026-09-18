# BULK-SETUP-001 — Bulk Bay Generator Archaeology

> **Mode:** Read-only product + implementation archaeology.  
> **Baseline:** `main @ 78ec5a1` — `refactor: retire legacy DeptSync surfaces`  
> **Date:** 2026-09-18  
> **Runtime:** unchanged. No Bulk Generator, Location Type, AI Pre-Flight, Map, Floor, Gemini, schema, RLS, or production mutation.  
> **Not started:** BULK-SETUP-002. **Not opened:** UX-REDUCE-008.

This tranche answers one question: **what decisions does a Department Supervisor actually need to make to establish truthful physical-bay topology?** Every mounted Bulk Generator control must justify why that decision is exposed.

---

## 1. Repository baseline

| Item | Truth |
|------|--------|
| Branch | `main` tracking `origin/main` |
| HEAD | `78ec5a1` |
| Message | `refactor: retire legacy DeptSync surfaces` |
| Worktree | Clean except existing untracked `tmp/` |
| Prior program | UX-REDUCE-007 completed major product-reduction residue retirement |
| Handheld | HANDHELD-UX-002 Royal Amethyst accepted — untouched |
| This tranche | Docs only |

No STOP condition fired for dirty unrelated runtime work.

Canonical docs consulted: `DEPTSYNC_CONSTITUTION.md`, `ARCHITECTURE.md`, `DEPT_SYNC_STATE.md`, `CHAT_HANDOFF.md`, `MASTER_ROADMAP.md`, `DEVELOPMENT_JOURNAL.md`, REDUCE-002 / 002A / 003A, UX-REDUCE-003 / 005 / 007, PRIORITY-UX-001 / 002, BAY-UNIT-002 (via `physical-bay.ts` + tests), ENGINE-PROD-002/003/004 contracts, HANDHELD-UX-001 / 002.

---

## 2. Executive finding

The reduced product needs Bulk Generator to **create physical aisle/bay topology** so the rotation engine has geography to select, distribute, verify, and remember.

What it actually creates today is **`store_locations` rows** keyed by `(department_id, aisle, bay, type)` where `type` is `SELLING` or `TOPSTOCK`. The engine (BAY-UNIT-002) already collapses those sibling rows into **one physical coverage bay**. Map and Floor speak physical bays. **Add Bay** already hardcodes Selling + Topstock with no Location Type choice.

Therefore:

| Control | Verdict |
|---------|---------|
| **Location Type radios** | Still write real topology columns, but as an everyday bulk decision they largely expose **implementation history** (surface rows as independent coverage units). Default `BOTH` matches current product law and production shape. One-surface options remain technically valid topology; they are not required for normal continuous-coverage setup. |
| **AI Pre-Flight** | A **Gemini natural-language / messy-text → structured aisle ranges** parser with human **Confirm & Bulk Create**. It does **not** authoritatively write topology. Value is optional convenience beyond the existing deterministic CSV parser; not essential to the reduced product. |

Smallest truthful future Bulk Generator (hypothesis for BULK-SETUP-002, not implemented): **Department · Aisle · Bay range · Bay face pattern · physical-bay preview · Create**, with Selling+Topstock as the internal default, exceptional one-surface edits elsewhere if ever needed, and AI Pre-Flight either retired or renamed to a parse job.

This does **not** reopen UX-REDUCE. It is targeted setup archaeology after reduction.

---

## 3. Current Bulk Generator mounted path

```text
More (/settings)
  └─ Department Setup (DS + Master, map console)
       └─ Accordion "Aisles & bays"
            └─ AisleBayManager (canMutate={true})
                 └─ button "Bulk Generator"
                      └─ HubPortal sheet
                           └─ BulkLocationGenerator (dynamic, ssr:false)
```

| Layer | Location |
|-------|----------|
| Route / shell | Hub **More** → `SettingsSection` |
| Launch | `AisleBayManager` → `setBulkOpen(true)` |
| Component | `components/admin/BulkLocationGenerator.tsx` |
| Manual create API | `POST /api/store-locations/bulk` → `bulkInsertLocations` |
| AI parse API | `POST /api/store-locations/ai-parse` → Gemini → normalize |
| AI create | Same bulk API after Confirm (client loop) |
| Clean-Up delete | `DELETE /api/store-locations` (ids) |
| Client helpers | `bulkGenerateLocations`, `aiParseLocations`, `deleteStoreLocations` in `lib/store-ops/client.ts` |
| Row builder | `buildBulkLocationRows` / `bulkInsertLocations` in `lib/store-ops/locations.ts` |
| Session semantics | `lib/store-ops/bulk-mapping-session.ts` (TOPO-UX-001) |
| Tests | `lib/store-ops/topo-ux001-continuous-mapping.contract.test.ts`, `ux-reduce-007.legacy-residue.test.ts`, Gemini transport contracts listing ai-parse |

Sibling topology creators (not Bulk Generator, but same write path):

- **Add single bay** (`AddBaySheet`) — always `types: ["SELLING","TOPSTOCK"]`
- **Edit bay** (`EditBayDrawer`) — identity only (aisle/bay/department); no surface create/destroy radios

---

## 4. Complete control inventory

### Required control table

| Visible control | Internal field/state | Default | Writes/passes | Runtime consumer | User decision genuinely required? | Current justification | Recommended disposition |
|-----------------|----------------------|---------|---------------|------------------|-----------------------------------|----------------------|-------------------------|
| Tab: Manual / CSV | `tab="manual"` | selected | UI mode only | form sections | Yes (mode) | Three input modes | **KEEP** (modes) |
| Tab: ✨ AI Pre-Flight | `tab="ai"` | off | UI mode | AI parse flow | No for reduced core | Messy-text parse convenience | **RETIRE** or **REWORD** + optional |
| Tab: Clean-Up | `tab="cleanup"` | off | UI mode | prune/delete | Admin recovery | Topology prune | **KEEP** (admin) / **MOVE** advanced |
| Department (manual) | `departmentId` | first dept | `department_id` on bulk | `store_locations.department_id` | **Yes** | Topology ownership | **KEEP** |
| Aisle (manual) | `aisle` | `"1"` then cleared after save | `aisle` normalized | physical key | **Yes** | Physical geography | **KEEP** |
| Start Bay | `startBay` | `"1"` | `start_bay` | bay expansion | **Yes** | Range | **KEEP** |
| End Bay | `endBay` | `"15"` | `end_bay` | bay expansion | **Yes** | Range | **KEEP** |
| Bay pattern Odd / Even | `bayPattern` | `"odd"` (`DEFAULT_BAY_PATTERN`) | `bay_pattern` | `expandBayNumbers` | **Yes** (retail face) | Avoid duplicating opposite face | **KEEP** |
| Bay pattern preview line | `bayPreview` | derived | none | user understanding | n/a | Shows bay numbers | **KEEP** / **SIMPLIFY** language |
| Location type Both / Selling / Topstock | `locationMode` | `"BOTH"` | `types[]` | row `type` column | **No for normal setup** | Creates 1–2 surface rows per bay | **SIMPLIFY** → internal BOTH; exception elsewhere |
| Generate Locations | CTA | — | bulk upsert | Supabase | Yes (confirm act) | Authoritative create | **KEEP** |
| Helper blurb (BOTH upsert PENDING…) | copy | — | none | education | n/a | Explains row model | **REWORD** physical-bay language |
| Batch CSV textarea | `csvText` | empty | parsed → bulk per row | same bulk | Optional | Deterministic multi-aisle | **KEEP** optional |
| Upload CSV | file → `csvText` | — | same | same | Optional | Convenience | **KEEP** |
| Load CSV batch | CTA | — | loop `bulkGenerateLocations` | same | Optional | Batch create | **KEEP** |
| Default department (AI) | `departmentId` | first | default_department_code | AI normalize | If using AI | Fill omitted dept | Tied to AI disposition |
| AI textarea | `aiText` | empty | POST ai-parse text | Gemini | If using AI | Messy input | Tied to AI |
| Parse with AI | CTA | — | Gemini call | preview only | If using AI | Proposal | Tied to AI |
| Parsed preview table | `aiPreview` | null | display | human review | If using AI | Confirmation | Tied to AI |
| Corrections made list | `aiCorrections` | [] | display | trust/review | If using AI | Provenance of fixes | Tied to AI |
| Confirm & Bulk Create | CTA | — | loop bulk | Supabase | If using AI | Human authority boundary | Tied to AI |
| Clean-Up Department / Aisle | shared state | — | filter ids | delete | Admin | Scope prune | **KEEP** admin |
| Entire aisle checkbox | `cleanupEntireAisle` | false | ignore bay range | id filter | Admin | Fast aisle wipe | **KEEP** admin |
| Clean-Up Start/End / pattern / location type | shared | same defaults | filter | delete scope | Admin | Precise prune | **KEEP** / Location Type **SIMPLIFY** |
| Match count “N tags” | `cleanupIds.length` | 0 | none | safety | n/a | Preview of delete | **REWORD** physical bays / surfaces |
| Delete / Confirm delete | CTA + `cleanupConfirm` | — | DELETE ids | Supabase + rotations | Admin confirm | Destructive | **KEEP** |
| Cancel confirm | — | — | clears confirm | UI | — | Safety | **KEEP** |
| Status / error banners | `message` / `error` | null | none | feedback | n/a | Upsert count language | **REWORD** |

### Hidden / non-visible but participating

| Element | Behavior | Disposition note |
|---------|----------|------------------|
| `velocitySeed` | Hardcoded `parseVelocitySeedPreset("standard")` → `velocity_tier=standard`, `priority_override=false`, `custom_decay_days=14` | **REQUIRED INTERNAL DEFAULT** (UX-REDUCE-007 retired radios) |
| `workflowType` | Silent from department code (`APPLIANCE_SIMS_AUDIT` vs `STANDARD_MERCH`) | **HARMLESS INTERNAL** / specialty residue; UI retired |
| Upsert on conflict | `(department_id,aisle,bay,type)` resets to PENDING | Documented; re-run is upsert not skip |

---

## 5. User decision count

**Manual path — decisions before Generate:**

1. Department  
2. Aisle  
3. Start bay  
4. End bay  
5. Bay pattern (Odd / Even)  
6. Location type (Both / Selling / Topstock)  
7. Act of Generate  

→ **6 choices + 1 confirm** (or **5 + confirm** if Location Type is not counted as a genuine domain decision).

**AI path:** Default department + paste text + Parse + review + Confirm (≥3 decisions + review load).

**CSV path:** Department default + paste/upload + Load (types often in CSV).

**Clean-Up:** Separate destructive workflow (not topology creation).

Classification:

| Decision | Class |
|----------|-------|
| Department, aisle, bay range | necessary domain decision |
| Bay pattern Odd/Even | necessary retail-face decision |
| Location Type | mostly **legacy / technical detail** for normal setup |
| Velocity / workflow | **safe default / hidden** (already) |
| AI vs manual | optional convenience |

---

## 6. Current defaults

| Default | Value | Why | Product-law fit | Class |
|---------|-------|-----|-----------------|-------|
| Tab | Manual / CSV | Primary setup | Yes | REQUIRED USER CHOICE (mode) |
| Department | `departments[0]` | First loaded | OK if filtered | REQUIRED USER CHOICE (must verify) |
| Aisle | `"1"` then cleared after manual save | Mapping session | OK | REQUIRED USER CHOICE |
| Start/End | 1–15 | Historical template | Arbitrary but useful | REQUIRED USER CHOICE |
| Bay pattern | Odd Only | Retail face convention | Yes | REQUIRED USER CHOICE |
| Location mode | BOTH | Two surface rows | Matches BAY-UNIT / Add Bay / production | LEGACY EXPOSED — should be **REQUIRED INTERNAL DEFAULT** |
| Velocity seed | standard | UX-REDUCE-007 | Map owns High | REQUIRED INTERNAL DEFAULT |
| Workflow | dept-code derived | Specialty dormant tag | Not rotation-critical | REQUIRED INTERNAL DEFAULT |
| Cleanup entire aisle | false | Safer | Yes | REQUIRED USER CHOICE when pruning |

---

## 7. Location Type implementation

```text
UI locationMode: BOTH | SELLING | TOPSTOCK
        ↓ typesForMode()
types: ["SELLING","TOPSTOCK"] | ["SELLING"] | ["TOPSTOCK"]
        ↓ POST /api/store-locations/bulk
        ↓ buildBulkLocationRows → for each bay × each type
upsert store_locations ON CONFLICT (department_id, aisle, bay, type)
```

Distinguishing column: **`store_locations.type`** enum `SELLING` | `TOPSTOCK` (orthogonal to `location_type` STANDARD/SHOWROOM_STACKOUT).

Unique constraint: `department_id, aisle, bay, type`.

---

## 8. Selling + Topstock behavior (`BOTH`)

For each expanded bay number:

- Inserts/upserts **two** rows: one `SELLING`, one `TOPSTOCK`
- Same aisle, bay, department, velocity seed, workflow
- Status `PENDING`, cycle 1, active true
- Represents **one physical bay** with two topology surfaces

Matches `AddBaySheet` and production pilot shape.

---

## 9. Selling-only behavior

Creates **one** `SELLING` row per bay. Physical bay still exists as one coverage unit with a single surface. Verification fan-out closes whatever siblings exist (only one). Representative picker prefers SELLING when present.

---

## 10. Topstock-only behavior

Creates **one** `TOPSTOCK` row per bay. Same physical-bay grouping. Representative falls back to remaining owed surface when no SELLING.

---

## 11. Physical-bay interaction

BAY-UNIT-002 (`lib/store-ops/physical-bay.ts`):

- Key = `department_id + aisle + bay` (**not** type)
- Weekly target / Sunday select / +1 count **physical** groups
- One `weekly_rotations` row uses a **representative** location id (prefer owed SELLING)
- Sibling urgency OR/worst/min composed onto candidate
- DS verification `markPhysicalBayCompleted` fans out to **all active siblings**

Bulk Generator does **not** bypass grouping. Creating BOTH vs one surface changes **how many topology rows** exist under the physical key, not whether the engine double-counts (it does not).

**Partial sibling risk:** Selling-only then later Topstock-only (or cleanup of one face) can create uneven siblings. Engine tolerates this; Map shows secondary Sell/Top presence. Production archaeology (PRIORITY-UX-001, same day) found **no** one-surface physical bays.

---

## 12. Surface identity consumers

| Question | Answer |
|----------|--------|
| **A. Rotation engine?** | Groups by physical bay. Uses `type` only for representative preference (SELLING first) and composing sibling signals — **not** as two jobs. |
| **B. Verification?** | Fans out to both siblings; does not require both to exist. |
| **C. Map?** | Physical-bay first; Sell/Top secondary presence (`canMutate=false`). |
| **D. Floor?** | Physical-bay ownership / This Week; siblings collapse. |
| **E. Floor Pad / Walk & Talk?** | Observational capture; not topology author. No Bulk Location Type dependency. |
| **F. Cadence / velocity?** | Per-row fields composed at physical bay (worst tier / min decay). |
| **G. Surviving UI different SELLING vs TOPSTOCK state?** | Map secondary chips / advanced cadence can differ per face; everyday High writes both faces together. Edit Bay no longer edits surfaces independently for priority. |
| **H–J. Legitimate one-surface workflows?** | Bulk radios + CSV/AI type cells + Clean-Up type filter **can** create/prune one face. **Add Bay cannot.** No reduced-product workflow **requires** one-surface creation. |
| **K. Normalize always BOTH?** | Would not lose operational coverage truth for current pilot shape; would lose ability to record “this physical bay has no topstock face” if that were ever real store topology. |
| **L. One canonical row?** | Would break current schema, Map surface presence, verification fan-out assumptions, and unique key design — **not safer** without a migration program (out of scope). |

---

## 13. Production topology shape

Fresh service-role SELECT was **not** re-run in this tranche (prior same-day archaeology already answered the question; avoiding unnecessary credentialed production access).

**PRIORITY-UX-001 (2026-09-18 read-only)** recorded:

- **292 physical bays**
- **All have both faces** (SELLING + TOPSTOCK)
- **0** sibling priority disagreements
- **0** one-surface physical bays observed

Implication: one-surface bulk options are **not** describing current pilot topology practice. Counts alone do not prove historical intent, but they strongly support BOTH as the normal default.

---

## 14. Location Type product assessment

| Lens | Finding |
|------|---------|
| Topology truth? | **Yes** — `type` is a real column describing surface presence. |
| Obsolete coverage semantics? | **Partially** — radios date from when SELLING/TOPSTOCK were treated as independently assignable coverage locations. Engine no longer does that. |
| Everyday bulk decision? | **Not justified** for reduced product when default BOTH matches law, Add Bay, and production. |
| Keep somewhere? | Exceptional one-surface topology (if ever needed) belongs in **advanced Edit / Clean-Up**, not normal bulk create. |

### Required Location Type matrix

| Option | Rows created | Physical bays represented | Surface identity | Rotation effect | Verification effect | Map effect | Legitimate current use case | Recommendation |
|--------|--------------|---------------------------|------------------|-----------------|---------------------|------------|----------------------------|----------------|
| Selling + Topstock (BOTH) | 2 × bay count | 1 × bay count | both faces | one obligation per bay | fans out to both | Sell+Top secondary | **Normal store topology** | **KEEP as default** (prefer internal) |
| Selling only | 1 × bay count | 1 × bay count | SELLING | one obligation | closes one row | Sell only secondary | Rare / specialty / repair | **MOVE** advanced / **RETIRE** from normal bulk |
| Topstock only | 1 × bay count | 1 × bay count | TOPSTOCK | one obligation | closes one row | Top only secondary | Rare / specialty / repair | **MOVE** advanced / **RETIRE** from normal bulk |

---

## 15. AI Pre-Flight implementation

Mounted only inside Bulk Generator tab `ai`.

```text
UI: Paste text → "Parse with AI"
  → aiParseLocations(specialist, { text, known_department_codes, default_department_code })
  → POST /api/store-locations/ai-parse
  → requireSuperAdmin
  → isGeminiConfigured()
  → buildAiLocationParsePrompt(...)
  → callGeminiFlashJson(prompt, { maxOutputTokens: GEMINI_TOKEN_BUDGET.parse, responseSchema: AI_PARSE_RESPONSE_SCHEMA })
  → normalizeAiParsePayload(...)  // deterministic post-validation
  → JSON { locations[], corrections_made[] }
  → UI preview table (no write)
  → human "Confirm & Bulk Create"
  → for each row: bulkGenerateLocations(...)  // same Master-only bulk upsert
```

No persistence of AI output except after human confirm via ordinary bulk writes.

---

## 16. AI Pre-Flight prompt / input / output

**Sends to Gemini:**

- Messy free text (capped **24 000** chars)
- Known department codes list
- Default department hint
- Rules: alphanumeric aisle, bay integers, type ∈ {SELLING,TOPSTOCK,BOTH}, expand informal lists, record corrections

**Returns (schema-constrained, then normalized):**

- `locations[]`: `{ department_code, aisle, start_bay, end_bay, type }`
- `corrections_made[]`: human-readable normalization notes

**Does *not* (proven):** invent priority, velocity, workflow, bay pattern (AI confirm omits `bay_pattern` → server defaults **odd**), Map High, assignments, or verification state.

Plain language: **AI Pre-Flight parses messy aisle/bay notes into structured range proposals for human confirmation.** It does not predict store truth beyond interpreting the pasted text.

---

## 17. AI Pre-Flight authority

| Capability | Can it? |
|------------|---------|
| Create topology directly | **No** (parse only) |
| Modify topology directly | **No** |
| Change priority / cadence | **No** |
| Change location type in DB without confirm | **No** (type only in preview until Confirm) |
| Write Supabase | **Only** after Confirm → same bulk path as manual |
| Manufacture evidence | **No** — proposal + human confirm (Art. X aligned for this path) |

Human confirmation boundary: **Confirm & Bulk Create** is explicit. Adequate for topology creation authority **if** Master is the actor (server-enforced).

---

## 18. AI Pre-Flight persistence / side effects

| Stage | Persistence |
|-------|-------------|
| Parse | None (response to client) |
| Preview | React state only |
| Confirm | `store_locations` upserts (+ cache invalidate / locations-changed notify) |
| Failures | Partial row loop possible (same as CSV) |

---

## 19. AI Pre-Flight Gemini dependency

| Item | Shared? | Unique? |
|------|---------|---------|
| Transport `lib/ai/gemini.ts` | **Shared** with Floor Pad Server Action, parse-walk, bay-scan, flooring insights | — |
| `callGeminiFlashJson` / `isGeminiConfigured` | Shared | — |
| Prompt / schema / normalizer | — | **Unique** (`lib/store-ops/ai-parse.ts`) |
| API route | — | **Unique** `/api/store-locations/ai-parse` |
| UI | — | **Unique** Bulk Generator AI tab |
| Tests | Listed in gemini.transport / snap / snag contracts | No dedicated ai-parse unit suite beyond transport ownership |

**If AI Pre-Flight disappeared:** its route + `ai-parse.ts` + Bulk AI tab could be removed **without** affecting Floor Pad or other protected Gemini consumers. Shared transport stays for Floor Pad.

GEMINI-001 historically dispositioned Pre-Flight as **RETAIN AI**. This archaeology reclassifies product value for the **reduced** setup surface (below); that is not a global Gemini retirement.

---

## 20. AI Pre-Flight deterministic alternatives

Already present:

| Job | Owner |
|-----|-------|
| Aisle normalize / validate | `lib/store-ops/aisle.ts` |
| CSV batch parse | `parseLocationBatchCsv` |
| Bay range expand Odd/Even | `expandBayNumbers` |
| Type cell parse | CSV + `normalizeLocationMode` in ai-parse |
| Duplicate / upsert safety | unique constraint + upsert |
| Post-Gemini validation | `normalizeAiParsePayload` (deterministic) |

Gemini’s **unique** contribution: interpreting **messy natural language / informal lists** that are not CSV. Structured CSV and the Manual form already cover the deterministic setup job.

---

## 21. AI Pre-Flight product-value assessment

| Factor | Assessment |
|--------|------------|
| Friction originally removed | Typing many aisles from messy notes without CSV discipline |
| Frequency | Topology setup is rare/admin (More → Aisles & bays) |
| Manual complexity today | Manual + CSV already strong; TOPO-UX-001 continuous mapping |
| Review burden | Preview + corrections still require careful reading |
| Network / Gemini / cost / latency | Required for Parse; 20s transport bound; fails if no key |
| Offline | Online-only |
| Maintenance | Extra consumer + prompt + schema |

**Classification: USEFUL OPTIONAL CONVENIENCE → leaning LEGACY / NO LONGER JUSTIFIED for reduced everyday setup.**  
Field evidence of DS actually using messy-note paste would promote to **NEEDS FIELD EVIDENCE** before mandatory keep. Do not keep merely because it is AI; do not remove in this tranche.

Recommended future name if retained: **Parse layout** / **Interpret bay list** (job language, not “AI Pre-Flight”).

---

## 22. Preview behavior

| Path | What preview shows |
|------|--------------------|
| Manual | Bay **numbers** for pattern (`N bays: 1, 3, 5…`) — **not** row count, not BOTH×2 |
| Success message | `"{n} locations saved · {dept} · {aisle}"` where `n` = **upserted row count** |
| AI | Ranges with Dept / Aisle / Bays / Type — **not** expanded physical bay list |
| Clean-Up | `"{n} tags match"` — **surface rows**, not physical bays |

---

## 23. Physical-bay vs row-count language

**Mismatch exists.**

Example: Odd 1–15 + BOTH → 8 physical bays × 2 surfaces = **16 location rows**. UI says “16 locations saved” / intro copy talks about BOTH writing Selling and Topstock. Clean-Up says “tags.” Map/Constitution speak **physical bays**.

This is presentation debt, not engine incorrectness.

---

## 24. Validation and duplicate safety

| Case | Behavior |
|------|----------|
| Existing aisle/bay/type | Upsert → PENDING (documented) |
| Existing physical bay, missing sibling | Creating BOTH adds missing face; Selling-only leaves TOPSTOCK absent |
| Malformed aisle | Client/server reject |
| Reversed range | Manual/`expandBayNumbers` throws; AI normalizer swaps |
| Zero match Odd/Even | Error from expand |
| Large range | Allowed (no hard cap beyond practical) |
| Unauthorized dept | Bulk checks department belongs to actor store; **Super Admin required** |
| CSV/AI multi-row | **Row-by-row**; partial success possible |
| Single bulk request | One upsert batch for that range (atomic at PostgREST upsert call level, not multi-aisle transaction) |

Correctness risks: partial CSV/AI loops; AI omitting `bay_pattern` always odd; Clean-Up deleting one surface type leaving orphans (allowed).

---

## 25. Partial sibling behavior

Engine and Map tolerate one-surface physical bays. Verification fans out to existing siblings only. Priority writers prefer both faces. **Bulk Location Type + Clean-Up type filter are the primary ways to create partial siblings** in the surviving UI. Add Bay does not.

---

## 26. Authorization

| Layer | Who |
|-------|-----|
| More → Department Setup UI | DS **or** Master (`showDepartmentSetup`) |
| AisleBayManager `canMutate` | Always `true` when mounted |
| `POST /api/store-locations/bulk` | **`requireSuperAdmin` only** |
| `POST /api/store-locations/ai-parse` | **`requireSuperAdmin` only** |
| `DELETE /api/store-locations` | **`requireSuperAdmin` only** |
| Topology-heavy PATCH | Super Admin |
| Map High | DS + Master (`canMutateRotationPriority`) — separate |

**Mismatch (known deferred RBAC-TOPO-001):** DS can open Bulk Generator UI; Generate/AI/Clean-Up **403** on server. Server is **not** weaker than expected for topology create (Master-only). UI is **wider** than server. Not a STOP for “weaker than expected,” but a real consistency debt.

Associates: no Department Setup.

---

## 27. Offline behavior

| Action | Offline |
|--------|---------|
| Manual Generate | Online `storeOpsFetch` — fails without network |
| AI Parse | Requires network + Gemini |
| Confirm create | Online bulk |
| Clean-Up | Online delete |
| Queue | **Not** enqueued as topology mutation |

Topology setup is administrative/online — matches expectation.

---

## 28. Map / More boundary

UX-REDUCE-007 retired Bulk Priority Lock and velocity radios. At HEAD:

- No mounted High / Priority Lock / velocity radios in Bulk Generator
- Silent standard velocity seed only
- Workflow UI unmounted
- Map still owns operational High (`canMutateRotationPriority`)
- More owns topology mutation

**No equivalent residue under another label** for operational priority during bulk create.

---

## 29. Specialty residue

| Residue | Class |
|---------|-------|
| Physical aisle/bay create, Odd/Even faces, department scope | **CURRENT CORE** |
| BOTH surface rows, upsert PENDING | **CURRENT CORE** (schema) |
| Silent `workflowTypeForDepartmentCode` (Appliances SIMS tag) | **HARMLESS INTERNAL** |
| `priority_lock` helper still in velocity module | **DORMANT LEGACY** |
| AI Pre-Flight Gemini consumer | **MOUNTED** optional / borderline legacy |
| Location Type Selling-only / Topstock-only as everyday radios | **MOUNTED LEGACY** coverage-era UX |
| Clean-Up “tags” vocabulary | **MOUNTED** presentation debt |
| CSV type column BOTH/SELLING/TOPSTOCK | **HARMLESS** power-user |
| Flooring / Remnant / Appliance audits in Bulk path | **Not mounted** in Bulk Generator itself |

---

## 30. User-facing implementation details that should probably be hidden

1. Location Type as three radios on normal create  
2. Row/tag/location-count language instead of physical bays  
3. Intro copy about unique `(department, aisle, bay, type)`  
4. Silent appliance workflow (already hidden — good)  
5. AI branded as “Pre-Flight” rather than parse job  
6. DS-visible Bulk sheet that cannot succeed without Master (auth mismatch)

---

## 31. Controls that remain justified

- Department, aisle, start/end bay  
- Odd/Even bay pattern + bay number preview  
- Generate (authoritative create)  
- Continuous manual session (TOPO-UX-001)  
- Optional CSV batch for multi-aisle deterministic load  
- Clean-Up with confirm (Master topology prune)  
- Internal standard velocity seed / no High at create  

---

## 32. Controls that do not remain justified (as everyday decisions)

- Everyday **Location Type** choice for normal bulk create  
- **AI Pre-Flight** as a core setup tab (optional at best)  
- Speaking in **location rows / tags** as primary mental model  
- Exposing Bulk create UI to DS when only Master can write (unless RBAC intentionally expands)

---

## 33. Recommended future Bulk Generator mental model

```text
User creates:
  Department · Aisle · Bays 1–15 · Odd face
DeptSync creates:
  physical bays 1,3,5… each with Selling+Topstock surfaces internally
Preview:
  "8 physical bays (Selling + Topstock)"
Create
```

Bay pattern remains a real retail decision. Surface pairing becomes an internal topology detail unless advanced editing needs exceptions.

Architecture already supports this safely: `AddBaySheet` is the proof. Engine/Map already physical-bay-first. No schema change required for UI simplification.

---

## 34. Recommended BULK-SETUP-002 scope

Smallest implementation (proposal only — **do not start automatically**):

1. **Reword** manual success + intro + clean-up counts to physical-bay language (with optional secondary “N surface rows”).  
2. **Hide Location Type** on normal Manual create; force internal `BOTH` (keep Clean-Up type filter or advanced disclosure if prune-by-face remains useful).  
3. **AI Pre-Flight:** either **retire** the tab + route consumer, or demote/rename to “Parse layout” behind disclosure; do **not** touch Floor Pad Gemini.  
4. Optionally align UI gating with Master-only bulk write (**RBAC-TOPO-001**) — or document intentional DS read-only topology browse.  
5. Contract tests for dispositions; no schema/migration/engine-law change.

---

## 35. Items explicitly NOT recommended

- Collapsing schema to one row per physical bay in 002  
- Migrating production siblings  
- Changing rotation / verification / Map High law  
- Removing Gemini globally  
- Touching Floor Pad / Walk & Talk  
- Reopening UX-REDUCE-008 as a broad reduction program  
- Auto-starting BULK-SETUP-002 from this doc alone  

---

## 36. Tests / validation

Traced suites (no runtime change in this tranche):

- `lib/store-ops/topo-ux001-continuous-mapping.contract.test.ts`  
- `lib/store-ops/ux-reduce-007.legacy-residue.test.ts`  
- `lib/store-ops/bay-unit-002.physical-bay.test.ts`  
- `lib/ai/gemini.transport.test.ts` (ai-parse ownership)  
- Map / physical-bay presentation contracts  

Validation for this docs tranche: `npm run typecheck`, `npm run build`, and relevant tests as run at closeout.

---

## 37. Git / docs status

| Artifact | Status |
|----------|--------|
| `docs/product/BULK_SETUP_001_BULK_BAY_GENERATOR_ARCHAEOLOGY.md` | Created (this file) |
| Living docs | Record BULK-SETUP-001 complete; BULK-SETUP-002 not started |
| Runtime | Unchanged |
| UX-REDUCE-008 | Not opened |

---

## 38. Final assessment

The Bulk Bay Generator is still the right **More → topology** instrument, but it still teaches an older mental model: **database location rows and surface types as primary choices**. The reduced product already decided that the DS thinks in **physical bays**, that Map owns High, and that Add Bay creates Selling+Topstock without asking.

**Location Type** remains descriptive topology storage, not everyday coverage assignment — keep BOTH as the normal write; stop asking unless advanced.

**AI Pre-Flight** is a bounded, confirmation-gated messy-text parser on shared Gemini transport — safe authority-wise, optional value-wise, removable without Floor Pad damage.

BULK-SETUP-002 should be a **narrow setup truthfulness** tranche, not a new reduction program.

---

## Required AI Pre-Flight trace

```text
UI trigger: tab "✨ AI Pre-Flight" → textarea → "Parse with AI"
        ↓
client handler: handleAiParse → aiParseLocations(...)
        ↓
API: POST /api/store-locations/ai-parse (requireSuperAdmin)
        ↓
Gemini/helper: callGeminiFlashJson + AI_PARSE_RESPONSE_SCHEMA
        ↓
prompt/input: buildAiLocationParsePrompt(text ≤24k, known codes, default dept)
        ↓
model output: { locations[], corrections_made[] }
        ↓
validation: normalizeAiParsePayload (aisle/bay/type/dept); 422 if empty
        ↓
preview/form mutation: setAiPreview / setAiCorrections only (no DB)
        ↓
human confirmation: "Confirm & Bulk Create"
        ↓
authoritative write: loop bulkGenerateLocations → POST /bulk upsert
```

If Confirm is never pressed: **no write**.

---

## Required direct questions

**A.** Upserted `store_locations` rows for a department aisle bay range × selected surface types (default both faces), with standard velocity seed and silent workflow tag.  

**B.** Manual: **6** exposed choices + Generate (Department, Aisle, Start, End, Pattern, Location Type).  

**C.** Department, Aisle, Start, End, Pattern (+ Generate). Location Type is not genuinely required for normal reduced setup.  

**D.** Two rows per bay: SELLING + TOPSTOCK.  

**E.** One SELLING row per bay.  

**F.** One TOPSTOCK row per bay.  

**G.** Not as independent jobs — groups by physical bay; prefers SELLING as representative when owed.  

**H.** Fans out completion to existing siblings; does not require both.  

**I.** Secondary surface presence only; counts physical bays.  

**J.** No — observational; does not depend on Bulk Location Type.  

**K.** Not in current pilot production evidence (PRIORITY-UX-001: 0 one-surface among 292). Code **can** create them.  

**L.** Uncommon / unused in current pilot data; low importance for normal setup.  

**M.** For current pilot practice, **no** meaningful operational topology truth lost; only loses rare “face absent” encoding.  

**N.** **No** for normal bulk creation.  

**O.** Advanced topology edit / Clean-Up / one-off tools — not everyday Bulk radios.  

**P.** Parses messy text into structured aisle/bay/type range proposals.  

**Q.** Free text + known department codes + default department + parse rules.  

**R.** Normalized locations ranges + corrections_made notes.  

**S.** **No** — only after Confirm via bulk API.  

**T.** Explicit Confirm & Bulk Create after preview.  

**U.** Only for non-CSV messy natural language; CSV/manual already cover deterministic setup.  

**V.** **Not as essential core** — optional convenience at best.  

**W.** **No** — name the job (Parse layout / Interpret bay list).  

**X.** **Yes** — unique route/prompt/UI; shared transport remains for Floor Pad.  

**Y.** Primarily **database location rows / tags**, with a bay-number preview on manual pattern only.  

**Z.** Yes — Location Type as coverage-era choice; row/tag language; silent appliance workflow; AI tab prominence.  

**AA.** Yes — Location Type (implementation needs `type`); historically velocity/priority (now hidden); workflow (hidden).  

**AB.** Department · Aisle · Bay range · Odd/Even · physical-bay preview · Create (internal BOTH).  

**AC.** Reword physical-bay language; hide/default Location Type; retire or demote/rename AI Pre-Flight; optionally fix UI/server Master gating; no engine/schema.  

**AD.** **No** migration, RLS, production mutation, or engine-law change required for the recommended 002 scope.  

**AE.** **No** — targeted Bulk setup archaeology after UX-REDUCE-007; does not reopen UX-REDUCE-008.
