# DeptSync Hub

Mobile-first **DeptSync Hub** — department-scoped inventory & SIMS audits (flooring, appliances, catalog, remnants) with role-based workspace access.

```
CLF = Total Inches × Rounds × 0.2625
Remnant sq yd = (Width × Length) / 9
```

## Stack

- Next.js App Router (Client Components)
- Tailwind CSS v4
- Supabase + localStorage offline fallback

## Setup

```bash
cp .env.example .env.local
# set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY

npm install
npm run dev
```

Apply `supabase/schema.sql` (creates `carpet_audits`, `carpet_catalog`, `carpet_remnants`).

## Scripts

```bash
npm run typecheck
npm run build
npm run lint
```

## Docs

- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [CHAT_HANDOFF.md](./CHAT_HANDOFF.md)
- [DEVELOPMENT_JOURNAL.md](./DEVELOPMENT_JOURNAL.md)
- [MASTER_ROADMAP.md](./MASTER_ROADMAP.md)
