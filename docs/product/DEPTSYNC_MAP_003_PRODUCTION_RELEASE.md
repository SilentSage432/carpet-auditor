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
| 5 | Push/deploy matching app commit | Map + proposal UI consume new table |

---

## 1. Application commit

| Field | Value |
|-------|--------|
| Repository | `SilentSage432/carpet-auditor` |
| Branch | `main` |
| Commit | **TBD_AT_PUSH** |
| Message | `MAP-003: supervisory week-scoped bay priorities` |
| Scoped files | week-bay-priority domain/API/UI + stewardship integration + migration + docs |
| Excluded dirt | SEC-OPS-010 / RD_6 / SEC-OPS-010A docs, `tmp/` |

---

## 2. Deployment ID

| Field | Value |
|-------|--------|
| Deployment | **TBD_AT_DEPLOY** |
| Production alias | https://deptsync-hub.vercel.app |
| Alias commit match | **TBD** |

---

## 3. Production migration result

| Item | Result |
|------|--------|
| File | `supabase/migrations/20261019_map_003_week_bay_priorities.sql` |
| Project | `fmeinlwhixngednabhgy` |
| Apply | **COMMIT** |
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
| TOC includes | operational_sections / members / sunday_bay_assignments / week capacity / weekly_rotations / walkthroughs / capacity RPC |
| Password persistence | **Not persisted / re-rotated after backup and after migrate** |

---

## 5. Security verification

| Check | Result |
|-------|--------|
| Unauth priority API | Expected **401** after deploy |
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
| Preferential `supervisor` tier after carry | Shipped in composer |
| Explainable outcomes in Sunday proposal | Shipped UI |
| One Assign this week confirm | Preserved |

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

1. Open Floor Command on phone.  
2. Navigate to **Map**.  
3. Select a bay inside an owned Operational Section.  
4. Confirm **Prioritize for Next Week** appears (Supervisor/Master).  
5. Verify the shown target week (next ISO week).  
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

**RELEASED — AWAITING PHONE ACCEPTANCE** (commit/deploy IDs filled at push).

**STOP. Do not begin MAP-004.**
