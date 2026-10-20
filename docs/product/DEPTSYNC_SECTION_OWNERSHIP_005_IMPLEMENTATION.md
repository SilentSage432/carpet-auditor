# DEPTSYNC-SECTION-OWNERSHIP-005 — Focused Supervisor Navigation

**Status:** **COMPLETE LOCALLY** — not pushed / not deployed  
**Date:** 2026-10-19  
**Mode:** DISCOVER → IMPLEMENT → VALIDATE → COMMIT LOCALLY  
**Baseline:** SECTION-OWNERSHIP-004 production `d778eac`  

---

## 1. Original UX problem

SECTION-OWNERSHIP-004 added management cards with an **Open** action. On production, Open only scrolled the More page to `#team` / `#operational-sections`. That is not an open interaction — operators expected a focused management experience.

Renaming Open to “Jump To” was rejected. The interaction itself had to change.

---

## 2. Existing component discovery

| Surface | Owner component | Notes |
|---------|-----------------|-------|
| More hub | `SettingsSection` | Already mount point for workflow card + Team + Sections |
| Workflow cards | `SupervisorOwnershipWorkflowCard` | Open handlers scrolled via `scrollIntoView` / accordion |
| Team / roster | `RosterLifecyclePanel` | Reused unchanged |
| Ownership + coverage | `OperationalSectionsPanel` | Same panel; coverage week UI already present |
| Rotation status | 004 composition helpers | Extracted presentation into `SupervisorRotationStatusPanel` |
| Optional schedules | Team disclosure → `/roster` | Preserved |
| Auth | `canManageOperationalSections` / MasterAdmin | Unchanged; server APIs remain authoritative |
| Preview guard | `lib/preview-safety.ts` | Unchanged; still `VERCEL_ENV=preview` only |

No new business logic, APIs, or ownership calculations.

---

## 3. Navigation architecture

**Selected:** URL query on existing `/settings` route:

| View | URL |
|------|-----|
| Hub | `/settings` |
| Team | `/settings?manage=team` |
| Section Ownership | `/settings?manage=ownership` |
| Weekly Coverage | `/settings?manage=coverage` |
| Automatic Rotation | `/settings?manage=rotation` |

Helpers: `lib/store-ops/supervisor-management-nav.ts`

**Why not a new router framework:** More already lives under the workflow shell; query params give refreshable deep links and predictable browser Back without new routes or parallel state.

**Legacy hashes:** `#team`, `#operational-sections`, `#sections`, `#coverage`, etc. replace into the matching `?manage=` view (no scroll-as-Open).

---

## 4. Focused views implemented

| View | Content |
|------|---------|
| Team | `RosterLifecyclePanel` (MasterAdmin) + optional schedules disclosure |
| Section Ownership | `OperationalSectionsPanel` with `emphasis="ownership"` |
| Weekly Coverage | Same panel with `emphasis="coverage"` + capacity explainer banner |
| Automatic Rotation | `SupervisorRotationStatusPanel` (status + This Week + MasterAdmin Sunday link) |

Shell: `SupervisorFocusedManagementView` — title, subtitle, **Back to More**.

---

## 5. Mobile navigation behavior

- Open → `router.push(/settings?manage=…)` (history entry).
- Back button → confirm if section editor is open, then `router.push(/settings)`.
- Browser/device Back returns through the same history stack.
- Refresh keeps the focused `?manage=` view.
- Touch targets use `min-h-11`.
- Unauthorized `?manage=` values redirect to hub (presentation gate; APIs still enforce).

---

## 6. Authorization preservation

| View | Presentation gate |
|------|-------------------|
| team / rotation | Supervisor or MasterAdmin |
| ownership / coverage | `canManageOperationalSections` |
| Associate direct URL | Replace to `/settings` |

Roster mutate remains MasterAdmin-only inside `RosterLifecyclePanel`. Coverage/ownership mutations remain existing API/RPC auth.

---

## 7. Test results

| Suite | Result |
|-------|--------|
| SECTION-OWNERSHIP-005 focused | **11 PASS** |
| SO-002 / 003 / 004 / enforcement / AUTO-008A / preview-safety / authz | Included |
| Combined focused batch (10 files) | **120 PASS** |
| TypeScript `tsc --noEmit` | **PASS** |
| ESLint (005 nav + new components) | **PASS** |
| `next build` | **PASS** |

Evidence: `tmp/so005-vitest.txt`, `tmp/so005-tsc.txt`, `tmp/so005-eslint.txt`, `tmp/so005-build.txt`.

---

## 8. AUTO-008 / operational preservation

- Latch remains `WEEKLY_ROTATION_AUTO_PUBLISH = true`.
- Cron remains `0 12 * * 0`.
- No migrations, coverage rows, standing changes, or W44 publication.
- Preview write-guard unchanged.

---

## 9. Remaining limitations

- Standing capacity **establish/revoke** still lives in the Sunday assignment drawer (not duplicated into the rotation focused view).
- Unsaved-edit warning covers Operational Sections create/detail/pick-aisles modes only (not every keystroke field).
- Hub still lists Team / Department Setup cards below the workflow for non-Open browsing; Open itself no longer scrolls.

---

## 10. Production release readiness

**CONDITIONAL GO** after operator phone acceptance of focused Open/Back on More.  
**Do not push/deploy from this tranche** until authorized.
