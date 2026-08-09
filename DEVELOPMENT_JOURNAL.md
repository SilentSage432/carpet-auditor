# DeptSync Hub — Development Journal

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
