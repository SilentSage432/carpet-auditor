# Carpet Hub — Chat Handoff

## Product
Mobile Carpet Management Hub with PWA install, offline shell + sync queue, multi-store isolation, specialist PIN, CLF variance, remnant aging, and manager markdown.

## Offline & PWA
- Service worker: `public/sw.js` (registered in `app/layout.tsx` via `ServiceWorkerRegister`)
- Static: cache-first · Navigations: network-first with shell fallback · Supabase/API: network-only
- Sync queue key: `carpet_hub_sync_queue` (`lib/sync-queue.ts`) — auto-flush on `window` `online`
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
