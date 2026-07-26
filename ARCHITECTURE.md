# Carpet Hub — Architecture

```
app/page.tsx                      → Hub shell (section state + data load)
components/hub/HubChrome.tsx      → Sticky header + slide-over drawer
components/sections/*             → Presentation per workspace section
components/ui/NumberField.tsx     → Focus-select + leading-zero sanitize inputs
lib/calc.ts                       → CLF + remnant sq ft / sq yd
lib/number-input.ts               → Numeric string sanitizers
lib/catalog.ts                    → carpet_catalog persistence
lib/remnants.ts                   → carpet_remnants persistence
lib/storage.ts                    → carpet_audits persistence
lib/supabase.ts                   → Client factory
supabase/schema.sql               → Audits + catalog + remnants tables
```

## Ownership

| Concern | Owner |
|---|---|
| Navigation / section routing | `app/page.tsx` + `HubChrome` |
| CLF math | `lib/calc.ts` |
| Number typing UX | `lib/number-input.ts` + `NumberField` |
| Catalog knowledge | `lib/catalog.ts` |
| Remnant inventory | `lib/remnants.ts` |
| Audit log | `lib/storage.ts` |

## Sections

1. **Cycle Audit** — roll CLF logging, catalog auto-fill, compact shift log
2. **Carpet Catalog** — wall SKU master list
3. **Remnant Rack** — back-room remnant status hub
4. **Settings & Sync** — Supabase + localStorage status

## Offline

Each domain falls back to its own `localStorage` key when Supabase is missing or unreachable.
