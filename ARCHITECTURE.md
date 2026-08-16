# DeptSync Hub — Architecture

```
app/page.tsx                      → Authenticated specialty scan hub (`?section=`); unauthenticated `/` redirects to /login
app/login/page.tsx                → Public AccessGate + AuthWall (no dashboard chrome)
app/access-gate/page.tsx          → Redirect → /login
app/auth/page.tsx                 → Redirect → /login
proxy.ts                          → Edge stealth + HTTP-only hub gate (Next 16 middleware)
lib/auth-gate.ts                  → Gate cookie HMAC + public-path allowlist
app/api/auth/gate/route.ts        → POST mint / DELETE clear HttpOnly `deptsync_hub_gate`
public/robots.txt                 → Disallow: /
app/dashboard/page.tsx            → Floor weekly bay checklist (unified layout; verify + exceptions inline)
app/(workflow)/layout.tsx         → Keep-alive Floor/Map/Roster/Settings shell (SessionGate once)
components/hub/WorkflowTabShell.tsx → Persistent tab panels (`hidden`; primary tabs hosted immediately)
lib/store-ops/ttl-cache.ts        → TTL + in-flight + getSWR stale-while-revalidate (L1 memory)
lib/store-ops/cache.ts            → Durable IndexedDB SWR (L2): store_locations, weekly_rotations, shift_briefings
lib/toast.ts                      → Sonner success/error helpers (presentation)
components/ui/Toaster.tsx         → Global toast host
app/layout.tsx                    → Geist + Geist Mono, PWA meta, ThemeProvider + FOUC boot script + Toaster
lib/theme.ts                      → Theme catalog, prefs persistence, document apply (owns personalization + sound/haptics flags)
lib/ui/preferences-context.tsx    → React mirror of theme prefs (`UserPreferencesProvider`; ThemeProvider alias)
lib/ui/feedback.ts                → Web Audio tones + navigator.vibrate patterns (gated by prefs)
lib/scan-feedback.ts              → Scan chime aliases that compose feedback.ts
utils/haptics.ts                  → hapticPulse alias → feedback.ts
components/hub/UserPreferencesDrawer.tsx → All-role appearance / density / contrast / sound / haptics
components/hub/UserPreferencesHost.tsx → Single drawer host (header + Settings event)
components/settings/ThemeSelector.tsx → Settings entry that opens the shared drawer
app/globals.css                   → data-theme tokens + glass / nav / modal utilities bound to CSS variables
app/manifest.ts                   → short_name DeptSync · Department & SIMS Audit Hub
public/sw.js                      → Offline shell cache strategies
components/hub/HubChrome.tsx      → AssociateSpecialtySwitcher (in-page scan tabs only)
components/hub/HubHeader.tsx      → Sticky hub header (`DeptSync · #2587`, D23 pill, account/PIN; overflow marquee; 3-tap logo → sandbox)
components/hub/BottomNav.tsx      → Floor · Map · Roster · Settings (2-col for CSA My Shift + Map)
components/hub/DeptSyncSplash.tsx → Boot / loading splash (pinned midnight + branded cyan/gold mark)
components/hub/NavigationHub.tsx  → Cross-app Navigation Hub (composes HubHeader + BottomNav + sandbox banner/drawer)
components/hub/DevSandboxDrawer.tsx → Preview-as-role + simulate department (Master Admin only)
lib/dev-sandbox.ts                → sessionStorage role/department overlay (does not own auth)
lib/rbac.ts                       → HubViewRole + map console / associate chrome gates
app/loading.tsx                   → Route-level splash
app/stock/page.tsx                → Redirect → /dashboard (Downstock lives on Floor)
app/(workflow)/roster/page.tsx    → Team roster keep-alive tab
components/hub/tabs/RosterTab.tsx → Department-grouped roster (collapsed) + weekly schedule + call-out
app/api/roster/members/route.ts   → Canonical roster-only INSERT into store_specialists
components/hub/AssociateScheduleModal.tsx → Sun–Sat shift matrix (composes shift-status.ts)
components/hub/tabs/MapTab.tsx    → Visual Grid (walk) | Manage Aisles & Bays (CRUD)
components/admin/AisleBayManager.tsx → Map manage console (aisle accordions, batch, prune, bulk)
components/admin/AddBaySheet.tsx  → Single-bay Selling+Topstock sheet (Manage console)
components/admin/EditBayDrawer.tsx → Aisle / bay / department / priority patch
components/admin/ExceptionFeed.tsx → Floor barrier feed (composes exception summary)
components/admin/WalkTheFloorSheet.tsx → Walk log + Snap Bay + pin (no map CRUD)
components/inventory/RollMeasurementPad.tsx → Compact roll/carton keypad (presentation; CycleAuditScanForm owns drafts)
components/admin/DepartmentTargetsMatrix.tsx → Weekly bay quota table (auto-save + Save All)
components/hub/WeeklyBayTargetCard.tsx → Re-export of DepartmentTargetsMatrix for Settings
components/hub/NavIcons.tsx       → Canonical Lucide HubIcon / NavIcon / DepartmentIcon (stroke 2, currentColor)
components/hub/DepartmentPicker.tsx → Lucide department listbox (roster / admin selectors)
lib/store-ops/realtime.ts         → Shared postgres_changes channel per logical name (bind-before-subscribe)
app/globals.css                   → Theme tokens + glass / hub-main / chip-filter / btn-quick-touch
components/hub/HapticsListener.tsx → Delegated vibrate pulses for taps / toggles / tabs
components/hub/OfflineNetworkBanner.tsx → Offline toast + installSyncAutoFlush callbacks
components/offline/ConflictResolutionModal.tsx → Local vs Server sync conflict chooser
utils/haptics.ts                  → navigator.vibrate wrapper (light/medium/success)
components/hub/SessionGate.tsx    → Auth gate for Store Ops route pages
lib/nav-hub.ts                    → Floor / Map / Roster / Settings routes + Settings tool hashes
lib/push/*                        → Web Push subscribe + VAPID dispatch for rotation alerts
app/admin/store-map/page.tsx      → Map keep-alive tab (Visual Grid walk + Manage Aisles & Bays)
app/admin/supervisors/page.tsx    → Redirect → /roster
app/admin/roles/page.tsx          → Redirect → /roster
components/store-ops/ZebraChecklist.tsx → Floor bay checklist (optimistic complete, Quick Touch, downstock, Sunday handoff)
components/store-ops/BayHealthScorecard.tsx → Compact bay health badge (presentation)
lib/store-ops/bay-health.ts       → Aging / SIMS / topstock discrepancy diagnostics (compose only)
components/store-ops/AuditLocationModeToggle.tsx → SELLING vs TOPSTOCK audit-mode control
components/store-ops/BarrierReasonChips.tsx → One-tap barrier reasons
lib/store-ops/audit-location-mode.ts → Canonical SELLING/TOPSTOCK ↔ hub sales_floor/top_stock
components/dashboard/WeeklyRotationList.tsx → Compatibility re-export of ZebraChecklist
app/department/page.tsx           → Redirect → /dashboard
app/verify-rotation/page.tsx      → Redirect → /dashboard
app/admin/exceptions/page.tsx     → Redirect → /dashboard
app/settings/page.tsx             → Settings & Config (theme, targets, push, Master tools)
app/api/push/*                    → VAPID public key, subscribe, manual dispatch
app/api/cron/weekly-rotation      → Sunday automated rotation engine (CRON_SECRET; per-store schedule)
vercel.json                       → Cron Sunday `0 11 * * 0` (11:00 UTC ≈ 05:00 America/Denver; Hobby daily limit)
app/api/stores/settings           → GET/PATCH Sunday auto-stage time, auto-run, timezone (Master PATCH)
lib/store-ops/sunday-schedule.ts  → Store-owned Sunday timing knowledge (defaults 05:00 America/Denver)
supabase/migrations/20260816_sunday_rotation_schedule.sql → stores.sunday_auto_generate / sunday_auto_stage_time / timezone
supabase/migrations/20260809_push_notifications.sql → push_subscriptions + RLS
supabase/migrations/20260809_weekly_rotation_cron.sql → weekly_bay_target + Lowe's dept codes
app/invite/page.tsx               → Redirect `/invite?token=` → `/auth/verify/[token]`
app/invite/[token]/page.tsx       → Redirect → `/auth/verify/[token]`
app/auth/verify/[token]/page.tsx  → Consume-on-entry PIN setup (invite + reset)
components/auth/InviteOnboardingView.tsx → Legacy invite presentation (unused; verify page owns UI)
lib/auth-token.ts                 → SHA-256 one-time tokens, PIN hash, verify-session cookie
lib/invite.ts                     → SMS copy for invite/reset links
lib/onboarding/roster-invite.ts   → Issue invite: persist hashes, status=invited, dispatch SMS
lib/onboarding/create-roster-member.ts → Roster-only insert (status=active, no tokens) or compose invite; HTTP: POST /api/roster/members
lib/onboarding/claim-roster-auth.ts → Link auth.users.id onto existing store_specialists (no duplicate cards)
lib/store-ops/roster-groups.ts → Dynamic home-department accordion groups (`appliances`/`D35`/`D35 · Appliances` → same bucket) + on-duty counts
lib/onboarding/pin-reset.ts       → Self-service PIN reset token + SMS
lib/onboarding/load-invite.ts     → Public token lookup by SHA-256 hash
lib/onboarding/redeem-token.ts    → Consume token, hash PIN, mint Hub-bridge session
lib/onboarding/sms-dispatch.ts    → Twilio or SMS webhook stub (never invents delivery)
components/hub/AuditReportModal.tsx → Printable / emailable / clipboard audit report
components/hub/*Modal.tsx         → Specialist / PIN / Markdown modals
components/barcode/QuickAddCatalogModal.tsx → Scan-to-catalog Quick-Add
components/catalog/SimsLocationFinder.tsx   → SIMS location stock drawer
components/hub/AdminDepartmentSwitcher.tsx → Master Admin working-dept pin
components/sections/CycleAuditScanForm.tsx → Flooring scan/input island (drafts + scanner; log stays in parent)
components/sections/ApplianceScanForm.tsx → Appliance scan/input island (drafts + scanner; log stays in parent)
components/admin/SundayAuditStagingCard.tsx → Glowing pending Sunday Flooring audit CTA (Sunday even if empty)
components/admin/SundayAuditAssignmentModal.tsx → Assign specialists + shift-hour balancer; Master Recalculate
components/admin/SundayScheduleCard.tsx → Settings Sunday auto-stage time + auto-run toggle
lib/store-ops/weekly-rotations.ts → Proportional clustered bay assignment plan (hours / aisle-face / health risk)
lib/store-ops/sunday-audit.ts → Persist specialist↔bay; apply balancer plan
lib/store-ops/shift-status.ts → Weekly Sun–Sat schedule + on-duty / call-out (`associate_shift_days`; localStorage caches live rows)
lib/store-ops/call-out.ts → Rebalance absent bays (pool / auto / carry-over loop; composes sunday-audit)
lib/store-ops/predictive-copilot.ts → Floor shift recommendations (logs + assignments + downstock; no Gemini)
components/store-ops/PredictiveCopilotBanner.tsx → Dismissible Floor briefing under Shift Briefing
components/store-ops/CarryOverPriorityBadge.tsx → Amber Geist Mono carry-over badge
lib/store-ops/downstock.ts → Downstock/packdown flags (`downstock_queue` live-first; assignment composes sunday-audit)
lib/store-ops/map-readiness.ts → Store Map green/yellow/red readiness tones (composes bay-health stale + week)
lib/store-ops/velocity.ts → IRP cadence tones, seed presets (14d/5d/lock), custom_decay_days, Sunday decay multiplier, async decay scores
lib/store-ops/bay-service.ts → Persist bay_service_logs + stamp last_serviced_at + promote velocity
lib/store-ops/rotation.ts → Sunday draw: carry-over prepend then velocity-priority pick (composed by rotations.ts)
lib/store-ops/audit-summary.ts → Supervisor weekly rollup composition (quota / associate / barriers)
components/store-ops/SupervisorAuditSummaryModal.tsx → Personal weekly stats + copy
lib/admin-department-context.ts       → Master Admin working department pin (local)
lib/store-ops/bay-pattern.ts          → Odd / even bay range expansion (Bulk Generator; default odd)
lib/store-ops/manager-notes.ts        → Manager notes Supabase CRUD + realtime + archive (JWT-scoped)
lib/store-ops/ai-bay-scan.ts          → Visual bay scan prompt / schema / normalize / local fallback
lib/store-ops/ai-note-extract.ts      → Floor Pad Gemini Extract Tasks & Tag prompt / schema / fallback
lib/store-ops/ai-walk-parse.ts        → Floor-walk Copilot structured task parse (voice/scratchpad)
app/api/copilot/parse-walk/route.ts   → POST walk transcript → structured tasks (Supervisor+)
lib/store-ops/shift-tasks.ts          → Dispatched walk tasks (shift_walk_tasks + localStorage)
lib/heatmap/bay-tracker.ts            → Behavior-driven bay freshness (Fresh/Warm/Stale overlay)
components/dashboard/TacticalVoiceFloorPad.tsx → Floor Walk & Talk dock + bottom sheet
components/dashboard/BayFreshnessGrid.tsx → Compact heatmap chip on Floor
app/actions/manager-notes.ts          → Server Action extractTasksAndTag (Bearer token auth)
components/manager-notes/*            → Executive Floor Pad (TipTap rich text + Copilot + archive)
components/store-ops/ManagerNotesWorkspace.tsx → Compatibility re-export of ExecutiveFloorPad
app/manager-notes/page.tsx            → Redirect → /dashboard#floor-pad
app/api/store-ops/ai-note-summary     → Retired (410 Gone); use extractTasksAndTag
supabase/migrations/20260812_manager_notes_archive.sql → manager_notes.is_archived
app/flooring/page.tsx                 → Deep link → /dashboard + Sunday drawer (no 404 hop)
app/sunday-audit/page.tsx             → Redirect → /dashboard + Sunday drawer
app/sunday-rotation/page.tsx          → Redirect → /dashboard + Sunday drawer
components/admin/AssociateRosterPanel.tsx → Sunday drawer roster (Flooring seed, job-title badges, Master override)
lib/types.ts                          → Cabinets D29 + SPECIALTY/CORE + associateFloorTitle
src/types/enterpriseIntegration.ts    → Enterprise ingest Zod contracts (topology / freight / floor-touch)
lib/enterprise-integration/ingest.ts  → JSON + safeParse transport (standardized 400; no persistence)
app/api/v1/topology/ingest/route.ts   → POST bay topology ingest stub
app/api/v1/freight/stage/route.ts     → POST freight stage event stub
supabase/migrations/20260814_cabinets_d29.sql → Seed Cabinets per store
supabase/migrations/20260814_bay_velocity_heatmap.sql → store_locations IRP columns + bay_service_logs
supabase/migrations/20260814_multi_department_access.sql → profiles + store_specialists accessible_departments + JWT match
supabase/migrations/20260815_associate_shift_days.sql → daily on-duty / call-out / shift clock + store RLS
supabase/migrations/20260815_carry_over_priority.sql → store_locations.carried_over + sunday_bay_assignments CARRIED_OVER
supabase/migrations/20260815_performance_indexes.sql → composite indexes: dept+aisle+bay, service logs by bay/time, rotations by dept+is_completed
supabase/migrations/20260815_custom_decay_days.sql → store_locations.custom_decay_days (3–21 Sunday cadence)
supabase/migrations/20260815_shift_walk_tasks.sql → shift_walk_tasks (floor-walk Copilot dispatch)
app/admin/roles/page.tsx          → Redirect → /roster
app/api/admin/department-access/route.ts → Instant accessible_departments upsert + JWT app_metadata
components/hub/DepartmentAccessChips.tsx → Roster multi-select department grants
components/hub/AdminDepartmentSwitcher.tsx → Header pill when accessible_departments.length > 1
lib/auth-session.ts               → Auth session token + inactivity lock
lib/biometric-auth.ts             → WebAuthn fingerprint / Face ID register + assert
lib/audit-report.ts               → Audit report metrics + email/clipboard composition
lib/hardware-scanner.ts           → Window-level Bluetooth/wedge barcode burst listener
lib/rbac.ts                       → Department-scoped section / catalog visibility (compose only)
lib/department-access.ts          → accessible_departments compose (primary + granted)
lib/store.ts                      → Active store_number session
lib/store-ops/stores.ts           → Resolve store_number → stores.id; upsert seed (code or store_id,code) + UUID-safe list
lib/sync-queue.ts                 → Offline queue + backoff + conflict pause + auto-flush
lib/sync-conflict.ts              → SyncConflictError + conflict event bus
lib/network.ts                    → Online/offline badge state
lib/sims.ts                       → SIMS location aggregation (compose only)
lib/markdown.ts                   → Clearance price math + badge label
lib/calc.ts                       → CLF + carton sq ft + remnant sq ft / sq yd
lib/catalog.ts / remnants.ts / storage.ts / specialists.ts → Domain persistence
lib/supabase.ts                   → Client factory
lib/store-ops/*                   → Store Operations domain (rotations, bulk map, auth bridge)
app/admin/store-map/page.tsx      → Map keep-alive tab (Visual Grid walk + Manage Aisles & Bays)
app/api/rotations/*               → Generate + complete + verify; POST /api/rotations/exceptions mid-week barriers
app/api/store-locations*          → List / patch / bulk location APIs (GET list is column-pruned for Store Map); POST /api/store-locations/service walk-the-floor log
supabase/schema.sql               → Tables + multi-category + SIMS + store_number + RBAC columns + RLS
supabase/migrations/20260809_store_operations_rbac.sql → departments, profiles, locations, weekly rotations + RLS
supabase/migrations/20260809_multi_store.sql → stores + store_id scoping
supabase/migrations/20260810_store_locations_type_unique.sql → location unique (department_id,aisle,bay,type)
supabase/migrations/20260811_alphanumeric_aisle.sql → store_locations.aisle INTEGER → TEXT (BW/RW/12/A1)
supabase/migrations/20260811_manager_notes.sql → manager_notes (S Pen canvas + AI action items)
supabase/migrations/20260812_jwt_rls_policies.sql → JWT claims hook + store/department RLS
supabase/migrations/20260816_store_locations_read.sql → open SELECT on store_locations (anon + authenticated)
supabase/migrations/20260816_rls_read_write_parity.sql → digit-equal jwt_matches_store, department aliases, authenticated carpet_* SELECT, open SELECT on Store Ops tables
supabase/migrations/20260812_manager_notes.sql → durable manager_notes (store_number/department/author) + JWT RLS
supabase/migrations/20260812_sunday_bay_assignments.sql → sunday specialist↔bay assignments + JWT RLS

## Ownership

| Concern | Owner |
|---|---|
| Navigation / section routing | `app/page.tsx` (specialty `?section=` or replace `/dashboard`) + `lib/nav-hub.ts` + `HubHeader` / `BottomNav` (Floor · Map · Roster · Settings) |
| Department RBAC / tab visibility | `lib/rbac.ts` (`HubViewRole`, `navRoleLinks` via `lib/nav-hub.ts`, `visibleFloorAuditTabs`) + `lib/department-access.ts` (granted extras) |
| Developer sandbox (UI preview) | `lib/dev-sandbox.ts` + `useDevSandbox` + `DevSandboxDrawer` / `DevSandboxBanner` (session overlay; JWT unchanged) |
| Cross-app Navigation Hub | `lib/nav-hub.ts` + `NavigationHub` + `HubHeader` + `BottomNav` (Floor · Map · Roster · Settings only; Settings hashes for former Admin Tools) |
| Department weekly quotas | `DepartmentTargetsMatrix` (blur / Save All) + `PATCH /api/departments` + Settings |
| Store Operations map + rotations | `lib/store-ops/*` + `/admin/store-map` + `/dashboard` (Visual Grid walk-only: `StoreLocationGrid` + `WalkTheFloorSheet`; Manage CRUD: `AisleBayManager` + `AddBaySheet` + `EditBayDrawer` + prune/batch; bulk velocity seed in Settings **and** Manage; floor checklist: `ZebraChecklist`; walk log: `bay-service.ts` + `POST /api/store-locations/service`; Sunday pick: carry-over prepend then `rotation.ts` velocity + `custom_decay_days`; department cron: Settings `DepartmentTargetsMatrix`; Sunday clock: `sunday-schedule.ts` + Settings `SundayScheduleCard`) |
| Sunday schedule | `lib/store-ops/sunday-schedule.ts` (time / timezone / auto-run) + `stores` columns + `/api/cron/weekly-rotation` (skip if week already staged) + Master Force Draw overwrite |
| Sunday assignments | `lib/store-ops/sunday-audit.ts` (persist + department seed `associateMatchesSundayDepartment`) + `SundayAuditAssignmentModal` + `AssociateRosterPanel` |
| Daily shift board | `lib/store-ops/shift-status.ts` (`associate_shift_days` week matrix; throws on live write failure) |
| Call-out bay rebalance | `lib/store-ops/call-out.ts` (pool / auto / carry-over loop; stamps `carried_over` + Sunday `CARRIED_OVER`; does not generate rotations) |
| Predictive Shift Copilot | `lib/store-ops/predictive-copilot.ts` + `PredictiveCopilotBanner` (local patterns; 1-tap downstock / assign) |
| Downstock / packdown queue | `lib/store-ops/downstock.ts` (flags) + Zebra Downstock tab on Floor (assign via sunday-audit) |
| Supervisor weekly rollup | `lib/store-ops/audit-summary.ts` + `SupervisorAuditSummaryModal` |
| Shift workload balancer | `lib/store-ops/weekly-rotations.ts` (pure plan: hours, clusters, health-risk priority) |
| Bay health / floor discrepancies | `lib/store-ops/bay-health.ts` + `BayHealthScorecard` (composes location cycle age + hub audits / SIMS / variance) |
| Selling vs Topstock audit mode | `lib/store-ops/audit-location-mode.ts` + `AuditLocationModeToggle` (Cycle/Department forms + Zebra filter) |
| Rotation verification / barriers | `lib/store-ops/verification.ts` + Floor **Verify completed bays** + `ExceptionFeed` + `POST /api/rotations/exceptions` |
| Manager notes / Executive Floor Pad | `lib/store-ops/ai-note-extract.ts`, `manager-notes.ts`, `app/actions/manager-notes.ts`, `components/manager-notes/*` (opened from Floor `TacticalVoiceFloorPad`; `ai-note-summary` retired 410) |
| Floor-walk Copilot / shift dispatch | `lib/store-ops/ai-walk-parse.ts` + `POST /api/copilot/parse-walk` + `lib/store-ops/shift-tasks.ts` (`TacticalVoiceFloorPad`) |
| Bay freshness overlay | `lib/heatmap/bay-tracker.ts` + `BayFreshnessGrid` (composes last_serviced_at / last_completed_at / walk touches; not velocity or bay-health) |
| Team roster (Master Admin) | `RosterTab` + `AddTeamMemberSheet` → `POST /api/roster/members` → `store_specialists`; accordion read via `fetchSpecialists`; grouping via `roster-groups.ts` (home dept, Specialist and CSA together); weekly matrix via `shift-status.ts` (`canManageShiftBoard`). Job options / `floor_title` owned by `lib/types.ts`. |
| Cross-department grants | `lib/department-access.ts` + `POST /api/admin/department-access` + Roster chips |
| Working department pin | `lib/admin-department-context.ts` (Master full-store; multi-dept clamped to grants) |
| Personal theme / density / contrast / sound / haptics | `lib/theme.ts` + `lib/ui/preferences-context.tsx` + `UserPreferencesDrawer` (all roles) |
| Audio & haptics playback | `lib/ui/feedback.ts` (`HapticsListener` taps; scan/bay/Sunday compose) |
| Store context | `lib/store.ts` + `lib/store-ops/stores.ts` (registry + Sunday schedule columns) |
| Offline sync queue | `lib/sync-queue.ts`, `lib/sync-conflict.ts`, `ConflictResolutionModal` |
| Header network / pending queue | `lib/network.ts` + `HeaderNetworkStatus` (hook isolated from hub forms) |
| Shell caching | `public/sw.js` + `ServiceWorkerRegister` |
| CLF / carton math | `lib/calc.ts` |
| Number typing UX | `lib/number-input.ts` + `NumberField` |
| Catalog knowledge | `lib/catalog.ts` |
| Store health scorecard | `lib/store-ops/health.ts`, `StoreHealthCard` |
| Shift audit velocity telemetry | `lib/store-ops/telemetry.ts`, `StoreHealthChart` |
| Zebra shift briefing | `lib/store-ops/shift-briefing.ts`, `ShiftBriefingCard` (composes health snapshot + `bay_health`) |
| Visual bay scan | `lib/store-ops/ai-bay-scan.ts`, `VisualBayScannerModal` (720p stream; JPEG q=0.70 / 960px) |
| Gemini transport | `lib/ai/gemini.ts` (`responseSchema` per caller + `GEMINI_TOKEN_BUDGET`) |
| Barcode resolve / Quick-Add | `lib/barcode.ts`, `NumberField` scan hooks, `QuickAddCatalogModal` |
| Hardware wedge (no soft keyboard) | `lib/hardware-scanner.ts` |
| Focus / keyboard dismiss | `lib/focus-input.ts` (`blurActiveInput` — never auto-focus on tab switch) |
| SIMS location stock | `lib/sims.ts`, `SimsLocationFinder` |
| Specialists session / credentials | `lib/specialists.ts`, `SpecialistModal` |
| Roster SMS/link invite + PIN setup | `lib/auth-token.ts` + `lib/onboarding/*` + `/auth/verify/[token]`. Roster-only insert is `POST /api/roster/members`. SMS invite is `POST /api/admin/invite-supervisor`. Authenticated RLS: `20260815_roster_insert_rls.sql` (includes `auth_user_id IS NULL`). Signup claims `store_specialists.auth_user_id` (`claim-roster-auth.ts` + `20260815_roster_auth_link.sql`). `SpecialistModal` does not create members. |
| Zero-access auth wall / idle lock | `lib/auth-session.ts`, `components/auth/AuthWall.tsx`, `components/auth/AccessGate.tsx` (`/login`) |
| Edge auth + stealth gate | `lib/auth-gate.ts` + `proxy.ts` + `POST /api/auth/gate` (HttpOnly cookie) |
| Enterprise ingest contracts | `src/types/enterpriseIntegration.ts` (Zod schemas). Transport: `lib/enterprise-integration/ingest.ts`. Stubs: `POST /api/v1/topology/ingest`, `POST /api/v1/freight/stage`. Does not write Store Ops tables or change hub UI. |
| Store Ops Auth (JWT → profiles) | `lib/store-ops/auth.ts`, `lib/supabase/server.ts`, `lib/supabase/browser.ts`, `link-auth-profile.ts` |
| JWT / RLS policies | `20260812_jwt_rls_policies.sql` + `20260814_multi_department_access.sql` (`jwt_matches_department_code` ORs `app_metadata.accessible_departments`) + `20260816_store_locations_read.sql` (open SELECT on `store_locations`; writes still JWT-isolated) |
| Phone SMS OTP recovery + profile link | `lib/phone-auth.ts`, `lib/phone.ts`, `POST /api/auth/phone-reset/*` |
| Biometric / WebAuthn unlock | `lib/biometric-auth.ts`, `AuthWall` |
| PIN change / default notice | `ChangePinModal` |
| Manager markdown | `lib/markdown.ts`, `ApplyMarkdownModal` |
| Variance | `lib/variance.ts` |
| Remnant aging | `lib/aging.ts` (markdown 30/60/90 + floor-ops Fresh/Watch/Critical rack bands) |
| Remnant inventory | `lib/remnants.ts` (`remnantRackAlert` composes rack badges / markdown chip) |
| Audit log + draft | `lib/storage.ts` + `lib/debounced-persist.ts` (300ms) + `CycleAuditScanForm` |
| Audit report export / print / email | `lib/audit-report.ts`, `AuditReportModal` |

## Sections (role-filtered)

1. **Flooring Audit** — dual engine (roll CLF vs carton sq ft), scan-to-catalog, SIMS tags. Scan form is `CycleAuditScanForm` (isolated from the shift log).
2. **Appliances Audit** — continuous floor scans on `appliance_scans` + UPC links on `appliance_catalog`
   - Suites: Laundry · Refrigeration · Cooking / Ranges · Dishwashers · Microwaves / Venting
   - Required `sub_category` on UPC Quick-Add and scan log
   - Scan log aggregated by SKU (Qty + expandable unit detail); sticky category filter + SKU/location search; Edit modal for qty/serials/bay
   - CSV: SUMMARY (counts/locations) + RAW DETAIL audit trail
   - Continuous mode: barcode detect → immediate `POST /api/appliances/scans`; session total counter; new items pause on Quick-Add then auto-log
   - Scan form is `ApplianceScanForm` (isolated from the accordion log)
   - APIs: `/api/appliances/catalog`, `/api/appliances/scans` (`GET|POST|PATCH|DELETE`)
3. **Universal / Appliance Catalog** — removed from bottom nav; SKU linking remains via Quick-Add / scan flows (`carpet_catalog` / `appliance_catalog`). `/catalog` redirects to `/appliances`.
4. **Remnant Rack** — Settings accordion (`#remnants`) when RBAC allows
5. **Settings** — theme, PIN, weekly targets, push, device/sync; Master: bulk / taxonomies / force rotation / store #. Floor Pad lives on Floor.

## Dual audit modes

- **Mode A (Carpet / Sheet Vinyl)** — inches + fraction + rounds → CLF (`× 0.2625`)
- **Mode B (LVP / Tile / Grout / Accessories / Hardwood / Appliances)** — box/unit count × sq ft per box (appliances: unit count only)

## Offline

Writes fall back to localStorage and enqueue into `carpet_hub_sync_queue`
(with `transaction_id`, `optimistic_at`, exponential backoff).
Mid-scan form drafts persist via `carpet_hub_audit_draft` / `carpet_hub_appliance_scan_draft` with a 300ms debounce and flush on submit / leave.
`installSyncAutoFlush` replays on `online`, tab focus, and `visibilitychange`.
Version mismatches / HTTP 409 pause for `ConflictResolutionModal` (keep local vs accept server).
The service worker caches the app shell for instant cold starts without connectivity.
Store Map / Floor / Shift Briefing hydrate from IndexedDB (`lib/store-ops/cache.ts`) then revalidate over the network; UI state updates only when the durable fingerprint changes. Bulk location writes await cache clear so a prior empty snapshot cannot hide new `PENDING` bays. `workingDepartmentId` / `GET /api/store-locations` resolve hub slugs and Lowe's codes (`flooring` ≡ `D23`) to the live `departments.id` family before filtering `store_locations`.

## Schema note

Tables retain `carpet_*` names (alias: flooring_audits / SIMS catalog) for migration
compatibility. RBAC columns on `store_specialists`: `username`, `assigned_department`,
`home_department`, `floor_title` (Specialist / CSA / Cashier / Receiving),
`must_change_credentials`; platform roles include `MasterAdmin`. Flooring CSA
and Flooring Specialist share the flooring accordion (`assigned_department` /
`home_department`); they are not separate platform roles.
