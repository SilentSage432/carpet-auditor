# DeptSync Hub — Architecture

```
app/page.tsx                      → Hub shell (section state + RBAC gate + data load + online flush)
app/layout.tsx                    → Fonts, PWA meta (DeptSync), ServiceWorkerRegister
app/manifest.ts                   → short_name DeptSync · Department & SIMS Audit Hub
public/sw.js                      → Offline shell cache strategies
components/hub/HubChrome.tsx      → Sticky header (DeptSync badge + network) + role-filtered bottom nav
components/hub/DeptSyncBadge.tsx  → Multi-department scanner/shield mark
components/hub/FirstLoginCredentialsModal.tsx → Non-dismissible supervisor credential setup
components/hub/*Modal.tsx         → Specialist / PIN / Markdown modals
components/barcode/QuickAddCatalogModal.tsx → Scan-to-catalog Quick-Add
components/catalog/SimsLocationFinder.tsx   → SIMS location stock drawer
components/sections/*             → Presentation per workspace section
lib/rbac.ts                       → Department-scoped section / catalog visibility (compose only)
lib/store.ts                      → Active store_number session
lib/sync-queue.ts                 → Offline action queue + replay
lib/network.ts                    → Online/offline badge state
lib/sims.ts                       → SIMS location aggregation (compose only)
lib/markdown.ts                   → Clearance price math + badge label
lib/calc.ts                       → CLF + carton sq ft + remnant sq ft / sq yd
lib/catalog.ts / remnants.ts / storage.ts / specialists.ts → Domain persistence
lib/supabase.ts                   → Client factory
supabase/schema.sql               → Tables + multi-category + SIMS + store_number + RBAC columns + RLS
```

## Ownership

| Concern | Owner |
|---|---|
| Navigation / section routing | `app/page.tsx` + `HubChrome` |
| Department RBAC / tab visibility | `lib/rbac.ts` |
| Store context | `lib/store.ts` |
| Offline sync queue | `lib/sync-queue.ts` |
| Shell caching | `public/sw.js` + `ServiceWorkerRegister` |
| CLF / carton math | `lib/calc.ts` |
| Number typing UX | `lib/number-input.ts` + `NumberField` |
| Catalog knowledge | `lib/catalog.ts` |
| Barcode resolve / Quick-Add | `lib/barcode.ts`, `NumberField` scan hooks, `QuickAddCatalogModal` |
| SIMS location stock | `lib/sims.ts`, `SimsLocationFinder` |
| Specialists session / credentials | `lib/specialists.ts`, `SpecialistModal`, `FirstLoginCredentialsModal` |
| PIN change / default notice | `ChangePinModal`, `DefaultPinNotice` |
| Manager markdown | `lib/markdown.ts`, `ApplyMarkdownModal` |
| Variance | `lib/variance.ts` |
| Remnant aging | `lib/aging.ts` |
| Remnant inventory | `lib/remnants.ts` |
| Audit log + draft | `lib/storage.ts` |

## Sections (role-filtered)

1. **Flooring Audit** — dual engine (roll CLF vs carton sq ft), scan-to-catalog, SIMS tags
2. **Appliances Audit** — unit counts + appliance SIMS staging
3. **Universal / Appliance Catalog** — master SKU list (domain-scoped) + Location Finder
4. **Remnant Rack** — back-room remnant status + manager markdown
5. **Master / Profile Settings** — store selector (Master Admin), queue, Supabase + localStorage

## Dual audit modes

- **Mode A (Carpet / Sheet Vinyl)** — inches + fraction + rounds → CLF (`× 0.2625`)
- **Mode B (LVP / Tile / Grout / Accessories / Hardwood)** — box count × sq ft per box

## Offline

Writes fall back to localStorage and enqueue into `carpet_hub_sync_queue`.
Mid-scan form drafts persist via `carpet_hub_audit_draft`.
On `online`, `flushSyncQueue()` replays pending actions for the active store.
The service worker caches the app shell for instant cold starts without connectivity.

## Schema note

Tables retain `carpet_*` names (alias: flooring_audits / SIMS catalog) for migration
compatibility. RBAC columns on `store_specialists`: `username`, `assigned_department`,
`must_change_credentials`; roles include `MasterAdmin`.
