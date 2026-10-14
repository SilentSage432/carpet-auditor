# DEPTSYNC-RELEASE-006 — AUTH-006 + MAP-004 Production Release

**Status:** RELEASED — AWAITING PHONE ACCEPTANCE  
**Date:** 2026-10-14  
**Mode:** Controlled production release (app-only; no migrations)  
**Store:** 2587  
**Application:** https://deptsync-hub.vercel.app  

**Implements:**  
- [`DEPTSYNC_AUTH_006_SIMPLIFICATION.md`](./DEPTSYNC_AUTH_006_SIMPLIFICATION.md)  
- [`DEPTSYNC_MAP_004_IMPLEMENTATION.md`](./DEPTSYNC_MAP_004_IMPLEMENTATION.md)

**Strict exclusions honored:** AUTH-003 independent WebAuthn not merged/deployed; no Supabase migration; no credential reset; no MasterAdmin/RLS changes; no assignment/section/priority/observation mutations; section-aware Sunday auto-stage remains **HARD OFF** in code.

---

## Verdict

### **GO** — production app release complete

Production alias serves commit `dcf6191` (includes AUTH-006 `49f9b35` + MAP-004). Operator phone acceptance pending.

---

## 1. Released commits

| Field | Value |
|-------|--------|
| Repository | `SilentSage432/carpet-auditor` |
| Branch | `main` |
| AUTH-006 | **`49f9b35`** — `fix(auth): AUTH-006 PIN-only login — remove biometric UI` |
| MAP-004 | **`dcf6191`** — `feat(map): MAP-004 specialty named zones default to non-rotating SHOWROOM_STACKOUT` |
| Prior tip | `d54d968` |
| Push | `d54d968..dcf6191` → `origin/main` |
| Ahead of origin before push | Exactly these 2 commits (no unrelated commits) |
| Working-tree dirt | Untracked only: `DEPTSYNC_RD_6_*`, `DEPTSYNC_SEC_OPS_010A_*`, `tmp/` — **not pushed** |

### Diff scope (no schema)

Release range touches AuthWall PIN-only UI, biometric-auth UI-retirement note, MAP-004 aisle/location defaults + copy/tests, and product docs. **No** `supabase/migrations/*`, **no** RLS SQL, **no** credential writers.

---

## 2. GitHub / Vercel deployment

| Field | Value |
|-------|--------|
| GitHub Production deployment | **`7068711232`** (sha `dcf6191`) |
| Deployment state | **success** (`Deployment has completed`) |
| Vercel deployment | **`DWpgp4AydN4hDy4W5uFFvPFvNzUH`** |
| Vercel URL | https://deptsync-jhllnarg7-tyson-zauggs-projects.vercel.app |
| Vercel status page | https://vercel.com/tyson-zauggs-projects/deptsync-hub/DWpgp4AydN4hDy4W5uFFvPFvNzUH |
| Creator | `vercel[bot]` (GitHub → Vercel; no in-repo workflow YAML) |
| Production alias | https://deptsync-hub.vercel.app |
| Alias verification | `GET /login` **200**; protected routes **307→login**; APIs **401**; WebAuthn options **404** |

---

## 3. Preflight tests (exact)

| Suite | Result |
|-------|--------|
| Focused AUTH + MAP + ownership + eligibility | **12 files / 131 PASS** |
| Includes | `auth-002.reliability`, access-gate/hub bootstrap, auth-gate align, `map-004.named-zones`, section membership/ownership, week-bay-priority, section-aware rotation, weekly-stage-draw, workspace-cleanup eligibility, section-ux-002 named zones |
| `tsc --noEmit` | **PASS** |
| ESLint (release-touched sources) | **PASS** |
| `next build` | **PASS** — no `/api/auth/webauthn/*` routes |

If any of the above had failed, deploy would have stopped. None failed.

---

## 4. AUTH-003 exclusion evidence

| Artifact | On `main` / production deploy? | Archive |
|----------|--------------------------------|---------|
| `app/api/auth/webauthn/**` | **No** (prod `GET …/login/options` → **404**) | `archive/auth-003-independent-webauthn` @ `a4ac66b` |
| `20261020_auth_003_webauthn.sql` | **No** | Archive only |
| `@simplewebauthn/*` in package files | **No** | Archive only |
| Independent biometric session mint endpoints | **No** | Archive only |
| Archive branch merged | **No** | Preserved, not deployed |

Dormant `lib/biometric-auth.ts` remains in tree for local helper history; AuthWall does **not** import it. Prod login UI has no fingerprint CTAs (browser + JS scan: `Resume with fingerprint` / `Sign in with fingerprint` / `loginWithWebAuthn` absent). A bundled `WebAuthn` string may appear from the dormant helper — not an AUTH-003 login surface.

---

## 5. AUTH-006 verification (production)

| Check | Result |
|-------|--------|
| Login page loads | **200** — title “DeptSync · Sign in” |
| PIN primary UI | Username + **Password / PIN** + **Log In** (browser snapshot) |
| Fingerprint buttons / enroll prompts | **Absent** |
| Hub-bridge empty body | **400** — pin required (AUTH-002 intact) |
| Hub-bridge bad credentials | Rejected (no mint) |
| Gate unauth | Fail-closed |
| Protected routes | `/dashboard`, `/admin/store-map`, `/overview`, `/walkthroughs`, `/roster`, `/settings` → **307** login |
| MasterAdmin / RLS | Untouched by release diff |

---

## 6. MAP-004 verification

| Check | Result |
|-------|--------|
| Named specialty codes | `CARPET-WALL`, `SHOW-L`, `SHOW-R`, `CLOTHING` → default `SHOWROOM_STACKOUT` on create (tests **PASS**) |
| Numeric aisles | Remain `STANDARD` / rotation-eligible by default |
| Existing locations reclassified? | **No** — app-only default on **new** creates; no backfill SQL |
| Prod named-zone bay rows | **0** (registry shells: `CARPET-WALL`, `SHOW-L`, `SHOW-R` present; `CLOTHING` not in registry yet) |
| Carpet wall rotation | Remains non-rotating when bays added (stack-out default); joint Nick/Tracy stewardship **not rewritten** |
| MAP-002 bay-context API | Unauth **401** (route live) |
| MAP-003 week-bay-priority API | Unauth **401** (route live); priority rows **0** |
| Section-aware auto-stage | `SECTION_AWARE_ROTATION_AUTO_STAGE = false` (unchanged) |

**Note:** Store row `sunday_auto_generate` was already `true` with `sunday_auto_stage_time=23:59:00` before this release. RELEASE-006 did **not** change that setting. Product invariant for section-aware auto-stage remains hard-off in application code.

---

## 7. Operational invariants (read-only)

| Invariant | Observed |
|-----------|----------|
| Active Operational Sections | **4** |
| Section members | **160** |
| `sunday_bay_assignments` | **38** |
| Week capacity approvals | **4** (W42 sum **11**) |
| Week bay priorities | **0** |
| `store_aisles` | **24** |
| Named specialty location bay rows | **0** (no silent rotation-eligible specialty bays) |
| Migrations applied this release | **None** |

---

## 8. Production smoke

| Check | Result |
|-------|--------|
| Alias `/login` | **200** |
| PIN UI present / fingerprint absent | **PASS** (browser) |
| Protected HTML routes | **307→login** |
| Store-locations / bay-context / week-bay-priority / sections / week-capacity | **401** |
| AUTH-003 webauthn options | **404** |
| Hub-bridge validation | **400** |
| Map surface gate | `/admin/store-map` **307→login** (loads behind auth) |

No production assignments, sections, priorities, or observations were altered.

---

## 9. Operator phone acceptance checklist

1. Open https://deptsync-hub.vercel.app/login on phone.  
2. Confirm **PIN/password** login only — no fingerprint/resume/enroll controls.  
3. Sign in with known PIN; confirm session resume after idle/background.  
4. Confirm logout returns to login; protected tabs require auth.  
5. Open **Map** — aisle→bay navigation and MAP-002 bay sheet still work.  
6. Confirm MAP-003 **Prioritize for Next Week** still available for supervisors (no unexpected priority rows).  
7. If creating bays under `CARPET-WALL` / `SHOW-L` / `SHOW-R` / `CLOTHING`, confirm they are **showroom stack-out** (not weekly rotation).  
8. Confirm sections still **4×160**, capacity unchanged, Sunday section-aware auto-stage still off.

---

## 10. STOP

Release complete. **Do not begin another feature tranche** from this mission. Await phone acceptance before further Floor Command work.
