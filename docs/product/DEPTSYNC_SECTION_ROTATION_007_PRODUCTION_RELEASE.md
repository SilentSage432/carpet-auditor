# DEPTSYNC-SECTION-ROTATION-007 — Controlled Production Release

**Status:** RELEASED — AWAITING PHONE / OPERATOR W42 CAPACITY ACCEPTANCE  
**Date:** 2026-10-11  
**Mode:** Release execution with safety gates  
**Store:** 2587  
**Supabase:** `fmeinlwhixngednabhgy` (ACTIVE_HEALTHY, us-west-2)  
**Production app:** https://deptsync-hub.vercel.app  

**Release baseline:**

| Tranche | Commit | Scope |
|---------|--------|--------|
| ROTATION-005 | `6b5ff6a` | Operator-approved weekly capacity |
| ROTATION-006 | `c3b2317` | Stewardship-aware weekly distribution |

**Released commit:** `c3b2317`  
**Canonical impl reports:**  
[`DEPTSYNC_SECTION_ROTATION_005_CAPACITY_IMPLEMENTATION.md`](DEPTSYNC_SECTION_ROTATION_005_CAPACITY_IMPLEMENTATION.md) ·  
[`DEPTSYNC_SECTION_ROTATION_006_DISTRIBUTION_IMPLEMENTATION.md`](DEPTSYNC_SECTION_ROTATION_006_DISTRIBUTION_IMPLEMENTATION.md)

---

## 1. Preflight findings (completed earlier)

| Check | Result |
|-------|--------|
| Ancestry `6b5ff6a` ⊂ `c3b2317` ⊂ local main | PASS |
| Required order | App-first → migrate → operator approve |
| Compatibility | Legacy capacity fallback until table/RPC cutover |
| Auto-stage | HARD OFF |
| Validation | tsc/build PASS; focused 66 PASS; suite 1693/1 (roster TTL pre-existing); isolated PG enforcement PASS |

---

## 2. Push

| Item | Result |
|------|--------|
| Command | `git push origin HEAD:main` |
| Range | `d17813b..c3b2317` |
| Tip | `c3b2317b9ce4029f6271f1dc0725cf168a992db5` |
| Status | **Success** |

Unrelated local SEC-OPS/RD_6/`tmp` dirt was **not** pushed.

---

## 3. Deployment status

| Field | Value |
|-------|--------|
| Deployment ID | `dpl_C87tZtp1VnfLnfT2rBD89Zoj4Zww` |
| URL | https://deptsync-dlt1crmqp-tyson-zauggs-projects.vercel.app |
| Alias | https://deptsync-hub.vercel.app |
| Target | Production |
| ReadyState | **READY** |
| Commit | `c3b2317` |

### App health (post-deploy, pre-migrate)

| Check | Result |
|-------|--------|
| `/login` | **200** |
| `/api/week-capacity` (unauth) | **401** `{"error":"Unauthorized"}` |
| `/manifest.webmanifest` | **200** |

---

## 4. Production backup

| Field | Value |
|-------|--------|
| Method | Management API ephemeral DB password rotate → `pg_dump` 17 (Homebrew) `-Fc` |
| Artifact | `tmp/production-backups/deptsync-fmeinlwhixngednabhgy-2026-10-12T03-04-04Z.dump` |
| Meta | `…03-04-04Z.meta.json` |
| Size | **756974** bytes |
| TOC entries | **1240** |
| Password persistence | **Not persisted / not printed** |

### Pre-migrate fingerprints

| Key | Value |
|-----|------:|
| W41 assignments | **6** |
| W42 assignments | **0** |
| Section members | **160** |
| Active sections | **4** |
| W42 shift rows | **27** |
| Approvals table present | **1** (already present; see §5 note) |

---

## 5. Migration status

| Item | Result |
|------|--------|
| File | `supabase/migrations/20261016_section_rotation_005_approved_capacity.sql` |
| Apply | **COMMIT** (`MIGRATE_RC=0`) |
| Client | `psql` 17 over SSL as `postgres` |
| Notes | Idempotent: table/indexes already existed (`CREATE … IF NOT EXISTS` skipped); functions **CREATE OR REPLACE** applied; grants/revokes applied |

**Note:** Preflight (~hours earlier) observed PostgREST PGRST205 for the approvals table. At apply time the relation already existed. Migration still replaced RPCs/fingerprint and re-asserted privileges — production now enforces approved capacity (`approved_capacity_enforced: true`).

### Post-migrate fingerprints (unchanged operational data)

| Key | Value |
|-----|------:|
| Approvals table | Present |
| Approval rows | **0** (none auto-inserted) |
| W41 assignments | **6** |
| W42 assignments | **0** |
| Section members | **160** |
| Active sections | **4** |
| W42 shifts | **27** |
| `upsert_store_week_capacity_approvals` | Present |
| `upsert_sunday_bay_assignments_with_capacity` | Present |
| `associate_week_schedule_fingerprint` | Present |

---

## 6. Production verification (DB / auth / enforcement)

| Check | Result |
|-------|--------|
| Service-role empty capacity RPC | **200** `ok:true, written:0, approved_capacity_enforced:true` |
| Service-role non-empty without approvals | **400** `CAPACITY_APPROVAL_MISSING` (no row written) |
| Approvals table row count | **0** |
| Anon SELECT approvals | **401/42501** permission denied |
| Empty approvals RPC | **200** `written:0` (no capacity invented) |
| Direct `postgres` session RPC | Expected `CAPACITY_STORE_FORBIDDEN` (empty `auth.role`) — not used by app |
| Sunday auto-stage constants | Remain `false` at `c3b2317` |

**No production weekly assignments created. No capacities auto-approved.**

---

## 7. Capacity review / proposal interfaces

| Check | Result |
|-------|--------|
| Unauth `/api/week-capacity` | **401** (MasterAdmin gate intact) |
| `/login` | **200** |
| Deploy Ready on alias | **Yes** |
| Operator W42 approval via Floor Command | **Pending operator** |
| Stewardship proposal actionable state | Requires operator approvals (fail-closed until then) |

Full interactive UI proof is **phone acceptance** (below).

---

## 8. Capacity approval status

| Item | Status |
|------|--------|
| Auto-inserted approvals | **None** |
| Expected operator W42 caps | Tyson **3** · Nick **3** · Tracy **3** · Nate **2** → shared **11** |
| Who approves | Operator via Floor Command Sunday weekly planning drawer |

---

## 9. Proposal verification

Engine/local fixtures already covered. Production proposal becomes actionable only after operator approves capacities. **Not auto-confirmed.**

---

## 10. Phone acceptance status

**AWAITING OPERATOR.** Do not mark complete until confirmed on device.

### Exact phone acceptance steps

1. Open https://deptsync-hub.vercel.app on the phone; sign in as MasterAdmin.  
2. Open Floor Command → Sunday / weekly planning (existing Sunday audit assignment drawer).  
3. Confirm target week **2026-W42** (Oct 12–18, 2026).  
4. Confirm schedule evidence shows approximately: Tyson 6d, Nick 5d, Tracy 4d, Nate 2d.  
5. In **Weekly bay capacity**, set: Tyson 3, Nick 3, Tracy 3, Nate 2.  
6. Tap **Approve weekly capacity**; confirm shared target becomes **11**.  
7. With staged/unowned bays (if present), inspect **stewardship distribution** proposal: owners, aisles, explanations.  
8. Confirm layout/readability; no unexpected assignment writes until you tap **Assign this week**.  
9. Only if you intend to enter ownership: review proposal, then **Assign this week** (optional — not required to close release).  
10. Reply that phone acceptance passed or list defects.

---

## 11. Known limitations

1. Assign this week remains blocked until MasterAdmin approves eligible associates for the week.  
2. Extra-bay +1 cannot exceed approved capacity.  
3. Sunday auto-stage / production section-aware preview env stay OFF.  
4. Roster TTL test isolation defect remains open (out of scope).  

---

## 12. Remaining blockers

1. **Operator phone acceptance** of capacity UI + proposal UX.  
2. Operator must personally approve W42 capacities (3/3/3/2).  
3. Optional: operator decision whether to confirm Assign this week after proposal review.

---

## 13. Final release verdict

| Scope | Verdict |
|-------|---------|
| Push `c3b2317` | **DONE** |
| Production deploy | **DONE** (`dpl_C87tZtp1VnfLnfT2rBD89Zoj4Zww`) |
| Backup | **DONE** (756974 bytes / TOC 1240) |
| Migration apply | **DONE** (COMMIT) |
| Enforcement verify | **DONE** (fail-closed without approvals) |
| Data preservation | **DONE** (W41=6, W42=0, sections 160, shifts 27) |
| Phone / W42 capacity acceptance | **PENDING OPERATOR** |
| Overall | **RELEASED — AWAITING PHONE ACCEPTANCE** |
