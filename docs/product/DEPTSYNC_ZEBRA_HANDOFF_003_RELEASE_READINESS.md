# DEPTSYNC-ZEBRA-HANDOFF-003 — Production Release Readiness

**Status:** PREFLIGHT COMPLETE — awaiting operator authorization  
**Date:** 2026-10-11  
**Mode:** Release preflight only — **no commit, no push, no migrate, no deploy**  
**Implementation:** DEPTSYNC-ZEBRA-HANDOFF-002  
**Migration:** `supabase/migrations/20261017_zebra_handoff_002_sunday_bay_entry.sql`  
**Production app:** https://deptsync-hub.vercel.app  
**Supabase:** `fmeinlwhixngednabhgy` (host confirmed via local service-role URL)

---

## 1. Local implementation verification

### 1.1 Intended files — present

| Artifact | Status |
|----------|--------|
| `supabase/migrations/20261017_zebra_handoff_002_sunday_bay_entry.sql` | Present — additive nullable columns + owner-change clear trigger |
| `lib/store-ops/zebra-handoff.ts` | Present |
| `lib/store-ops/zebra-handoff.test.ts` | Present |
| `app/api/rotations/zebra-entry/route.ts` | Present |
| `lib/store-ops/sunday-audit.ts` | Modified — map/read handoff fields |
| `lib/store-ops/this-week-ownership.ts` | Modified — orthogonal counts/labels |
| `lib/store-ops/client.ts` | Modified — `confirmZebraBayEntry` |
| `components/store-ops/ThisWeekOwnershipBoard.tsx` | Modified — per-bay UI |
| `components/store-ops/ThisWeekCommandSummary.tsx` | Modified — In Zebra stat |
| `components/hub/tabs/FloorTab.tsx` | Modified — `allowZebraHandoff` |
| `lib/rd4.this-week-command.contract.test.ts` | Modified — contracts |
| `docs/product/DEPTSYNC_ZEBRA_HANDOFF_001_DISCOVERY.md` | Present |
| `docs/product/DEPTSYNC_ZEBRA_HANDOFF_002_IMPLEMENTATION.md` | Present |

Migration validity: `ADD COLUMN IF NOT EXISTS` (nullable) + `CREATE OR REPLACE` trigger function — safe for existing rows (new columns default NULL). No DROP TABLE, no assignment rewrite, no RLS grant widening.

### 1.2 Validation (this preflight)

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | **PASS** (exit 0) |
| Focused tests (7 files) | **86 PASS / 0 FAIL** |
| `npm run build` | **PASS** — `/api/rotations/zebra-entry` listed |
| Section-aware auto-stage | **`SECTION_AWARE_ROTATION_AUTO_STAGE = false`** |

### 1.3 Commit readiness

| Item | Finding |
|------|---------|
| Current `HEAD` / `origin/main` | `cfd1ca4607a3d9e625ab0d6098967f2a4e28e8f6` — `docs(rotation): record SECTION-ROTATION-007 production release` |
| Handoff tranche committed? | **No** — working tree only |
| Isolated commit ready? | **Yes**, if unrelated dirt is excluded |

**Include in release commit**

- All §1.1 implementation + docs above  
- `docs/product/DEPTSYNC_ZEBRA_HANDOFF_003_RELEASE_READINESS.md` (this file)  
- Journal / handoff / roadmap updates for ZEBRA-HANDOFF-001/002/003  

**Exclude from release commit**

| Path | Why |
|------|-----|
| `docs/product/DEPTSYNC_SEC_OPS_010_FALLBACK_RETIREMENT.md` | Unrelated local edit (224-line churn) |
| `docs/product/DEPTSYNC_RD_6_PRODUCT_COMPLETION_AUDIT.md` | Unrelated untracked |
| `docs/product/DEPTSYNC_SEC_OPS_010A_VERCEL_AUTH_RECOVERY.md` | Unrelated untracked |
| `tmp/` | Local scratch / chrome profiles |

**Commit SHA for release:** *not created yet* — will be the SHA of the isolated handoff commit after operator asks to commit.

---

## 2. Database compatibility (read-only production)

**Project:** `fmeinlwhixngednabhgy.supabase.co` — confirmed.

### 2.1 Schema

| Check | Result |
|-------|--------|
| `sunday_bay_assignments` exists | **Yes** |
| `zebra_entered_at` / `zebra_entered_by` | **Absent** — `column … does not exist` |
| Migration already applied? | **No** |
| Existing columns intact | Yes (`id`, `store_number`, `department`, `week_starting`, `bay_id`, roster/profile fields, `status`, `is_carried_over`, timestamps) |

### 2.2 Preserved production evidence (store 2587)

| Artifact | Observation |
|----------|-------------|
| Sunday assignments | **30** total — all `status=assigned` |
| Week starting `2026-09-21` (≈ W39) | 12 |
| Week starting `2026-09-28` (≈ W40) | 12 |
| Week starting `2026-10-05` (**W41**) | **6** |
| Week starting `2026-10-12` (**W42**) | **0** assignments |
| Active rotations | W39: 12 PENDING · W40: 12 VERIFIED_COMPLETE · W41: 6 PENDING |
| Completion attempts | **25** (`VERIFIED` only) |
| Active verified rotations | **12** |
| Capacity approvals | **4** rows for week `2026-10-12` (sum approved capacity **11**) |
| Operational sections | **5** |
| Associate shift days | **370** |

Migration effect on these rows: nullable columns only → existing assignment / completion / verification / capacity / section / schedule rows **unchanged**.

### 2.3 Reassignment / clearing behavior (design)

Trigger `sunday_bay_assignments_clear_zebra_on_owner_change`:

- Clears handoff stamps when `status → cleared` or `roster_specialist_id` changes  
- Same-owner updates (including confirm) **preserve** stamps  
- Does not touch `weekly_rotations` or capacity tables  

### 2.4 Authorization surface

- Client INSERT/UPDATE/DELETE on `sunday_bay_assignments` remain revoked (unchanged by migration)  
- Confirm path remains service-role API + `requireSupervisorOrAdmin`  
- No new grants to `anon` / authenticated writers  

### 2.5 Sunday staging note

| Flag | Production value | Handoff impact |
|------|------------------|----------------|
| `stores.sunday_auto_generate` | `true` (legacy cron path) | Unchanged by this tranche |
| `SECTION_AWARE_ROTATION_AUTO_STAGE` | `false` (app hard-off) | Unchanged — remains OFF |

Do not flip either as part of Zebra handoff release.

---

## 3. Release order

### Safest sequence

```text
1) Isolated git commit (exclude unrelated dirt)
2) Pre-migrate backup (pg_dump / established backup procedure)
3) Apply 20261017_zebra_handoff_002_sunday_bay_entry.sql on fmeinlwhixngednabhgy
4) Verify columns + trigger exist; row counts unchanged
5) Deploy app to Vercel production (push / authorized deploy)
6) Smoke + phone acceptance
```

**Why migrate before app deploy**

- Columns are additive and nullable — **current production app** (`cfd1ca4`) does not reference them → migrate is backward compatible.  
- New app **reads/writes** `zebra_entered_*`. Deploying app first leaves confirm API fail-closed until migrate (UI shows “Not entered”; confirm errors). Prefer migrate-first to avoid that window.

**Avoid:** deploying app that hard-depends on columns without migrate (confirm broken).  
**Avoid:** including unrelated SEC-OPS / RD_6 / `tmp` files in the release commit.

### Rollback

| Layer | Action |
|-------|--------|
| App | Redeploy previous production deployment / `origin/main` tip before handoff commit |
| DB | Optional: `DROP TRIGGER …`; `DROP FUNCTION …clear_zebra_on_owner_change`; `ALTER TABLE … DROP COLUMN zebra_entered_at, DROP COLUMN zebra_entered_by` — **only if authorized**; loses handoff stamps only; does not rewind assignments/verifies |
| Data | Restoring full backup only if migrate somehow corrupted (unlikely for this DDL) |

---

## 4. System boundary verification

| Claim | Evidence |
|-------|----------|
| No Zebra API | `zebra-handoff.ts` / `zebra-entry/route.ts` — no `fetch(` / external URLs / `lowes` / `zebra.com` |
| No Zebra auth | Route uses DeptSync `requireSupervisorOrAdmin` only |
| No sync / polling / auto task create | Confirm updates local columns only |
| No photo import | Photo line is informational typing-aid text only |
| Operator-recorded only | API returns `zebra_system: "manual_operator_record"` |

Live smoke (pre-release): `POST https://deptsync-hub.vercel.app/api/rotations/zebra-entry` → **401** (auth gate; no Zebra side effect). `/login` → **200**.

---

## 5. Preserve production (release constraints)

Must remain true after migrate + deploy:

- All existing `sunday_bay_assignments` (W39–W41 counts above; W42 still 0 until operator assigns)  
- W41 / W42 capacity approvals (currently 4 / sum 11 for W42 week start)  
- Operational sections  
- Associate schedules (`associate_shift_days`)  
- Completion attempts + verification history  
- Section-aware auto-stage **OFF**  

This migration does not rewrite those tables.

---

## 6. Post-release verification checklist

1. SQL: columns `zebra_entered_at`, `zebra_entered_by` exist; trigger present  
2. Counts: SBA 30 (or then-current); W41=6; W42 assignments unchanged by migrate; attempts 25; approvals 4  
3. App: `/login` 200; unauth `POST /api/rotations/zebra-entry` 401  
4. Phone (supervisor): open This Week → assigned bay → typing aid / copy → **Mark Entered in Zebra** → persists after refresh  
5. Confirm does **not** change `verification_status` / `is_completed`  
6. Associate session: no confirm button (or API 403)  
7. Reassign bay (if tested): handoff stamps clear; new confirm required  

---

## 7. Release decision

| Factor | Value |
|--------|--------|
| **Commit SHA** | *Pending isolated commit* — working tree on top of `cfd1ca4` |
| **Production deployment baseline** | `origin/main` @ `cfd1ca4`; live Ready prod alias https://deptsync-hub.vercel.app → latest listed Ready deploy `deptsync-1u9d493gs` (Vercel CLI prod list at preflight; handoff app not yet shipped) |
| **Migration compatibility** | **GO** — not applied; additive nullable; safe for existing rows |
| **Backup requirements** | **Required** before production SQL (ephemeral Management API password + `pg_dump` pattern used in ROTATION-007) |
| **Required deployment order** | Backup → **migrate** → **deploy app** → phone verify |
| **Rollback plan** | Redeploy prior app; optional drop columns/trigger (handoff evidence only) |
| **Unrelated dirt** | Must exclude SEC-OPS-010 / RD_6 / 010A / `tmp` from commit |

### Verdict

**CONDITIONAL GO**

Conditions before execution:

1. Operator authorizes an **isolated** handoff commit (no unrelated files)  
2. Operator authorizes production **backup + migrate**  
3. Operator authorizes production **app deploy**  
4. Phone acceptance of one-bay confirm  

**NO-GO** for: Zebra API work, auto-stage enablement, deploying with unrelated dirt, migrate without backup.

---

**STOP.** No production migration. No deploy. No commit performed in this preflight.
