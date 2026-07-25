## 2026-07-25 — Visual / mobile layout polish

### Changes
- Outer shell: `max-w-md mx-auto w-full px-4 py-6` phone-app column on desktop.
- Rounds stepper: `flex w-full gap-2.5` with `shrink-0` ± buttons and `min-w-0 flex-1` input (no overflow past card).
- Measurement header: inline flex with emerald `8.50"` badge (no stacked overlap).
- Fraction pad `grid-cols-4` / chips `grid-cols-3`, `min-h-[44px]`; inputs `text-base`/`text-lg` for iOS zoom.
- Palette: slate-950 body, slate-900/90 cards, emerald accents for CLF / active location / CTA; formula card gradient + glow border.

---

## 2026-07-25 — Cycle count form defaults & schema alignment

### Changes
- All measurement inputs default to **0** (whole inches, fraction `0"`, rounds).
- Added **Carpet Name / Style** under SKU; SKU field shows barcode indicator.
- Rounds quick chips: **+5 / +10 / +20**; stepper allows 0 until submit.
- Submit button **Log Roll & Reset** clears form to defaults after save.
- Live formula card: `8.50" × 23 rounds × 0.2625 = 51.32 CLF`.
- Summary bar: Floor vs Top Stock roll counts + cumulative CLF; Copy Shift Summary + Export CSV.
- Measurement accordion includes SVG diagram.
- Supabase columns aligned: `sku`, `carpet_name`, `location_type`, `measurement_inches`, `measurement_fraction`, `rounds`, `calculated_clf`.
- Added `npm run typecheck`.

### Ownership (unchanged)
| Concern | Owner |
|---|---|
| CLF math | `lib/calc.ts` |
| Persistence | `lib/storage.ts` |
| Presentation | `app/page.tsx` |
| Schema | `supabase/schema.sql` |

---

## 2026-07-25 — Initial standalone auditor

### What shipped
- Next.js App Router + Tailwind CSS v4 mobile-first carpet roll auditor.
- Core formula: `CLF = measurement_inches × rounds × 0.2625`.
- Fraction quick-pad (0" through 7/8") with live decimal + CLF banner.
- Location segmented control: Sales Floor / Top Stock.
- Supabase `carpet_audits` persistence via `@supabase/supabase-js`.
- Offline fallback: failed or unconfigured network writes land in `localStorage` (`carpet_audits_offline`).
- Session summary panel with copy-to-clipboard.
- Audit feed (reverse chronological) with per-row delete.
- Collapsible measurement visual aid.

### Ownership
| Concern | Owner |
|---|---|
| CLF math | `lib/calc.ts` |
| Persistence (remote + offline) | `lib/storage.ts` |
| Supabase client | `lib/supabase.ts` |
| Domain types | `lib/types.ts` |
| Presentation / entry UX | `app/page.tsx` |
| Schema | `supabase/schema.sql` |

### Notes
- Touch targets intentionally ≥ 48px for ladder/floor one-handed use.
- Dark slate theme chosen for warehouse glare / night-shift readability.
- Anon RLS policies in schema are permissive for a floor tool; tighten before multi-store production.
