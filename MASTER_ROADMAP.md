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

## Next
- [ ] JWT / claim-based RLS enforcing `store_number` (+ department) server-side
- [ ] Background Sync API / periodic queue flush while tab backgrounded
- [ ] Conflict resolution UI when offline edits collide
- [ ] Retire or wire orphan `MarryBarcodeModal`
## Non-goals
- Pricing / margin engines
- Replenishment recommendations
