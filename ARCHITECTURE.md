# Architecture — Carpet Cycle Count Auditor

```
app/page.tsx          → presentation (entry, summary, shift log)
lib/calc.ts           → owns CLF math + formula breakdown strings
lib/storage.ts        → composes remote + local persistence + CSV
lib/supabase.ts       → Supabase client factory
lib/types.ts          → CarpetAudit domain model
supabase/schema.sql   → authoritative table shape
```

## Domain columns

| Field | Meaning |
|---|---|
| `sku` | Item number |
| `carpet_name` | Style / product name (notes) |
| `location_type` | `sales_floor` \| `top_stock` |
| `measurement_inches` | Whole-inch portion |
| `measurement_fraction` | Fraction pad (0–0.875) |
| `rounds` | Wrap count |
| `calculated_clf` | `(inches + fraction) × rounds × 0.2625` |

## Data flow

1. Operator enters SKU, carpet name, location, inches + fraction, rounds.
2. `lib/calc.ts` computes total inches and CLF on every change; UI shows formula card.
3. **Log Roll & Reset** → `saveAudit()` inserts to Supabase (or localStorage), appends feed, resets form to 0.
4. Summary cards count today’s Floor vs Top Stock; cumulative CLF spans all loaded rows.
5. Copy / CSV export operate on the shift (today) set.

## Offline policy

- Read: merge remote rows with local `offline: true` rows not yet present remotely.
- Write: always keep a local copy; mark `offline` when remote write fails.
- No automatic retry queue yet (see roadmap).
