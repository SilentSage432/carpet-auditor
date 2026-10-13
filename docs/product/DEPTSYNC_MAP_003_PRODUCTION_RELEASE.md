# DEPTSYNC-MAP-003 — Supervisory Weekly Bay Priorities Production Release

**Status:** RELEASED — AWAITING PHONE ACCEPTANCE  
**Date:** 2026-10-13  
**Mode:** Controlled production release (migration + app)  
**Store:** 2587  
**Supabase:** `fmeinlwhixngednabhgy` (ACTIVE_HEALTHY, us-west-2)  
**Application:** https://deptsync-hub.vercel.app  

**Implements:** [`DEPTSYNC_MAP_003_IMPLEMENTATION.md`](DEPTSYNC_MAP_003_IMPLEMENTATION.md)

**Strict exclusions honored:** No permanent test priorities; no weekly proposal approval for testing; no section rebuild; no Zebra API; Sunday auto-stage remains **HARD OFF**.

---

## Release sequence

| Step | Action | Rationale |
|------|--------|-----------|
| 1 | Preflight (77 focused + tsc + build + migration review) | Confirm scoped release |
| 2 | Production `pg_dump` backup | Recoverable restore point |
| 3 | Apply `20261019_map_003_week_bay_priorities.sql` | Persist week-scoped priorities before app ships |
| 4 | Schema/RLS/privilege verification | Fail-closed writes; store-scoped SELECT |
| 5 | Push/deploy app commit `bd9bbab` | Map + proposal UI consume new table |

---

## 1. Application commit

| Field | Value |
|-------|--------|
| Repository | `SilentSage432/carpet-auditor` |
| Branch | `main` |
| Commit | **`bd9bbab`** (`bd9bbabf84700c4b689ff9c395a3e71c64936633`) |
| Message | `MAP-003: supervisory week-scoped bay priorities` |
| Prior tip | `d30168b` |
| Push | `d30168b..bd9bbab` → `origin/main` |
| Scoped files | week-bay-priority domain/API/UI + stewardship integration + migration + MAP-003 docs + journal/handoff/roadmap/architecture |
| Excluded dirt | SEC-OPS-010 / RD_6 / SEC-OPS-010A docs, `tmp/` |

---

## 2. Deployment ID

| Field | Value |
|-------|--------|
| GitHub Production deployment | **`7048524886`** (sha `bd9bbab`) |
| Vercel deployment | **`dpl_FV5t9Crxt9kuSRss7xgFdWLX2dWi`** |
| Vercel URL | https://deptsync-6minoyevw-tyson-zauggs-projects.vercel.app |
| Status | **Ready** |
| Created | 2026-10-13T19:49:23Z |
| Production alias | https://deptsync-hub.vercel.app |
| Alias match | Alias points at this Ready production deployment; `origin/main` = `bd9bbab` |

HTTP smoke after deploy:

| Check | Result |
|-------|--------|
| `GET /login` | **200** |
| `GET /admin/store-map` (unauth) | **307** → login |
| Unauth `GET/POST/DELETE /api/store-locations/week-bay-priority` | **401** `{"error":"Unauthorized"}` |
| Unauth `GET /api/store-locations/bay-context` | **401** |
| Unauth `GET /api/operational-sections` | **401** |
| Unauth `GET /api/week-capacity?week=2026-W42` | **401** |

---

## 3. Production migration result

| Item | Result |
|------|--------|
| File | `supabase/migrations/20261019_map_003_week_bay_priorities.sql` |
| Project | `fmeinlwhixngednabhgy` |
| Apply | **COMMIT** (`CREATE TABLE` + indexes + RLS + SELECT policy) |
| Client | `psql` 17.11 over SSL as `postgres` |
| Table | `public.store_week_bay_priorities` present |
| RLS | **enabled** |
| Policy | Authenticated SELECT via `jwt_matches_store(store_number)` |
| Privileges | anon INSERT/SELECT **denied**; authenticated INSERT/UPDATE/DELETE **denied**; authenticated SELECT **granted** |
| Unique active index | `store_week_bay_priorities_active_unique_idx` present |
| Priority rows after migrate | **0** (no permanent test priorities) |
| Assignment RPC ownership | `section_ownership_enforced` **PASS** |
| Assignment RPC capacity | `approved_capacity_enforced` **PASS** |

---

## 4. Backup verification

| Field | Value |
|-------|--------|
| Method | Management API ephemeral DB password rotate → `pg_dump` 17.11 `-Fc` |
| Artifact | `tmp/production-backups/deptsync-fmeinlwhixngednabhgy-2026-10-13T19-45-55Z.dump` |
| Meta | `…19-45-55Z.meta.json` |
| Size | **647012** bytes |
| TOC entries | **974** |
| TOC includes | operational_sections / members / sunday_bay_assignments / week capacity / weekly_rotations / walkthroughs / capacity + ownership RPC |
| Password persistence | **Not persisted / re-rotated after backup and after migrate** |

---

## 5. Security verification

| Check | Result |
|-------|--------|
| Unauth priority API | **401** |
| Anon INSERT priority table | **DENIED** |
| Authenticated INSERT/UPDATE/DELETE | **DENIED** (service-role API path only) |
| Store isolation SELECT policy | `jwt_matches_store(store_number)` |
| Supervisor/Master write gate | `requireSupervisorOrAdmin` + department scope in API |
| Priorities create assignments | **No** — table/API never write `sunday_bay_assignments` |
| Ownership/capacity bypass | **No** — RPC ownership + capacity enforcement retained |

---

## 6. Rotation integration verification

| Contract | Result |
|----------|--------|
| `STEWARDSHIP_WEEK_DISTRIBUTION_AUTO_STAGE = false` | **PASS** |
| `STRICT_SECTION_OWNERSHIP_AUTO_STAGE = false` | **PASS** |
| `SECTION_AWARE_ROTATION_AUTO_STAGE = false` | **PASS** |
| Preferential `supervisor` tier after carry | Shipped in `bd9bbab` |
| Explainable outcomes in Sunday proposal | Shipped UI |
| One Assign this week confirm | Preserved |
| Carry-forward precedence | Carry still ahead of supervisor tier |

---

## 7. Data preservation

| Artifact | Pre | Post |
|----------|-----|------|
| Active Operational Sections | 4 | **4** |
| Section memberships | 160 | **160** |
| `sunday_bay_assignments` | 38 | **38** |
| Capacity approvals | 4 (sum 11) | **4 (sum 11)** |
| Active weekly rotations | 41 | **41** |
| Walkthrough sessions | 1 | **1** |
| Walkthrough observations | 1 | **1** |
| Walkthrough follow-ups | 0 | **0** |
| Priority rows | (absent) | **0** |

Zebra handoff columns remain on `sunday_bay_assignments` (no automatic Zebra integration). No automatic rotation approval.

---

## 8. Test results

| Gate | Result |
|------|--------|
| Focused vitest (MAP-003 + ownership + stewardship + RD-2 + section-aware) | **77 PASS** |
| `npx tsc --noEmit` | **PASS** |
| IDE lint (touched files) | Clean |
| `npx next build` | **PASS** (`/api/store-locations/week-bay-priority`) |

---

## 9. Phone acceptance steps

Target week shown on Map at release time: **2026-W43** (next ISO week after current **2026-W42**).

1. Open Floor Command on phone.  
2. Navigate to **Map**.  
3. Select a bay inside an owned Operational Section.  
4. Confirm **Prioritize for Next Week** appears (Supervisor/Master).  
5. Verify the shown target week (**2026-W43** or the then-current next week).  
6. Prioritize the bay.  
7. Confirm “Priority requested” is visible on the sheet.  
8. Revoke the priority if desired (leave no permanent test priority).  
9. Open the weekly proposal (Sunday / This Week assign drawer) for that week when staged.  
10. Confirm inclusion or exclusion is explained (intent only — not already assigned).  

Do **not** approve a weekly proposal solely for testing.

---

## 10. Remaining blockers

1. Phone acceptance of Map prioritize + Sunday outcome review.  
2. MAP-001 walking-cues presentation still deferred.  
3. MAP-004 named zone geography — not started.  

---

## 11. Release status

**RELEASED — AWAITING PHONE ACCEPTANCE.**

Commit `bd9bbab` · Vercel `dpl_FV5t9Crxt9kuSRss7xgFdWLX2dWi` · GitHub deploy `7048524886` · migration **COMMIT** on `fmeinlwhixngednabhgy`.

**STOP. Do not begin MAP-004.**
