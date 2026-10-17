# DEPTSYNC-ROTATION-AUTO-005 — Controlled Production Release (Stage 1)

**Status:** RELEASED — Stage 1 complete  
**Date:** 2026-10-16 (deploy UTC 2026-10-17)  
**Mode:** Authorized controlled release  
**Application:** https://deptsync-hub.vercel.app  
**Supabase:** `fmeinlwhixngednabhgy`  
**Store:** 2587 · Merged Flooring / Home Decor  

**Authority:** AUTO-001…004 · this Stage 1 release  

**Strict exclusions honored:** Automatic publication **DISABLED** · no AUTO-006 · no specialty implementation · no Orient · no plaintext fallback retirement · no authentication redesign · no current-week assignment mutation · no manual Assign / Force Draw as release verification.

---

## 1. Released app commit

| Field | Value |
|-------|--------|
| Repository | `SilentSage432/carpet-auditor` |
| Branch | `main` |
| Commit | **`57e3ab3`** (`57e3ab3b163d6659bd309c2ff865454f7ce5a695`) |
| Message | `feat(rotation): ship section-balanced stage and edit-safe assign path` |
| Prior tip | `9884d46` |
| Push | `9884d46..57e3ab3` → `origin/main` |
| Scoped contents | AUTO-002/003 engine + cron latch path + supervisor lock migration + focused tests + AUTO-001…004 docs + journal/handoff/roadmap |
| Excluded dirt | `DEPTSYNC_RD_6_*`, `DEPTSYNC_SEC_OPS_010A_*`, `DEPTSYNC_SPECIALTY_OPS_001_*`, `tmp/` |

---

## 2. Release documentation commit

| Field | Value |
|-------|--------|
| Commit | **`5550c54`** (`5550c54` / `docs(release): record ROTATION-AUTO-005 Stage 1 production ship` on `main`) |
| Contents | This report + journal / handoff / roadmap Stage-1 ship note |

---

## 3. GitHub production workflow

| Field | Value |
|-------|--------|
| GitHub Production deployment | **`7134860765`** |
| SHA | `57e3ab3b163d6659bd309c2ff865454f7ce5a695` |
| Environment | Production |
| Created | 2026-10-17T04:38:24Z |
| Deployment status | **success** (2026-10-17T04:38:25Z) |
| Commit status | Vercel **success** — “Deployment has completed” |

---

## 4. Vercel deployment

| Field | Value |
|-------|--------|
| Status URL | https://vercel.com/tyson-zauggs-projects/deptsync-hub/G4iT6QAYoRWoSsD36hJC2XtbhyGQ |
| Environment URL | https://deptsync-jg3upbpuf-tyson-zauggs-projects.vercel.app |
| Production alias | https://deptsync-hub.vercel.app |
| Alias smoke | `GET /login` → **200** |

---

## 5. Migration result

| Item | Result |
|------|--------|
| File | `supabase/migrations/20261021_rotation_auto_003_supervisor_lock.sql` |
| Project | `fmeinlwhixngednabhgy` |
| Pre-migrate backup | `tmp/production-backups/deptsync-fmeinlwhixngednabhgy-2026-10-17T04-36-17Z.dump` (**777686** bytes / TOC **1286**) |
| Apply | **COMMIT** (`ALTER TABLE` + comment + partial index) |
| `supervisor_locked` present | **true** |
| Nulls after migrate | **0** |
| Existing rows default `false` | **30 / 30** store 2587 |
| SBA count preserved | **30** (unchanged) |
| Index `sunday_bay_assignments_supervisor_locked_idx` | **present** |
| Capacity RPC still present | **true** |
| DB password | Management API ephemeral rotate → re-rotated; **not persisted** |

**Recovery:** drop index + drop column (app fail-opens on missing column; keep latch OFF if rolled back).

---

## 6. Capacity configuration evidence

Operator-approved prospective target: **Tyson 3 / Nate 3 / Nick 3 / Tracy 3 = 12**.

| Week | Configuration | Sum | Notes |
|------|---------------|----:|-------|
| **2026-W43** (prospective) | Tyson **3**, Nate **3**, Nick **3**, Tracy **3** | **12** | Written via `upsert_store_week_capacity_approvals` with live SQL fingerprints; approved_by Master Admin |
| **2026-W42** (current / in-flight) | Tyson **3**, Nate **0**, Nick **3**, Tracy **3** | **9** | **Left unchanged** (prospective-only policy; no assignment rewrite) |

W43 schedule evidence at write time: **19** shift rows (Nate **0** days present). Capacity row for Nate is approved at **3**; labor eligibility for staging still depends on known ON_DUTY hours when schedules land. If schedules change after approval, fingerprint may go **stale** until Master re-approves — unchanged product rule.

Twelve is the target, not permission to invent cross-section fills.

---

## 7. Assignment preservation evidence

| Asset | Before | After | Verdict |
|-------|-------:|------:|---------|
| `sunday_bay_assignments` store 2587 | 30 | 30 | **Preserved** |
| `supervisor_locked = true` | n/a (column absent) | 0 | Defaults safe |
| Active `weekly_rotations` W42 | 9 | 9 | **Preserved** (no restage / Force Draw) |
| Active `weekly_rotations` W43 | 0 | 0 | No premature stage |
| Operational Sections active | 4 | 4 | **Preserved** |
| Section memberships | 160 | 160 | **Preserved** |
| W42 capacity rows | sum 9 | sum 9 | **Unchanged** |

No Assign this week / publication / Zebra claims executed during release verification.

---

## 8. Automation latch status

| Gate | Status |
|------|--------|
| `WEEKLY_ROTATION_AUTO_PUBLISH` | **`false`** in shipped commit `57e3ab3` |
| Env alone enable | **Ignored** while latch false |
| Cron body/query publish elevation | **Not present** |
| Expected cron assign outcome | **`STAGED_AWAITING_ASSIGN`** (stage only) |
| Activation latch flipped this tranche | **No** |

---

## 9. Test results (pre-push)

| Check | Result |
|-------|--------|
| AUTO-002 focused | **13 PASS** |
| AUTO-003 focused | **17 PASS** |
| Rotation / bay / stewardship / ownership / capacity | **102 PASS** |
| SEC-OPS-010 authz | **20 PASS** |
| Zebra handoff | **14 PASS** |
| **Suite total** | **9 files / 166 PASS** |
| `npx tsc --noEmit` | **PASS** |
| ESLint (AUTO core sources) | **PASS** (0 errors; pre-existing unused-var warnings) |
| `npm run build` | **PASS** |

---

## 10. Production smoke results

| Check | Result |
|-------|--------|
| `GET /login` | **200** |
| `GET /overview` (unauth) | **307** → `/login?next=%2Foverview` |
| `GET /admin/store-map` (unauth) | **307** → login |
| `GET /walkthroughs` (unauth) | **307** → login |
| Unauth `GET /api/week-capacity?week=2026-W43` | **401** |
| Unauth `GET /api/operational-sections` | **401** |
| Unauth `GET /api/walkthroughs` | **401** |
| Unauth `GET /api/store-locations/bay-context` | **401** |
| Unauth `GET /api/weekly-rotations` | **401** |
| Unauth `GET /api/store-locations/week-bay-priority` | **401** |
| Capacity W43 read-only | **3/3/3/3 sum 12** |
| Sections / members | **4 / 160** |
| Auto-publish latch | **OFF** |

PIN-only login path remains the production gate (protected routes redirect; APIs 401). No authenticated session smoke that would create assignments/observations/priorities.

---

## 11. Remaining activation prerequisites (AUTO-006 — not started)

1. Phone acceptance of section-balanced stage on a real Sunday/future week.  
2. Confirm W43 (or next target week) schedules are complete; re-approve capacity if fingerprints go stale.  
3. Dedicated enablement commit: flip `WEEKLY_ROTATION_AUTO_PUBLISH` to `true`.  
4. Set Production env `DEPTSYNC_WEEKLY_ROTATION_AUTO_PUBLISH=1`.  
5. Prefer first auto-publish Sunday targeting a **future** week (`sundayStagingWeekLabel`).  
6. Keep Force Draw Master-only; never cron force-overwrite.  
7. Do **not** begin specialty or Orient work in that tranche.

---

## 12. GO / NO-GO verdict

| Decision | Verdict |
|----------|---------|
| Stage 1 controlled release (engine + migration + latch OFF + prospective capacity 12) | **GO — RELEASED** |
| Automatic publication enablement | **NO-GO** (Stage 1 explicitly leaves latch OFF) |
| AUTO-006 | **NOT STARTED** |
| Specialty / Orient | **NO-GO** |
| Modify current-week assignments | **NO-GO** (honored) |

### Bottom line

Production now runs the section-balanced stage + stewardship assign path with supervisor edit locks, while automatic ownership publication remains hard-off. Prospective week **2026-W43** capacity is operator-approved **12** (3/3/3/3). Manual **Assign this week** remains required until a later authorized activation tranche.

**STOP AFTER STAGE 1 RELEASE.** Do not enable automatic publication. Do not begin AUTO-006. Do not begin specialty or Orient work.
