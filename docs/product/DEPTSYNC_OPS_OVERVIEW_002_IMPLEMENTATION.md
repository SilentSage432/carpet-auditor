# DEPTSYNC-OPS-OVERVIEW-002 — Operational Attention Completeness

**Status:** COMPLETE locally — **not pushed, not deployed**  
**Date:** 2026-10-20  
**Mode:** Implement → test → local validation  
**Scope:** [`DEPTSYNC_ALIGN_002_REDESIGN_RECONCILIATION.md`](./DEPTSYNC_ALIGN_002_REDESIGN_RECONCILIATION.md) tranche OPS-OVERVIEW-002  
**Prior surface:** [`DEPTSYNC_OPS_OVERVIEW_001_IMPLEMENTATION.md`](./DEPTSYNC_OPS_OVERVIEW_001_IMPLEMENTATION.md)

No migrations. No production data writes. AUTO-008 latch, cron, standing capacity, coverage, and section ownership were not modified.

---

## 1. Existing data sources reused

| Fact | Source | How Overview reads it |
|------|--------|------------------------|
| Current operational week and assigned bays | `GET /api/weekly-rotations` via `fetchThisWeekRotations` | Already loaded. Store and department scope stay on that route (`requireStoreOpsActor`, `resolveScopedDepartmentId`). |
| Who owns each bay | `sunday_bay_assignments` via `fetchSundayAssignments` | Already composed by `composeThisWeekOwnership`. |
| Send-back still needing correction | `weekly_rotations.verification_status` + `review_note` | `sendBackWeeklyRotation` sets `PENDING` and the coaching note. Re-report sets `PENDING_VERIFICATION` and clears the note. Verify sets `VERIFIED_COMPLETE` and clears the note. The week payload already selects `review_note`. |
| Call-out | `associate_shift_days.is_call_out` | `fetchShiftDaysRange` for `isoWeekCalendarRange(assigned_week)`, filtered by store number. |
| Rotation management | `/settings?manage=rotation` | `supervisorManageHref("rotation")`. The focused panel still owns status. |
| Existing attention | `composeOverviewAttention` | No plan, unowned, awaiting verification, barriers, overdue follow-ups. Unchanged. |

No new status column. Completion-attempt history (`SENT_BACK` rows) is the audit trail. The live “still needs correction” signal is the rotation row, because a later re-report or verify leaves the old attempt in place on purpose.

---

## 2. Attention selection rules

### Called out, still owning work

An item is added when all of these are true:

1. The shift row has `is_call_out === true`.
2. `work_date` is one of the seven dates of the plan’s operational week.
3. The row’s store number matches the signed-in store when a store number is present.
4. That associate owns at least one bay on the current plan that is not verified.
5. When a department id list is supplied, only bays in that list count. Overview does not pass one, because the weekly-rotations API already scoped the plan.

One item per associate. Several call-out days in the same week do not create several items. Verified bays are not counted. A call-out with no owned bays is omitted. A call-out outside the week is omitted. Missing week dates or a failed call-out read produce no call-out items, and the screen says call-outs are unavailable rather than zero.

Label: “{Name} is called out and still owns {n} bay(s).”  
Detail names the bays and says ownership stays until someone reassigns on This Week.  
Link: `/dashboard`. One bay also links to Map.

Nothing is reassigned. A call-out is not a roster deactivation.

### Sent back for correction

An item is added for assigned bays where `resolveVerificationStatus` is `PENDING` and `review_note` is non-empty.

Omitted when:

- The bay is unassigned (the existing unowned item covers that).
- Status is `PENDING_VERIFICATION` (the existing awaiting-verification item covers that).
- Status is `VERIFIED_COMPLETE`, even if an old note is still on the row.

One item lists the bay tags. Link: `/dashboard`, which is the existing correction workflow. A single bay also links to Map.

A bay can appear here and in the barrier count. Those are different facts. It does not also appear as awaiting verification.

### Automatic Rotation

Supervisors and MasterAdmin see **Automatic Rotation**, which navigates to `/settings?manage=rotation`. Associates do not (`canAccessSupervisorManageView`). The link does not read the latch, standing capacity, or published counts.

---

## 3. UI changes

`OverviewTab` keeps the existing week strip, attention list, priorities, people, and follow-ups.

- Call-out and sent-back rows use the same attention row as the other categories.
- “Week on track” stays quiet only when attention is empty and neither follow-ups nor call-outs failed to load.
- A failed call-out read shows “Call-outs unavailable — not shown as zero.”
- Primary actions gain the Automatic Rotation link under This Week, Map, and Walkthroughs.

---

## 4. Navigation

| Item | Destination |
|------|-------------|
| Call-out | `/dashboard` (This Week). Map when exactly one owed bay. |
| Sent back | `/dashboard`. Map when exactly one bay. |
| Automatic Rotation | `/settings?manage=rotation` |

---

## 5. Test evidence

`npx vitest run lib/store-ops/ops-overview-002.command.test.ts lib/store-ops/ops-overview-001.command.test.ts`

**22 PASS** (13 new, 9 existing).

Covered:

- Called-out associate with an owned bay.
- Called-out associate with no owned bays.
- Call-out date outside the operational week.
- Two owed bays, a third verified bay excluded, two call-out days collapsed to one item.
- Other store and other department excluded.
- Missing week range, null call-out rows, and a null plan.
- Two sent-back bays, with bay tags, and no verify item.
- Re-reported bay stays in awaiting verification only.
- Verified bay with a leftover note is not sent-back attention.
- Unassigned note stays in the unowned category.
- Original kinds remain no-plan’s siblings: unowned, verify, barrier.
- Rotation href is `/settings?manage=rotation` and Overview does not recompute publication.
- `requireStoreOpsActor(null)` throws 401. The rotations route still scopes department. Shift reads still filter `storeKeys`.
- Composer and Overview contain no assignment, send-back, or complete writes. Latch remains `true`. Cron remains `0 12 * * 0`.

`npx tsc --noEmit` PASS.  
ESLint on `overview-command.ts`, `OverviewTab.tsx`, and the new test PASS.  
`npm run build` PASS (Next.js 16.2.12).

Signed-in Overview was not exercised in a browser. Production does not have this change, and local Overview requires an operator session.

---

## 6. Authorization boundaries

- Week evidence still enters through `requireStoreOpsActor` on `/api/weekly-rotations`.
- Department scope remains `resolveScopedDepartmentId` on that route. The composer can drop other department ids when a caller passes them.
- Call-out rows are read with the existing store-number filter in `fetchShiftDaysRange`. The composer drops a row whose store number does not match.
- The rotation link is hidden unless `canAccessSupervisorManageView("rotation")` is true. The settings page still enforces that view.
- This tranche adds no route and no write.

---

## 7. Remaining limitations

- A call-out on any day of the operational week counts, including a day that is not today. There is no separate “called out right now” flag.
- Send-back attention follows the current rotation row, not a scan of historical `SENT_BACK` attempts. That is what makes corrected work disappear. A `PENDING` row with a note that was not produced by send-back would look the same; send-back is the only writer of that note.
- Overview does not pass an extra department filter. It trusts the weekly-rotations response.
- A barrier and a send-back on the same bay both show. They are not merged.
- Standing capacity and publication status stay on the Automatic Rotation view. This tranche only links there.
- Phone acceptance is not done. Release is not authorized.

---

## 8. Release readiness

**CONDITIONAL GO** for a later controlled app-only release.

| Gate | Result |
|------|--------|
| Behavior implemented | Yes |
| Migrations | None |
| Production writes | None |
| AUTO-008 / cron / standing 3/3/3/3 | Untouched |
| Tests, tsc, ESLint, build | PASS |
| Push / deploy | **Not done** |

Do not push or deploy from this tranche until release authorization.
