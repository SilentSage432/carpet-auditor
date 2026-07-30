# DeptSync Hub — Chat Handoff

## Product
DeptSync Hub — department-scoped inventory & SIMS audit platform for Lowe's store teams. Multi-category flooring + appliances, barcode scan-to-catalog, dual roll/carton audit engine, SIMS location finder, PWA offline shell + sync queue, multi-store isolation, department-scoped RBAC, specialist PIN / password, CLF/sqft variance, remnant aging, and manager markdown.

## Branding
- App: **DeptSync Hub** · PWA short_name **DeptSync**
- Eyebrow: `DeptSync · Lowe's #{store} · Inventory & SIMS Audit`
- Header badge: `DeptSyncBadge` (stacked boxes + barcode, emerald/amber on dark)
- Icons: `public/icons/icon-192.png`, `icon-512.png`, `apple-touch-icon.png`

## RBAC (`lib/rbac.ts` + `lib/specialists.ts`)
| Role | Scope | Tabs |
|------|-------|------|
| 👑 Master Admin | `assigned_department: all` | Flooring Audit · Appliances · Universal Catalog · Remnants · Master Settings |
| 🛡️ Department Supervisor | e.g. Amber → `appliances`, Dave → `plumbing` | Dept audit/catalog/profile (flooring also gets Remnants) |
| 👤 Floor Associate | inherits / assigned dept | Same as department supervisor for that dept |

### Master Admin roster console
- Settings → **👥 Team & Department Roster Manager** (Master Admin only)
- Add supervisor/associate with department, username suggest, temp password, first-login reset flag
- Reset credentials / Edit scope / Delete; shareable issued-login card after create/reset

### Departments
`flooring` · `appliances` · `plumbing` · `electrical` · `lawn_garden` · `paint` · `millwork` · `building_materials` · `hardware` · `all`

- Seeds: Master Admin (`master_admin` / `1234`), Flooring Supervisor (`1234`), Amber appliances (`amber_appliance` / `ChangeMe123`, `must_change_credentials: true`)
- First-login: non-dismissible `FirstLoginCredentialsModal` when `must_change_credentials`
- Password unlock when secret is non-numeric or username is set (`PinKeypadModal` mode)

## Navigation & handheld chrome
- Primary: fixed bottom tabs — **filtered by role/department**
- Header: DeptSync badge + eyebrow · section title · network; specialist chip + PIN gear
- Cycle Audit / Appliances: scan-first; sticky Log docked above bottom nav

## Scan-to-Catalog
- SKU / UPC resolve via `lib/barcode.ts` → `carpet_catalog`
- Dual trigger: Enter **or** rapid ≥8-digit burst
- Quick-Add modal for unlinked barcodes
- Catalog folders (`lib/catalog-folders.ts`); domain-filtered for department supervisors

## Dual audit engine
- Mode A (Carpet / Sheet Vinyl): CLF; Mode B: cartons × sqft/box
- Appliances: unit count + SIMS staging; Model # on catalog `vendor`

## Offline & PWA
- Service worker `public/sw.js`; sync queue `carpet_hub_sync_queue`
- Header: Online / Offline Mode + pending count

## Multi-store
- `lib/store.ts` (default `1234`); **store switch = Master Admin only** (Settings)

## Remnants / markdown
- Aging badges; 60+ or elevated role → Apply Manager Markdown
