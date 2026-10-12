# DEPTSYNC-TOPOLOGY-REGISTRY-004 — Controlled Production Release

**Status:** RELEASED — AWAITING PHONE ACCEPTANCE  
**Date:** 2026-10-11  
**Mode:** Authorized application-only release  
**Application:** https://deptsync-hub.vercel.app  
**Supabase:** `fmeinlwhixngednabhgy` (unchanged; **no SQL applied**; registry already live via 002B)  
**Store:** `2587`

**References:**  
[`DEPTSYNC_TOPOLOGY_REGISTRY_002B_PRODUCTION_APPLY.md`](DEPTSYNC_TOPOLOGY_REGISTRY_002B_PRODUCTION_APPLY.md) ·  
[`DEPTSYNC_TOPOLOGY_REGISTRY_003_IMPLEMENTATION.md`](DEPTSYNC_TOPOLOGY_REGISTRY_003_IMPLEMENTATION.md) ·  
[`DEPTSYNC_SECTION_UX_003_RELEASE.md`](DEPTSYNC_SECTION_UX_003_RELEASE.md)

---

## Final verdict

**RELEASED — AWAITING PHONE ACCEPTANCE**

---

## Deploy identity

| Field | Value |
|-------|-------|
| Commit | `b702b94b7d10c9501ad9a9a3823c29e8fee1a07e` (`b702b94`) |
| Message | `feat(topology): ship Create Location and empty Map registry UX` |
| Production URL | https://deptsync-hub.vercel.app |
| Deployment URL | https://deptsync-6q2i25pls-tyson-zauggs-projects.vercel.app |
| Vercel deployment id | `AYeicq8TT2WHTNmJd5JhhxDSJu41` |
| GitHub Production deployment | `7003944801` @ sha `b702b94…` |
| Vercel status | **Ready** (Deployment has completed) |
| Canonical Supabase | `fmeinlwhixngednabhgy` (no project change; no migration apply) |

---

## Released capabilities

- Map → Manage → **Create Location** (MasterAdmin)
- Numbered aisle + named zone creation **without bay numbers**
- Optional display names
- Authorized server-side `store_aisles` writes (`POST /api/store-aisles`)
- Registry ∪ bay-derived Map merge
- Empty-location Map rendering (**0 documented bays**)
- **Add Bays** from an empty location
- Existing bay creation + `ensureStoreAisleForBayWrite` heal path
- Empty-location section selector compatibility (zero membership)
- Newly documented bay discovery remains explicit (SECTION-UX-001)

**Not released / unchanged:** joint stewardship; section-aware auto-stage; Production section-aware preview; capacity/Sunday/Zebra; production topology data mutations; SQL migrations.

---

## Security verification

| Check | Result |
|-------|--------|
| MasterAdmin `requireSuperAdmin` on create | **PASS** (code + security contracts) |
| Store isolation (actor store; client store_id mismatch rejected) | **PASS** |
| Department must belong to actor store | **PASS** |
| Service-role only via `getSupabaseAdmin` (no key exposure) | **PASS** |
| Duplicate / retired identifier → 409 (no silent reactivate) | **PASS** |
| Authenticated client writes to `store_aisles` | **Denied** (RLS + revoked privileges; unchanged) |
| Unauthenticated GET/POST `/api/store-aisles` on Production | **401** (smoke) |
| Section-aware auto-stage | Remains `SECTION_AWARE_ROTATION_AUTO_STAGE = false` |
| Section-aware preview | Remains opt-in (`NEXT_PUBLIC_DEPTSYNC_SECTION_AWARE_PREVIEW=1`); not enabled for this release |

---

## Data preservation

| Baseline (002B verification) | Release action |
|------------------------------|----------------|
| 21 backfilled `store_aisles` | Untouched (no SQL; no agent creates) |
| 712 `store_locations` | Untouched |
| 30 `sunday_bay_assignments` | Untouched |

No registry migration re-apply. No test aisles/bays created in production.

---

## Predeploy verification

| Gate | Result |
|------|--------|
| Scope review (REGISTRY-003 only; SEC-OPS/RD-6/`tmp/` excluded) | **PASS** |
| Migration already on prod (002B) | **PASS** — app-only release |
| Rotation / capacity / Sunday / Zebra untouched | **PASS** |
| `npx tsc --noEmit` | **PASS** |
| Relevant eslint | Pre-existing `set-state-in-effect` on Map focus/chunk effects retained (same class as prior releases) |
| Full tests | **1658 PASS** / 133 files |
| `npm run build` | **PASS** (`/api/store-aisles` present) |

---

## Production smoke (non-mutating)

| Check | Result |
|-------|--------|
| Vercel commit status | **success** — Deployment has completed |
| Deployed SHA | `b702b94…` |
| `GET /login` | **200** (DeptSync Sign in) |
| `/` `/floor` `/settings` | **307** (auth redirect) |
| `GET /api/store-aisles` unauthenticated | **401** |
| `POST /api/store-aisles` unauthenticated | **401** |
| Production topology mutations by agent | **None** |

---

## Known limitations

1. Phone acceptance not performed by agent.  
2. Supervisor cannot Create Location (MasterAdmin only).  
3. No retire/reactivate UI for empty registry shells.  
4. Create Location will not reactivate a retired code (409).  
5. Live authenticated Map JWT smoke not run here (requires operator session).

---

## Rollback instructions

1. Redeploy prior Production commit `bbf66e0` (SECTION-UX-003 docs tip) or feature tip `33a088b` via Vercel / git revert of `b702b94`.  
2. Do **not** drop `store_aisles` — production registry remains valid and was applied in 002B.  
3. After rollback, Map returns to bay-derived-only behavior (no Create Location UI).

---

## Phone acceptance checklist

Operator verifies on https://deptsync-hub.vercel.app:

1. Log in as MasterAdmin.  
2. Open Map → Manage.  
3. Open **Create Location**.  
4. Enter `CARPET-WALL`.  
5. Leave bay numbers unspecified.  
6. Save the location.  
7. Confirm Carpet Wall appears in Map.  
8. Confirm it displays **0 documented bays**.  
9. Confirm **Add Bays** is available.  
10. Confirm existing numbered aisles remain visible.

**STOP** — awaiting operator phone acceptance.
