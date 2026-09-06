# DEPT_SYNC_STATE.md

> **Canonical living memory for DeptSync implementation state** (`carpet-auditor` repository).  
> Single source of truth for architecture, parity, routes, and operational status **beneath** `DEPTSYNC_CONSTITUTION.md` (governing laws).  
> Ground-truth audit baseline: **2026-08-25**. Update this file whenever schema, sync behavior, or route structure changes.

---

## 1. System Identity & Tech Stack Snapshot

### Product identity

| Field | Value |
|-------|-------|
| **Product name** | **DeptSync** (PWA `short_name`) |
| **Repository** | `carpet-auditor` |
| **Description** | Department & SIMS Inventory Audit Suite for Lowe's stores — floor bay rotations, specialty scans, roster auth, manager floor pad |
| **Default post-login land** | `/dashboard` (Floor checklist) |
| **Specialty scan hub** | `/` with `?section=audit\|appliances\|department` |

### History integrity (completion attempts)

| Field | Value |
|-------|-------|
| **Parent** | `weekly_rotations` = current operational state |
| **Child** | `weekly_rotation_completion_attempts` = authoritative report/review history |
| **Migration** | `20260905_weekly_rotation_completion_attempts.sql` — **LIVE in production**; app ships with this commit |
| **Gap closed** | DS send-back no longer destroys prior reported-complete evidence |
| **Compatibility** | History skip only when this table is absent (`42P01`/`PGRST205` + table name); auto-verify retry recovers from parent stamps |
| **RESTRICT** | Attempt FK `ON DELETE RESTRICT` — location hard-delete may fail once attempts exist (intentional; soft-delete deferred) |
| **Backfill** | None — legacy verified rows may lack attempts |
| **Lifecycle** | **Awaiting first natural** report/review (do not fabricate rotations) |
| **Privacy** | Actor ids for provenance only; not associate leaderboards |
| **Future intelligence** | Enables first-pass / rework / lag metrics; seasonal correlation needs FS-002+ after fiscal calendar seeded |
| **Fiscal calendar (FS-001)** | Schema **LIVE**; FY2026 **authoritatively seeded** from Lowe's Vendor Gateway PDF; ISO rotation identity unchanged; seasons/events not started |

### Core stack

| Layer | Technology | Version / location |
|-------|------------|------------------|
| Framework | Next.js App Router | `16.2.12` (`package.json`) |
| Edge auth | `proxy.ts` | Replaces `middleware.ts` in Next 16.2 |
| UI | React | `19.2.4` |
| Compiler | React Compiler | `babel-plugin-react-compiler` in `next.config.ts` |
| Language | TypeScript | `^5`, **strict** (`tsconfig.json`) |
| Styling | Tailwind CSS v4 | `@tailwindcss/postcss`, `app/globals.css` |
| Remote DB | Supabase (PostgreSQL + RLS) | `@supabase/supabase-js ^2.110.8`, `@supabase/ssr ^0.12.4` |
| Validation | Zod | `^4.4.3` |
| Rich text | TipTap | `^3.30.0` — Executive Floor Pad |
| AI | Google Generative AI | `@google/generative-ai ^0.24.1` (Gemini routes) |
| Push | web-push | `^3.6.7` |
| Toasts | Sonner | `^2.0.8` |
| Icons | lucide-react | `^1.31.0` |
| PWA | Custom service worker | `public/sw.js`, `app/manifest.ts` |
| Deploy cron | Vercel | `vercel.json` — `/api/cron/weekly-rotation` Sunday `0 11 * * 0` UTC |

### Storage architecture (dual-tier)

```
┌─────────────────────────────────────────────────────────────────┐
│ REMOTE — Supabase PostgreSQL + RLS                              │
│   48 migrations in supabase/migrations/ + baseline schema.sql │
│   Access: browser client (JWT) + API routes (service role)      │
│   No Postgres RPCs called from application TypeScript           │
└─────────────────────────────────────────────────────────────────┘
                              ▲
                              │ sync queue replay / live writes
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ LOCAL — Client persistence                                      │
│                                                                 │
│  WRITE QUEUE (authoritative for offline mutations)              │
│    localStorage: carpet_hub_sync_queue                          │
│    Owner: lib/sync-queue.ts                                     │
│                                                                 │
│  ENTITY OFFLINE STORES (optimistic + merge on fetch)            │
│    carpet_audits_offline, carpet_catalog_offline,               │
│    carpet_remnants_offline, carpet_specialists_offline,         │
│    appliance_catalog_offline, appliance_scans_offline           │
│                                                                 │
│  READ CACHE — Store Ops SWR (NOT write authority)               │
│    IndexedDB: deptsync-store-ops (version 1)                    │
│    Object stores: store_locations, weekly_rotations,            │
│                   shift_briefings                               │
│    Owner: lib/store-ops/cache.ts                                │
│                                                                 │
│  EPHEMERAL / SESSION                                            │
│    carpet_hub_store_number, carpet_hub_auth_session,            │
│    theme prefs, admin dept pin, shift/downstock task caches     │
└─────────────────────────────────────────────────────────────────┘
```

**Read path (Store Ops lists):** in-memory TTL **45s** (`lib/store-ops/ttl-cache.ts`) → IndexedDB peek (`hydrateThenRevalidate`) → live Supabase/API revalidation → fingerprint-gated React update.

**Not Dexie:** IndexedDB is raw `indexedDB.open()` — no Dexie dependency.

### Key configuration keys

| Key | Purpose |
|-----|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser client |
| `SUPABASE_SERVICE_ROLE_KEY` | API routes / admin writes |
| `HUB_MASTER_PIN` | **Required** for Master PIN login / bootstrap — no default; unset = Master PIN unavailable |
| `HUB_GATE_SECRET` | Recommended HMAC for hub gate + QR pair (else `CRON_SECRET` / service role chain) |
| `BOOTSTRAP_SECRET` | Optional; `POST /api/auth/bootstrap-admin` (else `CRON_SECRET`) |
| `HUB_BOOTSTRAP_STORE_NUMBER` | Optional store for Master Admin bootstrap |
| `GEMINI_API_KEY` / `GEMINI_MODEL` | Snap Bay, Copilot, taxonomy AI (optional) |
| VAPID keys | Web Push (`lib/push/*`) |
| Twilio env / `SMS_INVITE_WEBHOOK_URL` | Roster invite SMS |
| `CRON_SECRET` | Weekly rotation cron auth (+ signing/bootstrap fallback) |
| Hub gate HMAC | `lib/auth-gate.ts` — `deptsync_hub_gate` cookie |

Canonical env comments live in `.env.example`. Placeholder detection: `lib/supabase/env.ts` rejects obvious placeholder URLs/keys.

### npm scripts

```json
"dev" | "build" | "start" | "lint" | "typecheck" | "test"
```

**Test runner:** Vitest (`vitest.config.ts`) — `lib/sync-queue.test.ts` covers quarantine engine (7 cases). Run `npm test`.

### Primary documentation map

| File | Role |
|------|------|
| `DEPTSYNC_CONSTITUTION.md` | **Governing laws** — purpose, authority, anti-drift (outranks this file on principle) |
| `ARCHITECTURE.md` | Module ownership index |
| `APP_LAYOUT_MAP.md` | UI layout & z-index |
| `MASTER_ROADMAP.md` | Historical completion checklist |
| `DEPT_SYNC_STATE.md` | **This file — canonical implementation state** |
| `AGENTS.md` | Next.js 16 agent rules |

---

## 2. Architectural Guardrails & Coding Principles

### Offline-first contract

1. **Optimistic UI mutations** for sync-queue domains must:
   - Write to the appropriate localStorage entity store immediately.
   - Enqueue via `enqueueSyncAction()` or `enqueueOrExecute()` in `lib/sync-queue.ts`.
   - Mark rows `offline: true` where applicable.
2. **Read path** for Store Ops map/floor:
   - L1 TTL (45s) → IndexedDB SWR peek → network → update only when fingerprint changes (`lib/store-ops/cache.ts`).
3. **Never treat IndexedDB or shift/downstock localStorage caches as write authority** — comments in `downstock.ts`, `shift-tasks.ts`, `shift-status.ts` enforce live-first writes with cache mirroring successful rows only.
4. **Bulk location writes** must call `invalidateStoreOpsListCaches()` and dispatch `deptsync:store-locations-changed`.

### Sync queue contract (`lib/sync-queue.ts`)

| Mechanism | Behavior |
|-----------|----------|
| Storage | `localStorage` key `carpet_hub_sync_queue` |
| Action types | 17 types — 6 upsert domains + deletes + 3 Store Ops (`STORE_OPS_COMPLETE_ROTATION`, `STORE_OPS_DOWNSTOCK_ADD`, `STORE_OPS_SUNDAY_ASSIGN`) |
| Dedup | Same `type` + `store_number` + entity key replaces prior queued item |
| Network | `navigator.onLine` only — **no heartbeat** |
| Auto-flush | `online`, `focus`, `visibilitychange` via `installSyncAutoFlush()` |
| Backoff | Exponential: base 2s, cap 5min |
| Conflict | LWW via `base_updated_at` / `created_at` vs server `updated_at`; UI via `ConflictResolutionModal` |
| Replay order | **FIFO sequential** — no topological dependency ordering |

Event bus: `carpet-sync-queue-changed` — header/Settings must listen.

### State management

- **Keep-alive shell:** `app/(workflow)/layout.tsx` → `WorkflowTabShell` mounts Floor / Map / Roster / More in a fixed `h-dvh` `.hub-app-shell`. Each tab panel is `absolute inset-0 overflow-y-auto` (primary scroll owner) with opacity/visibility transitions. Bottom nav stays fixed; `.hub-main` uses `--hub-workspace-pad-bottom`. Bottom nav uses a sliding active pill (`hub-nav-active-pill`).
- **Working department pin:** `lib/use-working-department.ts` + `lib/admin-department-context.ts` — `useSyncExternalStore`; pin change does **not** wipe IndexedDB.
- **Custom events:** `deptsync:*` namespace (store-locations-changed, downstock, shift-tasks, sync-conflict, etc.).
- **No external state libraries** — no Redux, Zustand, Jotai, Recoil in `lib/`.

### Payload safety

- **Bay snap uploads:** client compress in `components/store-ops/VisualBayScannerModal.tsx` — max edge **960px**, JPEG quality **0.70**.
- **API cap:** `app/api/ai/bay-audit/validate/route.ts` rejects base64 payloads **> 1,500,000** chars.
- **Retired:** unbounded canvas synthesis (`/api/store-ops/ai-note-summary` returns **410 Gone**).

### RBAC & store scoping (dual enforcement)

```
Browser request
  → proxy.ts (HttpOnly hub gate cookie OR public path allowlist)
  → SessionGate (workflow routes — valid specialist actor)
  → lib/rbac.ts / lib/nav-hub.ts (section + tab visibility)
  → Supabase RLS (JWT app_metadata: store_number, department, role)
  → API routes with service role where Hub-bridge issues JWT
```

- **Master Admin:** cross-department; header `AdminDepartmentSwitcher`.
- **Supervisor (DS):** department-scoped via `assigned_department` + `accessible_departments`.
- **Associate (CSA):** simplified 2-tab nav (My Shift + Map); `floor_title` Specialist vs CSA orthogonal to platform role.
- **RLS lockdown:** `supabase/migrations/20260817_rls_security_lockdown.sql` — closes anon/open SELECT; JWT helpers: `jwt_matches_store`, `jwt_matches_department_code`, `jwt_is_elevated`, `jwt_app_role`.

### Composition rules (from project philosophy)

- Presentation renders; domain modules own persistence.
- Store Ops completion stats: consume canonical profiles — do not recompute battle stats in UI.
- Before new services: check whether existing modules compose (`lib/store-ops/*`, `lib/sync-queue.ts`).

### Realtime lifecycle

- `lib/store-ops/realtime.ts` — one shared Supabase channel per logical name; refcounted listeners; last unsubscriber removes channel.

---

## 3. Database Schema & Parity Register

**Schema source:** `supabase/schema.sql` + `supabase/migrations/*.sql`.  
**TypeScript types:** hand-written in `lib/types.ts`, `lib/store-ops/types.ts` — **no `database.types.ts`**.

### Live specialty drift (2026-09-05 audit — pending migration apply)

| Table | Live (pre-parity) | Hub contract | Status |
|-------|-------------------|--------------|--------|
| `carpet_catalog` | **Hub canonical live** (M2 applied 2026-09-05); **0 rows**; store RLS | `sku` / `store_number` / SIMS; unique `(store_number, sku)` | **APPLIED** |
| `carpet_remnants` | **Hub canonical live** (M2 applied 2026-09-05); **0 rows**; store RLS | Hub remnant + markdown + `updated_at` | **APPLIED** |
| `store_specialists` | Hub-aligned; **`home_department` now live** (M1 applied 2026-09-05; all NULL, no backfill) | Nullable `home_department`; `assigned_department` canonical | M1 **APPLIED** (specialty M2 also live) |

Until applied, production Hub falls back to localStorage for catalog/remnants; roster uses specialty select fallback. No app deploy required for the parity fix.

### Remote table register (19 tables)

| # | Table | Primary key | Purpose |
|---|-------|-------------|---------|
| 1 | `carpet_audits` | `id` (uuid) | Flooring/SIMS cycle audit log |
| 2 | `carpet_catalog` | `id` (uuid); unique `(store_number, sku)` | Master SKU catalog |
| 3 | `carpet_remnants` | `id` (uuid) | Remnant rack inventory |
| 4 | `store_specialists` | `id` (uuid); unique `(store_number, name)` | Roster, PIN, auth link, dept access (`home_department` optional) |
| 5 | `appliance_catalog` | `id`; unique `(store_number, item_number)` | Appliance master catalog |
| 6 | `appliance_scans` | `id` (uuid) | Appliance floor/showroom scans |
| 7 | `stores` | `id` (uuid) | Multi-store registry + Sunday cron settings |
| 8 | `departments` | `id` (uuid); unique `code` | Lowe's dept codes + weekly bay targets |
| 9 | `profiles` | `id` → `auth.users` | Supabase Auth RBAC |
| 10 | `store_locations` | `id`; unique `(department_id, aisle, bay, type)` | Aisle/bay topology |
| 11 | `weekly_rotations` | `id`; unique `(location_id, assigned_week)` WHERE active | Weekly bay assignment rows |
| 11b | `weekly_rotation_completion_attempts` | FK → `weekly_rotations` ON DELETE RESTRICT; one PENDING per rotation | Report/review history — **LIVE in production**; first natural lifecycle pending |
| 11c | `fiscal_years` / `fiscal_weeks` | Unique `fiscal_year`; weeks unique `(fiscal_year_id, fiscal_week)` | FS-001 LIVE; **FY2026 seeded** (52 weeks, Sat–Fri); holidays not imported |
| 12 | `sunday_bay_assignments` | composite | Sunday specialist↔bay staging |
| 13 | `downstock_queue` | — | Top-stock / packdown flags |
| 14 | `rotation_exceptions` | — | Mid-week barrier reasons |
| 15 | `associate_shift_days` | — | Daily schedule / call-out |
| 16 | `shift_walk_tasks` | `id` | Floor-walk Copilot dispatched tasks |
| 17 | `manager_notes` | `id` | Executive Floor Pad persistence |
| 18 | `bay_service_logs` | — | IRP walk-the-floor service touches |
| 19 | `bay_audit_logs` | `id` | AI Snap Bay verdict persistence |

**Additional table (push, not counted in core 19):** `push_subscriptions`.

**RLS alias note** (from lockdown migration comments):
- `sunday_audit_assignments` → **`sunday_bay_assignments`**
- `department_downstock_items` → **`downstock_queue`**

### Parity matrix

| Table | Local layer | Sync status | Parity notes |
|-------|-------------|-------------|--------------|
| `carpet_audits` | `localStorage` `carpet_audits_offline` | **Queued** upsert/delete | Has `updated_at` + trigger (`20260825_carpet_audits_updated_at.sql`) |
| `carpet_catalog` | `carpet_catalog_offline` | **Queued** | `onConflict: store_number,sku`; has `updated_at` |
| `carpet_remnants` | `carpet_remnants_offline` | **Queued** | Markdown fields aligned |
| `store_specialists` | `carpet_specialists_offline` | **Queued** | `onConflict: store_number,name`; rich roster columns via migrations |
| `appliance_catalog` | `appliance_catalog_offline` | **Queued** | |
| `appliance_scans` | `appliance_scans_offline` | **Queued** | incl. `clear_appliance_scans`, `lock_appliance_showroom_baseline` |
| `store_locations` | IndexedDB read cache | **Online-only writes** | `/api/store-locations*`; `aisle` is TEXT (alphanumeric) |
| `weekly_rotations` | IndexedDB read cache | **Complete via queue** | `STORE_OPS_COMPLETE_ROTATION` |
| `shift_briefings` | IndexedDB derived cache | Read-only SWR | Computed client-side, not a DB table |
| `downstock_queue` | localStorage cache `deptsync_downstock:*` | **Add queued** | Cache mirrors live rows only |
| `sunday_bay_assignments` | event bus + API | **Assign queued** | `STORE_OPS_SUNDAY_ASSIGN` |
| `shift_walk_tasks` | localStorage cache | **Online-only** | `requireClient()` throws offline |
| `associate_shift_days` | localStorage cache | **Online-only** | |
| `manager_notes` | none | **Online-only** | Realtime subscription |
| `bay_audit_logs` | none | **Online-only** | API insert after Gemini/local verdict |
| `bay_service_logs` | none | **Online-only** | |
| `rotation_exceptions` | none | **Online-only** | `/api/rotations/exceptions` |
| `push_subscriptions` | Browser PushSubscription | **Online-only** | |
| `departments` / `stores` / `profiles` | TTL memory | Server/API | |

### Known parity gaps (do not assume parity)

1. ~~**`carpet_audits` missing `updated_at`**~~ — resolved in `20260825_carpet_audits_updated_at.sql`.
2. **Supervisor tables online-only** vs **floor audit tables queued** — offline floor associate can complete bays and log scans; cannot dispatch walk tasks, edit schedules, or save Floor Pad notes.
3. **Topology CRUD online-only** — cannot bulk-add bays offline; queued rotation complete may reference locations that exist only if previously synced.
4. **No multi-device queue merge** — sync queue is device-local; LWW at flush time only.
5. **Hand-written TS types** — schema drift risk without generated Supabase types.
6. ~~**Quarantine UI not yet wired**~~ — `SyncQueuePanel` in Settings Device & sync accordion.

---

## 4. Module Inventory & Operational Status

### Complete / production-shaped

| Module | Owner / entry points | Evidence |
|--------|---------------------|----------|
| Layer-1 rotation metrics | `lib/store-ops/rotation-metrics.ts` (`weekly-rotation-metrics-v1`) | Floor / health / rollup / Map consume; Art VI A-1; **active rows only** |
| Weekly rotation history | `superseded_at` + `20260905_weekly_rotations_superseded.sql`; `rotation-history.ts` | Force Draw supersedes incomplete stages; pre-migration deletes UNKNOWN |
| Completion-attempt history | `weekly_rotation_completion_attempts` + `completion-attempt-history.ts` | Schema **LIVE**; send-back preserves attempts; first natural lifecycle pending |
| Verification authority (UX-002) | Floor strip → `SupervisorAuditSummaryModal` → `review_action`; week stamp via `verifyWeeklyRotations` only after true verify_all | **IMPLEMENTED** — false Shift Analytics empty-ID CTA + `verifyAllCompletedBays` removed; sole bay-review owner = modal; legacy empty-ID API hardening deferred; no schema/backend semantic change |
| Floor decision hierarchy (UX-003) | `FloorTab` reorder + `composeFloorFreshnessLine` + `shouldShowFloorAttentionSummary` | **IMPLEMENTED** — identity → verify → week state → work → SI → fiscal → More tools; Open issues rename; quiet SI demoted; no backend/LAB/REC/Map handoff |
| Fiscal calendar (FS-001) | `fiscal_years` / `fiscal_weeks` + `fiscal-calendar.ts` + `GET /api/fiscal-calendar` | Schema **LIVE**; **FY2026 COMPANY_PUBLISHED seeded**; ISO `assigned_week` unchanged; seasons/events/pressure deferred |
| Fiscal calendar coverage (FS-001A min) | `computeFiscalCoverage` + `GET /api/admin/fiscal-calendar/coverage` + Settings `FiscalCoverageCard` | Derived on read; Master-only signal; **no** discovery/promote/cron/push/persistence |
| Operational seasons/events (FS-002) | `operational_contexts` + relevance + `operational-context.ts` + APIs + Settings card | Master-declared foundation LIVE; empty seed valid; no SI / location priority |
| Floor fiscal/season strip (FS-002B) | `floor-operational-context.ts` + `FloorOperationalContextStrip` on Floor | Fiscal + active context + current dept relevance; empty OK; non-blocking |
| Location seasonal relevance (FS-003) | `operational_context_location_relevance` + domain/API + Settings assign | Declared only; empty seed valid; no rotation/priority/SI/Map |
| Map seasonal badges (FS-003B) | `map-location-context.ts` + MapTab / StoreLocationGrid / Walk sheet | Batched resolve; UNSET omit; NONE detail-only; no heatmap overload |
| Location attention pressure (SI-001) | `location-attention-pressure.ts` + `location-eligibility.ts` (`location-attention-pressure-v1`) | **Foundation LIVE** (pure Layer-1 engine); confidence≠actionability; seasonal scale differentiated |
| Attention read API (SI-001A) | `location-attention-read-model.ts` + `GET /api/store-intelligence/attention` | **FOUNDATION IMPLEMENTED** / LIVE in build; hybrid degradation; Case B barriers independent of rotation failure when exceptions empty |
| Map attention surface (SI-001B) | `location-attention-presentation.ts` + MapTab / StoreLocationGrid / WalkTheFloorSheet | **LIVE** on production `88da2e8`; MEDIUM/HIGH cell marker only; seasonal copy from SI `effect`; `As of` device-local; Master all needs department; failure-independent; no sort/filter/heatmap |
| Floor attention summary (SI-001C) | `location-attention-summary.ts` + `FloorAttentionSummary` + FloorTab | **LIVE — CLOSED** (`21e1a72` in production `88da2e81cfd14e841947f012dd1b1aaa63887ea9`, manual Vercel confirmation); pure MEDIUM/HIGH tier counts; independent Floor SI fetch; Master all gated; staging/shift do not refetch SI; verify/barrier success notifies locations-changed |
| Operational Priority (SI-002) | — | **DEFERRED / NOT IMPLEMENTED** (2026-09-06 audit). Explored; name/concept rejected (overloaded + command risk); constraint-aware consideration possible but insufficient Day-1 value beyond SI-001. Deliberate deferral — not a technical failure. No evaluator/API/UI/schema/score/ranking/rotation coupling. Current Attention remains final current-state intelligence until recommendation architecture needs a stronger intermediate boundary. |
| Department Operational Capacity (CAP-001) | — | **NOT IMPLEMENTED** (2026-09-06 audit). Inferred bay capacity unsupported. Rejected: people×3, hours÷productivity, weekly target as capacity, person-specific productivity, inferred absorption. `weekly_bay_target` remains desired staging volume / operational target. Shift hours valid for relative assignment only — do not prove bay capacity. No second Planning Allowance. Capacity deferred until recommendation proves need. |
| Department Labor Availability (LAB-001) | `labor-availability.ts` (`department-scheduled-labor-v1`) | **FOUNDATION IMPLEMENTED** — pure day-scoped scheduled-labor evidence; known≠8; persisted rows only; conflict → `CONFLICTING_SHIFT_DAY`; unavailable → null; gross scheduled hours include call-out; home attribution; 53 tests; no API/UI/schema/capacity. Not LIVE (no runtime consumer). CAP-001 deferred. |
| Department Staging Consideration (REC-001) | `staging-consideration.ts` (`department-staging-consideration-v1`) | **FOUNDATION IMPLEMENTED** — pure staging-consideration evaluator; SI MEDIUM/HIGH + ACTIONABLE + unstaged; full pool (never truncated to deficit); deficit = planning context only; SI material conflicts (deficit > 0) → UNAVAILABLE; 46 tests; no rank/score/LAB/API/UI/schema/persistence/mutation. Not LIVE (no runtime consumer). |
| Auth & hub gate | `proxy.ts`, `lib/auth-gate.ts`, `AccessGate`, `AuthWall` | Cookie + JWT + RLS |
| Roster / PIN / invite / QR pair | `lib/specialists.ts`, `app/pair/page.tsx`, `app/auth/verify/[token]`, `/api/roster/*` | End-to-end onboarding |
| Floor bay rotations (Zebra) | `ZebraChecklist.tsx`, `completeRotation()`, `/api/rotations/complete` | Optimistic UI + offline queue |
| Weekly rotation generate | `lib/store-ops/rotations.ts`, `/api/rotations/generate`, cron | Vercel Sunday cron |
| Sunday audit balancer | `lib/store-ops/sunday-audit.ts`, `SundayAuditStagingCard` | Queued assignments |
| Downstock flags | `lib/store-ops/downstock.ts`, `FlagDownstockSheet` | Queued adds |
| Rotation barriers | `BarrierReasonChips`, `/api/rotations/exceptions` | Online persist |
| Store map / heatmap | `MapTab.tsx`, `lib/heatmap/bay-tracker.ts` | IndexedDB SWR |
| Bay topology CRUD | `AisleBayManager`, `BulkLocationGenerator`, `/api/store-locations/bulk` | Online |
| Flooring cycle / SIMS audit | `CycleAuditSection`, `lib/storage.ts` | Offline sync |
| Appliance scans + baseline | `ApplianceAuditSection`, `lib/appliance-scans.ts` | Offline sync |
| Generic department audit | `DepartmentAuditSection.tsx` | Uses `lib/storage` + `lib/catalog` |
| Catalog quick-add | `QuickAddCatalogModal`, `lib/catalog.ts` | Offline sync |
| Remnant rack & markdown | `RemnantSection`, `lib/remnants.ts` | Offline sync |
| Push notifications | `lib/push/*`, `/api/push/*` | Requires VAPID + user grant |
| Conflict resolution UI | `ConflictResolutionModal`, `lib/sync-conflict.ts` | Wired in root layout |
| Offline banner + flush | `OfflineNetworkBanner`, `installSyncAutoFlush` | Root layout |

### Partial / online-only or env-dependent

| Module | Limitation | Entry points |
|--------|------------|--------------|
| Shift walk / Copilot dispatch | Parse works; **persist requires online** | `lib/store-ops/shift-tasks.ts`, `/api/copilot/parse-walk` |
| Associate schedule / call-out | **Online-only** writes | `lib/store-ops/shift-status.ts`, `AssociateScheduleModal` |
| Manager notes / Floor Pad | **Online-only** Supabase CRUD | `lib/store-ops/manager-notes.ts`, `ExecutiveFloorPad.tsx` |
| Snap Bay AI audit | Requires network + Gemini; local fallback verdict | `VisualBayScannerModal`, `/api/ai/bay-audit/validate` |
| Push alerts | Env + permission dependent | `lib/push/usePushNotifications.ts` |
| SMS invite dispatch | Twilio or webhook; else console stub | `lib/onboarding/sms-dispatch.ts` |

### Stubs / missing / technical debt

| Item | Status | Location |
|------|--------|----------|
| Enterprise topology ingest | **Stub** — validates, does not write | `app/api/v1/topology/ingest/route.ts` |
| Enterprise freight stage | **Stub** — validates, does not queue | `app/api/v1/freight/stage/route.ts` |
| Automated test suite | **Missing** | No vitest/jest/playwright in `package.json` |
| Sync queue quarantine | **Resolved (Phase 1)** | `lib/sync-queue.ts`, `components/settings/SyncQueuePanel.tsx` |
| Generated DB types | **Missing** | No `database.types.ts` |
| Catalog standalone page | **Redirect** | `app/catalog/page.tsx` → `/appliances` |
| `InviteOnboardingView` | **Orphaned** | `components/auth/InviteOnboardingView.tsx` |
| AI note summary API | **Retired 410** | `app/api/store-ops/ai-note-summary/route.ts` |

---

## 5. Navigation & Route Registry

### Active user routes

| Route | Component / behavior | Layout |
|-------|---------------------|--------|
| `/login` | `AccessGate` — public sign-in | Root |
| `/dashboard` | Floor tab (`FloorTab` via `WorkflowTabShell`; page returns `null`) | `(workflow)` |
| `/admin/store-map` | Map tab (`MapTab`) | `(workflow)` |
| `/roster` | Roster tab (`RosterTab`) | `(workflow)` |
| `/settings` | Settings tab (`SettingsTab`) | `(workflow)` |
| `/` | Specialty scan hub (`app/page.tsx`) — `?section=` | Root |
| `/pair` | QR pairing + PWA install prompt | Root (public) |
| `/auth/verify/[token]` | Invite / PIN reset consume | Root (public) |

### Legacy redirect registry (bookmark preservation)

| Legacy path | Redirect target |
|-------------|-----------------|
| `/appliances` | `/?section=appliances` |
| `/catalog` | `/appliances` |
| `/flooring` | `/dashboard` + Sunday drawer |
| `/sunday-audit`, `/sunday-rotation` | `/dashboard` + Sunday drawer (`requestSundayAuditDrawer()`) |
| `/manager-notes` | `/dashboard#floor-pad` |
| `/stock`, `/department`, `/verify-rotation` | `/dashboard` |
| `/admin/exceptions` | `/dashboard` |
| `/admin/supervisors`, `/admin/roles` | `/roster` |
| `/access-gate`, `/auth` | `/login` |
| `/invite`, `/invite/[token]` | `/auth/verify/[token]` |

### Primary bottom navigation (`lib/nav-hub.ts`)

| Tab | Href | CSA label |
|-----|------|-----------|
| Floor | `/dashboard` | **My Shift** |
| Map | `/admin/store-map` | Map |
| Roster | `/roster` | Hidden from CSA |
| Settings | `/settings` | Hidden from CSA |

**Role rules:**
- **CSA / simplified associate:** 2-column nav — My Shift + Map only (`isSimplifiedAssociateView` in `lib/rbac.ts`).
- **Supervisor / Master Admin:** 4-column nav — Floor · Map · Roster · Settings.
- **Specialty scans:** not bottom-nav tabs; accessed via `/?section=audit|appliances|department` or department defaults (`specialtyHubHref()`).

### Settings hash tools (`SETTINGS_TOOL_HASHES`)

`#bulk-generate`, `#map-management`, `#topology`, `#bay-setup`, `#weekly-rotation`, `#manager-notes`, `#s-pen-notes`, `#floor-pad`, `#admin-tools`, `#sunday-schedule`, `#taxonomies`, `#remnants`, `#remnants-calculator`

### Auth guard chain

```
proxy.ts → SessionGate (workflow) → canAccessWorkflowTab / canAccessSection
```

Public paths: `lib/auth-gate.ts` `isAuthGatePublicPath()` — login, pair, verify, static assets, cron with secret.

---

## 6. Active Technical Debt & Known Blockers

### P0 — ship blockers / operational risk

| ID | Issue | Location | Impact |
|----|-------|----------|--------|
| P0-1 | **Sync queue test coverage** | `lib/sync-queue.test.ts`, `npm test` | **Partial** — queue engine covered; broader CI smoke tests remain Phase 4 |
| P0-2 | **Shift walk tasks fail hard offline** | `lib/store-ops/shift-tasks.ts` `requireClient()` | Supervisors lose Copilot dispatch on dead zones |
| P0-3 | **Associate schedule / call-out online-only** | `lib/store-ops/shift-status.ts` | Call-out rebalancing unavailable offline |

### P1 — sync & data integrity

| ID | Issue | Location | Impact |
|----|-------|----------|--------|
| P1-1 | **No sync queue quarantine** | `lib/sync-queue.ts`, Settings panel | **Resolved** |
| P1-2 | **`carpet_audits` missing `updated_at`** | `20260825_carpet_audits_updated_at.sql` | **Resolved** |
| P1-3 | **Hand-written TS types** | `lib/types.ts`, `lib/store-ops/types.ts` | No `database.types.ts`; drift risk |
| P1-4 | **Enterprise ingest stubs** | `/api/v1/topology/ingest`, `/api/v1/freight/stage` | External systems cannot feed data |

### P2 — feature gaps

| ID | Issue | Location | Impact |
|----|-------|----------|--------|
| P2-1 | **Manager notes online-only** | `lib/store-ops/manager-notes.ts` | Floor Pad lost offline |
| P2-2 | **Topology CRUD online-only** | `/api/store-locations/*` | Cannot bootstrap bays offline |
| P2-3 | **SMS stub without Twilio** | `lib/onboarding/sms-dispatch.ts` | Invites require manual link copy |
| P2-4 | **No sync topological ordering** | `lib/sync-queue.ts` FIFO replay | Parent/child write ordering not enforced |

### P3 — cleanup / contributor confusion

| ID | Issue | Location | Impact |
|----|-------|----------|--------|
| P3-1 | **Orphaned `InviteOnboardingView`** | `components/auth/InviteOnboardingView.tsx` | Dead code; verify page owns UI |
| P3-2 | **`dashboard/page.tsx` returns `null`** | `app/(workflow)/dashboard/page.tsx` | Intentional keep-alive pattern — document for newcomers |
| P3-3 | **`installSyncAutoFlush` single-install guard** | `lib/sync-queue.ts` | Edge-case duplicate listener risk on exotic remounts |

---

## 7. Living Operational Roadmap & Work-in-Progress Tracker

> Check boxes as phases complete. Link PRs/commits inline when closing items.

### Phase 1: Critical sync hardening & quarantine handling ✅

- [x] Add `updated_at` column to `carpet_audits` (migration + TS types + sync conflict parity)
- [x] Implement sync queue **quarantine** after N permanent failures (4xx) with supervisor surfacing in Settings
- [x] Add queue item inspection UI (`components/settings/SyncQueuePanel.tsx`)
- [x] Document offline capability matrix in Settings (`lib/offline-capability.ts`)
- [ ] Evaluate heartbeat / fetch probe beyond `navigator.onLine` (deferred)

### Phase 2: Offline resilience for supervisor shift workflows

- [ ] Queue or graceful-degrade `shift_walk_tasks` writes (`lib/store-ops/shift-tasks.ts`)
- [ ] Queue or graceful-degrade `associate_shift_days` / call-out (`lib/store-ops/shift-status.ts`)
- [ ] Manager notes offline draft + queue (or explicit read-only offline mode with clear UX)
- [ ] Sunday assignment + rotation complete already queued — verify multi-tab flush under load

### Phase 3: Screen redesigns & touch-optimized floor views

- [x] Floating pill bottom navigation (`components/hub/BottomNav.tsx`) — Floor · Map · Roster · More
- [x] Sliding active pill indicator + fluid keep-alive tab transitions (opacity/visibility, no remount flicker)
- [x] Central Floor workspace container with top rail, supervisor bar, and filter chips (`components/hub/tabs/FloorTab.tsx`)
- [x] More tab reorganized into Floor Utilities / Store Management / Device & Diagnostics (`components/sections/SettingsSection.tsx`)
- [x] 48px bay completion touch targets (`.btn-quick-touch` min-h-12)
- [ ] Remnant card density reduction (noted in `APP_LAYOUT_MAP.md` D.3)
- [ ] Continued handheld target sizing audit across legacy surfaces

### Phase 4: Schema parity, type generation & CI smoke testing

- [ ] Run `supabase gen types` → commit `database.types.ts` (or equivalent)
- [ ] Align `lib/types.ts` / `lib/store-ops/types.ts` with generated types
- [ ] Add vitest or playwright smoke suite: auth gate, sync queue replay, rotation complete API — **sync queue unit tests done** (`lib/sync-queue.test.ts`)
- [ ] CI pipeline: `typecheck` + `build` + smoke tests on PR
- [ ] Wire enterprise ingest stubs to real `store_locations` / `downstock_queue` persistence (when product ready)

---

## Appendix A — Sync queue action types

```typescript
// lib/sync-queue.ts — SyncActionType
"upsert_audit" | "upsert_catalog" | "upsert_remnant" | "upsert_specialist"
| "upsert_appliance_catalog" | "upsert_appliance_scan"
| "delete_audit" | "delete_catalog" | "delete_remnant" | "delete_specialist"
| "delete_appliance_catalog" | "delete_appliance_scan"
| "clear_appliance_scans" | "lock_appliance_showroom_baseline"
| "STORE_OPS_COMPLETE_ROTATION" | "STORE_OPS_DOWNSTOCK_ADD" | "STORE_OPS_SUNDAY_ASSIGN"
```

## Appendix B — localStorage key register

| Key / prefix | Owner module |
|--------------|--------------|
| `carpet_hub_sync_queue` | `lib/sync-queue.ts` |
| `carpet_hub_store_number` | `lib/store.ts` |
| `carpet_audits_offline` | `lib/storage.ts` |
| `carpet_hub_audit_draft` | `lib/storage.ts` |
| `carpet_catalog_offline` | `lib/catalog.ts` |
| `carpet_remnants_offline` | `lib/remnants.ts` |
| `carpet_specialists_offline` | `lib/specialists.ts` |
| `appliance_catalog_offline` | `lib/appliance-catalog.ts` |
| `appliance_scans_offline` | `lib/appliance-scans.ts` |
| `deptsync_downstock:*` | `lib/store-ops/downstock.ts` |
| `deptsync_shift_walk_tasks:*` | `lib/store-ops/shift-tasks.ts` |
| `deptsync_shift_day:*` | `lib/store-ops/shift-status.ts` |

## Appendix C — API route index (48 handlers)

`app/api/admin/*`, `app/api/appliances/*`, `app/api/auth/*`, `app/api/catalog/*`, `app/api/copilot/*`, `app/api/cron/*`, `app/api/departments`, `app/api/flooring/*`, `app/api/invite/*`, `app/api/push/*`, `app/api/roster/*`, `app/api/rotations/*`, `app/api/showroom-locations`, `app/api/store-health/*`, `app/api/store-locations/*`, `app/api/store-ops/*`, `app/api/stores/settings`, `app/api/v1/freight/stage`, `app/api/v1/topology/ingest`, `app/api/weekly-rotations`, `app/api/ai/*`

---

## Appendix D — Two-DS Floor Pilot Setup Checklist

Operational configuration only — do **not** hardcode store numbers, PINs, or targets in source.

### Hosting / environment

- [ ] `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` + `SUPABASE_SERVICE_ROLE_KEY`
- [ ] Unique `HUB_MASTER_PIN` (required; no default)
- [ ] `HUB_GATE_SECRET` (recommended) and `CRON_SECRET`
- [ ] Master recovery: `node --env-file=.env.local scripts/bootstrap-admin.mjs` or `POST /api/auth/bootstrap-admin` with Bearer `BOOTSTRAP_SECRET` / `CRON_SECRET`
- [ ] Optional `HUB_BOOTSTRAP_STORE_NUMBER` for bootstrap store
- [ ] HTTPS host for PWA install on personal phones (or trusted local tunnel for dry-run)

### Store identity

- [ ] After first Master login, confirm header shows `DeptSync · #<store>` (profile store adopts into hub session when device store was unset)
- [ ] Master can set/confirm store # under More → Device & Diagnostics / store field if needed

### Accounts (two Department Supervisors)

- [ ] Roster → **Add Team Member** for DS #1 and DS #2 (role **Supervisor**, correct home department, store matches)
- [ ] **Pair Device via QR** from each specialist sheet → each DS sets PIN on their phone at `/pair?t=`
- [ ] Confirm role badge shows DS Supervisor and department pin matches their dept
- [ ] Verify login unlock from each personal phone

### Department readiness

- [ ] Topology exists (More → Store Topology / Bulk Bay Generator); sanity-check bay count on Map
- [ ] More → Department Targets: set weekly `/wk` for the pilot department(s)
- [ ] Roster schedules / on-duty enough for Sunday staging pool

### First week loop

- [ ] Floor → Stage Weekly Rotation / Sunday drawer → Stage/Draw (Master) or use cron auto-stage
- [ ] Review person ↔ bay share (`hours → N bays`); Balance & Assign
- [ ] DS copies assignments into Lowe's existing dashboard (outside DeptSync)
- [ ] Associates execute on Zebra; DS physically validates bays
- [ ] DS verifies completion in DeptSync (Awaiting DS → Verified)
- [ ] Confirm Map/Floor readiness line and week open/complete advance

### Specialty smoke (non-production)

- [ ] Flooring: More or specialty hub → Remnant calculator — enter width/length, confirm live sq ft / sq yd (`sqFt = W×L`, `sqYd = sqFt/9`); optional one sample roll pad calc without saving production data
- [ ] Appliances (if in pilot): Scan & Count — continuous focus + one safe sample scan

### Explicit non-goals for this pilot

- No Zebra integration
- No per-associate bay-capacity engine (hours proportional assignment remains authoritative)
- No inferred Department Operational Capacity (CAP-001 NOT IMPLEMENTED; LAB-001 Labor Availability foundation implemented — not capacity; REC-001 Staging Consideration foundation implemented — not LIVE / no runtime consumer)
- Associates are not required to install DeptSync

---

*Last updated: 2026-09-04 (Constitution established — doc map under `DEPTSYNC_CONSTITUTION.md`; prior: Two-DS pilot polish)*
