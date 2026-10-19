# DEPTSYNC-SECTION-OWNERSHIP-004 — Controlled Preview Deployment

**Status:** **PREVIEW READY** — **operator phone acceptance outstanding**  
**Date:** 2026-10-19  
**Mode:** Validate → Preview Deploy → Operator Acceptance  
**Production app:** unchanged @ https://deptsync-hub.vercel.app (`origin/main` = `4ca606d`)  
**Supabase project (shared):** `fmeinlwhixngednabhgy`  

**Authority:** Operator-authorized SECTION-OWNERSHIP-004 controlled preview · no production merge · no migrations · no W44 publish · no production operational mutations  

**Strict exclusions honored:** No push/merge to `main` · no Production Vercel deploy · no migrations · no W44 assignment writes · no standing-capacity change · no AUTO-008 latch/cron change · no claim of operator acceptance until confirmed.

---

## 1. Release candidate verification

| Item | Value |
|------|-------|
| Feature commit | **`a92d85d`** (`a92d85dca80a3de8d5a15ddc9b1e9401543a026a`) — `feat(ux): clarify schedule-free supervisor ownership workflow` |
| Preview safety commit | **`7ea148e`** (`7ea148e9da05e451bed631447c78efa471087230`) — `fix(preview): block API mutations on Vercel preview deployments` |
| Preview branch | `preview/section-ownership-004` @ `7ea148e` (pushed) |
| `origin/main` | **`4ca606d`** (SO-003 docs release) — **not** advanced |
| Local `main` | `a92d85d` (ahead of origin; **not pushed**) |
| Migrations in candidate | **None** |
| Operational mutations in candidate | **None** (UX composition + copy only in `a92d85d`; preview write-guard only in `7ea148e`) |

### `a92d85d` scope (feature only)

13 files / +880 −70: `SupervisorOwnershipWorkflowCard`, `supervisor-ownership-workflow.ts`, Settings/Roster/Sections/Overview/ThisWeek presentation, implementation doc + workflow tests, journal/handoff/roadmap. **No** schema, cron, latch, standing, or publisher changes.

### Supervisor experience presented

1. **Team management** as the primary More workflow entry.
2. **Permanent section ownership** (labeled; Operational Sections).
3. **Temporary weekly coverage** (labeled; capacity explainer — coverage does not multiply capacity).
4. **Optional employee schedules** (demoted disclosure).
5. **Automatic rotation status** (composed; see §2).
6. **Roster ownership / coverage annotations** (Owns / Covering).

---

## 2. Rotation status accuracy

Status is composed by `composeRotationVisibilityStatus` from real inputs only:

| Signal | Source | Representation |
|--------|--------|----------------|
| Automatic publication | `WEEKLY_ROTATION_AUTO_PUBLISH` latch | “scheduler is enabled (**not proof this week was published**)” vs disabled |
| Standing capacity | MasterAdmin `/api/standing-capacity` only | Established (version + sum) or not; non–MasterAdmin sees boundary copy |
| Published assignments | Authoritative Sunday assignment fetch for upcoming week | `published` if count > 0; `pending` if count === 0; `unknown` if fetch fails |
| Upcoming week | `sundayStagingWeekLabel` (store TZ) | Explicit week label |

**Guarantees:** Enabled scheduler ≠ successful publication. W44 is not claimed published before authoritative rows exist (`pending` when count is 0). Standing details respect MasterAdmin authorization.

---

## 3. Preview environment isolation

### Database reality

| Fact | Evidence |
|------|----------|
| Preview shares production Supabase | Project env points at `fmeinlwhixngednabhgy` (same as production); **no** separate preview DB configured |
| Isolation strategy | **Application write-guard** when `VERCEL_ENV=preview` — not DB fork |

### Mutation safety (`lib/preview-safety.ts` + `proxy.ts`)

When `VERCEL_ENV=preview`:

- Block **all** `/api/cron/*` (publication workflows cannot run from preview).
- Block non-GET/HEAD/OPTIONS `/api/*` except `/api/auth/*` and `/api/invite/*` (login/invite remain usable).
- Response: **403** with `Preview is read-only against production data…`

Production (`VERCEL_ENV=production`) and local development are unaffected.

Focused tests: `lib/preview-safety.test.ts` — **5 PASS**.

### Vercel Deployment Protection

Unauthenticated HTTP to the preview hostname returns **401 Protected deployment** (Vercel Authentication / team SSO) before the app. Edge probe of `/api/cron/weekly-rotation` returned HTML login (`x-matched-path: /login`) — cron handler was **not** executed. Phone acceptance requires a **Vercel team member** to pass Deployment Protection, then DeptSync PIN login.

---

## 4. Preview deployment

| Field | Value |
|-------|-------|
| Environment | **Preview** (not Production) |
| Deployed commit | **`7ea148e`** (includes `a92d85d` + write-guard) |
| GitHub deployment | `7187103671` — state **success** |
| Preview URL | **https://deptsync-q2y8ygauv-tyson-zauggs-projects.vercel.app** |
| Vercel dashboard | https://vercel.com/tyson-zauggs-projects/deptsync-hub/6fqkDY2b9mwtiNjQ1aCXM7sebrNP |
| Production alias | Unchanged — https://deptsync-hub.vercel.app |

### Smoke (pre–SSO)

| Check | Result |
|-------|--------|
| Preview Ready | Yes (GitHub status success) |
| Correct commit | `7ea148e` on branch `preview/section-ownership-004` |
| Unauthenticated routes | 401 Vercel Authentication (expected) |
| Production branch | `origin/main` still `4ca606d` |

Authenticated UI checks (login, More → Team, Sections, coverage, rotation status, mobile layout) are **operator phone-acceptance** steps below — not claimed complete here.

---

## 5. Regression validation

| Suite | Result |
|-------|--------|
| SO-002 / SO-003 / SO-004 / enforcement / AUTO-008A / preview-safety / sec-ops-010 + sections authz | **109 PASS** (9 files) |
| TypeScript `tsc --noEmit` | **PASS** |
| ESLint (preview-safety, workflow, card, proxy) | **PASS** |
| `next build` | **PASS** |

### Unchanged operational controls

| Control | Status |
|---------|--------|
| AUTO-008 latch | Untouched vs production |
| Cron `0 12 * * 0` | Identical `vercel.json` on preview tip and `origin/main` |
| Standing policy 3/3/3/3 | No code or data mutation in this mission |
| Permanent owners / existing assignments | No writes |
| Diff `origin/main...HEAD` for latch/cron/standing/migrations | **Empty** (only `lib/preview-safety.ts` + `proxy.ts` beyond SO-004 UX) |

---

## 6. Operator phone acceptance walkthrough

**Preview URL:** https://deptsync-q2y8ygauv-tyson-zauggs-projects.vercel.app  

**Access:** Open URL on phone → complete **Vercel team SSO** (Deployment Protection) → DeptSync **PIN login** as supervisor/MasterAdmin.

**Read-only note:** Coverage save, roster lifecycle writes, and cron publication are blocked on this preview. Inspect UI and status; do not expect successful mutations.

1. **More → Team** — Team management is the primary workflow entry; roster lifecycle is visible.
2. **Permanent section ownership** — Open Operational Sections; confirm permanent owner labeling and ownership controls (view-only if writes blocked).
3. **Temporary weekly coverage** — Confirm temporary weekly coverage UI and capacity explainer; save should fail closed (403) if attempted.
4. **Rotation status** — Confirm scheduler enabled ≠ published; standing shown for MasterAdmin; upcoming week; assignments pending/published from real data (expect **not yet published** for W44 before Oct 25).
5. **Optional schedules** — Confirm shift schedules are demoted/optional, not the primary path.

**Operator acceptance:** **NOT CLAIMED** — awaiting explicit confirmation.

---

## 7. Production release readiness

| Gate | State |
|------|-------|
| Feature complete locally | Yes (`a92d85d`) |
| Preview deployed safely | Yes (`7ea148e` + write-guard) |
| Phone acceptance | **Outstanding** |
| Safe to merge/push `main` | **No** until acceptance + separate release authorization |
| Migrations required | **None** for 004 |
| AUTO-008 first unattended publish | Still **2026-10-25T12:00Z → W44** (independent of this preview) |

**STOP after preview handoff.** Do not deploy to production, apply migrations, publish W44, or mutate production records from this mission.
