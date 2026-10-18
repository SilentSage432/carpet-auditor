# DEPTSYNC-ROTATION-AUTO-007 — Scheduler Correction & Observability Release

**Status:** RELEASED  
**Date:** 2026-10-18  
**Mode:** Authorized controlled production release (scheduler + observability only)  
**Application:** https://deptsync-hub.vercel.app  
**Supabase:** `fmeinlwhixngednabhgy`  
**Store:** 2587 · Flooring / Home Decor  

**Authority:** AUTO-006 activation readiness engineering · AUTO-005B production foundation · this release  

**Strict exclusions honored:** Automatic publication **DISABLED** · no database migrations · no weekly assignment create/modify · no manual cron trigger · no Assign This Week · no Force Draw · no AUTO-008 activation · no specialty · no Orient · no production activation env gate changes.

---

## 1. Released changes

| Item | Change |
|------|--------|
| A. Sunday cron | `vercel.json` Hobby schedule `0 11 * * 0` → **`0 12 * * 0`** (Sunday 12:00 UTC) |
| B. Observability | `SundayDispatchResult.auto_publish_enabled` — false on staging-only; true only when dual-gate publish path runs |
| C. Regression coverage | `rotation-auto-006.activation-readiness.test.ts` + Sunday-gate / cron expectation updates |
| D. Documentation | This report; AUTO-006 readiness canonical; journal / handoff / roadmap |

| Path | Role |
|------|------|
| `vercel.json` | Cron schedule correction |
| `app/api/cron/weekly-rotation/route.ts` | Comment: 12:00 UTC year-round Denver window |
| `lib/store-ops/sunday-dispatch.ts` | `auto_publish_enabled` on dispatch results |
| `lib/store-ops/sunday-schedule.ts` | Comment alignment with 12:00 UTC cron |
| `lib/store-ops/rotation-auto-006.activation-readiness.test.ts` | New suite (boundaries / DST / contracts) |
| `lib/store-ops/engine-prod-002.sunday-dispatch.test.ts` | Gate tests use 12:00 UTC |
| `lib/store-ops/shared-week-capacity.test.ts` | Expects `"0 12 * * 0"` |

**Not changed:** `WEEKLY_ROTATION_AUTO_PUBLISH` · Production `DEPTSYNC_WEEKLY_ROTATION_AUTO_PUBLISH` · assignment writers · capacity · sections · migrations.

---

## 2. App commit

| Field | Value |
|-------|--------|
| Repository | `SilentSage432/carpet-auditor` |
| Branch | `main` |
| Commit | **`20dcc5f`** (`20dcc5f6acc7a5ad2e9c7b3fd180f721b52a419a`) |
| Message | `fix(rotation): align Sunday cron to 12:00 UTC and report publish latch` |
| Prior tip | `d5d7e96` |
| Push | `d5d7e96..20dcc5f` → `origin/main` |
| Latch in source | `WEEKLY_ROTATION_AUTO_PUBLISH = false` |
| Cron in shipped tree | `"0 12 * * 0"` |

---

## 3. Documentation commit

| Field | Value |
|-------|--------|
| Commit | **`30c6ffa`** (ship report) · tip **`841ca35`** on `main` |
| Contents | This report; `DEPTSYNC_ROTATION_AUTO_006_ACTIVATION_READINESS.md`; DEVELOPMENT_JOURNAL / CHAT_HANDOFF / MASTER_ROADMAP |

---

## 4. GitHub workflow result

| Field | Value |
|-------|--------|
| GitHub Production deployment | **`7157155776`** |
| SHA | `20dcc5f6acc7a5ad2e9c7b3fd180f721b52a419a` |
| Environment | Production |
| Created | 2026-10-18T16:10:10Z |
| Deployment status | **success** — “Deployment has completed” |
| Commit status (Vercel) | **success** |
| Workflow runs for SHA | **0** (repo deploys via Vercel GitHub integration; no Actions workflow required) |

---

## 5. Vercel deployment

| Field | Value |
|-------|--------|
| Status URL | https://vercel.com/tyson-zauggs-projects/deptsync-hub/FdmqooBRSFqnKxaB3Eq1SaAcqBs3 |
| Deployment id | `FdmqooBRSFqnKxaB3Eq1SaAcqBs3` |
| Environment URL | https://deptsync-fi8fq96y1-tyson-zauggs-projects.vercel.app |
| Status | **Ready** (GitHub: Deployment has completed) |
| Build commit | **`20dcc5f`** |
| Production alias | https://deptsync-hub.vercel.app |
| Alias smoke | `/login` **200** after deploy |

---

## 6. Effective cron configuration

| Check | Result |
|-------|--------|
| `vercel.json` on `20dcc5f` | `"schedule": "0 12 * * 0"` |
| Path | `/api/cron/weekly-rotation` |
| Vercel cron timezone | **UTC** (platform always UTC; no TZ field) |
| Day of week | **0 = Sunday** |
| Store timezone | **America/Denver** |
| Target week | `sundayStagingWeekLabel` — Sunday local → upcoming Monday ISO week |
| Publication | Not activated — latch OFF → stage only |

---

## 7. Winter / summer timing verification

Independent `Intl` America/Denver checks + AUTO-006 suite:

| Instant | Local Denver | Gate (≥05:00 Sunday) |
|---------|--------------|----------------------|
| 2026-10-18T12:00:00Z (MDT) | **Sun 06:00 MDT** | **OPEN** |
| 2026-03-08T12:00:00Z (spring DST) | **Sun 06:00 MDT** | **OPEN** |
| 2026-11-01T12:00:00Z (fall-back) | **Sun 05:00 MST** | **OPEN** |
| 2027-01-03T12:00:00Z (mid-winter) | **Sun 05:00 MST** | **OPEN** |
| Legacy 2026-11-01T11:00:00Z | **Sun 04:00 MST** | **CLOSED** (documents prior winter skip) |

**Confirmed:** 12:00 UTC ↔ **06:00 MDT** or **05:00 MST**. Schedule and local execution gate align in both seasons. No STOP correction required.

**Hobby note:** Vercel may invoke anywhere within the scheduled UTC hour; 12:00–12:59 UTC remains ≥05:00 MST and ≥06:00 MDT.

---

## 8. Activation latch status

| Gate | Status |
|------|--------|
| `WEEKLY_ROTATION_AUTO_PUBLISH` | **`false`** in shipped commit `20dcc5f` |
| Env alone enable | **Ignored** while latch false |
| Production env publish gate | **Not modified** this tranche |
| Cron body / query elevate | **Impossible** (CRON_SECRET only; no publish params) |
| Expected cron assign outcome | **`STAGED_AWAITING_ASSIGN`** + `auto_publish_enabled: false` + `created_assignments: 0` |

---

## 9. Assignment preservation evidence

Read-only (`tmp/auto007-baseline.json` → `tmp/auto007-post.json`):

| Asset | Before | After | Verdict |
|-------|-------:|------:|---------|
| `sunday_bay_assignments` store 2587 | 30 | 30 | **Preserved** |
| Owned (non-cleared with specialist) | 30 | 30 | **Preserved** |
| `supervisor_locked = true` | 0 | 0 | **Preserved** |
| Completed / verified | 0 / 0 | 0 / 0 | **Preserved** |
| Assignment fingerprint | `b0bd2882b3aba625` | `b0bd2882b3aba625` | **Identical** |
| Active Operational Sections | 4 | 4 | **Preserved** |
| Section memberships | 160 | 160 | **Preserved** |
| W43 capacity sum | 12 (3/3/3/3) | 12 (3/3/3/3) | **Preserved** |
| Active `weekly_rotations` W42 | 9 | 9 | **Preserved** |
| Active `weekly_rotations` W43 | 12 | 12 | **Unchanged this deploy** |

**Note:** W43 active rotations were already **12** at pre-deploy baseline (ordinary Sunday stage earlier today under the prior `0 11 * * 0` schedule while latch OFF). This release did **not** manually invoke cron, Assign This Week, or Force Draw. SBA ownership fingerprint is unchanged — staging is not publication.

---

## 10. Production smoke results

| Check | Result |
|-------|--------|
| `GET /login` | **200** |
| `GET /` (unauth) | **307** |
| `GET /overview` (unauth) | **307** |
| `GET /map` (unauth) | **307** |
| `GET /this-week` (unauth) | **307** |
| `GET /walkthroughs` (unauth) | **307** |
| Unauth `/api/week-capacity` | **401** |
| Unauth `/api/weekly-rotations` | **401** |
| Unauth `/api/cron/weekly-rotation` | **401** |
| Migrations applied | **None** |
| Cron manually triggered | **No** |
| Assign This Week / Force Draw | **Not executed** |
| Automatic publication | **OFF** |

---

## 11. Exact validation results

| Check | Result |
|-------|--------|
| AUTO-006 activation-readiness | **27 PASS** |
| AUTO-005A shift-independence | **8 PASS** |
| AUTO-002 section-balanced | **13 PASS** |
| AUTO-003 publication / edit-safe | **17 PASS** |
| Sunday dispatch / capacity / ownership / stewardship / SEC-OPS-010 | Included |
| **Suite total** | **10 files / 180 PASS** |
| `npx tsc --noEmit` | **PASS** |
| ESLint (changed sources) | **PASS** (0 errors; 1 pre-existing unused-`vi` warning) |
| `npm run build` | **PASS** |

---

## 12. Remaining activation prerequisites

1. Phone acceptance of automatic Sunday publish behavior (still outstanding).  
2. Confirm target-week capacity approvals remain fresh (W43-style **3/3/3/3 = 12**).  
3. Dedicated enablement commit: flip `WEEKLY_ROTATION_AUTO_PUBLISH` to `true`.  
4. Set Production env `DEPTSYNC_WEEKLY_ROTATION_AUTO_PUBLISH=1`.  
5. Prefer first auto-publish Sunday targeting a still-future week after enablement lands.  
6. Keep Force Draw Master-only; never cron force-overwrite.  
7. Do **not** begin specialty or Orient work in the enablement tranche.

Canonical enablement runbook remains in [`DEPTSYNC_ROTATION_AUTO_006_ACTIVATION_READINESS.md`](DEPTSYNC_ROTATION_AUTO_006_ACTIVATION_READINESS.md).

---

## 13. GO / NO-GO verdict

| Decision | Verdict |
|----------|---------|
| AUTO-007 scheduler + observability production release | **GO — RELEASED** |
| Automatic publication enablement | **NO-GO** (latch remains OFF) |
| AUTO-008 activation | **NOT STARTED** |
| Specialty / Orient | **NO-GO** |
| Migrations / assignment mutation | **NO-GO** (honored) |

### Bottom line

Production alias https://deptsync-hub.vercel.app serves **`20dcc5f`** with Sunday cron **`0 12 * * 0`** and explicit `auto_publish_enabled` reporting. Existing assignment ownership fingerprint **`b0bd2882b3aba625`**, locks, sections **4×160**, and W43 capacity **3/3/3/3=12** are unchanged. Automatic publication remains hard-off.

**STOP AFTER RELEASE REPORT.** Do not enable automatic publication. Do not begin AUTO-008. Do not begin specialty or Orient work.
