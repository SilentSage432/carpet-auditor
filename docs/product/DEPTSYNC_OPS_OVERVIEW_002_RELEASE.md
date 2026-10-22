# DEPTSYNC-OPS-OVERVIEW-002 — Controlled Production Release

**Status:** **RELEASED** (engineering) — **operator phone acceptance outstanding**  
**Date:** 2026-10-22  
**Mode:** PREFLIGHT → VALIDATE → RELEASE → VERIFY  
**Application:** https://deptsync-hub.vercel.app  
**Supabase:** `fmeinlwhixngednabhgy`  
**Store:** 2587 · Flooring / Home Decor  

**Authority:** Operator-authorized OPS-OVERVIEW-002 production release. Implementation `154a8c2` plus the week-scoped label correction `4c29cf6`. ALIGN-002 reconciliation docs already in that history. AUTO-008 remains enabled. No phone acceptance required before deploy.

**Verdict:** **GO** for the engineering release. Phone acceptance of the new Overview attention is still outstanding.

**Strict exclusions honored:** No migrations. No assignment, roster, ownership, coverage, standing-capacity, or publication writes. No AUTO-008 or cron change. No manual W44 publication. Unrelated untracked docs left uncommitted.

---

## 1. Release summary

Overview now shows two additional read-only attention items, and supervisors can open Automatic Rotation from Overview.

| Item | Value |
|------|-------|
| App commit | **`4c29cf6`** (`4c29cf6ebdad5f4f44c3fc6d42268b69d0f88fe9`) |
| Implementation commit | **`154a8c2`** (`154a8c2f1d6f3401b6c4c066519e06ccf107f3f9`) |
| Prior `origin/main` | **`233f7da`** |
| Migrations | **None** |
| AUTO-008 latch | Remains **`WEEKLY_ROTATION_AUTO_PUBLISH = true`** |
| Cron | Unchanged **`0 12 * * 0`** |
| Standing policy | **`d8bd92ca-97d0-42ac-9126-b6ba2a16f561`** v1 · **3/3/3/3 = 12** |

The label correction is part of the app commit. The first wording, “is called out,” could be read as absence today. Shipped copy: “{Name} has a call-out this week and still owns {n} bay(s).”

---

## 2. Isolation

| Check | Result |
|-------|--------|
| Push | `233f7da..4c29cf6` → `origin/main` |
| Included | Overview attention, tests, ALIGN-002 reconciliation, journal/handoff/roadmap, week-scoped label |
| Migrations / latch / cron / capacity | **None** in the diff |
| Left uncommitted | `DEPTSYNC_RD_6_PRODUCT_COMPLETION_AUDIT.md`, `DEPTSYNC_SEC_OPS_010A_VERCEL_AUTH_RECOVERY.md`, `DEPTSYNC_SPECIALTY_OPS_001_DISCOVERY.md`, `tmp/` |

---

## 3. Behavior review

| Rule | Result |
|------|--------|
| Call-out only with unverified assigned bays in the operational week | Composer requires `is_call_out`, a date inside `isoWeekCalendarRange(assigned_week)`, and `lifecycle !== "verified"`. A call-out with no owed bays is omitted. |
| Label does not say the associate is absent today | Shipped label names “this week.” |
| Sent-back while correction is still required | Assigned, `verification_status` resolves to `PENDING`, and `review_note` is non-empty. |
| Re-reported bays stay in awaiting verification | Re-report sets `PENDING_VERIFICATION` and `review_note: null` in one update. |
| Verified bays excluded | Verify sets `VERIFIED_COMPLETE` and `review_note: null`. Call-out owed-bay check also drops `verified`. |
| Existing attention | No plan, unowned, awaiting verification, barriers, and overdue follow-ups unchanged. Covered by `ops-overview-001`. |
| Automatic Rotation | `supervisorManageHref("rotation")` → `/settings?manage=rotation`. Shown only when `canAccessSupervisorManageView("rotation", specialist)` is true (Supervisor and MasterAdmin). |
| Attention navigation | Call-out and sent-back items link to `/dashboard`. |
| No mutation | Overview compose and tab are read-only. No call to redistribute, send-back, verify, or publish. |

### Send-back note versus historical coaching notes

The live signal is reliable enough to ship.

`weekly_rotations.review_note` is set to a non-null value only by `sendBackWeeklyRotation`, and only when the row moves from `PENDING_VERIFICATION` to `PENDING`. Re-report and verify clear that column in the same update that changes status. Historical coaching notes stay on `weekly_rotation_completion_attempts.review_note`. Overview does not read that table. ZebraChecklist already treats the rotation column as the current “Send back” text.

Production read at preflight: **0** `PENDING` rotation rows with a non-empty `review_note`.

Residual limitation, recorded and accepted for this release: there is no separate “current send-back” flag. Any assigned `PENDING` row with a non-empty `review_note` is shown. Application code produces that pair only through send-back. A note written outside those functions, including a manual edit, would look like a send-back until status leaves `PENDING`.

---

## 4. Test results

| Suite | Result |
|-------|--------|
| `ops-overview-002` + `ops-overview-001` + `section-ownership-005.focused-nav` | **33 PASS** |
| `sec-ops-010.authz` + `auth-harden-001` + `operational-sections.authz` | **59 PASS** |
| TypeScript | **PASS** |
| ESLint (overview, 002 test, focused-nav test) | **PASS** |
| `next build` | **PASS** (Next.js 16.2.12, 91 pages) |

Store and department scope remain on `GET /api/weekly-rotations` (`requireStoreOpsActor`, `resolveScopedDepartmentId`). Call-out rows are tagged with the signed-in store number and dropped on mismatch. Unauthorized API reads return **401**.

---

## 5. Deployment evidence

| Field | Value |
|-------|--------|
| Push | `233f7da..4c29cf6` → `origin/main` |
| GitHub Production deployment | **`7263510688`** — state **success** |
| Vercel commit status | **success** — “Deployment has completed” |
| Vercel deployment | **`dpl_zvUkEmeVkvEHyC1GMwe5qhjVT3FS`** — target **production** — **Ready** |
| Deployment host | https://deptsync-9ky4eq1qp-tyson-zauggs-projects.vercel.app |
| Alias | https://deptsync-hub.vercel.app |
| Dashboard | https://vercel.com/tyson-zauggs-projects/deptsync-hub/zvUkEmeVkvEHyC1GMwe5qhjVT3FS |

The deployment host is behind Vercel Authentication. The production alias is the public surface and is attached to this deployment.

Unauthenticated alias smoke (redirects not followed):

| Path | Result |
|------|--------|
| `/login` | **200** |
| `/overview` | **307** → `/login?next=%2Foverview` |
| `/settings?manage=rotation` | **307** → login |
| `/dashboard` | **307** → login |
| `/api/weekly-rotations` | **401** |
| `/api/shift-days` | **401** |
| `/api/cron/weekly-rotation` | **401** |

Signed-in Overview, the Automatic Rotation click, and attention navigation on This Week were not exercised. They require an operator session.

---

## 6. Operational preservation

Pre → `tmp/ops-overview-002-preflight.json` · Post → `tmp/ops-overview-002-post.json`  
Fingerprint recipe: `store|department|week_starting|bay_id|roster|status|locked` with locked as `0`/`1`, SHA-256 truncated to 16 hex characters. That recipe reproduces the SO-005 fingerprint.

| Fact | Pre | Post |
|------|-----|------|
| Assignment fingerprint | `55dde8e86360caea` | `55dde8e86360caea` |
| Sunday bay assignments | 30 (12 / 12 / 6 on 2026-09-21, 2026-09-28, 2026-10-05) | identical |
| W43 / W44 assignment rows | 0 / 0 | 0 / 0 |
| W44 `weekly_rotations` | 0 | 0 |
| Active sections × members | 4 × 160 | 4 × 160 |
| Coverage rows | 0 | 0 |
| Standing | Nate/Nick/Tracy/Tyson 3/3/3/3, policy v1 `d8bd92ca-97d0-42ac-9126-b6ba2a16f561` | identical |
| W44 weekly approvals | 0 | 0 |
| AUTO-008 source latch | `true` | `true` (file not in the diff) |
| Cron | `0 12 * * 0` | unchanged (file not in the diff) |

Permanent owners, unchanged by this release:

| Section | Owner | Active |
|---------|-------|--------|
| CSA | Tyson | yes |
| Myself | Tyson | yes |
| Section A | Nick | no |
| Specialist-A | Nick | yes |
| Specialist-B | Tracy | yes |

The 2026-10-20 SO-005 snapshot recorded CSA’s permanent owner as Nate. The live owner at this preflight was already Tyson. This release did not change it.

W43 weekly approvals at preflight were Nate 0, Nick 3, Tracy 3, Tyson 3 (sum 9). Standing capacity remains 3/3/3/3. Those weekly approvals were not modified.

No manual W44 publication. First AUTO-008 cron remains **2026-10-25T12:00Z → 2026-W44** and is still unverified. The production env secret was not read or changed.

---

## 7. Authorization

| Check | Result |
|-------|--------|
| Supervisor / MasterAdmin rotation link | `canAccessSupervisorManageView("rotation")` true for both; false for Associate |
| Existing auth boundaries | Authz suites **59 PASS**. Alias smoke matches the prior 307 / 401 boundary |
| Signed-in Overview | **Not performed** — no operator session |

---

## 8. Phone acceptance

Outstanding. An operator still needs to confirm, on a signed-in phone:

- a call-out this week appears only while that associate still owns unverified bays
- the label reads as this week, not “absent today”
- a sent-back bay appears, and leaves that item after it is re-reported or verified
- Automatic Rotation opens `/settings?manage=rotation`
- the new items open This Week

---

## 9. Rollback

Redeploy prior production tip **`233f7da`**. No schema rollback. Assignments, ownership, coverage, standing capacity, and AUTO-008 are unchanged, so a rollback restores the previous Overview only.

---

## 10. Verdict

**GO.** Production alias serves `4c29cf6`. Operational fingerprint and AUTO-008 configuration match the pre-release read. Phone acceptance remains outstanding.
