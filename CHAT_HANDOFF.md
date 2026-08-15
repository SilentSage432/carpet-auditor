# DeptSync Hub — Chat Handoff

## Product
DeptSync Hub — department-scoped inventory & SIMS audit platform for Lowe's store teams. Multi-category flooring + appliances, barcode scan-to-catalog, dual roll/carton audit engine, SIMS location finder, PWA offline shell + sync queue, multi-store isolation, department-scoped RBAC, specialist PIN / password, CLF/sqft variance, remnant aging, manager markdown, and **Store Operations** (aisle/bay map + automated weekly maintenance rotations).

## Branding
- App: **DeptSync Hub** · PWA short_name **DeptSync**
- Manifest name: `DeptSync — Department & SIMS Audit Hub`
- Layout title: `DeptSync Hub · Department & SIMS Audit` · appleWebApp title `DeptSync`
- Header: brand `DeptSync` · store # · section title · **department dropdown pill** · account/PIN
- **Typography:** Geist (`--font-geist-sans` → `font-sans`) + Geist Mono (`--font-geist-mono` → `font-mono`). Bay tags (`formatBayTag`, e.g. `A14-B06`), SKUs, cadence badges, and timestamps use `font-mono tracking-tight`.
- Header badge: `DeptSyncBadge` (floating layers + barcode; boot/PWA uses `branded` cyan/gold so theme FOUC cannot flash emerald)
- Icons: `public/icons/icon-192.png`, `icon-512.png`, `apple-touch-icon.png`, `mark.svg` (cyan/gold floating mark, no enclosed shield)
- PWA manifest: `app/manifest.ts` → `/manifest.webmanifest`; static `public/manifest.json` → `/manifest.json` (TWA / Bubblewrap)
- **Native shell:** haptics via `utils/haptics.ts` + `HapticsListener`; offline toast `OfflineNetworkBanner` + `ConflictResolutionModal`; sync auto-flush on online/visibility/focus; PWA/TWA splash theme `#090d16`; `app/loading.tsx` + `DeptSyncSplash` (pinned midnight + branded mark)
- **Theme engine:** `lib/theme.ts` owns presets + prefs (`deptsync_theme_prefs`). `data-theme` on `<html>`: `midnight` (default, ice-blue) · `emerald` · `amber` · `obsidian` · `cobalt`. Toggles: `data-contrast=high`, `data-density=compact`. Settings **Appearance** card applies instantly. CSS tokens in `app/globals.css`; glass utilities / nav / primary buttons bind to `--accent`, `--background`, `--border`, `--glow-accent`.
- **Obsidian-glass UI:** utilities in `app/globals.css` (`.glass-card`, `.glass-panel`, `.theme-accent-surface`, `.theme-nav-active`, `.theme-modal`, `.btn-primary-glow`, `.btn-quick-touch`, `.chip-filter`, `.hub-main`). Canonical Lucide SVG set (`HubIcon` / `NavIcon`, stroke 2, `currentColor`).
- **Handheld chrome:** sticky header `pt-safe` + compact `min-h-12`; **exactly four** workflow tabs `min-h-16` (Floor · Map · Roster · Settings). No hamburger, More sheet, or Admin Tools drawer. Store Ops pages use `.hub-main` so bays / badges / timers clear the fold.
- **Keep-alive tabs:** Floor / Map / Roster / Settings mount in `WorkflowTabShell` (`app/(workflow)/layout.tsx`) so switches are `hidden` only (0ms). Departments / map / roster use 45s stale-while-revalidate. Realtime channels are refcounted per logical name.
- **IRP velocity heatmap:** Map toggle `[ Standard Map | Velocity Heatmap ]`. Standard = rotation readiness (`map-readiness.ts`). Heatmap = `last_serviced_at` cadence + `velocity_tier` pulse (`lib/store-ops/velocity.ts`). Tap bay → 2-second walk log (`bay_service_logs` via `POST /api/store-locations/service`). Sunday generate prioritizes high/critical + `priority_override` (`lib/store-ops/rotation.ts` composed into `rotations.ts`). Apply `20260814_bay_velocity_heatmap.sql`.
- **Multi-department access:** `accessible_departments` on roster + profiles. Header switcher when more than one granted dept. Supervisors grant extras from the **Roster** tab chips. Apply `20260814_multi_department_access.sql`.

## AI (`lib/ai/gemini.ts`)
- Server-only Gemini Flash client (`@google/generative-ai` + `server-only`)
- Env: `GEMINI_API_KEY`, `GEMINI_MODEL` (default `gemini-3.5-flash`) — never `NEXT_PUBLIC_`
- Exports: `callGeminiFlash(prompt, options?)`, `callGeminiFlashJson`, `jsonGenerationConfig`, `GEMINI_TOKEN_BUDGET`, `extractGeminiJsonText` / `parseGeminiJson`, `isGeminiConfigured`
- Callers pass `responseSchema` (owned by domain modules) + per-route `maxOutputTokens`: briefing 256 · Snap Bay 512 · Floor Pad / insights 2048 · Pre-Flight parse 2048
- JSON mime is always on; regex fence extraction remains a safety net
- Does not recommend or own institutional knowledge — callers compose prompts and schemas
- **AI Pre-Flight (Bulk Generator):** `POST /api/store-locations/ai-parse` + `lib/store-ops/ai-parse.ts` normalize to `{ locations, corrections_made }`; input capped at 24k chars; UI tab confirms via existing bulk upsert
- **Flooring AI Insights:** `POST /api/flooring/ai-insights` (Store Ops JWT) — server-fetches remnants/audits, runs aging/variance locally, sends a compact findings packet to Gemini (compact-then-narrate). `FlooringAIInsightBanner` does not POST tables.
- **Zebra Shift Briefing:** On-load uses `buildLocalShiftBriefing` from `GET /api/store-health` only (no Gemini). Manual refresh may POST `/api/store-health/ai-summary`; 429/quota/RPC errors fall back silently to the local brief. Raw GoogleGenerativeAI JSON is never shown.
- **Audit Velocity Chart:** `lib/store-ops/telemetry.ts` + `StoreHealthChart` on `/dashboard` (06:00–22:00 curve vs linear target; Overall / D23 / D35 pills)
- **Appliance Anomaly Detection:** `POST /api/appliances/ai-anomaly` (Store Ops JWT) — server-fetches scans/catalog, local heuristics first, Gemini narrates the packet
- **Catalog Taxonomies:** `lib/catalog/taxonomies.ts` + `POST /api/catalog/ai-taxonomy` (supervisor/admin JWT) + Settings `TaxonomyManagerModal`; known-folder packet + registry merge
- **AI Visual Bay Scan:** `POST /api/store-ops/ai-bay-scan` + `lib/store-ops/ai-bay-scan.ts` + `VisualBayScannerModal` — 720p JPEG q=0.70 / 960px; route cap ~1.5MB; `responseSchema` + 512 output tokens
- **Executive Floor Pad:** Server Action `extractTasksAndTag` is canonical Copilot (`lib/store-ops/ai-note-extract.ts`, 8k plain text, 2048 tokens). `POST /api/store-ops/ai-note-summary` returns **410 Gone** (unbounded 8MB canvas synthesis retired).

## RBAC (`lib/rbac.ts` + `lib/specialists.ts`)
| Role | Scope | Tabs |
|------|-------|------|
| 👑 Master Admin | `assigned_department: all` | Flooring · Appliances · Remnants · Master |
| 🛡️ Department Supervisor | primary `assigned_department` + `accessible_departments[]` | Dept audit / profile; header switcher when 2+ depts |
| 👤 Floor Associate | primary + granted extras | Floor · Map · Roster · Settings; switcher when 2+ depts |

### Master Admin roster console
- Canonical team UI is the **Roster** tab (`/roster`, `RosterTab`) — name, role (Supervisor / Specialist / CSA), home department, and `accessible_departments` chips with optimistic save + Sonner toast
- `/admin/supervisors` and `/admin/roles` redirect to `/roster`
- Invite/reset lives on `/invite` + Roster add-member; dead `AdminRosterManager` was removed
- Lightweight **Associate Roster** (`AssociateRosterPanel`) remains on the Sunday assignment drawer
- Floor titles: specialty (Flooring / Appliances / Millwork / Cabinets) → **Specialist**; core (Paint / Plumbing / Garden / Building Materials / Tools / Electrical) → **CSA**
- Sunday Shift Balancer allocates weekly bay quotas to on-duty Specialists/CSAs by 4h / 6h / 8h (`planProportionalBayAssignments`)

### Settings tools (Master Admin / Supervisor)
- Former Admin Tools live in **Settings** (`SettingsSection`) as accordions and modals — not a second menu
- Master: store number, Bulk Generator (`#bulk-generate`), Taxonomies (`#taxonomies`), Force Rotation (`#weekly-rotation`)
- Supervisor + Master: weekly targets matrix, Executive Floor Pad (`#manager-notes`)
- Remnant inventory (`#remnants`) when RBAC allows; Device & sync for every role
- Department Supervisors never see Master-only setup controls
- Master Admin header: **My Department Context** pin (Full Store / D23 Flooring / D35 Appliances / …) — filters Floor without dropping Master privileges

### Sunday Flooring Cycle Audit
- Staging card + assignment modal: open weekly Flooring bays → assign from on-duty roster; Auto-Assign All to Me; Stage/Draw 12; **Shift balancer** (hours / start–end → proportional clustered zones)
- Tap opens the drawer **in-place** (`requestSundayAuditDrawer`). `/flooring`, `/sunday-audit`, and `/sunday-rotation` redirect to `/dashboard` with the drawer — they do not 404
- Assignments persist in `sunday_bay_assignments` (JWT store/dept RLS); `bay_id` = `weekly_rotations.id`; ISO week → `week_starting` Monday
- Plan math: `lib/store-ops/weekly-rotations.ts` (does not generate rotations or persist)
- Entry points: Floor tab, Cycle Audit scan, `/flooring` deep link, `#sunday-audit`
- ZebraChecklist live-handoff: `SUNDAY_AUDIT_EVENT` + Realtime via `lib/store-ops/realtime.ts` (bind `postgres_changes` before `subscribe()`, unique channel names, unsubscribe on unmount)

### Departments
`flooring` (D23) · `appliances` (D35) · `plumbing` · `electrical` · `lawn_garden` · `paint` (D24P) · `millwork` (D30) · `cabinets` (D29) · `building_materials` · `hardware` · `tools` (D25) · `all`

- Department glyphs: Lucide `DepartmentIcon` (no emoji). Roster / Admin pin / Store Map overview / department pickers.
- Store Map Department Overview includes Cabinets (D29) with weekly target 6, cron toggle, and tag metrics.
- Department seed upserts with `ignoreDuplicates` against live UNIQUE: `(store_id, code)` when present, else `code` (`departments_code_key`). Duplicate D29 is logged, not a 500. List falls back to unscoped `SELECT *` so Store Map hydrates existing rows instead of a red banner.

- Seeds: none auto-injected. Create Master / Supervisor profiles via invite / Add Supervisor; temporary PIN sets `must_change_credentials: true` until first-login change
- First-login: non-dismissible AuthWall setup when `must_change_credentials` (no Remind Later)

## Authentication (Zero-Access Wall)
- Unauthenticated visitors never see workspace tabs/data — `AuthWall` only
- Login / unlock: username + password/PIN → roster match (`findSpecialistByLogin`); Hub-bridge verifies PIN (roster **list** no longer selects `pin_code` / `temp_pin_hash`)
- **Hub PIN → Auth bridge (primary Store Ops unlock):** after PIN verify, client calls `POST /api/auth/hub-bridge` (`lib/store-ops/hub-bridge.ts` + `hub-bridge-client.ts`) which service-role verifies the roster PIN (by `specialist_id` / username / name), ensures `auth.users` + `profiles` link, and mints a real Supabase Auth session (`setSession`). **Master PIN** (`1234` or `HUB_MASTER_PIN`) auto-provisions Super Admin when missing so Master Admin never lock out.
- **Bootstrap recovery:** `POST /api/auth/bootstrap-admin` (Bearer `CRON_SECRET`) or `node --env-file=.env.local scripts/bootstrap-admin.mjs` — resets `master_admin` roster + Auth + profiles
- **PIN reset:** `POST /api/auth/reset-pin` — Super Admin Bearer or `current_pin`; service-role updates `store_specialists` and upserts `store_profiles` (creates Master Admin profile when missing). Change PIN modal uses this path.
- **Store Ops identity:** `resolveStoreOpsActor` loads `profiles` where `id = auth.users.id` from Bearer/cookie JWT (no `x-store-ops-*` trust headers; emergency unlock removed). API data paths use service role **after** actor resolve.
- **Returning session:** hub `deptsync_auth_session` alone is not enough — cold restore without a live Supabase Auth JWT forces the PIN unlock wall so bridge can mint Auth.
- **Phone recovery (optional):** "Forgot Access Code? Reset via Phone" → OTP → `/api/auth/phone-reset/confirm` + `linkAuthUserToSpecialistProfile`
- Setup requires verified mobile (`phone_number` on `store_specialists`)
- Native keychain: form `autocomplete` username / current-password
- Biometric: WebAuthn; requires an existing Store Ops Auth session (otherwise PIN once after fingerprint)
- `must_change_credentials` → non-dismissible permanent credential setup
- Session: `deptsync_auth_session` (hub UI) + Supabase Auth localStorage (API Bearer); 8h idle lock on hub session
- **P0 boot:** `/` fetches roster only before AuthWall; catalog/remnants/appliance catalog after unlock per section; specialty scans + Snap Bay / SIMS / Audit Report / Settings tools are `next/dynamic`
- **P0 indexes:** re-run `supabase/migrations/20260813_p0_query_indexes.sql` — hub tables use `store_number`; Store Ops locations/rotations use `store_id`; manager_notes Phase 2 uses `store_number`+`department` (legacy `store_id`+`department_code`). Script skips absent columns.
- **P1 Gemini/map:** Snap Bay 720p + compressed JPEG; Floor Pad Copilot strips HTML / 8k cap; `GET /api/store-locations` explicit Store Map columns (no `SELECT *`); Slice 1 `responseSchema` + per-route token budgets
- **P2 hub UI:** `startTransition` + keep-alive Floor/Map/Roster/Settings (`hidden`); Cycle/Appliance scan forms isolated from logs; 300ms debounced draft saves with flush on submit/leave; weekly rotations + Sunday assignments TTL-cached 45s
- **Settings tools:** Bulk / Taxonomies / Force Rotation / Floor Pad are `next/dynamic` inside `SettingsSection`; SW cache `deptsync-shell-v5-brand-floor`
- **Bulk bays:** Odd Only / Even Only (`lib/store-ops/bay-pattern.ts`, default odd); Store Map GET falls back if `last_completed_at` is missing/null
- Seeds: no hardcoded roster injection — use Invite / Add Supervisor; temp PIN sets `must_change_credentials`
- Primary: fixed bottom workflow tabs — **Floor · Map · Roster · Settings** only
- Header: DeptSync brand + store # · section title · department dropdown pill · account/PIN chip
- Cycle Audit / Appliances: hardware-scan ready without soft keyboard; sticky Log docked above bottom nav

## Store Ops auth transport
- Client: `storeOpsAuthHeadersAsync` → `Authorization: Bearer` from Hub-bridge or phone Auth session
- Server: `getRequestAuthUser` (Bearer or cookie) → `resolveStoreOpsActor` → `profiles` → service-role DB client
- Soft-fail reads (`auth_required` + hint) only when JWT missing; after Hub PIN unlock banners should clear
- Push subscribe: `user_id` = Auth profile id; `specialist_id` null
- SQL: `supabase/migrations/20260812_jwt_rls_policies.sql` — Custom Access Token Hook + store/department RLS on locations, rotations, exceptions, manager_notes, etc.
## Scan-to-Catalog
- SKU / UPC resolve via `lib/barcode.ts` → `carpet_catalog`
- Roll logging: `RollMeasurementPad` (live CLF/SQYD header + inch/fraction/rounds keypad) composed by `CycleAuditScanForm`
- Soft keyboard: **tap-to-type only** (no auto-focus on tab switch)
- Hardware wedges: `useGlobalBarcodeScanner` (window keydown, 6+ chars ≤150ms) → **active visible** section lookup (`scannerEnabled=false` while hub pane is hidden)
- Mid-scan drafts: `lib/debounced-persist.ts` (300ms) + `useFlushOnLeave`; flooring `lib/storage.ts`, appliances `lib/appliance-scans.ts`
- Focused SKU fields still support Enter **or** rapid burst via NumberField
- Quick-Add modal for unlinked barcodes
- Catalog folders (`lib/catalog-folders.ts`); domain-filtered for department supervisors
- Department taxonomies (`lib/catalog/taxonomies.ts`) for generic dept folder drill-down; AI seed via Settings

## Dual audit engine
- Mode A (Carpet / Sheet Vinyl): CLF; Mode B: cartons × sqft/box
- Appliances: unit count + SIMS staging; Model # on catalog `vendor`

## Offline & PWA
- Service worker `public/sw.js`; sync queue `carpet_hub_sync_queue` (`lib/sync-queue.ts`)
- Queue actions carry `transaction_id`, `optimistic_at`, retry backoff (`next_retry_at`), optional `base_updated_at`
- `installSyncAutoFlush` — flush on `online`, `visibilitychange` (visible), and `focus`
- Version/409 conflicts → `ConflictResolutionModal` (Keep Local force-overwrite vs Accept Server)
- Header: Online / Offline Mode + pending count (`HeaderNetworkStatus` owns the live queue hook so hub forms do not re-render)

## Multi-store
- `lib/store.ts` (default `1234`); **store switch = Master Admin only** (Settings)
- Store Operations: `stores` table UUID `store_id`; hub session `store_number` maps via `lib/store-ops/stores.ts`
- Departments / locations / weekly rotations scoped by `store_id`; cron runs per active store

## Store Operations upsert keys
- `stores`: `onConflict: store_number` (payload: store_number, name, is_active)
- `departments`: `onConflict: code` (matches live UNIQUE on `code`)
- `store_locations`: `onConflict: department_id,aisle,bay,type` (BOTH writes Selling + Topstock per bay; status PENDING). **`aisle` is alphanumeric TEXT** (`BW`, `RW`, `12`, `A1`) — apply `20260811_alphanumeric_aisle.sql`. Bulk Generator + batch CSV (`lib/store-ops/aisle.ts`) normalize with `.trim().toUpperCase()`; no numeric-only aisle validation.
- `weekly_rotations`: `onConflict: location_id,assigned_week`

## Remnants / markdown
- Aging badges; 60+ or elevated role → Apply Manager Markdown
- Floor-ops rack bands (Fresh <14d / Watch 14–30d / Critical >30d) via `lib/aging.ts` `classifyRackAging` + `lib/remnants.ts` `remnantRackAlert`; critical rolls show a Suggest markdown chip (markdown math stays in `lib/markdown.ts`)

## Audit Report Export
- Shift summary → **📊 Export / Print Report** (Flooring, Appliances, Department)
- `AuditReportModal` + `lib/audit-report.ts`: formal SIMS/cycle summary, print-to-PDF, mailto / `navigator.share`, Markdown clipboard paste
- Print stylesheet strips hub chrome for letter B&W output

## Store Operations (multi-dept maintenance)
- Schema migration: `supabase/migrations/20260809_store_operations_rbac.sql`
  - `departments`, `profiles` (auth.users + `super_admin` / `department_supervisor`), `store_locations` (SELLING/TOPSTOCK + cycle status), `weekly_rotations`
  - RLS: super_admin all; supervisors read/update own `assigned_department_id`
- Hub bridge: Master Admin → super_admin; Supervisor → department_supervisor (via `departments.code` = hub `assigned_department`)
- **Navigation Hub** (`lib/nav-hub.ts` + `HubHeader.tsx` + `BottomNav.tsx` + `NavigationHub.tsx`): header is title/store # · department pill · account/PIN; primary tabs **Floor · Map · Roster · Settings** for every role (no More overflow)
  - Floor (`/dashboard`) · Map (`/admin/store-map`) · Roster (`/roster`) · Settings (`/settings`)
  - Authenticated `/` without specialty `?section=` replaces to `/dashboard`. Hub `/?section=audit|appliances|department` is scan tools only. Remnants deep-link to `/settings#remnants`
- `/manager-notes` redirects to `/settings#manager-notes` (Floor Pad modal in Settings)
- `/dashboard` — one Floor layout for all roles: Sunday staging (non-associates), scan chips, health/rollup, showroom, **Verify completed bays**, `ZebraChecklist` (Rotation / Downstock + Barrier chips), `ExceptionFeed`
- `/stock` redirects to `/dashboard` (Downstock is a Zebra tab on Floor)
- `/roster` — unified team list, PIN add, and department access chips (optimistic + toast)
- `/admin/store-map` — department overview + location grid with **Standard Map | Velocity Heatmap** toggle; tap bay → **one** `WalkTheFloorSheet` (walk log + Snap Bay + Master Admin edit/pin); **+ Add Bay to Aisle**; Bulk generate lives in Settings `#bulk-generate`. Supervisors/associates may view their department map and still log walks.
- Sunday staging card opens the assignment modal with **Shift balancer** (hours → proportional clustered zones). Plan owner: `lib/store-ops/weekly-rotations.ts`; persist: `sunday-audit.ts`.
- `GET /api/store-health` — weekly pace + bottleneck aggregation + compact `bay_health` for DS / Super Admin
- `POST /api/store-ops/ai-bay-scan` — multimodal bay photo → carton/pallet estimates, cleanliness score, detected issues (Store Ops actor)
- `POST /api/store-ops/ai-note-summary` — **410 Gone**; Floor Pad Copilot `extractTasksAndTag` is canonical
- APIs under `/api/rotations/*`, `/api/store-locations*`, `/api/departments`, `/api/weekly-rotations`
- Multi-store: apply `20260809_multi_store.sql`; store scope comes from JWT `app_metadata.store_number` / `profiles.store_number`
- Manager notes: apply `20260811_manager_notes.sql` + `20260812_manager_notes.sql` + `20260812_manager_notes_archive.sql` + `20260812_fix_manager_notes_rls.sql` + **`20260812_manager_notes_metadata.sql`** (`metadata` JSONB from Gemini Copilot)
- Sunday bay assignments: apply `20260812_sunday_bay_assignments.sql`
- Downstock queue: apply `20260814_downstock_queue.sql` (localStorage fallback until applied)
- IRP velocity heatmap: apply `20260814_bay_velocity_heatmap.sql` (`store_locations.last_serviced_at` / `velocity_tier` / `priority_override` + `bay_service_logs`)
- JWT claims / RLS helpers: apply `20260812_jwt_rls_policies.sql` + enable Custom Access Token Hook
- Requires `SUPABASE_SERVICE_ROLE_KEY` for server routes (apply migration in Supabase SQL editor)

## Web Push (rotation phone alerts)
- Migration: `supabase/migrations/20260809_push_notifications.sql`
- Supervisors enable via Settings → Phone rotation alerts (`usePushNotifications`)
- Env: `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, optional `VAPID_SUBJECT`
- Generate keys: `npx web-push generate-vapid-keys`
- `POST /api/rotations/generate` dispatches push to matching `department_code` / profile subscribers
- SW shows notification and opens `/dashboard` on click

## Weekly rotation cron
- Migration: `supabase/migrations/20260809_weekly_rotation_cron.sql` (`weekly_bay_target`, Lowe's codes)
- `vercel.json`: Sunday `59 23 * * 0` → `/api/cron/weekly-rotation`
- Env on Vercel: `CRON_SECRET` (Bearer token Vercel sends automatically)
- Settings → Weekly bay target matrix (Supervisor + Master; blur autosave + Save All)

## End-of-week verification
- Migration: `supabase/migrations/20260809_rotation_verification.sql`
- Floor tab **Verify completed bays** signs off completed work without completing remaining open bays (`verifyAllCompletedBays`)
- `/verify-rotation` and `/admin/exceptions` redirect to `/dashboard`; the Floor `ExceptionFeed` is the live barrier list
- Mid-week floor barriers: `POST /api/rotations/exceptions` (does **not** stamp `last_verified_week`) — Zebra row **Barrier** → tap reason
- APIs: `POST /api/rotations/verify`, `GET|POST /api/rotations/exceptions`

## Selling vs Topstock audit mode
- Canonical Store Ops type `SELLING` | `TOPSTOCK` (`lib/store-ops/audit-location-mode.ts`); hub audits still persist `sales_floor` / `top_stock`
- Cycle Audit / Department Audit / Zebra filter share `AuditLocationModeToggle` — SELLING = lower floor, TOPSTOCK = overheads/racking
- Discrepancy flags, log rows, and audit reports include the mode; Cycle/Department forms keep the mode across logs (not reset)

## Store number (dynamic)
- Owner: `lib/store.ts` — localStorage `carpet_hub_store_number`; **no hardcoded `1234`/`1852`**
- Blank allowed; Master edits via **Settings → Store number** (session stays active)
- Session / active specialist / biometric only reject when both sides have different store numbers
- Login adopts `store_profiles` / specialist `store_number` when device store is unset
- Store-ops APIs require a live Supabase Auth session linked to `profiles` (Hub PIN bridge or phone OTP → `linkAuthUserToSpecialistProfile`); store scope from JWT claims, not client headers

## Mobile floor UX (Waves A–C)
- Floor job first: Dashboard = pace + checklist; no Super Admin quick-action strip, hamburger, or Admin Tools drawer
- Master setup tools live in Settings accordions/modals
- Dense bay/rotation rows; completed lists collapsed by default
- Remnant forms live in Settings; `/department` redirects to Floor

## Supervisor Invite & Onboarding
- Apply migration: `supabase/migrations/20260810_supervisor_invite.sql`
- Master Admin: Roster → **Invite** → optional phone → temp PIN + `/invite?token=` link (Twilio if env set, else copyable SMS)
- Env (optional): `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, `NEXT_PUBLIC_APP_URL`
- Onboarding steps: temp PIN → Create New PIN → Add to Home Screen → WebAuthn biometric → `/dashboard`
- APIs: `POST /api/admin/invite-supervisor`, `GET|POST /api/invite/[token]`
- **Test Invite Flow** (roster): dry-run `test_mode` → modal with PIN + welcome SMS + Copy Invite Link / Copy Full SMS Text; `/invite?test=1` preserves token after PIN reset

## Associate floor role
- Store Ops actor `associate`: read/complete dept rotations + locations; create exceptions via verify; **no** targets, invite, generate/reset, or Master Settings tools
- Nav: Floor · Map · Roster · Settings only (Downstock on Floor; specialty scans via Floor chips → `/?section=`)

## Department toggles · adaptive priority · showroom
- Apply `supabase/migrations/20260810_dept_priority_showroom.sql`
- Master toggles: Store Map Overview + Settings Department Overview (`departments.is_active`; Flooring default on)
- Adaptive draw: `manual_priority_count` + `last_completed_at` age + velocity/priority_override boost; after CARRIED_OVER, `pickSundayVelocityPrioritized` fills remaining slots from high/critical/override first; Store Map ★ Week assigns + bumps priority
- Showroom: `location_type=SHOWROOM_STACKOUT` + `audit_frequency_days`; dashboard Quick Touch card (not in weekly aisle draw)
- Store Map bay rows: compact dual-pill Selling/Topstock; tap bay → `WalkTheFloorSheet` (walk + Snap Bay + edit/pin). Row kebab still opens the same sheet. Duplicate prune hard-deletes. Bulk Generator Clean-Up lives in Settings.

## Appliance categories (suite + sub)
- **Tables:** `appliance_catalog` + `appliance_scans` (not carpet_*). Apply `supabase/migrations/20260810_appliance_catalog_scans.sql` then `enable_rls_flagged_tables.sql` (RLS on appliances + `store_specialists` + verify all public tables)
- Top-level: Laundry · Refrigeration · Cooking / Ranges · Dishwashers · Microwaves / Venting
- Sub required on Quick-Add UPC link / floor scan / catalog (Laundry → Washer | Dryer | Combo / Unit)
- Types: `ApplianceCatalogItem`, `ApplianceScan` (`sub_category?`)
- APIs: `/api/appliances/catalog`, `/api/appliances/scans` (`?format=csv`)
- CSV export: **SUMMARY** (Item Number, Description, Category, Total Count Scanned, Locations Found) + **RAW DETAIL** (Category, Sub-Category, Item #, Serial #, Location, Scanned By, Scanned At, Store #)
- Online scans POST `/api/appliances/scans` (service role); failures surface as `Failed to save scan: …` (no silent offline success)
- **Continuous mode:** detect → POST immediately; no Submit button. Known SKU auto-logs; new/unlinked pauses on Quick-Add (sub_category) then logs + clears. Sticky **Session Total** counter at scanner top.
- **Scan log UX:** category accordion (collapsed default) → sub-category sections → SKU Qty cards; search auto-expands matches; 10 SKUs/page; sticky-free filter pills + search; Edit modal; `PATCH /api/appliances/scans`
