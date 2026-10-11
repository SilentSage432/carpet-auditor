# DEPTSYNC-RD-5-RELEASE — Walkthroughs Production

**Status:** COMPLETE  
**Date:** 2026-10-11  
**Project:** `fmeinlwhixngednabhgy`  
**App:** https://deptsync-hub.vercel.app  
**Migration:** `supabase/migrations/20261012_walkthroughs.sql`  
**Includes:** RD-5 + RD-5-FIX store relationship integrity

---

## Pre-release

| Check | Result |
|-------|--------|
| Typecheck | Pass |
| Full tests | **1436** passed |
| Production build | Pass |
| Soft-ref store validation (RD-5-FIX) | Present |
| Auth / Sunday / capacity / topology unrelated | Untouched |

## Backup

| Field | Value |
|-------|--------|
| Dump | `tmp/production-backups/deptsync-fmeinlwhixngednabhgy-2026-10-11T15-46-33-024480000Z.dump` |
| Size | **581993** bytes |
| TOC entries | **934** (readable via `pg_restore -l`) |
| Core tables in dump | stores, departments, store_specialists, operational_sections, weekly_rotations |
| Platform backups / PITR | Empty / off — local dump required |

## Migration

Applied on `fmeinlwhixngednabhgy`. Tables RLS-enabled; 3 SELECT policies with `jwt_matches_store`; **0** authenticated write policies; 13 FKs; indexes + aisle normalize trigger; row counts **0/0/0**. PostgREST `200 []`.

## Application

| Field | Value |
|-------|--------|
| Prior Production commit | `f8bc0e5` |
| New Production commit | `c9744051835737ac8dc871274ed6a35063d381cd` |
| Push | `origin/main` (no force) |
| GitHub Production deployment | `6997933940` |
| Vercel status | **success** — Deployment has completed |
| Deploy URL | https://deptsync-cgciru7xp-tyson-zauggs-projects.vercel.app |
| Alias | https://deptsync-hub.vercel.app |

## Smoke (non-mutating)

Protected routes 307 → login; `/api/walkthroughs*` **401**; `/login` 200. No sample walkthrough writes.

## Rollback

1. **App:** Redeploy prior Production commit `f8bc0e5` (Vercel rollback / redeploy). Does **not** reverse DB schema.  
2. **Schema:** Additive empty tables — prefer leave in place. Destructive DROP only if operator authorizes.  
3. **Dump:** `tmp/production-backups/deptsync-fmeinlwhixngednabhgy-2026-10-11T15-46-33-024480000Z.dump` for catastrophe restore (operator-controlled).

**STOP. Do not begin RD-6.**
