# DeptSync Hub — Chat Handoff

## Product
DeptSync Hub — department-scoped inventory & SIMS audit platform for Lowe's store teams. Multi-category flooring + appliances, barcode scan-to-catalog, dual roll/carton audit engine, SIMS location finder, PWA offline shell + sync queue, multi-store isolation, department-scoped RBAC, specialist PIN / password, CLF/sqft variance, remnant aging, manager markdown, and **Store Operations** (aisle/bay map + automated weekly maintenance rotations).

## Branding
- App: **DeptSync Hub** · PWA short_name **DeptSync**
- Manifest name: `DeptSync — Department & SIMS Audit Hub`
- Layout title: `DeptSync Hub · Department & SIMS Audit` · appleWebApp title `DeptSync`
- Header: brand `DeptSync Hub` · subtitle `DeptSync · Lowe's #{store}` · section title · network
- Header badge: `DeptSyncBadge` (stacked boxes + barcode, emerald/amber on dark)
- Icons: `public/icons/icon-192.png`, `icon-512.png`, `apple-touch-icon.png`
- PWA manifest: `app/manifest.ts` → `/manifest.webmanifest`; static `public/manifest.json` → `/manifest.json` (TWA / Bubblewrap)
- **Obsidian-glass UI:** void `#090d16`; utilities in `app/globals.css` (`.glass-card`, `.glass-panel`, `.glass-input`, `.glass-backdrop`, `.glass-void`, `.btn-primary-glow`, `.btn-grid-action-*`, `.pb-safe`, status pills / bay glows). Emerald primary / cyan secondary accents. Lucide SVG nav icons (`NavIcons`) — no emoji bottom tabs.
- **Native shell:** haptics via `utils/haptics.ts` + `HapticsListener`; offline toast `OfflineNetworkBanner` + `ConflictResolutionModal`; sync auto-flush on online/visibility/focus; PWA/TWA splash theme `#090d16`

## AI (`lib/ai/gemini.ts`)
- Server-only Gemini Flash client (`@google/generative-ai`)
- Env: `GEMINI_API_KEY`, `GEMINI_MODEL` (default `gemini-3.5-flash`) — never `NEXT_PUBLIC_`
- Exports: `callGeminiFlash(prompt, inlineImage?)`, `callGeminiFlashJson`, `extractGeminiJsonText` / `parseGeminiJson`, `isGeminiConfigured`
- Inline images accept raw base64 or `data:image/...;base64,...` (prefix stripped)
- JSON regex extraction for object/array payloads from fenced or chatty model replies
- Does not recommend or own institutional knowledge — callers compose prompts
- **AI Pre-Flight (Bulk Generator):** `POST /api/store-locations/ai-parse` + `lib/store-ops/ai-parse.ts` normalize to `{ locations, corrections_made }`; UI tab confirms via existing bulk upsert
- **Flooring AI Insights:** `POST /api/flooring/ai-insights` + `lib/flooring/ai-insights.ts` + `FlooringAIInsightBanner` on Cycle Audit / Remnants; applies markdown via `lib/markdown` + `saveRemnant`; age bands via `agingBand()` (30/60/90+)
- **Zebra Shift Briefing:** `POST /api/store-health/ai-summary` + `ShiftBriefingCard` on `/dashboard` (composes `lib/store-ops/health` snapshot + active-shift `telemetry` → 3-bullet briefing)
- **Audit Velocity Chart:** `lib/store-ops/telemetry.ts` + `StoreHealthChart` on `/dashboard` (06:00–22:00 curve vs linear target; Overall / D23 / D35 pills)
- **Appliance Anomaly Detection:** `POST /api/appliances/ai-anomaly` + `ApplianceAnomalyWidget` on Appliance Audit (duplicate serials, distant locations, category mismatch, missing high-value floor models)
- **Catalog Taxonomies:** `lib/catalog/taxonomies.ts` (D21–D28 / D35 / D52 defaults) + `POST /api/catalog/ai-taxonomy` + Admin Tools `TaxonomyManagerModal`; folder accordions on Department Audit + `/department`
- **AI Visual Bay Scan:** `POST /api/store-ops/ai-bay-scan` + `lib/store-ops/ai-bay-scan.ts` + `VisualBayScannerModal` — Gemini multimodal carton/pallet/hazard read on Store Map bay sheet + Cycle Audit
- **Manager Notes / Executive Floor Pad:** `POST /api/store-ops/ai-note-summary` (legacy synthesize) + Server Action `extractTasksAndTag` (`app/actions/manager-notes.ts`) + `lib/store-ops/ai-note-extract.ts` + `lib/store-ops/manager-notes.ts` (Supabase CRUD + realtime + archive) + `components/manager-notes/ExecutiveFloorPad` — TipTap rich pad, Gemini Copilot tasks/tags, debounced autosave; Admin Tools + `/manager-notes`

## RBAC (`lib/rbac.ts` + `lib/specialists.ts`)
| Role | Scope | Tabs |
|------|-------|------|
| 👑 Master Admin | `assigned_department: all` | Flooring · Appliances · Remnants · Master |
| 🛡️ Department Supervisor | e.g. Amber → `appliances`, Dave → `plumbing` | Dept audit / profile (flooring also gets Remnants) |
| 👤 Floor Associate | inherits / assigned dept | Checklist · Barriers · Specialty Tools · Profile (no Admin Tools) |

### Master Admin roster console
- Roster CRUD lives on `/admin/supervisors` and **Admin Tools** (not permanent Settings chrome)
- **Add** creates via `POST /api/admin/invite-supervisor` — crypto 6-digit temp PIN (never typed by admin); invite/SMS preview shows the returned PIN
- Reset / Invite re-issues the same invite path (random PIN + `/invite` link)
- Edit scope / **Deactivate** (soft-delete `is_active: false` + optional hard delete)
- Deactivated profiles stay out of active roster fetches; seed helpers respect tombstones so Amber is not revived

### Admin Tools (Super Admin only)
- Slide-over drawer defaults **closed** — header **Admin** chip, hamburger entry, or `openAdminTools()`
- Owns: Bulk Generate, **Sunday Rotation Engine** (Flooring cycle assign), Trigger Weekly Rotation, **Executive Floor Pad**, Catalog Taxonomies (AI generate / refresh), all-dept bay targets, store number, device diagnostics, links to Store Map / Supervisors / Exceptions
- Department Supervisors never see Admin Tools chrome
- Master Admin header: **My Department Context** pin (Full Store / D23 Flooring / D35 Appliances / …) — filters dashboard Flooring focus without dropping Master privileges

### Sunday Flooring Cycle Audit
- Staging card + assignment modal: open weekly Flooring bays → assign from Flooring roster; Auto-Assign All to Me; Stage/Draw 12
- Assignments persist in `sunday_bay_assignments` (JWT store/dept RLS); `bay_id` = `weekly_rotations.id`; ISO week → `week_starting` Monday
- Entry points: `/dashboard`, Cycle Audit tab, Admin Tools, `/flooring` deep link

### Departments
`flooring` · `appliances` · `plumbing` · `electrical` · `lawn_garden` · `paint` · `millwork` · `building_materials` · `hardware` · `all`

- Seeds: none auto-injected. Create Master / Supervisor profiles via invite / Add Supervisor; temporary PIN sets `must_change_credentials: true` until first-login change
- First-login: non-dismissible AuthWall setup when `must_change_credentials` (no Remind Later)

## Authentication (Zero-Access Wall)
- Unauthenticated visitors never see workspace tabs/data — `AuthWall` only
- Login: username + password/PIN → roster match (`findSpecialistByLogin`) — hub UI session only
- **Store Ops identity:** Supabase Auth session required (`Authorization: Bearer` from phone OTP / Auth). `resolveStoreOpsActor` loads `profiles` where `id = auth.users.id` (no `x-store-ops-*` trust headers; emergency `MASTER-2026-TEMP` removed)
- **Phone recovery / Auth link:** "Forgot Access Code? Reset via Phone" → roster phone lookup → `signInWithOtp` → verify → `/api/auth/phone-reset/confirm` resets PIN **and** upserts `profiles` + JWT `app_metadata` (`store_number`, `department`, `role`) via `linkAuthUserToSpecialistProfile`
- Setup requires verified mobile (`phone_number` on `store_specialists`)
- Native keychain: form `autocomplete` username / current-password
- Biometric: WebAuthn platform authenticator (`lib/biometric-auth.ts`); optional enroll after login; fingerprint unlock button when registered
- `must_change_credentials` → non-dismissible permanent credential setup
- Session: `deptsync_auth_session` in **localStorage** (roster UI); Supabase Auth session in localStorage for API Bearer tokens; 8h idle lock on hub session
- Returning browser: valid localStorage hub session restores workspace; Store Ops APIs still need a live Supabase Auth session
- Seeds: no hardcoded roster injection — use Invite / Add Supervisor; temp PIN sets `must_change_credentials`
- Primary: fixed bottom tabs — **filtered by role/department**
- Header: DeptSync Hub brand + `DeptSync · Lowe's #…` subtitle · section title · network; specialist chip + PIN gear
- Cycle Audit / Appliances: hardware-scan ready without soft keyboard; sticky Log docked above bottom nav

## Store Ops auth transport
- Client: `storeOpsAuthHeadersAsync` → `Authorization: Bearer` from `getSupabaseAccessToken()` (`lib/supabase` localStorage session)
- Server: `getRequestAuthUser` (Bearer or cookie) → `resolveStoreOpsActor` → `profiles`
- Push subscribe: `user_id` = Auth profile id; `specialist_id` null
- SQL: `supabase/migrations/20260812_jwt_rls_policies.sql` — Custom Access Token Hook + store/department RLS on locations, rotations, exceptions, manager_notes, etc.
## Scan-to-Catalog
- SKU / UPC resolve via `lib/barcode.ts` → `carpet_catalog`
- Soft keyboard: **tap-to-type only** (no auto-focus on tab switch)
- Hardware wedges: `useGlobalBarcodeScanner` (window keydown, 6+ chars ≤150ms) → active section lookup
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
- Header: Online / Offline Mode + pending count

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

## Audit Report Export
- Shift summary → **📊 Export / Print Report** (Flooring, Appliances, Department)
- `AuditReportModal` + `lib/audit-report.ts`: formal SIMS/cycle summary, print-to-PDF, mailto / `navigator.share`, Markdown clipboard paste
- Print stylesheet strips hub chrome for letter B&W output

## Store Operations (multi-dept maintenance)
- Schema migration: `supabase/migrations/20260809_store_operations_rbac.sql`
  - `departments`, `profiles` (auth.users + `super_admin` / `department_supervisor`), `store_locations` (SELLING/TOPSTOCK + cycle status), `weekly_rotations`
  - RLS: super_admin all; supervisors read/update own `assigned_department_id`
- Hub bridge: Master Admin → super_admin; Supervisor → department_supervisor (via `departments.code` = hub `assigned_department`)
- **Navigation Hub** (`lib/nav-hub.ts` + `NavigationHub.tsx`): role-aware hamburger + ops bottom tabs (Lucide SVG, max 5; Notes/Settings in More sheet)
  - Super Admin primary: Map · Team · Alerts · Zebra · More
  - Supervisor primary: Zebra · Verify · Dept · More
  - Associate primary: Zebra · Barriers · Tools · Profile
- Quick Actions banner (Super Admin): Bulk Generate · Trigger Weekly Rotation · Manage Supervisors
- `/admin/store-map` — department overview + location grid; Bulk Add accordion; Trigger Weekly Rotation modal (**Force Draw New Rotation**); **📷 Snap Bay AI Audit** (Gemini visual scan) on page + bay actions sheet
- `/manager-notes` — Executive Floor Pad (TipTap rich notes + Gemini Copilot Extract Tasks & Tag + archive); also Admin Tools entry + `#manager-notes`
- `/dashboard` — Store Health Scorecard (top) + Zebra checklist for this ISO week; checkbox → complete rotation + location COMPLETED (cool-down)
- `GET /api/store-health` — weekly pace + bottleneck aggregation for DS / Super Admin
- `POST /api/store-ops/ai-bay-scan` — multimodal bay photo → carton/pallet estimates, cleanliness score, detected issues (Store Ops actor)
- `POST /api/store-ops/ai-note-summary` — manager note + optional S Pen PNG → executive summary + action items (Store Ops actor)
- APIs under `/api/rotations/*`, `/api/store-locations*`, `/api/departments`, `/api/weekly-rotations`
- Multi-store: apply `20260809_multi_store.sql`; store scope comes from JWT `app_metadata.store_number` / `profiles.store_number`
- Manager notes: apply `20260811_manager_notes.sql` + `20260812_manager_notes.sql` + `20260812_manager_notes_archive.sql` (`is_archived`; durable Supabase CRUD; JWT store/dept RLS)
- Sunday bay assignments: apply `20260812_sunday_bay_assignments.sql`
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
- `/verify-rotation` — supervisors confirm or report incomplete bays (CARRIED_OVER + exception reasons)
- `/admin/exceptions` — Master Admin tabs: Pending / Verified / Barriers / All
- APIs: `POST /api/rotations/verify`, `GET /api/rotations/exceptions`

## Store number (dynamic)
- Owner: `lib/store.ts` — localStorage `carpet_hub_store_number`; **no hardcoded `1234`/`1852`**
- Blank allowed; Master edits via **Admin Tools → Store Number** (session stays active)
- Session / active specialist / biometric only reject when both sides have different store numbers
- Login adopts `store_profiles` / specialist `store_number` when device store is unset
- Store-ops APIs require a live Supabase Auth session linked to `profiles` (phone OTP → `linkAuthUserToSpecialistProfile`); store scope from JWT claims, not client headers

## Mobile floor UX (Waves A–C)
- Floor job first: Dashboard = pace + checklist; no permanent Super Admin quick-action strip
- Admin Tools drawer (Master only, defaults closed)
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
- Nav: Checklist · Barriers / Log · Specialty Tools · My Profile / PIN

## Department toggles · adaptive priority · showroom
- Apply `supabase/migrations/20260810_dept_priority_showroom.sql`
- Master toggles: Store Map Overview + Settings Department Overview (`departments.is_active`; Flooring default on)
- Adaptive draw: `manual_priority_count` + `last_completed_at` age; Store Map ★ Week assigns + bumps priority
- Showroom: `location_type=SHOWROOM_STACKOUT` + `audit_frequency_days`; dashboard Quick Touch card (not in weekly aisle draw)
- Store Map bay rows: large S/T toggles; tap Bay label → bottom sheet (pin / history / edit zone)

## Appliance categories (suite + sub)
- **Tables:** `appliance_catalog` + `appliance_scans` (not carpet_*). Apply `supabase/migrations/20260810_appliance_catalog_scans.sql`
- Top-level: Laundry · Refrigeration · Cooking / Ranges · Dishwashers · Microwaves / Venting
- Sub required on Quick-Add UPC link / floor scan / catalog (Laundry → Washer | Dryer | Combo / Unit)
- Types: `ApplianceCatalogItem`, `ApplianceScan` (`sub_category?`)
- APIs: `/api/appliances/catalog`, `/api/appliances/scans` (`?format=csv`)
- CSV export: **SUMMARY** (Item Number, Description, Category, Total Count Scanned, Locations Found) + **RAW DETAIL** (Category, Sub-Category, Item #, Serial #, Location, Scanned By, Scanned At, Store #)
- Online scans POST `/api/appliances/scans` (service role); failures surface as `Failed to save scan: …` (no silent offline success)
- **Continuous mode:** detect → POST immediately; no Submit button. Known SKU auto-logs; new/unlinked pauses on Quick-Add (sub_category) then logs + clears. Sticky **Session Total** counter at scanner top.
- **Scan log UX:** category accordion (collapsed default) → sub-category sections → SKU Qty cards; search auto-expands matches; 10 SKUs/page; sticky-free filter pills + search; Edit modal; `PATCH /api/appliances/scans`
