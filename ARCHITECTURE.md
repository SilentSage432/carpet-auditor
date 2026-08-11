# DeptSync Hub — Architecture

```
app/page.tsx                      → Hub shell (section state + RBAC gate + data load + online flush)
app/layout.tsx                    → Fonts, PWA meta (DeptSync), ServiceWorkerRegister
app/manifest.ts                   → short_name DeptSync · Department & SIMS Audit Hub
public/sw.js                      → Offline shell cache strategies
components/hub/HubChrome.tsx      → Sticky header (legacy) + role-filtered inventory bottom nav
components/hub/NavigationHub.tsx  → Cross-app Navigation Hub (hamburger, role badge, ops bottom nav)
components/hub/SuperAdminQuickActions.tsx → Bulk / Trigger Rotation / Manage Supervisors banner
components/hub/SessionGate.tsx    → Auth gate for Store Ops route pages
lib/nav-hub.ts                    → Role-aware Store Ops route menus + compact role badges
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
components/sections/*             → Presentation per workspace section
components/sections/DepartmentAuditSection.tsx → Generic unit-count audit for non-flooring/appliance depts
lib/auth-session.ts               → Auth session token + inactivity lock
lib/biometric-auth.ts             → WebAuthn fingerprint / Face ID register + assert
lib/audit-report.ts               → Audit report metrics + email/clipboard composition
lib/hardware-scanner.ts           → Window-level Bluetooth/wedge barcode burst listener
lib/rbac.ts                       → Department-scoped section / catalog visibility (compose only)
lib/store.ts                      → Active store_number session
lib/store-ops/stores.ts           → Resolve store_number → stores.id; ensure per-store departments
lib/sync-queue.ts                 → Offline action queue + replay
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
app/api/store-locations*          → List / patch / bulk location APIs
supabase/schema.sql               → Tables + multi-category + SIMS + store_number + RBAC columns + RLS
supabase/migrations/20260809_store_operations_rbac.sql → departments, profiles, locations, weekly rotations + RLS
supabase/migrations/20260809_multi_store.sql → stores + store_id scoping
supabase/migrations/20260810_store_locations_type_unique.sql → location unique (department_id,aisle,bay,type)```

## Ownership

| Concern | Owner |
|---|---|
| Navigation / section routing | `app/page.tsx` + `HubChrome` |
| Department RBAC / tab visibility | `lib/rbac.ts` |
| Cross-app Navigation Hub | `lib/nav-hub.ts` + `NavigationHub` |
| Store Operations map + rotations | `lib/store-ops/*` + `/admin/store-map` + `/dashboard` |
| Team roster (Master Admin) | `AdminRosterManager`, `lib/specialists.ts` (`is_active` soft-delete) |
| Store context | `lib/store.ts` + `lib/store-ops/stores.ts` |
| Offline sync queue | `lib/sync-queue.ts` |
| Shell caching | `public/sw.js` + `ServiceWorkerRegister` |
| CLF / carton math | `lib/calc.ts` |
| Number typing UX | `lib/number-input.ts` + `NumberField` |
| Catalog knowledge | `lib/catalog.ts` |
| Barcode resolve / Quick-Add | `lib/barcode.ts`, `NumberField` scan hooks, `QuickAddCatalogModal` |
| Hardware wedge (no soft keyboard) | `lib/hardware-scanner.ts` |
| Focus / keyboard dismiss | `lib/focus-input.ts` (`blurActiveInput` — never auto-focus on tab switch) |
| SIMS location stock | `lib/sims.ts`, `SimsLocationFinder` |
| Specialists session / credentials | `lib/specialists.ts`, `SpecialistModal` |
| Zero-access auth wall / idle lock | `lib/auth-session.ts`, `components/auth/AuthWall.tsx` |
| Biometric / WebAuthn unlock | `lib/biometric-auth.ts`, `AuthWall` |
| PIN change / default notice | `ChangePinModal` |
| Manager markdown | `lib/markdown.ts`, `ApplyMarkdownModal` |
| Variance | `lib/variance.ts` |
| Remnant aging | `lib/aging.ts` |
| Remnant inventory | `lib/remnants.ts` |
| Audit log + draft | `lib/storage.ts` |
| Audit report export / print / email | `lib/audit-report.ts`, `AuditReportModal` |

## Sections (role-filtered)

1. **Flooring Audit** — dual engine (roll CLF vs carton sq ft), scan-to-catalog, SIMS tags
2. **Appliances Audit** — continuous floor scans on `appliance_scans` + UPC links on `appliance_catalog`
   - Suites: Laundry · Refrigeration · Cooking / Ranges · Dishwashers · Microwaves / Venting
   - Required `sub_category` on UPC Quick-Add and scan log; CSV includes Sub-Category · Item # · Serial # · Location
   - Continuous mode: barcode detect → immediate `POST /api/appliances/scans`; session total counter; new items pause on Quick-Add then auto-log
   - APIs: `/api/appliances/catalog`, `/api/appliances/scans`
3. **Universal / Appliance Catalog** — flooring = `carpet_catalog`; appliances tab = `appliance_catalog`
4. **Remnant Rack** — back-room remnant status + manager markdown
5. **Master / Profile Settings** — store selector (Master Admin), queue, Supabase + localStorage

## Dual audit modes

- **Mode A (Carpet / Sheet Vinyl)** — inches + fraction + rounds → CLF (`× 0.2625`)
- **Mode B (LVP / Tile / Grout / Accessories / Hardwood / Appliances)** — box/unit count × sq ft per box (appliances: unit count only)

## Offline

Writes fall back to localStorage and enqueue into `carpet_hub_sync_queue`.
Mid-scan form drafts persist via `carpet_hub_audit_draft`.
On `online`, `flushSyncQueue()` replays pending actions for the active store.
The service worker caches the app shell for instant cold starts without connectivity.

## Schema note

Tables retain `carpet_*` names (alias: flooring_audits / SIMS catalog) for migration
compatibility. RBAC columns on `store_specialists`: `username`, `assigned_department`,
`must_change_credentials`; roles include `MasterAdmin`.
