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
# Required: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
# SUPABASE_SERVICE_ROLE_KEY, HUB_MASTER_PIN (unique; no default), CRON_SECRET
# Recommended: HUB_GATE_SECRET. Optional: Gemini, VAPID, Twilio — see .env.example

npm install
npm run dev
```

Apply Supabase migrations under `supabase/migrations/` (and baseline `supabase/schema.sql` as needed). Master Admin recovery: secret-authenticated `POST /api/auth/bootstrap-admin` or `node --env-file=.env.local scripts/bootstrap-admin.mjs` (requires `HUB_MASTER_PIN`).

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
