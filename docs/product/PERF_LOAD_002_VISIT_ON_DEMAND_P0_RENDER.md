# PERF-LOAD-002 — Visit-on-Demand Tabs + P0 Operational Render

> **Mode:** AUTHORIZED performance implementation.  
> **Baseline:** `main @ 01a33b5` — PERF-LOAD-001 audit  
> **Evidence basis:** [`PERF_LOAD_001_OPERATIONAL_LOAD_PATH_AUDIT.md`](./PERF_LOAD_001_OPERATIONAL_LOAD_PATH_AUDIT.md)  
> **Date:** 2026-09-18  
> **Samsung field acceptance:** Required before claiming perceived success.

---

## Performance law

1. **Load the minimum operational truth first.** Supporting detail may arrive progressively.
2. **An unvisited workspace must not compete with the active workspace for initial operational truth.**
3. **Faster presentation may not weaken truth** — no fake ownership, optimistic schedule fabrication, stale promotion to authority, or auth/verification bypass.

---

## What changed

### 1. WorkflowTabShell — visit-on-demand + keep-alive-after-visit

**Before:** `visited` seeded with every `allowedTabs` entry; an effect also added all allowed tabs → Floor cold launch mounted Map + Roster + Settings and ran their fetch graphs.

**After:**

- `seedVisitedTabs(active, allowedTabs)` — only the active allowed tab starts visited.
- `reconcileVisitedTabs` — on navigate, add active; on role/scope change, **prune** forbidden tabs (never re-add all allowed).
- Floor / Map / Roster / Settings each mount only when `visited.has(href)` (plus existing role checks for Roster/Settings).
- After first visit, panels stay mounted (keep-alive). No remount-on-every-switch.

Helpers: `lib/workflow-tab-visit.ts`.

### 2. Floor — P0 unlock (locations off critical path)

**P0 (blocks primary ownership paint / `loading` clear):**

- actor/scope + departments (for working department id)
- weekly rotations (`fetchThisWeekRotations`)
- authoritative `sunday_bay_assignments` (`await loadAssignments`)

**P1:** On-now / shift team (`loadOnDuty`) — fired without blocking ownership unlock.

**P2:** `store_locations` topology hint, attention, exceptions/barriers — non-blocking relative to ownership.

**P3:** Floor Pad / seasonal / admin recovery chrome — unchanged, not on P0 path.

**Request shape:**

```text
departments → rotations → await sunday_bay_assignments → setLoading(false)
              ↘ void loadOnDuty()
              ↘ void fetchStoreLocationsDetailed()   // no longer in Promise.all with rotations
```

Boot peeks: rotations + locations parallel; if peeked week exists, start `loadAssignments` early while live reload proceeds.

Ownership authority unchanged: empty assignments ⇒ no fabricated owners; `isHealthyOwnedPlan` false until assigned.

### 3. Roster — P0 unlock (People before assignments)

**P0:** timezone + specialists + shift days → `setLoading(false)` → People list.

**P1:** `sunday_bay_assignments` × home depts → captions / Reassign eligibility.

**P3:** QR/PIN/admin remain disclosure-only (unchanged).

**Safety:**

- `formatOwnedBayCaption(0)` stays `null` (no false “0 bays”).
- Owned-bay caption requires `assignmentsKnown`.
- Reassign requires `assignmentsKnown && ownedBays > 0` (card + manage sheet). Call-out availability still renders from schedule truth.

### 4. Explicitly not done

- No durable cache expansion for people/schedules/ownership.
- No Settings internal fetch optimization (UX-REDUCE-005).
- No Map internal graph rewrite beyond visit-on-demand.
- No schema / RPC / RLS / migration / production mutation.
- No permanent production telemetry (`[PERF-LOAD-002]` markers not retained).

### 5. Duplicate reads

Visit-on-demand removes simultaneous cold-boot Map/Roster/Settings duplication. No cross-tab shared mutable cache added. No intra-tab duplicate request removed beyond Floor’s locations decoupling.

---

## Device acceptance (Samsung)

See final report §34 / CHAT_HANDOFF. Engineering complete ≠ perceived success.

---

## Status

| Item | State |
|------|--------|
| Engineering | COMPLETE |
| Tests | PERF-LOAD-002 contracts + regression suites |
| Samsung acceptance | PENDING |
| PERF-LOAD-003 | NOT STARTED — decide after device acceptance |
| UX-REDUCE-005 | NOT STARTED |
