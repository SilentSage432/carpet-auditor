# DEPTSYNC-ROTATION-AUTO-005B — Shift-Independent Rotation Production Release

**Status:** RELEASED  
**Date:** 2026-10-16 (deploy UTC 2026-10-17)  
**Mode:** Authorized controlled production release (isolated application correction)  
**Application:** https://deptsync-hub.vercel.app  
**Supabase:** `fmeinlwhixngednabhgy`  
**Store:** 2587 · Flooring / Home Decor  

**Authority:** AUTO-005A correction · AUTO-005 Stage 1 · this release  

**Strict exclusions honored:** Automatic publication **DISABLED** · no database migrations · no weekly assignment create/modify · no cron trigger · no Assign This Week · no Force Draw · no AUTO-006 · no specialty · no Orient · no authentication changes · no capacity redistribution.

---

## 1. Executive summary

Production now runs the AUTO-005A shift-independence correction: weekly bay assignment eligibility no longer requires scheduled shift hours. Active associates with approved capacity remain assignable with **zero** shifts; shift rows stay for schedules, fingerprints, and display only.

| Decision | Verdict |
|----------|---------|
| Isolated AUTO-005A app release | **GO — RELEASED** |
| Assignment / lock / capacity / section preservation | **Preserved** |
| Automatic publication enablement | **NO-GO** (latch remains OFF) |
| Database migrations | **Not applied** (none authorized) |
| AUTO-006 / specialty / Orient | **NOT STARTED** |

---

## 2. Files changed (app commit)

| Path | Change |
|------|--------|
| `lib/store-ops/labor-availability.ts` | `weekLaborToAssignmentMembers` (includes zero-hour actives) |
| `lib/store-ops/shared-week-capacity.ts` | Eligible from `labor.members`, not allocatable |
| `lib/store-ops/approved-week-capacity.ts` | Load + review board: shift-independent eligibility |
| `lib/store-ops/section-ownership-enforcement.ts` | Strict planner no longer requires hours > 0 |
| `lib/store-ops/sunday-dispatch.ts` | Assignment members from `labor.members` |
| `components/admin/SundayAuditAssignmentModal.tsx` | Stewardship / preview / assign use assignment members |
| `lib/store-ops/rotation-auto-005a.shift-independence.test.ts` | New regression suite |
| `lib/store-ops/shared-week-capacity.test.ts` | Expectations for shift-independent eligibility |
| `docs/product/DEPTSYNC_ROTATION_AUTO_005A_SHIFT_INDEPENDENCE.md` | AUTO-005A verification report |

**Excluded from release:** `DEPTSYNC_RD_6_*`, `DEPTSYNC_SEC_OPS_010A_*`, `DEPTSYNC_SPECIALTY_OPS_001_*`, `tmp/`.

**Not weakened:** section ownership · store/department isolation · capacity enforcement · supervisor edit protection · completed/verified protection · auto-publish latch.

---

## 3. App commit

| Field | Value |
|-------|--------|
| Repository | `SilentSage432/carpet-auditor` |
| Branch | `main` |
| Commit | **`18f8d06`** (`18f8d06a1bfcd07b6dc9ca04e57b14c923c340e4`) |
| Message | `fix(rotation): stop gating weekly bay eligibility on shift hours` |
| Prior tip | `1aaeed9` |
| Push | `1aaeed9..18f8d06` → `origin/main` |
| AUTO-005A marker | `weekLaborToAssignmentMembers` present in shipped tree |
| Latch in source | `WEEKLY_ROTATION_AUTO_PUBLISH = false` |

---

## 4. Documentation commit

| Field | Value |
|-------|--------|
| Commit | *(this report + journal / handoff / roadmap — see tip after docs push)* |
| Contents | This report; AUTO-005A status mark-deployed; DEVELOPMENT_JOURNAL / CHAT_HANDOFF / MASTER_ROADMAP |

---

## 5. GitHub Actions / deployment result

| Field | Value |
|-------|--------|
| GitHub Production deployment | **`7135326580`** |
| SHA | `18f8d06a1bfcd07b6dc9ca04e57b14c923c340e4` |
| Environment | Production |
| Created | 2026-10-17T05:30:33Z |
| Deployment status | **success** — “Deployment has completed” |
| Commit status (Vercel) | **success** |
| Workflow runs for SHA | **0** (repo deploys via Vercel GitHub integration; no Actions workflow required for this release) |

---

## 6. Vercel deployment result

| Field | Value |
|-------|--------|
| Status URL | https://vercel.com/tyson-zauggs-projects/deptsync-hub/A7PjCm5uPf7EHvDWqQC4qVLDGWNs |
| Deployment id | `dpl_A7PjCm5uPf7EHvDWqQC4qVLDGWNs` |
| Environment URL | https://deptsync-6x7ydu8ux-tyson-zauggs-projects.vercel.app |
| Status | **Ready** |
| Build commit | **`18f8d06`** (Vercel logs: `Cloning … Commit: 18f8d06`) |
| Production alias | https://deptsync-hub.vercel.app |
| Alias binding | Confirmed on Ready deployment |

---

## 7. Production smoke results

| Check | Result |
|-------|--------|
| `GET /login` | **200** |
| `GET /` (unauth) | **307** |
| `GET /overview` (unauth) | **307** |
| `GET /map` (unauth) | **307** |
| `GET /this-week` (unauth) | **307** |
| `GET /walkthroughs` (unauth) | **307** |
| Unauth assign / cron APIs | **401** |
| Overview / Map / This Week / Walkthroughs | Available behind auth (redirect preserved) |
| Migrations applied | **None** |
| Cron triggered | **No** |
| Assign This Week / Force Draw | **Not executed** |

---

## 8. Pre/post assignment preservation

Read-only fingerprint comparison (`tmp/auto005b-baseline.json` → `tmp/auto005b-post.json`):

| Asset | Before | After | Verdict |
|-------|-------:|------:|---------|
| `sunday_bay_assignments` store 2587 | 30 | 30 | **Preserved** |
| Owned (non-cleared with specialist) | 30 | 30 | **Preserved** |
| `supervisor_locked = true` | 0 | 0 | **Preserved** |
| Completed / verified | 0 / 0 | 0 / 0 | **Preserved** |
| Assignment fingerprint | `b0bd2882b3aba625` | `b0bd2882b3aba625` | **Identical** |
| Active Operational Sections | 4 | 4 | **Preserved** |
| Section memberships | 160 | 160 | **Preserved** |
| Active `weekly_rotations` W42 | 9 | 9 | **Preserved** |
| Active `weekly_rotations` W43 | 0 | 0 | **Preserved** |

No production assignment mutations during release verification.

---

## 9. Capacity verification

| Week | Configuration | Sum | Verdict |
|------|---------------|----:|---------|
| **2026-W43** | Tyson **3**, Nate **3**, Nick **3**, Tracy **3** | **12** | **Unchanged** |

---

## 10. Automatic publication latch status

| Gate | Status |
|------|--------|
| `WEEKLY_ROTATION_AUTO_PUBLISH` | **`false`** in shipped commit `18f8d06` |
| Env alone enable | **Ignored** while latch false |
| Activation flipped this tranche | **No** |
| Expected cron assign outcome | **`STAGED_AWAITING_ASSIGN`** (stage only) |

---

## 11. Exact test results (pre-push)

| Check | Result |
|-------|--------|
| AUTO-005A shift-independence | **8 PASS** |
| AUTO-002 section-balanced | **13 PASS** |
| AUTO-003 publication / edit-safe | **17 PASS** |
| Sunday dispatch / capacity / ownership / stewardship | Included in suite |
| SEC-OPS-010 authz | **20 PASS** |
| **Suite total** | **10 files / 178 PASS** |
| `npx tsc --noEmit` | **PASS** |
| ESLint (AUTO-005A core sources) | **PASS** (0 errors) |
| `npm run build` | **PASS** |

Proven locally (sufficient eligible bays assumed): **0 shifts → 3/3/3/3**, **1 shift → 3/3/3/3**, **many shifts → 3/3/3/3**. Candidates were not fabricated to reach 12.

---

## 12. Remaining activation prerequisites

1. Phone acceptance of shift-independent eligibility + section-balanced stage on a real future week.  
2. Confirm target-week schedules for fingerprint freshness; Master re-approves capacity if fingerprints go stale.  
3. Dedicated enablement commit (AUTO-006): flip `WEEKLY_ROTATION_AUTO_PUBLISH` to `true`.  
4. Set Production env `DEPTSYNC_WEEKLY_ROTATION_AUTO_PUBLISH=1`.  
5. Prefer first auto-publish Sunday targeting a **future** week (`sundayStagingWeekLabel`).  
6. Keep Force Draw Master-only; never cron force-overwrite.  
7. Do **not** begin specialty or Orient work in that tranche.

---

## 13. GO / NO-GO verdict

| Decision | Verdict |
|----------|---------|
| AUTO-005B isolated production release | **GO — RELEASED** |
| Automatic publication enablement | **NO-GO** |
| AUTO-006 | **NOT STARTED** |
| Specialty / Orient | **NO-GO** |
| Migrations / assignment mutation | **NO-GO** (honored) |

### Bottom line

Production alias https://deptsync-hub.vercel.app serves **`18f8d06`** with shift-independent weekly bay eligibility. Existing assignments, locks, sections, and W43 capacity **3/3/3/3=12** are unchanged. Automatic publication remains hard-off.

**STOP AFTER RELEASE REPORT.** Do not enable automatic publication. Do not begin AUTO-006. Do not begin specialty or Orient work.
