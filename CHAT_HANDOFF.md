# DeptSync Hub — Chat Handoff

## Latest (2026-09-05)
- **Completion-attempt history LIVE (schema + app):** Table `weekly_rotation_completion_attempts` **production applied**. App wires complete/verify/send-back/auto-verify + history API. Missing-relation skip is table-specific; auto-verify retry recovers from parent stamps; RESTRICT retained. **First natural lifecycle pending** (rotations/attempts currently 0 — do not fabricate). Pre-migration dump `…T17-41-43-893Z.dump` retained.
- **Specialty M2 PRODUCTION VERIFIED:** `20260905_specialty_catalog_remnants_parity.sql` applied live. Hub `carpet_catalog` / `carpet_remnants` recreated (0 rows); PostgREST former 400s → **200 []**. M1 `home_department` already live. Pre-M2 dump `…T15-09-55-089Z.dump` retained with prior dumps. App deploy not required for schema fix. Safe to commit migration + docs when ready.
- **M2 detection strengthened** then applied after gate. Mixed-state fail-closed; full unique `(store_number, sku)` + remnants PK proven.
- **Weekly rotation history (Force Draw):** Incomplete Force Draw / Admin reset **supersedes** `weekly_rotations` (`superseded_at`) instead of hard-delete. Active plan = `superseded_at IS NULL`. Migration `20260905_weekly_rotations_superseded.sql` — **production applied** with app `eb4152d`. Layer-1 metrics still `weekly-rotation-metrics-v1` on active rows only. Assignment-history wipe on restage remains open debt.
- **Layer-1 metrics (A-1):** Canonical owner `lib/store-ops/rotation-metrics.ts` (`weekly-rotation-metrics-v1`). Floor / readiness / store health / weekly rollup / Map week overlay distinguish **reported** vs **verified** (`VERIFIED_COMPLETE` only). No schema changes. Tests: `rotation-metrics.test.ts`. Screenshots/fixtures: `tmp/layer1-metrics-validation/` (do not commit).
- **Constitution:** `DEPTSYNC_CONSTITUTION.md` established (docs-only). Governing laws for operating boundary, human/data/intelligence authority, rotation/verification, UI hierarchy, anti-drift. Baseline `d6d5806`. No app behavior changes.
- **Information hierarchy:** Floor operate-only (Topology demoted to More); verification strip → existing rollup modal; empty week Stage plan; Map navigator before Snap Bay Photo. Screenshots: `tmp/hierarchy-implementation/` (do not commit).
- **Mobile shell scroll:** `.hub-app-shell` = fixed `h-dvh` viewport; keep-alive tabs (`absolute inset-0 overflow-y-auto`) are the scroll owners; `--hub-workspace-pad-bottom` clears the fixed bottom nav. Screenshots: `tmp/mobile-shell-validation/` (do not commit).
- **Two-DS pilot polish:** store identity adopts profile store when hub store unset (`lib/store.ts` + `SessionGate`); Floor readiness line (`composeFloorReadinessLine`); Sunday staged-work / hours→share UX (engine unchanged); remnant live area via `composeRemnantArea`. Ops checklist: `DEPT_SYNC_STATE.md` Appendix D. Screenshots: `tmp/ds-pilot-polish/` (do not commit).

## Product
DeptSync Hub — department-scoped inventory & SIMS audit platform for Lowe's store teams. Multi-category flooring + appliances, barcode scan-to-catalog, dual roll/carton audit engine, SIMS location finder, PWA offline shell + sync queue, multi-store isolation, department-scoped RBAC, specialist PIN / password, CLF/sqft variance, remnant aging, manager markdown, and **Store Operations** (aisle/bay map + automated weekly maintenance rotations).

## Branding
- App: **DeptSync Hub** · PWA short_name **DeptSync**
- Manifest name: `DeptSync — Department & SIMS Audit Hub`
- Layout title: `DeptSync Hub · Department & SIMS Audit` · appleWebApp title `DeptSync`
- Header: brand `DeptSync · #2587` (compact; marquee only if overflow) · section title · **department dropdown pill** · account/PIN
- **Typography:** Geist (`--font-geist-sans` → `font-sans`) + Geist Mono (`--font-geist-mono` → `font-mono`). Bay tags (`formatBayTag`, e.g. `A14-B06`), SKUs, cadence badges, and timestamps use `font-mono tracking-tight`.
- Header badge: `DeptSyncBadge` (floating layers + barcode; boot/PWA uses `branded` cyan/gold so theme FOUC cannot flash emerald)
- Icons: `public/icons/icon-192.png`, `icon-512.png`, `apple-touch-icon.png`, `mark.svg` (cyan/gold floating mark, no enclosed shield)
- PWA manifest: `app/manifest.ts` → `/manifest.webmanifest`; static `public/manifest.json` → `/manifest.json` (TWA / Bubblewrap)
- **Native shell:** haptics via `utils/haptics.ts` + `HapticsListener`; offline toast `OfflineNetworkBanner` + `ConflictResolutionModal`; sync auto-flush on online/visibility/focus; PWA/TWA splash theme `#090d16`; `app/loading.tsx` + `DeptSyncSplash` (pinned midnight + branded mark)
- **Theme engine:** `lib/theme.ts` owns presets + prefs (`deptsync_theme_prefs`). `data-theme` on `<html>`: `midnight` (Cyber-Dark, default) · `cobalt` (Midnight Sapphire) · `emerald` (Industrial Emerald) · `solar` (Solar Daylight) · legacy `amber` / `obsidian`. Toggles: `data-contrast=high`, `data-density=compact`, plus `soundEnabled` / `hapticsEnabled`. Personal UI: header + Settings **Appearance & Theme** (`Palette` → `UserPreferencesDrawer`). Store config stays in Settings. CSS tokens in `app/globals.css`; glass utilities / nav / primary buttons bind to `--accent`, `--background`, `--border`, `--glow-accent`.
- **Audio & haptics:** `lib/ui/feedback.ts` (Web Audio + `navigator.vibrate`). Scan chimes compose via `lib/scan-feedback.ts`; tap pulses via `HapticsListener`.
- **Obsidian-glass UI:** utilities in `app/globals.css` (`.glass-card`, `.glass-panel`, `.theme-accent-surface`, `.theme-nav-active`, `.theme-modal`, `.btn-primary-glow`, `.btn-quick-touch`, `.chip-filter`, `.hub-main`, `.hub-scan-dock`). Canonical Lucide SVG set (`HubIcon` / `NavIcon` stroke 2; variance / aging / bay status pills stroke 1.75 via `StatusPills`).
- **Handheld chrome:** header `pt-safe` + compact `min-h-12` inside shrink-0 chrome; workflow tabs live in a fixed `h-dvh` `.hub-app-shell` — Master/DS: Floor · Map · Roster · Settings; CSA/Specialist: **My Shift** + **Store Map** only. Each keep-alive tab panel (`absolute inset-0 overflow-y-auto`) is the primary vertical scroll owner. Scan Log bars use `ScanActionDock` (`.hub-scan-dock`, `max-w-lg`, stacked on `--hub-bottom-nav-stack` with `env(safe-area-inset-bottom)`). Specialty hub content is `max-w-lg` + `.hub-scan-dock-pad` inside the same viewport shell. Undo toast uses `.hub-toast-dock` so it never covers Log. Sonner stays top-center under the header. No hamburger, More sheet, or Admin Tools drawer. Store Ops pages use `.hub-main` + `--hub-workspace-pad-bottom` so bays / badges / timers clear the fixed dock.
- **Keep-alive tabs:** Floor / Map / Roster / Settings mount in `WorkflowTabShell` (`app/(workflow)/layout.tsx`) so switches are visibility/opacity only (0ms remount). Departments / map / roster use 45s in-memory SWR plus IndexedDB L2 (`lib/store-ops/cache.ts`) so Map/Floor paint the last **successful live** `store_locations` / `weekly_rotations` fetch in <20ms, then revalidate. The header department pin (`useWorkingDepartment`) does **not** wipe IndexedDB; Floor/Map reset React lists on pin change, then peek the target department key. Failed network reads no longer render as an empty week. **Bulk add bays** awaits IndexedDB+TTL clear (`invalidateStoreOpsListCaches`) and dispatches `deptsync:store-locations-changed` so keep-alive Map/Floor replace an empty snapshot immediately. Realtime channels are refcounted per logical name.- **IRP velocity heatmap:** Map toggle `[ Standard Map | Velocity Heatmap ]` plus Snap Bay. Visual Grid is walk-only (`StoreLocationGrid`: aisle accordions with complete/stale counts, Lucide status glyphs, bay tags, Sell/Top, **Pending** chip when rotation status is `PENDING`, tap → `WalkTheFloorSheet`). Bay CRUD lives in Settings **Store Topology & Bay Setup** (`AisleBayManager`: Add Single Bay, Bulk Generator with velocity seed, batch delete, duplicate prune, `EditBayDrawer` hotspot/lock/decay). `GET /api/store-locations` never filters by status; PENDING means available for Sunday draw. Department pin `flooring`/`D23` resolves to the live `departments.id` family before querying locations. Apply `20260814_bay_velocity_heatmap.sql` + `20260815_custom_decay_days.sql` + **`20260817_rls_security_lockdown.sql`** (authenticated store-scoped SELECT on `store_locations`; open anon reads removed).
- **Multi-department access:** `accessible_departments` on roster + profiles. Header switcher when more than one granted dept. Supervisors grant extras from Roster **SpecialistEditSheet** chips. Apply `20260814_multi_department_access.sql`.
- **Daily shift board / call-out:** Roster groups by home department; department accordions start **collapsed**. Compact `SpecialistCard` rows (name, role badge, `07:00 – 15:30`, On-Duty switch, manage). `lib/store-ops/shift-status.ts` writes `associate_shift_days` first (localStorage is cache only). Manage sheet hosts Edit Schedule → `AssociateScheduleModal` (presets Open/Mid/Close, per-day times) plus access chips. Call-out dialog composes `lib/store-ops/call-out.ts` → Sunday pool / proportional redistribute / carry-over loop. Apply `20260815_associate_shift_days.sql` + `20260815_carry_over_priority.sql`. Supervisors + Master toggle duty; Master-only add/delete team.
- **Predictive Shift Copilot:** Floor `ShiftAnalyticsDrawer` (`PredictiveCopilotBanner`). Local patterns from `bay_service_logs` / Sunday assignments / downstock / locations — not Gemini. 1-tap Stage to Shift (`POST /api/rotations/assign`, Supervisor+) or Add to Downstock.
- **Tactical Voice Hub:** Walk & Talk lives in Floor `ShiftAnalyticsDrawer` (`TacticalVoiceFloorPad`). Web Speech + scratchpad → `POST /api/copilot/parse-walk` → dispatch via `lib/store-ops/shift-tasks.ts`. Bay freshness chip `BayFreshnessGrid` composes `lib/heatmap/bay-tracker.ts` from live `store_locations` (not only this week's rotations). `#floor-pad` expands the drawer. Apply `20260815_shift_walk_tasks.sql`.
- **Roster invite:** apply `20260815_unified_auth_token.sql` + `20260815_roster_app_access.sql` + `20260815_roster_auth_link.sql` + `20260815_roster_insert_rls.sql` + **`20260816_roster_floor_title.sql`**. Add Team Member is roster-only (name/role/home department; optional phone for contact / PIN-reset; no Auth user required). Device pairing is **Pair Device via QR** on `SpecialistEditSheet` → `POST /api/roster/pair` (signed 10-minute token, SHA-256 nonce on `invite_token_hash` / `invite_token_expires_at`). Associate scans `/pair?t=` → `POST /api/auth/redeem-invite` (preview, then PIN + confirm) which burns the hash, mints Hub JWT with `store_number`, and lands on Floor. Signup still claims the existing card (`store_specialists.auth_user_id`) instead of duplicating. Cards show Roster Only / Invited / Active plus Specialist / CSA / Supervisor. Forgot PIN still sends a 30-minute SMS link. Apply **`20260817_rls_security_lockdown.sql`** so Hub inventory, roster, manager notes, and Store Ops reads require authenticated `jwt_matches_store` (anon/open SELECT removed). Login does not SELECT the roster as anon — `POST /api/auth/hub-bridge` returns a sanitized specialist.

## AI (`lib/ai/gemini.ts`)
- Server-only Gemini Flash client (`@google/generative-ai` + `server-only`)
- Env: `GEMINI_API_KEY`, `GEMINI_MODEL` (default `gemini-3.5-flash`) — never `NEXT_PUBLIC_`
- Exports: `callGeminiFlash(prompt, options?)`, `callGeminiFlashJson`, `jsonGenerationConfig`, `GEMINI_TOKEN_BUDGET`, `extractGeminiJsonText` / `parseGeminiJson`, `isGeminiConfigured`
- Callers pass `responseSchema` (owned by domain modules) + per-route `maxOutputTokens`: briefing 256 · Snap Bay 512 · Floor Pad / insights 2048 · Pre-Flight parse 2048
- JSON mime is always on; regex fence extraction remains a safety net
- Does not recommend or own institutional knowledge — callers compose prompts and schemas
- **AI Pre-Flight (Bulk Generator):** `POST /api/store-locations/ai-parse` + `lib/store-ops/ai-parse.ts` normalize to `{ locations, corrections_made }`; input capped at 24k chars; UI tab confirms via existing bulk upsert
- **Flooring AI Insights:** `POST /api/flooring/ai-insights` (Store Ops JWT) — server-fetches remnants/audits, runs aging/variance locally, sends a compact findings packet to Gemini (compact-then-narrate). `FlooringAIInsightBanner` does not POST tables.
- **Zebra Shift Briefing:** On-load uses `buildLocalShiftBriefing` from `GET /api/store-health` only (no Gemini). Manual refresh may POST `/api/store-health/ai-summary`; 429/quota/RPC errors fall back silently to the local brief. Raw GoogleGenerativeAI JSON is never shown.
- **Audit Velocity Chart:** `lib/store-ops/telemetry.ts` + `StoreHealthChart` inside Floor `ShiftAnalyticsDrawer` (06:00–22:00 curve vs linear target; Overall / D23 / D35 pills)
- **Appliance Anomaly Detection:** `POST /api/appliances/ai-anomaly` (Store Ops JWT) — server-fetches scans/catalog, local heuristics first, Gemini narrates the packet
- **Catalog Taxonomies:** `lib/catalog/taxonomies.ts` + `POST /api/catalog/ai-taxonomy` (supervisor/admin JWT) + Settings `TaxonomyManagerModal`; known-folder packet + registry merge
- **AI Visual Bay Scan:** `POST /api/store-ops/ai-bay-scan` + `lib/store-ops/ai-bay-scan.ts` + `VisualBayScannerModal` — 720p JPEG q=0.70 / 960px; route cap ~1.5MB; `responseSchema` + 512 output tokens
- **Executive Floor Pad:** Full TipTap notes still owned by `extractTasksAndTag` (`lib/store-ops/ai-note-extract.ts`). Walk-of-consciousness parse is a separate owner: `POST /api/copilot/parse-walk` + `lib/store-ops/ai-walk-parse.ts` (structured location/category/priority JSON, 8k cap, 2048 tokens). `POST /api/store-ops/ai-note-summary` remains **410 Gone**.

## RBAC (`lib/rbac.ts` + `lib/specialists.ts`)
| Role | Scope | Tabs |
|------|-------|------|
| 👑 Master Admin (`MASTER_ADMIN`) | `assigned_department: all` | Floor · Map · Roster · Settings (DB tools, store settings) |
| 🛡️ Department Supervisor (`DEPARTMENT_SUPERVISOR`) | primary + `accessible_departments[]` | Floor · Map · Roster · Settings; department roster + schedules; Settings topology for bay priorities |
| 👤 CSA / Specialist (`ASSOCIATE_CSA`) | primary + granted extras | **My Shift** `/dashboard` · **Store Map** `/admin/store-map` only (Roster + Settings hidden) |

### Developer sandbox (Master Admin only)
- 3 taps on the DeptSync logo within 800ms opens `DevSandboxDrawer` (`HubHeader` + `NavigationHub`)
- Preview As Role: Master Admin | DS Supervisor | CSA Specialist; Simulate Department overlays chrome without changing JWT
- **Danger zone / testing actions:** department + ISO week selectors (defaults to current staging week), two-step **Clear staged rotation** → `POST /api/admin/rotations/reset` (deletes `weekly_rotations` + `sunday_bay_assignments`, resets bays to PENDING, invalidates rotation cache)
- State: `sessionStorage` `deptsync_dev_sandbox` + `deptsync:dev-sandbox` event (`lib/dev-sandbox.ts`). `composeViewSpecialist` keeps real `id` / name / store
- Banner: `⚡ Simulating: [Role · Dept] — Tap to Exit` (`DevSandboxBanner`)
- 3-tap stays wired to the **real** Master (`sandboxActor`) while previewing CSA

### Master Admin roster console
- Canonical team UI is the **Roster** tab (`/roster`, `RosterTab`) — dynamic collapsible accordions for every home department with members (`D23 · Flooring`, `D35 · Appliances`, `D28 · Inside Garden`, …) plus `{count} roster · {onDutyCount} on-duty`. Compact `SpecialistCard` rows; tap / `SlidersHorizontal` opens `SpecialistEditSheet`. Fetch is `store_specialists` by store aliases only (`2587`/`02587`); roster-only rows (`invite_token` / `auth_user_id` null) stay visible. `appliances` / `D35` / `D35 · Appliances` group together. **Add Team Member** → `AddTeamMemberSheet` → `POST /api/roster/members` (roster-only). Pairing is `POST /api/roster/pair` from the manage sheet (QR, no SMS). `SpecialistModal` is a session picker only.
- `/admin/supervisors` and `/admin/roles` redirect to `/roster`
- Invite/reset SMS for **Forgot PIN** still lives on `/auth/verify/[token]`. Roster add-member is roster-only; device pairing is QR (`/pair?t=`). Dead `AdminRosterManager` was removed
- Lightweight **Associate Roster** (`AssociateRosterPanel`) remains on the Sunday assignment drawer
- Floor titles: `store_specialists.floor_title` owns Specialist vs CSA vs Cashier vs Receiving. Specialty job options (Flooring CSA, Appliances Specialist, …) pin home department (`flooring` / D23 family). Cards badge Specialist / CSA / Supervisor. Apply `20260816_roster_floor_title.sql`.
- Sunday Shift Balancer allocates weekly bay quotas to on-duty Specialists/CSAs by 4h / 6h / 8h (`planProportionalBayAssignments`)

### Settings tools (Master Admin / Supervisor)
- Four cards in `SettingsSection` (hosted by `SettingsTab`): Profile & Preferences · Department Targets & Sunday Auto-Stage · Store Topology & Bay Setup · Catalog & Remnants
- Master: store number (Profile accordion), Sunday auto-stage time + auto-run (`SundayScheduleCard`), Store Topology (`#bulk-generate`), Taxonomies (`#taxonomies`), Force Rotation (`#weekly-rotation`)
- Supervisor + Master: weekly targets matrix + Store Topology. Floor Pad lives in Floor `ShiftAnalyticsDrawer` (`TacticalVoiceFloorPad`); Settings `#manager-notes` redirects to `/dashboard#floor-pad`
- Remnant inventory (`#remnants`) when RBAC allows; Device & sync for every Settings role
- Personal **Appearance & Theme** (all roles, including CSA via header) — not store configuration
- Department Supervisors never see Master-only setup controls
- Master Admin header: **My Department Context** pin (All / D23 Flooring / D35 Appliances / …) — persists across Floor · Map · Roster · Settings and filters those tabs in place. Does not navigate to specialty `/?section=` scans.

### Sunday Flooring Cycle Audit
- Staging card + assignment modal: open weekly Flooring bays → assign from on-duty roster; Auto-Assign All to Me; Stage/Draw 12 or **Recalculate** (Master Admin); **Shift balancer** (hours / start–end → proportional clustered zones)
- Associate roster in the drawer **pre-selects Flooring / D23** home-department associates (`associateMatchesSundayDepartment`). Appliances / Millwork / Cabinets start off. Master Admin can toggle anyone. Header: `Selected: N Flooring associates (… from other depts unselected)`. Job-title badges (`Flooring CSA`, `Appliance Specialist`)
- Card shows on Sunday even before bays are drawn (`shouldShowSundayStaging`). Tap opens the drawer **in-place** (`requestSundayAuditDrawer`). `/flooring`, `/sunday-audit`, and `/sunday-rotation` redirect to `/dashboard` with the drawer — they do not 404
- Assignments persist in `sunday_bay_assignments` (JWT store/dept RLS); `bay_id` = `weekly_rotations.id`; ISO week → `week_starting` Monday
- Plan math: `lib/store-ops/weekly-rotations.ts` (does not generate rotations or persist)
- Entry points: Floor tab, Cycle Audit scan, `/flooring` deep link, `#sunday-audit`
- ZebraChecklist live-handoff: `SUNDAY_AUDIT_EVENT` + Realtime via `lib/store-ops/realtime.ts` (bind `postgres_changes` before `subscribe()`, unique channel names, unsubscribe on unmount)

### Departments
`flooring` (D23) · `appliances` (D35) · `plumbing` · `electrical` · `lawn_garden` · `paint` (D24P) · `millwork` (D30) · `cabinets` (D29) · `building_materials` · `hardware` · `tools` (D25) · `all`

- Department glyphs: Lucide `DepartmentIcon` (no emoji). Roster / Admin pin / Settings department matrix / department pickers.
- Store Map Department Overview was removed; Cabinets (D29) weekly target 6 and cron toggle live in Settings `DepartmentTargetsMatrix`.
- Department seed upserts with `ignoreDuplicates` against live UNIQUE: `(store_id, code)` when present, else `code` (`departments_code_key`). Duplicate D29 is logged, not a 500. List falls back to unscoped `SELECT *` so Store Map hydrates existing rows instead of a red banner.

- Seeds: none auto-injected. Create Master / Supervisor profiles via Add Team Member (roster-only); pair devices with **Pair Device via QR** (`status=invited` until `/pair` sets a hashed PIN)
- First-login: non-dismissible AuthWall setup when `must_change_credentials` (no Remind Later)

## Authentication (Zero-Access Wall)
- Unauthenticated visitors never see workspace tabs/data — edge `proxy.ts` (Next 16 middleware) redirects to `/login` (`AccessGate` + AuthWall). `public/robots.txt` disallows all crawlers; `X-Robots-Tag: noindex, nofollow, noarchive` is set globally.
- Login / unlock: username + password/PIN → `POST /api/auth/hub-bridge` (service-role PIN verify). Roster **list** is authenticated + store-scoped and never selects `pin_code` / hashes. Pre-login AccessGate does not fetch `store_specialists` as anon.
- **HTTP-only hub gate:** after PIN + Hub-bridge JWT, `POST /api/auth/gate` sets `deptsync_hub_gate` (8h, HttpOnly). Middleware will not render `/dashboard` without it. Logout clears the cookie.
- **Hub PIN → Auth bridge (primary Store Ops unlock):** after PIN verify, client calls `POST /api/auth/hub-bridge` which service-role verifies the roster PIN, ensures `auth.users` + `profiles` link, and mints a Supabase Auth session. **Master PIN** requires `HUB_MASTER_PIN` (no default). It authenticates an **existing** Master Admin only — it does **not** auto-bootstrap. Recovery: `POST /api/auth/bootstrap-admin` (Bearer `BOOTSTRAP_SECRET` or `CRON_SECRET`) or `scripts/bootstrap-admin.mjs`.
- **Bootstrap recovery:** `POST /api/auth/bootstrap-admin` (Bearer `CRON_SECRET`) or `node --env-file=.env.local scripts/bootstrap-admin.mjs` — resets `master_admin` roster + Auth + profiles
- **PIN reset:** `POST /api/auth/reset-pin` (Change PIN, Super Admin) hashes `pin_hash`. Self-service: AuthWall **Forgot Access Code** → `POST /api/auth/pin-reset/request` → SMS `/auth/verify/[token]` (30m, consume-on-entry)
- **Store Ops identity:** `resolveStoreOpsActor` loads `profiles` where `id = auth.users.id` from Bearer/cookie JWT (no `x-store-ops-*` trust headers; emergency unlock removed). API data paths use service role **after** actor resolve.
- **Returning session:** hub `deptsync_auth_session` alone is not enough — cold restore without a live Supabase Auth JWT forces the PIN unlock wall so bridge can mint Auth.
- **Phone recovery (optional):** "Forgot Access Code? Reset via Phone" → SMS one-time `/auth/verify/[token]` (legacy OTP confirm remains at `/api/auth/phone-reset/*`)
- Setup requires verified mobile (`phone_number` on `store_specialists`)
- Native keychain: form `autocomplete` username / current-password
- Biometric: WebAuthn; requires an existing Store Ops Auth session (otherwise PIN once after fingerprint)
- `must_change_credentials` → non-dismissible permanent credential setup
- Session: `deptsync_auth_session` (hub UI) + `deptsync_hub_gate` HttpOnly cookie (edge gate) + Supabase Auth localStorage (API Bearer); 8h idle lock on hub session
- **P0 boot:** `/login` does not fetch the roster until Hub-bridge JWT exists; `/` and `/dashboard` require the hub gate cookie. Catalog / remnants / appliance catalog load after unlock when the relevant section mounts; specialty scans + Snap Bay / SIMS / Audit Report / Settings tools are `next/dynamic`
- **P0 indexes:** re-run `supabase/migrations/20260813_p0_query_indexes.sql` — hub tables use `store_number`; Store Ops locations/rotations use `store_id`; manager_notes Phase 2 uses `store_number`+`department` (legacy `store_id`+`department_code`). Script skips absent columns. Apply `20260815_performance_indexes.sql` for Map/copilot composites (`idx_store_locations_dept_aisle`, `idx_bay_service_logs_bay_time`, `idx_rotations_active`) on canonical columns (`aisle`/`bay`, `location_id`/`created_at`, `is_completed`).
- **P1 Gemini/map:** Snap Bay 720p + compressed JPEG; Floor Pad Copilot strips HTML / 8k cap; `GET /api/store-locations` explicit Store Map columns (no `SELECT *`); Slice 1 `responseSchema` + per-route token budgets
- **P2 hub UI:** `startTransition` + keep-alive Floor/Map/Roster/Settings (`hidden`); Cycle/Appliance scan forms isolated from logs; 300ms debounced draft saves with flush on submit/leave; weekly rotations + Sunday assignments TTL-cached 45s
- **Settings tools:** Four Lucide cards in `SettingsSection`; Bulk / Taxonomies / Force Rotation stay `next/dynamic`; Sunday schedule is Master-only inside Department Targets; Floor Pad is the Floor tactical dock; SW cache `deptsync-shell-v6-stealth`
- **Bulk bays:** Odd Only / Even Only (`lib/store-ops/bay-pattern.ts`, default odd); Store Map GET falls back if `last_completed_at` is missing/null
- Seeds: no hardcoded roster injection — use Add Team Member (roster-only) then Pair Device via QR (`status=invited` until `/pair` PIN setup)
- Primary: fixed bottom workflow tabs — **Floor · Map · Roster · Settings** only
- Header: DeptSync brand + store # · section title · department dropdown pill · account/PIN chip
- Cycle Audit / Appliances: hardware-scan ready without soft keyboard; Log docked in `ScanActionDock` above BottomNav (`max-w-lg`, safe-area stack)

## Store Ops auth transport
- Client: `storeOpsAuthHeadersAsync` → `Authorization: Bearer` from Hub-bridge or phone Auth session
- Server: `getRequestAuthUser` (Bearer or cookie) → `resolveStoreOpsActor` → `profiles` → service-role DB client
- Soft-fail reads (`auth_required` + hint) only when JWT missing; after Hub PIN unlock banners should clear
- Push subscribe: `user_id` = Auth profile id; `specialist_id` null
- SQL: `supabase/migrations/20260812_jwt_rls_policies.sql` + **`20260817_rls_security_lockdown.sql`** — JWT store/department RLS; anon and `USING (true)` reads removed. Realtime publication includes `sunday_bay_assignments`, `manager_notes`, `downstock_queue`.
## Scan-to-Catalog
- SKU / UPC resolve via `lib/barcode.ts` → `carpet_catalog`
- Roll logging: `RollMeasurementPad` (live CLF/SQYD header + inch/fraction/rounds keypad) composed by `CycleAuditScanForm`
- Soft keyboard: **tap-to-type only** (no auto-focus on tab switch)
- Hardware wedges: `useGlobalBarcodeScanner` (window keydown, 6+ chars ≤150ms) → **active visible** section lookup (`scannerEnabled=false` while hub pane is hidden)
- Mid-scan drafts: `lib/debounced-persist.ts` (300ms) + `useFlushOnLeave`; flooring `lib/storage.ts`, appliances `lib/appliance-scans.ts`
- Focused SKU fields still support Enter **or** rapid burst via NumberField
- Quick-Add modal for unlinked barcodes
- Catalog folders (`lib/catalog-folders.ts`); domain-filtered for department supervisors
- Department taxonomies (`lib/catalog/taxonomies.ts`) for generic dept folder drill-down; AI seed via Settings

## Dual audit engine
- Mode A (Carpet / Sheet Vinyl): CLF; Mode B: cartons × sqft/box
- Appliances: unit count + SIMS staging; Model # on catalog `vendor`

## Offline & PWA
- Service worker `public/sw.js`; sync queue `carpet_hub_sync_queue` (`lib/sync-queue.ts`)
- Queue actions carry `transaction_id`, `optimistic_at`, retry backoff (`next_retry_at`), optional `base_updated_at`
- Store Ops floor writes (`STORE_OPS_COMPLETE_ROTATION`, `STORE_OPS_DOWNSTOCK_ADD`, `STORE_OPS_SUNDAY_ASSIGN`) use `enqueueOrExecute` — live first, queue on offline / timeout. Queue replay builds a synthetic specialist via `specialistFromSyncPayload` (`is_active: true`). `weekly-rotations.ts` still only plans; persist is `sunday-audit.ts`.
- IndexedDB SWR (`lib/store-ops/cache.ts`) owns durable `store_locations` / `weekly_rotations` / `shift_briefings`; `ttl-cache.ts` remains L1. Writes call `invalidateStoreOpsListCaches()` which clears both.
- `installSyncAutoFlush` — flush on `online`, `visibilitychange` (visible), and `focus`
- Version/409 conflicts → `ConflictResolutionModal` (Keep Local force-overwrite vs Accept Server)
- Header: Online / Offline Mode (`HeaderNetworkStatus`) + amber `SyncStatusPill` when pending > 0

## Multi-store
- `lib/store.ts` (default `1234`); **store switch = Master Admin only** (Settings)
- Store Operations: `stores` table UUID `store_id`; hub session `store_number` maps via `lib/store-ops/stores.ts`
- Departments / locations / weekly rotations scoped by `store_id`; cron runs per active store

## Store Operations upsert keys
- `stores`: `onConflict: store_number` (payload: store_number, name, is_active)
- `departments`: `onConflict: code` (matches live UNIQUE on `code`)
- `store_locations`: `onConflict: department_id,aisle,bay,type` (BOTH writes Selling + Topstock per bay; status PENDING). **`aisle` is alphanumeric TEXT** (`BW`, `RW`, `12`, `A1`) — apply `20260811_alphanumeric_aisle.sql`. Bulk Generator + batch CSV (`lib/store-ops/aisle.ts`) normalize with `.trim().toUpperCase()`; no numeric-only aisle validation.
- `weekly_rotations`: `onConflict: location_id,assigned_week`

## Remnants / markdown
- Aging badges (Lucide, not emoji); 60+ or elevated role → Apply Manager Markdown
- Floor-ops rack bands (Fresh <14d / Watch 14–30d / Critical >30d) via `lib/aging.ts` `classifyRackAging` + `lib/remnants.ts` `remnantRackAlert`; critical rolls show a Suggest markdown chip (markdown math stays in `lib/markdown.ts`)

## Audit Report Export
- Shift summary → **📊 Export / Print Report** (Flooring, Appliances, Department)
- `AuditReportModal` + `lib/audit-report.ts`: formal SIMS/cycle summary, print-to-PDF, mailto / `navigator.share`, Markdown clipboard paste
- Print stylesheet strips hub chrome for letter B&W output

## Store Operations (multi-dept maintenance)
- Schema migration: `supabase/migrations/20260809_store_operations_rbac.sql`
  - `departments`, `profiles` (auth.users + `super_admin` / `department_supervisor`), `store_locations` (SELLING/TOPSTOCK + cycle status), `weekly_rotations`
  - RLS: super_admin all; supervisors read/update own `assigned_department_id`
- Hub bridge: Master Admin → super_admin; Supervisor → department_supervisor (via `departments.code` = hub `assigned_department`)
- **Navigation Hub** (`lib/nav-hub.ts` + `HubHeader.tsx` + `BottomNav.tsx` + `NavigationHub.tsx`): header is `DeptSync · #2587` · section title · department pill · account/PIN; primary tabs **Floor · Map · Roster · Settings** for every role (no More overflow)
  - Floor (`/dashboard`) · Map (`/admin/store-map`) · Roster (`/roster`) · Settings (`/settings`)
  - Authenticated `/` without specialty `?section=` replaces to `/dashboard`. Hub `/?section=audit|appliances|department` is scan tools only. Remnants deep-link to `/settings#remnants`
- `/manager-notes` redirects to `/dashboard#floor-pad` (Tactical Voice Hub on Floor)
- `/dashboard` — one Floor layout for all roles: **Floor Rotation** when Full Store is pinned, otherwise `${activeDept.name} Rotation`; Snap Bay AI Audit + Flag Downstock sheet; on-duty strip filtered to the working department (`canAccessDepartment`); Full Store with >6 on-duty associates collapses to a Users summary sheet. Sunday staging (non-associates), proportional `ZebraChecklist` grouped by on-duty specialists. `store_locations.workflow_type` routes Floor execution: `STANDARD_MERCH` / `BULK_PALLET_AUDIT` = Quick Touch row; `APPLIANCE_SIMS_AUDIT` = `ApplianceSimsChecklist` (scanner stays on Floor with bay `location_id`). Shift velocity, store health, Walk & Talk, briefing, copilot, freshness, showroom, verify/rollup, and `ExceptionFeed` nest in collapsed `ShiftAnalyticsDrawer`. Specialty scan pills remain on the Floor header when the pin allows; Cycle / Appliances also stay on `/?section=`.
- `/stock` redirects to `/dashboard` (Downstock is a Zebra tab on Floor)
- `/roster` — unified team list, PIN add, and department access chips (optimistic + toast)
- `/admin/store-map` — Visual navigator chunks aisle/bay DOM (16 aisles / 24 bays) with memoized Lucide status glyphs + SVG heat strips; Sell/Top is display-only. Tap bay → **one** `WalkTheFloorSheet`. Bay CRUD is Settings **Store Topology & Bay Setup**.
- Sunday staging card opens the assignment modal with **Shift balancer** (hours → proportional clustered zones). Plan owner: `lib/store-ops/weekly-rotations.ts`; persist: `sunday-audit.ts`. Drawer seed: Flooring/D23 only (`associateMatchesSundayDepartment`); Master may toggle other depts.
- `GET /api/store-health` — weekly pace + bottleneck aggregation + compact `bay_health` for DS / Super Admin. Completion % is `computeDepartmentCompletionPct` in `health.ts` (rollup composes the same helper). Bay flag penalties (28/18/16/12) live in `health.ts`; `bay-health.ts` and `weekly-rotations.ts` import `flagPenalty`.
- `POST /api/store-ops/ai-bay-scan` — multimodal bay photo → carton/pallet estimates, cleanliness score, detected issues (Store Ops actor)
- `POST /api/store-ops/ai-note-summary` — **410 Gone**; Floor Pad Copilot `extractTasksAndTag` is canonical
- APIs under `/api/rotations/*`, `/api/store-locations*`, `/api/departments`, `/api/weekly-rotations`
- **Enterprise ingest (stubs, no UI):** Zod contracts in `src/types/enterpriseIntegration.ts` (`BayTopologyIngestSchema`, `FreightStageEventSchema`, `FloorTouchTelemetrySchema`). `POST /api/v1/topology/ingest` and `POST /api/v1/freight/stage` validate with `.safeParse()` and return 400 `{ success: false, error: "Bad Request", issues }` on mismatch. Does not persist into `store_locations` / rotations. Edge gate still requires hub cookie or `Authorization: Bearer`.
- Multi-store: apply `20260809_multi_store.sql`; store scope comes from JWT `app_metadata.store_number` / `profiles.store_number`
- Sunday auto-stage clock: apply `20260816_sunday_rotation_schedule.sql`
- Manager notes: apply `20260811_manager_notes.sql` + `20260812_manager_notes.sql` + `20260812_manager_notes_archive.sql` + `20260812_fix_manager_notes_rls.sql` + **`20260812_manager_notes_metadata.sql`** (`metadata` JSONB from Gemini Copilot)
- Sunday bay assignments: apply `20260812_sunday_bay_assignments.sql`
- Downstock queue: apply `20260814_downstock_queue.sql` (localStorage fallback until applied)
- Shift walk tasks: apply `20260815_shift_walk_tasks.sql` (Floor Copilot dispatch; localStorage fallback until applied)
- IRP velocity heatmap: apply `20260814_bay_velocity_heatmap.sql` (`store_locations.last_serviced_at` / `velocity_tier` / `priority_override` + `bay_service_logs`)
- JWT claims / RLS helpers: apply `20260812_jwt_rls_policies.sql` + enable Custom Access Token Hook + **`20260817_rls_security_lockdown.sql`** (drop anon/open SELECT; Realtime on sunday_bay_assignments / manager_notes / downstock_queue)
- Requires `SUPABASE_SERVICE_ROLE_KEY` for server routes (apply migration in Supabase SQL editor)

## Web Push (rotation phone alerts)
- Migration: `supabase/migrations/20260809_push_notifications.sql`
- Supervisors enable via Settings → Phone rotation alerts (`usePushNotifications`)
- Env: `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, optional `VAPID_SUBJECT`
- Generate keys: `npx web-push generate-vapid-keys`
- `POST /api/rotations/generate` dispatches push to matching `department_code` / profile subscribers. Batch body: `{ department_ids, bay_count, force_overwrite }` → `{ success_count, failed_count, staged_bays }` (Settings **Trigger Weekly Rotation** multi-select).
- SW shows notification and opens `/dashboard` on click

## Weekly rotation cron
- Migration: `supabase/migrations/20260809_weekly_rotation_cron.sql` (`weekly_bay_target`, Lowe's codes) + **`20260816_sunday_rotation_schedule.sql`** (`stores.sunday_auto_generate`, `sunday_auto_stage_time` default 05:00, `timezone` default America/Denver)
- `vercel.json`: Sunday `0 11 * * 0` (11:00 UTC ≈ 05:00 AM America/Denver) → `/api/cron/weekly-rotation`. Hobby forbids sub-daily cron (`*/15` fails the deploy). Dispatch still skips unless auto-generate is on, it is Sunday in `stores.timezone`, local time is at/after `sunday_auto_stage_time`, and the week is not already staged
- On Sunday the runner stages the **upcoming** ISO week (Monday). It **skips** a department that already has **active** `weekly_rotations` for that week — Master Admin Force Draw / Recalculate (`force: true`) **supersedes** incomplete active rows via `resetStagedWeekRotations` (preserves `id`/`created_at`), then inserts fresh active bays (insert-after-clear + conflict supersede recovery). Completed (`is_completed=true`) rows stay on the active plan.
- Persist owner: `lib/store-ops/rotations.ts` (`upsertWeeklyRotations`). Payload includes `store_id` (UUID from `20260809_multi_store.sql`), `store_number` (JWT RLS from `20260812_jwt_rls_policies.sql`), and `week_number` + `year` parsed from `assigned_week` via `parseIsoWeekLabel` (`2026-W34` → week 34, year 2026 — never a hardcoded week). If PostgREST reports a missing column (PGRST204 / schema cache), that column is dropped and the upsert retries. A NOT NULL after a cache miss means Postgres has the column but the API cache is stale — reload schema (`NOTIFY pgrst, 'reload schema'`) rather than guessing the column set
- Upsert `onConflict` is **`location_id,assigned_week`** — the table unique from `20260809_store_operations_rbac.sql`, re-asserted by **`20260817_weekly_rotations_location_week_unique.sql`**. Apply **`20260818_drop_weekly_rotations_store_dept_week_uniq.sql`** if the live DB has a mistaken `UNIQUE(store_number, department_id, week_number)`. Admin reset: `POST /api/admin/rotations/reset`
- Env on Vercel: `CRON_SECRET` (Bearer token Vercel sends automatically)
- Settings → Sunday rotation schedule (Master) + weekly bay target matrix (Supervisor + Master; blur autosave + Save All)

## End-of-week verification
- Migration: `supabase/migrations/20260809_rotation_verification.sql`
- Floor **Weekly audit rollup** is the DS verification queue (PENDING_VERIFICATION bays). Apply **`20260818_weekly_rotation_verification.sql`**. Associate complete sets `PENDING_VERIFICATION` (location stays ASSIGNED); DS Verify & Pass → `VERIFIED_COMPLETE` + location COMPLETED. DS/Master complete auto-verifies. Send Back with Note returns the week item to PENDING with `review_note`. APIs: `GET|POST /api/rotations/verify` (`review_action`: verify | send_back | verify_all)
- Floor **Verify completed bays** (Shift Analytics drawer) stamps `departments.last_verified_week` without completing remaining open bays (`verifyAllCompletedBays`)
- `/verify-rotation` and `/admin/exceptions` redirect to `/dashboard`; the Floor `ExceptionFeed` is the live barrier list
- Mid-week floor barriers: `POST /api/rotations/exceptions` (does **not** stamp `last_verified_week`) — Zebra row **Barrier** → tap reason
- APIs: `POST /api/rotations/verify`, `GET|POST /api/rotations/exceptions`

## Selling vs Topstock audit mode
- Canonical Store Ops type `SELLING` | `TOPSTOCK` (`lib/store-ops/audit-location-mode.ts`); hub audits still persist `sales_floor` / `top_stock`
- Cycle Audit / Department Audit / Zebra filter share `AuditLocationModeToggle` — SELLING = lower floor, TOPSTOCK = overheads/racking
- Discrepancy flags, log rows, and audit reports include the mode; Cycle/Department forms keep the mode across logs (not reset)

## Bay workflow profiles
- Owner: `store_locations.workflow_type` (`lib/store-ops/types.ts`). Apply **`20260818_store_location_workflow_type.sql`** + **`20260818_appliance_scans_bay_location.sql`**.
- Settings Bulk Generator + Edit Bay tag `STANDARD_MERCH` | `APPLIANCE_SIMS_AUDIT` | `BULK_PALLET_AUDIT`. Appliances/D35 generate as SIMS. Super Admin **Apply … to all mapped bays** is `PATCH /api/store-locations` `{ apply_to_department, department_id, workflow_type }`.
- Floor routes SIMS bays to a 4-step placard/scan checklist; Complete still hits `POST /api/rotations/complete`. Scanner context is `requestApplianceScanner({ location_id, aisle, bay })` — `lib/appliance-scans.ts` remains scan owner. Recon composes catalog + scans only (`lib/appliances/sims-reconciliation.ts`).

## Store number (dynamic)
- Owner: `lib/store.ts` — localStorage `carpet_hub_store_number`; **no hardcoded `1234`/`1852`**
- Blank allowed; Master edits via **Settings → Store number** (session stays active)
- Session / active specialist / biometric only reject when both sides have different store numbers
- Login adopts `store_profiles` / specialist `store_number` when device store is unset
- Store-ops APIs require a live Supabase Auth session linked to `profiles` (Hub PIN bridge or phone OTP → `linkAuthUserToSpecialistProfile`); store scope from JWT claims, not client headers

## Mobile floor UX (Waves A–C)
- Floor job first: Dashboard = pace + checklist; no Super Admin quick-action strip, hamburger, or Admin Tools drawer
- Master setup tools live in Settings accordions/modals
- Dense bay/rotation rows; completed lists collapsed by default
- Remnant forms live in Settings; `/department` redirects to Floor

## Supervisor Invite & Onboarding
- Apply `20260810_supervisor_invite.sql`, `20260815_roster_invite_onboarding.sql`, **`20260815_unified_auth_token.sql`**, then **`20260815_roster_app_access.sql`** (backfill `pin_updated_at` so existing PINs show as app-Active), then **`20260815_roster_auth_link.sql`** (nullable `auth_user_id` / email claim so roster-only inserts and signup linking do not duplicate cards), then **`20260815_roster_insert_rls.sql`** (authenticated INSERT/SELECT so roster-only rows are visible after Hub PIN unlock)
- Master Admin: Roster → **Add Team Member** → Name, Role, Initial Department, optional Phone (contact / PIN-reset only). Pairing is **Pair Device via QR** on the specialist sheet (10-minute signed token; no SMS). Cards: Roster Only / Invited / Active. Roster-only and Invited rows can regenerate a QR.
- Self-service reset: AuthWall phone → `POST /api/auth/pin-reset/request` → `/auth/verify/[token]` (30m TTL)
- QR redemption: `/pair?t=` previews without burning; PIN + confirm burns `invite_token_hash`, hashes a 4–6 digit PIN, and mints Hub-bridge Auth with `store_number` in JWT `app_metadata`. After PIN: already-standalone → `/`; Chromium `beforeinstallprompt` → native install then `/`; iOS / blocked prompt → Add to Home Screen card then Continue to Floor (`/`). Capture owner is `lib/pwa-install.ts` (`display: standalone`, `start_url: /`).
- Owners: `lib/auth/invite-token.ts` (QR crypto), `lib/onboarding/qr-pair.ts` (issue/preview/redeem compose), `lib/onboarding/redeem-token.ts` (PIN + Hub JWT). SMS copy for PIN-reset remains `lib/invite.ts` + `lib/onboarding/pin-reset.ts`
- APIs: `POST /api/roster/members` (canonical roster-only insert), `POST /api/roster/pair` (issue QR), `POST /api/auth/redeem-invite` (public preview / PIN complete), `POST /api/auth/pin-reset/request`, `GET /api/auth/verify/[token]`, `GET|POST /api/auth/verify`
- Legacy `/invite/[token]` still redirects to `/auth/verify/[token]` (PIN-reset / old SMS tokens)

## Associate floor role
- Store Ops actor `associate`: read/complete dept rotations + locations; create exceptions via verify; **no** targets, invite, generate/reset, or Master Settings tools
- Nav: Master/DS Floor · Map · Roster · Settings; CSA **My Shift** + **Store Map** only (Downstock on Floor; specialty scans via Floor chips → `/?section=`)

## Department toggles · adaptive priority · showroom
- Apply `supabase/migrations/20260810_dept_priority_showroom.sql`
- Master toggles: Settings Department Overview (`DepartmentTargetsMatrix`, `departments.is_active`; Flooring default on)
- Adaptive draw: `manual_priority_count` + `last_completed_at` age + velocity/priority_override boost; after CARRIED_OVER, `pickSundayVelocityPrioritized` fills remaining slots from high/critical/override first; Store Map ★ Week assigns + bumps priority
- Showroom: `location_type=SHOWROOM_STACKOUT` + `audit_frequency_days`; dashboard Quick Touch card (not in weekly aisle draw)
- Store Map surfaces: `[ Standard Map | Velocity Heatmap ]` plus Snap Bay. Bay rows: Lucide status glyphs, `formatBayTag`, dual-pill Selling/Topstock (display-only); tap bay → `WalkTheFloorSheet` (walk + Snap Bay). Settings **Store Topology & Bay Setup** owns checkboxes, batch delete, duplicate prune, Add Bay, Bulk Generator, and `EditBayDrawer` (hotspot / priority lock / decay slider).

## Appliance categories (suite + sub)
- **Tables:** `appliance_catalog` + `appliance_scans` (not carpet_*). Apply `supabase/migrations/20260810_appliance_catalog_scans.sql` then `enable_rls_flagged_tables.sql` (RLS on appliances + `store_specialists` + verify all public tables)
- Top-level: Laundry · Refrigeration · Cooking / Ranges · Dishwashers · Microwaves / Venting
- Sub required on Quick-Add UPC link / floor scan / catalog (Laundry → Washer | Dryer | Combo / Unit)
- Types: `ApplianceCatalogItem`, `ApplianceScan` (`sub_category?`)
- APIs: `/api/appliances/catalog`, `/api/appliances/scans` (`?format=csv`)
- CSV export: **SUMMARY** (Item Number, Description, Category, Total Count Scanned, Locations Found) + **RAW DETAIL** (Category, Sub-Category, Item #, Serial #, Location, Scanned By, Scanned At, Store #)
- Online scans POST `/api/appliances/scans` (service role); failures surface as `Failed to save scan: …` (no silent offline success)
- **Continuous mode:** detect → POST immediately; no Submit button. Known SKU auto-logs; new/unlinked pauses on Quick-Add (sub_category) then logs + clears. Sticky **Session Total** counter at scanner top.
- **Scan log UX:** category accordion (collapsed default) → sub-category sections → SKU Qty cards; search auto-expands matches; 10 SKUs/page; sticky-free filter pills + search; Edit modal; `PATCH /api/appliances/scans`
