# Carpet Hub — Chat Handoff

## Product
Mobile Carpet Management Hub with PWA install, specialist stamping, CLF variance, and remnant aging.

## PWA
- `app/manifest.ts` — name "Carpet Hub — Flooring Dept", short "Carpet Hub", standalone, theme `#022c22`
- Icons in `public/icons/`
- iOS: `appleWebApp` + apple-touch-icon in `app/layout.tsx`

## Specialists & PIN
- Default roster: **Department Supervisor** only (PIN `1234`); Alex/Dave placeholders removed.
- Roles: Associate (instant switch) vs Supervisor (PIN keypad required).
- Any profile with `pin_code` also requires PIN.
- Discrepancies filter: supervisor session **or** one-time PIN unlock.
- Settings → Change Supervisor PIN (when supervisor is active).

## PWA
- `app/manifest.ts` — name "Carpet Hub — Flooring Dept", short "Carpet Hub", standalone, theme `#022c22`
- Icons in `public/icons/`
- iOS: `appleWebApp` + apple-touch-icon in `app/layout.tsx`
