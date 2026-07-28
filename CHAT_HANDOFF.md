# Flooring Hub — Chat Handoff

## Product
Universal Flooring & SIMS Location Audit Hub — multi-category flooring goods, rapid barcode scan-to-catalog, dual roll/carton audit engine, SIMS location finder, PWA offline shell + sync queue, multi-store isolation, specialist PIN, CLF/sqft variance, remnant aging, and manager markdown.

## Navigation & handheld chrome
- Primary: fixed bottom tabs (Audit / Catalog / Remnants / Appliances / Settings) — exclusive section navigation
- Header: Flooring Hub · store · network on the left; specialist badge + PIN gear on the right (no hamburger/drawer)
- Cycle Audit first viewport is scan-first: collapsed shift summary bar; sticky Log & Reset docked above bottom nav
- Appliances workspace: unit-count audit with SIMS staging chips; sticky Log Appliance & Reset
- Audit form includes 📍 SIMS Stock → opens SimsLocationFinder without leaving Audit

## Scan-to-Catalog
- SKU / UPC search resolves via `lib/barcode.ts` → `carpet_catalog`
- Dual trigger: Enter key **or** rapid ≥8-digit burst (≤150ms gaps → 250ms debounce)
- SKU field auto-focuses on audit load / after reset / after modal & drawer close (`lib/focus-input.ts`)
- Match → auto-fill name, category, SIMS tag, specs + success double-beep + focus measure/count
- Unlinked / not found → soft-pop + `QuickAddCatalogModal` (⚡ Quick-Add) → Save & Continue Audit
- Cancel Quick-Add clears stale scan string and re-focuses SKU
- **Catalog browse:** folder cards by category (`lib/catalog-folders.ts`); search/scan overrides folders; 📂/📋 view toggle

## Dual audit engine
- Mode A (Carpet / Sheet Vinyl): inches × rounds × 0.2625 = CLF; live badge also shows SQFT (CLF × 12|15) and SQYD (SQFT / 9)
- Mode B (Vinyl Plank, Tile & Stone, Hardwood, Grout & Mortar, Accessories): cartons × sqft/box
- Mode · Units (Appliances tab): unit count + appliance category + SIMS staging; Model # stored on catalog `vendor`
- Roll width chips: **12 ft / 15 ft** (default 12)

## Post-log UX
- Log Roll & Reset clears all form fields and re-focuses SKU for the next scan
- Floating 6s undo toast removes the just-logged audit from Supabase/local state in one tap

## SIMS Location Finder
- Reachable from Catalog CTA **and** Audit 📍 SIMS Stock
- Search SKU / barcode / SIMS tag; aggregates via `lib/sims.ts`

## Overlays (no native prompt/confirm)
- `TextPromptModal` — remnant reservation customer name; catalog barcode link
- `ConfirmModal` — remnant delete confirmation
- Existing: Specialist, PIN keypad, Change PIN, Quick-Add, SIMS Finder, Markdown

## Offline & PWA
- Service worker: `public/sw.js` (registered in `app/layout.tsx` via `ServiceWorkerRegister`)
- Static: cache-first · Navigations: network-first with shell fallback · Supabase/API: network-only
- Sync queue key: `carpet_hub_sync_queue` (`lib/sync-queue.ts`) — auto-flush on `window` `online`
- Audit draft key: `carpet_hub_audit_draft` — mid-scan form survives refresh / dead zones
- Header badge: Online / Offline Mode + pending count

## Multi-store
- Active store: `lib/store.ts` (default `1234` → display `Lowe's #1234`)
- Settings → Store number / location selector; persists + reloads scoped data
- All fetches/saves include `store_number`; unique indexes `(store_number, sku)` / `(store_number, name)`

## Specialists & PIN
- Default roster: **Department Supervisor** (PIN `1234`) per store
- `dedupeRoster()`; default-PIN notice (sits above bottom nav); Change PIN modal

## Remnants / markdown
- Aging badges; 60+ or Supervisor → **Apply Manager Markdown**
- Fields: `estimated_value`, `markdown_*`; clearance badge on card

## PWA manifest
- `app/manifest.ts` — standalone, theme `#022c22`; icons in `public/icons/`
