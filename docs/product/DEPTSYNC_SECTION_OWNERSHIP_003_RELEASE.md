# DEPTSYNC-SECTION-OWNERSHIP-003 — Temporary Weekly Coverage Controlled Production Release

**Status:** **RELEASED** (engineering) — **operator phone acceptance pending**  
**Date:** 2026-10-19  
**Mode:** VALIDATE → MIGRATE → RELEASE → VERIFY  
**Application:** https://deptsync-hub.vercel.app  
**Supabase:** `fmeinlwhixngednabhgy`  
**Store:** 2587 · Flooring / Home Decor  

**Authority:** Operator-authorized SECTION-OWNERSHIP-003 production release · SECTION-OWNERSHIP-002 already released (`b03c15a`) · AUTO-008 remains enabled · AUTO-009 simulated acceptance recorded earlier  

**Strict exclusions honored:** No permanent-ownership auto-transfer · no capacity multiplication via coverage · no shift/schedule requirement · no historical assignment rewrite · no standing-capacity change · no AUTO-008 disable · no cron change · no W44 manual publish · no production coverage fixture rows · no specialty · no Orient.

---

## 1. Release scope

Enable authorized supervisors to assign **temporary weekly section coverage** without changing permanent section ownership. Preserve automatic weekly rotation (AUTO-008). Do not redesign the ownership model.

| Item | Value |
|------|-------|
| App commit | **`9616cc8`** (`9616cc8c41b1a86989ce47993189bc3d7e7650d1`) |
| Prior production tip | `867c23b` (002 docs) / app `b03c15a` |
| Migration | `supabase/migrations/20261026_section_ownership_003_week_coverage.sql` |
| Sequence | Backup → migrate COMMIT → push app → Vercel Ready |
| AUTO-008 latch | Remains **`WEEKLY_ROTATION_AUTO_PUBLISH = true`** |
| Cron | Unchanged **`0 12 * * 0`** |
| Standing capacity | Remains **Tyson/Nate/Nick/Tracy 3/3/3/3 = 12** |

---

## 2. Exact release candidate

| Check | Result |
|-------|--------|
| Local tip before push | `9616cc8` ahead of `origin/main` @ `867c23b` by **1** |
| Based on released 002 | Yes — `b03c15a` is ancestor |
| Diff vs `origin/main` | **13 files** / +2033 −3 (coverage only + journal/handoff/roadmap touch) |
| Unrelated changes | **None** in candidate commit |
| Working tree extras | Unrelated untracked docs under `docs/product/` left uncommitted |

Shipped surfaces: coverage domain + API + Operational Sections UI + planner overlay + capacity RPC effective-owner resolution + roster deactivate coverage warning + migration + focused tests.

---

## 3. Migration validation (isolated)

| Field | Value |
|-------|--------|
| Local disposable DB | Homebrew Postgres harness (`deptsync_so003_val_*`) |
| Apply | **COMMIT** |
| Asserts | Default no-coverage → permanent owner **PASS** · week isolation **PASS** · permanent owner unchanged **PASS** · capacity invariant Tracy B∪D still **3** **PASS** · person ceiling **PASS** · covered bay rejects permanent owner **PASS** · revoke restores permanent **PASS** |
| Destructive ops | **None** (CREATE TABLE/INDEX/FUNCTION + REPLACE capacity RPC only) |
| FK shape | `covering_specialist_id uuid` → `store_specialists(id)` matches production UUID specialists |

---

## 4. Capacity invariant evidence

| Path | Evidence |
|------|----------|
| Planner | Vitest: Tracy covering B+D draws **at most 3** from union pool (5 deterministic draws) |
| Preview helper | `previewCoverageCapacityImpact` → approved_capacity **3**, section_pool_count **2**, note does not multiply |
| Authoritative RPC | Local SQL: Tracy writes **3** across B∪D; 4th raises `CAPACITY_PERSON_EXCEEDED` |
| Production | Standing items remain **3/3/3/3**; no coverage rows created |

---

## 5. Default-behavior equivalence

| Fixture | Result |
|---------|--------|
| Empty coverage overlay vs permanent-only map | Fingerprint **identical** (`section-ownership-003.equivalence.test.ts`) |
| SQL `effective_operational_section_owner` without rows | Returns permanent owner |
| Production post-migrate with **0** coverage rows | Effective ownership = permanent owners (RPC path) |

Unexplained planner differences: **none** for the no-coverage case.

---

## 6. Coverage acceptance (pre-prod)

Focused vitest + SQL contracts cover: create/update/revoke semantics (domain), published-week ack requirement, inactive/MasterAdmin rejection gates (source), roster deactivate future-coverage warning, week-label validation, multi-section capacity, permanent preservation.

Production: **no coverage rows created** (smoke-only).

---

## 7. Roster lifecycle compatibility (002)

| Check | Result |
|-------|--------|
| 002 regressions | **11 PASS** |
| Deactivate warns on future coverage | Contract **PASS** |
| Standing capacity untouched by coverage | Source + standing sum **12** preserved |
| Shift schedules irrelevant | Coverage UI/domain have no shift entry |

---

## 8. AUTO-008 compatibility

| Check | Result |
|-------|--------|
| Latch | `true` in `9616cc8` |
| Cron | `0 12 * * 0` |
| Standing | v1 **12** |
| Planner path | `loadCoverageOwnerBySectionId` → overlay → section-balanced stage |
| Persistence | Same `upsert_sunday_bay_assignments_with_capacity` (now week-effective owner) |
| Activation latch / env gates | **Unchanged** |
| W44 | Still **empty** — first unattended publication remains **2026-10-25T12:00:00Z** |

---

## 9. Production preflight (read-only)

Captured before migrate → `tmp/so003-preflight.json` / post → `tmp/so003-post-migrate.json`

| Asset | Pre | Post |
|-------|-----|------|
| Coverage table | **Absent** | **Present**, **0** rows |
| SBA fingerprint | `55dde8e86360caea` | `55dde8e86360caea` **MATCH** |
| SBA total / weeks | 30 · 12+12+6 | Identical |
| W43 / W44 SBA | 0 / 0 | 0 / 0 |
| W43 capacity | 3/3/3/3 = 12 | Unchanged |
| Active sections / members | 4 / 160 | 4 / 160 |
| Permanent owners | CSA→Nate · Specialist-A→Nick · Specialist-B→Tracy · Myself→Tyson | **Match SO-002** |
| Standing policy | Active v1 | Active v1 |
| AUTO-008 / cron | Enabled / `0 12 * * 0` | Unchanged |

---

## 10. Production backup + migration

| Field | Value |
|-------|--------|
| Pre-backup | `tmp/production-backups/deptsync-fmeinlwhixngednabhgy-2026-10-19T15-28-11Z.dump` |
| Backup size / TOC | **675862** bytes / **1016** TOC entries |
| Apply method | Management API ephemeral DB password → `pg_dump` 17 → `psql` → password re-rotate |
| Apply result | **COMMIT** |
| Objects | `operational_section_week_coverage` + indexes/RLS + `effective_operational_section_owner` + replaced capacity RPC |
| Assignment / ownership mutation | **None** (fingerprint + owners preserved) |

Compatibility window: migrate first (old app fail-opens when coverage table missing; empty coverage → permanent owners via new RPC). Then deploy app for UI/API overlay.

---

## 11. Deployment evidence

| Field | Value |
|-------|--------|
| Push | `867c23b..9616cc8` → `origin/main` |
| Vercel commit status | **success** — “Deployment has completed” |
| Vercel status page | https://vercel.com/tyson-zauggs-projects/deptsync-hub/HRLdwv41kWkdpNigXK2Y2jA8zJoq |
| Alias | https://deptsync-hub.vercel.app |
| GitHub Actions workflows for SHA | **0** (Vercel GitHub integration; same class as AUTO-008B) |

---

## 12. Post-deploy smoke (non-mutating)

| Check | Result |
|-------|--------|
| `GET /login` | **200** |
| Protected pages | Redirect to login |
| `GET /api/section-week-coverage` (unauth) | **401** |
| `POST /api/section-week-coverage` (unauth) | **401** |
| `GET /api/roster/lifecycle` (unauth) | **401** |
| `GET /api/standing-capacity` (unauth) | **401** |
| Coverage rows in production | **0** |
| Standing sum | **12** |
| Fingerprint | Unchanged `55dde8e86360caea` |

Authenticated Operational Sections coverage UI requires operator session (see §14).

---

## 13. Test results

| Suite | Result |
|-------|--------|
| SECTION-OWNERSHIP-003 week-coverage | **15 PASS** |
| SECTION-OWNERSHIP-003 equivalence | **1 PASS** |
| SECTION-OWNERSHIP-002 roster lifecycle | **11 PASS** |
| AUTO-008 / rotation regressions (selected) | Included in **172 PASS** focused batch |
| Focused batch (10 files, pre-equivalence add) | **172 PASS** |
| With equivalence | **173 PASS** |
| TypeScript `tsc --noEmit` | **PASS** (clean) |
| ESLint (new 003 TS/API files) | **PASS** (0 errors) |
| ESLint OperationalSectionsPanel | Pre-existing `set-state-in-effect` (Oct 10) — not introduced by 003 |
| Production build | **PASS** |
| AUTO-009 file on tip | Absent from this tip (stashed earlier); SQL/planner equivalence + 003/008 regressions revalidated instead |

---

## 14. Outstanding operator acceptance

1. Phone-accept Operational Sections **temporary weekly coverage** UI (week select → cover → save / revoke).  
2. Confirm published-week changes require explicit `acknowledge_published_week` (409 without ack).  
3. Do **not** create lasting test coverage in production unless intentionally authorized.  
4. Await AUTO-008 first unattended publication **2026-10-25T12:00Z → 2026-W44**.

---

## 15. Rollback / forward-recovery

| Path | Action |
|------|--------|
| App rollback | Redeploy prior tip `867c23b` / `b03c15a` (coverage API/UI gone; RPC still week-effective but empty coverage ≡ permanent) |
| Schema forward | Prefer leave table; revoke any coverage rows rather than DROP under load |
| Hard recovery | Restore from `deptsync-fmeinlwhixngednabhgy-2026-10-19T15-28-11Z.dump` then re-apply later migrations carefully |
| Password | Ephemeral rotate used for migrate; re-rotated after apply (not persisted) |

---

## 16. GO / NO-GO verdict

**GO — RELEASED.**

Migration COMMIT · fingerprint preserved · standing 12 preserved · AUTO-008 latch/cron untouched · app `9616cc8` Ready on production alias · coverage API auth-gated · no production coverage fixtures created.

**STOP after this report.** Operator phone acceptance + Oct 25 AUTO-008 first-run remain open milestones.
