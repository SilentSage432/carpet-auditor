# Carpet Hub — Chat Handoff

## Product
**Carpet Management Hub** — mobile drawer workspaces: Cycle Audit, Catalog, Remnant Rack, Settings.

## Barcode / scanner workflow
- Catalog rows support nullable indexed `upc_barcode`.
- Lookup matches **SKU or UPC** (`findCatalogBySkuOrBarcode` / `resolveScan`).
- Scans strip leading zeros; Enter (scanner suffix) commits resolution.
- Match → success chime + emerald flash + fill Item #, name, roll width.
- Unlinked 10–14 digit UPC → **Marry Barcode** modal (link existing or create new).

## Formula
`CLF = (whole + fraction) × rounds × 0.2625`

## Supabase tables
- `carpet_audits`
- `carpet_catalog` (+ `upc_barcode`)
- `carpet_remnants`

Apply `supabase/schema.sql` (includes `add column if not exists upc_barcode`).

## Key paths
- `lib/barcode.ts` — sanitize + resolve
- `components/barcode/MarryBarcodeModal.tsx`
- `components/sections/CycleAuditSection.tsx`
- `components/sections/CatalogSection.tsx`

## Verify
```bash
npm run typecheck
npm run build
```
