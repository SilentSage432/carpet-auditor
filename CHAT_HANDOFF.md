# Carpet Hub — Chat Handoff

## Product
Mobile Carpet Management Hub with PWA install, specialist stamping, CLF variance, and remnant aging.

## Specialists & PIN
- Default roster: **Department Supervisor** only (PIN `1234`); Alex/Dave placeholders removed.
- `dedupeRoster()` ensures a single Supervisor / "Department Supervisor" card (local + Supabase + UI).
- Roles: Associate (instant switch) vs Supervisor (PIN keypad required).
- Any profile with `pin_code` also requires PIN.
- Login with default PIN `1234` → security banner (Set New PIN / Remind Me Later).
- Change PIN: header ⚙️, Settings, or banner → Current / New / Confirm → updates `store_specialists.pin_code`.
- Discrepancies filter: supervisor session **or** one-time PIN unlock.

## PWA
- `app/manifest.ts` — name "Carpet Hub — Flooring Dept", short "Carpet Hub", standalone, theme `#022c22`
- Icons in `public/icons/`
- iOS: `appleWebApp` + apple-touch-icon in `app/layout.tsx`
