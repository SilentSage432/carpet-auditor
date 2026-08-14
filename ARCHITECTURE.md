# DeptSync Hub — Architecture

```
app/page.tsx                      → Hub shell (section state + RBAC gate + data load + online flush; keep-alive panes + startTransition)
app/layout.tsx                    → Fonts, PWA meta (DeptSync), ServiceWorkerRegister
app/manifest.ts                   → short_name DeptSync · Department & SIMS Audit Hub
public/sw.js                      → Offline shell cache strategies
components/hub/HubChrome.tsx      → Sticky header (legacy) + role-filtered inventory bottom nav
components/hub/NavigationHub.tsx  → Cross-app Navigation Hub (hamburger, role badge, ops bottom nav)
components/hub/admin-tools-events.ts → Admin Tools open event + types (light; drawer is dynamic)
components/hub/NavIcons.tsx       → Shared Lucide icons for ops + inventory bottom bars
components/hub/HapticsListener.tsx → Delegated vibrate pulses for taps / toggles / tabs
components/hub/OfflineNetworkBanner.tsx → Offline toast + installSyncAutoFlush callbacks
components/offline/ConflictResolutionModal.tsx → Local vs Server sync conflict chooser
utils/haptics.ts                  → navigator.vibrate wrapper (light/medium/success)
components/hub/SuperAdminQuickActions.tsx → Bulk / Trigger Rotation / Manage Supervisors banner
components/hub/SessionGate.tsx    → Auth gate for Store Ops route pages
lib/nav-hub.ts                    → Role-aware Store Ops route menus + compact role badges + overflow/More
lib/push/*                        → Web Push subscribe + VAPID dispatch for rotation alerts
app/admin/store-map/page.tsx      → Super Admin aisle/bay bulk mapper + weekly generate
app/admin/supervisors/page.tsx    → Supervisor & role management console
app/dashboard/page.tsx            → Zebra supervisor weekly rotation checklist
app/department/page.tsx           → Department Overview (supervisor audit workspace)
app/settings/page.tsx             → Standalone Settings & Config
app/api/push/*                    → VAPID public key, subscribe, manual dispatch
app/api/cron/weekly-rotation      → Sunday automated rotation engine (CRON_SECRET)
vercel.json                       → Cron schedule 59 23 * * 0
supabase/migrations/20260809_push_notifications.sql → push_subscriptions + RLS
supabase/migrations/20260809_weekly_rotation_cron.sql → weekly_bay_target + Lowe's dept codes
components/auth/AuthWall.tsx      → Non-dismissible login / setup / unlock gate
components/hub/AdminRosterManager.tsx → Master Admin team/department roster console
components/hub/AuditReportModal.tsx → Printable / emailable / clipboard audit report
components/hub/*Modal.tsx         → Specialist / PIN / Markdown modals
components/barcode/QuickAddCatalogModal.tsx → Scan-to-catalog Quick-Add
components/catalog/SimsLocationFinder.tsx   → SIMS location stock drawer
components/hub/AdminDepartmentSwitcher.tsx → Master Admin working-dept pin
components/sections/CycleAuditScanForm.tsx → Flooring scan/input island (drafts + scanner; log stays in parent)
components/sections/ApplianceScanForm.tsx → Appliance scan/input island (drafts + scanner; log stays in parent)
components/admin/SundayAuditStagingCard.tsx → Glowing pending Sunday Flooring audit CTA
components/admin/SundayAuditAssignmentModal.tsx → Assign Flooring specialists to staged bays
lib/admin-department-context.ts       → Master Admin working department pin (local)
lib/store-ops/sunday-audit.ts         → Sunday Flooring staging + Supabase sunday_bay_assignments
lib/store-ops/manager-notes.ts        → Manager notes Supabase CRUD + realtime + archive (JWT-scoped)
lib/store-ops/ai-bay-scan.ts          → Visual bay scan prompt / normalize / local fallback
lib/store-ops/ai-note-summary.ts      → Legacy manager note synthesis prompt / normalize / fallback
lib/store-ops/ai-note-extract.ts      → Floor Pad Gemini Extract Tasks & Tag prompt / normalize / fallback
app/actions/manager-notes.ts          → Server Action extractTasksAndTag (Bearer token auth)
components/manager-notes/*            → Executive Floor Pad (TipTap rich text + Copilot + archive)
components/store-ops/ManagerNotesWorkspace.tsx → Compatibility re-export of ExecutiveFloorPad
app/manager-notes/page.tsx            → Hub route for Executive Floor Pad
app/api/store-ops/ai-note-summary     → Gemini Flash manager note synthesis (legacy API)
supabase/migrations/20260812_manager_notes_archive.sql → manager_notes.is_archived
app/flooring/page.tsx                 → Deep link → Cycle Audit + D23 pin
lib/auth-session.ts               → Auth session token + inactivity lock
lib/biometric-auth.ts             → WebAuthn fingerprint / Face ID register + assert
lib/audit-report.ts               → Audit report metrics + email/clipboard composition
lib/hardware-scanner.ts           → Window-level Bluetooth/wedge barcode burst listener
lib/rbac.ts                       → Department-scoped section / catalog visibility (compose only)
lib/store.ts                      → Active store_number session
lib/store-ops/stores.ts           → Resolve store_number → stores.id; ensure per-store departments
lib/sync-queue.ts                 → Offline queue + backoff + conflict pause + auto-flush
lib/sync-conflict.ts              → SyncConflictError + conflict event bus
lib/network.ts                    → Online/offline badge state
lib/sims.ts                       → SIMS location aggregation (compose only)
lib/markdown.ts                   → Clearance price math + badge label
lib/calc.ts                       → CLF + carton sq ft + remnant sq ft / sq yd
lib/catalog.ts / remnants.ts / storage.ts / specialists.ts → Domain persistence
lib/supabase.ts                   → Client factory
lib/store-ops/*                   → Store Operations domain (rotations, bulk map, auth bridge)
app/admin/store-map/page.tsx      → Super Admin aisle/bay bulk mapper + weekly generate
app/dashboard/page.tsx            → Zebra supervisor weekly rotation checklist
app/api/rotations/*               → Generate + complete rotation route handlers
app/api/store-locations*          → List / patch / bulk location APIs (GET list is column-pruned for Store Map)
supabase/schema.sql               → Tables + multi-category + SIMS + store_number + RBAC columns + RLS
supabase/migrations/20260809_store_operations_rbac.sql → departments, profiles, locations, weekly rotations + RLS
supabase/migrations/20260809_multi_store.sql → stores + store_id scoping
supabase/migrations/20260810_store_locations_type_unique.sql → location unique (department_id,aisle,bay,type)
supabase/migrations/20260811_alphanumeric_aisle.sql → store_locations.aisle INTEGER → TEXT (BW/RW/12/A1)
supabase/migrations/20260811_manager_notes.sql → manager_notes (S Pen canvas + AI action items)
supabase/migrations/20260812_jwt_rls_policies.sql → JWT claims hook + store/department RLS
supabase/migrations/20260812_manager_notes.sql → durable manager_notes (store_number/department/author) + JWT RLS
supabase/migrations/20260812_sunday_bay_assignments.sql → sunday specialist↔bay assignments + JWT RLS

## Ownership

| Concern | Owner |
|---|---|
| Navigation / section routing | `app/page.tsx` + `HubChrome` (roster-only boot; `next/dynamic` sections; keep-alive `HubPane` + `startTransition`) |
| Department RBAC / tab visibility | `lib/rbac.ts` |
| Cross-app Navigation Hub | `lib/nav-hub.ts` + `NavigationHub` + `admin-tools-events.ts` (`AdminToolsDrawer` when `adminOpen`) |
| Store Operations map + rotations | `lib/store-ops/*` + `/admin/store-map` + `/dashboard` |
| Manager notes / Executive Floor Pad | `lib/store-ops/ai-note-extract.ts`, `manager-notes.ts`, `app/actions/manager-notes.ts`, `components/manager-notes/*` (Copilot: plain text ≤ 8k) |
| Team roster (Master Admin) | `AdminRosterManager`, `lib/specialists.ts` (`is_active` soft-delete) |
| Store context | `lib/store.ts` + `lib/store-ops/stores.ts` |
| Offline sync queue | `lib/sync-queue.ts`, `lib/sync-conflict.ts`, `ConflictResolutionModal` |
| Shell caching | `public/sw.js` + `ServiceWorkerRegister` |
| CLF / carton math | `lib/calc.ts` |
| Number typing UX | `lib/number-input.ts` + `NumberField` |
| Catalog knowledge | `lib/catalog.ts` |
| Store health scorecard | `lib/store-ops/health.ts`, `StoreHealthCard` |
| Shift audit velocity telemetry | `lib/store-ops/telemetry.ts`, `StoreHealthChart` |
| Zebra shift briefing | `lib/store-ops/shift-briefing.ts`, `ShiftBriefingCard` |
| Visual bay scan | `lib/store-ops/ai-bay-scan.ts`, `VisualBayScannerModal` (720p stream; JPEG q=0.70 / 960px) |
| Gemini transport | `lib/ai/gemini.ts` (`GEMINI_JSON_GENERATION_CONFIG`: JSON mime, 1024 output tokens) |
| Barcode resolve / Quick-Add | `lib/barcode.ts`, `NumberField` scan hooks, `QuickAddCatalogModal` |
| Hardware wedge (no soft keyboard) | `lib/hardware-scanner.ts` |
| Focus / keyboard dismiss | `lib/focus-input.ts` (`blurActiveInput` — never auto-focus on tab switch) |
| SIMS location stock | `lib/sims.ts`, `SimsLocationFinder` |
| Specialists session / credentials | `lib/specialists.ts`, `SpecialistModal` |
| Zero-access auth wall / idle lock | `lib/auth-session.ts`, `components/auth/AuthWall.tsx` |
| Store Ops Auth (JWT → profiles) | `lib/store-ops/auth.ts`, `lib/supabase/server.ts`, `lib/supabase/browser.ts`, `link-auth-profile.ts` |
| JWT / RLS policies | `supabase/migrations/20260812_jwt_rls_policies.sql` (Custom Access Token Hook + store/dept isolation) |
| Phone SMS OTP recovery + profile link | `lib/phone-auth.ts`, `lib/phone.ts`, `POST /api/auth/phone-reset/*` |
| Biometric / WebAuthn unlock | `lib/biometric-auth.ts`, `AuthWall` |
| PIN change / default notice | `ChangePinModal` |
| Manager markdown | `lib/markdown.ts`, `ApplyMarkdownModal` |
| Variance | `lib/variance.ts` |
| Remnant aging | `lib/aging.ts` |
| Remnant inventory | `lib/remnants.ts` |
| Audit log + draft | `lib/storage.ts` + `lib/debounced-persist.ts` (300ms) + `CycleAuditScanForm` |
| Audit report export / print / email | `lib/audit-report.ts`, `AuditReportModal` |

## Sections (role-filtered)

1. **Flooring Audit** — dual engine (roll CLF vs carton sq ft), scan-to-catalog, SIMS tags. Scan form is `CycleAuditScanForm` (isolated from the shift log).
2. **Appliances Audit** — continuous floor scans on `appliance_scans` + UPC links on `appliance_catalog`
   - Suites: Laundry · Refrigeration · Cooking / Ranges · Dishwashers · Microwaves / Venting
   - Required `sub_category` on UPC Quick-Add and scan log
   - Scan log aggregated by SKU (Qty + expandable unit detail); sticky category filter + SKU/location search; Edit modal for qty/serials/bay
   - CSV: SUMMARY (counts/locations) + RAW DETAIL audit trail
   - Continuous mode: barcode detect → immediate `POST /api/appliances/scans`; session total counter; new items pause on Quick-Add then auto-log
   - Scan form is `ApplianceScanForm` (isolated from the accordion log)
   - APIs: `/api/appliances/catalog`, `/api/appliances/scans` (`GET|POST|PATCH|DELETE`)
3. **Universal / Appliance Catalog** — removed from bottom nav; SKU linking remains via Quick-Add / scan flows (`carpet_catalog` / `appliance_catalog`). `/catalog` redirects to `/appliances`.
4. **Remnant Rack** — back-room remnant status + manager markdown
5. **Master / Profile Settings** — store selector (Master Admin), queue, Supabase + localStorage

## Dual audit modes

- **Mode A (Carpet / Sheet Vinyl)** — inches + fraction + rounds → CLF (`× 0.2625`)
- **Mode B (LVP / Tile / Grout / Accessories / Hardwood / Appliances)** — box/unit count × sq ft per box (appliances: unit count only)

## Offline

Writes fall back to localStorage and enqueue into `carpet_hub_sync_queue`
(with `transaction_id`, `optimistic_at`, exponential backoff).
Mid-scan form drafts persist via `carpet_hub_audit_draft` / `carpet_hub_appliance_scan_draft` with a 300ms debounce and flush on submit / leave.
`installSyncAutoFlush` replays on `online`, tab focus, and `visibilitychange`.
Version mismatches / HTTP 409 pause for `ConflictResolutionModal` (keep local vs accept server).
The service worker caches the app shell for instant cold starts without connectivity.

## Schema note

Tables retain `carpet_*` names (alias: flooring_audits / SIMS catalog) for migration
compatibility. RBAC columns on `store_specialists`: `username`, `assigned_department`,
`must_change_credentials`; roles include `MasterAdmin`.
