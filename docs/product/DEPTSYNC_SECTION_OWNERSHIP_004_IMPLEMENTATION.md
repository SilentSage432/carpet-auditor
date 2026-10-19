# DEPTSYNC-SECTION-OWNERSHIP-004 — Schedule-Free Supervisor Experience

**Status:** COMPLETE LOCALLY — **not pushed / not deployed**  
**Date:** 2026-10-19  
**Mode:** DISCOVER → IMPLEMENT → VALIDATE  
**Application baseline:** SECTION-OWNERSHIP-002 + 003 released · AUTO-008 enabled · standing 3/3/3/3  

**Strict exclusions honored:** No production push/deploy · no migrations · no W44 publish · no AUTO-008/cron/standing mutation · no new publisher · no specialty / Orient.

---

## 1. Existing workflow discovered

Supervisor mobile nav: Overview · Map · This Week · Walkthroughs · More.

| Capability | Prior entry |
|------------|-------------|
| Roster lifecycle (add / deactivate / reactivate) | More → Team → MasterAdmin `RosterLifecyclePanel` |
| Everyday people + shifts | More → Team → Open Team → `/roster` |
| Permanent ownership | More → Department Setup → Operational Sections |
| Temporary weekly coverage | Nested inside section detail |
| Standing capacity | Sunday recovery drawer only (MasterAdmin) |
| Weekly rotation evidence | This Week |
| AUTO-008 latch / readiness | No dedicated supervisor surface |

Shifts were still loud in Team copy and People header despite AUTO-005A / 002 / 003 proving they are not required for rotation, eligibility, ownership, coverage, or standing capacity.

---

## 2. Friction identified

1. Dual people UIs (lifecycle vs schedule board) with schedules presented as primary.  
2. Coverage buried under Department Setup → accordion → section detail.  
3. Conflicting “schedules matter / don’t matter” copy.  
4. No coherent Team → ownership → coverage → rotation orientation.  
5. Overview “Open Team in More” linked to `/roster` (wrong place).  
6. Permanent vs temporary ownership labels easy to conflate.  
7. No rotation status composed from existing latch / standing / published counts.

---

## 3. Changes implemented

| Change | Detail |
|--------|--------|
| `SupervisorOwnershipWorkflowCard` | More-first orientation: Team → permanent ownership → temporary coverage → This Week; rotation status from latch + standing (MasterAdmin) + published count |
| `supervisor-ownership-workflow.ts` | Pure composition helpers + capacity explainer copy |
| More → Team | Schedule-free lifecycle primary; schedules demoted under **Optional schedules** disclosure |
| Operational Sections | Permanent owner label; temporary coverage capacity explainer; list-week coverage badges |
| Roster lifecycle | Shows Owns / Covering annotations from existing sections + coverage APIs |
| People (`/roster`) | Header no longer leads with “Schedule & availability” |
| Overview | Team CTA → `/settings#team` |
| This Week summary | Clarifies counts are authoritative evidence, not simulated plans |

No backend ownership model redesign. No new RPCs. No migrations.

---

## 4. Navigation adjustments

```
More
  ├─ Supervisor workflow card (new orientation)
  ├─ Team
  │    ├─ Roster lifecycle (MasterAdmin)
  │    └─ Optional schedules → /roster
  └─ Department Setup → Operational Sections
       ├─ Permanent owner
       └─ Temporary weekly coverage

This Week → published rotation evidence
```

Deep links: `#team`, `#operational-sections` (existing).

---

## 5. Shift UI disposition

| Surface | Disposition |
|---------|-------------|
| More → Team primary chrome | Demoted — schedules secondary |
| `/roster` schedule board | Kept (historical + optional availability); not deleted |
| Shift APIs / tables | Untouched |
| Sunday shift chips | Untouched (already non-gating copy) |

Supervisors are no longer prompted to enter shifts to manage rotation from More.

---

## 6. Mobile experience

- Touch-sized workflow buttons (`min-h-11`)  
- Coverage week inputs remain full-width mono fields  
- Capacity explainer: *Coverage changes which sections an associate can receive bays from. It does not increase their weekly assignment capacity.*  
- Confirm dialog for published-week coverage ack preserved  
- Loading / error states on workflow status and lifecycle  

No large visual redesign; existing design tokens retained.

---

## 7. Authorization preservation

| Rule | Status |
|------|--------|
| MasterAdmin-only lifecycle mutations | Preserved |
| Supervisor section / coverage manage | Preserved (`canManageOperationalSections`) |
| Standing capacity GET MasterAdmin | Preserved — supervisors see honest “visible to MasterAdmin” line |
| Published-week `acknowledge_published_week` | Preserved |
| AUTO-008 latch / cron / standing policy | Untouched |

---

## 8. Rotation compatibility

Workflow status uses:

- `WEEKLY_ROTATION_AUTO_PUBLISH` (configured on/off)  
- Standing policy (MasterAdmin)  
- Staging week label  
- Published assignment count for that week when loadable  

Does **not** invent failed/blocked publication states without evidence. Does not duplicate the AUTO-008 publisher.

---

## 9. Tests and build

| Gate | Result |
|------|--------|
| SECTION-OWNERSHIP-004 | **10 PASS** |
| 002 + 003 + AUTO-008 regressions (focused) | **183 PASS** total across 12 files |
| TypeScript | **PASS** |
| ESLint (new 004 domain + workflow card) | **PASS** |
| Production build | **PASS** |

Pre-existing `set-state-in-effect` eslint findings in Settings / OperationalSections panels remain unchanged and were not expanded as release blockers for this UX tranche.

---

## 10. Remaining limitations

1. Supervisors still cannot run roster lifecycle mutations (by design / auth).  
2. Standing capacity establish UI remains in Sunday drawer (not relocated this tranche).  
3. Coverage still edited inside a section detail — list now shows cover badges + week, but detail remains the write surface.  
4. Mobile phone acceptance of 003/004 UX still required before production release of this tranche.  
5. First AUTO-008 unattended publication (**2026-10-25T12:00Z → W44**) remains the production proof milestone.

---

## 11. Release boundary

Implemented and validated **locally**. Commit expected on local `main`.

**Do not** push, deploy, migrate, publish W44, or change AUTO-008 activation from this tranche.
