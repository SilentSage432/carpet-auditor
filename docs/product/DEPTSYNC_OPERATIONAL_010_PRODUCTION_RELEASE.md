# DEPTSYNC-OPERATIONAL-010 — Production Release

**Status:** RELEASED — AWAITING PHONE ACCEPTANCE  
**Date:** 2026-10-12  
**Mode:** Controlled app-only production release  
**Store:** 2587  
**Supabase:** `fmeinlwhixngednabhgy`  
**Application:** https://deptsync-hub.vercel.app  

**Implements:** [`DEPTSYNC_OPERATIONAL_009_IMPLEMENTATION.md`](DEPTSYNC_OPERATIONAL_009_IMPLEMENTATION.md)  
**Diagnosis:** [`DEPTSYNC_OPERATIONAL_SECTIONS_008_REGRESSION.md`](DEPTSYNC_OPERATIONAL_SECTIONS_008_REGRESSION.md)

**Strict exclusions honored:** No database migration; no section rebuild; no W41 rewrite; no W42 assignment creation; no capacity/schedule mutations; Sunday auto-stage remains **HARD OFF**.

---

## 1. Released commit

| Field | Value |
|-------|--------|
| Repository | `SilentSage432/carpet-auditor` |
| Branch | `main` |
| Commit | **`43505f5`** (`43505f5c52dd33b2c1a8363dfbf039c8a8f7716f`) |
| Message | `OPERATIONAL-009: fix sections list filter and stewardship-only assign` |
| Prior tip | `cd3c5fe` (ZEBRA-HANDOFF-004 docs) |
| Push | `cd3c5fe..43505f5` → `origin/main` |
| Migrations in commit | **None** |

**Scoped files only** (excluded SEC-OPS-010 / RD_6 / `tmp/` dirt):

- `components/admin/OperationalSectionsPanel.tsx`
- `components/admin/SundayAuditAssignmentModal.tsx`
- `components/hub/tabs/FloorTab.tsx`
- `lib/store-ops/operational-sections-department-filter.ts` (+ test)
- `lib/store-ops/weekly-stage-draw.ts` (+ test)
- `lib/store-ops/this-week-ownership.ts`
- `lib/store-ops/stage-assign-cue-001.contract.test.ts`
- Docs 008/009 + journal / handoff / roadmap

---

## 2. Deployment ID

| Field | Value |
|-------|--------|
| GitHub Production deployment | **`7014663741`** |
| State | **success** (`Deployment has completed`) |
| Target URL | https://deptsync-e7cfso5ez-tyson-zauggs-projects.vercel.app |
| Production alias | https://deptsync-hub.vercel.app |
| Alias commit match | **`origin/main` = `43505f5`** (verified post-push fetch) |
| Created | 2026-10-12T13:00:06Z |

Pre-release gates: focused **82** PASS · `tsc --noEmit` PASS · `npm run build` PASS.

---

## 3. Production verification

### HTTP smoke (no auth bypass)

| Check | Result |
|-------|--------|
| `GET /login` | **200** |
| Unauth `GET /api/week-capacity?week=2026-W42` | **401** `Unauthorized` |
| Unauth `GET /api/operational-sections` | **401** `Unauthorized` |
| Deploy target `/login` | **302** (Vercel auth/alias hop; expected for preview host) |

### Released code-path contracts (tree at `43505f5`)

| Contract | Result |
|----------|--------|
| `handleBalanceAssign` uses `composeStewardshipWeeklyProposal` | **PASS** |
| Assign requires `approvals_complete` / capacity board | **PASS** |
| Assign does **not** call `buildScheduleBalancePlan` | **PASS** |
| `SECTION_AWARE_ROTATION_AUTO_STAGE = false` | **PASS** |
| Panel does **not** fall back to `departments[0]` | **PASS** |

No real weekly assignments were created during automated verification.

---

## 4. Data preservation results

Read-only service-role SELECT on `fmeinlwhixngednabhgy` after deploy (no writes).

| Artifact | Expected | Actual |
|----------|---------:|-------:|
| Active Operational Sections | 4 | **4** |
| Section memberships | 160 | **160** |
| Sections total (incl. inactive) | 5 | **5** |
| Sunday assignments (store 2587) | 30 | **30** |
| W41 (`week_starting` 2026-10-05) | 6 | **6** |
| W42 (`week_starting` 2026-10-12) | 0 | **0** |
| Capacity approvals | 4 | **4** |
| W42 approved shared sum | 11 | **11** |
| Zebra entered (`zebra_entered_at` set) | 0 | **0** |
| Zebra null (columns present, unset) | 30 | **30** |
| Weekly rotations (store) | preserved | **168** |
| W42 staged rotations | (pre-existing unowned stage) | **12** |
| W41 staged rotations | preserved | **6** |

### Stewardship map (unchanged)

| Section | Owner | Aisles | Members |
|---------|-------|--------|--------:|
| Myself | Tyson | 5, 6 | 34 |
| CSA | Nate | 7, 39, 40 | 60 |
| Specialist-A | Nick | 43, 44 | 35 |
| Specialist-B | Tracy | 41, 42 | 31 |

---

## 5. Assignment-path verification

| Requirement | Evidence |
|-------------|----------|
| Stewardship-aware distribution required to persist | Released `handleBalanceAssign` only composes stewardship proposal |
| Approved capacity required | Fail-closed without capacity board / `approvals_complete` |
| No automated assignment writes this release | W42 assignments remain **0** |
| Capacity RPC / authz unchanged | Unauth week-capacity **401**; no migration |
| Auto-stage | Remains hard-off |

Operator still confirms **Assign this week** once after reviewing the prepared proposal (no auto-publish).

---

## 6. Remaining blockers

1. **Phone acceptance** required for sections list (Full Store pin) and Assign this week UX.  
2. W42 has **12** staged rotations and **0** assignments — expected until operator confirms stewardship assign against approved capacity **11** (one staged bay may remain beyond capacity by design).  
3. W41 historical non-steward aisles remain historical (not rewritten).  
4. Local `vercel` CLI unavailable in this session; deploy identity confirmed via GitHub Production deployment API + `origin/main` SHA.

---

## 7. Phone acceptance steps

1. Open https://deptsync-hub.vercel.app and sign in as Master Admin.  
2. **More → Operational Sections** with Full Store pin — four sections should remain visible (no flash-then-empty).  
3. Pin Flooring — same four sections; create still available.  
4. Floor / This Week — if ownership recovery shows, open **Assign this week**.  
5. Confirm weekly capacity still approved (shared **11**).  
6. Review stewardship proposal (every proposed bay has an owner).  
7. Confirm **Assign this week** only when ready (this persists ownership — intentional operator action).  
8. Do **not** recalculate/stage unless recovery requires it.  
9. Confirm Zebra handoff UI still present on owned bays; no invented confirms.

---

**Verdict: RELEASED — AWAITING PHONE ACCEPTANCE.**  
**STOP.**
