# DeptSync

**DeptSync** is a sovereign personal operational intelligence system for one Department Supervisor responsible for **Flooring** and **Home Decor**.

It reduces operational and administrative friction while supporting departmental awareness, continuous maintenance, collaborative leadership, and historical continuity.

- **One authenticated operator** — the Department Supervisor  
- **Team members are operational records**, not application users  
- **Deterministic rotation intelligence** remains independently functional  
- **Not** SaaS, a multi-supervisor platform, an employee-facing app, a performance-scoring system, or an AI-dependent engine  

Governing law: [`DEPTSYNC_CONSTITUTION.md`](./DEPTSYNC_CONSTITUTION.md) (ALIGN-002 ratified).  
Implementation state: [`DEPT_SYNC_STATE.md`](./DEPT_SYNC_STATE.md) — distinguish **implemented reality** from **approved target architecture**.

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
# SUPABASE_SERVICE_ROLE_KEY, HUB_MASTER_PIN, HUB_GATE_SECRET, CRON_SECRET
# HTTP bootstrap recovery: BOOTSTRAP_SECRET (do not reuse CRON_SECRET)
# Optional: Gemini, VAPID, Twilio — see .env.example

npm install
npm run dev
```

Apply Supabase migrations under `supabase/migrations/` (and baseline `supabase/schema.sql` as needed). Master Admin recovery: `POST /api/auth/bootstrap-admin` with Bearer `BOOTSTRAP_SECRET`, or `node --env-file=.env.local scripts/bootstrap-admin.mjs` (requires `HUB_MASTER_PIN`).

## Scripts

```bash
npm run typecheck
npm run build
npm run lint
```

## Docs

- [DEPTSYNC_CONSTITUTION.md](./DEPTSYNC_CONSTITUTION.md) — governing product & architecture laws
- [DEPT_SYNC_STATE.md](./DEPT_SYNC_STATE.md) — current implementation truth (+ ALIGN-002 target blocks)
- [docs/product/DEPTSYNC_ALIGN_002_CONSTITUTIONAL_RATIFICATION.md](./docs/product/DEPTSYNC_ALIGN_002_CONSTITUTIONAL_RATIFICATION.md) — ALIGN-002 ratification & topology investigation
- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [CHAT_HANDOFF.md](./CHAT_HANDOFF.md)
- [DEVELOPMENT_JOURNAL.md](./DEVELOPMENT_JOURNAL.md)
- [MASTER_ROADMAP.md](./MASTER_ROADMAP.md)
