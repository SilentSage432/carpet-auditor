# DEPTSYNC-RD-3-FIX-001 — Operational Sections Release Blocker Corrections

**Status:** COMPLETE (local engineering)  
**Date:** 2026-10-10  
**Authority:** DEPTSYNC-RD-3-RELEASE-READINESS blockers  
**Not authorized:** commit, push, deploy, production SQL, RD-4

---

## A. Files changed

| Path | Change |
|------|--------|
| `supabase/migrations/20261011_operational_sections.sql` | Aisle normalize trigger + expression unique index (pending migration updated in place) |
| `lib/store-ops/operational-sections.ts` | `loadOperationalSectionForStore`; store-scoped remove/retire/update/add/reactivate |
| `app/api/operational-sections/[id]/route.ts` | Load + dept assert before mutate; actor store only |
| `app/api/operational-sections/[id]/members/route.ts` | Load + dept assert; ignore client `store_id` |
| `lib/store-ops/operational-sections.authz.test.ts` | **New** FIX-001 regression coverage |
| `lib/rd3.operational-sections.contract.test.ts` | Migration normalize + store-scoped mutation contracts |
| Docs | Journal / handoff / roadmap / this report |

---

## B. Authorization correction

`removeOperationalSectionMembers` (and retire/update/add/reactivate) now:

1. Resolve section via `loadOperationalSectionForStore(section_id, actor.store_id)`
2. Return `not_found` when section missing or `store_id` mismatch
3. API layer: `requireSupervisorOrAdmin` → actor store → load → `assertActorCanAccessDepartmentId` → mutate
4. Client-supplied `store_id` on members body is ignored (documented)
5. Service role used only after those checks — never as substitute for operator auth

---

## C. Database uniqueness correction

Pending migration `20261011_operational_sections.sql`:

- BEFORE INSERT/UPDATE trigger `normalize_operational_section_aisle` = `trim → upper → collapse whitespace` (matches `normalizeAisle`)
- Unique expression index `operational_section_members_one_bay_idx` on `(department_id, regexp_replace(upper(trim(aisle)), …), bay)`
- Physical bay FKs / location identity unchanged

---

## D. Department authorization decision

**Yes — membership mutations require department-level authorization in addition to store-level.**

Applied existing contract: after store-scoped load, call `assertActorCanAccessDepartmentId` with the section’s `department_id` (not client-supplied). No new roles or auth flows.

---

## E. Regression tests

| Case | Coverage |
|------|----------|
| Cross-store membership removal rejected | `operational-sections.authz.test.ts` |
| Missing section rejected | same |
| Authorized removal succeeds (delete scoped by store_id) | same |
| Case-equivalent aisle conflicts | `sectionBayKey` / `findActiveBayMembershipConflicts` |
| Whitespace-equivalent aisle conflicts | same + SQL↔app normalize parity |
| Retire/reactivate conflict-safe | conflict helper + retire foreign-store guard |
| Map integration intact | `indexBaySectionLookups` + RD-3 contract on Map/sheet |
| Migration trigger + expression index | `rd3.operational-sections.contract.test.ts` |

**DB integration limitation:** No local Postgres in this environment — uniqueness is enforced by migration SQL + contract/parity tests, not a live `INSERT` against PostgreSQL.

---

## F. Verification results

| Check | Result |
|-------|--------|
| `npm run typecheck` | Pass |
| Relevant RD-3 / FIX-001 / RD-2 tests | **28 passed** |
| `npm test` | **1397 passed** (105 files) |
| `npm run build` | Pass — `/api/operational-sections*` present |
| Sunday / capacity / completions / auth / topology | Untouched (no code paths changed) |

---

## G. Remaining blockers

- Migration still **not applied** to production (intentional — not authorized here).
- Commit / push / deploy still require separate operator authorization.
- Live DB uniqueness proof deferred until a Postgres-backed environment is available or migration is applied in a non-prod target.

---

## H. GO / NO-GO recommendation

**CONDITIONAL GO for RD-3 release readiness engineering** — prior IDOR + aisle case/whitespace uniqueness blockers are corrected in code and pending migration.

**NO-GO for production deploy** until: (1) operator authorizes commit/push, (2) migration applied to the existing Supabase project, (3) smoke create/add/remove/Map/retire.

**Do not begin RD-4.**
