# DeptSync Hub — Development Journal

## 2026-07-30 — DeptSync rebrand + department-scoped RBAC

### Shipped
- Rebranded to **DeptSync Hub** (manifest short_name `DeptSync`, layout meta, header eyebrow `DeptSync · Lowe's #… · Inventory & SIMS Audit`).
- New multi-department scanner/shield badge (`DeptSyncBadge`) + refreshed PWA icons (emerald boxes + amber barcode).
- Role schema: `MasterAdmin` | `Supervisor` | `Associate` with `assigned_department`, `username`, `must_change_credentials` on `store_specialists` (local + Supabase schema).
- `lib/rbac.ts` owns section visibility; Hub bottom nav filters tabs (Master Admin = all 5; Appliances Supervisor = Appliances / Catalog / Profile).
- First-login non-dismissible credential modal for supervisors on default credentials (`amber_appliance` / `ChangeMe123`).
- Catalog domain filter for department supervisors; store number change restricted to Master Admin.

---

## 2026-07-27 — Catalog category folder browse

### Shipped
- Catalog default view is category folder cards (icon, SKU count, SIMS bay preview); appliances roll up under 🔌 Appliances.
- Drill-down with ← Categories back badge + “+ Add [Category] Item”; search/scan bypasses folders and lists matches across all categories.
- 📂 / 📋 toggle next to search switches Folders vs flat master list; item cards extracted to `CatalogItemCard`.

---

## 2026-07-27 — Appliances Inventory & SIMS Audit workspace

### Shipped
- New hub tab **🔌 Appliances** (`HubSection: appliances`) in bottom nav + `HUB_SECTIONS`.
- `ApplianceAuditSection`: scan-to-catalog, appliance categories, SIMS staging chips, unit stepper, sticky Log Appliance & Reset (reuses `carpet_audits` / `carpet_catalog`).
- `APPLIANCE_CATEGORIES` + `CatalogCategory` union; Quick-Add `domain="appliances"`; Catalog / SIMS Finder search by appliance category & staging tags.

---

## 2026-07-27 — Handheld focus, 12/15 ft rolls, undo + live area

### Shipped
- `lib/focus-input.ts` — `focusAndSelect` (rAF + 100ms) restores SKU soft keyboard after modal close, reset, log, and drawer dismiss.
- Roll width presets: **12 ft / 15 ft** (default 12); legacy 6 ft remapped via `normalizeRollWidthFt`. Catalog edit saves `roll_width_ft` to Supabase.
- Log Roll & Reset / Quick-Add cancel fully clear SKU + measure fields (no sticky zeros); undo toast (6s) deletes last audit in one tap.
- Live roll badge: CLF | SQFT | SQYD from CLF × width; success double-beep + Quick-Add soft-pop via Web Audio.

---

## 2026-07-26 — Remove redundant header hamburger / NavDrawer

### Shipped
- Section switching is bottom-nav only; removed hamburger button, `NavDrawer`, and `menuOpen` state from header / page shell.
- Header now: Flooring Hub · store · network (left) + specialist badge · PIN gear (right).

---

## 2026-07-26 — Handheld layout pass (bottom nav + scan-first audit)

### Shipped
- Fixed PWA bottom nav (Audit / Catalog / Remnants / Settings) with emerald active glow; hamburger drawer retained as fallback.
- Cycle Audit: collapsible 1-line shift summary (default collapsed); sticky Log & Reset bar above bottom nav; in-form 📍 SIMS Stock opens SimsLocationFinder without leaving Audit.
- Replaced `window.prompt` / `window.confirm` with `TextPromptModal` (barcode link, remnant reserve) and `ConfirmModal` (remnant delete).
- Main column `pb-32` / audit `pb-44`; body `overflow-x: hidden`; touch targets stay at `h-12`.

---

## 2026-07-26 — APP_LAYOUT_MAP blueprint

### Shipped
- Added root `APP_LAYOUT_MAP.md`: shell/header, four workspace views, modal inventory, scan-path UX friction analysis for layout evaluation.

---

## 2026-07-26 — Dual scan trigger + auto-focus SKU

### Shipped
- SKU / barcode field auto-focuses on audit mount and after form reset.
- Enter on SKU always `preventDefault` + `handleSkuLookup` (fixed prior blur-without-lookup bug).
- Rapid digit burst (≥8 digits, ≤150ms gaps) auto-looks up after 250ms quiet — works when scanner omits Enter.
- Unmatched scans open ⚡ Quick-Add with barcode pre-filled.

---

## 2026-07-26 — Sheet Vinyl as Mode A roll goods

### Shipped
- Added `Sheet Vinyl` to `FLOORING_CATEGORIES`; `isRollGoodsCategory` treats Carpet + Sheet Vinyl as Mode A.
- 6ft / 12ft roll-width pickers on Audit, Quick-Add, Catalog, and Remnant forms.
- Remnant Rack form now includes Category dropdown (catalog auto-fill).

---

## 2026-07-26 — Universal Flooring & SIMS Audit Hub

### Shipped
- Multi-category schema/types: `category`, `sims_location` / `default_sims_location`, `box_count`, `calculated_sqft`, `sqft_per_box` on `carpet_*` tables (flooring_audits alias).
- Scan-to-Catalog: match auto-fills + chime + focus measure/count; unlinked UPC opens ⚡ Quick-Add modal → writes `carpet_catalog` and continues audit.
- Dual audit engine: Mode A Carpet CLF; Mode B carton/unit sq ft (`cartons × sqft_per_box`).
- SIMS Location Finder drawer in Catalog (`lib/sims.ts` aggregates audits + catalog defaults).
- Mid-scan draft (`carpet_hub_audit_draft`) + existing offline sync queue for dead zones.
- Hub copy / PWA manifest → Flooring Hub — SIMS Audit.

### Ownership
| Concern | Owner |
|---|---|
| Categories / audit mode | `lib/types.ts` |
| Carton math | `lib/calc.ts` |
| Quick-Add | `QuickAddCatalogModal` |
| SIMS locations | `lib/sims.ts`, `SimsLocationFinder` |
| Audit draft | `lib/storage.ts` |

---

## 2026-07-25 — Never query Supabase with fallback profile IDs

### Shipped
- PIN save resolves Supervisor by name/role when `id` is not a UUID; inserts without `id` when missing; only `.eq('id', …)` with real UUIDs (avoids 22P02).
- Load sync prefers DB Supervisor UUID + `pin_code` over seed/fallback session ids.

---

## 2026-07-25 — Supervisor PIN upsert + friendly errors

### Shipped
- PIN save upserts Supervisor into `store_specialists` when ID is a seed/fallback or update hits zero rows; persists real UUID + pin to session.
- Error copy uses Profile/Supervisor (not "specialist"); success toast "✅ Supervisor PIN updated successfully!"; dismisses change modal + default-PIN banner.

---

## 2026-07-25 — Fix PIN persistence across reloads

### Shipped
- `updateSpecialistPin` now updates Supabase by specialist `id` (resolves seed IDs via name), throws on failure (modal stays open).
- On success: immediately writes `carpet_active_specialist` + React state with new `pin_code`.
- On load: `syncActiveSpecialistFromRoster` merges DB roster into active session; dismisses default-PIN banner when `pin_code !== 1234`.

---

## 2026-07-25 — Offline sync, SW shell, multi-store, manager markdown

### Shipped
- `public/sw.js` + `ServiceWorkerRegister`: cache-first static shell, network-first HTML, network-only APIs.
- `lib/sync-queue.ts` (`carpet_hub_sync_queue`): enqueue offline writes; auto-replay on `online` with green sync toast.
- Header network badge: 🟢 Online / 🟠 Offline Mode (+ pending queue count).
- Store context (`lib/store.ts`): Lowe's # selector in Settings; `store_number` on all entities + Supabase `.eq` filters.
- Manager markdown: 60+ / Supervisor-gated modal (%, fixed $); clearance badge on remnant cards.
- Schema: `store_number`, markdown columns, per-store unique indexes.

---

## 2026-07-25 — Deduplicate supervisors + default PIN customization

### Shipped
- `dedupeRoster()` merges duplicate Supervisor / "Department Supervisor" cards (local + remote + UI).
- After login with default PIN `1234`, show security banner: Set New PIN / Remind Me Later.
- `ChangePinModal`: Current PIN + New 4-digit + Confirm; saves to Supabase/`pin_code`.
- Header ⚙️ Change PIN + Settings shortcut; green toast on success.

---

## 2026-07-25 — Supervisor PIN security & roster cleanup

### Shipped
- Removed Alex/Dave placeholder seeds; default roster is **Department Supervisor** (PIN `1234`) or a clean team the store registers.
- Role badges: 🛡️ Department Supervisor / 👤 Associate.
- PIN keypad for Supervisor (or any profile with `pin_code`); incorrect PIN shakes + stays on current user.
- Discrepancies-only filter gated behind supervisor session or PIN unlock.
- Settings: **Change Supervisor PIN** (verify current → set new).
- Add Team Member: name, role, optional/required PIN.

---

## 2026-07-25 — PWA, specialists, variance & remnant aging

### Shipped
- PWA manifest (`Carpet Hub — Flooring Dept`, standalone, theme `#022c22`) + iOS web-app meta/icons.
- Active specialist badge + Select Specialist modal (`store_specialists`); stamps `audited_by` / `logged_by`.
- System On-Hand CLF → variance (Physical − System) with match / shortage / overage badges (±2 CLF tolerance).
- Remnant aging badges (0–29 / 30+ / 60+) + Logged by display.
- Supervisor audit filters: specialist, location, discrepancies only.

### Ownership
| Concern | Owner |
|---|---|
| PWA manifest | `app/manifest.ts`, `app/layout.tsx` |
| Specialists | `lib/specialists.ts`, `SpecialistModal` |
| Variance math | `lib/variance.ts` |
| Remnant aging | `lib/aging.ts` |

---

## 2026-07-25 — Handheld barcode + Marry Barcode workflow

### Shipped
- `carpet_catalog.upc_barcode` (nullable, indexed) + local/offline support.
- Scanner-friendly inputs: strip leading zeros, Enter commit, rapid-key heuristic.
- Smart resolve: SKU/UPC match → chime + flash + auto-fill; unlinked vendor barcode → Marry modal.
- Marry modal: link existing catalog row or create new Item # with UPC attached.
- Catalog cards show **Barcode Linked** badge; link / unlink / edit UPC.

### Ownership
| Concern | Owner |
|---|---|
| Scan sanitize / resolve | `lib/barcode.ts` |
| Success chime | `lib/scan-feedback.ts` |
| Marry UI | `components/barcode/MarryBarcodeModal.tsx` |
| Catalog persistence | `lib/catalog.ts` |

---

## 2026-07-25 — Carpet Management Hub overhaul

### Shipped
- Multi-section **Carpet Hub** with sticky header + translucent slide-over drawer (Audit / Catalog / Remnants / Settings).
- Fixed sticky leading-zero typing via string-based `NumberField` + sanitizers + focus-select.
- Cycle Audit: catalog SKU auto-fill, **+ Save to Catalog**, shift log capped at 5 with Show All.
- Catalog Manager: search, add/edit/remove wall SKUs (vendor + roll width).
- Remnant Rack: status filters, W×L → sq ft / sq yd, reserve/sold/edit/delete.
- Settings: Supabase config/ping + localStorage cache counts.
- Schema expanded: `carpet_catalog`, `carpet_remnants`.

### Ownership
| Concern | Owner |
|---|---|
| Hub navigation | `app/page.tsx`, `components/hub/HubChrome.tsx` |
| Number UX | `lib/number-input.ts`, `components/ui/NumberField.tsx` |
| Catalog | `lib/catalog.ts` |
| Remnants | `lib/remnants.ts` |
| Audits | `lib/storage.ts` |

---

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
