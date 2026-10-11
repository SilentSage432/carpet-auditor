# DEPTSYNC-RD-3-RELEASE — Operational Sections Production

**Status:** COMPLETE  
**Date:** 2026-10-11  
**Project:** `fmeinlwhixngednabhgy`  
**App:** https://deptsync-hub.vercel.app  
**Migration:** `supabase/migrations/20261011_operational_sections.sql`

---

## A. Migration result

| Step | Result |
|------|--------|
| Project identity | `fmeinlwhixngednabhgy` ACTIVE_HEALTHY us-west-2 |
| Platform backup API | `backups: []`, `pitr_enabled: false` |
| Recoverable backup | Fresh `pg_dump` **543509 bytes** → `tmp/production-backups/deptsync-fmeinlwhixngednabhgy-2026-10-11T05-32-46-001512000Z.dump` |
| Apply | **Success** via Homebrew `psql` 17.11 as `postgres` |
| PostgREST | Tables readable (`200 []`) after `NOTIFY pgrst` |

---

## B. Database verification

| Check | Result |
|-------|--------|
| Tables | `operational_sections`, `operational_section_members`, `operational_section_events` |
| RLS enabled | all three `true` |
| Normalize trigger | `operational_section_members_normalize_aisle` |
| Unique index | `operational_section_members_one_bay_idx` = `(department_id, regexp_replace(upper(trim(aisle)), '\s+', ' ', 'g'), bay)` |
| SELECT policies | 3 × Authenticated read… |
| Authenticated write policies | **0** |
| `jwt_matches_store` in policy qual | **3** |
| Row counts | `0/0/0` |

---

## C. Commit SHA

`7bec21e9e2a3303352fe74508988ee9b0c1462e5`  
`feat: ship Operational Sections stewardship overlay to production`  
Pushed to `origin/main` (no force).

---

## D. Deployment ID

| Field | Value |
|-------|--------|
| Deployment | `dpl_8Tzr1D2hpXa6varqUrDkwjJHjUtZ` |
| URL | https://deptsync-919f8nmea-tyson-zauggs-projects.vercel.app |
| Environment | Production |
| Status | **Ready** |
| Aliases | `deptsync-hub.vercel.app`, `deptsync-hub-tyson-zauggs-projects.vercel.app`, `deptsync-hub-git-main-tyson-zauggs-projects.vercel.app` |
| GitHub Vercel status | **success** — “Deployment has completed” on `7bec21e` |

---

## E. Production status

- App: https://deptsync-hub.vercel.app — Production Ready alias on the RD-3 deployment  
- DB: RD-3 schema live; empty overlay tables  
- Untouched: topology, roster, Sunday rotation, bootstrap, weekly capacity history  

---

## F. Smoke-test results (non-mutating)

| Check | Result |
|-------|--------|
| Auth gate | `/` → **307** `/login?next=%2F` |
| Login / Overview / Settings / Sunday / Dashboard / Store-map | **200** (SPA shell via login) |
| `GET /api/operational-sections` | **401** `Unauthorized` (route live; not 404/503) |
| `GET /api/weekly-rotations` | **401** (existing weekly board API intact) |
| `GET /api/auth/verify` | **401** setup-session message (auth architecture intact) |
| Artificial sections / topology / roster writes | **Not performed** |

---

## G. Any blockers

None for release completion. Note: Supabase Management API listed zero platform backups / PITR off; release proceeded only after a successful local recoverable `pg_dump`. DB password was rotated via Management API for dump/migrate access and **not** persisted.

---

## H. Rollback considerations

1. **App:** Redeploy prior Production deployment (`deptsync-lo1kv34n9…`, ~36m before this release) or revert `main` to `803b7cf` and redeploy.  
2. **Schema:** Additive empty tables — safe to leave. Hard rollback = `DROP TABLE` events/members/sections + drop function/trigger/indexes (destructive; only if operator authorizes). Prefer leave schema and hide UI via prior app deploy.  
3. **Dump:** `tmp/production-backups/deptsync-fmeinlwhixngednabhgy-2026-10-11T05-32-46-001512000Z.dump` for restore if catastrophe (operator-controlled).

**STOP. Do not begin RD-4.**
