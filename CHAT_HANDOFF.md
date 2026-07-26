# Carpet Hub — Chat Handoff

## Product
Mobile Carpet Management Hub with PWA install, specialist stamping, CLF variance, and remnant aging.

## PWA
- `app/manifest.ts` — name "Carpet Hub — Flooring Dept", short "Carpet Hub", standalone, theme `#022c22`
- Icons in `public/icons/`
- iOS: `appleWebApp` + apple-touch-icon in `app/layout.tsx`

## Specialists
- Table `store_specialists`
- Header badge opens picker; active name saved in localStorage
- Audits: `audited_by`; Remnants: `logged_by`

## Variance
`variance_clf = calculated_clf - system_clf`
- Match: |v| ≤ 2
- Shortage: v < −2 (red)
- Overage: v > 2 (amber)

## Remnant aging
Days from `created_at`: New &lt;30 · Promote 30+ · Clearance 60+

## Schema
Re-apply `supabase/schema.sql` for new columns + `store_specialists`.

## Verify
```bash
npm run typecheck
npm run build
```
