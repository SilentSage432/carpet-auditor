# HANDHELD-UX-001 — Appearance & Floor Experience Archaeology

> **Mode:** Read-only product + implementation archaeology.  
> **Date:** 2026-09-18  
> **Baseline:** `main` @ `d47c280` (`feat: move manual coverage priority to Map`).  
> **Runtime:** unchanged. No theme, density, contrast, sound, haptic, motion, Wake Lock, or operational UI mutation.  
> **PRIORITY-UX-002:** not modified. Initial field signal from the user: *“ok that is much better”* — not treated as full Samsung script completion.

This tranche asks whether DeptSync already has a coherent **handheld experience system**, and what can be expanded without changing operational meaning.

Canonical principle under test:

> Personalization may change how DeptSync feels.  
> It may not change what DeptSync means.

> Theme changes personality.  
> Semantic state preserves meaning.

---

## 1. Repository baseline

| Check | Result |
|-------|--------|
| HEAD | `d47c2806176884808f2a582509f7dd863a2c17ec` |
| Branch | `main` = HEAD = `origin/main` |
| Expected commit | `d47c280 feat: move manual coverage priority to Map` |
| Worktree | Clean except existing untracked `tmp/` |
| STOP | None. Reduced shell Floor / Map / Roster / More intact. Preferences do not write operational tables. |

No production inspection. No schema. No RLS.

External platform sources used only for Wake Lock / Vibration:

- [MDN Screen Wake Lock API](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API)
- [Chrome Developers — Stay awake with the Screen Wake Lock API](https://developer.chrome.com/docs/capabilities/web-apis/wake-lock)
- [W3C Screen Wake Lock](https://w3c.github.io/screen-wake-lock/)
- [MDN `Navigator.vibrate()`](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/vibrate)

---

## 2. Executive finding

**DeptSync already has the foundation of a handheld experience system — not a pile of unrelated toggles.** One catalog (`lib/theme.ts`), one document apply path (`data-theme` / `data-contrast` / `data-density`), one React mirror (`UserPreferencesProvider`), one playback owner (`lib/ui/feedback.ts`), one drawer (`UserPreferencesDrawer`).

It is **coherent enough to add a purple theme safely as personality**, if the new accent stays off the operational palettes that the UI currently hardcodes (emerald Covered / On now, amber This week / High / Called out, rose Needs attention / destructive, sky Seasonal).

It is **not** yet a complete semantic-token system. Operational meaning mostly lives in Tailwind color literals (`text-emerald-400`, `text-amber-400`, `text-rose-400`, hex fills in Map sparklines). Theme tokens `--success` / `--warning` / `--danger` exist and are **already collided** inside two palettes:

- **Industrial Emerald:** `--accent` and `--success` are both `#34d399`.
- **Amber Precision** (dormant picker): `--accent` and `--warning` are both `#fbbf24`.

Those collisions are why a new theme must not reuse emerald/amber/rose as its primary accent, and why **Industrial Emerald is the least semantically safe current theme** even before purple is added.

Density is a real but **partial** shell shrink, not a global typography/touch-target system. Compact currently *reduces* hit areas below the 48px comfortable default — the opposite of floor/glove needs.

Sound and haptics **are wired** into the reduced product (Floor ownership, Walk the Floor, verification, Sunday assign, plus a global tap listener). Drawer copy is slightly understated: taps also chime/vibrate, not only scans/clears/alerts.

Wake Lock is **not implemented** and **is technically viable** as an opt-in on Samsung Chrome / installed Android PWA (HTTPS, visible document, reacquire on `visibilitychange`).

**Smallest coherent HANDHELD-UX-002:** add **one** complete dark purple theme (Royal Amethyst) using the existing token block + picker list, keep semantic hardcoded states as they are, do not invent a settings platform. Optional same-tranche extras only if still tiny: Wake Lock opt-in, and/or expanding `prefers-reduced-motion` coverage. Do not ship a second purple, Floor/Glove, Large Text slider, or auto system light/dark in 002.

---

## 3. Current Handheld Experience architecture

```text
app/layout.tsx
  THEME_BOOT_SCRIPT (blocking, pre-hydration)
  <html data-theme data-contrast data-density>
  ThemeProvider (= UserPreferencesProvider)
    HapticsListener          (global pointerdown tap)
    UserPreferencesHost      (single drawer)
    Toaster / banners / children

lib/theme.ts                 catalog + localStorage + applyDocumentTheme
app/globals.css              [data-theme] tokens + @theme inline Tailwind bridge
                             [data-contrast=high] + [data-density=compact]
lib/ui/feedback.ts           Web Audio tones + navigator.vibrate
utils/haptics.ts             alias → feedback.ts
lib/scan-feedback.ts         scan aliases → feedback.ts
```

Layering is honest:

| Layer | Owner | Job |
|-------|--------|-----|
| Persistence | `lib/theme.ts` | `deptsync_theme_prefs` in `localStorage` |
| Document | `applyDocumentTheme` + boot script | HTML attributes + `color-scheme` + `theme-color` meta |
| CSS | `app/globals.css` | Personality tokens |
| React | `UserPreferencesProvider` | Drawer state only (`useUserPreferences` has **one** consumer) |
| Playback | `lib/ui/feedback.ts` | Sound/haptics gated by the same prefs blob |
| Chrome | Header menu + More Device & Account | Launchers, not a second settings model |

This is a system. Expanding it means adding a token block and a picker row — not a new architecture.

---

## 4. Current preference inventory

| Preference | Mounted? | Working? | Scope | Persistence | Runtime consumer | Default | Operational effect? | Future disposition |
|------------|----------|----------|-------|-------------|------------------|---------|---------------------|--------------------|
| Theme (Cyber-Dark / Midnight Sapphire / Industrial Emerald / Solar Daylight) | Yes | Yes | Device | `localStorage` `deptsync_theme_prefs.theme` | `data-theme` → CSS tokens, chrome, glass, nav accent, primary buttons | `midnight` | **No** (personality) | Keep; add at most one purple in 002 |
| Amber Precision | **No** (legacy apply if stored) | Yes if stored | Device | same key | same | n/a | No | Leave dormant; do not re-promote (accent=warning) |
| Obsidian OLED | **No** (legacy apply if stored) | Yes if stored | Device | same key | same | n/a | No | Leave dormant unless a true black OLED demand appears |
| Display density Comfortable / Compact | Yes | **Partial** | Device | `compactDensity` | `[data-density=compact]` on `.hub-main`, selected buttons, `.theme-density-*` (ZebraChecklist only) | Comfortable (`false`) | No | Keep two modes; do not add Floor as a third density |
| High Contrast Mode | Yes | **Partial** | Device | `highContrast` | `--border` → `--border-strong`; thicker glass/nav/chip borders | off | No | Keep single toggle |
| Sound | Yes | Yes | Device | `soundEnabled` | `feedback.ts` tones; `HapticsListener` taps | **on** | No (feedback only) | Keep; do not add volume in 002 |
| Haptics | Yes | Yes on Chrome Android; no-op where `vibrate` missing | Device | `hapticsEnabled` | `navigator.vibrate` via feedback + listener | **on** | No | Keep; do not add intensity in 002 |
| Test Tap / Success / Alert | Yes | Yes (`force: true` bypasses toggles) | Device | none | preview only | n/a | No | Keep |
| Reduced Motion (app) | **No** | OS media query only for header ticker | OS | n/a | `.header-brand-ticker-text` | n/a | No | Prefer OS; do not add a duplicate toggle first |
| Wake Lock | **No** | n/a | — | — | none | — | — | Candidate opt-in |
| Large Text | **No** | System scaling partly blocked (`viewport.maximumScale: 1`) | — | — | — | — | — | Prefer unlock scaling over a slider |
| System light/dark follow | **No** | Explicit theme only | — | — | `colorScheme` set from theme id | — | — | Do not add |
| Glow intensity | **No** | `--glow-accent` exists | — | — | CSS | — | — | Do not add |

Drawer copy **“This device only — store settings stay in Settings.”** is truthful for persistence (see §5–6). More → Device & Account `ThemeSelector` is a second launcher, not a store setting.

Role: **all signed-in roles** can open the drawer from the header user menu (`NavigationHub`). Associates do not get More; they still get the header path. No role restriction inside the drawer.

---

## 5. Persistence map

| Key | Store | Versioning | Default / corruption | Sign-out | Reinstall / cache clear | Cross-tab |
|-----|-------|------------|----------------------|----------|-------------------------|-----------|
| `deptsync_theme_prefs` | `window.localStorage` JSON `{ theme, highContrast, compactDensity, soundEnabled, hapticsEnabled }` | **None** | Invalid JSON or unknown `theme` → `DEFAULT_THEME_PREFS` (`midnight`, contrast/density off, sound/haptics on). Unknown extra keys ignored. | **Not cleared** (`lib/auth-session.ts` signs out Supabase only) | Lost | Same-tab: `deptsync:theme-change` CustomEvent. Other tabs: `storage` event |

Not used for these prefs: IndexedDB, cookies, Supabase, service worker, `profiles`.

Drawer open is React state only (`UserPreferencesHost`). Not persisted.

---

## 6. User / device scope

**Device-global, not user-scoped.** The key is not namespaced by specialist id, store number, or auth user.

Appropriate for a **personal Samsung**: the DS’s look-and-feel survives PIN switch.

On a **shared store device**: the last person’s theme/density/sound/haptics apply to the next person. Not a credential leak. Not a STOP. Do not invent account-scoped prefs in 002.

---

## 7. Theme architecture

1. **Definitions:** `THEME_PRESETS` in `lib/theme.ts` (labels, descriptions, PWA `themeColor`, **preview swatches**) + matching `[data-theme="…"]` blocks in `app/globals.css`.
2. **Mechanism:** HTML `data-theme` attribute + CSS custom properties + Tailwind v4 `@theme inline` mapping `--color-accent` etc. Not inline style objects for the live UI (swatches are inline preview only).
3. **Propagation:** `setTheme` → `writeThemePrefs` → `applyDocumentTheme` → attributes. CSS inherits. Floor/Map/Roster do **not** subscribe to React theme context.
4. **Persist:** `localStorage` as above.
5. **Wrong-theme flash:** Mitigated. Boot script runs in `<head>` before paint. `<html>` defaults to `midnight` matching `DEFAULT_THEME`. `suppressHydrationWarning` on `<html>`.
6. **Before hydration:** Yes, boot script. Boot script does **not** update `meta[name="theme-color"]` (only `applyDocumentTheme` does) — possible brief browser chrome mismatch.
7. **Rerenders:** Theme change updates provider state. Only `UserPreferencesDrawer` consumes the hook, so Floor P0 does not React-rerender for theme. CSS updates are cheap attribute changes.
8. **What tokens affect:** background, surface, border, accent, text, muted, glass/nav/buttons/cards/sheets (`theme-modal` glow), focus ring (`var(--accent)`), washes, `--glow-accent`. **Status colors are tokenized but largely unused by operational components.** Charts/badges/priority/attention mostly hardcoded.
9. **Completeness:** All six defined themes have the same token *keys*. Values differ. `--accent-cyan` is a leftover name (not always cyan).
10. **Component overrides:** Widespread Tailwind zinc/emerald/amber/rose/sky/cyan **bypass** tokens (see §12). BottomNav mix: `bg-zinc-950/88` + `bg-accent/15` active pill.
11. **Adding a theme:** **Declarative / moderately coupled.** Two files normally: `lib/theme.ts` (`THEME_IDS`, `PRIMARY_THEME_IDS`, preset) + `app/globals.css` (copy a dark block, retune accent/washes/glow). No React theme map.
12. **File count:** 2 canonical. Optional: `ARCHITECTURE.md` mention. Preview swatches must be updated in the same preset object or they drift.

---

## 8. Current theme inventory

| Theme | Dark/light | Primary accent | Token complete? | Semantic-safe? | High-contrast compatible? | Density independent? | Hardcoded overrides? | Notes |
|-------|------------|----------------|-----------------|----------------|---------------------------|----------------------|----------------------|-------|
| Cyber-Dark (`midnight`) | Dark | `#7dd3fc` cyan | Yes (same key set) | **Best of the four** — accent ≠ emerald/amber/rose tokens | Yes (token compose) | Yes | Yes, global UI literals remain | Default indoor handheld |
| Midnight Sapphire (`cobalt`) | Dark | `#22d3ee` | Yes | Mostly; `--muted` is `#7dd3fc` (very accent-like) | Yes | Yes | Same | Command-deck blue; muted/accent distinguishability **requires device visual acceptance** |
| Industrial Emerald (`emerald`) | Dark | `#34d399` | Yes | **Weak** — accent = `--success` = Covered/On now green family | Yes | Yes | Same | Do not treat as the model for new themes |
| Solar Daylight (`solar`) | **Light** | `#c2410c` rust | Yes; `--success/#15803d`, `--danger/#b91c1c` retuned darker | Accent distinct from emerald/rose literals; light surfaces vs `bg-zinc-950` cards **requires device visual acceptance** | Yes (stronger borders) | Yes | Dark zinc/emerald-950 chips can look like dark islands on cream | Intended lumber/garden daylight |
| Amber Precision (`amber`) | Dark | `#fbbf24` | Yes | **Unsafe** accent=warning | Yes | Yes | n/a (unmounted) | Dormant picker |
| Obsidian OLED (`obsidian`) | Dark true black | `#e4e4e7` silver | Yes | Accent near foreground; status still emerald/amber/rose | Yes | Yes | n/a | Dormant picker |

Density is independent: `data-density` is orthogonal to `data-theme`.

---

## 9. Theme token completeness

Every `[data-theme]` block defines: `--background --foreground --surface --surface-raised --surface-glass --panel-bg --input-bg --border --border-strong --accent --accent-strong --accent-fg --accent-fg-soft --accent-cyan --success --warning --danger --muted --wash-primary --wash-secondary --wash-void --glow-accent --shadow`.

No missing keys. Stale naming: `--accent-cyan`. Unused-by-components: `--success/--warning/--danger` in most operational UI.

`@theme inline` bridges a subset into Tailwind (`bg-background`, `text-accent`, `text-muted`, `border-border`, …). `text-success` exists as a Tailwind color **if used**; operational screens prefer `text-emerald-400`.

---

## 10. Theme preview architecture

Swatches in `UserPreferencesDrawer` are **`preset.swatch` hex from `THEME_PRESETS`**, applied as `style={{ background }}`. They are **not** read from computed CSS variables.

Drift risk: a CSS token change that does not update `swatch` / `themeColor` shows a lying preview. Future implementation **should** keep swatch fields next to tokens in one catalog, or derive preview from the same source object used to emit CSS (not implemented here).

---

## 11. Semantic-color architecture

Two layers:

**A. Theme tokens** `--success #34d399`, `--warning #fbbf24`, `--danger #f87171` (Solar darker). Intended semantic. Rarely consumed.

**B. Hardcoded operational palettes** (actual meaning on Floor/Map/Roster):

| Meaning | Typical paint | Independent of theme? |
|---------|---------------|------------------------|
| Covered / verified / On now | `text-emerald-400`, Map fill `#34d399` | Yes (literal) — **except** Emerald theme accent is the same green |
| This week / scheduled / Called out / High priority | amber-400/500, `#fbbf24` | Yes as literals; crowded family |
| Needs attention / hotspot / destructive | rose-400/500/600, `#fb7185` / `#f43f5e` | Yes |
| Remaining / idle | zinc-500/600, `#52525b` | Partially; zinc cards ignore Solar cream |
| Seasonal | sky-300/500 | Yes |
| Current Attention marker | zinc or `text-accent` when investigation-emphasized | **Accent-coupled when emphasized** |
| Selected nav / primary button / focus | `--accent` | Personality — correct |
| Offline/sync | mix of amber/emerald/zinc in More Device | Mixed |
| Success toast | Sonner + `toastSuccess` (theme-adjacent) | Needs device check |

Labels still carry words (“Covered”, “High”, “Called out”). Color is not the only channel — but Map glyphs are color+icon without the word on every cell.

---

## 12. Hardcoded-color audit

Not a complete line listing. Classification of **mounted surviving** UI:

| Class | Where | Expansion risk |
|-------|--------|----------------|
| **INTENTIONAL SEMANTIC COLOR** | Map readiness/heatmap hex; High priority amber chip; Seasonal sky chip; Called out amber row; Needs attention rose; Delete/confirm rose-600; Walk intensity emerald/amber/rose | **Keep.** Do not retarget to `--accent`. Purple accent is safe *because* these stay literal. |
| **THEME TOKEN SHOULD OWN** | BottomNav `bg-zinc-950/88`, `border-zinc-700`; many `bg-zinc-950/50` cards; ThemeSelector `border-zinc-700 text-zinc-100`; Settings Device emerald name/PIN chrome | Medium: Solar Daylight looks like a cream page with dark inset cards. New themes inherit the same zinc islands. Not a 002 blocker. |
| **SPECIAL VISUAL EFFECT** | `--glow-accent` on `.theme-modal`, `.btn-primary-glow`, nav active pill; Floor Pad rec pulse; visual bay scan sweep (dormant mount) | Low if glow stays accent-derived |
| **LEGACY / DEAD** | Dormant specialty scan forms still import chimes; VisualBayScannerModal emerald; ShiftBriefingCard heavy emerald glow | Low for reduced everyday path |
| **UNKNOWN** | Mix of `text-slate-*` in More Device sync | Low |

Shell/header/BottomNav: hybrid (zinc chassis + accent selection). Floor ownership: emerald recovery CTAs + zinc rows. Map: strongest semantic hex. Roster: zinc rows + amber call-out. Sheets: `theme-modal` accent border/glow + zinc/rose actions.

---

## 13. Operational-state color risks

| Risk | Evidence | Purple impact |
|------|----------|---------------|
| Emerald theme accent = Covered/On now | `--accent: #34d399` and Map `#34d399` | Existing, not purple |
| Amber family overcrowding | This week + High + Called out + warning all amber | Purple does not worsen if High stays amber |
| Investigation Attention uses `text-accent` | `StoreLocationGrid` emphasized marker | Purple would tint “needs attention” toward personality — **keep marker zinc/rose, not accent** if 002 touches anything |
| Solar vs zinc-950 surfaces | Many cards ignore `--surface` | Light-mode quality; device acceptance |
| Cobalt muted ≈ accent | `--muted: #7dd3fc` | Readability; device acceptance |

A purple **accent** for nav, Done, switches, and glow does **not** by itself make High / Needs attention / destructive indistinguishable, because those are not accent-driven today.

---

## 14. Royal Amethyst feasibility

Desired: near-black charcoal, deep violet surfaces, rich purple accent, controlled highlights, premium not neon.

**Can use current tokens:** Yes. Copy `midnight`/`obsidian` block; set `--background` charcoal, `--surface` deep violet-black, `--accent` rich purple, `--glow-accent` restrained violet. Keep `--success/--warning/--danger` on the current emerald/amber/rose values (or Solar-darker equivalents) so tokens stay semantically aligned even if unused.

**Distinct vs current four:** Yes — none is purple.

**Semantic conflict:** Low if accent ≠ amber/rose/emerald. Avoid magenta that reads as rose attention.

**High contrast:** Compatible (border-strong + thicker chrome).

**Light/dark:** Dark only.

**Token additions:** None required. Optional later: `--accent-cyan` rename.

**Component overrides:** None required for a first ship. Solar-style zinc islands remain.

**Complexity:** Small (2 files + picker).

**Recommend:** **the one purple to ship.**

---

## 15. Ultraviolet feasibility

Desired: near-black, electric violet, selective magenta glow, more cyber.

**Same token path.** Would be visually distinct from Royal Amethyst *if* glow and accent shift toward electric/magenta.

**Risk:** magenta glow vs rose “Needs attention” / High-amber adjacency. More personality, more collision risk.

**Complexity:** Same two files, but **two** purples in a five-theme picker is theme bloat for a quiet coverage instrument.

**Recommend:** **do not ship in 002.** Keep as a later optional if Amethyst is loved and users ask for a louder sibling.

---

## 16. Broader theme-family evaluation

| Candidate | Distinctness | Usefulness | Semantic safety | A11y | Cost | Redundant? |
|-----------|--------------|------------|-----------------|------|------|------------|
| Royal Amethyst | High vs current four | Personality request | Good if accent stays purple | Dark contrast easy | Low | No |
| Ultraviolet | Medium vs Amethyst | Fun | Weaker (magenta/rose) | Glow can reduce contrast | Low | **Yes with Amethyst** |
| Crimson Forge | High | Warm industrial | **Poor** — crimson vs destructive/attention rose | Risky | Low | Avoid |
| Arctic Terminal | Medium vs Cyber-Dark/Cobalt | Cooler cyan | Accents already cyan/blue | OK | Low | **Yes** |
| Copper Industrial | Medium vs Solar rust / Amber | Warm dark | Copper vs warning/High amber | Mixed | Low | Partial |
| Monochrome | High | OLED/focus | Needs non-color channels (already partly labeled) | High contrast overlap | Low–med | Overlaps Obsidian + High Contrast |
| Forest Night | Low vs Industrial Emerald | — | Same green collision | — | Low | **Yes** |

---

## 17. Recommended eventual theme count

**Five mounted, not seven+.**

Current four + Royal Amethyst = **5**. Keep Amber/Obsidian dormant unless OLED evidence appears (Obsidian could replace a sixth later, not both purples).

Goal: genuinely different environments (dark cyan, dark blue, dark green, daylight, dark violet). Not palette spam.

---

## 18. Display-density architecture

`compactDensity` → `data-density="compact"|"comfortable"`.

**Comfortable:** default spacing; buttons/chips often `min-h-12` (48px) in component classes.

**Compact actually changes:**

- `.hub-main` padding (tighter)
- `.btn-quick-touch` / `.chip-filter` → `min-height/width: 2.25rem` (**36px**)
- `.btn-icon-touch` → 2.5rem
- primary/secondary/grid action buttons → `height/min-height: 2.5rem` (**40px**)
- `.theme-density-stack` / `.theme-density-row` — **only used in `ZebraChecklist`**

**Does not globally change:** Floor ownership rows, Map aisle/bay rows (`min-h-[44px]` hardcoded), Roster `min-h-12` rows, More cards, sheet control sizes, BottomNav (`min-h-12` stays), typography (`text-sm` / `text-[10px]` stay).

Compact is **partial shell shrink**, not a true global density. It **worsens** floor targeting.

A third density named Floor that only “makes everything huge” would fight Compact’s CSS. Better model:

```text
Density:     Comfortable | Compact     (information density; Compact stays optional)
Touch:       Standard | Large          (optional later; increases min-height, does not shrink)
```

Do not implement a third density value in 002.

---

## 19. Floor / Glove mode feasibility

Real handheld problem: working while walking, one thumb, gloves, bright floor, reaching past BottomNav into sheets.

Compact is the wrong direction. A Floor/Glove mode that **only** increased padding without touching 36px compact rules would be confused with density.

If built later, it should be **Large touch**: raise `min-h-12` controls and sheet primary actions, increase destructive separation — **not** a new theme, **not** huge type, **not** Map redesign.

**HANDHELD-UX-002:** do not add it. Needs a device pass after Amethyst, with evidence Compact is used on the floor.

---

## 20. High Contrast behavior

Mechanism: `data-contrast="high"` sets `--border: var(--border-strong)` and forces `border-width: 2px` on `.glass-card`, `.glass-panel`, `.theme-bottom-nav`, quiet/accent surfaces, chips, quick-touch.

Does **not** rewrite semantic emerald/rose/amber. Does **not** change type size. Composes with every `data-theme`.

Solar: `--border-strong: #1c1917` — high contrast should actually help daylight cards. Device visual acceptance still required because many cards use `border-zinc-800` **literals**, which **ignore** the token swap.

So: the toggle is a real accessibility preference, but **zinc-bordered components ignore it**. Single toggle remains the right shape.

---

## 21. Sound architecture / event inventory

**Definition:** synthesized Web Audio in `lib/ui/feedback.ts` (no bundled files). Lazy `AudioContext`. Failures swallowed. Prefs via `readThemePrefs()` (not React). `force: true` for Test buttons.

**Autoplay:** first tone calls `ctx.resume()` on user gesture (listener is `pointerdown`). Unlikely to fire on cold load.

Drawer hint: “Chimes for scans, bay clears, and alerts.” **Incomplete.** Global tap chime also fires.

| Event | Surface | Tone | Reduced-product? |
|-------|---------|------|------------------|
| Almost every button/tab/link pointerdown | `HapticsListener` | tap | Yes (global) |
| Walk the Floor log success/error | Map sheet | success/error | Yes |
| Pin-to-week | Map sheet | success/error | Yes (gated) |
| Physical-bay High / aisle Mark-Clear | Map | **toast only** (tap still fires via listener) | Yes (PRIORITY-UX-002) |
| Floor ownership / extra bay / barrier paths | `ThisWeekOwnershipBoard` | success/error | Yes |
| Verify / send-back | `SupervisorAuditSummaryModal` | success/error | Yes |
| Sunday assign / stage actions | `SundayAuditAssignmentModal` | tap/success/error | Yes (Master/DS) |
| Force rotation | More Master | success/error | Advanced |
| Floor Pad extract | Protected | success/error | Protected |
| Offline conflict | `ConflictResolutionModal` | error | Yes |
| Appliance / cycle / department scan | Specialty forms | scan success/error | Dormant everyday |
| Preferences Test | Drawer | all, forced | Yes |

**Keep quiet:** tab switches could be considered noisy (tap on every BottomNav press). Not changed here. Future: maybe tap only on primary commits, not every chrome tap. Needs evidence; do not “fix” in archaeology.

Legitimate subtle sound: save/verify/error. Avoid gamified streaks.

---

## 22. Haptic architecture / event inventory

API: `navigator.vibrate` ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/vibrate)). Sticky user activation required — satisfied by `pointerdown`. Unsupported browsers: no-op. Silent/DND may suppress. **iOS Safari historically does not implement Vibration API** (not Baseline). **Samsung Chrome Android PWA: expected to work.**

Patterns: light `10ms`; success `[20,40,30]`; warning `[50,50,50]`. Preference gates all except Test `force`.

| Event | Pattern |
|-------|---------|
| Global control tap | light + tap tone |
| Walk / High save / ownership success | success |
| Errors / some barriers | warning/medium |
| Offline banner reconnect | success |
| Conflict modal | medium / success |

Future appropriate (not implemented): dedicated success haptic on High toggle (today: toast + global tap only). Verification already has success tones. Destructive confirm is not a special pattern.

Do not add intensity in 002. Subtle confirmation exists.

---

## 23. Motion / reduced-motion

Present: BottomNav `translate3d` active pill; `active:scale-[0.96]`; header brand ticker; `bay-advance-pulse`; `velocity-hotspot-pulse`; Floor Pad rec pulse; pin-shake; `animate-spin` / `animate-pulse` loaders; visual-bay scan (dormant). No confetti, streaks, points, or leaderboards as UX (telemetry “points” are chart data).

`prefers-reduced-motion: reduce` **only** disables the header ticker. Other animations ignore OS.

**Recommend:** OS preference only, **expand the existing media query** to pulses/shakes if 002/003 touches CSS. **Do not add** a parallel in-app Reduced Motion toggle until users cannot use OS settings on the Samsung (no evidence).

---

## 24. Wake Lock feasibility

Not in the repository.

| Constraint | Evidence |
|------------|----------|
| HTTPS | Required (MDN / Chrome) |
| Visible document | Lock released when hidden; reacquire on `visibilitychange` |
| Permission policy | `screen-wake-lock` default `self` |
| May reject | Low battery / power save |
| Chrome Android / PWA | Supported since Chrome 84; MDN Baseline 2025 “newly available” |
| Battery | Screen stays on — must be **opt-in**, default off |
| Failure | `try/catch`, truthful “couldn’t keep screen awake” |

**Viable for Samsung/Android PWA.** Safe as device-local opt-in. Do not promise iOS or older WebViews.

**Recommend:** MAYBE → **RECOMMEND as a later small control**, not blocking Amethyst. Could sit in the same drawer under Device behavior.

---

## 25. One-handed / floor ergonomics

Already in the product: `min-h-12` many controls; bottom sheets with `pb-[max(1rem,env(safe-area-inset-bottom))]`; BottomNav thumb zone; focused-workspace hides nav; destructive confirm is a second tap (Edit Bay, aisle clear confirm).

Gaps: Compact shrinks below 48px; some Map “show more” rows `min-h-10`; zinc-on-zinc contrast; header user menu is top-right (reach). Floor/Glove would help Large touch, not a new operational screen.

No global a11y framework needed.

---

## 26. Text-size / readability

Geist + Geist Mono via `next/font`. Lots of `text-[10px]` / `text-[9px]` / `font-mono` operational chrome.

`viewport.maximumScale: 1` in `app/layout.tsx` **blocks pinch-zoom** and can fight OS text scaling.

DeptSync does **not** need a local Large Text slider first. If readability fails on device, unlock `maximumScale` / respect system font size. A local Standard/Large would duplicate OS and risk breaking the dense Map.

---

## 27. Feedback-personality opportunities

Appropriate: existing success chime + dual haptic; accent glow on primary/modal; quiet High marker (already). Possible later: reduced-motion-safe short pulse on verify.

**Reject:** points, streaks, confetti, leaderboards, addictive loops. **Not present** as product UX.

---

## 28. Performance implications

PERF-LOAD-002 remains the P0 law.

Appearance today:

- Boot script: tiny inline.
- `UserPreferencesHost` + `HapticsListener` always in root layout (not visit-on-demand). Both are small; drawer returns `null` when closed.
- No audio asset download.
- Theme change does not remount Floor.
- All theme CSS is one `globals.css` (already eager).

**Material issue:** none observed that would slow cold Floor vs current HEAD. Adding one theme block is more CSS, negligible.

**Must not:** import Wake Lock polyfills eagerly on Floor; must not load extra font files per theme; must not subscribe Floor to preferences context.

---

## 29. Accessibility implications

- High contrast is incomplete against zinc literals.
- Color-only Map glyphs: icon+color; words on the row (`This week`) mitigate.
- Compact reduces touch targets (WCAG 2.2 24px still met; 48px comfort not).
- `maximumScale: 1` is the largest text-scaling defect.
- Emerald theme: accent vs Covered.
- Focus: CSS uses accent ring — purple would still show focus if tokens used.

Expanding themes is safe if semantic literals stay. Expanding Compact as default would not be.

---

## 30. Current-theme × operational-state matrix

Code-proven vs **requires device visual acceptance**.

| State | Cyber-Dark | Midnight Sapphire | Industrial Emerald | Solar Daylight |
|-------|------------|-------------------|--------------------|----------------|
| Normal/default | Token surfaces | Token surfaces | Token surfaces | Cream tokens; **zinc cards may remain dark islands** (device) |
| Selected/active | `--accent` cyan | `--accent` cyan-blue | `--accent` **same green as Covered** (code) | Rust accent (device vs zinc) |
| Covered | emerald-400 / `#34d399` | same literals | **collides with accent** (code) | same emerald on cream (device) |
| This week | amber literals | same | same | same (device) |
| Needs attention | rose literals | same | same | same (device) |
| Remaining | zinc-500 | same | same | zinc on cream (device) |
| High priority | amber chip | same | same | same (device) |
| Called out | amber row | same | same | same (device) |
| Destructive | rose-600 | same | same | same (device) |
| Offline | mixed amber/emerald More | same | same | same (device) |
| Focus | accent ring | accent; muted also cyan (device) | green ring vs green status (code) | rust ring (device) |

---

## 31. Candidate preference evaluation table

| Candidate | User benefit | Architecture support | Complexity | Operational risk | Recommendation |
|-----------|--------------|----------------------|------------|------------------|----------------|
| Royal Amethyst | Personality | Existing token+picker | Low | Low if accent stays purple | **RECOMMEND** (HANDHELD-UX-002) |
| Ultraviolet | Louder personality | Same | Low | Medium (magenta/rose) | **DO NOT ADD** in 002; maybe later |
| Crimson Forge | Warm dark | Same | Low | High vs destructive | **DO NOT ADD** |
| Arctic Terminal | Cooler deck | Same | Low | Redundant vs midnight/cobalt | **DO NOT ADD** |
| Copper Industrial | Warm dark | Same | Low | Amber/High crowding | **DO NOT ADD** |
| Monochrome | OLED calm | Same / overlaps Obsidian | Low | Color-only states | **DO NOT ADD** now |
| Forest Night | — | Same | Low | Duplicate Emerald | **DO NOT ADD** |
| Floor/Glove mode | Thumb/glove | Would need new CSS axis | Med | If mixed with Compact, confusing | **MAYBE** later, not 002 |
| Reduced Motion (in-app) | A11y | OS already exists | Low | Duplicate | **ALREADY PROVIDED BY PLATFORM**; extend CSS query instead |
| Keep Screen Awake | Floor screen timeout | Wake Lock API; not in repo | Low–med | Battery; must opt-in | **RECOMMEND** as small follow-on or 002-B |
| Large Text | Readability | Viewport currently caps scale | Med | Dense Map | **DO NOT ADD** slider; **MAYBE** unlock zoom |
| Haptic intensity | Fine control | Patterns exist | Low | Noise | **DO NOT ADD** |
| Sound volume | Fine control | peakGain constants | Low | Noise | **DO NOT ADD** |
| Glow intensity | Taste | `--glow-accent` | Low | Contrast | **DO NOT ADD** |
| System theme following | Convenience | Explicit themes today | Low | Surprise light on floor | **DO NOT ADD** |

---

## 32. Other evidence-backed preference opportunities

1. **Unlock `maximumScale`** (or raise it) so Samsung accessibility text/zoom works — higher value than a font slider.
2. **Extend `prefers-reduced-motion`** to pulse/shake/scan animations.
3. **Derive swatches from the same numbers as CSS** to stop preview drift (implementation hygiene in 002 when adding Amethyst).
4. **Optional quieter taps:** stop `HapticsListener` from chiming on every BottomNav press — only if device users call it noisy.

Do not add brightness, font picker, custom CSS, or per-department themes.

---

## 33. Existing dead / dormant preference infrastructure

- `amber` / `obsidian` full CSS + catalog, hidden from `PRIMARY_THEME_IDS`.
- `useTheme` alias; almost unused.
- `ThemeSelector` label still “Appearance & Theme” vs drawer “Appearance & Preferences”.
- Scan chime helpers live in dormant specialty forms.
- `--success/--warning/--danger` underused.
- Compact density classes for `.theme-density-row` nearly unused outside Zebra.

No hidden Wake Lock, no unused Reduced Motion React flag, no abandoned theme context besides the alias.

---

## 34. Risks to expanding personalization

1. Painting High/Attention/destructive with `--accent`.
2. A second purple or crimson theme.
3. Subscribing operational trees to `useUserPreferences` (PERF-LOAD-002).
4. Account-scoping prefs without a product decision on shared devices.
5. Making Compact the floor default.
6. Auto light/dark flipping Solar in a dark aisle.
7. Treating swatch hex as live tokens.

STOP conditions from this mandate **did not fire.** Themes are not so component-specific that one new dark theme requires a UI rewrite. High contrast does not fundamentally fight tokens. Persistence is device-local, not a store/RLS leak. Sound/haptics do not mutate coverage truth. No schema required.

---

## 35. Recommended canonical personalization laws

Record for HANDHELD-UX-002 / Constitution when implementation starts (not enacted as runtime here):

1. **Personalization may change how DeptSync feels. It may not change what DeptSync means.**
2. **Theme changes personality. Semantic state preserves meaning.**
3. **Accent may own navigation, selection, primary buttons, decorative glow, and focus.**
4. **Accent must not own Covered, Needs attention, High priority, Called out, destructive, success-complete, or offline-failure.**
5. **Preferences are device-local until a shared-device policy exists.**
6. **Visual personalization must not regress operational P0 render.**
7. **Fewer meaningful controls beat a settings arcade.**

---

## 36. Recommended HANDHELD-UX-002 scope

Smallest coherent implementation:

1. Add **Royal Amethyst** to `THEME_IDS` / `PRIMARY_THEME_IDS` / `THEME_PRESETS` / `globals.css` with a complete token block.
2. Keep `--success/--warning/--danger` on the existing green/amber/rose family.
3. Keep High/Attention/Seasonal/destructive literals.
4. Sync `swatch` + `themeColor` with the new tokens in the same PR.
5. No Floor/Map/Roster composition change. No schema. No Wake Lock required to call 002 done.

Optional if still tiny after Amethyst lands: Keep Screen Awake opt-in default **off**, with visibility reacquire and truthful failure.

Do **not** include Ultraviolet, Floor/Glove, Large Text, haptic/sound intensity, or system follow in 002.

---

## 37. Items explicitly NOT recommended

Ultraviolet (002), Crimson Forge, Arctic Terminal, Copper Industrial, Forest Night, Monochrome-now, in-app Reduced Motion duplicate, Large Text slider, glow/haptic/sound intensity, auto system theme, gamification, refactoring all hardcoded colors as a prerequisite, UX-REDUCE-006, PERF-LOAD-003.

---

## 38. Tests / validation

No runtime tests added (archaeology). No dedicated theme unit suite exists today; behavior is proven by `lib/theme.ts` parse/apply + CSS.

Validation for this docs tranche:

- `npm run typecheck` — pass
- `npm run build` — pass
- `npm test` — **1255 tests / 89 files** pass
- Secret scan of changed markdown — clean

---

## 39. Git / docs status

Primary artifact: this file.

Living docs updated only to record **HANDHELD-UX-001 complete** and **HANDHELD-UX-002 not started**.

---

## 40. Final assessment

DeptSync **does** have a handheld experience system: one prefs blob, one token document, one drawer, wired sound/haptics, density and contrast as document attributes. It is ready for **one** carefully tokened purple theme without operational meaning changing — because meaning currently lives in **literal semantic colors**, not in the accent.

It is **not** ready for a theme store, a glove-mode product, or a second electric-violet sibling. Compact density is a mild information-density tool and a poor floor-safety tool. Wake Lock is the best *device-behavior* candidate after Amethyst. System text scaling is the best *readability* candidate, via viewport — not a new slider.

**Do not implement HANDHELD-UX-002 in this tranche.**

---

## Direct answers

**A.** Token-driven for chrome/personality (`data-theme` + CSS variables). Operational states are substantially **component-specific literals**. Hybrid, not “themes are fake.”

**B.** Low–moderate: typically **two files** (`lib/theme.ts` + `app/globals.css`). Safe if the new accent avoids emerald/amber/rose semantic palettes.

**C.** **Yes**, if Amethyst uses purple for accent/glow only and leaves High/attention/destructive literals alone.

**D.** **Not enough** to justify both in the reduced product. Ship Amethyst only.

**E.** **Five mounted** (current four + Amethyst). Not a dozen.

**F.** **Separately maintained** `preset.swatch` hex, not computed from live CSS.

**G.** **Token chrome yes; zinc-literal components only partially.** Solar needs device acceptance.

**H.** Comfortable = default. Compact = tighter `.hub-main` padding and **smaller** selected buttons/chips (36–40px), plus ZebraChecklist density rows. Not global type or Floor/Map/Roster rows.

**I.** It would solve **thumb/glove targeting**, not density. It should raise touch targets and destructive spacing, **not** shrink Compact further, **not** restyle operational meaning. Not in 002.

**J.** **Yes.** Global tap listener plus reduced-product success/error on Floor, Map (including High save), verification, Sunday, plus dormant specialty scans.

**K.** Successful save/verify, errors, Walk log. High toggle is currently toast-only (plus global tap). Not every tab switch if users find taps noisy. No celebration.

**L.** **Only the header ticker.** Other motion ignores OS.

**M.** **No** — extend OS `prefers-reduced-motion` first.

**N.** **Yes** for HTTPS Samsung Chrome / Android PWA, with visibility reacquire. Not promised on iOS.

**O.** **Yes as opt-in default off**, preferably after or as a tiny companion to Amethyst — not instead of it.

**P.** **System/browser scaling should remain authoritative.** Consider unlocking `maximumScale`. Do not add Large Text.

**Q.** **Yes, but they mostly protect semantics** (good) and **hurt Solar/high-contrast completeness** (zinc chassis). Expansion of *accent* is still safe.

**R.** Covered/On now emerald, This week/High/Called out amber, Needs attention/destructive rose, Seasonal sky, Map hex fills. **Do not make these `--accent`.**

**S.** **Yes** — `localStorage` only; not Supabase/store settings.

**T.** **Device-global** (all DeptSync users on that browser profile).

**U.** **Unlikely** if 002 only adds CSS tokens and does not hook Floor to React prefs. Must not regress P0.

**V.** Royal Amethyst; optional Keep Screen Awake; optional reduced-motion CSS expansion; optional viewport zoom unlock.

**W.** Ultraviolet-now, extra palettes listed above, Floor/Glove-now, in-app Reduced Motion toggle, Large Text slider, intensity sliders, auto system theme, gamification.

**X.** One complete Royal Amethyst theme in the existing catalog/CSS/picker. Nothing else required.

**Y.** **Yes.** Entirely presentation + `localStorage`. No schema, no production mutation, no RLS.
