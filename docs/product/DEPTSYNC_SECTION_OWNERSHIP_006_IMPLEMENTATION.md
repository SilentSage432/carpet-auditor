# DEPTSYNC-SECTION-OWNERSHIP-006 — Temporary Coverage Visibility on This Week

**Status:** COMPLETE — released in [`DEPTSYNC_SECTION_OWNERSHIP_006_RELEASE.md`](./DEPTSYNC_SECTION_OWNERSHIP_006_RELEASE.md) (`22aa4ff`)  
**Date:** 2026-10-22  
**Mode:** Implement → test → local validation  
**Scope:** Cover versus permanent-owner label on This Week  
**Prior:** [`DEPTSYNC_SECTION_OWNERSHIP_003_IMPLEMENTATION.md`](./DEPTSYNC_SECTION_OWNERSHIP_003_IMPLEMENTATION.md) · [`DEPTSYNC_ALIGN_002_REDESIGN_RECONCILIATION.md`](./DEPTSYNC_ALIGN_002_REDESIGN_RECONCILIATION.md)

No migrations. No assignment, ownership, capacity, publication, or coverage writes. AUTO-008 latch and cron are unchanged.

---

## 1. Data sources

| Fact | Source | How This Week uses it |
|------|--------|------------------------|
| Assigned associate | `sunday_bay_assignments` via `fetchSundayAssignments` | Existing owner card. Coverage never selects this person. |
| Permanent section owner | `operational_sections.primary_owner_specialist_id` through `indexBaySectionLookups` | Left on `bay.section`. Not passed through `applyWeekCoverageToBaySectionLookups`, which would replace the owner id used by the publisher. |
| Temporary cover | `GET /api/section-week-coverage?week_label=` → `listActiveSectionWeekCoverage` | Active row for the plan’s `assigned_week` only (`revoked_at` is null). |
| Week | `GET /api/weekly-rotations` `assigned_week` | The same label is sent to the coverage read. A mismatched or failed read withholds cover labels. |

Store scope stays on the coverage route (`resolveStoreByNumber` of the signed-in actor, then `store_id`). Department scope stays on the bay’s section lookup. A cover for another section does not label this bay.

---

## 2. Display semantics

Three facts stay separate.

| Concept | Meaning on the bay |
|---------|--------------------|
| Assigned associate | The persisted Sunday assignment. |
| Permanent section owner | Current `primary_owner` of the bay’s Operational Section. |
| Temporary covering associate | `covering_specialist_id` on the active coverage row for this section and this week. |

| Situation | What the bay shows |
|-----------|--------------------|
| No active coverage for that section and week | Existing “Assigned this week” and “Section · steward” lines. No extra label. |
| Assigned associate is the covering associate, and that person is not already the permanent owner | “Assigned to {name}”, “Permanent owner {name}”, “Covering this week”. The steward suffix is omitted so it does not compete with the permanent-owner line. |
| Coverage exists and the assignee is someone else | “Assigned to {assignee}”, “Permanent owner {name}” when the name is known, and “{cover} covering this week”. The assignee is not called the covering associate. |
| Bay is unowned | Stays unowned. Coverage does not assign it. |
| Cover id equals the permanent owner id | No cover label. The row does not describe a distinct temporary relationship. |
| Two active rows for one section, or a cover with no name when the assignee is someone else | Label withheld. The assignment and permanent owner id are left as stored. |
| Permanent owner name missing while the assignee is the cover | “Permanent owner unavailable”. No invented name. |
| Coverage fetch failed, or the returned week label does not match the plan | No cover label. |

---

## 3. UI

`ThisWeekOwnershipBoard` bay rows gain those lines only when `temporaryCoverageLines` returns them. Map, Zebra, completion, and downstock actions are unchanged. The people-to-bays layout is unchanged.

`FloorTab` loads coverage with the existing client `fetchSectionWeekCoverage` after the plan week is known. It does not call establish or revoke.

---

## 4. Historical-week limitations

Coverage rows are stored per `week_label`. The composer ignores rows for any other week, so a later week’s cover does not relabel an older plan week.

The current read cannot fully reconstruct history:

- `listActiveSectionWeekCoverage` returns only rows with `revoked_at` null. After a cover is revoked, This Week cannot show that the section was covered.
- Permanent owner is the section’s current `primary_owner`. `operational_section_events` records owner changes, but not which owner was in place for a given operational week. This Week does not guess a past owner from that log.
- This Week loads the week returned by weekly rotations. It does not add a historical-week browser.

---

## 5. Tests

| Suite | Result |
|-------|--------|
| `section-ownership-006.coverage-label` | **11 PASS** |
| `section-ownership-003` week coverage + equivalence | **16 PASS** |
| `section-ownership-004` supervisor workflow | **10 PASS** |
| `section-ownership-005` focused nav | **11 PASS** |
| `rotation-auto-008a` standing capacity | **19 PASS** |
| `ux-reduce-002` + `rd4` This Week | **13 PASS** |
| `sec-ops-010.authz` + `operational-sections.authz` | **31 PASS** |
| TypeScript | **PASS** (production build typecheck) |
| ESLint on the touched files | **PASS** |
| `next build` | **PASS** |

Capacity check in the new suite: Tracy owning Section D and covering Section B still previews **3** bays total across 2 sections, not 3 per section. `previewCoverageCapacityImpact` was not changed.

---

## 6. Authorization

| Check | Result |
|-------|--------|
| Coverage GET | Existing `requireStoreOpsActor` (401 when absent) and store resolution |
| Coverage POST and DELETE | Existing `requireSupervisorOrAdmin` |
| This Week | Still the signed-in store’s plan. No new roster fields. |
| MasterAdmin | Still excluded from the unassigned coordination roster. Not used as a cover by the existing establish path. |

---

## 7. Invariants preserved

- AUTO-008 latch remains `WEEKLY_ROTATION_AUTO_PUBLISH = true`.
- Cron remains `0 12 * * 0`.
- Standing capacity, the assignment resolver, and the publication RPC are untouched.
- Permanent ownership writes and coverage writes are untouched.
- Verification and Zebra state are untouched.
- No migration.

---

## 8. Release readiness

Released. See [`DEPTSYNC_SECTION_OWNERSHIP_006_RELEASE.md`](./DEPTSYNC_SECTION_OWNERSHIP_006_RELEASE.md). Phone acceptance of the cover lines is still outstanding. A signed-in This Week session was not part of this implementation note.
