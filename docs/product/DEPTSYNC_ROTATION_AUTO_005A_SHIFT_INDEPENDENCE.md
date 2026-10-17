# DEPTSYNC-ROTATION-AUTO-005A — Shift-Independent Weekly Assignment Verification

**Status:** COMPLETE locally — **not deployed**  
**Date:** 2026-10-16  
**Mode:** Targeted verification + minimal correction  
**Authority:** Operator requirement after AUTO-005 Stage 1  
**Store context:** 2587 · capacity **Tyson 3 / Nate 3 / Nick 3 / Tracy 3 = 12**

**Strict exclusions honored:** No deploy · no migrations · no production assignment writes · `WEEKLY_ROTATION_AUTO_PUBLISH = false` · AUTO-006 not started · specialty / Orient untouched.

---

## 1. Executive summary

Weekly bay assignment **was incorrectly gated** by shift-hour eligibility (`known_available_hours > 0` / `labor.allocatable`). An active associate with **zero shift rows** (e.g. Nate on W43) was omitted from the eligible set, so approved capacity could not produce assignments for them.

**Correction applied (local only):** assignment eligibility is now active home-department workforce + approved capacity / section ownership / bay eligibility. Shift rows remain for schedules, fingerprints, reminders, and future Orient — they do **not** gate weekly bay assignment.

| Decision | Verdict |
|----------|---------|
| Shift-independent weekly rotation (code + tests) | **GO** |
| Production deploy of this correction | **NO-GO** this tranche |
| Enable automatic publication | **NO-GO** |

---

## 2. Exact shift dependencies discovered

| Surface | Pre-005A dependency | Blocks zero-shift assign? |
|---------|---------------------|---------------------------|
| `composeStoreWeekCapacity` | Eligible from `weekLaborToPlannerMembers(labor.allocatable)` | **Yes** |
| `loadApprovedStoreWeekCapacity` | Eligible from `labor.allocatable`; skipped approvals for non-eligible | **Yes** |
| `buildWeekCapacityReviewBoard` | `eligible = member.has_allocatable_hours` | **Yes** (UI + approval complete) |
| `validateCapacityApprovalItem` | Rejects `eligible: false` + positive cap | Indirect (board fed flag) |
| `sunday-dispatch` | `weekLaborToPlannerMembers(labor.allocatable)`; NO_ELIGIBLE on zero hours | **Yes** |
| Sunday **Assign this week** modal | `allocatable.length === 0` hard error; planner from allocatable | **Yes** |
| `planStrictSectionOwnershipAssignments` | Filtered `hours <= 0` always | **Yes** |
| Section-balanced stage selector | Pure geography/capacity slots | **No** (but slots came from capacity eligible) |
| Stewardship composer | Uses capacity eligible + members | **Yes** via members/hours |
| Capacity / ownership RPC | Fingerprint uses shifts; write does not require hours | **No** (fingerprint only) |
| Auto-publish path | Same as dispatch+composer; latch OFF | Would have been **Yes** if enabled |

**Root cause:** ENGINE-PROD-002 / LAB-WEEK “allocatable hours” semantics were reused as the weekly **bay assignment** eligibility set after ROTATION-005 capacity approvals landed. Operator law: capacity + section ownership gate assignment; shifts do not.

---

## 3. Correction necessary?

**Yes.** Without code change, Nate with approved capacity **3** and **0** W43 shifts could not enter `eligible_specialist_ids` or receive stewardship proposal items.

---

## 4. Files changed

| Path | Change |
|------|--------|
| `lib/store-ops/labor-availability.ts` | New `weekLaborToAssignmentMembers` (includes zero-hour actives) |
| `lib/store-ops/shared-week-capacity.ts` | Eligible from `labor.members`, not allocatable |
| `lib/store-ops/approved-week-capacity.ts` | Load + review board: active associates eligible regardless of shifts |
| `lib/store-ops/section-ownership-enforcement.ts` | Strict planner no longer requires hours > 0 |
| `lib/store-ops/sunday-dispatch.ts` | Assignment members from `labor.members`; capacity-backed eligible count |
| `components/admin/SundayAuditAssignmentModal.tsx` | Stewardship / preview / assign click use assignment members |
| `lib/store-ops/rotation-auto-005a.shift-independence.test.ts` | **New** regression suite |
| `lib/store-ops/shared-week-capacity.test.ts` | Expectations updated for shift-independent eligibility |
| `docs/product/DEPTSYNC_ROTATION_AUTO_005A_SHIFT_INDEPENDENCE.md` | This report |

**Preserved:** shift tables/UI, fingerprint staleness, capacity RPC, section ownership RPC, supervisor locks, SEC-OPS-010, auto-publish latch **false**, MasterAdmin exclusion.

---

## 5. Tests added

`lib/store-ops/rotation-auto-005a.shift-independence.test.ts` (8 tests):

- Latch remains OFF  
- Assignment members include zero-hour actives; planner-hours helper still hour-gated  
- `composeStoreWeekCapacity` keeps zero-shift associates eligible at sum **12**  
- Capacity review board: zero-shift associates are **eligible** (not `ineligible`)  
- Section-balanced stage identical for 0/1/many shifts (pure selector)  
- Stewardship proposal identical for 0/1/many shifts → **3/3/3/3 = 12**  
- Strict ownership planner assigns with `hours: 0` when remaining capacity > 0  
- Source contracts: dispatch/modal/approved use membership-based eligibility  

---

## 6. Validation results

| Check | Result |
|-------|--------|
| AUTO-005A + related focused suite | **9 files / 153 PASS** |
| `npx tsc --noEmit` | **PASS** |
| ESLint (core AUTO-005A sources) | **PASS** (0 errors) |
| ESLint `SundayAuditAssignmentModal.tsx` | Pre-existing `react-hooks/set-state-in-effect` (unchanged) |
| `npm run build` | **PASS** |
| `WEEKLY_ROTATION_AUTO_PUBLISH` | **`false`** |

---

## 7. Remaining blockers

1. **Not deployed** — production still runs pre-005A eligibility until an authorized app release.  
2. **W43 Nate schedules** — capacity approval fingerprint can still go **stale** when shifts are later entered; Master must re-approve after schedule changes (unchanged product rule).  
3. **Auto-publish** remains OFF until AUTO-006 (not started).  
4. Flat schedule-balance recovery helper in the Sunday modal still uses hour-based planner members for a non-stewardship fallback path (not the authoritative Assign this week stewardship path).

---

## 8. GO / NO-GO

| Decision | Verdict |
|----------|---------|
| Shift-independent weekly rotation (local) | **GO** |
| Deploy this correction | **NO-GO** (await authorize) |
| Enable automatic publication | **NO-GO** |
| Begin AUTO-006 | **NO-GO** |

### Bottom line

Zero / one / many shift rows now yield the same eligible bay assignment outcome when active status, sections, capacity **3/3/3/3**, and rotation rules are held constant. Shifts inform scheduling evidence; they no longer decide who may own weekly bays.

**STOP.** Do not deploy. Do not enable automatic publication. Do not begin AUTO-006.
