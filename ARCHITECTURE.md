# Carpet Hub — Architecture

```
app/page.tsx                      → Hub shell (section state + data load + online flush)
app/layout.tsx                    → Fonts, PWA meta, ServiceWorkerRegister
public/sw.js                      → Offline shell cache strategies
components/hub/HubChrome.tsx      → Sticky header (network badge) + slide-over drawer
components/hub/*Modal.tsx         → Specialist / PIN / Markdown modals
components/sections/*             → Presentation per workspace section
lib/store.ts                      → Active store_number session
lib/sync-queue.ts                 → Offline action queue + replay
lib/network.ts                    → Online/offline badge state
lib/markdown.ts                   → Clearance price math + badge label
lib/calc.ts                       → CLF + remnant sq ft / sq yd
lib/catalog.ts / remnants.ts / storage.ts / specialists.ts → Domain persistence
lib/supabase.ts                   → Client factory
supabase/schema.sql               → Tables + store_number + markdown + RLS
```

## Ownership

| Concern | Owner |
|---|---|
| Navigation / section routing | `app/page.tsx` + `HubChrome` |
| Store context | `lib/store.ts` |
| Offline sync queue | `lib/sync-queue.ts` |
| Shell caching | `public/sw.js` + `ServiceWorkerRegister` |
| CLF math | `lib/calc.ts` |
| Number typing UX | `lib/number-input.ts` + `NumberField` |
| Catalog knowledge | `lib/catalog.ts` |
| Barcode resolve / marry | `lib/barcode.ts`, `MarryBarcodeModal` |
| Specialists session | `lib/specialists.ts`, `SpecialistModal` |
| PIN change / default notice | `ChangePinModal`, `DefaultPinNotice` |
| Manager markdown | `lib/markdown.ts`, `ApplyMarkdownModal` |
| Variance | `lib/variance.ts` |
| Remnant aging | `lib/aging.ts` |
| Remnant inventory | `lib/remnants.ts` |
| Audit log | `lib/storage.ts` |

## Sections

1. **Cycle Audit** — roll CLF logging, catalog auto-fill, compact shift log
2. **Carpet Catalog** — wall SKU master list (per store)
3. **Remnant Rack** — back-room remnant status + manager markdown
4. **Settings & Sync** — store selector, queue, Supabase + localStorage status

## Offline

Writes fall back to localStorage and enqueue into `carpet_hub_sync_queue`.
On `online`, `flushSyncQueue()` replays pending actions for the active store.
The service worker caches the app shell for instant cold starts without connectivity.
