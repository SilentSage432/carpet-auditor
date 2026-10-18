# DEPTSYNC-SECTION-OWNERSHIP-003 — Temporary Weekly Section Coverage

**Status:** COMPLETE locally — **PRODUCTION HOLD**  
**Date:** 2026-10-18  
**Mode:** Local implementation only  
**Canonical discovery:** [`DEPTSYNC_SECTION_OWNERSHIP_001_DISCOVERY.md`](DEPTSYNC_SECTION_OWNERSHIP_001_DISCOVERY.md)  
**Prior tranche:** [`DEPTSYNC_SECTION_OWNERSHIP_002_IMPLEMENTATION.md`](DEPTSYNC_SECTION_OWNERSHIP_002_IMPLEMENTATION.md)  
**Automation boundary:** [`DEPTSYNC_ROTATION_AUTO_008_ACTIVATION.md`](DEPTSYNC_ROTATION_AUTO_008_ACTIVATION.md)

**Strict exclusions honored:** No production migrate · no push · no Vercel deploy · no production ownership/capacity/assignment writes · AUTO-008 latch/cron untouched · no employee scheduling · no specialty · no Orient.

**Automation hold:** First AUTO-008 publication **2026-10-25T12:00:00Z → 2026-W44** must be verified before any production release of 002/003.

---

## 1. Executive summary

Supervisors can establish **week-scoped temporary coverage** for an Operational Section without changing permanent `primary_owner_specialist_id`.

- Permanent owner: Section B → Nate  
- Temporary coverage: 2026-W45 → Tracy  
- Future weeks revert to Nate unless another coverage row exists  
- Capacity remains **per associate** (Tracy still has 3 total bays, not 3×sections)  
- Planner + ownership RPC resolve **effective owner** = active coverage ?? permanent  
- Published weeks require explicit acknowledgment; coverage never rewrites history  

---

## 2. Existing architecture reused

| Capability | Reuse |
|------------|-------|
| Permanent ownership | `operational_sections.primary_owner_specialist_id` + OPERATIONAL-011 |
| Section-balanced stage | `selectSectionBalancedPhysicalBayCoverage` (single engine) |
| Authoritative publisher | `loadAuthoritativeStageContext` → stewardship → capacity RPC |
| Standing / weekly capacity | AUTO-008A materialization; associate-scoped 0–3 |
| Supervisor edit / locks | AUTO-003 `supervisor_locked` + protected statuses |
| Roster lifecycle | SECTION-OWNERSHIP-002 soft deactivate / reactivate |
| Auth | `requireSupervisorOrAdmin` / store-scoped specialists |

**No second rotation engine.** Coverage only overlays effective owner before the existing stage.

---

## 3. Coverage data model

Table: `operational_section_week_coverage`

| Column | Role |
|--------|------|
| `store_id` | Store isolation |
| `section_id` | Operational Section |
| `week_label` | ISO week (`YYYY-Www`) |
| `covering_specialist_id` | Temporary covering associate |
| `established_by_specialist_id` | Authorizing supervisor provenance |
| `established_at` / `revoked_at` | Soft revoke (history retained) |
| `note` | Optional operator note |

Unique active row per `(section_id, week_label)` where `revoked_at is null`.

Helpers:

- `iso_week_label_from_date(date)`  
- `effective_operational_section_owner(section_id, week_starting, primary_owner)`  

RPC `upsert_sunday_bay_assignments_with_capacity` resolves ownership via effective owner (does not weaken permanent checks).

---

## 4. Authorization boundaries

| Action | Gate |
|--------|------|
| List coverage | Authenticated store actor |
| Establish / replace | Supervisor or MasterAdmin |
| Revoke | Supervisor or MasterAdmin |
| Covering associate | Active roster member, same store, not MasterAdmin |
| Section | Active Operational Section in actor store |
| Week | Valid `YYYY-Www` |
| Duplicate active | Soft-revoke prior then insert (one active) |

No shift schedule required. No cross-store assignment. RLS: authenticated store-scoped read; writes via service role after API auth.

---

## 5. Permanent ownership preservation

- Coverage **never** updates `primary_owner_specialist_id`.  
- Overlay is pure in TypeScript (`applyWeekCoverageToBaySectionLookups`).  
- Revoke / expire → permanent owner applies again.  
- Reactivation of a deactivated associate does **not** restore revoked coverage.

---

## 6. Capacity allocation rules

**Rule (simplest safe):** One associate → one approved capacity budget for the week. Multi-section eligibility **unions** the bay pool; the stage still draws at most `remaining_capacity` once.

Example: Tracy owns D (3) and covers B → eligible pool = B∪D; selection ≤ 3 total. Shortfalls reported when eligible owed bays < capacity.

Tradeoff: Coverage expands geography, not quota. Section B may underfill if Tracy’s capacity is consumed by D (or vice versa). Associate slot order and capacity caps are deterministic; physical-bay draw remains the existing priority engine (equal-weight ties may still use the engine’s random break — not introduced by coverage).

Standing policy (Tyson/Nate/Nick/Tracy = 3 each, shared 12) unchanged by coverage writes.

---

## 7. Automatic publication integration

Flow inside existing authoritative path:

1. Operational week  
2. Materialize standing → weekly approvals  
3. Load permanent bay→section index  
4. **Apply active week coverage overlays**  
5. Section-balanced selection (per-associate capacity)  
6. Stewardship proposal  
7. Persist via ownership+capacity RPC (effective owner)  
8. Protected assignments preserved as before  

Coverage schema missing → empty overlay (fail-open to permanent only).

---

## 8. Published-week protection

Establishing coverage:

- Does **not** rewrite `sunday_bay_assignments`.  
- If the week already has non-cleared rows with protected status/locks or open attribution conflict vs previous effective owner → API returns **409** `published_week_ack_required`.  
- Supervisor must pass `acknowledge_published_week=true` (UI confirm).  
- Completed / verified / supervisor-locked rows remain attributed historically.  
- Open conflicts require separate explicit reassignment (existing supervisor tools).

---

## 9. Roster lifecycle integration

- Inactive associates rejected as covering specialists (`inactive_cover`).  
- Deactivate impact includes `future_coverage_count` warning (does not auto-revoke).  
- Reactivate does not resurrect revoked coverage.  
- Permanent ownership transfer remains independent of coverage.  
- Standing capacity never auto-modified by coverage or roster status.

---

## 10. Mobile supervisor workflow

Extended **Operational Sections** detail panel:

- Permanent owner display (existing)  
- Week label input (defaults next rotation week)  
- Covering associate dropdown (active, non-MasterAdmin)  
- Capacity impact note after save  
- Save / Revoke / Refresh  
- Confirm dialog when published-week ack required  

No calendars or shift entry.

---

## 11. Tests and validation evidence

Focused suite: `lib/store-ops/section-ownership-003.week-coverage.test.ts` (+ 002 roster warning case).

Covers: permanent preservation · week overlay · capacity non-multiplication · deterministic multi-section · insufficient bays · published-week risk · inactive/auth contracts · AUTO-008 latch/cron untouched · no parallel publisher.

Validation commands (local):

- Focused vitest (003 + 002 + AUTO-008 regression batch)  
- `tsc --noEmit`  
- Relevant ESLint  
- `next build`  

---

## 12. Migration requirements

Local file only:

`supabase/migrations/20261026_section_ownership_003_week_coverage.sql`

- Creates coverage table + indexes + RLS read policy  
- Adds effective-owner helper  
- Replaces capacity upsert RPC with effective-owner check  

**Do not apply to production** until W44 acceptance + authorized release.

---

## 13. Remaining blockers

1. AUTO-008 first unattended W44 publication not yet verified (2026-10-25Z).  
2. Migration not applied anywhere outside local/review environments.  
3. Commits for 002/003 must remain unpushed until release authorization.  
4. Optional follow-up: richer published-week conflict listing UI (section-scoped assignment diffs).

---

## 14. Production release prerequisites

1. Verify W44 AUTO-008 publication evidence.  
2. Authorized decision to release SECTION-OWNERSHIP-002 + 003 together or staged.  
3. Backup → apply migration → deploy app → smoke coverage establish/revoke on a **future** empty week.  
4. Confirm standing capacity and permanent owners unchanged.  
5. Confirm cron schedule and dual-gate latch unchanged except by separate authorization.

**Verdict:** Locally complete; **NOT production-ready** until prerequisites above.
