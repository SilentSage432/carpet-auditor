# DeptSync Hub — Development Journal

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
