# Carpet Hub — Chat Handoff

## Product
**Carpet Management Hub** — mobile-first store tool with four workspaces behind a hamburger drawer:

1. Cycle Audit (CLF roll auditor + catalog lookup)
2. Carpet Catalog (wall SKU master)
3. Remnant Rack (back-room inventory)
4. Settings & Sync

## Number input fix
Fields use string state + `NumberField` / sanitizers so typing `22` into a `0` field does not become `022`. Focus selects all; empty string allowed while typing.

## Formula
`CLF = (whole + fraction) × rounds × 0.2625`

## Supabase tables
- `carpet_audits`
- `carpet_catalog` (unique `sku`)
- `carpet_remnants`

Apply `supabase/schema.sql`.

## Key paths
- `app/page.tsx` — hub shell
- `components/sections/CycleAuditSection.tsx`
- `components/sections/CatalogSection.tsx`
- `components/sections/RemnantSection.tsx`
- `components/sections/SettingsSection.tsx`

## Verify
```bash
npm run typecheck
npm run build
```
