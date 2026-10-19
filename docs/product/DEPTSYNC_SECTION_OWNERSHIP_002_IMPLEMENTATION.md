# DEPTSYNC-SECTION-OWNERSHIP-002 — Associate Roster Lifecycle

**Status:** COMPLETE locally — **RELEASED** via [`DEPTSYNC_SECTION_OWNERSHIP_002_RELEASE.md`](DEPTSYNC_SECTION_OWNERSHIP_002_RELEASE.md) (`b03c15a`)  
**Date:** 2026-10-18 (impl) · 2026-10-19 (release)  
**Mode:** Production release (002 only; 003 excluded)  
**Canonical discovery:** [`DEPTSYNC_SECTION_OWNERSHIP_001_DISCOVERY.md`](DEPTSYNC_SECTION_OWNERSHIP_001_DISCOVERY.md)

**Strict exclusions honored at impl:** No production associate/section/assignment writes · standing capacity unchanged · AUTO-008 left enabled · cron unchanged · no temporary weekly coverage · no specialty · no Orient.

**Automation note:** AUTO-008 first unattended publication **2026-10-25T12:00:00Z → 2026-W44** remains independently pending; this release does not claim that milestone.

---

## 1. Current architecture reused

| Capability | Reuse |
|------------|-------|
| Identity | `store_specialists` only — no parallel people table |
| Add | Existing `createRosterMember` + `POST /api/roster/members` (MasterAdmin) |
| Soft archive semantics | `is_active=false` + `status=suspended` (same as CLEANUP-002) |
| Permanent ownership transfer | `updateOperationalSection` + `owner_changed` events |
| Auth | `requireSuperAdmin` (matches `canManageTeamRoster`) |
| Eligibility | Existing `.eq("is_active", true)` on Sunday / standing materialization |
| Standing capacity | Untouched; inactive associates drop out of eligible set automatically |

---

## 2. Files changed

| Path | Role |
|------|------|
| `lib/store-ops/roster-lifecycle.ts` | Domain: impact planner, deactivate, reactivate, list |
| `app/api/roster/lifecycle/route.ts` | GET active/inactive |
| `app/api/roster/lifecycle/[id]/route.ts` | GET impact · POST deactivate/reactivate |
| `lib/store-ops/client.ts` | Client helpers |
| `app/api/roster/members/route.ts` | Add defaults `onDuty: false` (schedule-free) |
| `components/admin/RosterLifecyclePanel.tsx` | Mobile MasterAdmin UI |
| `components/sections/SettingsSection.tsx` | Mount panel under More → Team |
| `lib/store-ops/section-ownership-002.roster-lifecycle.test.ts` | Focused contracts |
| This report + journal / handoff / roadmap | Documentation |

---

## 3. Schema changes

**None.** Soft flags and ownership columns already exist.

---

## 4. Roster lifecycle behavior

### Add

- MasterAdmin creates Associate via existing roster insert.
- Active immediately; **no** automatic section ownership.
- **No** standing capacity change (toast reminds MasterAdmin to authorize capacity separately).
- **No** required shift schedule (`onDuty: false`).

### Deactivate

1. Load impact: owned sections, open SBA rows, standing policy item (if any).  
2. **Block** if MasterAdmin.  
3. **Block** if any permanent section ownership lacks a replacement owner transfer.  
4. Apply transfers via `updateOperationalSection` (provenanced).  
5. Soft-deactivate (`is_active=false`, `status=suspended`).  
6. **Do not** auto-reassign open work; warn only.  
7. **Do not** rewrite standing policy rows; warn that MasterAdmin should update standing when ready.

### Reactivate

- Set `is_active=true`, `status=active`.  
- Same identity row.  
- **Does not** reclaim prior section ownership or assignments.  
- **Does not** modify standing capacity.

---

## 5. Authentication and authorization

| Action | Gate |
|--------|------|
| List / impact / deactivate / reactivate | `requireSuperAdmin` |
| Add associate | Existing `requireSuperAdmin` on `POST /api/roster/members` |
| Privilege escalation via body | Rejected (store from actor; MasterAdmin cannot be deactivated) |

No parallel auth system. RLS not bypassed — writes use service role after API auth (same pattern as sections/cleanup).

---

## 6. Ownership transition behavior

If the associate owns active Operational Sections, deactivation requires explicit `transfers[]` mapping each `section_id` → active `new_owner_specialist_id` in-store. Otherwise API returns **409** with impact payload and clear block reasons — preventing AUTO-008 from staging against ownerless sections.

---

## 7. Standing capacity interaction

- Add: standing policy unchanged.  
- Deactivate: policy rows may still list the associate; materialization already filters `is_active=true` workforce.  
- Reactivate: no silent re-entry into standing until MasterAdmin re-establishes/updates policy.

---

## 8. Historical preservation

Soft-deactivate only. No hard DELETE in lifecycle paths. Open and closed `sunday_bay_assignments` / rotation attribution remain.

---

## 9. Mobile UI

**More → Team → Roster lifecycle** (MasterAdmin):

- Add associate (name + department)  
- Active list → Deactivate (impact dialog + ownership transfer selects)  
- Inactive list → Reactivate  
- No shift calendars

---

## 10. Test evidence

| Suite | Result |
|-------|--------|
| `section-ownership-002.roster-lifecycle.test.ts` | **10 PASS** |
| AUTO-008A standing | **19 PASS** |
| AUTO-005A shift independence | **8 PASS** |
| SEC-OPS-010 authz | **20 PASS** |
| AUTO-006 activation readiness | **27 PASS** |
| Focused batch | **84 PASS** |
| `npx tsc --noEmit` | **PASS** |
| ESLint (new/core changed files) | **PASS** (0 errors) |
| `npm run build` | **PASS** |

Pre-existing SettingsSection `set-state-in-effect` warnings unchanged (out of scope).

---

## 11. Remaining limitations

1. MasterAdmin-only management (not department Supervisor) — matches existing `canManageTeamRoster`.  
2. Standing policy cleanup after deactivate is manual MasterAdmin action.  
3. Temporary weekly coverage **not** implemented (SECTION-OWNERSHIP-003 later).  
4. Production release blocked until AUTO-008 W44 acceptance.  
5. Legacy `deleteSpecialist` hard-delete path still exists elsewhere — lifecycle UI uses soft path only.

---

## 12. Production release prerequisites

1. AUTO-008 **FIRST SCHEDULED PUBLICATION VERIFIED** for **2026-W44**.  
2. Operator authorization for app deploy (no migration).  
3. Phone acceptance of Roster lifecycle panel.  
4. Confirm standing 3/3/3/3 still intended after any roster churn.

---

## GO / NO-GO

| Decision | Verdict |
|----------|---------|
| Local implementation | **GO** |
| Production deploy now | **NO-GO** (hold for W44 acceptance) |
| Temporary coverage / specialty / Orient | **NO-GO** |

**STOP AFTER REPORT.**
