# DEPTSYNC-ROTATION-AUTO-008 — Automatic Sunday Publication Controlled Production Activation

**Status:** **NO-GO — ACTIVATION NOT PERFORMED**  
**Date:** 2026-10-18  
**Mode:** Operator-authorized production activation preflight (stopped before gate changes)  
**Application:** https://deptsync-hub.vercel.app  
**Supabase:** `fmeinlwhixngednabhgy`  
**Store:** 2587 · Flooring / Home Decor  

**Authority:** Operator authorization after AUTO-007 + phone acceptance · AUTO-006 activation runbook · this tranche  

**Strict exclusions honored:** Automatic publication **LEFT OFF** · no latch flip · no Production env publish gate set · no migrations · no capacity writes · no assignment writes · no Assign This Week · no Force Draw · no manual cron · no specialty · no Orient.

---

## 1. Executive summary

Operator authorized dual-gate enablement. Preflight confirms AUTO-007 is on production, the Sunday scheduler is `0 12 * * 0`, supervisor locks are live, shift-independent eligibility is live, Operational Sections are intact, and the next cron is safely far enough away (**2026-10-25T12:00:00Z**).

Activation **stopped** because the first automatic target week **`2026-W44` has zero capacity approvals**. Authoritative stage/publish requires `approvals_complete` for the target week (`loadAuthoritativeStageContext` returns `null` otherwise). Enabling gates now would leave the first scheduled Sunday fail-closed (no safe 3/3/3/3=12 publication).

| Decision | Verdict |
|----------|---------|
| Operator authorization present | **Yes** |
| AUTO-007 / scheduler / latch-OFF foundation | **PASS** |
| Future-week isolation (W44 empty) | **PASS** |
| Target-week capacity 3/3/3/3 for **W44** | **FAIL** |
| Enable code latch + env gate | **NO-GO** |
| Automatic publication | **REMAINS OFF** |

**States (mission distinction):**

| State | Status |
|-------|--------|
| ACTIVATED — AWAITING FIRST RUN | **Not reached** |
| FIRST AUTOMATIC PUBLICATION VERIFIED | **Not reached** |

---

## 2. Operator authorization

Operator explicitly authorized AUTO-008 activation following successful AUTO-007 release and phone acceptance. This report does **not** dispute authorization; it records a **blocking precondition** discovered during preflight.

---

## 3. Preflight results

| Check | Result |
|-------|--------|
| Repo / branch | `SilentSage432/carpet-auditor` · `main` @ `0a62c7b` (docs tip; app AUTO-007 **`20dcc5f`**) |
| AUTO-007 deployed | **PASS** — Production deploy `7157155776` / Vercel `FdmqooBRSFqnKxaB3Eq1SaAcqBs3` · latch false · cron `0 12 * * 0` |
| Supervisor-lock migration | **PASS** — `supervisor_locked` readable on production SBA |
| Shift-independent eligibility | **PASS** — shipped in AUTO-005B (`18f8d06`) |
| W43 capacity 3/3/3/3 | **PASS** — approvals sum **12** |
| W44 capacity 3/3/3/3 | **FAIL** — **0 approval rows** |
| Operational Sections | **PASS** — active **4** · members **160** |
| Scheduler | **PASS** — `vercel.json` `"0 12 * * 0"`; Vercel UTC; store `America/Denver`; `sunday_auto_generate=true` |
| Publication currently OFF | **PASS** — `WEEKLY_ROTATION_AUTO_PUBLISH = false` in source + production tree |
| Unrelated pending changes | **PASS** — only unrelated untracked docs (`RD_6`, `SEC_OPS_010A`, specialty); excluded |

---

## 4. First scheduled execution

| Field | Value |
|-------|--------|
| Next Vercel cron | **2026-10-25T12:00:00.000Z** |
| Local Denver | Sunday **2026-10-25 06:00 MDT** |
| Distance from preflight | ~7 days (today’s Sunday cron already passed) |
| Deploy-too-close deferral | **Not required** on timing alone |

---

## 5. Target operational week

| Field | Value |
|-------|--------|
| First auto target | **`2026-W44`** (Monday **2026-10-26**) via `sundayStagingWeekLabel` |
| Current Sunday staging week (2026-10-18) | **2026-W43** |
| Do not modify current week | Honored — no writes |

### Target-week existing work (W44)

| Asset | State |
|-------|--------|
| `weekly_rotations` active | **0** |
| `sunday_bay_assignments` | **0** |
| Manual / automatic owned | **None** |
| Supervisor locks | **None** |
| Completed / verified | **None** |

Preservation of W44 work is vacuously safe (empty). Preservation of **W43** (already owned) is not at risk from the Oct 25 cron (different week).

### Current week (W43) — already published manually / prior stage+assign

| Asset | State |
|-------|--------|
| Active rotations | **12** |
| Owned SBA (`week_starting` 2026-10-19) | **12** — Tracy 3 / Nate 3 / Nick 3 / Tyson 3 |
| Locks / completed / verified | **0 / 0 / 0** |
| Capacity approvals | **3/3/3/3 = 12** |

---

## 6. Activation changes

**None.** Latch and env gate were **not** modified.

Intended minimal change (deferred):

1. `WEEKLY_ROTATION_AUTO_PUBLISH: boolean = true` in `authoritative-week-cycle.ts`
2. Production env `DEPTSYNC_WEEKLY_ROTATION_AUTO_PUBLISH=1`
3. Update tests that assert latch `false` → assert dual-gate still requires env when latch true
4. Deploy enablement revision

Safe gate order (when unblocked): set env `=1` while latch false (no-op) **or** deploy latch true with env unset (still off), then complete the other gate — never introduce a third bypass.

---

## 7. App commit

| Field | Value |
|-------|--------|
| Activation app commit | **None** (NO-GO) |
| Production app remains | **`20dcc5f`** (AUTO-007) |

---

## 8. Documentation commit

| Field | Value |
|-------|--------|
| Contents | This NO-GO report; journal / handoff / roadmap |
| Commit | **** () |

---

## 9. GitHub workflow

| Field | Value |
|-------|--------|
| Activation deployment | **Not run** |

---

## 10. Vercel deployment

| Field | Value |
|-------|--------|
| Activation deployment | **Not run** |
| Production alias | Remains on AUTO-007 latch-OFF revision |

---

## 11. Activation gate verification

| Gate | Preflight | Post-attempt |
|------|-----------|--------------|
| Code latch `WEEKLY_ROTATION_AUTO_PUBLISH` | **`false`** | **`false`** (unchanged) |
| Env `DEPTSYNC_WEEKLY_ROTATION_AUTO_PUBLISH` | Not enabled for publish | **Not set / not flipped** |
| Dual-gate publish | OFF | OFF |

---

## 12. Production baseline

Captured read-only `tmp/auto008-baseline.json` (2026-10-18T16:49Z):

| Asset | Value |
|-------|--------|
| SBA total / owned | **42 / 42** |
| SBA fingerprint | `22cd784c27273d93` |
| Supervisor locked | **0** |
| Completed / verified | **0 / 0** |
| Sections / members | **4 / 160** |
| W43 capacity | **12** |
| W44 capacity | **0** (blocker) |
| W43 rotations / owned | **12 / 12** |
| W44 rotations / owned | **0 / 0** |
| Latch | OFF |
| Cron | `0 12 * * 0` |

Note: fingerprint differs from AUTO-007 (`b0bd2882b3aba625`) because W43 ownership was persisted after that release (phone Assign path). That is expected and not an activation mutation from this tranche.

---

## 13. Assignment preservation evidence

| Scope | Evidence | Verdict |
|-------|----------|---------|
| This tranche writes | None | **Preserved** |
| W44 | Empty | **Safe first-run canvas if approvals exist** |
| W43 owned 3/3/3/3 | Protected-id path would skip on retry | **Not targeted by next Sunday** |

---

## 14. Validation results

Preflight did **not** flip the latch; focused enablement suite was **not** re-run against a true latch (would require the deferred code change). Foundation already validated under AUTO-006/007:

| Prior evidence | Result |
|----------------|--------|
| AUTO-006 / AUTO-007 suite | **180 PASS** |
| Dual-gate contracts | Env alone ignored; cron cannot body-elevate |
| Protected-id / stewardship / capacity RPC | Covered in AUTO-003/006 |
| DB concurrency | `pg_advisory_xact_lock` inside `upsert_sunday_bay_assignments_with_capacity` |

---

## 15. Emergency disable procedure

*(Documented for when activation later succeeds; unused this tranche.)*

| Step | Action | Effect |
|------|--------|--------|
| 1 Immediate | Set Production `DEPTSYNC_WEEKLY_ROTATION_AUTO_PUBLISH` ≠ `1` | Stops publish while latch true; **no redeploy** |
| 2 Durable | Redeploy with `WEEKLY_ROTATION_AUTO_PUBLISH = false` | Latch hard-off |
| Assignments | Leave published rows intact | No wipe |
| Manual path | Assign this week / supervisor edit remain | Preserved |

Env disable is near-immediate after Vercel env propagation; latch disable waits for a production deploy.

---

## 16. First-run verification plan

*(Deferred until activation unblocked.)*

After Master Admin approves **W44** capacity **Tyson 3 / Nate 3 / Nick 3 / Tracy 3 = 12** with fresh fingerprints:

1. Re-run AUTO-008 preflight (confirm W44 `approvals_complete`).  
2. Enable latch + env; deploy; verify both gates ON.  
3. Do **not** manually invoke cron.  
4. Observe Sunday **2026-10-25** cron → expect `auto_publish_enabled: true` and `COMPLETE` / honest `PARTIAL` for **W44**.  
5. Read-only: owned counts ≤3 each; sections preserved; W43 fingerprint unchanged; Zebra still manual.  
6. Only then mark **FIRST AUTOMATIC PUBLICATION VERIFIED**.

---

## 17. Remaining risks / exact blocker

### Exact blocker (STOP)

**`2026-W44` has no rows in `store_week_capacity_approvals`.**  
Automatic publication’s authoritative path requires `capacity.approvals_complete === true`. Without W44 approvals, Oct 25 cron cannot safely compose/persist a 3/3/3/3 week.

### Operator action required (outside this agent tranche)

1. In Floor Command Master capacity UI, approve **2026-W44** at **3/3/3/3 = 12**.  
2. Confirm fingerprints are non-stale before Sunday 2026-10-25.  
3. Re-authorize / re-run AUTO-008 activation (or a named AUTO-008B tranche).

### Other residual risks (non-blocking once W44 approved)

- Hobby cron may fire anywhere in the 12:00 UTC hour (still ≥05:00 MST / ≥06:00 MDT).  
- Fingerprint drift after approval if schedules change before cron.  
- Pacific multi-TZ residual (N/A for Denver-only store).

---

## 18. GO / NO-GO verdict

| Decision | Verdict |
|----------|---------|
| Activate automatic Sunday publication **now** | **NO-GO** |
| Leave `WEEKLY_ROTATION_AUTO_PUBLISH = false` | **GO — honored** |
| Leave Production env publish gate unset | **GO — honored** |
| Migrations / capacity writes / assignment writes | **NO-GO** (honored) |
| Specialty / Orient | **NO-GO** |

### Bottom line

Automatic publication remains **OFF** on https://deptsync-hub.vercel.app. First eligible auto Sunday would target **2026-W44**, which is assignment-empty but **missing capacity approvals**. Do not enable gates until W44 is approved at **3/3/3/3 = 12**.

**STOP AFTER ACTIVATION REPORT.** Do not flip the latch. Do not set the env gate. Do not begin specialty or Orient work.
