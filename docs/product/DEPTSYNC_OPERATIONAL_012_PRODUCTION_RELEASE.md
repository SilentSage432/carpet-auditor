# DEPTSYNC-OPERATIONAL-012 — Strict Section Ownership Production Release

**Status:** RELEASED — AWAITING PHONE ACCEPTANCE  
**Date:** 2026-10-12  
**Mode:** Controlled production release (migration + app)  
**Store:** 2587  
**Supabase:** `fmeinlwhixngednabhgy` (ACTIVE_HEALTHY, us-west-2)  
**Application:** https://deptsync-hub.vercel.app  

**Implements:** [`DEPTSYNC_OPERATIONAL_011_IMPLEMENTATION.md`](DEPTSYNC_OPERATIONAL_011_IMPLEMENTATION.md)

**Strict exclusions honored:** No section rebuild; no W41 rewrite; no W42 assignment creation; no Zebra API; Sunday auto-stage remains **HARD OFF**.

---

## Release sequence (no bypass window)

| Step | Action | Rationale |
|------|--------|-----------|
| 1 | Preflight + focused gates | Confirm scoped commit, inventory, tests/build |
| 2 | Production `pg_dump` backup | Recoverable restore point |
| 3 | Apply `20261018_operational_011_section_ownership.sql` | Authoritative write boundary enforces ownership **before** new UI ships |
| 4 | Transactional RPC ownership verification | Fail closed without permanent test rows |
| 5 | Push/deploy app commit `26d48ba` | Proposal engine matches DB law |

During the brief migrate→deploy gap, soft legacy proposals that attempted cross-section writes would be **rejected by the RPC** (fail closed), not accepted. No period allowed unrestricted writes.

---

## 1. Released application commit

| Field | Value |
|-------|--------|
| Repository | `SilentSage432/carpet-auditor` |
| Branch | `main` |
| Commit | **`26d48ba`** (`26d48ba2289f029cbef7d5332c85074f1a56e759`) |
| Message | `OPERATIONAL-011: enforce strict Operational Section ownership` |
| Prior tip | `cbfab8b` (OPERATIONAL-010 release docs) |
| Push | `cbfab8b..26d48ba` → `origin/main` |
| Scoped files | Ownership engine + Sunday proposal UI + capacity error codes + migration + 011 doc + journal/handoff/roadmap |
| Excluded dirt | SEC-OPS-010 / RD_6 docs, `tmp/` |

---

## 2. Deployment ID

| Field | Value |
|-------|--------|
| GitHub Production deployment | **`7015902704`** |
| Vercel commit status | **success** |
| Vercel deployment URL | https://vercel.com/tyson-zauggs-projects/deptsync-hub/9EQ8op1YCpm9kkxPHzqSB2fuoTqp |
| Production alias | https://deptsync-hub.vercel.app |
| Alias commit match | **`origin/main` = `26d48ba`** |
| Created | 2026-10-12T14:01:23Z |

HTTP smoke after deploy:

| Check | Result |
|-------|--------|
| `GET /login` | **200** |
| Unauth `GET /api/week-capacity?week=2026-W42` | **401** |
| Unauth `GET /api/operational-sections` | **401** |

---

## 3. Production migration result

| Item | Result |
|------|--------|
| File | `supabase/migrations/20261018_operational_011_section_ownership.sql` |
| Project | `fmeinlwhixngednabhgy` |
| Apply | **COMMIT** (`CREATE FUNCTION` replace + comment + revoke/grant) |
| Client | `psql` 17.11 over SSL as `postgres` |
| Live function contains | `SECTION_OWNERSHIP_MISSING` / `MISMATCH` / `AMBIGUOUS` / `section_ownership_enforced` / `approved_capacity_enforced` |
| Capacity advisory lock + approved caps | **Preserved** |

Compatibility note: production `store_locations.bay` is `text`; RPC selects into `integer` (Postgres cast) and joins `operational_section_members.bay integer`. Probe + ownership joins succeeded for W42 staged bays.

---

## 4. Backup verification

| Field | Value |
|-------|--------|
| Method | Management API ephemeral DB password rotate → `pg_dump` 17 `-Fc` |
| Artifact | `tmp/production-backups/deptsync-fmeinlwhixngednabhgy-2026-10-12T13-49-55Z.dump` |
| Meta | `…13-49-55Z.meta.json` |
| Size | **757562** bytes |
| TOC entries | **1237** |
| Password persistence | **Not persisted / re-rotated after verification** |

---

## 5. Ownership enforcement verification

Isolated transactional checks under `request.jwt.claim.role=service_role` (no permanent assignment rows):

| Check | Result |
|-------|--------|
| Cross-section assignee → `SECTION_OWNERSHIP_MISMATCH` | **PASS** |
| Unknown `bay_id` → `SECTION_OWNERSHIP_MISSING` | **PASS** |
| `SECTION_OWNERSHIP_AMBIGUOUS` present in live RPC | **PASS** (source) |
| No overlapping active memberships in store 2587 | **PASS** |
| `sunday_bay_assignments` count unchanged (30) | **PASS** |
| Approved-capacity enforcement strings retained | **PASS** |

Application tree contracts at `26d48ba`:

| Contract | Result |
|----------|--------|
| `STRICT_SECTION_OWNERSHIP_AUTO_STAGE = false` | **PASS** |
| `STEWARDSHIP_WEEK_DISTRIBUTION_AUTO_STAGE = false` | **PASS** |
| `SECTION_AWARE_ROTATION_AUTO_STAGE = false` | **PASS** |
| Composer uses `selectBaysWithStrictSectionOwnership` | **PASS** |

---

## 6. Production data preservation

| Artifact | Pre | Post |
|----------|----:|-----:|
| Active Operational Sections (2587) | 4 | **4** |
| Section memberships (2587) | 160 | **160** |
| Sections total (incl. inactive) | 5 | **5** |
| Sunday assignments (2587) | 30 | **30** |
| W41 (`2026-10-05`) | 6 | **6** |
| W42 (`2026-10-12`) | 0 | **0** |
| Capacity approvals | 4 | **4** |
| W42 approved shared sum | 11 | **11** |
| Zebra entered stamps | 0 | **0** |
| Historical assignments rewritten | no | **no** |
| W42 work auto-created | no | **no** |

---

## 7. Test results (pre-release gates)

| Gate | Result |
|------|--------|
| Focused ownership/rotation suites | **92 PASS** |
| `tsc --noEmit` | **PASS** |
| `npm run build` | **PASS** |
| Unrelated dirty files excluded from commit | **PASS** |

---

## 8. Remaining blockers

| Item | Status |
|------|--------|
| Phone acceptance of ownership proposal UX | **PENDING operator** |
| Optional call-out redistribute across sections | Will fail closed at RPC (carry path remains) — expected |
| Walkthroughs implementation | **Not started** (explicit stop) |

No release blockers remain for operator phone trial of Assign this week under strict ownership.

---

## 9. Exact phone acceptance steps

On a phone at https://deptsync-hub.vercel.app:

1. Sign in as supervisor / Master Admin for store **2587**.  
2. Confirm **Operational Sections** still lists the four owned sections (memberships intact).  
3. Open Floor / Sunday drawer for the current staging week (do **not** Force Draw or regenerate W41).  
4. Confirm weekly capacity approvals are present (shared target **11** for W42 fixture if still current).  
5. Open **Assign this week** proposal preview.  
6. Verify each associate shows: owned section, approved capacity, proposed bays only inside owned aisles, and any unfilled capacity reason.  
7. Confirm **no** cross-section bays appear as acceptable optimization.  
8. Confirm one button: **Assign this week** (no manual owner picking / no balancing step).  
9. Optionally confirm one owned proposal (creates real W42 ownership — only if operator wants live work).  
10. Confirm Sunday automatic staging remains off (no unexpected auto Stage+Assign).

**Expect:** Tyson → aisles 5/6 only; Nate → 39/40/7; Nick → 43/44; Tracy → 41/42; capacity respected; Zebra remains independent manual handoff.

---

## System boundaries

DeptSync and Lowe’s Zebra Dashboard remain independent. No Zebra API, no automatic Zebra task creation, no automatic completion synchronization.

---

## Release decision

**RELEASED — AWAITING PHONE ACCEPTANCE.**

**STOP.**
