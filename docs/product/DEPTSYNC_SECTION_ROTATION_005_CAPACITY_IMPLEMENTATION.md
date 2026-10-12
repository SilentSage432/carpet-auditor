# DEPTSYNC-SECTION-ROTATION-005 — Operator-Approved Weekly Capacity

**Status:** COMPLETE (local implementation + tests; no production SQL / deploy / activation)  
**Date:** 2026-10-11  
**Mode:** Controlled local implementation  
**Store (acceptance fixture):** 2587  
**Supabase production:** `fmeinlwhixngednabhgy` — **migration NOT applied**  
**Application:** https://deptsync-hub.vercel.app (unchanged)

**References:**  
[`DEPTSYNC_SECTION_ROTATION_004_AVAILABILITY_DISCOVERY.md`](DEPTSYNC_SECTION_ROTATION_004_AVAILABILITY_DISCOVERY.md) ·  
[`DEPTSYNC_CAPACITY_GUARD_002_IMPLEMENTATION.md`](DEPTSYNC_CAPACITY_GUARD_002_IMPLEMENTATION.md) ·  
[`DEPTSYNC_CAPACITY_GUARD_003_RELEASE.md`](DEPTSYNC_CAPACITY_GUARD_003_RELEASE.md)

**Strict exclusions honored:** No production SQL apply; no Vercel deploy; no feature-flag enablement; no production assignments/schedules/sections; Sunday section-aware auto-stage remains **HARD OFF**.

---

## 1. Executive summary

Implemented durable, week-specific, operator-approved weekly bay capacity (0–3) with schedule-fingerprint staleness, MasterAdmin approval API/UI, and transactional RPC enforcement.

| Gate | Result |
|------|--------|
| Approval model (explicit, not suggested default) | **PASS** |
| Shared target = sum of approved caps | **PASS** (W42 fixture → 11) |
| DB enforcement (isolated Postgres) | **PASS** |
| Assignment writers fail closed without approvals | **PASS** (when schema present) |
| Section-aware auto-stage | **OFF** (`false`) |
| Production migration / deploy | **NOT DONE** (correct) |
| Typecheck / build | **PASS** |
| Focused + suite | **PASS** for ROTATION-005 scope; see roster-life note below |

**Local readiness:** **GO** for review.  
**Production release:** **CONDITIONAL GO** — apply migration, then deploy app; operator must approve W42 (and each week) in UI; keep auto-stage/preview OFF.

---

## 2. Files changed

| Path | Change |
|------|--------|
| `supabase/migrations/20261016_section_rotation_005_approved_capacity.sql` | Approvals table + fingerprint fn + approval RPC + assignment RPC enforcement |
| `scripts/sql/section-rotation-005-local-validation-harness.sql` | Isolated DB parents for local RPC validation |
| `lib/store-ops/approved-week-capacity.ts` | Domain: fingerprint, validation, review board, load/write approvals |
| `lib/store-ops/approved-week-capacity.test.ts` | Deterministic tests A–P (+ contracts) |
| `lib/store-ops/shared-week-capacity.ts` | Approved caps in compose/filter; load prefers approvals when schema present |
| `lib/store-ops/sunday-audit.ts` / `sunday-dispatch.ts` | `assertApprovedCapacityReady` before additive writes |
| `lib/store-ops/section-aware-rotation.ts` | Preview caps accept approved map |
| `lib/store-ops/client.ts` | `fetchWeekCapacityBoard` / `approveWeekCapacity` |
| `app/api/week-capacity/route.ts` | GET review + POST MasterAdmin approve |
| `components/admin/SundayAuditAssignmentModal.tsx` | Capacity review UI in weekly planning drawer |
| `lib/store-ops/stage-assign-cue-001.contract.test.ts` | Slice window for capacity-gated button props |
| `docs/product/DEPTSYNC_SECTION_ROTATION_005_CAPACITY_IMPLEMENTATION.md` | This report |

---

## 3. Schema changes

**Table:** `public.store_week_capacity_approvals`

| Column | Role |
|--------|------|
| `store_number` | Store identity |
| `week_label` | Canonical ISO week (`YYYY-Www`) |
| `week_starting` | Monday date |
| `specialist_id` | Roster id |
| `approved_capacity` | Integer 0–3 |
| `schedule_fingerprint` | MD5 of that associate’s week shift rows |
| `approved_by_specialist_id` | Actor roster id |
| `approved_at` / timestamps | Provenance |

Unique `(store_number, week_label, specialist_id)`.

**Functions:**

- `associate_week_schedule_fingerprint(store, specialist, week_starting)`
- `upsert_store_week_capacity_approvals(...)` — advisory-locked approval writer
- `upsert_sunday_bay_assignments_with_capacity(...)` — **replaced** to enforce approvals

Additive only. No destructive changes to assignments, sections, or schedules.

---

## 4. Approval model

- Suggested capacity for eligible associates defaults to **3** in the UI.
- **Suggestion ≠ approval.** Missing approval → `approvals_complete=false`.
- Only `requireSuperAdmin` (MasterAdmin) may POST approvals.
- Writes go service-role → approval RPC (browser never holds service role).
- Ineligible associates cannot receive positive capacity.
- Capacity cannot be set below committed owned count.
- Stale fingerprint (schedule change) invalidates approval (board `stale`; RPC `CAPACITY_APPROVAL_STALE`).

---

## 5. Schedule evidence model

Evidence = `associate_shift_days` for the ISO week (department availability by operator convention).

Fingerprint aggregates per associate, ordered by `work_date`:

`date|status|scheduled|call_out|start|end` → `md5`, empty → `md5('empty:'||specialist_id)`.

App (`buildAssociateWeekScheduleFingerprint`) mirrors SQL.

No day/hour→bay formula. Days and hours are display evidence only.

---

## 6. Eligibility handling

Unchanged labor rules: active, non-Master, home-dept match, known ON_DUTY hours > 0.

| Case | Behavior |
|------|----------|
| Ineligible | Shown; positive approval rejected; not in shared sum |
| Eligible, unapproved | Blocks assign (`assertApprovedCapacityReady`) |
| Eligible, approved, fingerprint match | Capacity applies |
| Eligible, approved, fingerprint mismatch | Stale — re-approve required |
| Midweek schedule change | Stale fail-closed; no silent keep |

---

## 7. Capacity enforcement

| Layer | Behavior |
|-------|----------|
| Composer | `shared_target = sum(approved)`; per-person remaining from approved |
| App writers | Fail if `approvals_complete !== true` when approval fields present |
| DB RPC | Missing / stale / zero approval → exception; person ≤ approved; shared ≤ sum(valid approvals); advisory lock |
| Extra-bay +1 | Cannot exceed approved capacity (hard ceiling ≤ 3) |
| Clears | Always allowed |

Pre-migration (table missing): load falls back to legacy eligible×3 so production stays operable until release cutover.

---

## 8. Concurrency protection

Same store-week key as CAPACITY-GUARD:

`pg_advisory_xact_lock(hashtext('store_week_capacity:'||store||':'||week_starting))`

Used by both approval upsert and assignment upsert → capacity change vs assign serialize.

---

## 9. Security / RLS

| Actor | Approvals table | Assignment writes |
|-------|-----------------|-------------------|
| anon | Revoked | Denied |
| authenticated | SELECT store-scoped (`jwt_matches_store`); no writes | Via hardened RPC only |
| service_role | API after MasterAdmin check | Cron / admin writers |

No new PIN system. No client role trust.

---

## 10. Existing assignment handling

- No silent delete/reassign on capacity change.
- Approving below owned count → `CAPACITY_APPROVAL_BELOW_OWNED`.
- Completed rows still consume capacity.
- History preserved.

---

## 11. UI behavior

Added to existing Sunday / weekly planning drawer (`SundayAuditAssignmentModal`):

- Target week
- Per associate: days, hours, suggested/approved capacity, status
- Shared target (proposed vs approved)
- **Approve weekly capacity** (MasterAdmin)
- **Assign this week** disabled until approvals complete

No new primary nav destination. Mobile-first selects + 44px targets.

---

## 12. Week 42 acceptance scenario

| Associate | Evidence | Operator capacity | Notes |
|-----------|----------|------------------:|-------|
| Tyson | 6 days / 53h | 3 | Suggested 3; must confirm |
| Nick | 5 days / 45h | 3 | |
| Tracy | 4 days / 43h | 3 | |
| Nate | 2 days / 22h | 2 | Reduced |
| Shared | | **11** | |

Values are **not** auto-inserted into production. Operator confirms in UI after migration.

---

## 13. Test results

| Check | Result |
|-------|--------|
| `npm run typecheck` | **PASS** |
| Focused vitest (approved + shared + section-aware) | **PASS — 63** |
| Isolated Postgres RPC validation | **PASS** (`DB_VALIDATION_OK`: person cap, missing approval, below-owned, stale) |
| Full suite | **1675 PASS / 1 FAIL** — see roster-life classification below |
| `npm run build` | **PASS** (`/api/week-capacity` listed) |
| eslint on changed files | 1 pre-existing `set-state-in-effect` on modal reload effect; no new logic errors in domain/API |

Database enforcement evidence: local disposable DB `deptsync_sr005_val_*` applied harness + migration; notices `PASS person cap`, `PASS missing approval`, `PASS below owned`, `PASS stale approval`.

---

## 14. Migration readiness

| Topic | Notes |
|-------|-------|
| Forward | Apply `20261016_section_rotation_005_approved_capacity.sql` once |
| Compatibility | App falls back to legacy capacity until table exists; after migrate, approvals required |
| Security | SELECT-only authenticated; writes via RPCs |
| Existing data | No backfill of approvals (fail closed until operator approves) |
| Rollback | Drop new table/functions and restore prior capacity RPC from CAPACITY-GUARD-003 migration (document in release tranche) |

**Do not apply to production in this tranche.**

---

## 15. Known limitations

1. Extra-bay +1 cannot exceed approved capacity (raise approval first; max 3).  
2. Fingerprint uses Node `crypto` (API/server); browser goes through API.  
3. Section stage concentration (ROTATION-003) unchanged — deferred to 006.  
4. Pre-migration production continues legacy eligible×3 until cutover.  
5. `lib/roster-life001.member-lifecycle.test.ts` “TTL cache” case **hangs at 5000ms** when Supabase env credentials are present (`fetchSpecialists` → live `loadSpecialists` network path; test does not mock `getSupabase`). **Classification (ROTATION-006 Phase 0):** reproducible on clean `main` without ROTATION-005 files → **pre-existing deterministic test-isolation defect**, not a ROTATION-005 regression. Not repaired in this commit.

---

## 16. SECTION-ROTATION-006 integration contract

006 may consume:

```ts
StoreWeekCapacitySnapshot {
  approved_by_specialist?: Record<string, number>;
  approvals_complete?: boolean;
  remaining_by_specialist: Record<string, number>;
  shared_target: number; // sum of approved when model active
  eligible_specialist_ids: string[];
}
```

Rules for 006:

- Do not invent topology or exclusive section ownership.
- Prefer section within tiers **after** approved remaining caps.
- Do not activate `SECTION_AWARE_ROTATION_AUTO_STAGE`.
- Fail closed if `approvals_complete !== true`.

---

## 17. Production release prerequisites

1. Operator approves capacity policy (already selected for W42: 3/3/3/2).  
2. Apply `20261016_section_rotation_005_approved_capacity.sql` on `fmeinlwhixngednabhgy`.  
3. Deploy app that includes approval UI + writer gates.  
4. Operator opens weekly planning → confirms W42 capacities → shared 11.  
5. Optional read-only proposal review.  
6. Keep Sunday section-aware auto-stage **OFF**; Production preview **OFF**.  
7. Do not enable dual-department auto-stage.

**STOP.**
