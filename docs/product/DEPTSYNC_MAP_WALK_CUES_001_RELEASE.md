# DEPTSYNC-MAP-WALK-CUES-001 — Controlled Production Release

**Status:** **RELEASED** (engineering) — **operator phone acceptance outstanding**  
**Date:** 2026-10-23  
**Mode:** Targeted hardening → validate → release → verify  
**Application:** https://deptsync-hub.vercel.app  
**Supabase:** `fmeinlwhixngednabhgy`  
**Store:** 2587

**Authority:** Operator-authorized MAP-WALK-CUES-001 production release. App commit `0d45489`. SECTION-OWNERSHIP-006 remains on this history (`22aa4ff`, docs `8d7f026`). No phone acceptance required before deploy.

**Verdict:** **GO.**

**Strict exclusions honored:** No migrations. No assignment, walkthrough, topology, ownership, coverage, standing-capacity, or publication writes. No AUTO-008 or cron change. No manual W44 publication. Unrelated untracked docs left uncommitted.

---

## 1. Release summary

Map aisle rows show two read-only chips. **Assigned** means a persisted Sunday assignment for the operational week. **Follow-up** means at least one open walkthrough follow-up at that place. A failed read is one map-level line, not a missing chip presented as “none.”

| Item | Value |
|------|-------|
| App commit | **`0d45489`** (`0d454896f0a27106c2dcb9a93d945e5b48d47fa8`) |
| Included implementation | **`27c2727`** |
| Prior `origin/main` | **`8d7f026`** |
| Migrations | **None** |
| AUTO-008 latch | Remains **`WEEKLY_ROTATION_AUTO_PUBLISH = true`** |
| Cron | Unchanged **`0 12 * * 0`** |
| Standing policy | **`d8bd92ca-97d0-42ac-9126-b6ba2a16f561`** v1 · **3/3/3/3 = 12** |

---

## 2. Assignment cue contract

The Map display contract is the bay sheet. `composeMapBayWeekContext` treats a stored associate name or a specialist id as assigned.

| Evidence | Map chip |
|----------|----------|
| Current-week rotation plus a Sunday row with a specialist id or a stored name, status not cleared | **Assigned** |
| Name-only legacy row | **Assigned**. No id is invented. |
| Cleared row, prior week, blank id and blank name | No Assigned chip |
| Open follow-up at the physical place | **Follow-up** |
| Closed follow-up, or a note with no follow-up row | No Follow-up chip |

`mapRow`, used by This Week, still requires a specialist id. This Week was not changed. A name-only legacy row can show on the Map and stay off This Week’s assignment card. Current writers blank the name when they clear a row or when they have no specialist id.

The chip does not say the work is complete. Readiness labels such as “This week” are unchanged.

---

## 3. Partial-read behavior

Assignment and follow-up reads stay independent. If one fails, its chip is withheld and the other chip still shows. One line above the aisle list (`map-cue-availability`) names the failed read:

- “Assignment information could not be loaded.”
- “Follow-up information could not be loaded.”
- “Assignment and follow-up information could not be loaded.”

A pending read and a successful empty read stay silent. The line is not repeated on each bay. Navigation is not blocked.

---

## 4. Tests and lint

| Suite | Result |
|-------|--------|
| Cue, bay sheet, Map contracts, walkthrough, This Week, store/department authz | **121 PASS** (12 files) |
| TypeScript | **PASS** |
| ESLint on the cue path | **PASS** for new code |
| `next build` | **PASS** (Next.js 16.2.12) |

`StoreLocationGrid.tsx` still reports four React hook findings that exist on `8d7f026`: a ref write during render, and three effects that set state (clear a missing aisle, reset the bay page, apply This Week focus). This release does not change those statements. They are not a cue-correctness defect. `getSundayAssignments` still warns on an unused argument. That stub was not edited.

No schema migration.

---

## 5. Deployment evidence

| Field | Value |
|-------|-------|
| Push | `8d7f026..0d45489` → `origin/main` |
| GitHub Production deployment | **`7284779617`** — state **success** |
| Vercel commit status | **success** — “Deployment has completed” |
| Vercel deployment | **`dpl_6zsZBqD6dp2qD6nr5Lj95CN94WYk`** — target **production** — **Ready** |
| Deployment host | https://deptsync-9g7c7kzcm-tyson-zauggs-projects.vercel.app |
| Alias | https://deptsync-hub.vercel.app |

Unauthenticated alias smoke (redirects not followed):

| Path | Result |
|------|--------|
| `/login` | **200** |
| `/admin/store-map` | **307** → login |
| `/dashboard` | **307** → login |
| `/overview` | **307** → login |
| `/settings?manage=rotation` | **307** → login |
| `/api/weekly-rotations` | **401** |
| `/api/walkthroughs` | **401** |
| `/api/walkthroughs?view=open-places` | **401** |
| `/api/cron/weekly-rotation` | **401** |

A signed-in Map session was not available, so the chips were not clicked on the phone.

---

## 6. Operational preservation

Pre → `tmp/map-walk-cues-001-preflight.json` · Post → `tmp/map-walk-cues-001-post.json`  
Fingerprint recipe: `store|department|week_starting|bay_id|roster|status|locked` as `0`/`1`, SHA-256, first 16 hex characters.

| Fact | Pre | Post |
|------|-----|------|
| Assignment fingerprint | `55dde8e86360caea` | `55dde8e86360caea` |
| Sunday bay assignments | 30 (12 / 12 / 6) | identical |
| W43 / W44 assignment rows | 0 / 0 | 0 / 0 |
| W43 / W44 rotations | 12 / 0 | 12 / 0 |
| Active sections × members | 4 × 160 | 4 × 160 |
| Coverage rows | 0 | 0 |
| Standing | Nate/Nick/Tracy/Tyson 3/3/3/3, policy v1 `d8bd92ca-97d0-42ac-9126-b6ba2a16f561` | identical |
| W44 weekly approvals | 0 | 0 |
| W43 weekly approvals | Nate 0, Nick 3, Tracy 3, Tyson 3 | identical |
| AUTO-008 source latch | `true` (file not in the diff) | `true` |
| Cron | `0 12 * * 0` (file not in the diff) | unchanged |

Permanent owners, unchanged: CSA → Tyson, Myself → Tyson, retired Section A → Nick, Specialist-A → Nick, Specialist-B → Tracy.

No manual W44 publication. First AUTO-008 cron remains **2026-10-25T12:00Z → 2026-W44** and is still unverified.

---

## 7. Phone acceptance

Outstanding. Confirm on a phone, while signed in:

- A bay with a current-week Sunday assignment shows **Assigned** and does not say the work is done.
- A bay with an open follow-up shows **Follow-up**. Opening the row still opens the existing bay sheet.
- A bay with neither stays unmarked.
- Readiness words such as “This week” still describe the rotation overlay.

---

## 8. Rollback

Redeploy `8d7f02677ded6f6c7d2a0b56fb2496b846720e80`. There is no schema change to roll back. Do not publish W44 as part of a rollback.

---

## 9. Verdict

**GO.** The alias serves the cue release. Operational fingerprints match. AUTO-008 and the Sunday cron were not changed.
