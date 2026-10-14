# DEPTSYNC-ALIGN-DEPT-001-RELEASE — Flooring / Home Decor Alignment Production Release

**Status:** RELEASED  
**Date:** 2026-10-14  
**Mode:** Controlled production release (app-only; no migrations)  
**Store:** 2587  
**Application:** https://deptsync-hub.vercel.app  

**Implements:** [`DEPTSYNC_ALIGN_DEPT_001_IMPLEMENTATION.md`](./DEPTSYNC_ALIGN_DEPT_001_IMPLEMENTATION.md)

**Strict exclusions honored:** no Supabase migration; no `home_decor` department create/activate; no location reassignment; no Operational Section / membership writes; no capacity / rotation / walkthrough / priority mutations; section-aware Sunday auto-stage remains **HARD OFF**.

---

## Verdict

### **GO** — production app release complete

Production alias serves commit `57334ee`. Merged department model preserved. Operator phone acceptance optional for label UX; no data cutover required.

---

## 1. Released commit

| Field | Value |
|-------|--------|
| Repository | `SilentSage432/carpet-auditor` |
| Branch | `main` |
| Commit | **`57334ee`** — `feat(align): ALIGN-DEPT-001 Flooring / Home Decor merged-model coherence` |
| Full SHA | `57334ee18aa45a203afe10ebe088cd1d1643edb3` |
| Prior tip | `8405934` (RELEASE-006 docs) |
| Push | `8405934..57334ee` → `origin/main` |
| Working-tree dirt excluded | Untracked only: `DEPTSYNC_RD_6_*`, `DEPTSYNC_SEC_OPS_010A_*`, `tmp/` — **not pushed** |

### Diff scope (no schema)

| Included | Role |
|----------|------|
| `lib/store-ops/department-alignment.ts` + focused test | Merged-model contract + capability matrix |
| `lib/types.ts` | Roster CSA / Supervisor / Specialist titles under `flooring` |
| `lib/nav-hub.ts`, `FloorTab`, `WalkTheFloorSheet`, `CycleAuditSection` | Operational labels |
| Product / journal / roadmap / architecture docs | ALIGN-DEPT-001 record |

**No** `supabase/migrations/*`, **no** RLS SQL, **no** department INSERT, **no** membership SQL.

---

## 2. GitHub / Vercel deployment

| Field | Value |
|-------|--------|
| GitHub Production deployment | **`7070725323`** (sha `57334ee`) |
| Deployment state | **success** (`Deployment has completed`) |
| Vercel environment URL | https://deptsync-k7j62c0we-tyson-zauggs-projects.vercel.app |
| Creator | `vercel[bot]` (GitHub → Vercel; no in-repo workflow YAML) |
| Production alias | https://deptsync-hub.vercel.app |
| Alias verification | `GET /login` **200**; protected routes **307→login**; APIs **401** |

---

## 3. Preflight validation (exact)

| Suite | Result |
|-------|--------|
| Focused ALIGN-DEPT + MAP-004 + shared capacity + section ownership | **4 files / 55 PASS** |
| `tsc --noEmit` | **PASS** |
| ESLint (new contract + `lib/nav-hub.ts` + `lib/types.ts`) | **PASS** |
| Pre-existing `WalkTheFloorSheet` / `FloorTab` react-hooks lint | Unrelated; not a release blocker (same class as MAP-004) |
| `next build` | **PASS** |

Contract checks before push:

- `STRICT_SECTION_OWNERSHIP_AUTO_STAGE === false`
- `home_decor` **not** in `STORE_OPS_DEPARTMENT_CODES` / store templates
- No migrations in release diff
- Proposed `home_decor` code remains documentation-only (`OPERATOR_DECISION_REQUIRED`)

---

## 4. Department model (production read-only)

| Check | Result |
|-------|--------|
| Active Floor Command dept | `flooring` · name **Flooring / Home Decor** · `is_active=true` |
| `home_decor` department row | **Absent** (`[]`) |
| Other seeded depts | Present, `is_active=false` (unchanged cleanup posture) |
| Location reassignment | **None** (app-only labels/contract) |
| Department split | **Not performed** |

---

## 5. Operational invariants (production read-only)

| Invariant | Result |
|-----------|--------|
| Active Operational Sections | **4** (`content-range: 0-3/4`) |
| Section bay memberships | **160** (`content-range: 0-159/160`) |
| Associate ownership / membership writers | Untouched by release |
| Weekly rotation capacity model | Untouched (CAPACITY-GUARD / approvals schema unchanged by this app release) |
| Section-bound rotation eligibility | Untouched |
| Supervisor approval authority | Untouched |
| Sunday auto-stage | **OFF** in shipped commit (`STRICT_SECTION_OWNERSHIP_AUTO_STAGE = false`) |
| MAP-002 bay-context API | Unauth **401** (route present / fail-closed) |
| MAP-003 week-bay-priority surface | Untouched |
| MAP-004 named specialty bay rows | **0** under flooring for `CARPET-WALL` / `SHOW-*` / `CLOTHING` |
| Walkthrough APIs | Unauth **401** |
| MasterAdmin / store isolation | Untouched; store-scoped probes used store **2587** only |

---

## 6. Production smoke

| Check | Result |
|-------|--------|
| `GET /login` | **200** — title “DeptSync · Sign in” |
| PIN login UI (browser) | Username + **Password / PIN** + **Log In**; no fingerprint CTAs |
| `/dashboard`, `/admin/store-map`, `/overview`, `/walkthroughs`, `/roster`, `/settings` | **307** → `/login?next=…` |
| `GET /api/departments`, `/api/operational-sections`, `/api/store-locations/bay-context`, `/api/week-capacity`, `/api/walkthroughs` | **401** |
| `POST /api/auth/hub-bridge` `{}` | **400** (AUTH-002 pin required intact) |
| Deployment URL login | Reachable (302/auth gate on preview host; alias **200**) |
| Department labels / roster titles | Shipped via `57334ee` (merged label helpers); authenticated UI confirmation is operator phone optional |

---

## 7. GO / NO-GO

| Gate | Verdict |
|------|---------|
| Preflight clean ALIGN-DEPT scope | **GO** |
| Tests / tsc / build | **GO** |
| No migrations / no `home_decor` activation | **GO** |
| GitHub Production deploy success | **GO** |
| Alias smoke + data invariants | **GO** |
| Begin next feature tranche | **NO-GO** — STOP after release |

**Overall: GO** for this controlled app-only release.

---

## 8. Stop

Release complete. Do not deploy further from this tranche. Do not begin another feature tranche. Do not insert or activate `home_decor` without a separate authorized cutover after TOPO-001 §L operator decisions.
