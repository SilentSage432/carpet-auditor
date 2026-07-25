# Carpet Roll Auditor — Master Roadmap

## Done
- [x] Scaffold Next.js App Router + Tailwind v4
- [x] CLF calculation engine (`× 0.2625`)
- [x] Mobile roll entry: SKU, location, fraction pad, rounds stepper
- [x] Live CLF banner + session summary + copy
- [x] Audit history feed with delete
- [x] Supabase persistence + localStorage offline fallback
- [x] Measurement visual aid accordion
- [x] Schema SQL + env example + project docs

## Next
- [ ] Optional sync queue that retries offline rows when connectivity returns
- [ ] Shift / associate ID for multi-person stores
- [ ] Export CSV of day’s audits
- [ ] Tighten Supabase RLS (store-scoped keys or authenticated role)
- [ ] PWA install + large-display / landscape layout for back-office review

## Non-goals (for now)
- Inventory replenishment recommendations
- Pricing or margin math
- Multi-warehouse routing
