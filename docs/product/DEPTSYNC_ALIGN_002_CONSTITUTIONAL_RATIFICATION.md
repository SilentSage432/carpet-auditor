# DEPTSYNC-ALIGN-002 — Constitutional Ratification & Implementation Readiness

**Status:** COMPLETE (documentation only)  
**Date:** 2026-10-10  
**Authority:** Ratifies operator-approved direction from DEPTSYNC-ALIGN-001 into governing law  
**Implementation:** NOT AUTHORIZED — no application code, schema, auth, UI, production, commit, or push

---

## 1. Purpose

Apply constitutional ratification for the single-operator Flooring + Home Decor product identity, section ownership, walkthrough principles, sovereign intelligence, and security posture — while clearly separating:

| Layer | Meaning |
|-------|---------|
| **A. Implemented reality** | What the running codebase / schema shape actually does |
| **B. Approved target architecture** | What ALIGN-002 makes law |
| **C. Unresolved migration decisions** | What must not be assumed |
| **D. Deferred capabilities** | What is approved but not scheduled |

---

## 2. Documents updated in this tranche

| File | Change |
|------|--------|
| `DEPTSYNC_CONSTITUTION.md` | ALIGN-002 amendments (identity, scope, sections, walkthroughs, chrome target, Art. XXV, Appendix debt) |
| `DEPT_SYNC_STATE.md` | Target-intent block; distinguish A/B/C/D; security debt pointer |
| `README.md` | Product identity aligned to ratified law |
| `ARCHITECTURE.md` | Identity + authority note; no module map rewrite claiming unimplemented screens |
| `docs/product/DEPTSYNC_REDUCE_002_BOUNDARY_AND_DECOUPLING_SPEC.md` | Historical-boundary banner under ALIGN-002 |
| `docs/product/DEPTSYNC_ALIGN_002_CONSTITUTIONAL_RATIFICATION.md` | This record + topology investigation |
| `MASTER_ROADMAP.md` | ALIGN-001/002 checklist entries |
| `DEVELOPMENT_JOURNAL.md` / `CHAT_HANDOFF.md` | Session continuity |

---

## 3. Approved architectural decisions (ratified)

1. Single authenticated **OPERATOR**; team members are operational records only.  
2. Active departments: **Flooring** and **Home Decor** (separate first-class — target).  
3. **Operational Sections** overlay topology; max one active section per physical bay; unsectioned bays stay visible/eligible.  
4. Permanent ownership ≠ weekly assignment ≠ temporary coverage ≠ work performed.  
5. Deterministic rotation engine preserved; 3-bay baseline = initial default; capacity eventually operator-configurable; no automatic cross-department workload multiplication.  
6. Section-aware selection = approved target engine behavior (not implemented here).  
7. Collaborative walkthroughs = leadership conversations; dedicated domain where needed; Floor Pad reuse where practical; no new storage until `manager_notes` / `shift_walk_tasks` reviewed.  
8. Target chrome: Overview (landing) · Map · This Week · Walkthroughs · More.  
9. Sovereign intelligence (Art. XXV); no integrations authorized.  
10. One operator ≠ weaker security; ALIGN-001 findings remain priority debt.

---

## 4. Deferred / unresolved (explicitly not implemented)

| ID | Item | Status |
|----|------|--------|
| C-1 | Flooring ↔ Home Decor department **migration strategy** | **UNRESOLVED** |
| C-2 | Operator-provided aisle/bay → department mapping for split | Required before migration design |
| D-1 | Operational Section schema + services | Deferred |
| D-2 | Section-aware rotation engine changes | Deferred |
| D-3 | Walkthrough domain + UI | Deferred (storage review first) |
| D-4 | Overview landing / IA chrome | Deferred |
| D-5 | Auth simplification / associate surface retirement | Deferred (after security + dependency inventory) |
| D-6 | Operator-configurable weekly capacity UI | Deferred |
| D-7 | Interoperability capability discovery | Deferred (path only) |
| D-8 | Security stabilization implementation | Deferred — **recommended next** |

---

## 5. Flooring / Home Decor topology investigation (read-only)

**Scope:** Repository schema, migrations, types, and seed/label conventions.  
**Not in scope:** Production database queries. Fixtures and seeds MUST NOT be treated as production truth.

### 5.1 How the merged department is represented

| Layer | Representation |
|-------|----------------|
| DB seed / migration | `departments.code = 'flooring'`, `name = 'Flooring / Home Decor'` — explicit absorb comment in `supabase/migrations/20260809_weekly_rotation_cron.sql` (“Flooring absorbs Home Decor (no separate Home Decor department)”) |
| Hub meta | `DEPARTMENT_META.flooring.label = "Flooring / Home Decor"`, description “Flooring & Home Decor (merged)” — `lib/types.ts` |
| Store-ops seed helper | `{ name: "Flooring / Home Decor", code: "flooring", ... }` — `lib/store-ops/stores.ts` |
| Alias | Hub/JWT treat `flooring` ≡ `D23` — `lib/store-ops/department-codes.ts`, RLS alias migrations |
| Home Decor code | **None** in `STORE_OPS_DEPARTMENT_CODES` |

### 5.2 How aisles and bays are identified

Physical obligation identity (BAY-UNIT-002):

```text
(department_id, aisle, bay)
```

- `store_locations.department_id` → `departments.id`  
- `aisle`: originally integer; evolved to **alphanumeric TEXT** (e.g. BW, RW, 12) — `lib/store-ops/types.ts`  
- `bay`: integer  
- `type`: `SELLING` | `TOPSTOCK` (topology surfaces; not separate coverage jobs)  
- Unique key historically `(department_id, aisle, bay, type)`  

There is **no** column for “Flooring vs Home Decor” inside the merged department.

### 5.3 Do existing records distinguish Flooring from Home Decor?

**No durable distinction** in repository-modeled topology:

- No `home_decor` department code  
- No location flag / zone enum for Home Decor vs Flooring  
- `location_type` (`STANDARD` | `SHOWROOM_STACKOUT`) and `workflow_type` do **not** encode Home Decor  
- Labels merge the names; shortLabel often says only “Flooring”

Any real-world aisle split exists only in human knowledge outside the schema.

### 5.4 Rotation / history tables referencing department or locations

| Table / artifact | Link |
|------------------|------|
| `store_locations` | `department_id` |
| `weekly_rotations` | `department_id`, `location_id` |
| `weekly_rotation_completion_attempts` | via parent rotation |
| `rotation_exceptions` | `department_id`, `location_id`, `rotation_id` |
| `sunday_bay_assignments` | `bay_id` → `weekly_rotations.id` |
| `bay_service_logs` | `location_id` (+ denormalized `department_code`) |
| `operational_context_*` | department / location relevance |
| `manager_notes` | `department` / `department_code` text (+ optional aisle/bay) |
| `shift_walk_tasks` | optional `location_id` text; department context varies |
| `bay_audit_logs` | `department_id` (historical) |
| `profiles` / `store_specialists` | assigned / home / accessible department codes |
| Specialty tables | may reference store/dept; REDUCE dormant |

Reassignment of `store_locations.department_id` would cascade semantically through all location-keyed history (rotation rows stay on `location_id`, but department filters and RLS department matching would shift).

### 5.5 Safe separation: reassignment vs additional mapping

| Approach | Feasibility (repo evidence) |
|----------|------------------------------|
| **Blind aisle reassignment** | Unsafe — no schema signal which aisles are Home Decor |
| **New `home_decor` department + operator mapping** | Plausible path — create department row; re-point selected `store_locations.department_id`; preserve location IDs so `weekly_rotations.location_id` history remains intact |
| **Overlay-only (sections) without dept split** | Can deliver section ownership sooner; does **not** satisfy Art. II-A “separate first-class departments” alone |
| **Delete/recreate locations** | Forbidden without reviewed plan — breaks FKs / RESTRICT completion attempts |

**Conclusion:** Safe separation **requires additional mapping evidence from the operator** (which aisles/bays belong to Home Decor). Pure automated reassignment from repository data is **not** available.

### 5.6 Historical relationships that must be preserved

- Location UUIDs and physical `(aisle, bay)` identity  
- `weekly_rotations` / completion attempts / exceptions keyed to locations  
- Coverage cycle fields on locations (`status`, `last_completed_at`, carry-over, priority)  
- Sunday assignment history  
- Seasonal location relevance  
- Roster member stable IDs and home-department strings (may need coordinated update)  
- Non-active department rows and their historical topology (do not delete)

### 5.7 Information the operator must provide before migration design

1. Authoritative list of aisles (and bay ranges if partial aisles) that are **Home Decor** vs **Flooring**.  
2. Whether any bay is shared / boundary / non-contiguous across both.  
3. Target codes/names for the two departments (e.g. keep `flooring` + add `home_decor`, or Lowe’s-style codes).  
4. How roster home departments should read after split (Specialists → Flooring; CSA + operator → Home Decor).  
5. Whether in-flight staged weeks must be rewritten, frozen, or completed before cutover.  
6. Confirmation that production topology matches (or differs from) any local seed — **production inspection is a separate authorized read-only tranche**.

---

## 6. Security stabilization readiness (from ALIGN-001; not remediated here)

| Priority | Finding | Locus |
|----------|---------|-------|
| P0 | Gate HMAC secret fallback chain incl. anon + hardcoded | `lib/auth-gate.ts` |
| P0 | Any Bearer passes `/api/*` edge gate | `proxy.ts` |
| P0 | Schema seed supervisor PIN `1234` | `supabase/schema.sql` |
| P1 | Bootstrap secret fallback to `CRON_SECRET` | state / bootstrap routes |
| P1 | Permissive RLS on flagged tables (repo migration) | `enable_rls_flagged_tables.sql` |
| P1 | Production RLS apply state unverified by this tranche | — |

Recommended next **implementation** tranche when authorized: **Security Stabilization (ALIGN-SEC-001)** — fail-closed gate secret, tighten proxy Bearer policy, neutralize seed credentials, produce read-only production RLS evidence — without weakening single-operator auth.

---

## 7. Recommended next implementation tranche

**ALIGN-SEC-001 — Security Stabilization** (highest leverage, lowest product-model risk).

Then, after G-OD migration inputs from the operator:

**ALIGN-DEPT-001** — Flooring / Home Decor separation design (docs + dry-run plan only), **or**  
**ALIGN-SEC-001** followed by **SECTION-001** domain overlay if the operator prefers sections before department split.

Do **not** auto-start engine, UI chrome, or walkthrough storage.

---

*End of ALIGN-002 ratification record.*
