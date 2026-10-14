# DEPTSYNC-SEC-OPS-010-RELEASE — Operational Authorization Hardening

**Status:** **RELEASED**  
**Date:** 2026-10-14  
**Mode:** Controlled production release (app-only)  
**Production:** https://deptsync-hub.vercel.app  
**Implementation authority:** [`DEPTSYNC_SEC_OPS_010_IMPLEMENTATION.md`](./DEPTSYNC_SEC_OPS_010_IMPLEMENTATION.md)

---

## Executive closeout

| Gate | Result |
|------|--------|
| Preflight isolation | **PASS** |
| Eight authorization corrections | **PASS** (in shipped commit) |
| Focused security + ops regressions | **PASS** (170 tests) |
| TypeScript / lint / production build | **PASS** |
| Push `origin/main` | **PASS** `0cad9e3` |
| GitHub Production deployment | **PASS** `7074861353` @ `0cad9e3` |
| Vercel Production | **PASS** Ready `dpl_C52QHikmYj5PzB1GrYxycQ6tUMyM` |
| Alias serves expected deploy | **PASS** |
| Production smoke | **PASS** |
| Migrations applied | **NONE** |
| Fallback-retirement scope | **EXCLUDED** |
| Overall | **GO — RELEASED** |

**STOP.** Do not begin another feature tranche.

---

## 1. Released commit

| Field | Value |
|-------|-------|
| Commit | `0cad9e3d1f4bed9fabeeec080be2d85477366603` |
| Short | `0cad9e3` |
| Message | `fix(security): SEC-OPS-010 operational authorization hardening` |
| Parent | `872be7f` (OPS-OVERVIEW-001 release docs) |
| Branch | `main` → `origin/main` (`872be7f..0cad9e3`) |

### Preflight

| Check | Result |
|-------|--------|
| Repository | `/Users/silentsage/Desktop/carpet-auditor` → `SilentSage432/carpet-auditor` |
| Production branch | `main` (tracking `origin/main`) |
| Release set | Exactly SEC-OPS-010 routes + `verification.ts` + authz tests + implementation/docs journals |
| Unrelated excluded | `DEPTSYNC_RD_6_PRODUCT_COMPLETION_AUDIT.md`, `DEPTSYNC_SEC_OPS_010A_VERCEL_AUTH_RECOVERY.md`, `tmp/` left untracked |
| Schema migrations in release | **None** |
| Production data mutations | **None** |
| Authentication redesign | **None** (PIN-only preserved) |
| Fallback-retirement / `DEPTSYNC_ALLOW_PLAINTEXT_PIN_VERIFY` | **Not included** |

---

## 2. GitHub workflow / deployment result

No in-repo `.github/workflows` Action runs for this push (empty Actions list). Production is delivered via the Vercel Git integration, which posts a GitHub Deployment:

| Field | Value |
|-------|-------|
| GitHub Deployment ID | `7074861353` |
| Environment | Production |
| SHA | `0cad9e3d1f4bed9fabeeec080be2d85477366603` |
| Created | `2026-10-14T19:15:32Z` |

---

## 3. Vercel deployment

| Field | Value |
|-------|-------|
| Deployment URL | https://deptsync-8rjh4lscq-tyson-zauggs-projects.vercel.app |
| Deployment ID | `dpl_C52QHikmYj5PzB1GrYxycQ6tUMyM` |
| Status | ● Ready |
| Target | Production |
| Build commit (logs) | `0cad9e3` (Branch: main) |
| Alias | https://deptsync-hub.vercel.app → same deployment ID |

---

## 4. Security regression results

| Suite | Result |
|-------|--------|
| `lib/store-ops/sec-ops-010.authz.test.ts` | **20 PASS** |
| Walkthrough + section authz + week-bay-priority + ops-overview | **PASS** |
| thesis001a + runtime-compat001 + snap/snag + bay-unit-002 | **PASS** |
| Combined focused run | **10 files / 170 tests PASS** |
| `tsc --noEmit` | **PASS** |
| ESLint (touched release files) | **PASS** |
| `npm run build` | **PASS** |

### Eight corrections verified in shipped tree

| # | Correction | Evidence in `0cad9e3` |
|---|------------|------------------------|
| 1 | Cross-department assignment | `assign/route.ts` → `assertActorCanAccessDepartmentId` + location store/dept bind |
| 2 | Extra-bay authorization | `extra-bay/route.ts` → `assertActorCanAccessDepartmentId` |
| 3 | Barrier store/department binding | `exceptions` passes `storeId`; `verification.ts` rejects foreign location/rotation |
| 4 | Bulk operation store binding | `bulk/route.ts` rejects mismatched client `store_id` |
| 5 | Completion/verification store binding | `complete` + `verify` reject rotations outside actor store |
| 6 | Priority revocation authorization | DELETE loads target `department_id` then asserts |
| 7 | Priority listing scope | Non–super_admin list filtered by `actorAllowsDepartmentCode` |
| 8 | Section-owner roster proof | create/patch call `assertRosterSpecialistForStore` |

Negative tests (mocked/isolated): unauthenticated helpers, associate→supervisor, forged zebra store, cross-store/cross-dept barriers, zebra non-overwrite, route contract asserts — all green before push.

---

## 5. Legitimate workflow regressions

| Expectation | Evidence |
|-------------|----------|
| Authorized users still gated by existing role helpers | `requireStoreOpsActor` / `requireSupervisorOrAdmin` / `requireSuperAdmin` unchanged in semantics |
| Associates still complete own-dept rotations | Complete path still `requireStoreOpsActor` + dept assert for floor actors |
| Supervisors still verify / priorities / sections / walkthroughs | Supervisor+ gates preserved; only scope tightened |
| MasterAdmin retains store-scoped topology + capacity approve | `requireSuperAdmin` retained; bulk now refuses forged foreign `store_id` (intended) |
| Zebra manual handoff | Unchanged domain; smoke POST unauth **401** |
| No permission expansion | Diff only adds asserts / store binds |

No production authenticated session exercised (no test assignments/priorities/observations created). Contract + unit regressions cover authorized paths without mutating production.

---

## 6. Operational invariant verification (read-only)

| Invariant | Result |
|-----------|--------|
| Store 2587 | Present (`2ce36733-…`) |
| Merged Flooring / Home Decor | Active dept `flooring` name **Flooring / Home Decor**; no separate active `home_decor` |
| Four Operational Sections | **4** active (CSA, Myself, Specialist-A, Specialist-B) |
| 160 bay memberships | Content-Range **0-0/160** |
| Sunday section-aware auto-stage | `STRICT_SECTION_OWNERSHIP_AUTO_STAGE === false` in `0cad9e3` |
| MAP-002/003/004 / walkthrough / Overview / Zebra semantics | Untouched in release diff |
| PIN-only authentication | Login **200**; **0** fingerprint/webauthn/biometric markers in HTML |
| MasterAdmin / store isolation | Unauth APIs **401**; no identity changes |

---

## 7. Production smoke results

Against https://deptsync-hub.vercel.app after alias cutover:

| Check | Result |
|-------|--------|
| `GET /login` | **200** |
| `GET /overview` | **307** → `/login?next=%2Foverview` |
| `GET /flooring` (Map) | **307** |
| `GET /sunday-audit` (This Week) | **307** |
| `GET /walkthroughs` | **307** |
| `POST` assign / verify / extra-bay / zebra / week-bay-priority / bulk / operational-sections / walkthroughs | **401** `Unauthorized` |
| `GET` week-capacity / operational-sections / walkthroughs | **401** |
| `POST /api/auth/hub-bridge` `{}` | **400** (validation; not open) |

---

## 8. Migration-free confirmation

- No files under `supabase/migrations/` in the release commit  
- No SQL applied to production  
- No RLS policy changes  
- No credential / identity mutations  

---

## 9. Fallback-retirement scope exclusion

Inspected but **not** shipped:

- [`DEPTSYNC_SEC_OPS_010_FALLBACK_RETIREMENT.md`](./DEPTSYNC_SEC_OPS_010_FALLBACK_RETIREMENT.md)  
- No `DEPTSYNC_ALLOW_PLAINTEXT_PIN_VERIFY` env mutation  
- No plaintext auth path changes  

This release is **only** operational authorization hardening (`DEPTSYNC_SEC_OPS_010_IMPLEMENTATION.md`).

---

## 10. GO / NO-GO

| Decision | Verdict |
|----------|---------|
| Production app release of SEC-OPS-010 operational authz | **GO — RELEASED** |
| Database migrations | **NO-GO** (none required) |
| Fallback plaintext retirement | **OUT OF SCOPE** (unchanged) |
| Next feature tranche | **STOP** |

Operator phone acceptance of live supervisor workflows remains recommended but is not a blocker for this security hardening ship.
