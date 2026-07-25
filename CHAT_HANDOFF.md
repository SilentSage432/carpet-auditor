# Carpet Roll Auditor — Chat Handoff

## Product
Standalone mobile-first carpet roll auditing tool for floor associates. Operators measure core-to-outer edge in inches (with fraction pad), enter wrap rounds, and log calculated linear feet (CLF).

## Stack
- Next.js (App Router), Client Components for the auditor page
- Tailwind CSS v4
- `@supabase/supabase-js` → `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- Offline: `localStorage` key `carpet_audits_offline`

## Formula
```
CLF = Measurement (Inches) × Rounds × 0.2625
```

## Key paths
- `app/page.tsx` — full auditor UI
- `lib/calc.ts` — CLF + fraction helpers
- `lib/storage.ts` — fetch / save / delete with offline fallback
- `supabase/schema.sql` — table + RLS policies

## Setup for next agent
1. Copy `.env.example` → `.env.local` and set Supabase URL + anon key.
2. Run `supabase/schema.sql` in the Supabase SQL editor.
3. `npm install && npm run dev`
4. Without env vars, the app still works fully offline via localStorage.

## Current state
Initial build complete. No auth layer. Anon insert/select/delete enabled for floor-speed logging.
