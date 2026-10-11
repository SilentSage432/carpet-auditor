# DEPTSYNC-SECTION-UX-001 — Aisle-Based Operational Section Membership

**Status:** COMPLETE (local implementation + tests; no production deploy)  
**Date:** 2026-10-11  
**Mode:** Controlled implementation  
**Application:** https://deptsync-hub.vercel.app (unchanged)  
**Supabase:** `fmeinlwhixngednabhgy` (no SQL / no data mutations)

**Strict exclusions honored:** No production data mutations, no schema changes, no automatic section reassignment, no rotation/capacity changes, no production deployment.

---

## 1. Executive summary

Replaced bay-by-bay Operational Section membership picking with an **aisle-first multi-select** experience. Selecting an aisle expands to every **currently documented active** physical bay in that aisle. Persistence remains the existing explicit `operational_section_members` bay-keyed model.

| Gate | Result |
|------|--------|
| Aisle multi-select + active bay counts | **PASS** |
| Expand aisle → explicit bay refs | **PASS** |
| Preview before save (aisles, totals, conflicts, zero-active) | **PASS** |
| ≤1 active section per bay; no silent moves | **PASS** |
| Edit preserves existing membership unless operator adds | **PASS** |
| Stewards / history / events unchanged | **PASS** |
| Rotation engine + capacity guard untouched | **PASS** |
| Typecheck / tests / build | **PASS** (`tsc`; **1614** tests; production build) |

**Release readiness:** **CONDITIONAL GO** for app deploy after operator phone review. **NO-GO** for production data/schema changes (none required).

---

## 2. Files changed

| Path | Change |
|------|--------|
| `lib/store-ops/section-aisle-membership.ts` | **New** — aisle expand, claim index, preview, stale fingerprint |
| `lib/store-ops/section-aisle-membership.test.ts` | **New** — regression suite |
| `components/admin/OperationalSectionsPanel.tsx` | Aisle multi-select + preview confirm; remove per-bay checkbox drill-in |
| `lib/rd3.operational-sections.contract.test.ts` | Accept aisle-membership composer wiring |
| `docs/product/DEPTSYNC_SECTION_UX_001_IMPLEMENTATION.md` | This report |

**Unchanged:** membership APIs (`/api/operational-sections*`), schema, RLS, stewards, section events, Sunday rotation, shared capacity RPC.

---

## 3. Selection experience

1. Operator opens **Select aisles** / **Add aisles**.  
2. Mobile list shows each active aisle with:
   - Active bay count  
   - Available / conflict / already-included counts  
3. Multiple aisles can be checked.  
4. **Preview before save** shows:
   - Selected aisle labels  
   - Total bays to add  
   - Conflicts (kept in other section)  
   - Zero-active aisles (if any)  
   - Partial aisles  
5. Confirm expands to bay refs and:
   - **Create:** merges into pending members (persist on Create section)  
   - **Edit:** `addOperationalSectionMembersClient` with only new available bays  

Retired bays are excluded via active-only aisle index (`showRetired: false`).

---

## 4. Invariants preserved

| Invariant | How |
|-----------|-----|
| Explicit bay membership model | Preview expands to `(department_id, aisle, bay)` refs |
| ≤1 active section per bay | Conflicted bays listed, excluded from add set |
| No silent reassignment | Never remove/move other section’s members |
| Edit preserves members | Existing keys skipped; only additive unless operator Removes |
| Stewards / events | Meta/lifecycle APIs unchanged; member_added events still fire on add |
| No future auto-include | Expansion uses current `locations` snapshot only |
| New unassigned bays discoverable | Re-open picker after Map documentation updates aisle counts |
| Store / dept / auth | Existing Supervisor/Master + department-scoped index |
| Rotation / capacity | Module does not import dispatch or capacity writers |

---

## 5. Stale selection protection

Preview fingerprint covers selected aisle keys, bay keys to add, claimed keys, and existing member keys. Confirm recomputes and `assertSectionAislePreviewFresh` rejects drift (topology, membership, or conflicts changed).

---

## 6. Test results

| Gate | Result |
|------|--------|
| Focused `section-aisle-membership.test.ts` | **14 PASS** |
| RD-3 contracts | **PASS** |
| Full suite | **1614 PASS** (128 files) |
| `npx tsc --noEmit` | **PASS** |
| `npm run build` | **PASS** |

Covered: single/multiple aisles, empty aisle, retired bays, conflicts, edit preserve, partial aisle, duplicates, cross-dept isolation, stale fingerprint, mobile target sizes, engine non-wiring.

---

## 7. Remaining risks

| Risk | Notes |
|------|-------|
| Incomplete topology | Empty aisle list until Map documents active bays — intentional |
| Partial aisles | Operator must resolve conflicts by editing the other section first |
| Create multi-round pick | Pending bays accumulate until Create; fingerprint scoped per confirm |
| Phone UX | Needs Samsung/field acceptance for aisle checkbox density |

---

## 8. Release readiness

| Question | Verdict |
|----------|---------|
| Local implementation complete | **GO** |
| Schema / production SQL | **NO-GO** (not needed) |
| Production data mutation | **NO-GO** |
| App deploy after operator review | **CONDITIONAL GO** |
| Automatic section reassignment | **NO-GO** (not implemented) |

**STOP — implementation complete locally. No production deployment.**
