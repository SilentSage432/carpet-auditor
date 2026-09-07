# Appliance Product Evolution Roadmap

**Status:** Directional, not contractual  
**Owner surface:** Appliances specialty operational home (`/?section=appliances`)  
**Constitution:** Arts. VII–XII (authority, provenance, intelligence, specialty), XV–XVII (hierarchy / mobile / config vs operate), XX–XXI (earn complexity; evidence for change)

---

## Product purpose

> **The Zebra tells you what the system believes exists.  
> DeptSync records what a person physically proved was there.**

DeptSync does **not** replace Lowe’s inventory authority.

DeptSync independently:

- preserves **physical observation** evidence
- lets the DS **declare** Lowe’s on-hand after consultation
- **derives** reconciliation variance
- preserves outcomes and notes
- learns from **longitudinal** evidence over time

### Canonical lifecycle

```text
Location / Context
  → Physical Scan
  → Physical Count
  → Freeze Observation Evidence
  → Lowe’s Reconciliation
  → Outcome
  → Historical Record
  → Pattern
  → Future Audit Recommendation
```

### Operating mottos

- Teach once. Scan repeatedly. Reconcile afterward. Learn over time.
- Known information stays quiet. Exceptions ask for attention.
- DeptSync identifies the pattern. The DS determines what the pattern means.

Intelligence may interpret evidence; it must not manufacture evidence.  
If deterministic evidence already answers the question, do not pay an LLM to answer it.

---

## Dependency law

```text
Reliable controls
  → trustworthy audit lifecycle
  → richer physical observations
  → recurring observations
  → longitudinal evidence
  → deterministic intelligence
```

Later tranches must **not** leapfrog missing evidence foundations merely because the later feature is attractive.

---

## Field validation rule

A tranche is **not** operationally closed merely because tests pass, typecheck passes, build passes, or code is pushed.

For field-facing Appliance workflows, **real-device / store use** is part of acceptance whenever practical.

Field evidence may **reorder** future roadmap items.

---

## Roadmap status rule

New ideas should normally be:

1. captured  
2. classified  
3. placed in dependency order  
4. implemented only when prerequisites are ready  

Do not discard good ideas merely because they are not next.  
Do not allow new ideas to silently become the next implementation tranche.

---

## Tranche sequence

### Completed / current baseline

| ID | Name | Role |
|----|------|------|
| **APP-AUD-001** (+001A) | Durable physical audit & reconciliation foundation | Sessions, observation bind, close flush/block, DS-declared Lowe’s OH, derived variance, Option B recon state, evidence integrity |
| **APP-FIELD-001** / **001B** | Rapid-fire + teach repair + audit entry/exit | Local-first known COUNT; catalog `store_number`; Start/Continue primary; ad-hoc secondary; Review / Finish |
| **UX-NAV-001** | Specialty operational home | More → Department Tools → Appliances → audit-aware home (not bare scanner) |
| **APP-QA-001** | Surface reliability | Share/export repair; Gemini Scan Anomaly Detection removed from Appliances |

Still pending where noted: **real-hardware validation** for field-facing pieces.

---

### Next

#### APP-AUD-002 — Audit Closure & History Lifecycle

**Status:** **APP-AUD-002A** Option A committed (real-hardware validation pending). **APP-AUD-002B** Option B committed + production migration live (real-hardware validation pending).

**Canonical meaning:** `CLOSED` = physical observation closed / physical count frozen. It does **not** mean reconciliation complete. Reconciliation progress is **derived** from existing Option B snapshot rows (mutable current state). No `RECONCILED` session status. No declaration-version history. No hard lock after reconciliation. No auto-delete of historical audits.

**UX shipped in 002A:** two-phase lifecycle language; recent 3–5 CLOSED audits + View all; just-closed reconciliation banner; Start Physical Audit returns after close; export/email remain evidence-only (no lifecycle mutation).

**APP-AUD-002B Physical Evidence Freeze Hardening (Option B):**

- Audit membership is **explicit**: omit `audit_session_id` → unbound (server does **not** auto-bind to store ACTIVE).
- Canonical Physical Audit scanner supplies session id; ad-hoc and Floor/SIMS remain unbound.
- CLOSED freezes authoritative WHAT/WHERE/WHEN/WHICH fields (API + DB trigger); soft classification fields stay mutable for APP-OBS-001.
- Late in-window offline evidence (APP-AUD-001A) remains valid.
- Catalog snapshot/version provenance remains deferred (presentation drift only).

**Next after APP-AUD-002 closes:** APP-OBS-001 (implemented — migration apply + field validation pending).

### Queued (after APP-AUD-002 foundations)

#### APP-OBS-001 — Appliance Availability Classification

**Status:** Implemented (migration pending apply; real-hardware validation pending).

Per-unit physical observation: `fulfillment_disposition` on `appliance_scans`.

| Value | Meaning |
|-------|---------|
| `NULL` | No staged disposition recorded (**not** official availability) |
| `STAGED_PICKUP` | Blue sticker — staged for pickup |
| `STAGED_DELIVERY` | Blue sticker — staged for delivery |

**Orthogonal:** LOCATION ≠ CONDITION ≠ FULFILLMENT DISPOSITION.

Soft mutable after CLOSED (APP-AUD-002B soft-field set). Quiet rapid scan + optional last-unit Pickup/Delivery. Derived recon breakdown. Plain CSV column.

**Not:** official Lowe's availability, sellable inventory, correction history, ESL/multi-id (APP-CAT-001).

#### APP-CAT-001 — Local Catalog Promotion (+ multi-identifier)

Review locally taught mappings and **intentionally** promote valid ones into the authoritative store-scoped server catalog.

**Multi-identifier resolution (field requirement):** many taught barcodes / ESL identifiers → one canonical Lowe's item number → scan-and-go. Disposition attaches to the resolved scan/unit row, not raw barcode identity.

Do **not** automatically upload legacy local mappings (may predate authoritative store provenance).

---

### Later

#### APP-ROT-001 — Appliance Audit Rotation Foundation

Likely location-based recurring physical audits.

DeptSync **recommends** which appliance locations should be physically observed next.

Do **not** infer inventory discrepancy merely from physical change.

**Prerequisite:** trustworthy closed audits + history (APP-AUD-002) and stable observation richness.

#### APP-INT-001 — Deterministic Appliance Pattern Intelligence

No Gemini / external LLM required for **core** reasoning.

**Evidence-derived pattern candidates:**

- recurring non-zero reconciliation variance  
- variance frequency by SKU / by location  
- repeated direction / magnitude  
- duplicate serial observations  
- SKU across distant locations  
- showroom / topstock distribution  
- catalog / category mismatch  
- time since last physical observation  
- physical-location churn  

**Rules:**

- deterministic evidence first  
- no invented expected inventory  
- no shrink conclusions from physical change alone  
- confidence reflects evidence maturity  
- DS interprets operational meaning  

**Prerequisite:** longitudinal closed audits + recon outcomes (APP-AUD-002 → APP-ROT-001 evidence base).

---

## Parking lot (preserved, not scheduled ahead)

| Item | Notes |
|------|--------|
| Floor SIMS → active physical-audit binding | **Resolved by APP-AUD-002B:** contextual opens stay unbound (ignore cache; no server auto-bind). Revisit only with explicit product decision. |
| More → Tools relabel / nav evolution | UX-NAV-001 kept More label; fifth tab deferred |
| Global Gemini dependency review | Unrelated consumers (Snap Bay, walk parse, etc.) intact after APP-QA-001 |
| Declaration-version history for reconciliation | Option B is current-state; immutable OH history not promised |
| Retention / archive policy | Only if storage warrants |
| Seasonal / location intelligence integration | Outside core appliance evidence path |
| Department-scoped topology RBAC | **Outside** Appliance roadmap (e.g. RBAC-TOPO-001) |

---

## Idea intake

Capture field ideas here or in handoff notes with: source (store/device), evidence class, proposed tranche class (next / queued / later / parking), and blocked-by prerequisites.

Do not start implementation until the idea is placed in this roadmap.
