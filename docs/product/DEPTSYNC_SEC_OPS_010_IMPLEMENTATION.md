# DEPTSYNC-SEC-OPS-010 — Operational Authority and Accountability

**Status:** COMPLETE — **released** via [`DEPTSYNC_SEC_OPS_010_RELEASE.md`](./DEPTSYNC_SEC_OPS_010_RELEASE.md) (`0cad9e3`)  
**Date:** 2026-10-14  
**Mode:** Evidence-based security hardening  
**Naming note:** Distinct from [`DEPTSYNC_SEC_OPS_010_FALLBACK_RETIREMENT.md`](./DEPTSYNC_SEC_OPS_010_FALLBACK_RETIREMENT.md) (plaintext PIN fallback config). This document is the **operational authorization** tranche deliverable requested as `DEPTSYNC_SEC_OPS_010_IMPLEMENTATION.md`.  
**Authority:** Redesign-001 · OPS-OVERVIEW-001 · ALIGN-DEPT-001 · OPERATIONAL-011/012 · MAP-002/003 · WALK-005/006 · ZEBRA-HANDOFF-002 · THESIS-001A / RUNTIME-COMPAT-001  
**Production baseline preserved:** store 2587 · merged `flooring` · 4 sections / 160 memberships · Sunday auto-stage OFF · PIN-only auth

---

## Verdict

| Class | Count | Notes |
|-------|------:|-------|
| **Verified secure** | Most Floor Command surfaces | JWT → `profiles` actor; service-role writes after route checks; walkthroughs/zebra/sections already strong |
| **Corrected** | 8 API/domain gaps | Cross-dept assign/extra-bay; barrier location trust; bulk `store_id`; complete/verify store bind; priority revoke/list; section owner roster |
| **Requires database migration** | 0 for this tranche | No append-only event platform; existing history patterns adequate |
| **Requires operator decision** | Plaintext PIN fallback (separate 010) | Unrelated; still CONDITIONAL GO under FALLBACK_RETIREMENT |

**Production GO / NO-GO for this tranche:** **GO — RELEASED** via SEC-OPS-010-RELEASE (`0cad9e3`). No migrations prepared or applied.

---

## 1. Existing authority matrix

Derived from route helpers + domain contracts (not invented privileges).

| Action | MasterAdmin (`super_admin`) | Department Supervisor | CSA / Specialist (`associate`) |
|--------|----------------------------|-------------------------|--------------------------------|
| **Operational Sections — read** | Yes (store) | Yes (store; dept-scoped when filtered) | Yes (store read) |
| **Sections — create / update / retire / members** | Yes | Yes (dept-scoped) | No |
| **Section owner assignment** | Yes (roster must belong to actor store) | Yes (same) | No |
| **Weekly rotation generate / force** | Yes | No | No |
| **Rotation assign / extra-bay** | Yes (store) | Yes (**own accessible depts only** — corrected) | No |
| **Rotation complete (report)** | Yes (actor store) | Yes (dept + store) | Yes (dept + store) |
| **Rotation verify / send_back** | Yes (actor store) | Yes (dept + store) | No (supervisor+) |
| **Barrier / exceptions report** | Yes (store + dept) | Yes (own dept; locations must match — corrected) | Yes (own dept; locations must match) |
| **Week capacity review (GET)** | Yes | Yes | Yes (authenticated) |
| **Week capacity approve (POST)** | Yes only | No | No |
| **Week bay priority create / revoke** | Yes (store) | Yes (accessible depts — revoke corrected) | No |
| **Walkthrough session start/end** | Yes | Yes | No |
| **Observation create** | Yes | Yes | No (read place history yes) |
| **Follow-up create / complete** | Yes | Yes | No |
| **Zebra handoff confirm** | Yes | Yes (dept + assigned bay) | No |
| **Bulk topology create** | Yes (actor store only — corrected) | No | No |

**Identity:** Server resolves actor via Supabase Auth session → `profiles` (`lib/store-ops/auth-server.ts`). Client role / owner / store headers are **not** authoritative (`parseStoreOpsActor` returns `null`).

---

## 2. Confirmed security gaps (pre-change)

| # | Gap | Severity | Classification |
|---|-----|----------|----------------|
| 1 | `/api/rotations/assign` — supervisor could stage any department in-store (no `assertActorCanAccessDepartmentId`) | High | **Corrected** (closes THESIS-001 **T-3**) |
| 2 | `/api/rotations/extra-bay` — same cross-dept write | High | **Corrected** |
| 3 | `/api/rotations/exceptions` — location/rotation IDs not bound to store+dept before CARRIED_OVER writes | High | **Corrected** |
| 4 | `/api/store-locations/bulk` — optional body `store_id` could target foreign store for MasterAdmin | High | **Corrected** |
| 5 | `/api/rotations/complete` + verify/send_back — rotation UUID not store-bound for `super_admin` | Medium–High | **Corrected** |
| 6 | Week bay priority DELETE — `priority_id` path skipped dept assert when `department_id` omitted | Medium | **Corrected** |
| 7 | Week bay priority list — supervisor could read all store depts by omitting filter | Low–Medium | **Corrected** |
| 8 | Section `primary_owner_specialist_id` — no roster store proof | Medium | **Corrected** |

**Not gaps (verified secure):** Zebra handoff store/dept/assignment checks + idempotent evidence; walkthrough create/complete attribution + `load*ForStore`; section mutations via `loadOperationalSectionForStore`; week-capacity POST `requireSuperAdmin`; PIN-only auth path; Sunday auto-stage `STRICT_SECTION_OWNERSHIP_AUTO_STAGE === false`; rotation ownership RPC enforcement preserved.

---

## 3. Server enforcement changes

| Path | Change |
|------|--------|
| `app/api/rotations/assign/route.ts` | `assertActorCanAccessDepartmentId`; all `location_ids` must match actor store + department |
| `app/api/rotations/extra-bay/route.ts` | `assertActorCanAccessDepartmentId` after dept store bind |
| `app/api/store-locations/bulk/route.ts` | Reject mismatched client `store_id`; always query dept with actor `store.id` |
| `app/api/rotations/complete/route.ts` | Require rotation `store_id`/`store_number` (or legacy dept→store) match |
| `app/api/rotations/verify/route.ts` | Same store bind before verify / send_back |
| `app/api/rotations/exceptions/route.ts` | Pass `storeId: store.id` into domain |
| `lib/store-ops/verification.ts` | When `storeId` set, reject foreign location/rotation before insert/CARRIED_OVER |
| `app/api/store-locations/week-bay-priority/route.ts` | Revoke loads target dept; list filters by `actorAllowsDepartmentCode` |
| `app/api/operational-sections/route.ts` + `[id]/route.ts` | `assertRosterSpecialistForStore` on owner writes |

---

## 4. Database enforcement findings

| Surface | Finding |
|---------|---------|
| Walkthrough tables | Authenticated writes revoked; API + service role after checks — **Verified secure** |
| `store_week_bay_priorities` | SELECT-only for authenticated; mutations via API — **Verified secure** |
| `sunday_bay_assignments` | Mutations via RPC/service role; zebra confirm scoped in domain — **Verified secure** |
| `weekly_rotations` JWT RLS | **Bypassed** by admin client in Next routes — route/domain checks are the real gate (strengthened this tranche) |
| Section ownership RPC | Authoritative rotation ownership enforcement **preserved** (OPERATIONAL-011/012) — not weakened |
| Security-definer RPCs | Capacity / ownership RPCs unchanged; no privilege grant added |

**Implication:** Direct PostgREST as `authenticated` cannot freely mutate walkthroughs/priorities; Floor Command mutations must stay correctly gated in API because they use service role.

---

## 5. Rotation authorization

| Check | Result |
|-------|--------|
| Supervisor approval / verify | Supervisor+; store-bound (corrected) |
| Section-bound bay eligibility | Unchanged (OPERATIONAL-011 RPC) |
| Weekly capacity limits | Unchanged (CAPACITY-GUARD + approvals) |
| Proposal freshness | Unchanged |
| Historical assignment preservation | Unchanged (supersede, not hard-delete) |
| Sunday auto-stage | **OFF** (`STRICT_SECTION_OWNERSHIP_AUTO_STAGE = false`) |
| Auto assign/approve | **Not introduced** |

---

## 6. Walkthrough accountability

| Check | Result |
|-------|--------|
| Observation creator attribution | Server `actor.specialistId` |
| Location binding | Place keys + dept assert |
| Follow-up create / complete | Supervisor+; store-scoped loaders |
| Closure evidence | Existing completion evidence requirements preserved |
| Historical timestamps | Preserved |
| Store isolation | Actor store only |
| Semantics | Positive / opportunity / review / open / overdue **unchanged**; observations are not auto-tasks |

---

## 7. Supervisor priority authorization

| Check | Result |
|-------|--------|
| Create | Supervisor+; dept assert; `prioritized_by_specialist_id` from actor |
| Revoke | Supervisor+; dept from **target row** (corrected) |
| Store / week / location bind | Existing MAP-003 rules |
| Ownership eligibility | Unchanged |
| No implicit rotation assignment | Preserved |
| No capacity bypass | Preserved |

---

## 8. Zebra handoff attribution

| Check | Result |
|-------|--------|
| Authorized recording | Supervisor+ |
| Actor / timestamp attribution | Server specialist id + `now`; idempotent — **no overwrite** of prior evidence |
| False completion claims | Response explicitly `manual_operator_record` |
| Cross-store | Rejected when actor store ≠ assignment store |
| Zebra integration | **Not introduced** |

---

## 9. Evidence integrity

| Record | Overwrite risk | Disposition |
|--------|----------------|------------|
| Zebra entry stamps | Would be bad if re-confirm overwrote | **Verified secure** (idempotent return) |
| Walkthrough observations | No general UPDATE mutate path for content rewrite in ops APIs | **Verified secure** for this scope |
| Follow-up completion | Completes with actor attribution | Legitimate completion — preserved |
| Barrier exceptions | Insert-first evidence before location flag | Preserved |
| Rotation verify provenance | Idempotent when already `VERIFIED_COMPLETE` | Preserved |
| Section owner change | Allowed with roster proof + event append | Legitimate correction — preserved |

**No append-only event architecture invented.** No migration required for stronger history in this tranche.

---

## 10. Migration requirements

| Item | Status |
|------|--------|
| Schema / RLS migration for this tranche | **None** |
| Local migration prepared | **None needed** |
| Production apply | **Forbidden / not performed** |

---

## 11. Test results

| Suite | Result |
|-------|--------|
| `lib/store-ops/sec-ops-010.authz.test.ts` (20) | **PASS** |
| Walkthrough + section authz + week-bay-priority + ops-overview | **PASS** (64 total with sec-ops-010) |
| thesis001a + runtime-compat001 + snap/snag retirement | **PASS** (81) |
| `tsc --noEmit` | **PASS** |
| ESLint (touched) | **PASS** (fixed pre-existing `prefer-const` in verify helper) |
| `npm run build` | **PASS** |

Negative coverage includes: unauthenticated helpers, associate→supervisor, forged store on zebra, cross-store/cross-dept barriers, zebra non-overwrite, route contract asserts for corrected endpoints.

---

## 12. Remaining blockers

| Item | Owner |
|------|-------|
| Authorize app deploy of this hardening | Operator |
| Plaintext PIN fallback disable (separate SEC-OPS-010 FALLBACK) | Operator / Vercel env |
| THESIS **T-2** coverage debt / **T-6** restaging defaults | Product decision (unchanged) |
| Dual-dept Flooring/Home Decor separation | OPERATOR-BLOCKED (TOPO-001) |

---

## 13. Production GO / NO-GO

| Gate | Verdict |
|------|---------|
| Local implementation complete | **GO** |
| Automatic production deploy | **NO-GO** |
| Production migrations | **NO-GO** (none) |
| App-only controlled release when authorized | **CONDITIONAL GO** |
| Preserve PIN-only / MasterAdmin / merged flooring / 4×160 / capacities / MAP-002–004 / walkthrough + Overview semantics | **Preserved** |

**STOP AFTER IMPLEMENTATION.** Do not deploy automatically.
