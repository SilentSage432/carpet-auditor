# PERF-LOAD-001 — Operational Load Path Audit

> **Mode:** READ-ONLY performance diagnostic. No runtime behavior changes.  
> **Baseline:** `main @ b494b02` — `feat: simplify Roster around people and schedules`  
> **Worktree:** clean except untracked `tmp/`  
> **Date:** 2026-09-18  
> **Production timings:** Not measured from this Cursor environment. Findings are **code-path reconstructed** unless noted.

---

## 1. Repository baseline

| Item | Value |
|------|--------|
| HEAD | `b494b0210a388157bb6027bceda4d0fc066b8630` |
| UX-REDUCE-002 | `405c632` Floor → This Week (field-accepted) |
| UX-REDUCE-003 | `c44881f` Map → Department Coverage (field-accepted) |
| UX-REDUCE-004 | `b494b02` Roster → People & Schedules |
| Dirty work | None (only `tmp/`) |

This audit does **not** change UX-REDUCE-002/003/004.

---

## 2. Boot architecture

```text
T0  Browser/PWA → Next App Router → (workflow) layout
T1  SessionGate reads local auth session (sync-ish from localStorage)
      → splash until ready
      → WorkflowTabShell mounts
T2  Shell paints NavigationHub + workspace
      → ALL allowed primary tabs enter `visited` immediately
      → Floor + Map + Roster + Settings all mount (supervisor/Master)
      → Shell also fires fetchSpecialists() for session sync
T3+ Each mounted tab starts its own data reload
```

**Auth cold start (login path, not every return visit):** Hub PIN → `POST /api/auth/hub-bridge` → `supabase.auth.setSession` → local `auth-session` write → navigate `/dashboard`.

**Warm reopen (typical Samsung return):** SessionGate restores specialist from `readAuthSession()` with **no network**. Operational APIs still need Bearer from `getSupabaseAccessToken()` per `storeOpsFetch`.

---

## 3. WorkflowTabShell mount behavior

**File:** `components/hub/WorkflowTabShell.tsx`

Critical code pattern:

```ts
const [visited, setVisited] = useState<Set<WorkflowTabHref>>(
  () => new Set<WorkflowTabHref>(allowedTabs)
);
```

Plus an effect that adds every `allowedTabs` entry to `visited`.

**Consequence for DS/Master:**

| Tab | Mounted at cold Floor open? | Fetches on mount? |
|-----|----------------------------|-------------------|
| Floor `/dashboard` | Yes (always) | Yes |
| Map `/admin/store-map` | **Yes** (`visited` pre-seeded) | **Yes** (heavy) |
| Roster `/roster` | **Yes** | **Yes** (heavy) |
| Settings `/settings` | **Yes** | Mounts `SettingsSection` tree (eager admin imports) |

Keep-alive itself is not the problem. **Eager visit of every tab at boot** is.

Associates (`isSimplifiedAssociateView`): only Floor + Map in `allowedTabs` — Roster/Settings not mounted. Map still mounts and fetches on associate cold open.

Panels use `opacity` / `inert` / `aria-hidden`; inactive tabs **remain mounted and keep effects/network alive**.

---

## 4. Cold-launch dependency graph (supervisor)

```text
SessionGate ready
  ├─ WorkflowTabShell
  │    ├─ fetchSpecialists()                         [shell session sync]
  │    ├─ FloorTab boot
  │    │    ├─ peekCachedDepartments → peekCachedRotations → peekCachedStoreLocations
  │    │    └─ reload(silent):
  │    │         await fetchDepartments
  │    │         then Promise.all( weekly-rotations, store-locations )
  │    │         then fire loadOnDuty + loadAssignments
  │    │         + attention (supervisor) + exceptions
  │    ├─ MapTab boot (HIDDEN)
  │    │    ├─ peek caches
  │    │    └─ reload: departmentsDetailed, locations, rotations,
  │    │         exceptions, attention, seasonal resolve
  │    ├─ RosterTab boot (HIDDEN)
  │    │    └─ reload: timezone + specialists + shiftDaysRange
  │    │         then sunday_bay_assignments × N home depts
  │    └─ SettingsTab (HIDDEN) — SettingsSection + AisleBayManager imports
```

---

## 5–6. Floor dependency graph & blocking critical path

### What `ThisWeekOwnershipBoard` needs

Composer: `composeThisWeekOwnership({ rotations, assignments, roster, barrierRotationIds })`

| Input | Source | Role for “who has what” |
|-------|--------|-------------------------|
| `weekly_rotations` (+ joined locations) | `/api/weekly-rotations` + IDB peek | **P0** — without rotations, `hasPlan=false`, board does not mount |
| `sunday_bay_assignments` | Direct Supabase client `fetchSundayAssignments` | **P0** for owner names/grouping |
| `shiftTeam` (roster) | `fetchSpecialists` | **P1** — names can fall back to assignment `specialist_name` |
| Barriers | `/api/rotations/exceptions` | **P2** |
| Attention | `/api/store-intelligence/attention` | **P2** |
| On-now strip | tz + specialists + `associate_shift_days` | **P1** supporting |
| `store_locations` full map | `/api/store-locations` | **P2** for ownership board (topology hint only) |
| Seasonal / Floor Pad | separate | **P2/P3** |

**Render gate:** board mounts only when `ownershipPlan.hasPlan` (`physicalBays.length > 0`). Progress line shows “Loading this week…” while `loading && !hasPlan`.

### Floor critical path (network)

```text
1. (optional) IndexedDB peek departments → rotations → locations   [serial peeks]
2. await GET /api/departments                                      [SERIAL gate]
3. await GET /api/weekly-rotations  ||  GET /api/store-locations   [parallel]
4. AFTER (3): fetchSundayAssignments(week)                         [ownership names]
5. AFTER (3): loadOnDuty = tz + specialists + shift days           [On now strip]
6. Parallel-ish: attention, exceptions                             [secondary]
```

**Primary reason Floor feels slow for “who has what”:**

1. **Competition** from Map + Roster (and Settings JS) mounting at the same time.  
2. **Serial departments → rotations** before assignments can start.  
3. **`sunday_bay_assignments` is not on the durable IDB path** — cold open cannot paint owners from cache the way rotations can.  
4. **`store_locations` is tied into the same `Promise.all` as rotations** even though the ownership board does not need the full topology list to show people→bays.

---

## 7–8. Roster dependency graph & blocking critical path

### What People list needs

| Input | Source | Role |
|-------|--------|------|
| `store_specialists` | `fetchSpecialists` (Supabase direct, 45s TTL) | **P0** |
| `associate_shift_days` range | `fetchShiftDaysRange` (Supabase direct) | **P0** for On now / clocks |
| Store timezone | `stores.timezone` | **P0** for TIME-DUTY |
| `sunday_bay_assignments` × home depts | after primary | **P1** (owned-bay captions on call-out) |
| QR/PIN/grants | person detail only | **P3** |

**Render gate:**

```tsx
{loading ? "Loading people…" : displayGroups…}
```

`loading` clears only in `reload().finally(...)`.  
`reload` **awaits sunday assignment fetches for every home department before completing**.

So the People list waits for **P1 ownership context** even though primary rows only need specialists + shifts + timezone.

### Roster critical path

```text
1. Promise.all( timezone, specialists, shiftDaysRange[yesterday‥iso week end] )
2. THEN Promise.all( fetchSundayAssignments per home department )
3. setLoading(false) → paint People
```

**Shift range is wide:** `scheduleFetchWindow` unions yesterday, retail week, and ISO week — up to ~9–14 days of `associate_shift_days` for the whole store.

**Primary reason Roster feels slow:**

1. **Mounted and fetching at Floor cold open** (hidden), then user navigates into a tab that may still be mid-reload or contending.  
2. **UI blocks on sunday assignments** after the already-expensive specialists+schedule fetch.  
3. **No IndexedDB SWR for roster or schedules** — only in-memory 45s TTL / localStorage day overlays; cold open almost always hits live Supabase.  
4. Duplicate specialists work with Floor/shell (mitigated by TTL inflight, but still one large select competing for the device radio).

---

## 9. Map dependency graph

Hidden Map at boot still runs:

- peek departments / locations / rotations  
- `fetchDepartmentsDetailed`  
- `fetchStoreLocationsDetailed`  
- `fetchThisWeekRotations`  
- `fetchExceptionSummary`  
- `fetchLocationAttention` (supervisor)  
- `fetchOperationalContextLocationRelevanceResolve` (seasonal)

Map **shares** department/rotation/location L1 TTL caches with Floor (helpful once one wins), but still adds **attention + seasonal + exceptions** traffic and client composition during Floor’s critical window.

Map is not the reported user pain, but it is a **boot competitor**.

---

## 10. Auth / session bootstrap graph

| Step | Network? | Blocks shell? |
|------|----------|---------------|
| Gate cookie / SessionGate local session | No (warm) | Splash until sync read |
| Hub bridge (cold PIN login only) | Yes | Before dashboard |
| `storeOpsAuthHeadersAsync` → `getSupabaseAccessToken` | Local session read | Per API call |
| Server actor checks on `/api/*` | On each API | Request latency |

Warm reopen: auth is **not** the dominant multi-second story by itself. It is a **prerequisite hop** on every Store Ops API (`Authorization` header). Direct Supabase client reads (roster, shifts, sunday assignments) use the browser Supabase client/JWT separately.

**Duplicate actor work:** Shell `fetchSpecialists` syncs session specialist; Floor/Roster also fetch the same table. Not an auth model problem — redundant roster acquisition.

---

## 11. Relevant network / query inventory

| # | Caller | Endpoint / table | Trigger | Blocks primary? |
|---|--------|------------------|---------|-----------------|
| 1 | WorkflowTabShell | `store_specialists` | shell mount | No (sync) |
| 2 | Floor reload | `GET /api/departments` | Floor boot | Yes (serial before rotations) |
| 3 | Floor reload | `GET /api/weekly-rotations` | after depts | **Yes P0** |
| 4 | Floor reload | `GET /api/store-locations` | with (3) | Couples to P0 path |
| 5 | Floor loadAssignments | `sunday_bay_assignments` | after week known | **Yes P0 owners** |
| 6 | Floor loadOnDuty | `stores` tz + specialists + `associate_shift_days` | after (3) | P1 strip |
| 7 | Floor | `GET /api/rotations/exceptions` | week ready | P2 |
| 8 | Floor | `GET /api/store-intelligence/attention` | dept ready | P2 |
| 9 | Map | same 2–4 + exceptions + attention + seasonal | Map boot | Competes |
| 10 | Roster | specialists + shifts + tz | Roster boot | **Yes P0** |
| 11 | Roster | `sunday_bay_assignments` × depts | after (10) | Blocks paint today |
| 12 | SpecialtyToolsHost | catalogs | open only | P3 |

---

## 12. Serial waterfalls (evidence)

**Floor**

```text
departments  ──await──►  (rotations ∥ locations)  ──then──►  assignments
                                              └──then──►  on-duty bundle
```

**Roster**

```text
(specialists ∥ shifts ∥ tz)  ──await──►  (assignments × homes)  ──►  paint
```

**Floor peek path** also peeks IDB **serially** (depts, then rotations, then locations) before kicking network reload.

---

## 13. Parallel groups already present

- Floor: rotations ∥ locations (after departments)  
- Floor on-duty: tz ∥ specialists ∥ today/yesterday shifts  
- Roster primary: tz ∥ specialists ∥ shift range  
- Roster assignments: homes in `Promise.all`  
- Map: locations ∥ rotations ∥ exceptions ∥ seasonal (after dept resolve)  
- TTL caches: in-flight dedupe for same key  

---

## 14. Duplicate fetches

| Domain | Floor | Map | Roster | Shell |
|--------|-------|-----|--------|-------|
| Departments | Yes | Yes | No | No |
| Weekly rotations | Yes | Yes | No | No |
| Store locations | Yes | Yes | No | No |
| Specialists | Yes (late) | No | Yes | Yes |
| Shift days | Yes (2-day) | No | Yes (wide range) | No |
| Sunday assignments | Yes (1 dept) | No | Yes (N depts) | No |
| Attention | Yes | Yes | No | No |
| Exceptions | Yes | Yes | No | No |
| Seasonal resolve | No | Yes | No | No |

Duplicates are **partially** mitigated by 45s L1 TTL + in-flight maps for Store Ops list GETs and specialists.  
**Not shared:** sunday assignments across Floor vs Roster keys; shift range shapes differ; attention/seasonal still extra Map load.

---

## 15. Hidden-tab background work

**Confirmed:** For supervisor/Master, Map + Roster + Settings mount when Floor opens.

Hidden work includes:

- Map full geography + attention + seasonal network  
- Roster full people+schedule+assignments network  
- SettingsSection **eager static imports** of topology/seasonal/fiscal admin UI (`AisleBayManager`, `OperationalContextCard`, …) — JS parse/eval cost even if those cards idle  

This is the strongest architectural finding of the audit.

---

## 16. Primary vs secondary classification

### Floor

| Priority | Data |
|----------|------|
| **P0** | `weekly_rotations` (active), `sunday_bay_assignments` |
| **P1** | roster names (or assignment names), On now / later strip, dept label |
| **P2** | barriers, attention, seasonal strip, mapped-location empty hint |
| **P3** | Floor Pad, analytics, Snap/specialty, admin recovery chrome |

### Roster

| Priority | Data |
|----------|------|
| **P0** | specialists, today’s (+needed) shift rows, timezone |
| **P1** | weekly ownership captions, next opportunity |
| **P2** | full week matrix in detail (already in range fetch) |
| **P3** | QR, PIN, DeptSync access grants, remove |

### Map

| Priority | Data |
|----------|------|
| **P0** | locations (physical bay pairs), readiness inputs (rotations/completions), barriers |
| **P1** | seasonal badges, attention markers |
| **P2** | service cadence / velocity overlay |
| **P3** | Walk sheet service log detail |

---

## 17. Existing cache behavior

| Layer | What | Helps Floor P0? | Helps Roster P0? |
|-------|------|-----------------|------------------|
| L1 TTL 45s (`ttl-cache`) | departments, rotations, locations, specialists, sunday assignments (`.get` not SWR) | Yes if warm | Specialists only |
| L2 IndexedDB (`cache.ts`) | `store_locations`, `weekly_rotations`, `shift_briefings` (+ departments stuffed under locations key) | **Rotations yes** | **No** |
| localStorage | sync queue; per-day shift overlays; auth session | Indirect | Partial shift overlay |
| Service worker | PWA shell assets | Not operational data | Not operational data |

**Sunday assignments:** memory TTL via `.get()` — **no stale-while-revalidate**, **no IDB**.  
**Schedules / roster:** no durable operational IDB kind.

---

## 18–19. Can ownership / roster use cached evidence today?

| Question | Answer |
|----------|--------|
| Weekly rotations from IDB on Floor? | **Yes** — peek can clear `loading` and set rotations before network |
| Owners from cache? | **No durable cache** — must wait live `sunday_bay_assignments` |
| Roster people from IDB? | **No** |
| Schedules from IDB? | **No** (localStorage day cache exists but range fetch still hits Supabase when online) |

Floor can show **bay list without owners** once rotations peek/network returns; **“who has what”** waits on assignments.

---

## 20. Render / composition hotspots

Likely **secondary** to network on mobile, but real:

- Floor: multiple `composeCurrentAvailability` passes over full roster (onDuty, laterToday, availabilityById)  
- Roster: same per member on each clock tick (`useStoreClockTick`)  
- Map: aisle/bay pairing + readiness over full location set while hidden  
- Physical-bay grouping is cheap relative to RTT on phone networks  

No evidence of an infinite fetch loop; effects are mount/dependency driven.

---

## 21. Bundle / eager-import findings

| Surface | Pattern | Boot impact |
|---------|---------|-------------|
| Floor/Map/Roster | Static imports into shell | Always in workflow chunk |
| SettingsSection | Static `AisleBayManager`, seasonal/fiscal cards | Parsed when Settings mounts (**at boot**) |
| SpecialtyToolsHost | Dynamic scanner/calculator | On event only — good |
| Floor Pad | Not on Floor critical path post UX-REDUCE-002 | Lower |

Opportunity: visit-gated Settings + dynamic import heavy admin — **not implemented here**.

---

## 22. Production vs local evidence

| Source | Status |
|--------|--------|
| Samsung field report | Latency is real and more obvious after UX reduction |
| Code waterfall | Reconstructed above |
| Vercel/Supabase production timings from this environment | **Not available** |
| Exact milliseconds | **Not invented** |

Production mobile radios + TLS + RLS will amplify the eager multi-tab fetch pattern more than desktop localhost.

---

## 23. Time-to-useful-content milestones

Conceptual (ordering only; no fabricated ms):

| Milestone | Meaning | Current blocker |
|-----------|---------|-----------------|
| T0 | Navigation start | — |
| T1 | Shell visible | SessionGate splash |
| T2 | Actor + dept context | Session + departments (Floor) |
| **T3-FLOOR** | Person → bay ownership | Rotations **and** sunday assignments; contended by Map/Roster |
| T4-FLOOR | Attention/barriers/on-now polish | Secondary fetches |
| **T3-ROSTER** | People + availability | Specialists + shifts + tz; **currently also waits assignments** |
| T4-ROSTER | Ownership captions / admin | Assignments, detail sheets |
| T3-MAP | Physical coverage | Locations + readiness; currently at boot |

---

## 24. Top five bottlenecks (ranked by evidence)

1. **Eager multi-tab mount** — Map + Roster (+ Settings) fetch during Floor open.  
2. **Floor ownership waits on post-rotation `sunday_bay_assignments`** with no IDB peek.  
3. **Floor serial `departments` before rotations**, and **locations glued to rotations**.  
4. **Roster `loading` gated on sunday assignments** after P0 people/schedule already available.  
5. **Operational reads that matter most to Roster (people/schedules) lack durable SWR**, so every cold open pays full Supabase RTT under contention.

---

## 25. Optimization opportunities (do not implement yet)

| ID | Opportunity | Impact | Risk | Truth/staleness | Order |
|----|-------------|--------|------|-----------------|-------|
| A | **Visit-on-demand tabs** — seed `visited` with active tab only | **HIGH** | MED | None if fetch on first visit | **1** |
| B | Floor: parallelize / decouple locations from rotations; start assignments ASAP from peeked week | **HIGH** | LOW–MED | None | **2** |
| C | Roster: clear loading after specialists+shifts; defer assignments | **HIGH** | LOW | Captions may lag briefly | **2** |
| D | Durable SWR for sunday assignments (+ optional roster/shifts) with fingerprint revalidate | **HIGH** | MED | Must not invent owners | **3** |
| E | Stop hidden Map attention/seasonal until Map focused | **MED** | LOW | None | **3** |
| F | Dynamic-import Settings admin weight | **MED** | LOW | None | **4** |
| G | Consolidate sunday assignment fetch (one store-week query) | **MED** | MED | Auth/RLS scope check | **4** |
| H | Indexes if EXPLAIN shows seq scans | **MED** | LOW | None | evidence-gated |
| I | Preload Roster **after** Floor T3 | **MED** | MED | Bandwidth trade | after A–C |
| J | Fake optimistic people/assignments | — | — | **FORBIDDEN** | never |

---

## 26. Things that LOOK like optimizations but should NOT be done

- Show last week’s owners as this week’s  
- Invent On now from “usually works days”  
- Disable RLS / broaden JWT to speed queries  
- Fetch “everything” into one blob and block longer  
- Remove keep-alive entirely without visit gating (would remount cost)  
- Weaken PIN/session checks  
- Cache unverified mutations as ownership truth  

---

## 27. Recommended implementation sequence

1. **PERF-LOAD-002A — Boot contention**  
   Visit-gated Map/Roster/Settings; optional pause Map secondary fetches until focused.

2. **PERF-LOAD-002B — Floor P0 path**  
   Decouple locations; overlap assignments with rotations when week known from peek; paint board as soon as rotations+assignments ready.

3. **PERF-LOAD-002C — Roster P0 path**  
   People list unlock after specialists+shifts; assignments P1.

4. **PERF-LOAD-003 — Durable cache expansion**  
   Only after A–C; assignments (± schedules) with strict fingerprint revalidate.

5. UX-REDUCE-005 (More/Admin) **after** boot contention fix so More work does not fight Floor.

---

## 28. One tranche or many?

**One focused PERF-LOAD-002 can deliver most perceived gain** if it includes:

- visit-on-demand tabs, **and**  
- Floor/Roster P0 unlock (stop waiting on P1/P2).

Durable caching and index work should be a **follow-on** once waterfalls are shortened — otherwise cache only speeds a still-contended boot.

---

## 29. Exact files / hooks / routes

| Area | Paths |
|------|-------|
| Shell | `components/hub/WorkflowTabShell.tsx`, `app/(workflow)/layout.tsx`, `components/hub/SessionGate.tsx` |
| Floor | `components/hub/tabs/FloorTab.tsx`, `lib/store-ops/this-week-ownership.ts`, `components/store-ops/ThisWeekOwnershipBoard.tsx` |
| Roster | `components/hub/tabs/RosterTab.tsx`, `components/hub/SpecialistCard.tsx` |
| Map | `components/hub/tabs/MapTab.tsx`, `components/admin/StoreLocationGrid.tsx` |
| Transport | `lib/store-ops/client.ts`, `lib/store-ops/cache.ts`, `lib/store-ops/ttl-cache.ts`, `lib/specialists.ts`, `lib/store-ops/sunday-audit.ts`, `lib/store-ops/shift-status.ts` |
| APIs | `/api/departments`, `/api/weekly-rotations`, `/api/store-locations`, `/api/rotations/exceptions`, `/api/store-intelligence/attention`, `/api/operational-contexts` |
| Direct tables | `store_specialists`, `associate_shift_days`, `sunday_bay_assignments`, `stores` |

---

## 30. Database / index findings

Migrations show indexes on many specialty/fiscal tables.  
This audit did **not** run production `EXPLAIN`.  

Candidates to verify later (read-only):

- `sunday_bay_assignments (store_number, department, week_starting)`  
- `associate_shift_days (store_number, work_date)`  
- `weekly_rotations` active-week filters  

Do not add indexes without evidence.

---

## 31. Security implications

Any speed work must remain fail-closed:

- Keep Bearer/session requirements on Store Ops APIs  
- Do not widen RLS  
- Cached ownership must revalidate; never treat cache as authority over live assignments  
- Visit-gating must not skip role checks (`canAccessWorkflowTab`)  

---

## 32. Offline implications

- Floor already peeks IDB rotations — good offline seed for bay list  
- Missing durable assignments → offline “who owns what” is weak today  
- Roster cold offline depends on localStorage specialist/shift remnants — incomplete for TIME-DUTY  
- Expanding durable cache (later) would improve offline **presentation of last known evidence**, not create new truth

---

## 33. Final assessment

The UX reductions correctly made ownership and people the heroes. The load path still behaves like a **four-tab operations console that warms every surface at once**, then **serializes key ownership/schedule dependencies** behind secondary work.

The delay is **primarily network/data-dependency under boot contention**, not React composition. Existing IndexedDB SWR helps Floor **rotations**, not **owners**, and barely helps Roster at all.

**Smallest high-impact first change:** stop mounting/fetching Map + Roster + Settings until first visit (keep keep-alive after visit), then unlock Floor/Roster P0 without waiting on P1/P2.

---

## Direct answers

**A.** Floor’s “who has what” waits on `weekly_rotations` then live `sunday_bay_assignments`, while Map/Roster (and Settings JS) also mount and fetch at cold open — departments also serialize before rotations.

**B.** Roster blocks the People list until specialists **and** a wide shift-range fetch **and** multi-dept sunday assignments finish; it also starts that work while Floor is still loading.

**C.** Yes — Floor: departments → rotations/locations → assignments. Roster: people/schedule → assignments before paint.

**D.** Yes — departments/rotations/locations (Floor↔Map); specialists (Shell↔Floor↔Roster); assignments (Floor↔Roster with different shapes).

**E.** Yes — for DS/Master, Map + Roster + Settings are visited/mounted at launch and perform work while Floor is active.

**F.** Partially — IDB helps Floor rotations/locations; it does **not** help sunday assignments or Roster people/schedules. L1 TTL helps only within 45s / same session.

**G.** Warm reopen auth is mostly local; each API still resolves a Bearer token. Auth is a prerequisite hop, not the main multi-tab contention story.

**H.** Primarily **network/data dependency and boot contention**. Composition is real but secondary on device.

**I.** Yes — Settings admin graph and Map secondary intelligence load before needed; specialty modals are better (dynamic).

**J.** Yes — Floor can aim for rotations+assignments before attention/locations polish; Roster can aim for people+availability before ownership captions/admin.

**K.** **Visit-on-demand tab mounting** (PERF-LOAD-002A), immediately followed by Floor/Roster P0 unlock (002B/C).

**L.** Yes — those changes preserve authority, offline queue semantics, ownership writers, verification, schedule storage, TIME-DUTY derivation, and physical-bay rules if implemented as fetch timing/UI gating only.

**M.** **Yes — UX-REDUCE-005 should wait** until PERF-LOAD-002 addresses boot contention; More/Admin work would otherwise add more eager surface weight on the same path.

---

*End of PERF-LOAD-001. Do not implement PERF-LOAD-002 in this tranche. Do not begin UX-REDUCE-005.*
