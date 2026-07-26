# Flooring Hub — Master Roadmap

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

## Next
- [ ] JWT / claim-based RLS enforcing `store_number` server-side
- [ ] Background Sync API / periodic queue flush while tab backgrounded
- [ ] Conflict resolution UI when offline edits collide
- [ ] Vinyl roll as explicit category (separate from Vinyl Plank cartons)

## Non-goals
- Pricing / margin engines
- Replenishment recommendations
