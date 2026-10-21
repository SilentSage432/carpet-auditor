# DEPTSYNC-ALIGN-002 — Remaining Redesign Reconciliation

**Status:** COMPLETE (repository audit and documentation only)  
**Date:** 2026-10-20  
**Mode:** Audit → reconcile → prioritize. No implementation, migration, deployment, or production writes.  
**Production tip inspected:** `main` @ `233f7da` (`docs(release): record SECTION-OWNERSHIP-005 production release`)  
**Application:** https://deptsync-hub.vercel.app  
**Supabase (documented):** `fmeinlwhixngednabhgy` · store 2587

**Naming:** This file is the Floor Command redesign reconciliation. It does not replace or amend [`DEPTSYNC_ALIGN_002_CONSTITUTIONAL_RATIFICATION.md`](./DEPTSYNC_ALIGN_002_CONSTITUTIONAL_RATIFICATION.md). Historical roadmap lines are left as written at the time of each release.

**Operator acceptance recorded here:** Phone acceptance of SECTION-OWNERSHIP-002 through 005 is confirmed by the operator for this reconciliation (2026-10-20). The 002–005 release documents still say acceptance was outstanding on 2026-10-19. Those release documents were not rewritten.

**Follow-up:** OPS-OVERVIEW-002 is implemented locally (not released). Overview now composes call-out and sent-back attention and links to `/settings?manage=rotation`. See [`DEPTSYNC_OPS_OVERVIEW_002_IMPLEMENTATION.md`](./DEPTSYNC_OPS_OVERVIEW_002_IMPLEMENTATION.md). The matrix below records the gap as it was found on 2026-10-20.

---

## 1. Executive summary

The Floor Command redesign from [`DEPTSYNC_REDESIGN_001_COMPLETE_PRODUCT_EXPERIENCE_BLUEPRINT.md`](./DEPTSYNC_REDESIGN_001_COMPLETE_PRODUCT_EXPERIENCE_BLUEPRINT.md) is the product that is in production. The five surfaces are Overview, Map, This Week, Walkthroughs, and More. Operational Sections, permanent owners, temporary weekly coverage, schedule-free rotation, and focused management navigation are released. Automatic publication is enabled and has not yet had its first unattended Sunday run.

What remains is a short set of unfinished original behaviors, not a new shell:

- Overview still omits two attention sources the blueprint named (call-outs that still own bays, and sent-back work), and it does not show publication status. Publication status already lives on More → Automatic Rotation.
- This Week shows the assignee and does not say when that person is a temporary cover rather than the permanent section owner.
- Map bay sheets already carry place context. Aisle-list walking cues from MAP-001 were explicitly deferred.
- Walkthroughs can capture, follow up, revisit recent observations, and close with text evidence. Photos, offline drafts, and a full session archive stay deferred.
- Specialty geography, joint stewardship, and a separate Home Decor department stay deferred until the operator supplies decisions the repository does not contain.
- Associate login paths and the plaintext PIN fallback remain outstanding security work. They are not blocked by the October 25 publication.

The next implementation work can start now if it only reads existing evidence and does not change who Sunday will assign.

---

## 2. Original redesign scope

Authority is the blueprint, then the production sequence that actually shipped. Blueprint §L numbered a design sequence. Production reused some of those numbers for different work. Both are listed so later tranches do not restart a finished surface under the old number.

### Blueprint destination (Redesign-001)

| Intent | Source |
|--------|--------|
| Single operator, Flooring + Home Decor, team members as records | §A, §K, Constitution via ALIGN-002 ratification |
| Five tabs: Overview, Map, This Week, Walkthroughs, More | §C |
| Overview: week, attention, people, open follow-ups, quiet healthy state | §D.1 |
| Map: aisle → bay, section chip, week and follow-up context, soft-retire, history | §D.2 |
| This Week: shared 12 bays, stage → assign → perform → verify, explicit exceptions | §D.3, §F |
| Walkthroughs: observe, agree, follow up, close with evidence, no scoring | §D.4, §G |
| More: team, sections, topology, capacity, history, seasonal, settings, advanced | §D.5 |
| Sections: ≤1 active section per bay, one permanent owner, help without silent transfer | §E |
| Engine prefers section focus after sections exist | §E.2, blueprint RD-6 |
| Operator-configurable bays-per-person after a shared capacity guard | §F.3, blueprint RD-7 |
| Operator-only authentication after a dependency inventory | §K, blueprint RD-9 |
| Deterministic evidence; Floor Pad protected until FLOORPAD-001 | §D.4, REDUCE-002A |

Blueprint §L sequence (design names): RD-1 shell, RD-2 aisle-first Map, RD-3 topology reconcile, RD-4 sections CRUD, RD-5 walkthroughs, RD-6 engine section preference, RD-7 capacity UI, RD-8 team in More, RD-9 auth simplify, RD-10 visual polish.

### Production sequence (what the numbers mean in the repo)

RD-1 shell, RD-2 Map, RD-3 Operational Sections, RD-4 This Week, RD-5 Walkthroughs, then RD-6 completion audit. Topology, capacity, section-aware rotation, Zebra handoff, Overview, merged-department labels, automatic publication, and section ownership were later named programs. They are the continuation of the blueprint, not a second product.

---

## 3. Requirements reconciliation matrix

Classifications:

- **COMPLETE** — implemented, released, and accepted for the behavior described.
- **IMPLEMENTED — NOT VERIFIED** — code is on the production path, and the required acceptance evidence is still missing.
- **PARTIAL** — some of the original behavior exists.
- **OUTSTANDING** — planned and not implemented.
- **DEFERRED** — postponed by a written product decision.
- **SUPERSEDED** — replaced by a later written decision.

A route or component existing is not enough for COMPLETE.

| ID | Original intent | Current implementation | Code paths | Release / test evidence | Status | Remaining gap | Operational significance | Dependencies | Next action |
|----|-----------------|------------------------|------------|-------------------------|--------|---------------|--------------------------|--------------|-------------|
| RD-1 | Five-tab Floor Command shell; Overview is the operator home | Bottom nav is Overview, Map, This Week, Walkthroughs, More. Associates still land on This Week + Map only | `lib/nav-hub.ts`, `app/(workflow)/overview/page.tsx`, `dashboard/page.tsx`, `admin/store-map/page.tsx`, `walkthroughs/page.tsx`, `settings/page.tsx` | RD-1 released; RD-6 recorded positive mobile validation of the five-surface loop | **COMPLETE** for the operator shell. Associate chrome is the separate RD-9 row | None for the operator shell | Daily navigation | None | Maintain |
| RD-2 / Map core | Aisle → bay geography; active-only; soft-retire; no department switcher required | Aisle navigator, search, retired disclosure, section slot, week readiness | `components/hub/tabs/MapTab.tsx`, `components/admin/StoreLocationGrid.tsx`, `lib/store-ops/map-aisle-navigation.ts` | RD-2 released; MAP-001 matrix marks the navigator complete | **COMPLETE** | Floorplan geometry stays deferred | Walking the department | None | Do not rebuild Map |
| MAP-002 | Bay sheet shows place context: follow-ups, this-week assignee, history | Bay sheet order is follow-up attention, this week, walkthrough, section, history | `components/admin/WalkTheFloorSheet.tsx`, `GET /api/store-locations/bay-context` | MAP-002 release `b9ae961` / `dpl_EE2iSwmSoY3JxCNk6sYnPksLszAJ`. Phone acceptance still open in the release doc | **IMPLEMENTED — NOT VERIFIED** | Phone acceptance not recorded | Supervisor can read a bay without leaving Map | None for further code | Operator phone check when convenient. No rewrite |
| MAP-003 priorities | Supervisor marks bays to prefer next week. Intent, not an assignment | Week-bay priorities, Overview “Next week priorities” | `lib/store-ops/week-bay-priority.ts`, `lib/store-ops/overview-command.ts`, `OverviewTab.tsx` | MAP-003 release `bd9bbab` / `dpl_FV5t9Crxt9kuSRss7xgFdWLX2dWi`; migration `20261019_map_003_week_bay_priorities.sql` | **IMPLEMENTED — NOT VERIFIED** | Phone acceptance open. Walking cues were not this tranche | Influences the next draw without assigning | None | Keep. Cues are a separate row |
| MAP-WALK-CUES | Subtle place markers for “open follow-up here” and “assigned this week” | Bay sheet has the detail. Aisle/bay rows do not carry follow-up cues (`map-readiness.ts` has no follow-up marker) | `lib/store-ops/map-readiness.ts`, `StoreLocationGrid.tsx` | MAP-003 implementation explicitly defers MAP-001 walking cues | **DEFERRED** | Aisle-list cues absent | Faster walking once a bay is not yet opened | Existing walkthrough place reads and week assignments | Optional presentation tranche. Not blocked by AUTO-008 |
| MAP-004 / named zones | Document specialty places without putting them into weekly rotation by default | Named-zone codes and stack-out defaults exist. RELEASE-006 read-only snapshot: named-zone bay rows **0** | MAP-004 implementation; `store_aisles` registry | Released via RELEASE-006. Phone acceptance pending in that doc | **PARTIAL** | Codes exist; operator-confirmed bays were not present in that snapshot. No later doc records that they were created | Carpet wall / showrooms are not openable places until documented | Operator bay numbers (SPECIALTY-OPS-001 §10) | Do not invent bays |
| Pin-to-week on Map | Blueprint allowed a Map pin. MAP-003 kept it gated | `canMutate={false}` on Map. This Week remains the assignment surface | `WalkTheFloorSheet.tsx` (MAP-003 note) | Written decision in MAP-003 | **SUPERSEDED** as a Map write. Assignment stays on This Week | Dead control if still rendered | Avoids a second assignment surface | None | Leave gated |
| Floorplan / adjacency | Not required for aisle → bay | No geometry store | RD-2 / MAP-001 | Explicitly deferred | **DEFERRED** | None until the operator asks for a drawing | None for weekly operation | None | Do not build |
| Prod RD-3 / blueprint sections | Named stewardship groups, one permanent owner, ≤1 section per bay, history kept | Four sections, 160 memberships at the 005 release fingerprint. Owner changes write events. Retired sections supported | `components/admin/OperationalSectionsPanel.tsx`, `lib/store-ops/operational-sections.ts`, sections APIs | RD-3 release, OPERATIONAL-009…012, SECTION-UX-001…003. Location-creation failure was repaired by the aisle registry (TOPOLOGY-REGISTRY-004) | **COMPLETE** for singular permanent ownership | Joint stewards are a separate deferred row. Phone acceptance of early section releases was not re-confirmed in this mission | Defines who Sunday may draw for | Do not change membership before the W44 acceptance window unless the operator accepts a confounded first run | Maintain |
| Temporary coverage | Week-scoped cover without changing the permanent owner; capacity stays per person | `effectiveOwner = active cover ?? permanent`. Capacity remains associate-scoped | `supabase/migrations/20261026_section_ownership_003_week_coverage.sql`, coverage APIs, `OperationalSectionsPanel.tsx` | SECTION-OWNERSHIP-003 released `9616cc8`; migration COMMIT; coverage rows **0** at release. Operator phone acceptance confirmed 2026-10-20 | **COMPLETE** | Bay-level cover was deferred in favor of section-wide cover plus supervisor locks. This Week does not label “covering” (see SO-006) | Vacation and absence without rewriting owners | Display work can proceed. Semantic changes to the resolver should wait so W44 acceptance stays interpretable | Label covers on This Week. Do not change the resolver before Oct 25 evidence |
| SO-002 roster lifecycle | Add, soft-deactivate, reactivate, surface unfinished work, do not reclaim history | MasterAdmin lifecycle panel. Add no longer writes an on-duty shift by default | `lib/store-ops/roster-lifecycle.ts`, `app/api/roster/lifecycle/route.ts`, `app/api/roster/lifecycle/[id]/route.ts`, `components/admin/RosterLifecyclePanel.tsx` | Released `b03c15a`. No migration. Operator phone acceptance confirmed 2026-10-20 | **COMPLETE** | Supervisors cannot run lifecycle mutations. That is the written auth boundary (MasterAdmin) | Leaving associates drop out of future eligibility without deleting history | None | Maintain |
| SO-004 schedule-free experience | Shifts are not required to publish a week | More leads with roster, ownership, coverage, and rotation status. Schedules sit under Optional schedules. `/roster` remains | `components/admin/SupervisorOwnershipWorkflowCard.tsx`, `lib/store-ops/supervisor-ownership-workflow.ts` | Released `d778eac`. Operator phone acceptance confirmed 2026-10-20 | **COMPLETE** | Standing establish/revoke remains in the Sunday drawer by written limitation | Stops schedule maintenance as a weekly chore | None | Do not relocate standing writes before the first unattended run |
| SO-005 focused navigation | Open means a focused management view, not a scroll | `/settings?manage=team\|ownership\|coverage\|rotation` with Back | `lib/store-ops/supervisor-management-nav.ts`, `components/admin/SupervisorFocusedManagementView.tsx`, `components/admin/SupervisorRotationStatusPanel.tsx` | Released `ea898d2` / GitHub Production `7188220431`. Operator phone acceptance confirmed 2026-10-20 | **COMPLETE** | Hub cards remain below the workflow for browsing. Unsaved-edit warning covers section editor modes only | Supervisor reaches ownership and coverage in one tap | None | Maintain |
| SO-006 This Week cover label | Ownership-001 required This Week to show permanent vs covering when a cover is active | Sections list shows “Covering {week}”. `this-week-ownership.ts` has no cover field | `lib/store-ops/this-week-ownership.ts`, `components/store-ops/ThisWeekOwnershipBoard.tsx` | Not implemented after 003/004 | **PARTIAL** | Assignee name without a cover vs owner distinction | Matters the first week a cover is used. Production coverage count was 0 at the 005 release | Read existing coverage rows. No resolver change | Small display tranche. Safe before Oct 25 if it cannot write |
| Blueprint RD-6 / OPERATIONAL-011 | Weekly draw prefers the section’s responsible associate and does not fill across sections | Section-balanced stage plus strict ownership RPC | `lib/store-ops/sunday-dispatch.ts`, ownership RPC migration `20261018_operational_011_section_ownership.sql` | OPERATIONAL-012 released `26d48ba`. AUTO-002…008 carry the same planner | **COMPLETE** as engine behavior. First unattended publication is a separate row | Phone acceptance of OPERATIONAL-012 itself was not re-confirmed here | Wrong owner is a failed publication, not a UI miss | Do not change the RPC before W44 evidence | Maintain |
| AUTO-001…007 | Find the W42 miss, balance by section, publish only through a dual gate, make shifts non-gating, correct the cron | Path is section-balanced stage → stewardship → capacity RPC → This Week. Cron is Sunday 12:00 UTC | `vercel.json` cron `0 12 * * 0`, `app/api/cron/weekly-rotation/route.ts`, `lib/store-ops/authoritative-week-cycle.ts` | AUTO-005 `57e3ab3`, AUTO-005B `18f8d06`, AUTO-007 `20dcc5f` / GitHub Production `7157155776` | **COMPLETE** as the released publisher foundation | None in the publisher design | Sunday no longer depends on a shift grid | None | Maintain |
| AUTO-008 activation | Unattended Sunday publication of the upcoming week from standing capacity | Code latch `WEEKLY_ROTATION_AUTO_PUBLISH = true`. Env gate still required (`DEPTSYNC_WEEKLY_ROTATION_AUTO_PUBLISH=1`). Standing v1 documented as Tyson/Nate/Nick/Tracy 3/3/3/3 | `lib/store-ops/authoritative-week-cycle.ts` lines 61–90, `vercel.json`, AUTO-008 activation report | Enablement deploy `a62084b` / GitHub Production `7159528967`. Standing policy id `d8bd92ca-97d0-42ac-9126-b6ba2a16f561` recorded 2026-10-18. W44 assignments were empty at enablement and still empty at the 005 release fingerprint | **IMPLEMENTED — NOT VERIFIED** for the publication itself. Enablement is released | **FIRST SCHEDULED PUBLICATION VERIFIED** is open. Next cron **2026-10-25T12:00:00Z** → **2026-W44** | This is the acceptance event for automatic publication | Execution evidence after the cron. Not a reason to hold read-only UI | Do not publish W44 by hand. Do not change cron, latch, or standing capacity |
| AUTO-008A/B standing capacity | One standing 3/3/3/3 policy materializes future weeks. Explicit week overrides win | Schema and MasterAdmin establish path released. Operator established v1 | AUTO-008A/B docs, Sunday drawer | AUTO-008B `5c36621` / GitHub Production `7159272550`; migration COMMIT | **COMPLETE** as the standing policy mechanism | General “set N for everyone” UI from blueprint RD-7 was not built. Standing per-person approvals superseded that as the operator control | 12-bay shared pool for the merged department | Do not edit the policy before Oct 25 | Leave the policy at 3/3/3/3 |
| AUTO-009 | Isolated proof that the publisher can write a 3/3/3/3 week, retry idempotently, and fail closed | Local disposable database `deptsync_auto009_accept_53992`. Assert log records 12 owned W44 rows, retry skipped 12, protected work kept, coverage did not multiply capacity | `tmp/auto009-asserts.out`, `tmp/auto009-db-evidence.json`, timestamp `2026-10-19T10:18:51Z` | SECTION-OWNERSHIP-002/003 releases cite this simulated acceptance. The SQL file is **not** on `main` (003 release: stashed, absent from the tip) | **COMPLETE** as isolated acceptance. It is **not** production publication | No production W44 rows are claimed | Raises confidence in the publisher. Does not close AUTO-008 | None | Do not treat tmp output as Sunday’s result |
| Prod RD-4 / This Week | People-first weekly board: ownership, completion, verification, explicit recovery | Board, command summary, complete / verify / barrier / +1 paths | `components/hub/tabs/FloorTab.tsx`, `components/store-ops/ThisWeekOwnershipBoard.tsx`, `lib/store-ops/this-week-ownership.ts` | RD-4 released. Later zebra and ownership releases kept this board | **COMPLETE** for the weekly execution board | Cover label missing (SO-006). Distinct sent-back row is not an Overview attention kind | Where the week is worked | None | Compose missing labels. Do not add a second board |
| Shared 4×3 capacity | One pool of 12 across Flooring + Home Decor, never two departmental ×3 draws | Merged `flooring` department. Standing sum 12. Shared capacity guard exists. Dual-department auto-stage remains off | `lib/store-ops/sunday-dispatch.ts`, capacity-guard docs, ALIGN-DEPT-001 | CAPACITY-GUARD-003 released. ALIGN-DEPT-001 released `57334ee` for merged labels only | **COMPLETE** for the merged department. Separation is its own row | A second live department would still need an operator cutover | Prevents a silent 24-bay week | Operator aisle map before any split | Do not enable a second department |
| ALIGN-DEPT / blueprint RD-3 topology | Active Map equals the operator’s Flooring and Home Decor geography | Merged label “Flooring / Home Decor”. No persisted aisle partition. No `home_decor` department registration | ALIGN-DEPT-001 implementation, `lib/nav-hub.ts` merged label | Released as merged-model coherence. TOPO-001 §L still unresolved | **PARTIAL** | Which aisles are Flooring, Home Decor, or neither is not in the repo | The merged map can be operationally true and still not answer a split | Operator mapping. Not AUTO-008 | Keep the merged model until that map exists |
| Topology registry | Create an aisle before its first bay | `store_aisles` plus Create Location. Empty aisles merge onto Map | TOPOLOGY-REGISTRY-001…004 | Registry migration applied (002B). App `b702b94`. Phone acceptance was awaiting at that release | **IMPLEMENTED — NOT VERIFIED** | Phone acceptance of empty-aisle creation not recorded in this mission | Needed only when adding geography | None | Use when the operator documents a real aisle |
| Prod RD-5 / Walkthrough core | Session, observation, optional follow-up, close, Overview inbox, no scoring | Dedicated tables. Inbox: attention, open follow-ups, needs-decision, recent observations, recently completed | `components/hub/tabs/WalkthroughsTab.tsx`, `lib/store-ops/walkthroughs.ts`, `app/api/walkthroughs/**` | RD-5 released. RD-6 included walkthroughs in the validated loop. Later WALK releases added behavior whose phone acceptance is still open | **COMPLETE** for the RD-5 loop. Later polish is the WALK rows | Observations are not themselves open/resolved rows. That is a written contract | Leadership record beside the week | None | Do not create a second task system |
| WALK-002…004 | Map starts a place-bound observation; form is fast; section owner is shown, not reassigned | Map Record Observation prefills place. Capture sheet is the walk form | `components/walkthroughs/WalkthroughCaptureSheet.tsx`, `WalkTheFloorSheet.tsx` | WALK-004 released `d810605` (recovered Vercel deploy). Phone acceptance pending in the release doc | **IMPLEMENTED — NOT VERIFIED** | Phone acceptance open | Walk starts at the bay | None | Operator phone check. No new capture model |
| WALK-005…006 | Add a follow-up after the observation; close with text evidence; opportunities without a follow-up are a decision list, not open work | Observation detail can add a follow-up via the existing POST. Close requires evidence or notes. Overview attention stays overdue follow-ups only | `components/walkthroughs/ObservationDetailSheet.tsx`, `FollowUpCloseSheet.tsx`, `app/api/walkthroughs/follow-ups/route.ts`, `app/api/walkthroughs/follow-ups/[id]/route.ts` | WALK-006 released `cbaac90` / `dpl_BvF6rSuu7Lbw5KAh1ouSF3z6qwvh`. Phone acceptance pending | **IMPLEMENTED — NOT VERIFIED** | No photo. No separate verify state beyond `done`. Inbox is a bounded recent window, not a full archive | Unresolved commitments are follow-ups | None | Use the existing close path. Archive and photos stay deferred until the operator asks |
| Walkthrough photos / offline / voice / scoring | Optional later, or banned | Text evidence only. Floor Pad remains the freeform voice/notes surface. No scoring UI in the walkthrough inbox | `FollowUpCloseSheet.tsx`, `components/manager-notes/ExecutiveFloorPad.tsx` | WALK-001 §13 and WALK-005 §10 defer photos, offline drafts, and voice. Scoring is banned | **DEFERRED** (photos, offline, voice, archive). Scoring is out of product | Close is text-only | Text is enough unless the operator says otherwise | FLOORPAD-001 before any Floor Pad redesign | Do not add a parallel notes system |
| OPS-OVERVIEW-001 | Overview answers week status, attention, people, and follow-ups from real evidence | Week progress line, attention (no plan, unowned, awaiting verification, barriers, overdue follow-ups), people with verified/owned counts and a dominant section label, open follow-ups, review hint, next-week priorities, quiet “Week on track” | `components/hub/tabs/OverviewTab.tsx`, `lib/store-ops/overview-command.ts` | Released `4023b0b` / GitHub Production `7071174830`. No migration | **PARTIAL** | Blueprint §D.1 also named call-outs that still own bays, and incomplete / sent-back work. Those kinds are absent (`OverviewAttentionKind` has five values, none of them call-out or sent-back). Approved capacity is not on the strip (written deferral: This Week owns approvals). Publication status is on More, not Overview | The landing page can look calm while a sent-back bay or a call-out still owns work | Read paths that already exist (`is_call_out`, completion attempts’ `SENT_BACK`, `composeSupervisorRotationStatus`). No new score | OPS-OVERVIEW-002, read-only |
| Overview publication status | Supervisor can see whether the upcoming week is published | `SupervisorRotationStatusPanel` composes latch, standing, and published count. Copy says enablement is not proof of this week’s publication | `lib/store-ops/supervisor-ownership-workflow.ts`, `components/admin/SupervisorRotationStatusPanel.tsx` | Shipped in 004/005 and phone-accepted with those tranches | **COMPLETE** on More. **PARTIAL** if the question is “does Overview show it?” | Overview has no publication line | The status already exists one navigation away | Link only. Do not recompute | A link from Overview is enough |
| ZEBRA-HANDOFF | Record that the supervisor typed the bay into Zebra. Do not read Zebra status | Per-bay “Not entered” / “Entered in Zebra”, copy aid, supervisor confirm. Owner change clears the stamp. Summary count is labeled operator-recorded | `supabase/migrations/20261017_zebra_handoff_002_sunday_bay_entry.sql`, `app/api/rotations/zebra-entry/route.ts`, `lib/store-ops/zebra-handoff.ts`, `ThisWeekOwnershipBoard.tsx` | ZEBRA-004 released `ef593f0` / deploy `7014109854`. Phone acceptance pending in that doc. Overview already says “Zebra entry is operator-recorded only” | **IMPLEMENTED — NOT VERIFIED** | Phone acceptance not recorded. No Zebra API exists, by decision | Manual handoff is understandable on This Week | None | No integration. Operator phone check |
| SPECIALTY-OPS-001 | Carpet wall is shared, continuous, and not a weekly rotation. Do not invent remnant or sheet-vinyl workflows | Discovery only. Everyday specialty launchers already disconnected (REDUCE-004). Named zones ready; specialty bay rows were 0 at RELEASE-006 | `docs/product/DEPTSYNC_SPECIALTY_OPS_001_DISCOVERY.md` | Discovery complete 2026-10-15. Implementation **NO-GO** until operator answers | **DEFERRED** | S0–S4 not started. Joint stewardship not authorized | Specialty work is invisible on Map until places exist | Operator decisions §10, not AUTO-008 | Keep off the active build list |
| Joint stewardship | Two durable stewards for one section (carpet wall) | Singular `primary_owner_specialist_id` only. AREAS-001 deferred joint stewards | `operational_sections` owner column | Written deferral in TOPOLOGY-AREAS-001 and SPECIALTY-OPS-001 S4 | **DEFERRED** | Schema not designed into a migration on `main` | Misstates Nick + Tracy only if carpet wall is forced into one owner | Operator GO plus a migration | Do not add the table in the next tranches |
| Blueprint RD-7 capacity UI | Operator sets bays per person; default 3; one pool | Standing per-person approvals (0–3) plus explicit week overrides. Default practice is 3/3/3/3 | Sunday drawer, AUTO-008A | Standing policy established by MasterAdmin | **SUPERSEDED** as a single global N control, by standing per-person policy | UI still lives in the Sunday drawer | Changing it changes Sunday’s volume | Leave unchanged until after W44 evidence | Do not relocate the write control yet |
| Blueprint RD-8 team in More | Roster is not a primary tab | Team is More → `?manage=team`. `/roster` is the optional schedule board | `lib/nav-hub.ts`, `app/(workflow)/roster/page.tsx` | RD-1 plus SO-004/005 | **COMPLETE** | Schedule board still exists on purpose | People management without a sixth tab | None | Maintain |
| Blueprint RD-9 / operator-only auth | Only the operator authenticates. Team rows are records | PIN-only AuthWall (AUTH-006). Associate, invite, and pair routes still exist. Associates still receive a reduced nav | `app/login/page.tsx`, `app/pair/page.tsx`, `app/invite/page.tsx`, `lib/nav-hub.ts` `isSimplifiedAssociateView` | AUTH-006 released via RELEASE-006. AUTH-003…005 WebAuthn archived and superseded. Associate-path retirement not done | **PARTIAL** | Dependency inventory (RD-6 AUTH-SIMPLIFY-000) not written. Disable not done | Extra login surface the constitution does not want | Separate security GO. Not blocked by AUTO-008. Disabling accounts is not part of the next three tranches | Inventory before any disable |
| SEC-OPS plaintext fallback | Remove plaintext PIN equality after hashed credentials are the only live path | Writers closed (SEC-OPS-009). Fallback retirement doc: flag not verified in Production; operator login after disable still pending | `docs/product/DEPTSYNC_SEC_OPS_010_FALLBACK_RETIREMENT.md`, `lib/auth-token.ts` | SEC-OPS-009 shipped `dbf6847`. Fallback doc status remains **OPERATOR LOGIN PENDING** | **OUTSTANDING** | Disable not verified | Credential fallback still in the login path | Its own runbook. Not AUTO-008 | Do not flip it inside a UI tranche |
| SEC-OPS-010 operational authority | Mutations check the actor, including rotation assign department scope | Authz matrix released. Distinct from plaintext fallback | `docs/product/DEPTSYNC_SEC_OPS_010_IMPLEMENTATION.md` | Released `0cad9e3` / GitHub `7074861353`. Closes THESIS T-3 | **COMPLETE** as the released authz hardening | Later routes must keep the same pattern | Stops cross-department assignment writes | None | Maintain on new routes |
| FLOORPAD-001 | Decide Floor Pad storage before retiring or redesigning it | Walkthroughs use dedicated tables (RD-5). Floor Pad remains protected freeform notes | `components/manager-notes/ExecutiveFloorPad.tsx`, REDUCE-002A | RD-5 closed the storage question for walkthroughs. Floor Pad retirement remains deferred | **DEFERRED** for retirement. Walkthrough storage decision is **COMPLETE** | Two capture surfaces remain, by protection | Floor Pad is not the walkthrough inbox | Do not redesign Floor Pad in the next tranches | Leave it |
| CI-001 | Pull-request typecheck, test, and build | No `.github/workflows` | repository root | RD-6 recorded the gap. Still absent on 2026-10-20 | **OUTSTANDING** | No PR gate | Engineering safety, not a supervisor task | None | Separate from the next product tranches |
| RD-10 visual polish | Token, empty, and accessibility pass | Themes exist, including Royal Amethyst. A destination-wide pass was not executed | `lib/theme.ts` | Blueprint RD-10 and RD-6 place it after core gaps | **DEFERRED** | Not blocking operation | Comfort | After attention and cover labels | Do not start as the next tranche |
| Offline verify / walkthrough writes | Optional resilience | Complete and Sunday assign can queue. Verify, barriers, walkthrough writes, and stage stay online-only | RD-6 §H | Explicitly deferred unless field pain | **DEFERRED** | Online-only leadership actions | Fine on store connectivity | Field evidence | Do not queue authority actions without a design |
| Legacy specialty runtime | Everyday chrome retired; runtime disposition undecided | Appliances, catalog, flooring, and remnant routes still exist. Everyday launchers disconnected | `app/appliances/page.tsx`, `app/catalog/page.tsx`, `app/flooring/page.tsx` | REDUCE-004. SPECIALTY-OPS-001 decision 8 still open | **DEFERRED** | Dormant code remains | Not on the supervisor’s weekly path | Operator keep / revive / delete | Do not delete in this program |
| Legacy admin routes | Historical scheduling and admin surfaces | `/sunday-rotation`, `/sunday-audit`, `/verify-rotation`, `/admin/exceptions`, `/admin/roles`, `/admin/supervisors` still have pages | `app/sunday-rotation/page.tsx` and siblings | UX-REDUCE demoted everyday entry. No dependency-backed deletion plan in this audit | **PARTIAL** | Reachable history and admin pages remain | Low if More is the operator path | Prove no caller before any removal | Do not delete from this reconciliation |

---

## 4. Completed and accepted capabilities

Accepted here means released, and either included in the RD-6 operator mobile validation of the five-surface loop or explicitly phone-accepted by the operator on 2026-10-20.

- Floor Command shell and the five operator destinations.
- Aisle → bay Map, including active-only geography and soft-retire.
- Operational Sections with singular permanent owners and preserved membership history.
- Associate roster lifecycle (add, soft-deactivate, reactivate, unfinished work left for an explicit reassignment).
- Temporary weekly section coverage that does not change the permanent owner and does not multiply capacity.
- Schedule-free publication: shifts do not gate eligibility (AUTO-005A/B), and More no longer leads with the schedule (004/005).
- Focused More views for Team, Section Ownership, Weekly Coverage, and Automatic Rotation.
- This Week ownership, completion, verification, barriers, and manual Zebra confirmation as a released board. Zebra’s phone acceptance is still open; the board itself is the accepted weekly surface from RD-4 / RD-6.
- Section-balanced, ownership-checked weekly planner.
- Standing capacity 3/3/3/3 for store 2587, established by MasterAdmin.
- Merged Flooring / Home Decor labels and a shared 12-bay pool for that one department.
- Walkthrough domain: capture, follow-up, text close, Overview inbox. Incremental WALK-004 and WALK-006 phone acceptance remains unverified.
- Operational authorization hardening (SEC-OPS-010, the authz tranche).
- AUTO-009 isolated end-to-end acceptance on disposable database `deptsync_auto009_accept_53992` (2026-10-19). That acceptance is not a production publication.

---

## 5. Outstanding work

| Item | Why it is outstanding |
|------|------------------------|
| AUTO-008 first unattended publication | Enabled and scheduled. No execution evidence exists. Target is 2026-10-25T12:00Z → 2026-W44 |
| Overview call-out attention | Blueprint §D.1. `OverviewTab` has no call-out composition |
| Overview sent-back attention | Completion attempts store `SENT_BACK`. Overview attention kinds do not include it. This Week collapses a sent-back bay to open unless it is again awaiting verification |
| This Week cover vs permanent label | Specified in SECTION-OWNERSHIP-001 §12. Sections UI has it. This Week composer does not |
| Map walking cues | Deferred presentation. Bay sheet already shows the same facts |
| MAP-002, MAP-003, MAP-004, WALK-004, WALK-006, ZEBRA-004, TOPOLOGY-REGISTRY-004 phone acceptance | Release docs still say pending. This mission confirmed acceptance only through SECTION-OWNERSHIP-005 |
| Operator-only login | Associate, invite, and pair paths remain |
| Plaintext PIN fallback disable | Runbook not closed. Operator login after disable is still pending in SEC-OPS-010 fallback retirement |
| Repository CI | No GitHub Actions workflow |
| Home Decor separation | No operator aisle map and no confirmed department code |
| Specialty places | No confirmed bay documentation in the RELEASE-006 snapshot, and no later evidence that rows were created |

---

## 6. Deferred work

These stay deferred. This reconciliation does not promote them onto the active build list.

| Item | Why it was deferred | Where |
|------|---------------------|--------|
| Specialty S0–S4, including joint stewardship | Operator has not answered place, membership, and steward questions. Remnant and sheet-vinyl workflows were **NO-GO** | SPECIALTY-OPS-001 |
| Separate Home Decor department and aisle partition | TOPO-001 §L unanswered. Merged model is the released architecture | ALIGN-DEPT-001 |
| Bay-level temporary coverage | Section-wide cover plus supervisor locks were the chosen model | SECTION-OWNERSHIP-001 §5 |
| Section workload targets separate from person capacity | Would change the capacity model | SECTION-OWNERSHIP-001 §9 |
| Walkthrough photos, offline drafts, voice drafts, full session archive | Text close and the recent inbox were accepted as sufficient until the operator says otherwise | WALK-001 §13, WALK-005 §10 |
| Floor Pad retirement or redesign | Protected until FLOORPAD-001. Walkthroughs already have their own tables | REDUCE-002A, blueprint §J |
| Floorplan geometry | No store of adjacency | MAP-001 |
| Map pin-to-week | Assignment stays on This Week | MAP-003 |
| Global bays-per-person control | Standing per-person policy replaced it | AUTO-008A |
| WebAuthn login | Product requirement withdrawn | AUTH-006 supersedes AUTH-003…005 |
| Offline verify queue | Only if field pain appears | RD-6 |
| Visual-system pass (blueprint RD-10) | After operational gaps | RD-6 §L |
| Specialty runtime deletion | Operator has not chosen keep, revive, or delete | RD-6 §M, SPECIALTY-OPS-001 decision 8 |
| Bulk-setup-003, PERF-LOAD-003 | Explicitly not started | MASTER_ROADMAP |

---

## 7. Dependencies and blockers

### Actual blockers

| Blocker | What it blocks | What it does not block |
|---------|----------------|------------------------|
| No execution evidence for the 2026-10-25 cron | Claiming W44 was published. Manual publication. Cron or standing-capacity edits. Changes to the ownership resolver, section membership, or coverage semantics that would alter what that cron writes | Read-only presentation of data that already exists |
| No operator aisle/bay partition | A Home Decor department cutover and any claim that Map currently distinguishes the two departments | Operating the merged department |
| No specialty operator answers | Creating carpet-wall bays, joint stewards, or remnant/sheet-vinyl features | Walkthroughs on bays that already exist |
| Plaintext-fallback runbook | Disabling the fallback | Every UI tranche |
| No dependency inventory | Turning off associate login | Leaving current login as it is |

### Not blockers

Overview attention composition, This Week cover labels, and Map walking cues do not need the Sunday cron, a migration, or a new department map. They read evidence the app already stores.

Production operational data is not required to design those three. It is required before anyone claims a particular aisle is Home Decor or that W44 published.

---

## 8. Recommended implementation sequence

Do not start these from this document. They are the next three small tranches when an implementation is authorized.

Publisher inputs stay frozen through the first unattended run: cron, latch, standing 3/3/3/3, coverage semantics, section membership, and the ownership RPC. The tranches below are presentation over existing reads.

### 1. OPS-OVERVIEW-002 — Attention the landing page still omits

| Field | Content |
|-------|---------|
| Objective | Make Overview match Redesign-001 §D.1 for call-outs that still own bays, and for sent-back work that is not yet verified again. Point at publication status instead of recomputing it |
| User-facing improvement | The supervisor sees those interruptions on Overview, with the existing deep links to This Week, Map, and More → Automatic Rotation |
| Reuse | `overview-command.ts`, `OverviewTab.tsx`, This Week plan, `is_call_out` on shift rows, completion-attempt `SENT_BACK`, `composeSupervisorRotationStatus` / `/settings?manage=rotation` |
| Boundaries | Read-only. No new attention score. No schema. No publisher, capacity, or ownership write. Do not count “needs follow-up decision” as open work. Do not treat Zebra confirmation as completion. Fail honest when a read fails, the way priorities already do |
| Dependencies | None on the October 25 cron |
| Acceptance | A call-out who still owns bays appears. A latest `SENT_BACK` on an unverified bay appears. Verified bays do not. Empty evidence stays “Week on track”. Publication line links to the existing rotation panel and does not claim a week is published merely because the latch is on. Focused composer tests pass |
| Release risk | Low if Overview still renders when the new reads fail. Medium if a thrown fetch blanks the landing page |

### 2. SECTION-OWNERSHIP-006 — Cover label on This Week

| Field | Content |
|-------|---------|
| Objective | When an active coverage row exists for the displayed week, This Week says the assignee is covering, and names the permanent owner |
| User-facing improvement | A cover week is visible on the board the supervisor already uses, not only inside section detail |
| Reuse | Coverage read already used by `OperationalSectionsPanel.tsx`. `this-week-ownership.ts` and `ThisWeekOwnershipBoard.tsx` for labels only |
| Boundaries | No change to `effectiveOwner`, the RPC, standing capacity, or published rows. No label when coverage is absent. Do not invent a cover |
| Dependencies | None on October 25 if the change cannot write. Production coverage was 0 at the last fingerprint, so the label stays quiet until a cover exists |
| Acceptance | Permanent-only weeks look unchanged. A fixture cover shows “Covering” plus the permanent owner and does not change bay counts. Capacity tests still expect one personal budget |
| Release risk | Low. The hazard is an accidental import of the publisher. Keep the diff in the This Week composer and board |

### 3. MAP-WALK-CUES-001 — Place cues on the aisle list

| Field | Content |
|-------|---------|
| Objective | Show the deferred MAP-001 cues on bay rows: assigned this week, and open follow-up at this place |
| User-facing improvement | Walking an aisle shows where to stop before the bay sheet is opened. The sheet remains the detail |
| Reuse | `map-readiness.ts`, existing week assignment overlay, walkthrough place follow-ups already loaded for MAP-002 |
| Boundaries | Presentation only. No new task type. No section chips on aisle tiles (previously rejected as clutter). No floorplan. No Zebra inference. No assignment from Map |
| Dependencies | None on October 25. Useful before specialty bays exist, on ordinary bays |
| Acceptance | A bay with an open follow-up shows a place cue and still opens the existing follow-up block. A bay with no follow-up does not. Assigned-this-week stays distinct from follow-up. Overdue attention remains Overview’s job |
| Release risk | Low. Clutter is the product risk, not data loss |

### Explicitly not next

Specialty builds, Home Decor cutover, joint-steward migration, plaintext-fallback disable, associate-login removal, Floor Pad redesign, standing-capacity edits, and any manual W44 publication.

---

## 9. Evidence references

| Topic | Path |
|-------|------|
| Blueprint | `docs/product/DEPTSYNC_REDESIGN_001_COMPLETE_PRODUCT_EXPERIENCE_BLUEPRINT.md` |
| Constitutional ALIGN-002 (different document) | `docs/product/DEPTSYNC_ALIGN_002_CONSTITUTIONAL_RATIFICATION.md` |
| Completion audit | `docs/product/DEPTSYNC_RD_6_PRODUCT_COMPLETION_AUDIT.md` |
| Map reconciliation | `docs/product/DEPTSYNC_MAP_001_ROADMAP_RECONCILIATION.md` |
| Walkthrough discovery | `docs/product/DEPTSYNC_WALKTHROUGHS_001_DISCOVERY.md` |
| Ownership discovery | `docs/product/DEPTSYNC_SECTION_OWNERSHIP_001_DISCOVERY.md` |
| Ownership releases | `docs/product/DEPTSYNC_SECTION_OWNERSHIP_002_RELEASE.md` through `005_RELEASE.md` |
| AUTO-008 | `docs/product/DEPTSYNC_ROTATION_AUTO_008_ACTIVATION.md` |
| AUTO-009 isolated evidence | `tmp/auto009-asserts.out`, `tmp/auto009-db-evidence.json` (not a committed SQL file on `main`) |
| Overview | `docs/product/DEPTSYNC_OPS_OVERVIEW_001_IMPLEMENTATION.md` |
| Zebra boundary | `docs/product/DEPTSYNC_ZEBRA_HANDOFF_001_DISCOVERY.md`, `DEPTSYNC_ZEBRA_HANDOFF_002_IMPLEMENTATION.md` |
| Specialty deferral | `docs/product/DEPTSYNC_SPECIALTY_OPS_001_DISCOVERY.md` |
| Merged department | `docs/product/DEPTSYNC_ALIGN_DEPT_001_IMPLEMENTATION.md` |
| Plaintext fallback | `docs/product/DEPTSYNC_SEC_OPS_010_FALLBACK_RETIREMENT.md` |
| Cron | `vercel.json` (`0 12 * * 0` → `/api/cron/weekly-rotation`) |
| Latch | `lib/store-ops/authoritative-week-cycle.ts` (`WEEKLY_ROTATION_AUTO_PUBLISH = true`; env still required) |
| Current production docs tip | `233f7da` on `main` |

Paths checked present on 2026-10-20: the five workflow pages, `OverviewTab.tsx`, `WalkthroughsTab.tsx`, `MapTab.tsx`, `WalkTheFloorSheet.tsx`, `OperationalSectionsPanel.tsx`, `RosterLifecyclePanel.tsx`, `ThisWeekOwnershipBoard.tsx`, `SupervisorRotationStatusPanel.tsx`, `SupervisorFocusedManagementView.tsx`, walkthrough and roster lifecycle routes, zebra-entry route, weekly-rotation cron route, coverage migration `20261026_section_ownership_003_week_coverage.sql`, zebra migration `20261017_zebra_handoff_002_sunday_bay_entry.sql`.

No production functionality in this document is claimed from source inspection alone. Release commits and the AUTO-008 / 005 fingerprints are the production evidence. Phone acceptance of 002–005 is the operator’s statement in this tranche, not a line in those release files.

Tests were not re-run. Implementation status was not ambiguous between the source and the release reports.

---

## 10. Open product decisions requiring operator input

1. After 2026-10-25T12:00Z, confirm whether W44 published unattended. That confirmation is evidence, not a design choice. Do not publish it manually to create the evidence.
2. Which aisles and bays are Flooring, which are Home Decor, and which are neither? Required before any department split.
3. Specialty: which zones get real bay numbers; whether `CLOTHING` is created; whether showrooms stay non-rotating; whether carpet wall joins a section; whether joint stewardship is authorized. Sheet vinyl, remnants, and dormant-runtime deletion stay unanswered.
4. Are walkthrough photos, offline drafts, or a full session archive actually needed? Current text close and the recent inbox are the shipped tool.
5. Should associate login, invite, and pairing be retired after an inventory, or kept for a reason the constitution does not record?
6. When should the plaintext PIN fallback be disabled, using the existing SEC-OPS-010 fallback runbook?
7. Is MasterAdmin-only roster deactivate still acceptable for the single operator? 002 chose that boundary on purpose.

---

## Stop

Reconciliation only. No feature implementation, production data change, migration, deploy, AUTO-008 edit, W44 publication, standing-capacity edit, ownership edit, historical delete, or new integration was performed.
