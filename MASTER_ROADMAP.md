# Carpet Roll Auditor — Master Roadmap

## Done
- [x] Scaffold Next.js App Router + Tailwind v4
- [x] CLF calculation engine (`× 0.2625`)
- [x] Mobile roll entry: SKU, carpet name, location, fraction pad, rounds stepper + quick chips
- [x] Zero defaults + auto-reset on Log Roll & Reset
- [x] Live formula breakdown card
- [x] Summary: Floor vs Top Stock counts + cumulative CLF; Copy + CSV export
- [x] Audit history feed with delete + SVG measurement guide
- [x] Supabase column alignment + localStorage offline fallback
- [x] `npm run typecheck` + build verification

## Next
- [ ] Optional sync queue that retries offline rows when connectivity returns
- [ ] Shift / associate ID for multi-person stores
- [ ] Tighten Supabase RLS (store-scoped keys or authenticated role)
- [ ] PWA install + large-display / landscape layout for back-office review
- [ ] Hardware barcode scanner focus/auto-advance on SKU field

## Non-goals (for now)
- Inventory replenishment recommendations
- Pricing or margin math
- Multi-warehouse routing
