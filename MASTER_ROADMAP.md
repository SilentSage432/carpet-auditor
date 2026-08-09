# DeptSync Hub — Master Roadmap

## Done
- [x] Carpet Hub shell with sticky header + slide-over nav
- [x] Number input sanitize + barcode Marry workflow
- [x] Cycle Audit, Catalog, Remnant Rack, Settings
- [x] PWA manifest + home-screen icons / iOS meta
- [x] Active specialist session + audited_by / logged_by
- [x] System vs physical CLF variance tracker
- [x] Remnant aging / discount badges
- [x] Supervisor audit filters (specialist / location / discrepancies)
- [x] Deduplicated supervisor roster + default-PIN customization prompt / Change PIN modal
- [x] Offline sync queue / retry when connectivity returns
- [x] Service worker for full offline shell caching
- [x] Multi-store `store_number` context (client filter + schema; RLS-ready)
- [x] Manager markdown workflow from 60+ remnant badge
- [x] Multi-category flooring + SIMS location tags (schema + types)
- [x] Scan-to-Catalog Quick-Add modal (unlinked barcode → Save & Continue Audit)
- [x] Dual audit engine: roll CLF vs carton / unit sq ft
- [x] SIMS Location Finder drawer (SKU / barcode / tag → staged locations)
- [x] Mid-scan audit draft in localStorage for dead-zone resilience
- [x] Sheet Vinyl as roll-goods category (Mode A) with 12ft / 15ft width pickers
- [x] Dual scan trigger (Enter + rapid burst) with SKU auto-focus
- [x] `APP_LAYOUT_MAP.md` — current shell / views / modals / UX friction blueprint
- [x] Handheld layout pass: bottom nav, scan-first audit, SIMS from Audit, prompt/confirm overlays
- [x] Remove redundant header hamburger / NavDrawer (bottom tabs only)
- [x] Focus persistence helper + form clear after log / Quick-Add cancel
- [x] Live CLF | SQFT | SQYD badge; undo-last-audit toast; Web Audio success / Quick-Add chimes
- [x] Appliances Inventory & SIMS Audit tab (unit counts + appliance categories)
- [x] Catalog category folder browse (folders / drill-down / flat toggle / search override)
- [x] DeptSync rebrand + multi-department badge / PWA icons
- [x] Department-scoped RBAC (Master Admin / Supervisor / Associate) + nav filter
- [x] Supervisor first-login username/password customization modal
- [x] Master Admin Team & Department Roster Manager (add / reset / edit / delete)
- [x] Full Lowe's department list + generic department audit workspace
- [x] Audit Report Exporter & Printable Email Engine (print / mailto+share / clipboard)
- [x] Soft keyboard tap-to-type + global hardware barcode scanner (no focus on tab switch)
- [x] Zero-Access Authentication Wall (login / setup / PIN unlock / 8h idle lock)
- [x] Soft-delete roster deactivation (`is_active`) — no revive after Master Admin delete
- [x] Biometric WebAuthn login + OS password-manager autocomplete on AuthWall
- [x] Store Operations schema (departments / profiles / store_locations / weekly_rotations + RLS)
- [x] Super Admin Store Map bulk generator (`/admin/store-map`)
- [x] Weekly rotation engine API (`/api/rotations/generate` + cycle reset)
- [x] Zebra supervisor rotation dashboard (`/dashboard`)
- [x] Navigation Hub — role-aware hamburger, ops bottom tabs, Super Admin quick actions
- [x] Web Push subscriptions + dispatch on weekly rotation generate
- [x] Automated weekly rotation cron (`/api/cron/weekly-rotation` + `weekly_bay_target`)

## Next
- [ ] JWT / claim-based RLS enforcing `store_number` (+ department) server-side
- [ ] Wire Supabase Auth sessions into `profiles` (replace header-based store-ops actor bridge)
- [ ] Link push `user_id` to Supabase Auth profiles (retire specialist_id bridge when ready)
- [ ] Background Sync API / periodic queue flush while tab backgrounded
- [ ] Conflict resolution UI when offline edits collide
- [ ] Retire or wire orphan `MarryBarcodeModal`
- [ ] Department-specific catalog category taxonomies beyond flooring/appliances
## Non-goals
- Pricing / margin engines
- Replenishment recommendations
