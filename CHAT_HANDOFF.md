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
- Owns: Bulk Generate, Trigger Weekly Rotation, all-dept bay targets, store number, device diagnostics, links to Store Map / Supervisors / Exceptions
- Department Supervisors never see Admin Tools chrome

### Departments
`flooring` · `appliances` · `plumbing` · `electrical` · `lawn_garden` · `paint` · `millwork` · `building_materials` · `hardware` · `all`

- Seeds: none auto-injected. Create Master / Supervisor profiles via invite / Add Supervisor; temporary PIN sets `must_change_credentials: true` until first-login change
- First-login: non-dismissible AuthWall setup when `must_change_credentials` (no Remind Later)

## Authentication (Zero-Access Wall)
- Unauthenticated visitors never see workspace tabs/data — `AuthWall` only
- Login: username + password/PIN → roster match (`findSpecialistByLogin`)
- **Emergency unlock:** enter `MASTER-2026-TEMP` → `POST /api/auth/emergency-unlock` promotes/creates `MasterAdmin` (`role`, `is_active: true`, clears invite/temp flags) and starts a persistent session
- **Phone recovery:** "Forgot Access Code? Reset via Phone" → roster phone lookup → `supabase.auth.signInWithOtp({ phone })` → 6-digit verify → reset `pin_code` via `/api/auth/phone-reset/confirm`
- Setup requires verified mobile (`phone_number` on `store_specialists`)
- Native keychain: form `autocomplete` username / current-password
- Biometric: WebAuthn platform authenticator (`lib/biometric-auth.ts`); optional enroll after login; fingerprint unlock button when registered
- `must_change_credentials` → non-dismissible permanent credential setup
- Session: `deptsync_auth_session` in **localStorage** (`specialist`, `sessionToken`, `lastActiveTimestamp`); Supabase Auth OTP session also persisted in localStorage; 8h idle lock only
- Returning browser: valid localStorage session restores workspace without re-entering codes
- Seeds: no hardcoded roster injection — use Invite / Add Supervisor; temp PIN sets `must_change_credentials`
- Primary: fixed bottom tabs — **filtered by role/department**
- Header: DeptSync Hub brand + `DeptSync · Lowe's #…` subtitle · section title · network; specialist chip + PIN gear
- Cycle Audit / Appliances: hardware-scan ready without soft keyboard; sticky Log docked above bottom nav

## Scan-to-Catalog
- SKU / UPC resolve via `lib/barcode.ts` → `carpet_catalog`
- Soft keyboard: **tap-to-type only** (no auto-focus on tab switch)
- Hardware wedges: `useGlobalBarcodeScanner` (window keydown, 6+ chars ≤150ms) → active section lookup
- Focused SKU fields still support Enter **or** rapid burst via NumberField
- Quick-Add modal for unlinked barcodes
- Catalog folders (`lib/catalog-folders.ts`); domain-filtered for department supervisors

## Dual audit engine
- Mode A (Carpet / Sheet Vinyl): CLF; Mode B: cartons × sqft/box
- Appliances: unit count + SIMS staging; Model # on catalog `vendor`

## Offline & PWA
- Service worker `public/sw.js`; sync queue `carpet_hub_sync_queue`
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
- **Navigation Hub** (`lib/nav-hub.ts` + `NavigationHub.tsx`): role-aware hamburger + ops bottom tabs
  - Super Admin: `/admin/store-map` · `/admin/supervisors` · `/dashboard` · `/settings`
  - Supervisor: `/dashboard` · `/department` · `/settings`
- Quick Actions banner (Super Admin): Bulk Generate · Trigger Weekly Rotation · Manage Supervisors
- `/admin/store-map` — department overview + location grid; Bulk Add accordion; Trigger Weekly Rotation modal (**Force Draw New Rotation**)
- `/dashboard` — Store Health Scorecard (top) + Zebra checklist for this ISO week; checkbox → complete rotation + location COMPLETED (cool-down)
- `GET /api/store-health` — weekly pace + bottleneck aggregation for DS / Super Admin
- APIs under `/api/rotations/*`, `/api/store-locations*`, `/api/departments`, `/api/weekly-rotations`
- Multi-store: apply `20260809_multi_store.sql`; requests send `x-store-ops-store-number`
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
- Store-ops APIs require a real `x-store-ops-store-number` (no inventing defaults)

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
