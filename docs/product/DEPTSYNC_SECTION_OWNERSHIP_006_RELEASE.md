# DEPTSYNC-SECTION-OWNERSHIP-006 — Controlled Production Release

**Status:** **RELEASED** (engineering) — **operator phone acceptance outstanding**  
**Date:** 2026-10-22  
**Mode:** PREFLIGHT → VALIDATE → RELEASE → VERIFY  
**Application:** https://deptsync-hub.vercel.app  
**Supabase:** `fmeinlwhixngednabhgy`  
**Store:** 2587 · Flooring / Home Decor  

**Authority:** Operator-authorized SECTION-OWNERSHIP-006 production release. App commit `22aa4ff`. OPS-OVERVIEW-002 remains on this history (`4c29cf6`, docs `e5c22c5`). No phone acceptance required before deploy.

**Verdict:** **GO.**

**Strict exclusions honored:** No migrations. No assignment, ownership, coverage, standing-capacity, or publication writes. No AUTO-008 or cron change. No manual W44 publication. No historical reconstruction. Unrelated untracked docs left uncommitted.

---

## 1. Release summary

This Week labels temporary section coverage from the active coverage row for the plan week. The persisted assignee, the current permanent owner, and the covering associate stay three separate facts.

| Item | Value |
|------|-------|
| App commit | **`22aa4ff`** (`22aa4ff99348f915edc0c08d4a83e2c3c463137f`) |
| Prior `origin/main` | **`e5c22c5`** (OPS-OVERVIEW-002 release record; app `4c29cf6`) |
| Migrations | **None** |
| AUTO-008 latch | Remains **`WEEKLY_ROTATION_AUTO_PUBLISH = true`** |
| Cron | Unchanged **`0 12 * * 0`** |
| Standing policy | **`d8bd92ca-97d0-42ac-9126-b6ba2a16f561`** v1 · **3/3/3/3 = 12** |

The screen copy is “Assigned to”, “Permanent owner”, and “Covering this week”. It does not claim a reconstructed history of who covered or owned a section in a past week.

---

## 2. Isolation

| Check | Result |
|-------|--------|
| Push | `e5c22c5..22aa4ff` → `origin/main` |
| Included | This Week coverage labels, tests, implementation note, journal, handoff, roadmap, reconciliation pointer |
| Overview 002 | Untouched in this diff |
| Migrations / latch / cron / publisher | **None** in the diff |
| Left uncommitted | RD-6 audit, SEC-OPS-010A, SPECIALTY-OPS-001, `tmp/` |

---

## 3. Display behavior

| Rule | Result |
|------|--------|
| No coverage | Existing “Assigned this week” and steward line. No extra label. |
| Assignee is the cover, and is not already the permanent owner | “Assigned to {name}”, “Permanent owner {name}”, “Covering this week”. |
| Assignee differs from the cover | Assignee stays the assignee. “{cover} covering this week” names the cover. |
| Unowned bay | Stays unowned. Coverage does not assign it. |
| Coverage for another week | Ignored. The composer filters on the plan `weekLabel`. |
| Missing or ambiguous coverage | Label withheld. No false cover. |
| Missing permanent-owner name | “Permanent owner unavailable”. No invented name. |
| Existing interactions | Map, Zebra, completion, and downstock remain on the bay row. |
| Week source | `FloorTab` requests coverage with `assigned_week` from weekly rotations. No week browser was added. |

---

## 4. Historical honesty

Two limits stay in place. This release does not close them.

1. **Revoked coverage is not displayed.** `listActiveSectionWeekCoverage` returns rows with `revoked_at` null. After a cover is revoked, This Week cannot show that the section was covered.
2. **Permanent owner is the current owner.** `primary_owner_specialist_id` is today’s section owner. Owner-change events do not record which owner was in place for a given operational week, and this release does not infer one.

The UI wording does not say the label is a complete history of that week.

---

## 5. Test results

| Suite | Result |
|-------|--------|
| 006 labels, 003/004/005, AUTO-008A, This Week, authz, Overview 001/002 | **133 PASS** (12 files) |
| TypeScript | **PASS** |
| ESLint (ownership composer, 006 test, This Week board, Floor tab) | **PASS** |
| `next build` | **PASS** (Next.js 16.2.12) |

No schema migration.

---

## 6. Deployment evidence

| Field | Value |
|-------|--------|
| Push | `e5c22c5..22aa4ff` → `origin/main` |
| GitHub Production deployment | **`7269014678`** — state **success** |
| Vercel commit status | **success** — “Deployment has completed” |
| Vercel deployment | **`dpl_xg42BbAAtTrVKCR5zTk6VpFLk8sk`** — target **production** — **Ready** |
| Deployment host | https://deptsync-c2lz95flg-tyson-zauggs-projects.vercel.app |
| Alias | https://deptsync-hub.vercel.app |
| Dashboard | https://vercel.com/tyson-zauggs-projects/deptsync-hub/xg42BbAAtTrVKCR5zTk6VpFLk8sk |

Unauthenticated alias smoke (redirects not followed):

| Path | Result |
|------|--------|
| `/login` | **200** |
| `/dashboard` | **307** → login |
| `/overview` | **307** → login |
| `/settings?manage=rotation` | **307** → login |
| `/api/weekly-rotations` | **401** |
| `/api/section-week-coverage` | **401** |
| `/api/cron/weekly-rotation` | **401** |

A signed-in This Week session was not available, so the cover lines were not clicked on the phone. Production has **0** coverage rows, so those lines stay quiet until a cover exists.

---

## 7. Operational preservation

Pre → `tmp/so006-preflight.json` · Post → `tmp/so006-post.json`  
Fingerprint recipe matches the prior release: `store|department|week_starting|bay_id|roster|status|locked` as `0`/`1`, SHA-256, first 16 hex characters.

| Fact | Pre | Post |
|------|-----|------|
| Assignment fingerprint | `55dde8e86360caea` | `55dde8e86360caea` |
| Sunday bay assignments | 30 (12 / 12 / 6) | identical |
| W43 / W44 assignment rows | 0 / 0 | 0 / 0 |
| W44 rotations | 0 | 0 |
| Active sections × members | 4 × 160 | 4 × 160 |
| Coverage rows (active) | 0 (0) | 0 (0) |
| Standing | Nate/Nick/Tracy/Tyson 3/3/3/3, policy v1 `d8bd92ca-97d0-42ac-9126-b6ba2a16f561` | identical |
| W44 weekly approvals | 0 | 0 |
| W43 weekly approvals | Nate 0, Nick 3, Tracy 3, Tyson 3 | identical |
| AUTO-008 source latch | `true` (file not in the diff) | `true` |
| Cron | `0 12 * * 0` (file not in the diff) | unchanged |

Permanent owners, unchanged:

| Section | Owner | Active |
|---------|-------|--------|
| CSA | Tyson | yes |
| Myself | Tyson | yes |
| Section A | Nick | no |
| Specialist-A | Nick | yes |
| Specialist-B | Tracy | yes |

These are the live records at preflight. No older snapshot was substituted. No manual W44 publication. First AUTO-008 cron remains **2026-10-25T12:00Z → 2026-W44** and is still unverified. The production env secret was not read or changed.

---

## 8. Authorization

| Check | Result |
|-------|--------|
| Coverage GET | Existing `requireStoreOpsActor`. Alias returns **401** unsigned. |
| Coverage writes | Existing supervisor/MasterAdmin route. This release does not call them. |
| Protected pages | **307** to login |
| Signed-in This Week | **Not performed** |

---

## 9. Phone acceptance

Outstanding. An operator still needs to confirm, on a signed-in phone, once a cover exists for the loaded week:

- a bay assigned to the covering associate shows the permanent owner and “Covering this week”
- a bay assigned to someone else keeps that assignee and names the cover separately
- a week with no cover looks the same as before

---

## 10. Rollback

Redeploy prior production tip **`e5c22c5`**. No schema rollback. Assignments, ownership, coverage, standing capacity, and AUTO-008 are unchanged, so a rollback restores the previous This Week labels only. OPS-OVERVIEW-002 remains in that tip.

---

## 11. Verdict

**GO.** Production alias serves `22aa4ff`. Operational fingerprint, ownership, coverage, standing capacity, and AUTO-008 match the pre-release read. Phone acceptance remains outstanding.
