# HANDHELD-UX-002 — Royal Amethyst Theme

> **Mode:** Bounded implementation.  
> **Date:** 2026-09-18  
> **Baseline:** `main` @ `d5a6b24` (`docs: audit handheld appearance and preferences`).  
> **Evidence:** [`HANDHELD_UX_001_APPEARANCE_FLOOR_EXPERIENCE_ARCHAEOLOGY.md`](HANDHELD_UX_001_APPEARANCE_FLOOR_EXPERIENCE_ARCHAEOLOGY.md)

One new mounted handheld theme. No operational meaning change. No schema. No Floor preference subscription. No Ultraviolet, Wake Lock, Floor/Glove, Reduced Motion, or Large Text.

---

## Canonical laws (enacted as product law)

> **Personalization may change how DeptSync feels.  
> It may not change what DeptSync means.**

> **Theme changes personality.  
> Semantic state preserves meaning.**

Royal Amethyst may own accent, selected navigation, primary buttons, decorative glow, theme surfaces, and focus personality.

It must not redefine Covered, This week, Needs attention, Remaining, High priority, Seasonal, Called out, On now, Later today, Schedule unknown, destructive, success, warning, failure, or offline/sync.

---

## 1. Baseline

| Check | Result |
|-------|--------|
| HEAD before change | `d5a6b24` = `origin/main` |
| Branch | `main` |
| Worktree | Clean except untracked `tmp/` |
| STOP | None |

---

## 2. HANDHELD-UX-001 findings acted upon

- Existing system: `lib/theme.ts` + `data-theme` + boot script + drawer. Used as-is.
- Add one theme in two files (`lib/theme.ts`, `app/globals.css`).
- Keep `--success` / `--warning` / `--danger` on `#34d399` / `#fbbf24` / `#f87171`.
- Do not convert Map/Floor/Roster semantic literals to `--accent`.
- Swatches declared beside CSS (same hexes); preview architecture not refactored.
- High Contrast and density remain document attributes.
- Default remains `midnight`.
- Internal id is `amethyst` (single-word, matching `midnight` / `cobalt` / `emerald` / `solar`). Label is **Royal Amethyst**.
- Industrial Emerald accent=success collision recorded as **future debt**, not repaired.

---

## 3. Design intent

Dark, premium, restrained, unmistakably purple. Charcoal chassis with a violet cast. Rich amethyst accent for chrome. Not neon, not magenta, not a recolor of Emerald.

---

## 4. Exact palette

Internal id: `amethyst`  
`color-scheme`: dark  
PWA `themeColor` / swatch void: `#0a0712`

| Token | Value | Role |
|-------|-------|------|
| `--background` | `#0a0712` | Near-black charcoal chassis |
| `--foreground` | `#f4f1f8` | High-readability off-white |
| `--surface` | `#15101c` | Violet-black panels |
| `--surface-raised` | `#22182f` | Elevated violet-black |
| `--surface-glass` | `rgb(21 16 28 / 0.84)` | Glass cards |
| `--panel-bg` | `rgb(21 16 28 / 0.94)` | Header/panel |
| `--input-bg` | `rgb(10 7 18 / 0.86)` | Inputs |
| `--border` | `#3a2d4e` | Violet-neutral theme border |
| `--border-strong` | `#c4b5fd` | High-contrast / strong edge |
| `--accent` | `#c4b5fd` | Light amethyst (nav, text-accent, focus) |
| `--accent-strong` | `#7c3aed` | Royal violet primary buttons |
| `--accent-fg` | `#f5f3ff` | Text on primary buttons |
| `--accent-fg-soft` | `#ede9fe` | Soft accent-on-wash |
| `--accent-cyan` | `#a78bfa` | Highlight (legacy token name) |
| `--success` | `#34d399` | Semantic — unchanged dark family |
| `--warning` | `#fbbf24` | Semantic — unchanged |
| `--danger` | `#f87171` | Semantic — unchanged |
| `--muted` | `#b0a9c2` | Cool readable muted |
| `--wash-primary` | `rgb(124 58 237 / 0.16)` | Restrained body wash |
| `--wash-secondary` | `rgb(46 16 80 / 0.36)` | Corner wash |
| `--wash-void` | `rgb(10 7 18 / 0.93)` | Void wash |
| `--glow-accent` | `rgb(196 181 253 / 0.38)` | Restrained glow |
| `--shadow` | `rgb(0 0 0 / 0.55)` | Shadow |

Swatches: void `#0a0712` · surface `#15101c` · accent `#c4b5fd` · secondary `#7c3aed` (matches `--accent-strong`).

---

## 5. Catalog changes

`THEME_IDS` appends `"amethyst"`.

`PRIMARY_THEME_IDS`: midnight, cobalt, emerald, **amethyst**, solar.

`THEME_PRESETS` inserts Royal Amethyst after Industrial Emerald and before Solar Daylight so the drawer reads:

1. Cyber-Dark  
2. Midnight Sapphire  
3. Industrial Emerald  
4. Royal Amethyst  
5. Solar Daylight  

Dormant `amber` / `obsidian` remain unmounted.

---

## 6. CSS / token changes

New `[data-theme="amethyst"]` block in `app/globals.css` with the complete token contract. Existing six theme blocks untouched. High-contrast and compact-density rules untouched (they key off `data-contrast` / `data-density`).

---

## 7. Picker / swatches

`UserPreferencesDrawer` already filters `THEME_PRESETS` by `PRIMARY_THEME_IDS`. No drawer interaction change. Five cards. Swatches match CSS hexes.

---

## 8. Existing-theme preservation

Cyber-Dark, Midnight Sapphire, Industrial Emerald, Solar Daylight palettes and labels unchanged. Default `midnight` unchanged. Stored unknown ids still fall back to midnight. `royal-amethyst` is not a valid id (stale hyphenated name would fall back).

---

## 9. Semantic-color preservation

Map readiness fills remain `#34d399` / `#fbbf24` / `#fb7185`. High toggle remains amber. Called out remains `text-amber-200/90`. On now remains emerald. Verification destructive remains rose. Amethyst `--accent` is not those families.

Emphasized Map attention marker still uses `text-accent` when investigation is on (pre-existing HANDHELD-UX-001 risk). This tranche did not retarget it. Purple investigation emphasis **requires device visual acceptance**.

---

## 10–13. Floor / Map / Roster / More

No component edits. Surfaces inherit `data-theme="amethyst"` chrome. Operational classes stay Tailwind semantic literals. Zinc chassis cards remain (known Solar/high-contrast limitation; not refactored).

---

## 14. High Contrast

`data-contrast="high"` still swaps `--border` to `--border-strong` (`#c4b5fd` on Amethyst) and thickens glass/nav/chip borders. Status chips stay emerald/amber/rose. Zinc-literal borders still ignore the token swap (pre-existing).

---

## 15. Density

`data-density` independent. Compact CSS unchanged.

---

## 16. Persistence

Same key `deptsync_theme_prefs`. Device-global. No Supabase/cookies/IndexedDB. Sign-out still does not clear prefs.

---

## 17. Pre-paint

`THEME_BOOT_SCRIPT` serializes `THEME_IDS`, so `amethyst` is in the allowlist. Cold reopen with stored `amethyst` sets `data-theme="amethyst"` before paint. `color-scheme` stays dark (only `solar` is light). Brief `theme-color` meta lag until `applyDocumentTheme` remains pre-existing.

---

## 18. Performance

Static CSS + catalog entry. No images, fonts, fetch, or Floor `useUserPreferences`. PERF-LOAD-002 contracts unchanged.

---

## 19. Accessibility / contrast (focused, not WCAG certification)

Approximate ratios on Amethyst tokens:

| Pair | Intent | Assessment |
|------|--------|------------|
| `#f4f1f8` on `#0a0712` | Primary text / chassis | Strong |
| `#f4f1f8` on `#15101c` | Primary text / surface | Strong |
| `#b0a9c2` on `#0a0712` / `#15101c` | Muted | Readable cool-neutral |
| `#c4b5fd` on `#0a0712` | Accent text / nav | Light violet, not magenta |
| `#f5f3ff` on `#7c3aed` | Primary button | Light on royal violet |
| High Contrast border `#c4b5fd` on chassis | Stronger edges | Visible; zinc literals still bypass |

Store lighting **requires Samsung visual acceptance**.

---

## 20. Tests

`lib/handheld-ux-002.royal-amethyst.test.ts` — catalog, swatches, CSS completeness, existing palettes, persistence, stale fallback, boot allowlist, contrast/density independence, semantic literals, no Floor prefs subscription, no schema/network in `lib/theme.ts`.

---

## 21. Samsung field acceptance

Engineering complete. **Not visually field-accepted.**

1. Appearance & Preferences → five themes; Royal Amethyst purple swatches; select it.
2. Shell: clearly purple, not blue/green; premium/dark not neon/pink.
3. Floor: ownership readable; Covered / This week / Needs attention / High stay semantic.
4. Map: coverage tones distinct; High bay stays amber vs purple accent.
5. Roster: Called out exceptional; availability readable.
6. More + a sheet: inputs, Done, destructive, close control readable.
7. High Contrast on/off; Compact ↔ Comfortable; theme stable.
8. Full close/reopen: Amethyst from first paint, no Cyber-Dark flash.
9. Store lighting: muted text and violet borders readable.

Do not manufacture operational state solely for theme QA.

---

## 22. Remaining HANDHELD candidates (not started)

Strongest after field acceptance: **Keep Screen Awake** (opt-in, device-local Wake Lock) **or** unlock `viewport.maximumScale` for system text scaling. Do **not** start HANDHELD-UX-003 automatically.

Still not recommended: Ultraviolet, extra palettes, Floor/Glove-now, in-app Reduced Motion toggle, intensity sliders, auto system theme.

Industrial Emerald `--accent`=`--success` remains documented debt.

---

## 23. Git / validation

- `npm run typecheck` — pass
- `npm run build` — pass
- `npm test` — **1265 tests / 90 files** pass (from 1255/89; +10 in `lib/handheld-ux-002.royal-amethyst.test.ts`)
- Secret scan of changed files — clean
- No production mutation
- No Vercel claim
- Local authenticated Floor/Map/Roster visual pass was not available in this engineering environment (dev server / login). Samsung plan is the visual gate.
