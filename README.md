# Carpet Roll Auditor

Mobile-first carpet roll auditing tool. Measure inches (with a fraction pad), enter wrap rounds, and log **Calculated Linear Feet (CLF)**.

```
CLF = Measurement (Inches) × Rounds × 0.2625
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

Apply `supabase/schema.sql` in the Supabase SQL editor to create the `carpet_audits` table.

Without Supabase env vars, entries still save offline in the browser.

## Docs

- [DEVELOPMENT_JOURNAL.md](./DEVELOPMENT_JOURNAL.md)
- [CHAT_HANDOFF.md](./CHAT_HANDOFF.md)
- [MASTER_ROADMAP.md](./MASTER_ROADMAP.md)
