# DeptSync Hub — Development Journal

## 2026-08-15 — Enterprise ingest contracts (stubs)

### Shipped
- **Contracts** — `src/types/enterpriseIntegration.ts` owns Zod schemas + inferred types for bay topology ingest, freight stage events, and floor-touch telemetry. Does not persist and does not own `store_locations`, rotations, or bay-service.
- **Transport** — `lib/enterprise-integration/ingest.ts` parses JSON with `.safeParse()` and returns a standardized 400 `{ success: false, error: "Bad Request", issues }`.
- **Stubs** — `POST /api/v1/topology/ingest` → `{ success: true, processed_bays: 1 }`. `POST /api/v1/freight/stage` → `{ success: true, queued_items }`. No UI or Store Ops write path.

## 2026-08-15 — URL stealth + HTTP-only auth gate

### Shipped
- **De-index** — `public/robots.txt` (`User-agent: *` / `Disallow: /`) plus global `X-Robots-Tag: noindex, nofollow, noarchive` in `next.config.ts` (`/` and `/:path*`) and root metadata `robots: noindex`.
- **Edge gate** — `proxy.ts` (Next 16 successor to `middleware.ts`; both files cannot coexist). Unauthenticated `/`, `/dashboard`, and other HTML routes redirect to `/login` before RSC. `/api/*` (except `/api/auth`, `/api/cron`, `/api/invite`) requires the hub cookie or `Authorization: Bearer`. Cron still uses `CRON_SECRET`.
- **HTTP-only session** — `POST /api/auth/gate` mints `deptsync_hub_gate` (HttpOnly, SameSite=Lax, 8h) after a live Supabase JWT. `startAuthSession` / logout sync it. `/login` (`AccessGate`) is the public AuthWall; `/access-gate` and `/auth` redirect there. SW shell cache is `deptsync-shell-v6-stealth` and no longer precaches `/`.

## 2026-08-15 — Tactical Voice Hub + bay freshness on Floor

### Shipped
- **Promoted Floor Pad** from Settings to the Floor dashboard. `TacticalVoiceFloorPad` is a high-access Walk & Talk dock (Master/DS) with listening pulse + bottom-sheet capture. Full TipTap `ExecutiveFloorPad` remains available from the sheet. `/manager-notes` and Settings `#manager-notes` redirect to `/dashboard#floor-pad`.
- **Voice-to-task Copilot** — Web Speech API with pause/stop parse and keyboard scratchpad fallback. `POST /api/copilot/parse-walk` + `lib/store-ops/ai-walk-parse.ts` extract structured tasks (location_tag, category, priority, window, assignee). Local heuristic when Gemini or the network is down.
- **Shift dispatch** — `lib/store-ops/shift-tasks.ts` owns walk tasks (`shift_walk_tasks` + localStorage). **Dispatch All to Shift Board** stamps freshness, syncs Supabase, and composes DOWNSTOCK into `downstock.ts`. Haptic: `hapticSuccess`.
- **Bay freshness** — `lib/heatmap/bay-tracker.ts` + `BayFreshnessGrid`. Fresh 0–2d (emerald) / Warm 3–4d (amber) / Stale 5+d (crimson). Composes `last_serviced_at` / `last_completed_at` plus walk/dispatch/checkoff/audit overlays. Does not own IRP velocity or bay-health diagnostics. Apply `20260815_shift_walk_tasks.sql`.

## 2026-08-15 — Store Ops instant-render SWR + map/briefing performance

### Shipped
- **Durable SWR** (`lib/store-ops/cache.ts`) — IndexedDB object stores for `store_locations`, `weekly_rotations`, and `shift_briefings`. Map/Floor peek cache first (<20ms), then background network; React state updates only when the fingerprint changes. `ttl-cache.ts` stays L1; `client.ts` write-through + `invalidateStoreOpsListCaches` clears both.
- **Shift briefing** — `ShiftBriefingCard` hydrates from IDB, memoizes `localShiftBriefingFromHealth`, yields before health fetch. Predictive Copilot defers compose to `requestIdleCallback`; decay scores run in `scoreLocationDecaysAsync` (yield every 40 bays).
- **Map DOM** — Visual Grid and Manage console chunk 16 aisles / 24 bays; Manage starts collapsed. Cadence maps + SVG aisle heat strips are memoized; Sell/Top uses a local overlay so toggling a face does not reload the map.
- **Indexes** — apply `20260815_performance_indexes.sql` (`idx_store_locations_dept_aisle`, `idx_bay_service_logs_bay_time`, `idx_rotations_active`) on canonical columns.

## 2026-08-15 — Theme, preferences, audio & haptics engine

### Shipped
- **Feedback** (`lib/ui/feedback.ts`) — Web Audio `playSuccessTone` / `playErrorTone` / `playTapTone` (no assets) and `hapticLight` / `hapticSuccess` / `hapticWarning`. Gated by `soundEnabled` / `hapticsEnabled`. `utils/haptics.ts` and `lib/scan-feedback.ts` compose this owner.
- **Prefs** — same `deptsync_theme_prefs` catalog (`lib/theme.ts`): Cyber-Dark, Midnight Sapphire, Industrial Emerald, Solar Daylight, plus high contrast, comfortable/compact density, sound, haptics. React mirror: `lib/ui/preferences-context.tsx`.
- **Drawer** — `UserPreferencesDrawer` for every role from header **🎨 Appearance & Preferences** and Settings. CSAs get handheld controls without store Settings. Test Tap / Success / Alert buttons.
- Wired on bay complete, packdown walk log, barcode hit/mismatch, tab taps (`HapticsListener`), Sunday draw / assign, force draw, and sync conflicts.

## 2026-08-15 — Role-based views + 3-tap developer sandbox

### Shipped
- **Hub view roles** — `lib/rbac.ts` maps platform roles to `MASTER_ADMIN` / `DEPARTMENT_SUPERVISOR` / `ASSOCIATE_CSA`. Associates get My Shift + Store Map only. DS keeps Floor/Map/Roster/Settings, department-scoped roster, shift schedules, and Map Manage (bay priorities). Master keeps full chrome and admin tools.
- **Associate Floor** — Shift Briefing + locked “mine” Zebra queue (packdown/downstock). Sunday staging, scan chips, Copilot, health, showroom, verify, and exception feed stay hidden.
- **Associate Map** — read-only Visual Grid locator. Manage Aisles & Bays and Snap Bay chrome are hidden. Walk-the-floor tap remains.
- **Developer sandbox** — Master Admin 3-taps the DeptSync logo within 800ms → `DevSandboxDrawer`. Preview As Role + Simulate Department overlays chrome via `sessionStorage` (`lib/dev-sandbox.ts`); JWT and roster credentials are unchanged. Amber banner: “⚡ Simulating: [Role] — Tap to Exit”.

## 2026-08-15 — Roster weekly schedule matrix

### Shipped
- **Collapsed departments** — Roster accordions start closed; tap to expand a home department.
- **Weekly calendar** — `AssociateScheduleModal` replaces the time-only sheet: associate + home dept + active week (Sun–Sat), cyan day toggles, Open/Mid/Close presets, per-day start/end. Saves `associate_shift_days` (`specialist_id`, `work_date`, `start_time`, `end_time`, `is_scheduled_today`) via `upsertShiftWeek`; localStorage fallback if the table is missing.
- **Card summary** — S M T W T F S dots (green scheduled / gray off), `Today: 07:00 - 15:30` or `Today: Off`, Edit Schedule.

## 2026-08-15 — Map Visual Grid walk-only

### Shipped
- **Map tab** — Removed Department Overview accordion (department cron toggles stay in Settings `DepartmentTargetsMatrix`).
- **Visual Grid** (`StoreLocationGrid`) — No aisle/bay checkboxes, batch delete, Add Bay, prune, or row Edit/Delete. Cadence dots, bay tags, Sell/Top, tap-to-walk remain. Empty map points to Manage.
- **Walk sheet** — Walk + Snap Bay + pin only. Aisle/bay/department/delete lives in `EditBayDrawer` on Manage.
- **Manage Aisles & Bays** — Owns multi-select, batch delete, duplicate prune, Add Bay, Bulk Generator, and full bay edit.

## 2026-08-15 — Velocity tier & priority seeding on Map tools

### Shipped
- **Bulk Generator** — Default Velocity Tier: Standard (14-day), High Velocity / Fast Mover (5-day), Priority Lock (always in Sunday draw). Writes `velocity_tier`, `priority_override`, and `custom_decay_days` via `velocitySeedFromPreset` (`lib/store-ops/velocity.ts`).
- **Edit bay drawer** — High-Velocity Hotspot, Lock Priority Override, and 3–21 day decay slider persist on `store_locations`. Manage list shows LOCK when `priority_override`.
- **Sunday draw** — `rotation.ts` pulls cadence-due bays (age ≥ custom/tier decay) into the velocity-priority pool. `adaptiveDrawWeight` multiplies by `decayDrawMultiplier`. Apply `20260815_custom_decay_days.sql`.

## 2026-08-15 — Call-out carry-over loop + Predictive Shift Copilot

### Shipped
- **Carry-over loop** — Call-out "Carry Over" (and auto fallback when no on-duty peers) stamps `sunday_bay_assignments` `CARRIED_OVER` / `is_carried_over` and `store_locations` `priority_override`, `carried_over`, `last_carried_over_at`. Sunday generate (`rotation.ts` `pickSundayCarryOverFirst` → `rotations.ts`) prepends `carried_over` OR `priority_override` OR status `CARRIED_OVER` before cadence decay, then clears `carried_over` on assign/complete. Amber Geist Mono **Carry-Over Priority** badge on Floor checklist + Sunday modal.
- **Predictive Copilot** — `lib/store-ops/predictive-copilot.ts` composes walk logs, Sunday assignments, downstock queue, and locations (hot weekday packdowns, 14-day adjacent decay, on-duty pace). `PredictiveCopilotBanner` sits under Shift Briefing with 1-tap Stage / Downstock (optimistic + toast). Does not call Gemini or invent bays.
- Apply `20260815_carry_over_priority.sql` (with `20260815_associate_shift_days.sql`).

## 2026-08-15 — Map aisle console + Roster shift / call-out

### Shipped
- **Map `[ Visual Grid | Manage Aisles & Bays ]`** — Visual Grid stays `StoreLocationGrid` (heatmap + `WalkTheFloorSheet`). Manage console is `AisleBayManager`: department-filtered aisle accordions, mapped-bay badge, Add Single Bay (`AddBaySheet`), Bulk Generator sheet, Select All / Delete Selected, Edit drawer (`EditBayDrawer`: aisle / bay / department / priority), per-bay delete toast. Locations still filter via header pin (`workingDepartmentId`).
- **Roster department groups** — associates accordion by primary `assigned_department` with roster count + on-duty today. Shift pill `07:00 - 15:30` + Edit Schedule (Supervisor/Master). Access chips remain on the card (`accessible_departments`).
- **Daily shift board** — `lib/store-ops/shift-status.ts` owns `start_time` / `end_time` / `is_scheduled_today` / `is_call_out` / `ABSENT_CALLOUT`. localStorage first; upserts `associate_shift_days` when the table exists; mirrors hours into `ShiftRosterMember` so Sunday balancer stays in sync.
- **Call-out rebalance** — `lib/store-ops/call-out.ts` composes `sunday-audit` + `planProportionalBayAssignments`. Dialog: Return to Department Pool · Auto-Redistribute to On-Duty Peers · Carry Over (`CARRIED_OVER`). Does not generate rotations.
- **RBAC** — `canManageShiftBoard` = Master or Supervisor. Team add/delete stays Master-only. Apply `20260815_associate_shift_days.sql`.

## 2026-08-15 — Geist typography + 4-tab chrome lock

### Shipped
- **Geist / Geist Mono** — `next/font/google` in `app/layout.tsx` (`--font-geist-sans`, `--font-geist-mono`). Tailwind `@theme` maps `--font-sans` / `--font-mono`. Body uses `font-sans`.
- **Identity mono** — `formatBayTag` (`A14-B06`, `BW-B12`) plus `font-mono tracking-tight tabular-nums` on bay tags, SKUs, cadence badges, and timestamps (Floor, Map, Exception feed, Sunday drawer, scan logs).
- **4-tab chrome** remains locked: Floor · Map · Roster · Settings. Hamburger / More / Admin Tools stay gone. Bulk Generator, Force Rotation, and Department Targets live in Settings accordions/modals.

## 2026-08-15 — Chrome consolidation: 4-tab-only DeptSync

### Shipped
- **Strict 4-tab bar** — Floor `/dashboard` · Map `/admin/store-map` · Roster `/roster` · Settings `/settings`. Hamburger drawer, More overflow sheet, and Admin Tools slide-over are gone. Header is title/store #, department pill, account/PIN chip only.
- **Settings owns former Admin Tools** — Bulk Generator, Taxonomies, Force Rotation, store number, Floor Pad, remnants, weekly targets, theme, push, and device/sync live in `SettingsSection` accordions/modals. Hash deep-links (`#bulk-generate`, `#weekly-rotation`, `#taxonomies`, `#manager-notes`, `#remnants`) still work, including keep-alive Settings.
- **Unified Floor** — one checklist header for every role: Sunday staging (non-associates), scan chips, health/rollup, showroom, in-place **Verify completed bays**, `ZebraChecklist` (Rotation/Downstock + Barrier chips), `ExceptionFeed`. `/verify-rotation`, `/admin/exceptions`, and `/department` redirect to `/dashboard`.
- **Unified Map bay sheet** — `WalkTheFloorSheet` is the only overlay: 2-second walk log + Snap Bay + Master Admin edit/pin. `BayActionsSheet` deleted. Bulk generate CTAs go to `/settings#bulk-generate`.
- **Roster** remains canonical team/PINs/chips. `/admin/supervisors` and `/admin/roles` still redirect here.
- **Dead chrome deleted** — `CatalogSection`, `ApplianceCatalogSection`, `CatalogItemCard`, `SuperAdminQuickActions`, `AdminRosterManager`, `AdminToolsDrawer`, `admin-tools-events.ts`, `StockTab`. `/stock` and `/manager-notes` redirect (Floor / Settings).
- **Toasts** — Sonner host in root layout (`lib/toast.ts`). PATCH `/api/store-locations` accepts `department_id` + `priority_override`.

## 2026-08-14 — Multi-department role & scope access

### Shipped
- **`accessible_departments`** on `store_specialists` (hub scopes) and `profiles` (store-ops codes). Session list is always primary `assigned_department` plus granted extras (`lib/department-access.ts`).
- **JWT / RLS** — `jwt_matches_department_code` also matches `app_metadata.accessible_departments`. Token hook + profile sync inject the array.
- **Roster chips** — Associate edit/invite drawers and Settings / `/admin/roles` toggle extra departments. Supervisors grant on associates via instant `POST /api/admin/department-access`.
- **Header switcher** — if `accessible_departments.length > 1`, the department pill becomes a dropdown. Pinning updates Floor / Map / Stock (no reload) and APIs reject department ids outside the granted set.

## 2026-08-14 — IRP velocity heatmap on store_locations

### Shipped
- **Canonical bay table** — IRP cadence lives on `store_locations` (`last_serviced_at`, `velocity_tier`, `priority_override`, denormalized `department_code`). Walk-the-floor writes `bay_service_logs.location_id` (no `bays` / `bay_tags` tables). Weekly `last_completed_at` is unchanged.
- **Store Map modes** — `[ Standard Map | Velocity Heatmap ]` on `StoreLocationGrid` (Map tab / `/admin/store-map`). Standard still uses `map-readiness.ts`. Heatmap colors by `classifyVelocityHeat`: cyan ≤7d, amber 8–18d, gray/orange >18d or null, pulse red/purple for `high` / `critical_hotspot`. Legend at the bottom of heatmap view.
- **2-second walk-the-floor** — tapping a bay opens `WalkTheFloorSheet` (`light_touch` / `heavy_packdown` / `critical_hole`). `POST /api/store-locations/service` inserts the log, stamps `last_serviced_at`, and promotes velocity when 2+ heavy/critical logs land in 30 days (`lib/store-ops/velocity.ts` + `bay-service.ts`).
- **Sunday draw** — `lib/store-ops/rotation.ts` `pickSundayVelocityPrioritized` runs after CARRIED_OVER so `velocity_tier IN ('high','critical_hotspot')` and `priority_override` fill the remaining weekly target first. `adaptiveDrawWeight` also multiplies those locations.

## 2026-08-14 — Instant Floor/Map/Stock/Settings tab shell

### Shipped
- **Keep-alive workflow shell** — `app/(workflow)/layout.tsx` + `WorkflowTabShell` keep Floor / Map / Stock / Settings mounted behind `hidden`. Tab switches no longer unmount SessionGate, NavigationHub, Zebra, or scroll position.
- **Stale-while-revalidate** — `createTtlCache.getSWR` (45s) on departments, weekly rotations, store locations, and roster so revisiting a tab paints cached data before the network.
- **Shared Realtime** — one `postgres_changes` channel per logical name; extra subscribers add JS listeners only. Rapid tab switches do not reconnect.
- **Code-split modals** — Snap Bay, Bulk Generate, Force Rotation, Sunday assign, Taxonomy, and Floor Pad stay out of the primary tab tree via `next/dynamic`.

## 2026-08-14 — Department seed respects UNIQUE(code) so D29 duplicate is not an error

### Shipped
- **`ensureDepartmentsForStore`** — upserts templates with `ignoreDuplicates: true`. Tries `onConflict: 'store_id,code'` then `'code'` to match live `departments_code_key`. Duplicate D29 is logged and ignored; GET still SELECTs existing rows.
- **List fallback** — if store-scoped queries are empty, unscoped `SELECT * FROM departments` hydrates the global unique-code catalog.
- **Store Map** — duplicate-key is not a red banner. Department Overview hydrates from the DB list; seed conflict retries the list after cache invalidate.

## 2026-08-14 — Admin Tools department load no longer red-banners

### Shipped
- **Exact error logging** — `[departments GET]`, `[ensureDepartmentsForStore]`, `[AdminTools] Could not load departments` log the caught error instead of swallowing it into a generic banner.
- **Hydration guard** — Admin Tools waits for a store number, retries on `STORE_CHANGED_EVENT`, and GET skips until `store_number` is present.
- **UUID-safe list** — `listDepartmentsForStore` queries `store_id` only when it is a UUID; otherwise (and on empty/invalid-uuid errors) it uses `store_number` like `2587`.
- **SELECT then INSERT seed** — `ensureDepartmentsForStore` no longer upserts on `(store_id, code)` (which 500s when live UNIQUE is still `code`). Seed failures are logged and do not fail GET.
- **Static fallback** — Admin Tools / targets matrix render `STORE_DEPARTMENT_TEMPLATES` when the query is empty or fails. Auth still shows the amber Hub PIN hint; the red “Could not load departments for admin tools” banner is gone.

## 2026-08-14 — Lucide department glyphs, Realtime subscribe order, Cabinets on Store Map

### Shipped
- **Department Lucide icons** — roster, department pickers, header pin, and Store Map overview use `DepartmentIcon` (Layers / Zap / Paintbrush / DoorClosed / Archive / Wrench / Trees / Droplets). Native `<option>` emoji removed; `DepartmentPicker` hosts SVGs. Role chips use HubIcon crown / shield / user.
- **Realtime lifecycle** — `lib/store-ops/realtime.ts` binds `postgres_changes` before `subscribe()`, uses unique channel instance names, and unsubscribes on unmount so Zebra + Sunday drawer + Fast Refresh no longer hit “cannot add callbacks after subscribe()”.
- **Cabinets on Store Map** — `ensureDepartmentsForStore` upserts on `(store_id, code)` so D29 is inserted for existing stores (weekly target 6). Department Overview lists Cabinets with toggle, target, and tag metrics.

## 2026-08-14 — Shift briefing, Cabinets D29, Specialist vs CSA roster

### Shipped
- **Local-first shift briefing** — `ShiftBriefingCard` loads a deterministic health brief (open bays, barriers, pace) from `GET /api/store-health` + `buildLocalShiftBriefing`. Gemini is only called on manual refresh / pull-to-refresh. Quota and GoogleGenerativeAI RPC errors fall back silently to the local brief; raw JSON is never shown. `/api/store-health/ai-summary` also returns the local brief when Gemini fails.
- **Sunday Cycle Audit Engine** — staging card opens the assignment drawer in-place (`requestSundayAuditDrawer`). `/flooring`, `/sunday-audit`, and `/sunday-rotation` redirect to `/dashboard` with the drawer instead of 404 / “page cannot be loaded”. Header Flooring pin no longer hops through `/flooring`.
- **Cabinets (D29)** — first-class hub department (`cabinets`) with store-ops code `D29`, taxonomy tree, Admin pin, department target seed (`20260814_cabinets_d29.sql`), and rotation template.
- **Retail roster titles** — specialty depts (Flooring, Appliances, Millwork, Cabinets) display **Specialist**; core depts display **CSA**. Lightweight `AssociateRosterPanel` on Settings, Admin Tools, and the Sunday drawer. Sunday Shift Balancer allocates 4h / 6h / 8h quotas to on-duty Specialists/CSAs.

## 2026-08-14 — Slice 1 Intelligence Architecture Hardening

### Shipped
- **Structured outputs** — `lib/ai/gemini.ts` is `server-only`. Callers pass `responseSchema` + `maxOutputTokens` via `jsonGenerationConfig`. Regex JSON extract remains a safety net. Budgets: briefing 256, Snap Bay 512, Floor Pad/insights 2048, Pre-Flight parse 2048. Schema types live in isomorphic `lib/ai/gemini-schema.ts` so client domain modules do not load the SDK.
- **Compact-then-narrate** — Flooring insights and appliance anomalies run local aging/variance/serial heuristics first, then send a findings packet (bound IDs/SKUs) to Gemini for narration. Merge overlays rationale/priority onto local rows; invented SKUs are dropped.
- **Auth + server fetch** — `/api/flooring/ai-insights` and `/api/appliances/ai-anomaly` require Store Ops JWT and load column-pruned remnants/audits/scans from the actor’s store. `/api/catalog/ai-taxonomy` requires supervisor/admin. Widgets send Bearer headers, not table dumps.
- **Legacy canvas synthesis retired** — `POST /api/store-ops/ai-note-summary` returns 410. Floor Pad `extractTasksAndTag` is the canonical Copilot. `NoteActionItem` moved to `lib/store-ops/manager-notes.ts`. Pre-Flight input capped at 24k chars.

## 2026-08-14 — P0 FTUX landing + brand unification

### Shipped
- **PWA mark** — `public/icons/` (192 / 512 / apple-touch) plus `mark.svg` are the cyan/gold floating layers+barcode, not the enclosed green shield. SW cache `deptsync-shell-v5-brand-floor`.
- **Boot splash** — `DeptSyncSplash` pins midnight `#090d16` and `DeptSyncBadge branded` so SSR/theme FOUC cannot flash emerald. AuthWall and invite use the same branded mark.
- **First land** — authenticated `/` without a specialty `?section=` replaces to `/dashboard`. Floor tab is only active on `/dashboard`. Scan tools stay at `/?section=audit|appliances|department` (More → Scan & Audit).
- **Associate Floor** — bay checklist is the first viewport. Sunday engine, shift briefing, and health widgets stay supervisor/Master.
- **Empty states** — associates see “No bays scheduled on your rotation — see your supervisor.” Stock empty queue explains Flag for Downstock + Go to Floor. Map empty is role-split (Map your first aisle vs ask supervisor).
- **Microcopy** — user-facing Zebra copy → Floor; role chip is Master Admin / Supervisor / Associate; Floor/Overhead instead of SELLING/TOPSTOCK; measurement pad lin ft / sq yd / sq ft.

## 2026-08-14 — Phase 2 DeptSync UX/UI consolidation

### Shipped
- **Roll Measurement Pad** (`components/inventory/RollMeasurementPad.tsx`) — Cycle Audit composes a single card: live CLF / SQYD in the header, whole-inch stepper, 1/8–7/8 keypad, +5/+10/+20 rounds. Carton mode uses the same pad shell. Form state stays in `CycleAuditScanForm`.
- **AI chips** — Remnant Intelligence is a collapsible trigger (`FlooringAIInsightBanner compact`); Snap Bay is a header chip. Measurement pad sits above the fold; Sunday staging and the shift log stay below.
- **Admin Tools grid** — menu is a 2-column categorized card grid: Floor Architecture · Rotations & Quotas · System & Security. Each card has a Lucide badge + subtitle. Drawer ownership unchanged.
- **Department targets matrix** (`DepartmentTargetsMatrix`) — compact table (dept / weekly quota / on-off). Auto-save on blur and toggle; one **Save All Targets** footer for dirty rows. Settings still imports `WeeklyBayTargetCard` (re-export).

## 2026-08-14 — Phase 1 DeptSync UX/UI consolidation

### Shipped
- **Splash** — `DeptSyncBadge` no longer sits in a hard dark tile. The shield/barcode mark floats on a soft `--glow-accent` radial. `DeptSyncSplash` + `app/loading.tsx` (and AuthWall / SessionGate / hub boot) use clean typography instead of a boxed logo.
- **Department pill** — Master Admin horizontal context tabs are gone. `AdminDepartmentSwitcher` is a compact header dropdown (D23 / D35 / All). Other roles get a read-only department chip. Owner remains `lib/admin-department-context.ts`.
- **Workflow bottom nav** (`lib/nav-hub.ts` + `BottomNav.tsx` + `HubHeader.tsx`) — one primary bar for every role: **Floor** (`/dashboard` + hub audits) · **Map** (`/admin/store-map`) · **Stock** (`/stock`) · **Settings** (`/settings`). Team / Alerts / Verify / Notes live in More. Inventory `BottomNavBar` no longer mounts on `/`.
- **Stock** (`app/stock/page.tsx`) composes Zebra `lockedQueue="downstock"` + `RemnantSection`. Hub `?section=remnants|settings` redirects to `/stock` / `/settings`.
- **Store Map rows** — Bay name + readiness on the left; compact Selling/Topstock dual-pill; Lucide MoreVertical menu (Edit / Trash). Super Admin mutates; supervisors/associates get a read heatmap (`canMutate`).

## 2026-08-14 — Theme engine & personalization

### Shipped
- **Theme catalog** (`lib/theme.ts`) owns five dark tactical presets, localStorage prefs, and `data-theme` / `data-contrast` / `data-density` apply. `ThemeProvider` (`lib/theme-context.tsx`) only mirrors live state. Blocking boot script in `app/layout.tsx` prevents FOUC.
- **Presets:** Midnight Tactical (default, ice-blue) · Emerald Ops · Amber Precision · Obsidian OLED · Cobalt Command. Glass chrome, primary glow, nav active, and bay pulse bind to CSS variables.
- **Settings Appearance** (`components/settings/ThemeSelector.tsx`) — live swatches, High Contrast (crisper borders), Compact Density (tighter rows). Instant, no reload.
- **Token integration** — NavigationHub / HubChrome / NavIcons / ZebraChecklist / StoreLocationGrid / HeaderNetworkStatus / DeptSyncBadge / core modals use `theme-accent-surface`, `theme-nav-active`, `theme-modal`, `text-accent`.

## 2026-08-14 — Layout, navigation, and vector iconography polish

### Shipped
- **Thumb-zone chrome** — sticky header uses `pt-safe` + `min-h-12`; Master Admin context strip dropped the redundant label row; ops/inventory bottom tabs stay `min-h-16` with `pb-safe`.
- **Above-the-fold density** — `.hub-main` (`px-3 pt-2 pb-28`) on Store Ops routes; dashboard / Store Map / health / briefing / Sunday staging cards dropped `p-4`/`mb-4`/`space-y-6` so bay rows, status pills, and pace timers sit higher on handhelds.
- **Unified Lucide catalog** (`components/hub/NavIcons.tsx`) — `HubIcon` + `NavIcon` share stroke 2. Replaced emoji/raster marks in `HeaderNetworkStatus`, `SundayAuditStagingCard`, Store Map (`StoreMapBody` + `StoreLocationGrid`), Zebra Quick Touch / downstock / barrier, HubHeader, Admin Tools close.
- **Touch targets** — `.chip-filter` and `.btn-quick-touch` are 44px minimum; Quick Touch / Pull / Barrier are icon-first with 44px hit boxes; department cron switch padded to 44px; Selling/Topstock toggle `min-h-11`.

## 2026-08-14 — Downstock queue, Store Map heatmap, supervisor weekly rollup

### Shipped
- **Downstock queue** (`lib/store-ops/downstock.ts`) — Zebra bay chip **Flag for Downstock** (optional pallet/SKU note). **Downstock Queue** tab isolates overhead pulls; assign to a CSA via existing Sunday assignment. Persists to `downstock_queue` (migration `20260814_downstock_queue.sql`) with localStorage fallback.
- **Store Map heatmap** (`lib/store-ops/map-readiness.ts` + `StoreLocationGrid`) — green verified this ISO week, yellow scheduled rotation, red stale >7d or barrier. Quick Touch / complete emits `BAY_READINESS_EVENT` so the map turns green immediately.
- **Supervisor weekly rollup** (`lib/store-ops/audit-summary.ts` + `SupervisorAuditSummaryModal`) — quota vs completed, associate/shift breakdown (Sunday assignees, not guessed tappers), resolved vs open barriers. One-tap copy. Dashboard + Department Overview.

## 2026-08-14 — Store Map bay edit, delete, and odd/even-only generate

### Shipped
- **Bay pattern** is Odd Only / Even Only only (`lib/store-ops/bay-pattern.ts`). Default Odd Only. Legacy CSV `sequential` maps to odd.
- **Store Map** (`StoreLocationGrid`): per-bay Edit (aisle, bay, SELLING/TOPSTOCK, status, zone, audit frequency) and Delete with inline confirm. Multi-select + **Delete Selected (N) Bays**. Duplicate prune now hard-deletes.
- **Bulk Generator Clean-Up** tab: prune an entire aisle or an odd/even bay range (SELLING / TOPSTOCK / both).
- **API:** `PATCH /api/store-locations` Super Admin can update aisle, bay, type, status. `DELETE` hard-deletes by `?id=`, `{ id }`, or `{ ids: string[] }` (cascades `weekly_rotations`).

## 2026-08-14 — Shift workload balancer + clustered bay assignment

### Shipped
- **Shift balancer** in Sunday assignment (`SundayAuditAssignmentModal`): toggle CSAs, 4/6/8h or start–end times. Hours persist per store/week in localStorage.
- **Proportional clustered plan** (`lib/store-ops/weekly-rotations.ts`) — largest-remainder quotas by hours; aisle/face clusters stay together; stale >7d / unworked top-stock clusters feed the longest shifts. Persistence stays in `sunday-audit.ts` (`applySundayAssignmentPlan`). Rotation draw stays in `rotations.ts`.
- **Zebra** assignment badges show name + shift tag; filter All / Mine / associate. Checklist header shows **Ahead / On Track / Behind** weekly pace (`forecastWeeklyPace` in `week.ts`).
- **Store Map prune** — `findDuplicateLegacyBays` groups same dept+aisle+bay+type (numeric aisle padding collapsed). Super Admin deletes extra tags via `DELETE /api/store-locations` (cascades weekly rotations). See later **bay edit/delete** entry for hard-delete + per-bay actions.

## 2026-08-14 — Smart Floor Insights & Operational Velocity

### Shipped
- **Quick Touch** on Zebra assigned bays (`ZebraChecklist`) — one-tap facing/readiness complete via existing `completeRotation`; optimistic overlay + timestamp on the completed list. Does not open an itemized count.
- **Shift briefing** composes `bay-health.ts` into Gemini/local context (`stale >7d`, unworked top-stock, barrier flags, hotspot aisle/bay). Prompt + local fallback are 3 bullets: Focus Bay, Pending Barriers, Quick-win. `GET /api/store-health` attaches compact `bay_health`; `POST /api/store-health/ai-summary` enriches if the client snapshot omitted it.
- **Remnant rack aging** — floor-ops bands Fresh <14d / Watch 14–30d / Critical >30d (`classifyRackAging` in `lib/aging.ts`, composed by `remnantRackAlert` in `lib/remnants.ts`). Critical available rolls without a markdown get a Suggest markdown chip. Institutional 30/60/90 markdown aging is unchanged.
- **Header network chip** — `HeaderNetworkStatus` owns `useNetworkBadge` so pending-queue ticks do not re-render NavigationHub / Admin Tools / child forms. Badge `setState` skips identical online/pending values.

## 2026-08-14 — Admin Tools React #306 (undefined lazy component)

### Root cause
- `dynamic(() => import(...).then((mod) => ({ default: mod.AdminToolsDrawer })))` passed `undefined` into React.lazy when the client chunk exposed the drawer on `mod.default` (interop), not `mod.AdminToolsDrawer`. Minified React error #306.

### Shipped
- Drawer keeps `export default` + named `export { AdminToolsDrawer }`.
- NavigationHub loads with `dynamic(() => import("@/components/hub/AdminToolsDrawer"), { ssr: false })`.
- Floor Pad nested lazy uses named `mod.ManagerNotesWorkspace`; shim also has a default export.

## 2026-08-14 — Admin Tools chunk isolation + Bay Health diagnostics

### Root cause (Admin Tools "couldn't load")
- `next/dynamic` imported the drawer as a whole module while `AdminToolsDrawer` **statically imported** Executive Floor Pad / TipTap. Evaluating that graph on first open could reject the lazy chunk; React.lazy then bubbled to the Next.js page error ("This page couldn't load") because nothing caught it.
- Closing the drawer unmounted the dynamic component (`adminOpen` only), so the next open remounted and re-fetched the chunk.
- The loading shell ignored `error` / `retry` from `next/dynamic`.

### Shipped
- Named-export loader `{ default: mod.AdminToolsDrawer }`, `adminHosted` keep-alive, `ChunkErrorBoundary` + loading-shell retry with `console.error`.
- Floor Pad/TipTap is a nested `dynamic()` and mounts only when notes open.
- Service worker cache bumped to `deptsync-shell-v4-admin-tools`.
- **Bay health:** `lib/store-ops/bay-health.ts` flags >7d stale / never completed, un-inventoried TOPSTOCK, and SIMS/variance mismatches. Zebra shows a compact scorecard badge.

## 2026-08-14 — Phase 3: Bay-Readiness Velocity & Floor Workflow

### Shipped
- **ZebraChecklist** (`components/store-ops/ZebraChecklist.tsx`) owns the floor checklist: optimistic complete (no loading flash), haptic + next-bay `bay-advance-pulse`, SELLING/TOPSTOCK filter, Sunday assignment queue, one-tap Barrier chips.
- Dashboard silent-refreshes rotations on complete and on `SUNDAY_AUDIT_EVENT`; Zebra subscribes to Sunday Realtime (cache invalidate on change) so specialist assignments appear without a page refresh.
- **Audit mode:** `lib/store-ops/audit-location-mode.ts` + `AuditLocationModeToggle` — Cycle / Department forms label SELLING (lower floor) vs TOPSTOCK (overheads). Logs, discrepancy filters, and audit reports carry the mode; the toggle is not reset after each log.
- **Verify All Completed Bays** on `/verify-rotation` stamps the week without completing remaining open bays. `/admin/exceptions` batch-verifies pending depts with 0 open. Barrier chips: Blocked Bay, Unpalletized Top-Stock, Missing SIMS Tags.
- Mid-week barriers: `POST /api/rotations/exceptions` + `reportRotationBarriers` (CARRIED_OVER, does **not** stamp `last_verified_week`). End-of-week verify composes the same insert then stamps.

## 2026-08-14 — Admin Tools open + odd/even bulk bays

### Shipped
- Admin Tools chrome clicks set `adminOpen` immediately (`requestAdminTools`), then dispatch the event. Drawer uses `next/dynamic` default export + `{ ssr: false }` and a loading shell so the first open actually renders.
- Bulk Generator **Bay pattern**: Odd Only / Even Only (default odd). `expandBayNumbers` steps by 2 (`lib/store-ops/bay-pattern.ts`). CSV optional `bay_pattern` column; legacy sequential maps to odd.
- Store Map GET retries without `last_completed_at` on 42703/PGRST204 and always returns `last_completed_at: null` when the value or column is absent.

## 2026-08-14 — Admin Tools drawer open path

### Shipped
- `openAdminTools()` keeps a pending payload and `subscribeAdminTools()` replays it so a click before NavigationHub's listener attaches still opens the drawer.
- Hamburger / More / account / Settings / hash deep-links all dispatch `openAdminTools`.
- `AdminToolsDrawer` stays dynamically imported (`ssr: false`, named export as `{ default }`) with an immediate loading shell. After the first open it stays hosted (`adminHosted`) so later opens do not remount the lazy chunk.

## 2026-08-14 — Phase 2 UI streamlining (tab latency, draft debounce, form isolation)

### Shipped
- Cycle / Appliance audit drafts write to localStorage on a **300ms debounce** (`scheduleAuditDraftSave` / `scheduleApplianceScanDraftSave`). Immediate flush on submit, tab hide, unmount, and when the hub section is hidden (keep-alive).
- Scan/input state lives in `CycleAuditScanForm` and `ApplianceScanForm`. Historical logs stay in the parent sections so keystrokes do not reconcile the shift tables.
- `GET /api/weekly-rotations` and departments remain 45s TTL + in-flight dedupe (`lib/store-ops/client.ts`). Sunday assignments use the same TTL cache (`lib/store-ops/sunday-audit.ts`); writes invalidate. Staging card no longer double-fetches on assignment events.
- Hub `/?section=` switches use `React.startTransition` and keep visited sections mounted (`hidden` + `aria-hidden`) so Cycle Audit / Sunday staging do not remount. Wedge scanners disable when a pane is hidden. Bottom padding is stable (`pb-44`) to avoid layout shift.

## 2026-08-14 — P0 index SQL: `store_number` vs `store_id`

### Shipped
- `20260813_p0_query_indexes.sql` no longer assumes `store_number` on every table (live 42703).
- Hub `carpet_audits` / `carpet_remnants`: `ADD COLUMN IF NOT EXISTS store_number` then composite index (these tables have no `store_id`).
- Store Map / rotations: index `store_id` (and `store_number` only if JWT RLS added it).
- Floor Pad: Phase 2 index on `(store_number, is_archived, department, created_at)`; legacy fallback `(store_id, is_archived, department_code, created_at)`. Missing columns skip with NOTICE.

## 2026-08-14 — P1 Gemini latency, Snap Bay payload, Store Map columns

### Shipped
- Snap Bay camera targets **1280×720**; live/upload snapshots are a single-pass JPEG (quality 0.70, max edge 960px). `scanBayVisual` strips data-URL prefixes so Gemini receives raw base64. Route rejects images over ~1.5MB chars.
- Gemini Flash uses `responseMimeType: application/json` and `maxOutputTokens: 1024` (`GEMINI_JSON_GENERATION_CONFIG` in `lib/ai/gemini.ts`) so bay-scan JSON is not truncated.
- Floor Pad Copilot sends `editor.getText()` / stripped HTML, capped at 8,000 characters. Prompt is schema-only (no example JSON blobs). TipTap HTML is unchanged for persist/checkboxes.
- `GET /api/store-locations` selects Store Map columns only (no `SELECT *`).

## 2026-08-13 — P0 mobile boot path (roster-only + code-split + bounded queries)

### Shipped
- Hub boot (`app/page.tsx`) fetches **roster only** before AuthWall. Catalog / remnants / appliance catalog load after unlock when the relevant section mounts.
- `next/dynamic` for AuthWall, NavigationHub, and the five hub sections.
- `AdminToolsDrawer` loads only when `adminOpen` (event bus extracted to `admin-tools-events.ts` so TipTap is not on the chrome chunk).
- Cycle Audit mounts Visual Bay Scan, Audit Report, and SIMS Finder on demand.
- `fetchAudits` bounded to today + `.limit(200)`. Appliance scans GET `.limit(200)`.
- `fetchSpecialists` column list — no `pin_code` / `temp_pin_hash`; Hub-bridge remains PIN source of truth.
- Migration `20260813_p0_query_indexes.sql` — composite indexes for audits, remnants, locations, rotations, manager notes. Hub tables (`carpet_audits` / `carpet_remnants`) key on **`store_number`** (added if missing — original CREATE omitted it). Store Ops (`store_locations` / `weekly_rotations`) key on **`store_id`**. Floor Pad uses **`store_number` + `department`** (Phase 2) or **`store_id` + `department_code`** (legacy). Script skips any index whose columns are absent.

## 2026-08-12 — Master Admin PIN reset via service-role API

### Shipped
- `POST /api/auth/reset-pin` + `lib/store-ops/reset-pin.ts` — Super Admin Bearer or `current_pin` auth; service-role writes `store_specialists.pin_code` and **UPSERTs** `store_profiles` (creates Master Admin row when missing).
- `updateSpecialistPin` / Change PIN modal now call the API (no more update-only `store_profiles` miss).
- Best-effort sync of linked `profiles.pin_code` + Auth password for Hub bridge continuity.

## 2026-08-12 — Enable RLS on flagged public tables

### Shipped
- Migration `supabase/migrations/enable_rls_flagged_tables.sql` — `ENABLE ROW LEVEL SECURITY` on `appliance_catalog`, `appliance_scans`, `store_specialists` (gap from appliance migration / schema-only roster RLS).
- Loop enables RLS on any remaining `public` base tables, then asserts none lack `relrowsecurity`.
- Keeps permissive anon/authenticated policies on the flagged hub tables so floor PWA access is not locked out.

## 2026-08-12 — Immersive Snap Bay AI Audit camera

### Shipped
- `VisualBayScannerModal` rebuilt as full-screen (`100dvh`) immersive overlay — live `<video>` is `object-cover` edge-to-edge (Carb Buddy–style).
- Top glass header (title + Aisle/Bay) and bottom camera-app control cluster (shutter / Open Live Camera + Upload Photo); close ✕ top-right.
- WebRTC cascade: `facingMode: { exact: "environment" }` → `facingMode: "environment"` → `video: true`; `playsInline` + `muted` + `autoPlay` with post-mount attach.
- Pulsing red connecting indicator while the rear camera initializes.

## 2026-08-12 — Master Admin bootstrap + Hub-bridge resilience

### Shipped
- `POST /api/auth/bootstrap-admin` (Bearer `CRON_SECRET` / `BOOTSTRAP_SECRET`) + `lib/store-ops/bootstrap-admin.ts` + `scripts/bootstrap-admin.mjs`.
- Seeds/resets Master Admin roster (`master_admin` / PIN `1234` or `HUB_MASTER_PIN`), links `auth.users` + `profiles` (`super_admin`), clears orphan profile rows.
- Hub-bridge now looks up by `specialist_id` / name aliases; **master PIN auto-provisions** Super Admin so login never dead-ends.
- Executed local bootstrap against live project: store `2587`, username `master_admin`, Auth smoke test passed.

## 2026-08-12 — Hub PIN → Auth bridge (Master Admin unlock)

### Shipped
- `POST /api/auth/hub-bridge` + `lib/store-ops/hub-bridge.ts` — service-role verifies roster PIN, ensures Auth user + `profiles` link, mints Supabase session (no phone OTP).
- Client `hub-bridge-client.ts` + AuthWall login/setup/unlock call `setSession` after PIN verify.
- Cold restore without Auth JWT forces PIN unlock wall so Store Ops (Admin Tools, map, briefing, invites) unlock with Hub PIN alone.
- Biometric paths require an existing Auth session (otherwise PIN once).
- Soft-fail banners retargeted to Hub PIN unlock copy; phone OTP remains optional recovery.

## 2026-08-12 — Soft-fail Store Map / Bulk Admin auth

### Shipped
- `GET /api/departments` + `GET /api/store-locations` warm `createSupabaseServerClient` and return empty lists + `auth_required` instead of hard 401 UI blockers.
- Bulk generate keeps 401 for writes but returns a structured Auth hint; Bulk + Admin Tools show OTP refresh copy.
- Store Map amber banner with Retry; env helpers also accept `SUPABASE_URL` / `SUPABASE_ANON_KEY` aliases.
- Verified `.env.local`: `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` are set.

## 2026-08-12 — Soft-fail Shift Intelligence Briefing auth

### Shipped
- `POST /api/store-health/ai-summary` warms `createSupabaseServerClient` (cookie session) and returns a 200 session-refresh briefing when Auth is missing instead of hard 401.
- `fetchShiftBriefing` client mirrors the soft fallback; `ShiftBriefingCard` shows an amber OTP refresh prompt.

## 2026-08-12 — Floor Pad voice dictation + follow_up_date

### Shipped
- Mic / Stop & Parse control on Floor Pad toolbar (Web Speech API) with pulsing rec indicator.
- Stop appends transcript to TipTap then auto-runs `extractTasksAndTag` (aisle/bay, tasks, metadata).
- Metadata now includes `follow_up_date` (ISO) from Gemini + local weekday / “in N days” heuristics.

## 2026-08-12 — Floor Pad Gemini metadata extract

### Shipped
- Gemini Copilot prompt/schema now returns structured `metadata`: appliance_serials, carpet_remnants, operational_hotspots, vendor_mentions (`lib/store-ops/ai-note-extract.ts`).
- Migration `20260812_manager_notes_metadata.sql` — `manager_notes.metadata` JSONB + GIN index.
- `ManagerNote.metadata?: Record<string, any>` persisted on save/upsert; Floor Pad stamps metadata from Copilot into autosave.

## 2026-08-12 — Fix manager_notes RLS (Floor Pad upserts)

### Shipped
- Patch migration `20260812_fix_manager_notes_rls.sql` — authenticated SELECT/INSERT/UPDATE/DELETE with `USING/WITH CHECK (true)`; drops JWT store/dept policy that blocked inserts.
- `saveManagerNote` always stamps `author_id` from `supabase.auth.getUser()` (throws if no Auth session); DB trigger backfills `author_id` from `auth.uid()` when omitted.
- Aligned `20260812_manager_notes.sql` + JWT RLS manager_notes block to the same permissive policies.

## 2026-08-12 — Floor Pad layout densify + expanded font suite

### Shipped
- Collapsed Dept/Aisle/Bay into one horizontal pill bar under the Floor Pad title; title + formatting + Gemini merged into a single sticky toolbar row.
- TipTap `.ProseMirror` canvas targets ≥80dvh writing height; chrome/footer compacted.
- Dynamic Google Fonts load on pad open (15 faces: Inter/Montserrat/Poppins/Open Sans, Merriweather/Playfair/Lora/Cormorant, Roboto Mono/Fira Code/JetBrains Mono, Caveat/Kalam/Dancing Script/Shadows Into Light).
- Custom font picker renders each option in its own typeface.

## 2026-08-12 — Executive Floor Pad (rich-text Manager Notes)

### Shipped
- Replaced S Pen canvas workspace with full-screen **Executive Floor Pad** under `components/manager-notes/` (TipTap rich text).
- Typography toolbar: Inter / Roboto Mono / Merriweather / Caveat, sizes, bold, bullets, checkable task lists.
- Compact auto-filling Dept / Aisle / Bay header pills.
- Gemini Copilot Server Action `extractTasksAndTag` (`app/actions/manager-notes.ts`) — appends task checkboxes + fills missing aisle/bay; domain in `lib/store-ops/ai-note-extract.ts`.
- Migration `20260812_manager_notes_archive.sql` — `is_archived` for durable archive without cluttering active shift list.
- Debounced autosave (~700ms) on keystroke via Supabase upsert; Archive action on selected notes.
- Compatibility shim: `components/store-ops/ManagerNotesWorkspace.tsx` re-exports Floor Pad.

## 2026-08-12 — Phase 3: Offline Resilience & Conflict Resolution

### Shipped
- `components/offline/ConflictResolutionModal.tsx` — side-by-side Local vs Server conflict UI (Keep Local / Accept Server).
- `lib/sync-conflict.ts` — conflict events + SyncConflictError; flush pauses for supervisor choice.
- `lib/sync-queue.ts` — transaction UUIDs, optimistic timestamps, exponential backoff retries, version/409 conflict detection, `installSyncAutoFlush` on `online` + `visibilitychange` + `focus`.
- Orphan sweep: removed unused `DefaultPinNotice`, `FirstLoginCredentialsModal`, and PIN “Remind Later” helpers (AuthWall owns setup).

## 2026-08-12 — Phase 1: Security & Identity Handshake

### Shipped
- Removed emergency unlock (`MASTER-2026-TEMP`, `lib/emergency-access.ts`, `POST /api/auth/emergency-unlock`) from AuthWall and the API surface.
- Store Ops actor resolution is Supabase Auth only: `getRequestAuthUser` → `profiles` (`id = auth.users.id`); `x-store-ops-*` headers are no longer trusted (`parseStoreOpsActor` always null).
- Client APIs send `Authorization: Bearer` via `storeOpsAuthHeadersAsync` / `getSupabaseAccessToken` (same localStorage session as phone OTP).
- Push subscribe maps `user_id` to Auth profile id; `specialist_id` cleared on upsert.
- Phone reset confirm links Auth user → `profiles` + JWT `app_metadata` (`linkAuthUserToSpecialistProfile`).
- Migration `supabase/migrations/20260812_jwt_rls_policies.sql`: defensive JWT/RLS (table existence checks, `store_number` isolation), Custom Access Token Hook, `sync_profile_app_metadata`.
- **Applied in Supabase:** Phase 1 SQL + Custom Access Token Hook enabled.

## 2026-08-12 — Phase 2: Data Durability & UI Cleanup

### Shipped
- Migration `supabase/migrations/20260812_manager_notes.sql` — durable `manager_notes` with `store_number`, `department`, `author_id`, `category`, `updated_at`; JWT store/dept RLS; preserves S Pen / AI columns from 20260811.
- `lib/store-ops/manager-notes.ts` — Supabase list/upsert/delete + realtime subscribe; optimistic UI in `ManagerNotesWorkspace`.
- Migration `supabase/migrations/20260812_sunday_bay_assignments.sql` — `sunday_bay_assignments` unique per store/dept/week/bay; JWT RLS; `roster_specialist_id` bridge to hub roster.
- `lib/store-ops/sunday-audit.ts` — server sync via Supabase (ISO week → `week_starting` Monday); staging card + assignment modal optimistic writes + realtime.
- Retired orphan `components/barcode/MarryBarcodeModal.tsx` (superseded by Quick-Add / scan link flow).

### Ops follow-up
- Apply both Phase 2 migrations (after Phase 1 JWT helpers). Enable Realtime on `manager_notes` and `sunday_bay_assignments` if not auto-enabled.

## 2026-08-11 — Native mobile: splash theme, haptics, offline banner

### Shipped
- PWA splash/theme aligned to `#090d16` (`public/manifest.json`, `app/manifest.ts`, layout `themeColor`, CSS void, TWA colors).
- `utils/haptics.ts` + root `HapticsListener` — short `navigator.vibrate` pulse on buttons, switches, and nav tabs.
- `OfflineNetworkBanner` floating toast when offline; auto `flushSyncQueue` on reconnect with synced confirmation.

## 2026-08-11 — Mobile UI polish: SVG bottom nav, header, action buttons

### Shipped
- Lucide React icons via `components/hub/NavIcons.tsx`; replaced emoji bottom-nav / drawer glyphs.
- Navigation Hub bottom bar capped at 4–5 tabs; Notes/Settings overflow into a More sheet (`lib/nav-hub` `overflow` flag).
- Header consolidates Online / queued / role into one status chip; department context pills stay single-row `overflow-x-auto no-scrollbar`.
- Safe-area utility `.pb-safe`; shared button tokens (`.btn-primary-glow` h-12, `.btn-grid-action-*`, `.btn-icon-touch`).
- Roster action grid + primary Add Supervisor CTA normalized to touch targets and glass accents.

## 2026-08-11 — Manager Notes & S Pen Canvas (Gemini synthesis)

### Shipped
- Migration `supabase/migrations/20260811_manager_notes.sql` — `manager_notes` table (UUID `store_id` FK to `stores`, dept/aisle/bay context, canvas PNG data-URL, `ai_summary`, `action_items` jsonb).
- Domain `lib/store-ops/ai-note-summary.ts` — prompt, normalize, local heuristic fallback; `lib/store-ops/manager-notes.ts` — offline localStorage note list aligned to schema.
- `POST /api/store-ops/ai-note-summary` — Store Ops actor auth; accepts title/content + optional S Pen PNG; Gemini Flash multimodal → 2-sentence executive summary, action items (`task` / `priority` / `assignee_role`), referenced SKUs/aisles/bay exceptions; graceful local fallback without key.
- Client `synthesizeManagerNote` + glass `ManagerNotesWorkspace` (stylus pressure strokes, undo/clear/colors, ✨ Synthesize Action Items → glowing checkbox cards).
- Entry points: Admin Tools → **Manager Notes & S Pen**, `/manager-notes` hub route (Master + Supervisor nav), hash `#manager-notes`.

## 2026-08-11 — AI Visual Bay Scan (Gemini multimodal)

### Shipped
- Domain module `lib/store-ops/ai-bay-scan.ts` — prompt, normalize, local fallback for carton/pallet estimates + cleanliness score + severity-ranked issues.
- `POST /api/store-ops/ai-bay-scan` — Store Ops actor auth; accepts base64 / data-URL bay photo + optional aisle/bay/department_code; Gemini Flash multimodal; graceful local fallback when `GEMINI_API_KEY` missing.
- Client `scanBayVisual` + `VisualBayScannerModal` (live camera / Zebra upload, scan beam animation, obsidian results drawer with severity pills + quick actions).
- Mounted **📷 Snap Bay AI Audit** on Store Map header, bay actions sheet (`StoreLocationGrid`), and Flooring Cycle Audit.

## 2026-08-11 — Sunday Flooring Cycle Audit staging + Master Admin dept context

### Shipped
- Master Admin **My Department Context** pin (`lib/admin-department-context.ts` + `AdminDepartmentSwitcher` in NavigationHub) — Full Store / D23 Flooring / D35 Appliances / Plumbing; privileges unchanged.
- `SundayAuditAssignmentModal` + glowing `SundayAuditStagingCard` — pending Flooring weekly bays, specialist assignment dropdowns, **Auto-Assign All to Me (Flooring DS)**, Stage/Draw 12 bays (composes existing generate API).
- Surfaced on `/dashboard` (Pending Cycle Audits), Cycle Audit tab header, Admin Tools → **Sunday Rotation Engine**, and `/flooring` deep link → `/?section=audit` with D23 pin.
- Person assignments persist locally per store/week (`lib/store-ops/sunday-audit.ts`); bay engine ownership stays in rotations/cron.

## 2026-08-11 — Store Audit Velocity & Health Telemetry Chart

### Shipped
- `lib/store-ops/telemetry.ts` — hourly shift velocity (06:00–22:00), linear target baseline to 100%, exception-spike flags; Overall / D23 Flooring / D35 Appliances series.
- `GET /api/store-health` snapshot now includes `telemetry` (composed from `weekly_rotations.completed_at` + `rotation_exceptions`).
- `StoreHealthChart` glass SVG (Dexcom-style neon curve + dashed target + amber/rose spikes) mounted on `/dashboard` under Shift Briefing.
- `POST /api/store-health/ai-summary` + shift-briefing prompt fold `audit_velocity` into Gemini / local 3-bullet briefing; client passes telemetry from health fetch.

## 2026-08-11 — Obsidian-glass pass: AuthWall, Store Map, modals

### Shipped
- Extended glass tokens in `app/globals.css`: stronger `glass-input` emerald rings, `.glass-backdrop`, `.glass-void`, `.glass-label`, bay status helpers (`.glass-bay-complete` / pending / cyan).
- `AuthWall` floats a `.glass-card` over `.glass-void` with emerald glow; PIN pads / WebAuthn / emergency + phone-reset CTAs use `min-h-[44px]` + emerald focus / `btn-primary-glow`.
- Store Map header + department overview + `StoreLocationGrid` / bay action sheet glassified; S/T cells use high-contrast emerald / amber / cyan status glows.
- Remaining overlay modals (PIN, credentials, Quick-Add, Marry, Confirm, Audit Report, Sims finder, Force Rotation, etc.) use `bg-black/60 backdrop-blur-md` backdrops + `.glass-card` bodies; shared `NumberField`/`TextField` focus rings match glass tokens.
- Auth session mechanics and Supabase calls unchanged (presentation-only).

## 2026-08-11 — Department Catalog Taxonomies + AI Taxonomy Generator

### Shipped
- Central registry `lib/catalog/taxonomies.ts` maps Lowe's catalog codes (D21 Lumber → D52 Tools) to default category / sub-category trees; hub departments resolve via `taxonomyCodeForHubDepartment`; AI overrides persist in `localStorage` (`deptsync_catalog_taxonomies`).
- Domain AI module `lib/catalog/ai-taxonomy.ts` + `POST /api/catalog/ai-taxonomy` — Gemini Flash generates department taxonomies; graceful registry fallback when `GEMINI_API_KEY` missing.
- `TaxonomyManagerModal` (glass-card) in Admin Tools → **Catalog Taxonomies** with ✨ Generate / Refresh AI Taxonomy.
- `TaxonomyDrillDown` accordion on `DepartmentAuditSection` + `/department` overview; selected sub-category stamps audit `sub_category` and filters today's logs.

## 2026-08-11 — Appliance Scan Anomaly Detection

### Shipped
- `POST /api/appliances/ai-anomaly` — Gemini Flash anomaly detection over `appliance_scans` + `appliance_catalog`; local heuristics fallback when key missing (duplicate serials / distant locations / category mismatch / unscanned high-value models).
- Domain module `lib/appliances/ai-anomaly.ts`; widget `ApplianceAnomalyWidget` mounted in `ApplianceAuditSection` with emerald/amber/rose status glow and Zebra `min-h-[44px]` actions.

## 2026-08-11 — Zebra Shift Intelligence Briefing

### Shipped
- `POST /api/store-health/ai-summary` — builds briefing from `buildStoreHealthSnapshot` (pace, bottlenecks, exceptions); Gemini 3-bullet executive brief; local metrics fallback without API key.
- Domain module `lib/store-ops/shift-briefing.ts` + client `fetchShiftBriefing`.
- `ShiftBriefingCard` glass banner atop `/dashboard` with emerald glow, priority department, tap refresh + pull-to-refresh.

## 2026-08-11 — Flooring AI Remnant Aging & Variance Intelligence

### Shipped
- `POST /api/flooring/ai-insights` — Gemini Flash analyzes cycle audit variance + remnant inventory against 30/60/90+ age bands; local aging fallback when `GEMINI_API_KEY` missing.
- Domain module `lib/flooring/ai-insights.ts` composes `lib/aging` + `lib/variance`; markdown math stays in `lib/markdown`.
- `agingBand()` added to `lib/aging.ts` (0-29 / 30-59 / 60-89 / 90+).
- `FlooringAIInsightBanner` glass card on Flooring Cycle Audit + Remnants with one-touch **Apply Recommended Markdown** → `computeMarkdown` + `saveRemnant`.

## 2026-08-11 — AI Pre-Flight for Bulk Location Generator

### Shipped
- `POST /api/store-locations/ai-parse` — Super Admin only; Gemini parses messy aisle/bay text or CSV into structured locations + `corrections_made`.
- Shared normalizer `lib/store-ops/ai-parse.ts` enforces `isValidAisle` / bay swap / department code allow-list after model output.
- Client helper `aiParseLocations`; Bulk Generator gains **✨ AI Pre-Flight** tab with glass preview table and **Confirm & Bulk Create** → existing `/api/store-locations/bulk` (`bulkGenerateLocations` → `bulkInsertLocations`).
- Requires `GEMINI_API_KEY` (503 when missing).

## 2026-08-11 — Gemini AI integration layer

### Shipped
- Added `@google/generative-ai` dependency.
- Server-only helper `lib/ai/gemini.ts`: `callGeminiFlash`, `callGeminiFlashJson`, `extractGeminiJsonText` / `parseGeminiJson`, `isGeminiConfigured`.
- Env: `GEMINI_API_KEY`, `GEMINI_MODEL` (default `gemini-3.5-flash`) in `.env.local` (gitignored).
- Owns transport + JSON extraction only; product prompts / API routes compose on top.

## 2026-08-11 — Obsidian-glass design system (glassification)

### Shipped
- Global tokens shifted to obsidian void (`#09090b` / zinc-950) with emerald + cyan glow accents in `app/globals.css`.
- Utility classes: `.glass-card`, `.glass-panel`, `.glass-input`, `.btn-primary-glow`, `.glass-focus`, typography helpers, status pills.
- Applied to `NavigationHub` / `HubChrome` headers + drawers + bottom nav (backdrop-blur glass panels).
- `BulkLocationGenerator` form + CSV dropzone glassified with emerald focus rings and cyan batch CTA.
- Flooring / Appliances / Dept Audit section cards use `.glass-card` + emerald/cyan mode pills; variance accents updated in `lib/variance.ts`.
- AuthWall / PIN / credentials, Store Map + location grid, and remaining overlay modals use `.glass-void` / `.glass-backdrop` / `.glass-card` with Zebra `min-h-[44px]` targets (2026-08-11 pass).
- No changes to sync queue, Supabase clients, or audit state logic.

## 2026-08-11 — Emergency unlock: update-only (no username insert clash)

### Fixed
- `POST /api/auth/emergency-unlock` never `.insert()`s; finds existing `store_specialists` by username (`master_admin`) / name / MasterAdmin role and `.update()`s unlock flags only.
- Preserves existing username to avoid `store_specialist_username_key`; on miss or update failure still returns a local Master Admin specialist so `MASTER-2026-TEMP` authenticates immediately.

## 2026-08-11 — Emergency admin bypass + phone OTP recovery

### Shipped
- Temporary master code `MASTER-2026-TEMP` on AuthWall login/unlock → `POST /api/auth/emergency-unlock` sets `store_specialists` to Master Admin (`is_active`, clears invite/temp credential flags) and starts `deptsync_auth_session` in localStorage.
- Profile setup requires verified mobile (`phone_number`); login offers **Forgot Access Code? Reset via Phone** using `supabase.auth.signInWithOtp` + verify → `/api/auth/phone-reset/confirm`.
- Supabase browser client persists Auth sessions in localStorage (`persistSession` / `autoRefreshToken`); roster wall session already restored without re-auth until logout or 8h idle.

## 2026-08-11 — Roster: no hardcoded seeds + DB-driven temp credentials

### Fixed
- Removed auto-injection of Master Admin / Flooring Supervisor / Amber seed profiles (`ensureRosterSeeds`); roster renders `store_specialists` from Supabase (+ offline-only real profiles).
- Legacy `seed-*` local rows are purged on fetch; **Delete User** removes unwanted profiles without revival.
- "Temporary Credentials Active" badge uses only `must_change_credentials` / `must_change_pin` flags.

## 2026-08-11 — Settings connection test + operational cache UI

### Fixed / Shipped
- Test Connection probes `appliance_scans` head count; shows **Connected (Database Live)** (green) or **Offline / Unreachable** (red).
- Local storage panel lists Appliance Audit Cache · Remnant Inventory Cache · Pending Queue only (catalog cache removed) with one-tap **Clear Local Cache**.

## 2026-08-11 — Offline sync queue counter reset

### Fixed
- `flushSyncQueue` drops successful actions and rewrites localStorage; when a store has zero remaining items it re-notifies UI subscribers.
- Header badge + Settings/Admin pending counts use reactive `usePendingSyncCount` / `useNetworkBadge` listeners on `carpet-sync-queue-changed` so the toast and `0 queued` update together.

## 2026-08-11 — Remove Catalog bottom-nav tab

### Shipped
- Catalog removed from Master Admin bottom nav; 4-up grid: Flooring · Appliances · Remnants · Master.
- `/catalog` redirects to `/appliances` → `/?section=appliances`. Catalog section UI no longer mounted in the hub.

## 2026-08-11 — Appliance scan log category accordion + pagination

### Shipped
- Scan log groups by main category (collapsed by default) with sub-category sections and unit totals (`🍳 Cooking / Ranges — 42 units`).
- Search / filter auto-expands only matching category accordions and hides non-matches.
- Expanded groups paginate SKU cards at 10 per page (`Prev` / `Next`).

## 2026-08-11 — Appliance scan log filter layout polish

### Fixed
- Removed sticky/absolute filter bar that overlapped scan cards; static `flex flex-col gap-3` header with full-width search + horizontally scrollable pills (`no-scrollbar`).
- Active pill uses `border-emerald-500 bg-emerald-950/40 text-emerald-400`; All shows `Showing All · N SKUs`.

## 2026-08-11 — Alphanumeric aisle codes (BW / RW / 12 / A1)

### Shipped
- `store_locations.aisle` is TEXT (migration `20260811_alphanumeric_aisle.sql`); values normalized `.trim().toUpperCase()`.
- Bulk Generator aisle input is `type="text"` with live auto-caps (`bw 01` → `BW 01`).
- Batch CSV parser (`lib/store-ops/aisle.ts` → `parseLocationBatchCsv`) accepts alphanumeric aisle strings — no `parseInt` / numeric-only validation on aisle.
- Types + bulk API treat aisle as `string`; Store Map aisle groups sort with natural alphanumeric compare.

## 2026-08-11 — Appliance scan log aggregation + editor + export

### Shipped
- Scan log UI groups by `item_number` with bold **Qty** on each card; expand for per-unit timestamps, serials, locations.
- Sticky filter bar: category pills (All · Ranges/Cooktops · Wall Ovens · Refrigeration · …) + quick search (SKU / location).
- In-line **Edit** modal: increment/decrement quantity, edit/append serials, bulk location/bay update for the SKU group (`PATCH` + create/delete under the hood).
- CSV export now ships **SUMMARY** (`Item Number`, `Description`, `Category`, `Total Count Scanned`, `Locations Found`) plus **RAW DETAIL** audit trail columns.

## 2026-08-10 — Appliance Scanner continuous hands-free mode

### Shipped
- Barcode detect → immediate `POST /api/appliances/scans` (no "Log & Reset" / Submit gate).
- Known `appliance_catalog` hits: success chime + haptic, session counter ++, clear for next scan (location sticky).
- Unrecognized / missing sub_category: pause on Quick-Add modal → save catalog → auto-log scan → continue.
- Sticky floating **Session Total: N items scanned** counter at top of Appliance Scanner.

## 2026-08-10 — Appliance scan save: no silent offline success

### Fixed
- `saveApplianceScan` POSTs to `/api/appliances/scans` when online and **throws** on failure (removed catch→offline success path).
- API insert uses explicit logging + thrown errors; schema body: `item_number`, `serial_number`, `location`, `category`, `sub_category`, `scanned_by`.
- Scanner UI shows red toast `Failed to save scan: …` and re-fetches the scan list after a successful write.

## 2026-08-10 — Dedicated appliance_catalog + appliance_scans

### Shipped
- New tables `public.appliance_catalog` (`item_number`, `upc`, `description`, `category`, `sub_category`) and `public.appliance_scans` (`item_number`, `serial_number`, `location`, `category`, `sub_category`, `scanned_by`, `scanned_at`) with store scoping + migration backfill from legacy carpet_* appliance rows.
- Types `ApplianceCatalogItem` / `ApplianceScan`; client libs `lib/appliance-catalog.ts` / `lib/appliance-scans.ts`; sync queue actions; API routes `GET|POST|DELETE /api/appliances/catalog` and `/api/appliances/scans` (CSV via `?format=csv`).
- Top-level suites: Laundry · Refrigeration · Cooking / Ranges · Dishwashers · Microwaves / Venting; required sub chips on UPC link (`QuickAddApplianceModal`).
- Appliance Scanner + Appliance Catalog sections own the new tables; CSV columns: Category, Sub-Category, Item #, Serial #, Location.

## 2026-08-10 — Appliance suite categories + sub_category linking

### Shipped
- Top-level appliance suites: Laundry · Refrigeration · Cooking · Dishwashers · Microwaves (Washer/Dryer collapsed into Laundry).
- Required sub-category chips on Quick-Add UPC→SKU link and Appliance audit / catalog forms (`ApplianceCategoryFields`).
- `sub_category` on `carpet_catalog` / `carpet_audits` (migration `20260810_appliance_sub_category.sql`); CSV + audit report include Sub-category.
- Legacy flat labels remapped on read + in migration (Washer→Laundry/Washer, Refrigerator→Refrigeration, etc.).

## 2026-08-10 — Store Map bay rows mobile UX

### Shipped
- Removed inline ★ Week / Show micro-buttons from S/T rows.
- Assigned-week status shown as a non-clickable amber dot on the Bay label.
- S/T switches use ≥44×44 touch targets.
- Tap Bay label → bottom sheet: Pin to Current Week, View Audit Log/History, Edit Location Details.

---

## 2026-08-10 — Dept toggles, adaptive priority, showroom zones

### Shipped
- Migration `20260810_dept_priority_showroom.sql`: departments default `is_active=false` except Flooring; `manual_priority_count`; `location_type` (`STANDARD`|`SHOWROOM_STACKOUT`) + `audit_frequency_days` (orthogonal to Selling/Topstock `type`).
- Sunday cron already filters `departments.is_active`; Super Admin master toggles on Store Map Overview + Settings Department Overview.
- Adaptive draw weights `(1 + manual_priority_count) × age_days` via `last_completed_at`; ★ Week on Store Map bumps priority and assigns to current week.
- Showroom Quick Touch card on Zebra dashboard — rapid cycle independent of weekly aisle rotation.

---

## 2026-08-10 — Associate floor permissions & nav

### Shipped
- Store Ops actor role `associate`: read dept weekly rotations / locations, complete bays, verify + create `rotation_exceptions`; denied targets PATCH, location admin PATCH, invite, generate/reset, Admin Tools / `/admin/*`.
- Associate ops nav only: My Department Checklist, Barriers / Log, Specialty Tools, My Profile / PIN (in-page specialty switcher on `/`).

---

## 2026-08-10 — Auto-generated invite PIN on Add Supervisor

### Shipped
- Add Supervisor modal no longer accepts a typed default password (`ChangeMe123` removed from admin issue path).
- Read-only **🎲 Auto-Generated 6-Digit PIN** badge; submit calls `/api/admin/invite-supervisor` and opens the invite/SMS preview with the returned `temporary_pin`.
- Reset credentials also re-issues via invite (random PIN + preview). Invite API preserves `MasterAdmin` role.

---

## 2026-08-10 — Admin Invite Testing Harness

### Shipped
- Roster **Test Invite Flow** generates `test_mode` invite (`/invite?token=…&test=1`), opens harness modal with 6-digit PIN, welcome SMS preview, **Copy Invite Link**, **Copy Full SMS Text**.
- SMS copy: `Welcome to DeptSync! Access your department portal here: [Link]. Your temporary PIN is: [PIN].`
- `/invite` with `test=1`: console logs `Token Validated`, `PIN Reset Success`, `Biometric Prompt Fired`; complete is dry-run (token + temp PIN preserved for repeat rehearsals).

---

## 2026-08-10 — Supervisor Invite & Onboarding Engine

### Shipped
- Migration `20260810_supervisor_invite.sql`: `invite_token`, `invite_token_expires_at`, `must_change_pin`, `temp_pin_hash`, `phone_number` on `store_specialists`.
- `POST /api/admin/invite-supervisor` — Super Admin issues 6-digit temp PIN (hashed) + UUID token; Twilio SMS when configured, else copyable `sms:` preview.
- Public `GET/POST /api/invite/[token]` — preview, verify temp PIN, complete permanent PIN (clears invite fields).
- `/invite?token=` onboarding: temp PIN → Create New PIN → Add to Home Screen (`beforeinstallprompt`) → WebAuthn Face ID / Fingerprint → Zebra dashboard.
- Roster **Invite** action + invite preview card (PIN / URL / SMS copy).

---

## 2026-08-10 — Mobile floor UX Waves A–C

### Wave A — Admin Tools drawer + DS lockdown
- `AdminToolsDrawer`: slide-over (defaults closed) for Bulk Generate, Force Rotation, all-dept targets, store #, diagnostics, supervisor link.
- Wired via NavigationHub **Admin** chip + hamburger + `openAdminTools()` / hash deep-links.
- Removed permanent Quick Actions from `/dashboard`; Store Map bulk accordion moved into drawer.
- Settings: Supervisors see PIN, own bay target, push, collapsed Device & sync. Master setup not permanent page chrome.

### Wave B — Density
- Compact single-line rotation rows; completed lists default collapsed.
- Store Map bay rows: inline S/T toggles on one line.
- Exceptions: Pending / Verified / Barriers / All tabs.
- Verify: collapsed completed + sticky Confirm/Submit bar.

### Wave C — Progressive disclosure
- `/department` = overview links only (no embedded auditor).
- Catalog/Remnant add-edit → bottom sheets; dense rows + overflow menus.
- Auditors: collapsible summaries; flooring “More details” + collapsed filters; denser shift log; Show All (5) on department Today.

---

## 2026-08-10 — Store Health Scorecard

### Shipped
- `lib/store-ops/health.ts` + `GET /api/store-health`: week rotations by dept (assigned/completed) + exception bottlenecks.
- `components/StoreHealthCard.tsx`: DS pace bar + barriers; Super Admin storewide grid + Bottleneck Summary (Freight/Staffing/Traffic).
- Embedded at top of `/dashboard` (first card after login for rotation roles).

---

## 2026-08-10 — Per-department weekly_bay_target settings

### Shipped
- Settings card lists every department with editable `weekly_bay_target` (Master Admin) or own dept (Supervisor); null/0 → 10.
- Draw engine already selects `departments.weekly_bay_target` in `generateWeeklyRotations` when choosing PENDING → ASSIGNED count.

---

## 2026-08-10 — Nested location grid + weekly_bay_target draw

### Shipped
- Store Location Grid: dept accordion → aisle accordion → bay row with Selling|Topstock toggles (depts collapsed by default).
- `generateWeeklyRotations` reads `departments.weekly_bay_target` per dept (null/0 → 10); cron uses the same path.

---

## 2026-08-10 — Store Map overview + force-draw modal

### Shipped
- Primary Store Map: department overview + location grid; Bulk Generator in accordion **Map Management & Bulk Add**.
- Weekly controls moved into **Trigger Weekly Rotation** modal; CTA **Force Draw New Rotation**; shows Automated Cron / current ISO week status.

---

## 2026-08-10 — Bulk Generator BOTH Selling + Topstock

### Shipped
- Location type radios: BOTH (default) / SELLING / TOPSTOCK — BOTH inserts two rows per bay.
- Upsert `onConflict: department_id,aisle,bay,type`; migration `20260810_store_locations_type_unique.sql`.
- Weekly Rotation Engine subtitle clarifies scheduled automation vs manual override panel.

---

## 2026-08-10 — Bulk Generator clean error messages

### Shipped
- Bulk location generate catch uses `err?.message || 'Failed to generate locations'` (no nested readableError rewrap).
- `storeOpsFetch` / `bulkInsertLocations` / `readableError` skip re-humanizing already-built Error messages.

---

## 2026-08-10 — Zebra rotations empty-week soft fail

### Shipped
- `/api/weekly-rotations` selects safe columns; ignores null `assigned_week`; returns `[]` on schema/empty failures (no red schema toast).
- Dashboard / `fetchThisWeekRotations` try/catch renders empty checklist when zero bays are assigned.

---

## 2026-08-09 — Exception summary empty-week defaults

### Shipped
- `weekly_rotations` summary select: `id, department_id, cycle_number, is_completed, completed_at` (falls back if `cycle_number` absent).
- Exception Log / `fetchExceptionSummary` try/catch defaults to empty summary + `[]` exceptions (UI shows 0/0 verified, 0 rows).

---

## 2026-08-09 — Exception log store_locations select harden

### Shipped
- `listRotationExceptions` joins `store_locations(id, aisle, bay)` only — no optional `type`/`status` columns.
- Empty week / missing log returns `[]` instead of crashing the Exception Log page.

---

## 2026-08-09 — Departments upsert onConflict = code

### Shipped
- Store Map / store resolve seeds via `ensureDepartmentsForStore` now upsert with `onConflict: 'code'` to match the live UNIQUE constraint (fixes constraint mismatch).

---

## 2026-08-09 — Dynamic store_number (no hardcoded defaults)

### Shipped
- `lib/store.ts`: no fallback to `1234` / `1852`; blank when unset; `setStoreNumber` may clear.
- Settings: free-edit draft + explicit **Save Store Number** (no blur/debounce auto-commit / lockout).
- Session / biometric / active specialist: mismatch only when both sides have a store number.
- Store-ops auth/resolve: require a real store number — never invent `#1234`.

---

## 2026-08-09 — Single-session auth UX

### Shipped
- Valid localStorage session → Hub `ready` with no PIN unlock on cold start / navigation.
- Removed action-level PIN gates (profile switch, manager markdown, discrepancy filter).
- Store number change no longer forces re-login; session store_number updates in place.
- SessionGate only admits/denies on session presence — never prompts credentials.

---

## 2026-08-09 — Upsert constraint audit + readable errors

### Shipped
- Audited all Supabase `.upsert()` calls against live unique keys.
- Store-ops: `stores` → `store_number`; `departments` → `code`; `store_locations` → `department_id,aisle,bay`; `weekly_rotations` → `location_id,assigned_week`.
- Inventory: catalog `store_number,sku`; specialists `store_number,name`; remnants/audits `id`; push `endpoint`.
- `lib/store-ops/errors.ts` humanizes PostgREST/constraint errors for Settings, Bulk Generator, Store Map, and API JSON responses.

---

## 2026-08-09 — Multi-store store_id + bulk upsert fix

### Shipped
- Migration `20260809_multi_store.sql`: `stores` registry; `store_id` on `departments`, `store_locations`, `weekly_rotations`; department code unique per store; location unique `(department_id, aisle, bay)`.
- Bulk generator upsert: `onConflict: 'department_id,aisle,bay'` with `status: PENDING`, `is_active: true`.
- APIs resolve hub `store_number` → `stores.id` via `x-store-ops-store-number`; filter/associate by active store (user-entered; no hardcoded default).
- Cron iterates active stores, then each store’s active departments safely.

### Ownership
| Concern | Owner |
|---|---|
| Store registry resolve | `lib/store-ops/stores.ts` |
| Hub store_number session | `lib/store.ts` |
| Bulk map upsert | `lib/store-ops/locations.ts` |

---

## 2026-08-09 — Supervisor verification & exception logging

### Shipped
- Migration `20260809_rotation_verification.sql`: `rotation_exceptions`, `CARRIED_OVER` status, `last_verified_week` on departments.
- `/verify-rotation` — Confirm All Completed or Report Incomplete Bays (reasons → exceptions + CARRIED_OVER).
- Next-week picks prioritize `CARRIED_OVER` before `PENDING`.
- `/admin/exceptions` — Super Admin weekly verification status + bottleneck log.
- Nav Hub links for Verify (supervisors) and Exceptions (admin).

---

## 2026-08-09 — Cron route bypass in Next.js Proxy

### Shipped
- Added root `proxy.ts` (Next 16 successor to middleware): immediate `NextResponse.next()` for `/api/cron/*` so Vercel Cron reaches JSON handlers with `CRON_SECRET` (no session cookie).
- Note: this repo had no prior middleware; HTML login responses on cron are often **Vercel Deployment Protection** — also set Protection Bypass / ensure Cron is allowed in project settings.

---

## 2026-08-09 — Automated weekly rotation cron + bay targets

### Shipped
- Migration `20260809_weekly_rotation_cron.sql`: `departments.weekly_bay_target` (default 10), `is_active`; Paint D24P, Inside/Outside Garden D28I/D28O, Millwork D30, Tools D25; Flooring / Home Decor merged.
- `GET /api/cron/weekly-rotation` — `CRON_SECRET` Bearer auth; queues each active dept up to its target (cycle reset when all COMPLETED).
- `vercel.json` cron: `59 23 * * 0` (Sunday 23:59 UTC).
- Settings → Weekly bay target card (`PATCH /api/departments`).

---

## 2026-08-09 — Fix Supabase service-role client + placeholder env detection

### Shipped
- `lib/supabase/admin.ts` — `createAdminClient()` requires real `SUPABASE_SERVICE_ROLE_KEY` (no anon fallback).
- `lib/supabase/env.ts` — rejects placeholder URL/keys so fake `.env.local` values fail loudly.
- API 503s return actionable missing-env messages; Store Map hint updated.

---

## 2026-08-09 — Web Push for weekly rotation alerts

### Shipped
- Migration `supabase/migrations/20260809_push_notifications.sql` — `push_subscriptions` + RLS (`auth.uid() = user_id`); hub bridge columns `specialist_id` / `department_code`.
- `lib/push/*` — VAPID config, browser subscribe helpers, `usePushNotifications` hook, server dispatch via `web-push`.
- APIs: `GET /api/push/vapid-public-key`, `POST|DELETE /api/push/subscribe`, `POST /api/push/dispatch`; rotation generate fans out pushes on success.
- Service worker `push` + `notificationclick` → opens `/dashboard`.
- Settings → **Phone rotation alerts** enable/disable card.

---

## 2026-08-09 — Navigation Hub (role-aware Zebra chrome)

### Shipped
- `lib/nav-hub.ts` — Super Admin vs Supervisor route menus + compact role badges (`[SUPER ADMIN]`, `[FLR DEPT]`).
- `components/hub/NavigationHub.tsx` — high-contrast hamburger drawer, user menu (role badge + login username), ops bottom nav.
- Routes: `/admin/supervisors`, `/settings`, `/department`; Store Map + Dashboard wrapped in Nav Hub + SessionGate.
- `SuperAdminQuickActions` on Store Map & Dashboard (Bulk Generate · Trigger Rotation · Manage Supervisors).
- Inventory `/` uses NavigationHub header; BottomNavBar still owns audit/catalog section tabs.

---

## 2026-08-09 — Store Operations: multi-dept map, RBAC, weekly rotations

### Shipped
- Migration `supabase/migrations/20260809_store_operations_rbac.sql`: enums (`user_role`, `location_type`, `rotation_status`), tables (`departments`, `profiles`, `store_locations`, `weekly_rotations`), RLS (super_admin full CRUD; department_supervisor read/update on assigned dept).
- Domain: `lib/store-ops/*` — rotation engine (PENDING pick → ASSIGNED; cycle bump when all COMPLETED; cool-down until reset), bulk bay generator, hub MasterAdmin/Supervisor → store-ops actor bridge.
- APIs: `POST /api/rotations/generate`, `POST /api/rotations/complete`, `GET /api/weekly-rotations`, departments + store-locations (+ bulk) routes (service role).
- UI: `/admin/store-map` Super Admin bulk generator + location grid + weekly generate; `/dashboard` Zebra supervisor checklist with optimistic complete.
- Settings → Store Operations links; `.env.example` adds `SUPABASE_SERVICE_ROLE_KEY`.

---

## 2026-07-30 — Biometric login + password manager autocomplete

### Shipped
- Login/setup/unlock forms: `method="post"`, `name` + `autocomplete` (`username` / `current-password`) for native OS keychain save prompts.
- `lib/biometric-auth.ts` — WebAuthn platform authenticator register/get; credential id stored in `deptsync_biometric_credential`.
- AuthWall: post-login “Enable Fingerprint / Touch ID” banner; returning “👆 Login with Fingerprint / Touch ID” when a passkey exists.

---

## 2026-07-30 — Login field cleanup + password eye toggle

### Shipped
- AuthWall login/setup/unlock: removed all username/password placeholder hints (empty fields on load).
- `TextField` `passwordToggle` — inline eye / eye-off SVG (no icon package) reveals or obscures password with aria-label + 44px touch target.

---

## 2026-07-30 — Soft-delete specialist roster (fix revive-after-delete)

### Shipped
- Root cause: `ensureRosterSeeds` re-inserted Amber / Flooring / Master after hard `removeLocal`.
- Added `store_specialists.is_active` (default true); delete now soft-deactivates locally + in Supabase, then best-effort hard DELETE.
- Inactive tombstones stay in localStorage so seeds are not revived; `fetchSpecialists` returns active-only.
- Admin roster: optimistic card removal, green toast `User [Name] has been removed from the roster.`, error toast on DB failure.
- Sync queue `delete_specialist` soft-deletes first; RLS policy note for update/delete.

---

## 2026-07-30 — Zero-Access Authentication Wall

### Shipped
- Non-dismissible `AuthWall` (`components/auth/AuthWall.tsx`) — full-screen blur gate; no Remind Later, ✕, or backdrop bypass.
- Workspace chrome/tabs/data hidden until login, credential setup, or quick unlock succeeds.
- Login: username + password/PIN against store roster (Amber temp → forced permanent credential setup).
- `lib/auth-session.ts` — sessionToken + lastActiveTimestamp in localStorage; 8-hour inactivity lock; header 🔒 logout.
- Returning session prompts quick 4-digit PIN (or password) unlock; Master Admin unlocks full-store tabs.

---

## 2026-07-30 — Soft keyboard + global hardware scanner

### Shipped
- Removed programmatic `.focus()` on tab/section mount (Flooring, Appliances, Department) so iOS/Android soft keyboards no longer open on every bottom-nav tap.
- `lib/hardware-scanner.ts` — window-level wedge listener (6+ chars, ≤150ms gaps) routes scans into the active section’s SKU lookup without focusing an input.
- Tap-to-type only: `selectOnFocus` highlights existing text; post-log / Quick-Add cancel uses `blurActiveInput()` to dismiss the keyboard.
- `app/page.tsx` blurs on section switch; Quick-Add no longer autoFocuses Item #.

---

## 2026-07-30 — DeptSync branding metadata alignment

### Shipped
- Locked PWA/layout/header copy to **DeptSync Hub** (no remaining Carpet/Flooring Hub titles).
- Manifest: name `DeptSync — Department & SIMS Audit Hub`, short_name `DeptSync`.
- Layout: title `DeptSync Hub · Department & SIMS Audit`, description inventory suite for Lowe's, appleWebApp title `DeptSync`.
- Header chrome: brand `DeptSync Hub`, subtitle `DeptSync · Lowe's #[store]`.

---

## 2026-07-30 — Audit Report Exporter & Printable Email Engine

### Shipped
- `lib/audit-report.ts` — report composition (metrics, sort by SIMS bay, email body, Markdown clipboard, mailto / Web Share).
- `components/hub/AuditReportModal.tsx` — formal printable inventory report with Print / Save PDF, Send via Email, Copy Formatted Summary.
- Export / Print Report action on Flooring (Cycle) shift summary, Appliances shift card, and generic Department shift cards.
- Print CSS in `globals.css` (`@media print`) strips chrome/nav/actions and renders high-contrast letter-size B&W tables.

---

## 2026-07-30 — Master Admin Team & Department Roster Manager

### Shipped
- Expanded `DepartmentScope` to full Lowe's store list (flooring → hardware + `all`) with `DEPARTMENT_META` icons/labels.
- Master Admin–only **👥 Team & Department Roster Manager** (`AdminRosterManager`): roster cards, reset credentials, edit scope, delete access.
- **+ Add Department Supervisor / Specialist** modal: role, department, auto username, temp password `ChangeMe123`, require first-login reset; shareable issued-credentials card.
- Helpers: `resetSpecialistCredentials`, `updateSpecialistScope`, `deleteSpecialist` (+ `delete_specialist` sync queue).
- Dynamic tabs: generic departments (plumbing, electrical, …) open `DepartmentAuditSection` + department catalog + profile; appliances/flooring/Master Admin unchanged.

---

## 2026-07-30 — DeptSync rebrand + department-scoped RBAC

### Shipped
- Rebranded to **DeptSync Hub** (manifest short_name `DeptSync`, layout meta, header eyebrow `DeptSync · Lowe's #… · Inventory & SIMS Audit`).
- New multi-department scanner/shield badge (`DeptSyncBadge`) + refreshed PWA icons (emerald boxes + amber barcode).
- Role schema: `MasterAdmin` | `Supervisor` | `Associate` with `assigned_department`, `username`, `must_change_credentials` on `store_specialists` (local + Supabase schema).
- `lib/rbac.ts` owns section visibility; Hub bottom nav filters tabs (Master Admin = all 5; Appliances Supervisor = Appliances / Catalog / Profile).
- First-login non-dismissible credential modal for supervisors on default credentials (`amber_appliance` / `ChangeMe123`).
- Catalog domain filter for department supervisors; store number change restricted to Master Admin.

---

## 2026-07-27 — Catalog category folder browse

### Shipped
- Catalog default view is category folder cards (icon, SKU count, SIMS bay preview); appliances roll up under 🔌 Appliances.
- Drill-down with ← Categories back badge + “+ Add [Category] Item”; search/scan bypasses folders and lists matches across all categories.
- 📂 / 📋 toggle next to search switches Folders vs flat master list; item cards extracted to `CatalogItemCard`.

---

## 2026-07-27 — Appliances Inventory & SIMS Audit workspace

### Shipped
- New hub tab **🔌 Appliances** (`HubSection: appliances`) in bottom nav + `HUB_SECTIONS`.
- `ApplianceAuditSection`: scan-to-catalog, appliance categories, SIMS staging chips, unit stepper, sticky Log Appliance & Reset (reuses `carpet_audits` / `carpet_catalog`).
- `APPLIANCE_CATEGORIES` + `CatalogCategory` union; Quick-Add `domain="appliances"`; Catalog / SIMS Finder search by appliance category & staging tags.

---

## 2026-07-27 — Handheld focus, 12/15 ft rolls, undo + live area

### Shipped
- `lib/focus-input.ts` — `focusAndSelect` (rAF + 100ms) restores SKU soft keyboard after modal close, reset, log, and drawer dismiss.
- Roll width presets: **12 ft / 15 ft** (default 12); legacy 6 ft remapped via `normalizeRollWidthFt`. Catalog edit saves `roll_width_ft` to Supabase.
- Log Roll & Reset / Quick-Add cancel fully clear SKU + measure fields (no sticky zeros); undo toast (6s) deletes last audit in one tap.
- Live roll badge: CLF | SQFT | SQYD from CLF × width; success double-beep + Quick-Add soft-pop via Web Audio.

---

## 2026-07-26 — Remove redundant header hamburger / NavDrawer

### Shipped
- Section switching is bottom-nav only; removed hamburger button, `NavDrawer`, and `menuOpen` state from header / page shell.
- Header now: Flooring Hub · store · network (left) + specialist badge · PIN gear (right).

---

## 2026-07-26 — Handheld layout pass (bottom nav + scan-first audit)

### Shipped
- Fixed PWA bottom nav (Audit / Catalog / Remnants / Settings) with emerald active glow; hamburger drawer retained as fallback.
- Cycle Audit: collapsible 1-line shift summary (default collapsed); sticky Log & Reset bar above bottom nav; in-form 📍 SIMS Stock opens SimsLocationFinder without leaving Audit.
- Replaced `window.prompt` / `window.confirm` with `TextPromptModal` (barcode link, remnant reserve) and `ConfirmModal` (remnant delete).
- Main column `pb-32` / audit `pb-44`; body `overflow-x: hidden`; touch targets stay at `h-12`.

---

## 2026-07-26 — APP_LAYOUT_MAP blueprint

### Shipped
- Added root `APP_LAYOUT_MAP.md`: shell/header, four workspace views, modal inventory, scan-path UX friction analysis for layout evaluation.

---

## 2026-07-26 — Dual scan trigger + auto-focus SKU

### Shipped
- SKU / barcode field auto-focuses on audit mount and after form reset.
- Enter on SKU always `preventDefault` + `handleSkuLookup` (fixed prior blur-without-lookup bug).
- Rapid digit burst (≥8 digits, ≤150ms gaps) auto-looks up after 250ms quiet — works when scanner omits Enter.
- Unmatched scans open ⚡ Quick-Add with barcode pre-filled.

---

## 2026-07-26 — Sheet Vinyl as Mode A roll goods

### Shipped
- Added `Sheet Vinyl` to `FLOORING_CATEGORIES`; `isRollGoodsCategory` treats Carpet + Sheet Vinyl as Mode A.
- 6ft / 12ft roll-width pickers on Audit, Quick-Add, Catalog, and Remnant forms.
- Remnant Rack form now includes Category dropdown (catalog auto-fill).

---

## 2026-07-26 — Universal Flooring & SIMS Audit Hub

### Shipped
- Multi-category schema/types: `category`, `sims_location` / `default_sims_location`, `box_count`, `calculated_sqft`, `sqft_per_box` on `carpet_*` tables (flooring_audits alias).
- Scan-to-Catalog: match auto-fills + chime + focus measure/count; unlinked UPC opens ⚡ Quick-Add modal → writes `carpet_catalog` and continues audit.
- Dual audit engine: Mode A Carpet CLF; Mode B carton/unit sq ft (`cartons × sqft_per_box`).
- SIMS Location Finder drawer in Catalog (`lib/sims.ts` aggregates audits + catalog defaults).
- Mid-scan draft (`carpet_hub_audit_draft`) + existing offline sync queue for dead zones.
- Hub copy / PWA manifest → Flooring Hub — SIMS Audit.

### Ownership
| Concern | Owner |
|---|---|
| Categories / audit mode | `lib/types.ts` |
| Carton math | `lib/calc.ts` |
| Quick-Add | `QuickAddCatalogModal` |
| SIMS locations | `lib/sims.ts`, `SimsLocationFinder` |
| Audit draft | `lib/storage.ts` |

---

## 2026-07-25 — Never query Supabase with fallback profile IDs

### Shipped
- PIN save resolves Supervisor by name/role when `id` is not a UUID; inserts without `id` when missing; only `.eq('id', …)` with real UUIDs (avoids 22P02).
- Load sync prefers DB Supervisor UUID + `pin_code` over seed/fallback session ids.

---

## 2026-07-25 — Supervisor PIN upsert + friendly errors

### Shipped
- PIN save upserts Supervisor into `store_specialists` when ID is a seed/fallback or update hits zero rows; persists real UUID + pin to session.
- Error copy uses Profile/Supervisor (not "specialist"); success toast "✅ Supervisor PIN updated successfully!"; dismisses change modal + default-PIN banner.

---

## 2026-07-25 — Fix PIN persistence across reloads

### Shipped
- `updateSpecialistPin` now updates Supabase by specialist `id` (resolves seed IDs via name), throws on failure (modal stays open).
- On success: immediately writes `carpet_active_specialist` + React state with new `pin_code`.
- On load: `syncActiveSpecialistFromRoster` merges DB roster into active session; dismisses default-PIN banner when `pin_code !== 1234`.

---

## 2026-07-25 — Offline sync, SW shell, multi-store, manager markdown

### Shipped
- `public/sw.js` + `ServiceWorkerRegister`: cache-first static shell, network-first HTML, network-only APIs.
- `lib/sync-queue.ts` (`carpet_hub_sync_queue`): enqueue offline writes; auto-replay on `online` with green sync toast.
- Header network badge: 🟢 Online / 🟠 Offline Mode (+ pending queue count).
- Store context (`lib/store.ts`): Lowe's # selector in Settings; `store_number` on all entities + Supabase `.eq` filters.
- Manager markdown: 60+ / Supervisor-gated modal (%, fixed $); clearance badge on remnant cards.
- Schema: `store_number`, markdown columns, per-store unique indexes.

---

## 2026-07-25 — Deduplicate supervisors + default PIN customization

### Shipped
- `dedupeRoster()` merges duplicate Supervisor / "Department Supervisor" cards (local + remote + UI).
- After login with default PIN `1234`, show security banner: Set New PIN / Remind Me Later.
- `ChangePinModal`: Current PIN + New 4-digit + Confirm; saves to Supabase/`pin_code`.
- Header ⚙️ Change PIN + Settings shortcut; green toast on success.

---

## 2026-07-25 — Supervisor PIN security & roster cleanup

### Shipped
- Removed Alex/Dave placeholder seeds; default roster is **Department Supervisor** (PIN `1234`) or a clean team the store registers.
- Role badges: 🛡️ Department Supervisor / 👤 Associate.
- PIN keypad for Supervisor (or any profile with `pin_code`); incorrect PIN shakes + stays on current user.
- Discrepancies-only filter gated behind supervisor session or PIN unlock.
- Settings: **Change Supervisor PIN** (verify current → set new).
- Add Team Member: name, role, optional/required PIN.

---

## 2026-07-25 — PWA, specialists, variance & remnant aging

### Shipped
- PWA manifest (`Carpet Hub — Flooring Dept`, standalone, theme `#022c22`) + iOS web-app meta/icons.
- Active specialist badge + Select Specialist modal (`store_specialists`); stamps `audited_by` / `logged_by`.
- System On-Hand CLF → variance (Physical − System) with match / shortage / overage badges (±2 CLF tolerance).
- Remnant aging badges (0–29 / 30+ / 60+) + Logged by display.
- Supervisor audit filters: specialist, location, discrepancies only.

### Ownership
| Concern | Owner |
|---|---|
| PWA manifest | `app/manifest.ts`, `app/layout.tsx` |
| Specialists | `lib/specialists.ts`, `SpecialistModal` |
| Variance math | `lib/variance.ts` |
| Remnant aging | `lib/aging.ts` |

---

## 2026-07-25 — Handheld barcode + Marry Barcode workflow

### Shipped
- `carpet_catalog.upc_barcode` (nullable, indexed) + local/offline support.
- Scanner-friendly inputs: strip leading zeros, Enter commit, rapid-key heuristic.
- Smart resolve: SKU/UPC match → chime + flash + auto-fill; unlinked vendor barcode → Marry modal.
- Marry modal: link existing catalog row or create new Item # with UPC attached.
- Catalog cards show **Barcode Linked** badge; link / unlink / edit UPC.

### Ownership
| Concern | Owner |
|---|---|
| Scan sanitize / resolve | `lib/barcode.ts` |
| Success chime | `lib/scan-feedback.ts` |
| Marry UI | `components/barcode/MarryBarcodeModal.tsx` |
| Catalog persistence | `lib/catalog.ts` |

---

## 2026-07-25 — Carpet Management Hub overhaul

### Shipped
- Multi-section **Carpet Hub** with sticky header + translucent slide-over drawer (Audit / Catalog / Remnants / Settings).
- Fixed sticky leading-zero typing via string-based `NumberField` + sanitizers + focus-select.
- Cycle Audit: catalog SKU auto-fill, **+ Save to Catalog**, shift log capped at 5 with Show All.
- Catalog Manager: search, add/edit/remove wall SKUs (vendor + roll width).
- Remnant Rack: status filters, W×L → sq ft / sq yd, reserve/sold/edit/delete.
- Settings: Supabase config/ping + localStorage cache counts.
- Schema expanded: `carpet_catalog`, `carpet_remnants`.

### Ownership
| Concern | Owner |
|---|---|
| Hub navigation | `app/page.tsx`, `components/hub/HubChrome.tsx` |
| Number UX | `lib/number-input.ts`, `components/ui/NumberField.tsx` |
| Catalog | `lib/catalog.ts` |
| Remnants | `lib/remnants.ts` |
| Audits | `lib/storage.ts` |

---

## 2026-07-25 — Visual / mobile layout polish

### Changes
- Outer shell: `max-w-md mx-auto w-full px-4 py-6` phone-app column on desktop.
- Rounds stepper: `flex w-full gap-2.5` with `shrink-0` ± buttons and `min-w-0 flex-1` input (no overflow past card).
- Measurement header: inline flex with emerald `8.50"` badge (no stacked overlap).
- Fraction pad `grid-cols-4` / chips `grid-cols-3`, `min-h-[44px]`; inputs `text-base`/`text-lg` for iOS zoom.
- Palette: slate-950 body, slate-900/90 cards, emerald accents for CLF / active location / CTA; formula card gradient + glow border.

---

## 2026-07-25 — Cycle count form defaults & schema alignment

### Changes
- All measurement inputs default to **0** (whole inches, fraction `0"`, rounds).
- Added **Carpet Name / Style** under SKU; SKU field shows barcode indicator.
- Rounds quick chips: **+5 / +10 / +20**; stepper allows 0 until submit.
- Submit button **Log Roll & Reset** clears form to defaults after save.
- Live formula card: `8.50" × 23 rounds × 0.2625 = 51.32 CLF`.
- Summary bar: Floor vs Top Stock roll counts + cumulative CLF; Copy Shift Summary + Export CSV.
- Measurement accordion includes SVG diagram.
- Supabase columns aligned: `sku`, `carpet_name`, `location_type`, `measurement_inches`, `measurement_fraction`, `rounds`, `calculated_clf`.
- Added `npm run typecheck`.

### Ownership (unchanged)
| Concern | Owner |
|---|---|
| CLF math | `lib/calc.ts` |
| Persistence | `lib/storage.ts` |
| Presentation | `app/page.tsx` |
| Schema | `supabase/schema.sql` |

---

## 2026-07-25 — Initial standalone auditor

### What shipped
- Next.js App Router + Tailwind CSS v4 mobile-first carpet roll auditor.
- Core formula: `CLF = measurement_inches × rounds × 0.2625`.
- Fraction quick-pad (0" through 7/8") with live decimal + CLF banner.
- Location segmented control: Sales Floor / Top Stock.
- Supabase `carpet_audits` persistence via `@supabase/supabase-js`.
- Offline fallback: failed or unconfigured network writes land in `localStorage` (`carpet_audits_offline`).
- Session summary panel with copy-to-clipboard.
- Audit feed (reverse chronological) with per-row delete.
- Collapsible measurement visual aid.

### Ownership
| Concern | Owner |
|---|---|
| CLF math | `lib/calc.ts` |
| Persistence (remote + offline) | `lib/storage.ts` |
| Supabase client | `lib/supabase.ts` |
| Domain types | `lib/types.ts` |
| Presentation / entry UX | `app/page.tsx` |
| Schema | `supabase/schema.sql` |

### Notes
- Touch targets intentionally ≥ 48px for ladder/floor one-handed use.
- Dark slate theme chosen for warehouse glare / night-shift readability.
- Anon RLS policies in schema are permissive for a floor tool; tighten before multi-store production.
