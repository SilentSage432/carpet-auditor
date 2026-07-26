# Flooring Hub — Architecture

```
app/page.tsx                      → Hub shell (section state + data load + online flush)
app/layout.tsx                    → Fonts, PWA meta, ServiceWorkerRegister
public/sw.js                      → Offline shell cache strategies
components/hub/HubChrome.tsx      → Sticky header (network badge) + slide-over drawer
components/hub/*Modal.tsx         → Specialist / PIN / Markdown modals
components/barcode/QuickAddCatalogModal.tsx → Scan-to-catalog Quick-Add
components/catalog/SimsLocationFinder.tsx   → SIMS location stock drawer
components/sections/*             → Presentation per workspace section
lib/store.ts                      → Active store_number session
lib/sync-queue.ts                 → Offline action queue + replay
lib/network.ts                    → Online/offline badge state
lib/sims.ts                       → SIMS location aggregation (compose only)
lib/markdown.ts                   → Clearance price math + badge label
lib/calc.ts                       → CLF + carton sq ft + remnant sq ft / sq yd
lib/catalog.ts / remnants.ts / storage.ts / specialists.ts → Domain persistence
lib/supabase.ts                   → Client factory
supabase/schema.sql               → Tables + multi-category + SIMS + store_number + RLS
```

## Ownership

| Concern | Owner |
|---|---|
| Navigation / section routing | `app/page.tsx` + `HubChrome` |
| Store context | `lib/store.ts` |
| Offline sync queue | `lib/sync-queue.ts` |
| Shell caching | `public/sw.js` + `ServiceWorkerRegister` |
| CLF / carton math | `lib/calc.ts` |
| Number typing UX | `lib/number-input.ts` + `NumberField` |
| Catalog knowledge | `lib/catalog.ts` |
| Barcode resolve / Quick-Add | `lib/barcode.ts`, `QuickAddCatalogModal` |
| SIMS location stock | `lib/sims.ts`, `SimsLocationFinder` |
| Specialists session | `lib/specialists.ts`, `SpecialistModal` |
| PIN change / default notice | `ChangePinModal`, `DefaultPinNotice` |
| Manager markdown | `lib/markdown.ts`, `ApplyMarkdownModal` |
| Variance | `lib/variance.ts` |
| Remnant aging | `lib/aging.ts` |
| Remnant inventory | `lib/remnants.ts` |
| Audit log + draft | `lib/storage.ts` |

## Sections

1. **Cycle Audit** — dual engine (roll CLF vs carton sq ft), scan-to-catalog, SIMS tags
2. **SIMS Catalog** — master SKU list + Location Finder drawer
3. **Remnant Rack** — back-room remnant status + manager markdown
4. **Settings & Sync** — store selector, queue, Supabase + localStorage status

## Dual audit modes

- **Mode A (Carpet)** — inches + fraction + rounds → CLF (`× 0.2625`)
- **Mode B (LVP / Tile / Grout / Accessories / Hardwood)** — box count × sq ft per box

## Offline

Writes fall back to localStorage and enqueue into `carpet_hub_sync_queue`.
Mid-scan form drafts persist via `carpet_hub_audit_draft`.
On `online`, `flushSyncQueue()` replays pending actions for the active store.
The service worker caches the app shell for instant cold starts without connectivity.

## Schema note

Tables retain `carpet_*` names (alias: flooring_audits / SIMS catalog) for migration
compatibility. New columns: `category`, `sims_location` / `default_sims_location`,
`box_count`, `calculated_sqft`, `sqft_per_box`.
