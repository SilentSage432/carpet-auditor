# DeptSync Hub — Chat Handoff

## Product
DeptSync Hub — department-scoped inventory & SIMS audit platform for Lowe's store teams. Multi-category flooring + appliances, barcode scan-to-catalog, dual roll/carton audit engine, SIMS location finder, PWA offline shell + sync queue, multi-store isolation, department-scoped RBAC, specialist PIN / password, CLF/sqft variance, remnant aging, manager markdown, and **Store Operations** (aisle/bay map + automated weekly maintenance rotations).

## Branding
- App: **DeptSync Hub** · PWA short_name **DeptSync**
- Manifest name: `DeptSync — Department & SIMS Audit Hub`
- Layout title: `DeptSync Hub · Department & SIMS Audit` · appleWebApp title `DeptSync`
- Header: brand `DeptSync` · store · section title · **department dropdown pill** · network/account
- Header badge: `DeptSyncBadge` (floating shield + barcode, ambient `--glow-accent` glow; no enclosing tile)
- Icons: `public/icons/icon-192.png`, `icon-512.png`, `apple-touch-icon.png`
- PWA manifest: `app/manifest.ts` → `/manifest.webmanifest`; static `public/manifest.json` → `/manifest.json` (TWA / Bubblewrap)
- **Theme engine:** `lib/theme.ts` owns presets + prefs (`deptsync_theme_prefs`). `data-theme` on `<html>`: `midnight` (default, ice-blue) · `emerald` · `amber` · `obsidian` · `cobalt`. Toggles: `data-contrast=high`, `data-density=compact`. Settings **Appearance** card applies instantly. CSS tokens in `app/globals.css`; glass utilities / nav / primary buttons bind to `--accent`, `--background`, `--border`, `--glow-accent`.
- **Obsidian-glass UI:** utilities in `app/globals.css` (`.glass-card`, `.glass-panel`, `.theme-accent-surface`, `.theme-nav-active`, `.theme-modal`, `.btn-primary-glow`, `.btn-quick-touch`, `.chip-filter`, `.hub-main`). Canonical Lucide SVG set (`HubIcon` / `NavIcon`, stroke 2, `currentColor`).
- **Handheld chrome:** sticky header `pt-safe` + compact `min-h-12`; workflow bottom tabs `min-h-16` in the thumb zone (Floor · Map · Stock · Settings); Store Ops pages use `.hub-main` so bays / badges / timers clear the fold.
- **Native shell:** haptics via `utils/haptics.ts` + `HapticsListener`; offline toast `OfflineNetworkBanner` + `ConflictResolutionModal`; sync auto-flush on online/visibility/focus; PWA/TWA splash theme `#090d16`; `app/loading.tsx` + `DeptSyncSplash` for boot

## AI (`lib/ai/gemini.ts`)
- Server-only Gemini Flash client (`@google/generative-ai`)
- Env: `GEMINI_API_KEY`, `GEMINI_MODEL` (default `gemini-3.5-flash`) — never `NEXT_PUBLIC_`
- Exports: `callGeminiFlash(prompt, inlineImage?)`, `callGeminiFlashJson`, `extractGeminiJsonText` / `parseGeminiJson`, `isGeminiConfigured`, `GEMINI_JSON_GENERATION_CONFIG`
- Generation config: `responseMimeType: application/json`, `maxOutputTokens: 1024` (keeps JSON parseable; bounds output)
- Inline images accept raw base64 or `data:image/...;base64,...` (prefix stripped)
- JSON regex extraction remains as a safety net for fenced/chatty replies
- Does not recommend or own institutional knowledge — callers compose prompts
- **AI Pre-Flight (Bulk Generator):** `POST /api/store-locations/ai-parse` + `lib/store-ops/ai-parse.ts` normalize to `{ locations, corrections_made }`; UI tab confirms via existing bulk upsert
- **Flooring AI Insights:** `POST /api/flooring/ai-insights` + `lib/flooring/ai-insights.ts` + `FlooringAIInsightBanner` on Cycle Audit / Remnants; applies markdown via `lib/markdown` + `saveRemnant`; age bands via `agingBand()` (30/60/90+)
- **Zebra Shift Briefing:** `POST /api/store-health/ai-summary` + `ShiftBriefingCard` on `/dashboard` (composes `lib/store-ops/health` snapshot + `bay_health` from `bay-health.ts` + active-shift `telemetry` → 3-bullet Focus Bay / Pending Barriers / Quick-win)
- **Audit Velocity Chart:** `lib/store-ops/telemetry.ts` + `StoreHealthChart` on `/dashboard` (06:00–22:00 curve vs linear target; Overall / D23 / D35 pills)
- **Appliance Anomaly Detection:** `POST /api/appliances/ai-anomaly` + `ApplianceAnomalyWidget` on Appliance Audit (duplicate serials, distant locations, category mismatch, missing high-value floor models)
- **Catalog Taxonomies:** `lib/catalog/taxonomies.ts` (D21–D28 / D35 / D52 defaults) + `POST /api/catalog/ai-taxonomy` + Admin Tools `TaxonomyManagerModal`; folder accordions on Department Audit + `/department`
- **AI Visual Bay Scan:** `POST /api/store-ops/ai-bay-scan` + `lib/store-ops/ai-bay-scan.ts` + `VisualBayScannerModal` — immersive full-screen camera (`object-cover`, rear-cam WebRTC cascade targeting **720p**); single-pass JPEG snapshot (q=0.70, max edge 960px); raw base64 payload; route cap ~1.5MB; Gemini JSON mime + 1024 output tokens
- **Manager Notes / Executive Floor Pad:** `POST /api/store-ops/ai-note-summary` (legacy synthesize) + Server Action `extractTasksAndTag` (`app/actions/manager-notes.ts`) + `lib/store-ops/ai-note-extract.ts` + `lib/store-ops/manager-notes.ts` (Supabase CRUD + realtime + archive) + `components/manager-notes/ExecutiveFloorPad` — dense TipTap pad (sticky title/toolbar, ≥80dvh canvas, 15 Google Fonts, **voice dictation → Gemini parse**, metadata incl. `follow_up_date`), Gemini Copilot on **plain text ≤ 8k chars** (HTML kept for editor/save), schema-only prompt, debounced autosave; Admin Tools + `/manager-notes`

## RBAC (`lib/rbac.ts` + `lib/specialists.ts`)
| Role | Scope | Tabs |
|------|-------|------|
| 👑 Master Admin | `assigned_department: all` | Flooring · Appliances · Remnants · Master |
| 🛡️ Department Supervisor | e.g. Amber → `appliances`, Dave → `plumbing` | Dept audit / profile (flooring also gets Remnants) |
| 👤 Floor Associate | inherits / assigned dept | Floor · Map · Stock · Settings (no Admin Tools) |

### Master Admin roster console
- Roster CRUD lives on `/admin/supervisors` and **Admin Tools** (not permanent Settings chrome)
- **Add** creates via `POST /api/admin/invite-supervisor` — crypto 6-digit temp PIN (never typed by admin); invite/SMS preview shows the returned PIN
- Reset / Invite re-issues the same invite path (random PIN + `/invite` link)
- Edit scope / **Deactivate** (soft-delete `is_active: false` + optional hard delete)
- Deactivated profiles stay out of active roster fetches; seed helpers respect tombstones so Amber is not revived

### Admin Tools (Super Admin only)
- Slide-over drawer defaults **closed** — header **Admin** chip, hamburger entry, or `openAdminTools()`
- Hosted after first open (`adminHosted`) so the lazy chunk does not remount; `ChunkErrorBoundary` + loading-shell retry if the chunk fails
- Floor Pad / TipTap is a nested dynamic import — opening Admin Tools does not evaluate TipTap
- Owns: Bulk Generate, **Sunday Rotation Engine** (Flooring cycle assign), Trigger Weekly Rotation, **Executive Floor Pad**, Catalog Taxonomies (AI generate / refresh), all-dept bay targets, store number, device diagnostics, links to Store Map / Supervisors / Exceptions
- Department Supervisors never see Admin Tools chrome
- Master Admin header: **My Department Context** pin (Full Store / D23 Flooring / D35 Appliances / …) — filters dashboard Flooring focus without dropping Master privileges

### Sunday Flooring Cycle Audit
- Staging card + assignment modal: open weekly Flooring bays → assign from Flooring roster; Auto-Assign All to Me; Stage/Draw 12; **Shift balancer** (hours / start–end → proportional clustered zones)
- Assignments persist in `sunday_bay_assignments` (JWT store/dept RLS); `bay_id` = `weekly_rotations.id`; ISO week → `week_starting` Monday
- Plan math: `lib/store-ops/weekly-rotations.ts` (does not generate rotations or persist)
- Entry points: `/dashboard`, Cycle Audit tab, Admin Tools, `/flooring` deep link
- ZebraChecklist live-handoff: `SUNDAY_AUDIT_EVENT` + Realtime; assigned specialist sees **Your Sunday bays first** without refresh; badges show name + shift hours; filter All / Mine / associate

### Departments
`flooring` · `appliances` · `plumbing` · `electrical` · `lawn_garden` · `paint` · `millwork` · `building_materials` · `hardware` · `all`

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
- **P0 boot:** `/` fetches roster only before AuthWall; catalog/remnants/appliance catalog after unlock per section; hub sections + Admin Tools + Snap Bay / SIMS / Audit Report are `next/dynamic`
- **P0 indexes:** re-run `supabase/migrations/20260813_p0_query_indexes.sql` — hub tables use `store_number`; Store Ops locations/rotations use `store_id`; manager_notes Phase 2 uses `store_number`+`department` (legacy `store_id`+`department_code`). Script skips absent columns.
- **P1 Gemini/map:** Snap Bay 720p + compressed JPEG; Floor Pad Copilot strips HTML / 8k cap; `GET /api/store-locations` explicit Store Map columns (no `SELECT *`)
- **P2 hub UI:** `startTransition` + keep-alive hub panes (`hidden`); Cycle/Appliance scan forms isolated from logs; 300ms debounced draft saves with flush on submit/leave; weekly rotations + Sunday assignments TTL-cached 45s
- **Admin Tools:** chrome `requestAdminTools` sets `adminOpen` + `adminHosted`; `dynamic(() => import(AdminToolsDrawer))` uses the **default** export (avoid `{ default: mod.Named }` — React #306); loading shell handles chunk errors; `ChunkErrorBoundary`; Floor Pad/TipTap nested `dynamic` via named `mod.ManagerNotesWorkspace`; SW cache `deptsync-shell-v4-admin-tools`
- **Bulk bays:** Odd Only / Even Only (`lib/store-ops/bay-pattern.ts`, default odd); Store Map GET falls back if `last_completed_at` is missing/null
- Seeds: no hardcoded roster injection — use Invite / Add Supervisor; temp PIN sets `must_change_credentials`
- Primary: fixed bottom workflow tabs — **Floor · Map · Stock · Settings** (role overflow in More)
- Header: DeptSync brand + store subtitle · section title · department dropdown pill · network; specialist chip + PIN gear
- Cycle Audit / Appliances: hardware-scan ready without soft keyboard; sticky Log docked above bottom nav

## Store Ops auth transport
- Client: `storeOpsAuthHeadersAsync` → `Authorization: Bearer` from Hub-bridge or phone Auth session
- Server: `getRequestAuthUser` (Bearer or cookie) → `resolveStoreOpsActor` → `profiles` → service-role DB client
- Soft-fail reads (`auth_required` + hint) only when JWT missing; after Hub PIN unlock banners should clear
- Push subscribe: `user_id` = Auth profile id; `specialist_id` null
- SQL: `supabase/migrations/20260812_jwt_rls_policies.sql` — Custom Access Token Hook + store/department RLS on locations, rotations, exceptions, manager_notes, etc.
## Scan-to-Catalog
- SKU / UPC resolve via `lib/barcode.ts` → `carpet_catalog`
- Soft keyboard: **tap-to-type only** (no auto-focus on tab switch)
- Hardware wedges: `useGlobalBarcodeScanner` (window keydown, 6+ chars ≤150ms) → **active visible** section lookup (`scannerEnabled=false` while hub pane is hidden)
- Mid-scan drafts: `lib/debounced-persist.ts` (300ms) + `useFlushOnLeave`; flooring `lib/storage.ts`, appliances `lib/appliance-scans.ts`
- Focused SKU fields still support Enter **or** rapid burst via NumberField
- Quick-Add modal for unlinked barcodes
- Catalog folders (`lib/catalog-folders.ts`); domain-filtered for department supervisors
- Department taxonomies (`lib/catalog/taxonomies.ts`) for generic dept folder drill-down; AI seed via Admin Tools

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
- **Navigation Hub** (`lib/nav-hub.ts` + `HubHeader.tsx` + `BottomNav.tsx` + `NavigationHub.tsx`): department dropdown pill in the header; primary workflow tabs Floor · Map · Stock · Settings (Lucide SVG; overflow in More)
  - All roles primary: Floor (`/dashboard`) · Map (`/admin/store-map`) · Stock (`/stock`) · Settings (`/settings`)
  - Super Admin More: Team · Alerts · Notes · Admin Tools
  - Supervisor More: Verify · Dept · Notes
  - Associate More: Barriers · Specialty Tools
  - Hub `/` is Floor specialty audits (in-page switcher); remnants/settings deep links redirect to `/stock` / `/settings`
- Quick Actions banner (Super Admin): Bulk Generate · Trigger Weekly Rotation · Manage Supervisors
- `/manager-notes` — Executive Floor Pad (TipTap rich notes + Gemini Copilot Extract Tasks & Tag + archive); also Admin Tools entry + `#manager-notes`
- `/dashboard` — Store Health Scorecard (top) + **ZebraChecklist** (optimistic complete, **Quick Touch**, **Flag for Downstock**, assignment badges + associate filter, weekly Ahead/On Track/Behind pace, next-bay pulse, SELLING/TOPSTOCK filter, Sunday assignment queue, one-tap barriers). Floor audit chips deep-link to hub Cycle / Appliances. Completions refresh silently (no loading flash). Supervisor **Weekly audit rollup** modal.
- `/stock` — unified **Downstock queue** (Zebra compact/locked) + **Remnant inventory** (when RBAC allows remnants)
- Sunday staging card opens the assignment modal with **Shift balancer** (hours → proportional clustered zones). Plan owner: `lib/store-ops/weekly-rotations.ts`; persist: `sunday-audit.ts`.
- `/admin/store-map` — department overview + location grid **readiness heatmap**; bay rows: name + status left, Selling/Topstock dual-pill, MoreVertical Edit/Delete; **duplicate bay prune** (hard-delete extras, Super Admin); Bulk Add accordion (Master); Trigger Weekly Rotation modal (**Force Draw New Rotation**); **📷 Snap Bay AI Audit** (Gemini visual scan) on page + bay actions sheet. Supervisors/associates may view their department heatmap (`canMutate` false).
- `GET /api/store-health` — weekly pace + bottleneck aggregation + compact `bay_health` for DS / Super Admin
- `POST /api/store-ops/ai-bay-scan` — multimodal bay photo → carton/pallet estimates, cleanliness score, detected issues (Store Ops actor)
- `POST /api/store-ops/ai-note-summary` — manager note + optional S Pen PNG → executive summary + action items (Store Ops actor)
- APIs under `/api/rotations/*`, `/api/store-locations*`, `/api/departments`, `/api/weekly-rotations`
- Multi-store: apply `20260809_multi_store.sql`; store scope comes from JWT `app_metadata.store_number` / `profiles.store_number`
- Manager notes: apply `20260811_manager_notes.sql` + `20260812_manager_notes.sql` + `20260812_manager_notes_archive.sql` + `20260812_fix_manager_notes_rls.sql` + **`20260812_manager_notes_metadata.sql`** (`metadata` JSONB from Gemini Copilot)
- Sunday bay assignments: apply `20260812_sunday_bay_assignments.sql`
- Downstock queue: apply `20260814_downstock_queue.sql` (localStorage fallback until applied)
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
- Settings → Weekly bay target for supervisors (Master: all-dept targets in Admin Tools)

## End-of-week verification
- Migration: `supabase/migrations/20260809_rotation_verification.sql`
- `/verify-rotation` — **Verify All Completed Bays** (sign off without completing remaining open) + Report Incomplete with one-tap chips (Blocked Bay / Unpalletized Top-Stock / Missing SIMS Tags)
- `/admin/exceptions` — Master Admin tabs: Pending / Verified / Barriers / All; batch **Verify All Completed Bays** for depts with 0 open; barrier rows show SELLING/TOPSTOCK
- Mid-week floor barriers: `POST /api/rotations/exceptions` (does **not** stamp `last_verified_week`) — Zebra row **Barrier** → tap reason
- APIs: `POST /api/rotations/verify`, `GET|POST /api/rotations/exceptions`

## Selling vs Topstock audit mode
- Canonical Store Ops type `SELLING` | `TOPSTOCK` (`lib/store-ops/audit-location-mode.ts`); hub audits still persist `sales_floor` / `top_stock`
- Cycle Audit / Department Audit / Zebra filter share `AuditLocationModeToggle` — SELLING = lower floor, TOPSTOCK = overheads/racking
- Discrepancy flags, log rows, and audit reports include the mode; Cycle/Department forms keep the mode across logs (not reset)

## Store number (dynamic)
- Owner: `lib/store.ts` — localStorage `carpet_hub_store_number`; **no hardcoded `1234`/`1852`**
- Blank allowed; Master edits via **Admin Tools → Store Number** (session stays active)
- Session / active specialist / biometric only reject when both sides have different store numbers
- Login adopts `store_profiles` / specialist `store_number` when device store is unset
- Store-ops APIs require a live Supabase Auth session linked to `profiles` (Hub PIN bridge or phone OTP → `linkAuthUserToSpecialistProfile`); store scope from JWT claims, not client headers

## Mobile floor UX (Waves A–C)
- Floor job first: Dashboard = pace + checklist; no permanent Super Admin quick-action strip
- Admin Tools drawer (Master only, defaults closed; `openAdminTools` event + hosted dynamic chunk after first open)
- Dense bay/rotation rows; completed lists collapsed by default
- Catalog/Remnant forms = bottom sheets; `/department` does not embed auditors

## Supervisor Invite & Onboarding
- Apply migration: `supabase/migrations/20260810_supervisor_invite.sql`
- Master Admin: Roster → **Invite** → optional phone → temp PIN + `/invite?token=` link (Twilio if env set, else copyable SMS)
- Env (optional): `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, `NEXT_PUBLIC_APP_URL`
- Onboarding steps: temp PIN → Create New PIN → Add to Home Screen → WebAuthn biometric → `/dashboard`
- APIs: `POST /api/admin/invite-supervisor`, `GET|POST /api/invite/[token]`
- **Test Invite Flow** (roster): dry-run `test_mode` → modal with PIN + welcome SMS + Copy Invite Link / Copy Full SMS Text; `/invite?test=1` preserves token after PIN reset

## Associate floor role
- Store Ops actor `associate`: read/complete dept rotations + locations; create exceptions via verify; **no** targets, invite, generate/reset, Admin Tools, `/admin/*`
- Nav: Floor · Map · Stock · Settings (Barriers / Specialty Tools in More)

## Department toggles · adaptive priority · showroom
- Apply `supabase/migrations/20260810_dept_priority_showroom.sql`
- Master toggles: Store Map Overview + Settings Department Overview (`departments.is_active`; Flooring default on)
- Adaptive draw: `manual_priority_count` + `last_completed_at` age; Store Map ★ Week assigns + bumps priority
- Showroom: `location_type=SHOWROOM_STACKOUT` + `audit_frequency_days`; dashboard Quick Touch card (not in weekly aisle draw)
- Store Map bay rows: compact dual-pill Selling/Topstock; tap Bay label → bottom sheet (pin / history / edit). Row kebab Edit / Delete; multi-select batch delete (Super Admin). Duplicate prune hard-deletes. Bulk Generator Clean-Up tab prunes aisle or odd/even range.

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
