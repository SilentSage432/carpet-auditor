# Carpet Cycle Count Auditor

Mobile-first carpet cycle count tool. Measure inches (fraction pad), enter wrap rounds, log **Calculated Linear Feet (CLF)**, then auto-reset for the next roll.

```
CLF = Total Inches × Rounds × 0.2625
```

## Stack

- Next.js App Router (Client Components)
- Tailwind CSS v4
- Supabase (`@supabase/supabase-js`)
- Offline fallback via `localStorage`

## Setup

```bash
cp .env.example .env.local
# set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY

npm install
npm run dev
```

Apply `supabase/schema.sql` in the Supabase SQL editor.

Without Supabase env vars, entries still save offline in the browser.

## Scripts

```bash
npm run typecheck
npm run build
npm run lint
```

## Docs

- [DEVELOPMENT_JOURNAL.md](./DEVELOPMENT_JOURNAL.md)
- [CHAT_HANDOFF.md](./CHAT_HANDOFF.md)
- [MASTER_ROADMAP.md](./MASTER_ROADMAP.md)
- [ARCHITECTURE.md](./ARCHITECTURE.md)
