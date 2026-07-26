# Flooring Hub — Chat Handoff

## Product
Universal Flooring & SIMS Location Audit Hub — multi-category flooring goods, rapid barcode scan-to-catalog, dual roll/carton audit engine, SIMS location finder, PWA offline shell + sync queue, multi-store isolation, specialist PIN, CLF/sqft variance, remnant aging, and manager markdown.

## Scan-to-Catalog
- SKU / UPC search resolves via `lib/barcode.ts` → `carpet_catalog`
- Match → auto-fill name, category, SIMS tag, specs + success chime + focus measure/count
- Unlinked barcode → `QuickAddCatalogModal` (⚡ Quick-Add to SIMS Catalog) → Save & Continue Audit

## Dual audit engine
- Mode A (Carpet): inches × rounds × 0.2625 = CLF
- Mode B (Vinyl Plank, Tile & Stone, Hardwood, Grout & Mortar, Accessories): cartons × sqft/box

## SIMS Location Finder
- Catalog section drawer; search SKU / barcode / SIMS tag
- Aggregates audit stock by location (Sales Floor vs Top Stock) via `lib/sims.ts`

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
- `dedupeRoster()`; default-PIN notice; Change PIN modal

## Remnants / markdown
- Aging badges; 60+ or Supervisor → **Apply Manager Markdown**
- Fields: `estimated_value`, `markdown_*`; clearance badge on card

## PWA manifest
- `app/manifest.ts` — standalone, theme `#022c22`; icons in `public/icons/`
