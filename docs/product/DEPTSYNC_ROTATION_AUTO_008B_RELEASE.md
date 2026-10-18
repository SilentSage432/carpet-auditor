# DEPTSYNC-ROTATION-AUTO-008B — Standing Capacity Controlled Production Release

**Status:** RELEASED (engineering) — **operator MasterAdmin establish pending**  
**Date:** 2026-10-18  
**Mode:** Authorized controlled production release  
**Application:** https://deptsync-hub.vercel.app  
**Supabase:** `fmeinlwhixngednabhgy`  
**Store:** 2587 · Flooring / Home Decor  

**Authority:** AUTO-008A standing capacity implementation · AUTO-008 activation NO-GO (missing W44 approvals) · operator-approved standing policy **Tyson 3 / Nate 3 / Nick 3 / Tracy 3 = 12**  

**Strict exclusions honored:** Automatic publication **DISABLED** · code latch **not** flipped · Production env publish gate **not** enabled · no Assign This Week · no Force Draw · no manual cron trigger · no assignment create/modify · no specialty · no Orient · no schedule-free roster redesign · standing policy **not** SQL-seeded.

---

## 1. Executive summary

AUTO-008A standing weekly capacity was released to production:

1. Production migration `20261025_rotation_auto_008a_standing_capacity.sql` **COMMIT** (backup first).  
2. App commit **`5c36621`** deployed to the production alias.  
3. Assignment fingerprint **unchanged**; W43 capacity **3/3/3/3**; sections **4×160**.  
4. Automatic publication latch remains **`WEEKLY_ROTATION_AUTO_PUBLISH = false`**.  
5. **No active standing policy rows yet** — establishing 3/3/3/3 requires authenticated MasterAdmin UI (this agent stops at that boundary).

This release establishes the **standing capacity substrate**, not autonomous assignment publication.

---

## 2. Migration result

| Field | Value |
|-------|--------|
| Migration | `supabase/migrations/20261025_rotation_auto_008a_standing_capacity.sql` |
| Pre-backup | `tmp/production-backups/deptsync-fmeinlwhixngednabhgy-2026-10-18T19-03-19Z.dump` |
| Backup size / TOC | **780002** bytes / **1288** TOC entries |
| Apply method | Management API ephemeral DB password → `pg_dump` 17 → `psql` → password re-rotate |
| Apply result | **COMMIT** (BEGIN…COMMIT; pgcrypto notice only) |
| Tables created | `store_standing_capacity_policies`, `store_standing_capacity_policy_items`, `store_week_capacity_approval_provenance` |
| One-active index | `store_standing_capacity_policies_one_active_idx` **present** |
| Active policies post-migrate | **0** (correct — no SQL seed) |
| Pre SBA / sections / members | 42 / 4 / 160 |
| Post SBA / sections / members | 42 / 4 / 160 |
| Pre W43 sum / W44 count | 12 / 0 |
| Post W43 sum / W44 count | 12 / 0 |

Isolated local harness previously validated: one-active constraint, provenance checks, W43 approval preservation.

---

## 3. App commit

| Field | Value |
|-------|--------|
| Repository | `SilentSage432/carpet-auditor` |
| Branch | `main` |
| Commit | **`5c36621`** (`5c366211f13653474928d4954f82312d8bcaec32`) |
| Message | `feat(rotation): add standing weekly capacity authorization` |
| Prior production tip | AUTO-007 `20dcc5f` (docs tip `4aee6d5` before push) |
| Push | `4aee6d5..5c36621` → `origin/main` |
| Latch in source | `WEEKLY_ROTATION_AUTO_PUBLISH = false` |
| Cron in shipped tree | `"0 12 * * 0"` |

Shipped surfaces: standing domain + API + Sunday drawer panel + Sunday materialize hook + migration + focused tests.

---

## 4. Documentation commit

| Field | Value |
|-------|--------|
| Commit | **`1e5f728`** (`1e5f7282074a8575781197d34de65c572c50b873`) |
| Contents | This report; AUTO-008A status update; DEVELOPMENT_JOURNAL / CHAT_HANDOFF / MASTER_ROADMAP |
| Canonical | [`DEPTSYNC_ROTATION_AUTO_008B_RELEASE.md`](DEPTSYNC_ROTATION_AUTO_008B_RELEASE.md) |
| Prior local | [`DEPTSYNC_ROTATION_AUTO_008A_STANDING_CAPACITY.md`](DEPTSYNC_ROTATION_AUTO_008A_STANDING_CAPACITY.md) |

---

## 5. GitHub production workflow

| Field | Value |
|-------|--------|
| GitHub Production deployment | **`7159272550`** |
| SHA | `5c366211f13653474928d4954f82312d8bcaec32` |
| Environment | Production |
| Created | 2026-10-18T19:05:09Z |
| Deployment status | **success** — “Deployment has completed” |
| Commit status (Vercel) | **success** |
| Workflow runs for SHA | **0** (Vercel GitHub integration; no Actions workflow required) |

---

## 6. Vercel deployment

| Field | Value |
|-------|--------|
| Alias | https://deptsync-hub.vercel.app |
| Deployment URL | https://deptsync-5o2546udf-tyson-zauggs-projects.vercel.app |
| Vercel status page | https://vercel.com/tyson-zauggs-projects/deptsync-hub/GKhbpUQEZ7upD9VPry9qedc9F3My |
| State | **Ready / success** |
| `/login` on alias | **200** |

---

## 7. Production smoke results

| Check | Result |
|-------|--------|
| `GET /login` | **200** |
| `GET /overview` | **307** → `/login?next=%2Foverview` |
| `GET /map` | **307** → login |
| `GET /this-week` | **307** → login |
| `GET /walkthroughs` | **307** → login |
| `GET /` | **307** → login |
| `GET /api/standing-capacity` (unauth) | **401** |
| `GET /api/week-capacity` (unauth) | **401** |
| `GET /api/sunday-assignments` (unauth) | **401** |
| `POST /api/standing-capacity` (unauth) | **401** |

Authenticated Overview / Map / This Week / Walkthroughs / standing UI require operator session (see §14). Mobile standing-policy acceptance also requires phone session.

---

## 8. Assignment preservation evidence

| Metric | Baseline (pre) | Post migrate+deploy | Match |
|--------|----------------|---------------------|-------|
| SBA fingerprint | `22cd784c27273d93` | `22cd784c27273d93` | **YES** |
| SBA total / owned | 42 / 42 | 42 / 42 | YES |
| Supervisor locked | 0 | 0 | YES |
| Completed / verified | 0 / 0 | 0 / 0 | YES |
| Sections / members | 4 / 160 | 4 / 160 | YES |
| W43 capacity | 3/3/3/3 sum **12** | 3/3/3/3 sum **12** | YES |
| W43 ownership | Tyson3/Nate3/Nick3/Tracy3 | same | YES |
| W44 capacity rows | 0 | 0 | YES (not preemptively written) |
| W45 capacity rows | 0 | 0 | YES |

Evidence files: `tmp/auto008b-baseline.json`, `tmp/auto008b-post-verify.json`.

---

## 9. Standing policy authorization evidence

| Control | Status |
|---------|--------|
| Schema present | **YES** |
| Active policy rows | **0** (awaiting MasterAdmin) |
| API writes gated | `requireSuperAdmin` on POST/DELETE `/api/standing-capacity` |
| Unauthenticated POST | **401** |
| UI establish control | MasterAdmin-only button in Sunday Audit drawer (`data-testid="standing-capacity-establish"`) |
| SQL seed of 3/3/3/3 | **NOT performed** (honored) |
| Agent impersonation of MasterAdmin | **NOT performed** (honored) |

Sunday scheduler may materialize an **existing** active standing policy into weekly approvals. It does **not** invent or authorize a new standing policy.

---

## 10. W44 readiness

| Item | Status |
|------|--------|
| W44 owned assignments | **0** (safe canvas) |
| W44 weekly approvals today | **0** (expected until standing policy established + materialize) |
| After MasterAdmin establishes 3/3/3/3 | Next Sunday materialize (or authorized materialize path) can write W44 approvals with provenance `standing` |
| Preemptive multi-week approval writes | **Not performed** |

Expected after policy establish + materialization: W44 / W45 / subsequent weeks → **3/3/3/3** until MasterAdmin changes the standing policy.

---

## 11. Explicit override protection

| Rule | Status |
|------|--------|
| Explicit weekly `/api/week-capacity` stamps provenance `explicit` | Shipped in `5c36621` |
| Standing materialization skips explicit rows | Covered by AUTO-008A tests |
| Published weeks (owned assignments) skip rewrite | Covered by AUTO-008A tests |
| Policy changes prospective only | Covered by AUTO-008A tests |
| Legacy approvals without provenance treated as explicit | Domain rule preserved |

---

## 12. Automatic publication latch status

| Gate | Value |
|------|--------|
| Code latch `WEEKLY_ROTATION_AUTO_PUBLISH` | **`false`** in `5c36621` |
| Env `DEPTSYNC_WEEKLY_ROTATION_AUTO_PUBLISH` | **Not set to `1`** (not enabled this release) |
| Cron schedule | **`0 12 * * 0`** (unchanged from AUTO-007) |
| Expected Sunday outcome while latch OFF | Stage path → `STAGED_AWAITING_ASSIGN` (no automatic ownership publish) |
| Assign This Week / Force Draw / manual cron | **Not run** |

---

## 13. Exact validation results

| Check | Result |
|-------|--------|
| Isolated migration harness (AUTO-008A) | **PASS** (pre-release) |
| AUTO-008A focused + regressions | **199 PASS** (pre-release) |
| Standing policy / materialization / override / published-week tests | Included in 199 |
| SEC-OPS-010 authorization regressions | Included |
| `npx tsc --noEmit` | **PASS** |
| ESLint on changed files | **PASS** (0 errors; pre-existing Sunday modal set-state-in-effect warning unchanged) |
| `npm run build` | **PASS** |
| Production migrate | **COMMIT** |
| Production deploy | **Ready** |
| Assignment fingerprint | **identical** |

---

## 14. Outstanding operator actions

### A. Establish standing capacity (required — interactive MasterAdmin)

This agent **stops** at the authenticated MasterAdmin boundary.

1. On phone or desktop, open https://deptsync-hub.vercel.app and sign in as **MasterAdmin**.  
2. Open **Sunday Audit** assignment drawer (Floor Command → Sunday / weekly capacity board).  
3. Confirm the panel **Standing capacity (future weeks)** is visible (schema migrated — should no longer say “Schema not migrated”).  
4. Set draft capacities to the approved policy:  
   - **Tyson: 3**  
   - **Nate: 3**  
   - **Nick: 3**  
   - **Tracy: 3**  
   - Shared total **12**  
5. Tap **Establish standing from draft capacities** (`data-testid="standing-capacity-establish"`).  
6. Confirm status shows standing established (e.g. `Standing capacity established (v1) · shared 12`).  
7. Optionally verify GET standing policy shows active v1 with 3/3/3/3.  
8. **Do not** enable automatic publication. **Do not** run Assign This Week / Force Draw solely for this release.

After establish, request a short phone acceptance that the standing panel reads correctly on mobile.

### B. After operator establish (verification checklist for follow-up)

- Active row in `store_standing_capacity_policies` (`is_active=true`, version ≥ 1).  
- Four items totaling 12.  
- Latch still `false`.  
- Assignments fingerprint still `22cd784c27273d93` (unless operator intentionally changed assignments).

### C. Not in this release

- AUTO-008 dual-gate enablement.  
- Pre-writing W44/W45 approvals for demo.  
- Specialty / Orient.

---

## 15. GO / NO-GO verdict

| Decision | Verdict |
|----------|---------|
| Production migration | **GO — applied** |
| App deploy of AUTO-008A | **GO — shipped `5c36621`** |
| Assignment / section / W43 preservation | **GO — fingerprint match** |
| Automatic publication enablement | **NO-GO** (latch OFF; env gate not enabled) |
| Standing policy 3/3/3/3 live | **NO-GO until MasterAdmin UI establish** |
| Overall release | **CONDITIONAL GO** — engineering complete; operator establish outstanding |

### Bottom line

Standing capacity infrastructure is **live** on production with auto-publish still **OFF**. Operator must establish **3/3/3/3** via MasterAdmin UI before Sunday materialization can approve future weeks without repeated weekly capacity clicks.

**STOP AFTER RELEASE REPORT.** Do not flip the latch. Do not enable the env publish gate. Do not modify assignments.
