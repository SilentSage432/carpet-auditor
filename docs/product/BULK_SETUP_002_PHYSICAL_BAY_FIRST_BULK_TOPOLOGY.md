# BULK-SETUP-002 — Physical-Bay-First Bulk Topology Setup

> **Mode:** Authorized bounded implementation.  
> **Baseline:** `main @ 93b88b0` — `docs: audit bulk bay generator`  
> **Date:** 2026-09-18  
> **Archaeology:** [`BULK_SETUP_001_BULK_BAY_GENERATOR_ARCHAEOLOGY.md`](./BULK_SETUP_001_BULK_BAY_GENERATOR_ARCHAEOLOGY.md)  
> **Not started:** BULK-SETUP-003, RBAC-TOPO-001, UX-REDUCE-008.

Normal Bulk Generator now asks about **store geography**, not database surface-row representation. AI Pre-Flight is retired from this path. Schema, engine, Map, Floor, verification, and RBAC are unchanged.

---

## 1. Baseline

| Item | Truth |
|------|--------|
| Branch | `main` → `origin/main` |
| HEAD before | `93b88b0` |
| Worktree | Clean except untracked `tmp/` |
| Evidence | BULK-SETUP-001 |

No STOP condition fired.

---

## 2. BULK-SETUP-001 findings acted upon

| Finding | Action |
|---------|--------|
| Location Type radios expose coverage-era surface choice | **Retired** from mounted Bulk UI |
| Normal create should be BOTH | **Internal** `NORMAL_BULK_SURFACE_TYPES` |
| Preview speaks location rows/tags | **Reworded** to physical bays |
| AI Pre-Flight optional / not essential | **Retired** UI + unique Gemini consumer |
| Add Bay already BOTH | **Untouched** |
| RBAC-TOPO-001 DS UI / Master API | **Untouched** (documented) |
| One-surface / schema | **Preserved** |

---

## 3. Old Bulk mental model

```text
Department · Aisle · Bay range · Odd/Even · Location Type · Generate
(+ AI Pre-Flight messy-text path)
Preview / success: "N locations" / "N tags"
```

User chose Selling+Topstock / Selling only / Topstock only as if surfaces were independent coverage units.

---

## 4. New Bulk mental model

```text
Department · Aisle · Bay range · Odd/Even · Physical-bay preview · Create
(+ optional CSV batch; Clean-Up for prune)
```

DeptSync internally creates SELLING + TOPSTOCK for each physical bay.

---

## 5. Location Type disposition

| Before | After |
|--------|-------|
| Mounted radios on Manual + Clean-Up | **Removed** |
| User-selected BOTH / SELLING / TOPSTOCK | Manual + Clean-Up use BOTH surfaces internally |
| CSV `types` column | **Preserved** for power-user compatibility (not redesigned) |

No Advanced disclosure added to preserve old radios.

---

## 6. Internal BOTH behavior

```text
expandBayNumbers(start, end, odd|even)  → physical bay numbers
        ↓
types: ["SELLING", "TOPSTOCK"]
        ↓
buildBulkLocationRows / POST /api/store-locations/bulk upsert
```

Constant: `NORMAL_BULK_SURFACE_TYPES` in `lib/store-ops/bulk-mapping-session.ts`.

---

## 7. Underlying surface-model preservation

Unchanged: `store_locations.type`, unique `(department_id, aisle, bay, type)`, physical-bay grouping, Map Sell/Top secondary presence, verification fan-out, API `types` array acceptance, one-surface `buildBulkLocationRows` compatibility.

No migration. No production row mutation. No schema/RLS change.

---

## 8. Preview correction

| Surface | Language |
|---------|----------|
| Manual pattern line | `{N} physical bays: 1, 3, 5…` (`data-testid="bulk-physical-bay-preview"`) |
| Success | `{N} physical bays saved · {dept} · {aisle}` |
| CTA | Create physical bays |
| Clean-Up match | physical bay count primary; surface row count secondary |
| Intro | “Each physical bay is created with selling and topstock automatically.” |

---

## 9. Odd / Even behavior

Unchanged semantics: `expandBayNumbers` steps by 2 on the selected face **before** surface expansion. Odd 1–10 → physical 1,3,5,7,9 → 10 surface rows (5×2).

---

## 10. AI Pre-Flight disposition

| Layer | Disposition |
|-------|-------------|
| Bulk Generator AI tab / state / Confirm path | **Removed** |
| `aiParseLocations` client helper | **Removed** |
| `POST /api/store-locations/ai-parse` | **Removed** |
| `lib/store-ops/ai-parse.ts` | **Removed** |
| Shared `lib/ai/gemini.ts` transport | **Kept** |
| Floor Pad / parse-walk / bay-scan / flooring insights | **Kept** |

`BulkGeneratorActionSource` retains deprecated `"ai"` only for fail-closed close policy.

---

## 11. AI-specific Gemini consumer disposition

Unique consumer fully retired. Surviving Gemini inventory: **4** (3 API routes + 1 Server Action) — parse-walk, ai-bay-scan, flooring insights, manager-notes Floor Pad action.

`GEMINI_TOKEN_BUDGET.parse` key left in transport as unused budget slot (no broad AI cleanup).

---

## 12. Protected Floor Pad Gemini result

Floor Pad Server Action and Walk & Talk `parse-walk` remain on shared transport with `isGeminiConfigured()` gates. More → Floor Pad launcher unchanged.

---

## 13. Deterministic / manual setup result

Normal topology create works **without Gemini**: Manual form + optional CSV. No natural-language replacement parser added.

---

## 14. Duplicate / conflict safety

Unchanged upsert on `(department_id, aisle, bay, type)`. Re-running a bay updates existing siblings to PENDING. Partial sibling: creating BOTH on a Selling-only bay adds missing TOPSTOCK via upsert (existing behavior). No new normalization invented.

---

## 15. One-surface compatibility

Existing one-surface rows still load. Map/engine tolerate them. Bulk UI no longer creates them on the normal path; CSV may still specify types; server still accepts one-surface `types` arrays.

---

## 16. Add Bay consistency

`AddBaySheet` still hardcodes `["SELLING","TOPSTOCK"]`. Not modified. Same normal assumption as Bulk.

---

## 17. Map / More boundary

No Priority Lock, High, velocity radios, assignment, or verification returned to Bulk. Velocity seed remains hardcoded `standard` (`priority_override: false`).

---

## 18. Priority default

New bulk rows: `priority_override: false`, `velocity_tier: standard`, `custom_decay_days: 14`. Map remains canonical High/Standard control.

---

## 19. RBAC-TOPO-001 preservation

DS may still open Bulk UI; create/delete APIs remain `requireSuperAdmin`. **Not fixed here.** Separate known decision.

---

## 20. Rotation preservation

No changes to Sunday generate, 3-bay quota, +1, carryover, seasonal, velocity selection, Current Attention.

---

## 21. Verification preservation

BAY-UNIT-002 fan-out unchanged. BOTH-created bays remain one coverage unit.

---

## 22. User decision count before / after

| | Before | After |
|--|--------|-------|
| Manual decisions | Department, Aisle, Start, End, Pattern, **Location Type**, Generate | Department, Aisle, Start, End, Pattern, Create |
| AI path | Extra | **Gone** |
| Modes | Manual / AI / Clean-Up | Manual / Clean-Up |

Every remaining normal decision is geography (or the act of create).

---

## 23. Files changed

| Path | Change |
|------|--------|
| `components/admin/BulkLocationGenerator.tsx` | Physical-bay UI; no Location Type; no AI |
| `lib/store-ops/bulk-mapping-session.ts` | `NORMAL_BULK_SURFACE_TYPES`; physical-bay copy |
| `lib/store-ops/client.ts` | Removed `aiParseLocations` |
| `app/api/store-locations/ai-parse/route.ts` | **Deleted** |
| `lib/store-ops/ai-parse.ts` | **Deleted** |
| `lib/store-ops/bulk-setup-002.physical-bay-first.test.ts` | **Added** |
| Gemini / snap / snag / topo-ux001 contracts | Consumer counts + copy assertions |
| Living docs + this report | Updated |

---

## 24. Tests

`lib/store-ops/bulk-setup-002.physical-bay-first.test.ts` plus updated TOPO-UX-001 / Gemini ownership / UX-REDUCE-007 / BAY-UNIT-002 focused suites.

---

## 25. Validation

Focused suites green; full `npm test`, `npm run typecheck`, `npm run build` at closeout; secret scan on changed files.

---

## 26. Schema / production safety

| Item | Status |
|------|--------|
| Migration | None |
| Schema / RLS | None |
| Production mutation | None |
| Topology normalization | None |

---

## 27. Samsung acceptance plan

**More / Topology**

1. Open More → Department Setup → Bulk Generator.  
2. Confirm no Location Type radios.  
3. Confirm AI Pre-Flight gone; no stale AI chrome.  

**Normal creation** (only if legitimate setup needed)

4. Enter aisle/bay range; confirm preview says **physical bays**.  
5. Confirm Odd/Even natural.  
6. Confirm no Priority Lock / High.  
7. Create only real topology; confirm Map shows bays normally.  

**Existing**

8. Existing bays display; Map High/Standard unchanged.  

**Floor / Floor Pad**

9. Floor unchanged; Floor Pad reachable; AI path if naturally used.  

**RBAC**

10. Do not treat DS-open / Master-create as a new regression — RBAC-TOPO-001.

---

## 28. Remaining topology / setup debt

- **RBAC-TOPO-001** — DS can open Bulk; Master-only write  
- CSV optional `types` still allows one-surface power-user creates  
- Unused `GEMINI_TOKEN_BUDGET.parse` slot  
- Clean-Up remains in Bulk sheet (admin prune; physical-bay language)

---

## 29. Final assessment

BULK-SETUP-002 delivers the smallest evidence-backed setup truthfulness change: **physical geography in, BOTH surfaces out of the user’s way, AI convenience removed from topology setup.** It does not reopen UX reduction, does not change rotation law, and does not require schema work.

---

## Direct answers

**A.** Yes.  
**B.** Yes.  
**C.** SELLING + TOPSTOCK (`NORMAL_BULK_SURFACE_TYPES`).  
**D.** Yes — two sibling rows per physical bay.  
**E.** Yes — load/engine/API compatibility retained.  
**F.** No.  
**G.** Yes.  
**H.** Yes.  
**I.** Yes.  
**J.** Yes — route + helper + client removed.  
**K.** Yes — unchanged.  
**L.** Yes.  
**M.** Yes — Standard / `priority_override: false`.  
**N.** Yes.  
**O.** Yes — Add Bay untouched and BOTH.  
**P.** Yes.  
**Q.** Yes.  
**R.** Yes.  
**S.** Yes.  
**T.** Yes.  
**U.** Yes.  
**V.** No.  
**W.** Device smoke of Bulk UI language + no AI chrome; create only if real topology needed; Floor Pad reachability.  
**X.** No meaningful leftover implementation-only choice on the normal path (CSV types remain optional power-user).  
**Y.** No.  
**Z.** Not required for core setup truthfulness; only if field evidence demands CSV/RBAC follow-ups.
