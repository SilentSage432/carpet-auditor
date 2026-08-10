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
| 👑 Master Admin | `assigned_department: all` | Flooring Audit · Appliances · Universal Catalog · Remnants · Master Settings |
| 🛡️ Department Supervisor | e.g. Amber → `appliances`, Dave → `plumbing` | Dept audit/catalog/profile (flooring also gets Remnants) |
| 👤 Floor Associate | inherits / assigned dept | Same as department supervisor for that dept |

### Master Admin roster console
- Settings → **👥 Team & Department Roster Manager** (Master Admin only)
- Add supervisor/associate with department, username suggest, temp password, first-login reset flag
- Reset credentials / Edit scope / **Deactivate** (soft-delete `is_active: false` + optional hard delete)
- Deactivated profiles stay out of active roster fetches; seed helpers respect tombstones so Amber is not revived
- Shareable issued-login card after create/reset

### Departments
`flooring` · `appliances` · `plumbing` · `electrical` · `lawn_garden` · `paint` · `millwork` · `building_materials` · `hardware` · `all`

- Seeds: Master Admin (`master_admin` / `1234`), Flooring Supervisor (`flooring_supervisor` / `1234`), Amber appliances (`amber_appliance` / `ChangeMe123`, `must_change_credentials: true`)
- First-login: non-dismissible AuthWall setup when `must_change_credentials` (no Remind Later)

## Authentication (Zero-Access Wall)
- Unauthenticated visitors never see workspace tabs/data — `AuthWall` only
- Login: username + password/PIN → roster match (`findSpecialistByLogin`)
- Native keychain: form `autocomplete` username / current-password
- Biometric: WebAuthn platform authenticator (`lib/biometric-auth.ts`); optional enroll after login; fingerprint unlock button when registered
- `must_change_credentials` → non-dismissible permanent credential setup
- Session: `deptsync_auth_session` (`specialist`, `sessionToken`, `lastActiveTimestamp`); 8h idle lock
- Returning unlock: quick 4-digit PIN, password, or fingerprint; header 🔒 logs out
- Seeds: `master_admin` / `1234`, `flooring_supervisor` / `1234`, `amber_appliance` / `ChangeMe123` (must change)
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
- `store_locations`: `onConflict: department_id,aisle,bay` (payload includes status PENDING, is_active true)
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
- `/admin/store-map` — bulk aisle/bay generator (upsert on `department_id,aisle,bay`) + grid deactivate toggles + Generate Week
- `/dashboard` — Zebra checklist for this ISO week; checkbox → complete rotation + location COMPLETED (cool-down)
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
- Settings → Weekly bay target for supervisors

## End-of-week verification
- Migration: `supabase/migrations/20260809_rotation_verification.sql`
- `/verify-rotation` — supervisors confirm or report incomplete bays (CARRIED_OVER + exception reasons)
- `/admin/exceptions` — Master Admin verification status + bottleneck log
- APIs: `POST /api/rotations/verify`, `GET /api/rotations/exceptions`

## Store number (dynamic)
- Owner: `lib/store.ts` — localStorage `carpet_hub_store_number`; **no hardcoded `1234`/`1852`**
- Blank allowed; Settings → free edit + **Save Store Number** (session stays active)
- Session / active specialist / biometric only reject when both sides have different store numbers
- Login adopts `store_profiles` / specialist `store_number` when device store is unset
- Store-ops APIs require a real `x-store-ops-store-number` (no inventing defaults)
