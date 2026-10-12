# DEPTSYNC-ZEBRA-HANDOFF-002 — Per-Bay Manual Zebra Handoff

**Status:** COMPLETE (local implementation + validation)  
**Date:** 2026-10-11  
**Mode:** Focused implementation — **no production migrate / deploy / data mutation**  
**Store (acceptance):** 2587  
**Depends on:** [`DEPTSYNC_ZEBRA_HANDOFF_001_DISCOVERY.md`](DEPTSYNC_ZEBRA_HANDOFF_001_DISCOVERY.md)

**Boundary honored:** DeptSync and Lowe’s Zebra Dashboard do not communicate. Confirmation is operator-recorded evidence only.

---

## 1. Files changed

| Path | Change |
|------|--------|
| `supabase/migrations/20261017_zebra_handoff_002_sunday_bay_entry.sql` | **New** — columns + owner-change clear trigger |
| `lib/store-ops/zebra-handoff.ts` | **New** — typing aid + authorized confirm domain |
| `lib/store-ops/zebra-handoff.test.ts` | **New** — focused unit + contract tests |
| `app/api/rotations/zebra-entry/route.ts` | **New** — `POST` supervisor confirm API |
| `lib/store-ops/sunday-audit.ts` | Map/read `zebra_entered_*`; cache invalidate helper |
| `lib/store-ops/this-week-ownership.ts` | Orthogonal zebra counts/labels on This Week model |
| `lib/store-ops/client.ts` | `confirmZebraBayEntry` client wrapper |
| `components/store-ops/ThisWeekOwnershipBoard.tsx` | Per-bay status, typing aid, copy, confirm |
| `components/store-ops/ThisWeekCommandSummary.tsx` | **In Zebra** summary stat |
| `components/hub/tabs/FloorTab.tsx` | `allowZebraHandoff` for supervisor/Master |
| `lib/rd4.this-week-command.contract.test.ts` | Contract expects handoff UI markers |
| `docs/product/DEPTSYNC_ZEBRA_HANDOFF_002_IMPLEMENTATION.md` | This report |

---

## 2. Database changes

**Table:** `sunday_bay_assignments` (ownership unit; `bay_id` = `weekly_rotations.id`)

| Column | Type | Meaning |
|--------|------|---------|
| `zebra_entered_at` | `timestamptz` null | Server time when operator confirmed manual Zebra entry |
| `zebra_entered_by` | `text` null | Operator actor id (`specialistId` / `userId`) |

**Trigger:** `sunday_bay_assignments_clear_zebra_on_owner_change`  
Clears both columns when `status = 'cleared'` or `roster_specialist_id` changes. Same-owner updates (including confirm) preserve evidence.

**Not changed:** `weekly_rotations` verification/completion columns, capacity RPC signature, RLS grants (authenticated SELECT retained; client INSERT/UPDATE/DELETE remain revoked).

**Not created:** `zebra_tasks` table, Zebra IDs, photo evidence storage.

---

## 3. Authorization behavior

| Layer | Rule |
|-------|------|
| Route | `requireSupervisorOrAdmin` on `POST /api/rotations/zebra-entry` |
| Domain | Rejects associates; JWT store must match request store |
| Department | Supervisors must allow assignment `department` code; MasterAdmin unrestricted within store |
| Missing / cleared | 404 / 400 — no inventing assignments |
| Writes | Service-role admin client only (no client table UPDATE) |
| Idempotency | If already confirmed → return existing stamps; no overwrite |

Associates can still **view** typing aid + status when Actions is open; **Mark Entered in Zebra** is supervisor/Master only (`allowZebraHandoff`).

---

## 4. Mobile interaction (This Week)

On Floor people→bays board, each assigned bay shows:

- Associate (owner row)  
- Aisle/bay label  
- Assignment + completion evidence (unchanged)  
- **Not entered in Zebra** / **Entered in Zebra · {time}**  

Actions panel (per bay):

1. Typing aid (standard five maintenance steps + Zebra photo reminder)  
2. **Copy for Zebra**  
3. **Mark Entered in Zebra** (one bay only; supervisor+)  

Weekly command summary adds **In Zebra** count (operator-recorded; not Zebra acceptance).

No associate-level bulk confirm. No new navigation.

---

## 5. Test results

| Check | Result |
|-------|--------|
| `lib/store-ops/zebra-handoff.test.ts` | **14 PASS** |
| Related This Week / verify / capacity suites | **72 PASS** (combined focused run **86 PASS**) |
| `npx tsc --noEmit` | **PASS** |
| `next build` | **PASS** (includes `/api/rotations/zebra-entry`) |
| ESLint on new/changed handoff files | **PASS** (no new issues). Pre-existing FloorTab `set-state-in-effect` and repo-wide `tmp/` lint noise unchanged. |

Covered: individual confirm, persistence/idempotency, unauthorized, cross-store, missing assignment, unowned, department scope, completion/verification orthogonality, no Zebra network, no bulk confirm, auto-stage remains `false`.

---

## 6. Migration / deployment requirements

**Local / staging order (when authorized):**

1. Deploy app that includes `/api/rotations/zebra-entry` + This Week UI  
2. Apply `20261017_zebra_handoff_002_sunday_bay_entry.sql` to Supabase  
3. Phone acceptance: confirm one bay → status persists → complete/verify still work  

**This tranche did not:** apply production SQL, mutate production rows, deploy, or enable Sunday automatic staging / section-aware auto-stage.

**Pre-migrate app behavior:** UI will show “Not entered in Zebra”; confirm API fails until columns exist (fail closed). Prefer migrate with or immediately after app deploy.

---

## 7. Remaining limitations

| Limitation | Notes |
|------------|-------|
| No correction / undo UI | Incorrect confirm on same owner is not clearable in-app. Reassign/clear ownership clears via trigger. Future: auditable `SENT_BACK`-style correction history if needed. |
| No Zebra task ID | Deferred (operator decision D2 from discovery). |
| No bulk confirm | By design (one bay = one Zebra task). |
| Not proof of Zebra acceptance | Copy + API note state this explicitly. |
| Photo reminder is informational | DeptSync does not require or store the Zebra photo. |

---

## 8. Production release readiness

| Gate | Verdict |
|------|---------|
| Local implementation complete | **GO** |
| Production migrate / deploy | **CONDITIONAL GO** — requires explicit operator authorization |
| Zebra API / automation | **NO-GO** (out of product boundary) |
| Sunday auto-stage / section-aware auto-stage | **OFF** (unchanged) |
| Preserve assignments / capacity / sections / history | **Honored** (additive columns + orthogonal write path) |

**Overall:** **CONDITIONAL GO** for controlled production release after operator authorize migrate + deploy + phone check of one-bay confirm.

---

**STOP.**
