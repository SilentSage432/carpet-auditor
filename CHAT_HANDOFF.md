# Carpet Cycle Count Auditor — Chat Handoff

## Product
Mobile-first carpet cycle count tool. Operators enter SKU + carpet name/style, measure core-to-outer edge (inches + fraction pad), enter wrap rounds (with +5/+10/+20 chips), and log calculated linear feet (CLF). Form auto-resets to 0 after each successful log.

## Stack
- Next.js App Router, Client Components
- Tailwind CSS v4
- `@supabase/supabase-js` → `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- Offline: `localStorage` key `carpet_audits_offline`

## Formula
```
CLF = Total Inches × Rounds × 0.2625
Total Inches = whole_inches + measurement_fraction
```

## Supabase columns (`carpet_audits`)
`sku`, `carpet_name`, `location_type`, `measurement_inches` (whole), `measurement_fraction`, `rounds`, `calculated_clf`, `created_at`

## Key paths
- `app/page.tsx` — auditor UI
- `lib/calc.ts` — CLF + formula display
- `lib/storage.ts` — fetch / save / delete / CSV + offline
- `supabase/schema.sql` — table + RLS

## UI shell
Mobile column: `max-w-md mx-auto px-4 py-6`. Dark slate + emerald accents. Rounds stepper uses `shrink-0` ± and `min-w-0 flex-1` input to prevent card overflow.

## Verify
```bash
npm run typecheck
npm run build
```

## Setup
1. `.env.local` from `.env.example`
2. Run `supabase/schema.sql` (or migration comments if upgrading older schema)
3. `npm run dev`
