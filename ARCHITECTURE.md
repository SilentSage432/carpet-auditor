# Architecture — Carpet Roll Auditor

```
app/page.tsx          → presentation (entry form, summary, feed)
lib/calc.ts           → owns CLF math + fraction display
lib/storage.ts        → composes remote + local persistence
lib/supabase.ts       → Supabase client factory
lib/types.ts          → CarpetAudit domain model
supabase/schema.sql   → authoritative table shape
```

## Data flow

1. Operator enters SKU, location, inches + fraction, rounds.
2. `lib/calc.ts` computes `measurement_inches` and `clf` on every change.
3. **Log Roll** → `saveAudit()` tries Supabase insert; on failure or missing config, writes to `localStorage`.
4. Feed renders reverse-chronological audits; delete removes local row and attempts remote delete.

## Offline policy

- Read: merge remote rows with local `offline: true` rows not yet present remotely.
- Write: always keep a local copy; mark `offline` when remote write fails.
- No automatic retry queue yet (see roadmap).
