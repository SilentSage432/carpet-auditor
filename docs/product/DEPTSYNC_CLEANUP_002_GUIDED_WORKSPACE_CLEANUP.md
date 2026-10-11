# DEPTSYNC-CLEANUP-002 — Guided Department Workspace Cleanup

**Status:** COMPLETE (local implementation + tests; production cleanup / deploy **not** authorized)  
**Date:** 2026-10-11  
**Mode:** Controlled implementation  
**Authority:** [`DEPTSYNC_CLEANUP_001_WORKSPACE_DISCOVERY.md`](DEPTSYNC_CLEANUP_001_WORKSPACE_DISCOVERY.md)  

**Not authorized by this tranche:** production cleanup execution, automatic retirement/archival, production SQL, schema migrations, deploy, credential/auth/RLS changes, Map redesign, Sunday staging / rotation engine changes, CAPACITY-GUARD-001, dual-department auto-assign.

---

## Executive verdict

A MasterAdmin-only guided mobile cleanup wizard is implemented under **More → Master Admin → Workspace cleanup**.

| Capability | Behavior |
|------------|----------|
| Aisle retirement | Soft only: `store_locations.is_active = false` |
| Associate archival | Soft only: `is_active = false`, `status = suspended` |
| Hard delete | **Never** on this path |
| MasterAdmin archive | **Rejected** server-side |
| Empty / stale selection | Rejected or requires refreshed preview |
| Production cleanup | **Not executed** |

**GO / NO-GO for deployment:** **CONDITIONAL GO** for app deploy after operator review of security evidence — **NO-GO** for executing cleanup against production until the operator runs the guided workflow intentionally.

---

## Architecture

```text
More (Master Admin)
  └── WorkspaceCleanupWizard (client)
        ├── GET  /api/workspace-cleanup          → inventory
        └── POST /api/workspace-cleanup
              ├── preview_aisles
              ├── retire_aisles     (confirm + fingerprint)
              ├── preview_associates
              └── archive_associates (confirm + fingerprint)
                    │
                    ▼
        lib/store-ops/workspace-cleanup.ts   (composition + soft mutations)
                    │
                    ▼
        service-role Supabase admin (server only)
```

Ownership:

| Concern | Owner |
|---------|-------|
| Soft cleanup composition | `lib/store-ops/workspace-cleanup.ts` |
| Auth + store scope | `app/api/workspace-cleanup/route.ts` via `resolveStoreOpsActor` + `requireSuperAdmin` |
| Presentation | `components/admin/WorkspaceCleanupWizard.tsx` |
| Entry | `components/sections/SettingsSection.tsx` (Master Admin card) |

Does **not** compete with Bulk Clean-Up hard-delete or roster `deleteSpecialist` (which can hard-delete). Those paths remain for other admin use; guided cleanup is a separate soft-only authority.

**Unsafe helper avoided:** `deleteSpecialist` still attempts hard DELETE after soft update. CLEANUP-002 intentionally does not call it.

---

## UI entry point

| Item | Detail |
|------|--------|
| Surface | More → Master Admin (collapsed) |
| Control | **Workspace cleanup** (`data-testid="more-workspace-cleanup"`) |
| Shell | Mobile bottom sheet (`HubPortal` + `theme-modal`) |
| Visibility | MasterAdmin UI gate; mutations fail closed for non–super_admin |

### Guided steps

1. **Review aisles** — grouped by department association; multi-select; no auto-select  
2. **Preview aisle changes** — bay/surface counts, section memberships, rotation refs, walkthrough refs; explicit confirm checkbox  
3. **Review associates** — name, department, role, rotation eligibility, active status; MasterAdmin never listed  
4. **Preview associate changes** — Sunday/walkthrough refs, auth implications; explicit confirm  
5. **Results** — per-record status; partial failures never labeled complete success  

Skip aisles / skip people is allowed (zero mutations for that phase). Confirm with empty selection is rejected by the API.

---

## Files changed

| File | Role |
|------|------|
| `lib/store-ops/workspace-cleanup.ts` | Inventory, preview, soft mutations, fingerprints |
| `app/api/workspace-cleanup/route.ts` | MasterAdmin API |
| `lib/store-ops/client.ts` | Client fetch helpers |
| `components/admin/WorkspaceCleanupWizard.tsx` | Mobile wizard |
| `components/sections/SettingsSection.tsx` | Entry point |
| `lib/store-ops/workspace-cleanup.test.ts` | Selection / inventory / outcome tests |
| `lib/store-ops/workspace-cleanup.mutations.test.ts` | Soft mutation + stale fingerprint + MasterAdmin rejection |
| `docs/product/DEPTSYNC_CLEANUP_002_GUIDED_WORKSPACE_CLEANUP.md` | This report |

No schema migrations.

---

## Authorization enforcement

| Check | Where |
|-------|-------|
| Authenticated identity | `resolveStoreOpsActor` |
| MasterAdmin / super_admin | `requireSuperAdmin` (403 otherwise) |
| Store scope | `actor.storeNumber` → `resolveStoreByNumber`; location updates `.eq("store_id", store.id)`; roster `.eq("store_number", actor.storeNumber)` |
| Department in store | Preview/retire rejects aisle keys whose `department_id` is outside store departments |
| Protected MasterAdmin | Preview/archive returns 403; update also `.neq("role", "MasterAdmin")` |
| Permitted mutations | Soft `is_active` / `status` only — no DELETE, no credential fields |
| Service role | Server `getSupabaseAdmin` only — not exposed to browser |

UI restrictions alone are not trusted.

---

## Preview and confirmation semantics

1. Operator selects explicit targets.  
2. Server builds preview + deterministic **fingerprint** of live active surface IDs (aisles) or `id|is_active|status` (associates).  
3. Mutation requires `confirm: true` and the same fingerprint.  
4. At mutation time, fingerprint is recomputed from live rows; mismatch → `review` (no silent mutate).  
5. Idempotent retries: already inactive → `already_retired` / `already_archived` (counted as success, not failure).  
6. Response includes `complete_success` only when `ok && !partial`.

---

## Historical preservation

| Artifact | After cleanup |
|----------|---------------|
| Location UUIDs | Preserved |
| `weekly_rotations` / completion attempts | Preserved (no CASCADE delete) |
| Operational section memberships | Untouched by location pause (counts shown in preview) |
| Walkthrough observations / follow-ups | Preserved (soft place/associate refs) |
| Sunday assignments | Preserved (text/roster ids remain) |
| Associate identity | Soft tombstone; credentials unchanged; login blocked by active filters |

---

## Test coverage

| Area | Coverage |
|------|----------|
| Multi-select / parse | Empty reject; dept+aisle required; dedupe |
| MasterAdmin protection | Inventory + archive 403 |
| Preview counts / fingerprint | Aisle inventory bay/surface; stale fingerprint → review |
| Partial failures | `summarizeCleanupOutcome` not ok / partial |
| Idempotent retries | already_retired / already_archived |
| No hard deletion | Source contracts + mutation mocks assert zero `.delete()` |
| Cross-store | Location/store filter; associate 404 outside store |
| Map / roster behavior | Existing suites unchanged (Map readiness, roster contracts) |

**Results:**

| Gate | Result |
|------|--------|
| Typecheck | PASS |
| Full test suite | **1543** passed (123 files) |
| Production build | PASS (`/api/workspace-cleanup` present) |

---

## Migration requirements

**None.** Uses existing `store_locations.is_active` and `store_specialists.is_active` / `status` columns.

---

## Map observations (future — not implemented)

Guided cleanup does not change Map visuals. Relevant for a later Map milestone:

- Soft-retired aisles disappear from the default aisle index (`showRetired=false`) and remain available via Show Retired.  
- Rose “Needs attention” still conflates barriers + stale coverage (CLEANUP-001 §5).  
- After cleanup, Map clutter from foreign aisles should drop without a redesign.

---

## Remaining risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Operator retires wrong aisle | Medium | Preview + confirm; soft-retire reversible via existing activate/pause |
| Bulk Clean-Up hard-delete still available elsewhere | Medium | Guided path never exposes it; operator training |
| Open week ownership on retired bays | Medium | Preview shows rotation refs; prefer between-week cleanup |
| Dual-dept auto-stage still doubles ×3 | High (separate) | CAPACITY-GUARD-001 still required before second-dept auto |
| Deploy without operator review | — | **NO-GO** until authorized |

---

## GO / NO-GO for deployment

| Gate | Verdict |
|------|---------|
| Local implementation quality | **GO** |
| Schema / SQL | N/A (none) |
| Production cleanup execution | **NO-GO** (operator-driven only after deploy) |
| App deploy to production | **CONDITIONAL GO** — after operator security/product review; no auto-cleanup on deploy |
| CAPACITY-GUARD / dual-dept auto | **NO-GO** (out of scope) |

---

## Operator next steps (after authorized deploy)

1. Sign in as MasterAdmin on store 2587.  
2. More → Master Admin → Workspace cleanup.  
3. Explicitly select out-of-scope aisles → preview → confirm.  
4. Explicitly select out-of-scope associates → preview → confirm (MasterAdmin never selectable).  
5. Review results; do not treat partial as complete.  
6. Verify Map “Show retired” and Roster no longer show archived people.

---

*End of DEPTSYNC-CLEANUP-002. Stop after reporting. No production cleanup executed.*
