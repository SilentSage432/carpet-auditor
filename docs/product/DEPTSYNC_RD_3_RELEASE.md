# DEPTSYNC-RD-3-RELEASE — Operational Sections Production

**Status:** IN PROGRESS → COMPLETE after deploy smoke  
**Date:** 2026-10-11  
**Project:** `fmeinlwhixngednabhgy`  
**App:** https://deptsync-hub.vercel.app  
**Migration:** `supabase/migrations/20261011_operational_sections.sql`

---

## A. Migration result

| Step | Result |
|------|--------|
| Project identity | `fmeinlwhixngednabhgy` ACTIVE_HEALTHY us-west-2 |
| Pre-migration dump | `tmp/production-backups/deptsync-fmeinlwhixngednabhgy-2026-10-11T05-32-46-001512000Z.dump` (543509 bytes) |
| Apply | **Success** via `psql` 17.11 (Homebrew) as postgres |
| Platform backup API | `backups: []`, `pitr_enabled: false` — recoverable backup established via fresh `pg_dump` instead |

---

## B. Database verification

| Check | Result |
|-------|--------|
| Tables | `operational_sections`, `operational_section_members`, `operational_section_events` |
| RLS enabled | all three `true` |
| Normalize trigger | `operational_section_members_normalize_aisle` |
| Unique index | `operational_section_members_one_bay_idx` on `(department_id, regexp_replace(upper(trim(aisle)),…), bay)` |
| SELECT policies | 3 × Authenticated read… |
| Authenticated write policies | **0** |
| `jwt_matches_store` in policy qual | **3** |
| Row counts | `0/0/0` |

---

## C–H

Filled after commit, push, Vercel Ready, and non-mutating smoke.
