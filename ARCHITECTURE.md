# DeptSync Hub — Architecture

```
app/page.tsx                      → Hub shell (AuthWall + specialty scan `?section=`; authenticated home redirects to /dashboard)
app/dashboard/page.tsx            → Floor weekly bay checklist (unified layout; verify + exceptions inline)
app/(workflow)/layout.tsx         → Keep-alive Floor/Map/Roster/Settings shell (SessionGate once)
components/hub/WorkflowTabShell.tsx → Persistent tab panels (`hidden`; primary tabs hosted immediately)
lib/store-ops/ttl-cache.ts        → TTL + in-flight + getSWR stale-while-revalidate
lib/toast.ts                      → Sonner success/error helpers (presentation)
components/ui/Toaster.tsx         → Global toast host
app/layout.tsx                    → Geist + Geist Mono, PWA meta, ThemeProvider + FOUC boot script + Toaster
lib/theme.ts                      → Theme catalog, prefs persistence, document apply (owns personalization)
lib/theme-context.tsx             → React mirror of theme prefs (presentation)
components/settings/ThemeSelector.tsx → Appearance swatches + contrast/density toggles
app/globals.css                   → data-theme tokens + glass / nav / modal utilities bound to CSS variables
app/manifest.ts                   → short_name DeptSync · Department & SIMS Audit Hub
public/sw.js                      → Offline shell cache strategies
components/hub/HubChrome.tsx      → AssociateSpecialtySwitcher (in-page scan tabs only)
components/hub/HubHeader.tsx      → Sticky hub header (brand/store, department pill, account/PIN)
components/hub/BottomNav.tsx      → Floor · Map · Roster · Settings only (4-col grid)
components/hub/DeptSyncSplash.tsx → Boot / loading splash (pinned midnight + branded cyan/gold mark)
components/hub/NavigationHub.tsx  → Cross-app Navigation Hub (composes HubHeader + BottomNav; no hamburger/More/Admin Tools)
app/loading.tsx                   → Route-level splash
app/stock/page.tsx                → Redirect → /dashboard (Downstock lives on Floor)
app/(workflow)/roster/page.tsx    → Team roster keep-alive tab
components/hub/tabs/RosterTab.tsx → Unified roster (chips + add member)
components/admin/ExceptionFeed.tsx → Floor barrier feed (composes exception summary)
components/admin/WalkTheFloorSheet.tsx → Unified walk log + Snap Bay + Master Admin edit/pin
components/inventory/RollMeasurementPad.tsx → Compact roll/carton keypad (presentation; CycleAuditScanForm owns drafts)
components/admin/DepartmentTargetsMatrix.tsx → Weekly bay quota table (auto-save + Save All)
components/hub/WeeklyBayTargetCard.tsx → Re-export of DepartmentTargetsMatrix for Settings
components/hub/NavIcons.tsx       → Canonical Lucide HubIcon / NavIcon / DepartmentIcon (stroke 2, currentColor)
components/hub/DepartmentPicker.tsx → Lucide department listbox (roster / admin selectors)
lib/store-ops/realtime.ts         → Shared postgres_changes channel per logical name (bind-before-subscribe)
app/globals.css                   → Theme tokens + glass / hub-main / chip-filter / btn-quick-touch
components/hub/HapticsListener.tsx → Delegated vibrate pulses for taps / toggles / tabs
components/hub/OfflineNetworkBanner.tsx → Offline toast + installSyncAutoFlush callbacks
components/offline/ConflictResolutionModal.tsx → Local vs Server sync conflict chooser
utils/haptics.ts                  → navigator.vibrate wrapper (light/medium/success)
components/hub/SessionGate.tsx    → Auth gate for Store Ops route pages
lib/nav-hub.ts                    → Floor / Map / Roster / Settings routes + Settings tool hashes
lib/push/*                        → Web Push subscribe + VAPID dispatch for rotation alerts
app/admin/store-map/page.tsx      → Super Admin aisle/bay bulk mapper + Department Overview (Cabinets D29 target 6)
app/admin/supervisors/page.tsx    → Redirect → /roster
app/admin/roles/page.tsx          → Redirect → /roster
components/store-ops/ZebraChecklist.tsx → Floor bay checklist (optimistic complete, Quick Touch, downstock, Sunday handoff)
components/store-ops/BayHealthScorecard.tsx → Compact bay health badge (presentation)
lib/store-ops/bay-health.ts       → Aging / SIMS / topstock discrepancy diagnostics (compose only)
components/store-ops/AuditLocationModeToggle.tsx → SELLING vs TOPSTOCK audit-mode control
components/store-ops/BarrierReasonChips.tsx → One-tap barrier reasons
lib/store-ops/audit-location-mode.ts → Canonical SELLING/TOPSTOCK ↔ hub sales_floor/top_stock
components/dashboard/WeeklyRotationList.tsx → Compatibility re-export of ZebraChecklist
app/department/page.tsx           → Redirect → /dashboard
app/verify-rotation/page.tsx      → Redirect → /dashboard
app/admin/exceptions/page.tsx     → Redirect → /dashboard
app/settings/page.tsx             → Settings & Config (theme, targets, push, Master tools)
app/api/push/*                    → VAPID public key, subscribe, manual dispatch
app/api/cron/weekly-rotation      → Sunday automated rotation engine (CRON_SECRET)
vercel.json                       → Cron schedule 59 23 * * 0
supabase/migrations/20260809_push_notifications.sql → push_subscriptions + RLS
supabase/migrations/20260809_weekly_rotation_cron.sql → weekly_bay_target + Lowe's dept codes
components/auth/AuthWall.tsx      → Non-dismissible login / setup / unlock gate
components/hub/AuditReportModal.tsx → Printable / emailable / clipboard audit report
components/hub/*Modal.tsx         → Specialist / PIN / Markdown modals
components/barcode/QuickAddCatalogModal.tsx → Scan-to-catalog Quick-Add
components/catalog/SimsLocationFinder.tsx   → SIMS location stock drawer
components/hub/AdminDepartmentSwitcher.tsx → Master Admin working-dept pin
components/sections/CycleAuditScanForm.tsx → Flooring scan/input island (drafts + scanner; log stays in parent)
components/sections/ApplianceScanForm.tsx → Appliance scan/input island (drafts + scanner; log stays in parent)
components/admin/SundayAuditStagingCard.tsx → Glowing pending Sunday Flooring audit CTA
components/admin/SundayAuditAssignmentModal.tsx → Assign specialists + shift-hour balancer
lib/store-ops/weekly-rotations.ts → Proportional clustered bay assignment plan (hours / aisle-face / health risk)
lib/store-ops/sunday-audit.ts → Persist specialist↔bay; apply balancer plan
lib/store-ops/downstock.ts → Downstock/packdown flags (queue owner; assignment composes sunday-audit)
lib/store-ops/map-readiness.ts → Store Map green/yellow/red readiness tones (composes bay-health stale + week)
lib/store-ops/velocity.ts → IRP cadence tones + auto-tier rules (last_serviced_at / velocity_tier)
lib/store-ops/bay-service.ts → Persist bay_service_logs + stamp last_serviced_at + promote velocity
lib/store-ops/rotation.ts → Sunday draw velocity-priority pick (composed by rotations.ts)
lib/store-ops/audit-summary.ts → Supervisor weekly rollup composition (quota / associate / barriers)
components/store-ops/SupervisorAuditSummaryModal.tsx → Personal weekly stats + copy
lib/admin-department-context.ts       → Master Admin working department pin (local)
lib/store-ops/bay-pattern.ts          → Odd / even bay range expansion (Bulk Generator; default odd)
lib/store-ops/manager-notes.ts        → Manager notes Supabase CRUD + realtime + archive (JWT-scoped)
lib/store-ops/ai-bay-scan.ts          → Visual bay scan prompt / schema / normalize / local fallback
lib/store-ops/ai-note-extract.ts      → Floor Pad Gemini Extract Tasks & Tag prompt / schema / fallback
app/actions/manager-notes.ts          → Server Action extractTasksAndTag (Bearer token auth)
components/manager-notes/*            → Executive Floor Pad (TipTap rich text + Copilot + archive)
components/store-ops/ManagerNotesWorkspace.tsx → Compatibility re-export of ExecutiveFloorPad
app/manager-notes/page.tsx            → Redirect → /settings#manager-notes
app/api/store-ops/ai-note-summary     → Retired (410 Gone); use extractTasksAndTag
supabase/migrations/20260812_manager_notes_archive.sql → manager_notes.is_archived
app/flooring/page.tsx                 → Deep link → /dashboard + Sunday drawer (no 404 hop)
app/sunday-audit/page.tsx             → Redirect → /dashboard + Sunday drawer
app/sunday-rotation/page.tsx          → Redirect → /dashboard + Sunday drawer
components/admin/AssociateRosterPanel.tsx → Lightweight Specialist vs CSA roster (Sunday drawer)
lib/types.ts                          → Cabinets D29 + SPECIALTY/CORE + associateFloorTitle
supabase/migrations/20260814_cabinets_d29.sql → Seed Cabinets per store
supabase/migrations/20260814_bay_velocity_heatmap.sql → store_locations IRP columns + bay_service_logs
supabase/migrations/20260814_multi_department_access.sql → profiles + store_specialists accessible_departments + JWT match
app/admin/roles/page.tsx          → Redirect → /roster
app/api/admin/department-access/route.ts → Instant accessible_departments upsert + JWT app_metadata
components/hub/DepartmentAccessChips.tsx → Roster multi-select department grants
components/hub/AdminDepartmentSwitcher.tsx → Header pill when accessible_departments.length > 1
lib/auth-session.ts               → Auth session token + inactivity lock
lib/biometric-auth.ts             → WebAuthn fingerprint / Face ID register + assert
lib/audit-report.ts               → Audit report metrics + email/clipboard composition
lib/hardware-scanner.ts           → Window-level Bluetooth/wedge barcode burst listener
lib/rbac.ts                       → Department-scoped section / catalog visibility (compose only)
lib/department-access.ts          → accessible_departments compose (primary + granted)
lib/store.ts                      → Active store_number session
lib/store-ops/stores.ts           → Resolve store_number → stores.id; upsert seed (code or store_id,code) + UUID-safe list
lib/sync-queue.ts                 → Offline queue + backoff + conflict pause + auto-flush
lib/sync-conflict.ts              → SyncConflictError + conflict event bus
lib/network.ts                    → Online/offline badge state
lib/sims.ts                       → SIMS location aggregation (compose only)
lib/markdown.ts                   → Clearance price math + badge label
lib/calc.ts                       → CLF + carton sq ft + remnant sq ft / sq yd
lib/catalog.ts / remnants.ts / storage.ts / specialists.ts → Domain persistence
lib/supabase.ts                   → Client factory
lib/store-ops/*                   → Store Operations domain (rotations, bulk map, auth bridge)
app/admin/store-map/page.tsx      → Super Admin aisle/bay bulk mapper + Department Overview (Cabinets D29 target 6)
app/api/rotations/*               → Generate + complete + verify; POST /api/rotations/exceptions mid-week barriers
app/api/store-locations*          → List / patch / bulk location APIs (GET list is column-pruned for Store Map); POST /api/store-locations/service walk-the-floor log
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
| Navigation / section routing | `app/page.tsx` (specialty `?section=` or replace `/dashboard`) + `lib/nav-hub.ts` + `HubHeader` / `BottomNav` (Floor · Map · Roster · Settings) |
| Department RBAC / tab visibility | `lib/rbac.ts` (`visibleFloorAuditTabs` for in-page auditors) + `lib/department-access.ts` (granted extras) |
| Cross-app Navigation Hub | `lib/nav-hub.ts` + `NavigationHub` + `HubHeader` + `BottomNav` (Floor · Map · Roster · Settings only; Settings hashes for former Admin Tools) |
| Department weekly quotas | `DepartmentTargetsMatrix` (blur / Save All) + `PATCH /api/departments` + Settings |
| Store Operations map + rotations | `lib/store-ops/*` + `/admin/store-map` + `/dashboard` (bulk bays: `bay-pattern.ts` odd/even in Settings; floor checklist: `ZebraChecklist`; bay edit + Standard vs Velocity Heatmap: `StoreLocationGrid` + `WalkTheFloorSheet`; walk log: `bay-service.ts` + `POST /api/store-locations/service`; Sunday velocity pick: `rotation.ts` → `rotations.ts`; hard `DELETE /api/store-locations`) |
| Sunday assignments | `lib/store-ops/sunday-audit.ts` (persist) + `SundayAuditAssignmentModal` |
| Downstock / packdown queue | `lib/store-ops/downstock.ts` (flags) + Zebra Downstock tab on Floor (assign via sunday-audit) |
| Supervisor weekly rollup | `lib/store-ops/audit-summary.ts` + `SupervisorAuditSummaryModal` |
| Shift workload balancer | `lib/store-ops/weekly-rotations.ts` (pure plan: hours, clusters, health-risk priority) |
| Bay health / floor discrepancies | `lib/store-ops/bay-health.ts` + `BayHealthScorecard` (composes location cycle age + hub audits / SIMS / variance) |
| Selling vs Topstock audit mode | `lib/store-ops/audit-location-mode.ts` + `AuditLocationModeToggle` (Cycle/Department forms + Zebra filter) |
| Rotation verification / barriers | `lib/store-ops/verification.ts` + Floor **Verify completed bays** + `ExceptionFeed` + `POST /api/rotations/exceptions` |
| Manager notes / Executive Floor Pad | `lib/store-ops/ai-note-extract.ts`, `manager-notes.ts`, `app/actions/manager-notes.ts`, `components/manager-notes/*` (opened from Settings `#manager-notes`; `ai-note-summary` retired 410) |
| Team roster (Master Admin) | `RosterTab` + `lib/specialists.ts` (`is_active` soft-delete); invite via `/invite` |
| Cross-department grants | `lib/department-access.ts` + `POST /api/admin/department-access` + Roster chips |
| Working department pin | `lib/admin-department-context.ts` (Master full-store; multi-dept clamped to grants) |
| Store context | `lib/store.ts` + `lib/store-ops/stores.ts` |
| Offline sync queue | `lib/sync-queue.ts`, `lib/sync-conflict.ts`, `ConflictResolutionModal` |
| Header network / pending queue | `lib/network.ts` + `HeaderNetworkStatus` (hook isolated from hub forms) |
| Shell caching | `public/sw.js` + `ServiceWorkerRegister` |
| CLF / carton math | `lib/calc.ts` |
| Number typing UX | `lib/number-input.ts` + `NumberField` |
| Catalog knowledge | `lib/catalog.ts` |
| Store health scorecard | `lib/store-ops/health.ts`, `StoreHealthCard` |
| Shift audit velocity telemetry | `lib/store-ops/telemetry.ts`, `StoreHealthChart` |
| Zebra shift briefing | `lib/store-ops/shift-briefing.ts`, `ShiftBriefingCard` (composes health snapshot + `bay_health`) |
| Visual bay scan | `lib/store-ops/ai-bay-scan.ts`, `VisualBayScannerModal` (720p stream; JPEG q=0.70 / 960px) |
| Gemini transport | `lib/ai/gemini.ts` (`responseSchema` per caller + `GEMINI_TOKEN_BUDGET`) |
| Barcode resolve / Quick-Add | `lib/barcode.ts`, `NumberField` scan hooks, `QuickAddCatalogModal` |
| Hardware wedge (no soft keyboard) | `lib/hardware-scanner.ts` |
| Focus / keyboard dismiss | `lib/focus-input.ts` (`blurActiveInput` — never auto-focus on tab switch) |
| SIMS location stock | `lib/sims.ts`, `SimsLocationFinder` |
| Specialists session / credentials | `lib/specialists.ts`, `SpecialistModal` |
| Zero-access auth wall / idle lock | `lib/auth-session.ts`, `components/auth/AuthWall.tsx` |
| Store Ops Auth (JWT → profiles) | `lib/store-ops/auth.ts`, `lib/supabase/server.ts`, `lib/supabase/browser.ts`, `link-auth-profile.ts` |
| JWT / RLS policies | `20260812_jwt_rls_policies.sql` + `20260814_multi_department_access.sql` (`jwt_matches_department_code` ORs `app_metadata.accessible_departments`) |
| Phone SMS OTP recovery + profile link | `lib/phone-auth.ts`, `lib/phone.ts`, `POST /api/auth/phone-reset/*` |
| Biometric / WebAuthn unlock | `lib/biometric-auth.ts`, `AuthWall` |
| PIN change / default notice | `ChangePinModal` |
| Manager markdown | `lib/markdown.ts`, `ApplyMarkdownModal` |
| Variance | `lib/variance.ts` |
| Remnant aging | `lib/aging.ts` (markdown 30/60/90 + floor-ops Fresh/Watch/Critical rack bands) |
| Remnant inventory | `lib/remnants.ts` (`remnantRackAlert` composes rack badges / markdown chip) |
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
4. **Remnant Rack** — Settings accordion (`#remnants`) when RBAC allows
5. **Settings** — theme, PIN, weekly targets, push, device/sync; Master: bulk / taxonomies / force rotation / store #; Floor Pad modal

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
