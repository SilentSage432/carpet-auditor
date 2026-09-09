# DeptSync Hub — Development Journal

## 2026-09-08 — RUNTIME-COMPAT-001: code that wrote to columns production never had

Three operator-facing actions were broken against the live database, and all
three broke the same way: the code wrote a column that does not exist. Nothing
here is a migration. Production's schema was inspected read-only and treated as
the authority; the code was moved to it.

**Barrier reporting wrote a table shape that was never deployed.**
`insertRotationBarriers` sent `bay_id`, `cycle_number`, `assigned_week`, and
`reported_by`. Production's `rotation_exceptions` has `rotation_id`,
`department_id`, `location_id`, `reason`, and `logged_by`. Every barrier report
therefore failed, which is why the table holds zero rows — Art. V.1.7 says
barriers must not silently disappear from operational truth, and they had never
arrived in the first place.

Production's hand-made shape turned out to be the better one. A barrier belongs
to the rotation attempt it interrupted; week and cycle are reachable through
`rotation_id → weekly_rotations` and were only ever denormalized copies. The
runtime input already carried both `rotationId` and `locationId`, so this was a
writer correction, not a schema gap. `RotationException` was corrected to match,
which surfaced two UI readers — the Map barrier overlay and the supervisor
rollup — that had been reading `bay_id` and getting `undefined` forever. Both
wanted the location id, and both now say so.

**Verify All worked and then reported that it had failed.**
The bay loop verified correctly, and then `stampDepartmentWeekVerified` wrote
`departments.last_verified_week` / `last_verified_at`, which do not exist. The
supervisor saw an error over genuinely verified work. The stamp was deleted
rather than replaced: those fields are derived, and `buildVerificationSummary`
now computes them from the week's active rotations — the week counts as verified
only when every one of them carries a real `VERIFIED_COMPLETE`, using the
existing `isRotationVerifiedComplete` predicate rather than a second copy of the
rule (Art. VII.2). `is_completed` alone is a report, not a verification.

**Edit Bay Save wrote `store_locations.department_code`.** There is no such
column; there is `department_id`, which the same patch already set. The invalid
write was removed and nothing was added.

**Two readers were hiding all of this.** `listRotationExceptions` filtered
`rotation_exceptions.assigned_week` and then treated the resulting
"does not exist" error as *no exceptions this week* — indistinguishable from a
clean week. It now resolves the week relationally through the rotation and lets
errors surface. The verification queue read `sunday_bay_assignments.assigned_week`
(production has `week_starting`, a date) and discarded the error entirely,
silently losing every associate name; it now converts the label with the
existing `isoWeekToMondayDate` helper, scopes by store, and throws.

**Three fallbacks were removed because they had become the hazard they were
written to prevent.** `completeWeeklyRotation` retried without the review
columns when they appeared missing — and a row carrying `is_completed` with no
`verification_status` resolves as `VERIFIED_COMPLETE`, so the location closed as
`COMPLETED` with nobody having verified it. `updateRotationRow` in
`rotation-review.ts` had the same strip-and-retry on the verify and send-back
paths. Superseding fell back to a hard `DELETE` when `superseded_at` looked
absent, destroying the history that superseding exists to keep. Production has
all of these columns, so none of the three was still a compatibility path; each
now fails closed. The surviving `superseded_at` guards are read-side re-queries
and were left alone.

The new test suite models production's actual column lists and rejects unknown
columns the way PostgREST does, so the pre-repair payloads fail against it. A
permissive fake is what let these three defects ship.

911 tests / 63 files pass (from 893/62); typecheck and build pass; lint at exact
baseline parity, 114 (95 errors, 19 warnings), the new suite contributing zero.
No migration was written or applied and no production row was mutated.

---

## 2026-09-08 — THESIS-001A: the two ways verification authority leaked

Two defects, one law. Both let something other than a supervisor's judgment
create DeptSync's verified-complete state, and each argued for a different kind
of fix.

**The first was a branch that only checked authority when asked to.**
`POST /api/rotations/verify` called `requireSupervisorOrAdmin` inside
`if (reviewAction)`. Omit `review_action` and the request fell through to a
legacy batch path that wrote `is_completed`, `VERIFIED_COMPLETE`, `verified_at`,
`verified_by`, and `store_locations.status = COMPLETED` — after requiring nothing
but an authenticated session. `isDeptFloorActor` includes `associate`, so the
lowest-privilege actor in the product could close a bay it had just reported.

The tempting fix is one line: move the role check up. That would have left the
branch alive, and the branch was the problem. It had no runtime caller — its only
client wrapper, `verifyWeeklyRotationBatch`, was called by nothing — and every
legitimate job it nominally served already has a better-scoped owner: barrier
reporting goes through `POST /api/rotations/exceptions`, and bulk close goes
through `verify_all`. So it was removed, following A1.10's precedent that
**obscurity is not a control**. The authority gate now wraps the whole method,
which means the fail-closed property is structural rather than a property of
whichever branch you happen to land in.

The same reasoning ran one level deeper. The acceptance law named *direct helper
call* as a bypass, so leaving the `completedRotationIds` loop inside
`verifyWeeklyRotations` would have satisfied the route-level law while preserving
the machinery underneath it. The loop is gone, and what remains — the
`departments.last_verified_*` stamp — is now called `stampDepartmentWeekVerified`,
because a function named `verifyWeeklyRotations` that cannot verify anything is a
name that lies about its own authority.

**The second defect was subtler, and it is the one worth remembering.**
`/api/rotations/complete` derived `autoVerify` from the live session's role. That
is correct for someone standing at a bay. It is wrong for the offline queue,
which replays a completion recorded hours earlier, under whatever session happens
to be signed in when connectivity returns. An associate reports six bays offline;
a DS picks up the device; the queue flushes; six bays become DS-verified without a
supervisor ever looking at them. Nothing was forged. Every individual step was
behaving as written.

The instinct is to make the payload carry its origin — it already holds
`specialist_id` and `specialist_role`. But Art. XVIII.3 says actor authority
outranks client assertion, and those are client strings. Trusting them to *grant*
auto-verify would rebuild the same defect with extra steps. The queue simply does
not persist anything the server can re-authenticate, and the honest response to
missing provenance is to stop claiming it: **a replayed completion never
auto-verifies.** A DS's own offline work now returns as reported-complete and
waits in their own queue — one extra tap, in exchange for a verification record
that always means a supervisor decided.

What makes this safe rather than merely conservative is an asymmetry worth
naming: the `replayed_from_queue` marker can only *withhold* authority. Role
still comes exclusively from the server-resolved actor, so forging the flag
de-escalates the forger, and omitting it grants nothing the live session did not
already have. A client claim that can only reduce privilege is safe to accept;
one that can raise it never is.

**One guard needed a resolver it was tempting to reuse.** Hardening
`verifyPendingRotation` and `sendBackWeeklyRotation` against out-of-order
transitions meant reading current state — and `resolveVerificationStatus` was
right there. It infers `VERIFIED_COMPLETE` from `is_completed` when the column is
absent, which is reasonable for reads and wrong for guards: on a pre-migration
database every associate submit would look already-verified, and DS verification
would refuse work it should close. The guards read the raw column instead, and
treat an empty value as "two-stage review isn't represented here" and stand down.
A guard that infers state can manufacture the transition it exists to prevent.

Production schema was not confirmed — there is no CLI, no `config.toml`, and no
database tooling in the repository, and reaching for the service-role key in
`.env.local` is not a code tranche's business. So the repair was built to be
correct either way, which is a better outcome than a verified assumption. Worth
recording separately: `supabase/schema.sql` predates verification entirely, so
the incremental migrations are the declared truth, not that file.

Residual, reported and deliberately not fixed: a Master Admin can still set
`store_locations.status = "COMPLETED"` through the topology `PATCH` route. That
writes cool-down state, not `verification_status`, so it cannot forge the
`verifiedComplete` metric — which reads the raw column — and it sits inside
Art. III.1 administrative authority. Bounded and recorded beats quietly changed.

## 2026-09-08 — SNAP-RETIRE-001: retiring Bay Audit Validate

The tempting version of this tranche is one missing prop. Floor opens the
scanner with a department id and no rotation id, so every row lands orphaned;
supply the rotation id and the whole lifecycle appears to snap back into place.
That reading is wrong, and it is wrong in a way worth writing down, because the
next person to look at this code will see the same one-line fix.

**Repair is a product build wearing a bug's clothing.**

The decision tranche asked what Snap Bay's job actually was, and the answer came
back from the prompt, the schema, and the gate all at once: let a Gemini verdict
block a bay from being marked complete. That is not a broken feature. That is
Article X — generative AI must not determine "completion state as operational
truth" — and it is Appendix B row B, which pre-refuses almost this exact
proposal under the heading "auto-verify bays above 95% confidence." Wiring the
rotation id would have moved the capability from harmlessly severed to actively
violating the Constitution. The gate was armed and disconnected, and the fix
everyone would reach for is the one that connects it.

So the deciding question was never "is the lifecycle broken." It was "does the
job deserve to exist," and three more findings said no.

The photo is thrown away. Not lost to a bug — never stored, because `rg` for
`storage.from` and `.upload(` returns nothing in this repository. There is no
object-storage subsystem at all. So the `image_url` column and the `<img>` in
the supervisor modal were a facade over a value that could only ever be null,
and a later DS could learn "the model said FAIL" but never "here is what the bay
looked like." Repairing provenance was not a repair; it was a subsystem.

There is no field evidence, and — this is the part that closed the door — there
could not have been. The row was unreadable and the photo discarded, so a DS
could have used this every day for a month and left no trace of whether it
helped. That is also why INSUFFICIENT EVIDENCE was not an available answer. You
cannot run a field experiment on a loop that terminates at a display drawer; you
would have to build the repair first and validate afterwards, which is exactly
the leapfrogging the plan prohibits. Choosing "insufficient evidence" would have
meant authorising the expensive option in order to decide whether to authorise
the expensive option.

And the decision already has an owner. Article VI.2 makes physical supervisor
verification the strongest evidence DeptSync recognises, and the two-stage review
queue with its coaching send-back already asks whether the work was really done
properly. Snap Bay proposed a weaker, unauditable second opinion on the same
question.

Before deleting anything I re-verified all fifteen premises at HEAD rather than
trusting the decision report. `validateBayAudit` still had one caller. Both maps
feeding the completion gate were still permanently empty — `setAuditByRotation`
is called twice, only ever to *delete* keys, and the external map's callback
early-returns on the rotation id it never receives. The dependency still ran
audit → scan and never the reverse, which is what made the separation safe.

What came out: the route and its now-empty `app/api/ai` tree, the prompt and
rubric schema and normalizer and local fallback, the contracts and their
directory, the persistence helper, `validateBayAudit`, `BayCompleteGatedError`,
the modal's persisting branch and three props, Floor's audit state and its Snap
Bay action, the checklist's dead gate state and its model-verdict override
button, the FAIL gate and its 422 response, the rotation-review join, and the
verdict chip and photo that never rendered.

What deliberately did **not** go in: a replacement. No stricter role check, no
deterministic score, no other gate. The product job was rejected, not the
implementation, and it would be easy to reintroduce the same authority wearing
deterministic clothes, so a contract test now asserts the completion route holds
no `score` / `verdict` / `rubric` / `threshold` / `confidence` in executable
code. Two of my first assertions failed against the repository's own prose —
they matched a comment explaining why the gate was gone — which was a fair catch
and became a `readCode` helper that strips comments before asserting on
behaviour. An assertion that a comment can satisfy is not an assertion.

The actor-scope hole the decision tranche found closed itself. The validate route
scoped the department to the actor's store but never called
`assertActorCanAccessDepartmentId`, unlike the completion route, so any signed-in
actor including an associate could write a row against any department in their
store. It was not patched. The unnecessary authority path was removed, which is
the same move AI-RETIRE-001 made with the snag dispatcher.

`bay_audit_logs` stays. No migration, no drop, no deleted or rewritten rows, no
normalised verdicts, no fabricated rotation ids or image URLs, no inferred
confirmation state, no backfilled provenance. It is historical persistence with
no runtime owner now, and that is the correct outcome rather than a loose end.

The Floor button was the one genuine judgement call. Three options: remove it,
convert it to the ephemeral scan, or keep it as-is. Converting looks like the
gentlest option and is actually the largest — it would hand Visual Bay Scan a
fourth mount it does not have today, and Visual Bay Scan's own product value is
still unproven and owned by UX-005F. Deciding it belongs on Floor is a product
decision, not retirement cleanup. So the entry came out with the capability it
opened, and whether Floor should host an ephemeral scan is recorded as a UX-005F
follow-up. The Floor drawer opens on five actions now, and UX-005C's Samsung
acceptance — already pending — has to be run against five rather than six. I
amended that contract test instead of deleting it, so the drawer's history stays
legible.

Visual Bay Scan is untouched and, more importantly, not re-dispositioned.
Retiring the persisting sibling is not a verdict on the ephemeral one. Its route,
prompt, schema, shared token budget, and all three mounts survive, the shared
modal is ephemeral by contract everywhere now, and its status remains FIELD
EVIDENCE NEEDED.

Gemini is down to five consumers: four API routes plus one Server Action. Six
and five were both true a week ago for different reasons, and they are still
different counts, so the test now asserts both numbers separately.

**Accepted and closed 2026-09-08.** Reviewed with no standalone field gate —
every removed downstream behavior was already dead — but the Floor drawer now
opens on five actions instead of six, so that change rides on UX-005C's
still-pending Samsung acceptance rather than a duplicate gate of its own. The
one thing worth carrying forward from this tranche is not the deletion list. It
is this:

**A dead capability can still carry architectural risk when a missing
connection would activate an authority path the product should not have.**

Snap Bay wrote no reachable row, gated no reachable completion, and rendered no
read-back. By every runtime measure it was inert, which is exactly why it
survived four prior audits as a low-priority cleanup item. It was in fact the
most dangerous Gemini surface in the repository, because one missing prop stood
between it and a model verdict blocking authoritative work — and that prop was
the fix any reasonable engineer would have shipped on sight. Severance is not
safety. When auditing dead code, ask what authority it would hold if someone
connected it, not what it does today.

## 2026-09-08 — AI-SAFETY-001 bounded Gemini transport

The three tranches before this one asked whether a Gemini capability deserved
to exist. This one asked nothing about product value at all. It asked what
happens to a Department Supervisor standing in an aisle when the model simply
does not answer.

The answer was: they wait, for as long as the platform allows.

I started from code rather than from the previous audit, and the count moved.
GEMINI-001 recorded nine live call paths; AI-REDUCE-001, AI-REDUCE-002, and
AI-RETIRE-001 have since closed three, so HEAD has **six** — Pre-Flight parse,
Floor-Walk Copilot, Executive Floor Pad extract, Flooring Insights, Visual Bay
Scan, and Bay Audit Validate. Worth stating precisely because the two obvious
phrasings disagree: that is five API routes plus one Server Action. Six
consumers, five routes. `callGeminiFlashJson` has exactly six invocation sites,
and `lib/ai/gemini.ts` is the only runtime importer of `@google/generative-ai`
in the entire repository. There is no bypass to classify.

The premise held, but the reason it held was not what I expected. DeptSync does
not hand-roll a REST call to Gemini — it uses the official SDK, so "no timeout"
is a statement about how the SDK is invoked rather than about a missing
`AbortSignal` on a `fetch` we wrote. Reading the SDK's `buildFetchOptions`
settles it: it attaches a signal to `fetch` **only** when the caller supplies
`signal` or `timeout`. `callGeminiFlash` supplied neither, so the signal was
`undefined` and the request was bounded by nothing the application owned. Only
the cron route declares `maxDuration`; the AI routes inherit whatever the
platform gives them, which makes the real ceiling an accident of deployment
rather than a product decision.

The part of the work item I had to actively resist was the phrase "retry
ceiling." It reads like an instruction to add retries and then cap them.
`makeRequest` in the SDK performs exactly one `fetch` and contains no retry
logic. No route retries. No consumer retries. The offline sync queue does have
exponential backoff, but it replays a closed enum of Supabase writes and
`/api/rotations/complete` — no Gemini endpoint is in it. So there was no retry
to bound. The safest bounded policy for a repository in that state is **one
attempt, a finite timeout, and an explicit failure**, and that is what shipped.
Adding retries here would have multiplied paid inference and called it a safety
improvement.

Two implementation details are worth recording because both are easy to get
wrong. First, the SDK accepts a `timeout` option, and using it would have been
the one-line fix — except that it does
`setTimeout(() => controller.abort(), timeout)` and never calls
`clearTimeout`. That satisfies "has a timeout" while leaking a timer on every
successful call, which fails the cleanup requirement outright. So the transport
owns its own `AbortController`, passes `signal` to `generateContent`, and clears
the deadline in `finally`. Second, classification is based on
`controller.signal.aborted` rather than on the shape of the thrown error. That
matters because an abort can surface from two different places — the SDK wraps
`fetch`'s `AbortError` into `GoogleGenerativeAIAbortError`, but an abort during
the response-body read escapes as a raw `AbortError` from an unwrapped
`response.json()`. Asking our own controller is correct in both cases.

On the timeout value I did not want to pick a number I liked. DeptSync already
has exactly one declared network patience for a floor-facing call:
`STORE_OPS_FETCH_TIMEOUT_MS = 20_000` in `lib/store-ops/client.ts`. Reusing it
means the app has one answer to "how long before we tell the operator to try
again" instead of two competing ones, and a test pins the constant to the
client-side value so they cannot drift apart. The honest limitation is that
where the serverless ceiling is shorter than 20 s, the platform still kills the
function first. The transport bound is not a promise about wall-clock latency;
it is the only ceiling DeptSync controls, and it removes "as long as the
platform permits" from every environment including local and self-hosted.

The error contract needed more care than I anticipated, and the hazard came
from an unrelated helper. Four of the six consumers pass Gemini failures through
`readableError`, whose `humanizeSupabaseMessage` rewrites any message containing
`does not exist`, `schema cache`, `jwt`, `failed to fetch`, or `networkerror`
into a schema, credential, or connectivity explanation. A timeout message that
tripped one of those would be silently relabelled as a missing migration. So
the copy — *"AI request timed out after 20s — check the connection and try
again"* — is checked against that list by a test, and it carries no endpoint
URL, model name, or key wording. `GeminiTimeoutError` is the only new type;
non-2xx still arrives as the SDK's `GoogleGenerativeAIFetchError` with its
`.status`, so quota stays distinguishable from a bad request without any string
matching.

**No consumer file changed.** That was the point. Prompts, schemas,
normalizers, token budgets, persistence timing, confirmation boundaries, and
every consumer's own `isGeminiConfigured()` branch are exactly as they were, and
the transport still throws the same configuration error without ever starting a
timer on that path. The one behaviour that improves is a consequence of the
bound rather than an edit: `VisualBayScannerModal` sets its `phase` inside
`try`/`catch` with no `finally`, so a hung request used to leave the "Scanning
bay…" overlay up permanently with the shutter and Upload disabled and no way
back except closing the modal. The request now rejects at 20 s, the existing
`catch` runs, and the modal returns to `capture` with a visible error. The
component is untouched — the bound simply gave its error path something to
catch.

One test-infrastructure change was unavoidable. `lib/ai/gemini.ts` imports
`server-only`, which throws outside the `react-server` condition, so the module
could not be imported by Vitest at all — which is why the repository's existing
convention for server modules is source-text assertions rather than behavioural
tests. Source text cannot prove that a timeout aborts a fetch, that a timer is
cleared, or that no retry occurs, so `vitest.config.ts` now aliases
`server-only` to the package's own empty build. The marker itself is not
weakened: a contract test asserts `import "server-only"` is still present in
the transport. That unlocked real tests with mocked `fetch` and fake timers —
no live Gemini calls, and no test that sleeps for twenty real seconds.

Deliberately not fixed, and recorded instead: Floor-Walk Copilot can produce
**two** concurrent parse requests from one Stop tap, because `finishListening`
has no idempotence latch and `runParse` has no in-flight guard, so a throwing
`recognition.stop()` fires it once synchronously and again from `onend`. The
sibling `FloorPadEditor` already solves this with a `finishedRef`. That is a
consumer double-dispatch, not a transport retry — the transport still issues one
attempt per invocation — and Floor-Walk product behavior is out of scope here.
Also left alone: Bay Audit Validate still persists server-side before a client
can abandon (SNAP-DECISION-001), Floor Pad autosave and unvalidated `metadata`
(AI-SAFETY-002), `recommended_percent` ownership (FLOORING-AI-001), and
`storeOpsFetch`'s missing client-side timeout, which is a separate resilience
question now that the paid server leg is capped.

843/843 tests across 60 files (27 new), typecheck clean, build clean, lint
byte-identical to the baseline at 114 problems / 95 errors / 19 warnings.

**Reviewed and accepted the same day: IMPLEMENTATION ACCEPTED — CLOSED, no
field gate.** The bounded contract is now canonical — one invocation, at most
one model attempt, a 20 000 ms transport-owned deadline, `AbortController`
cancellation, `clearTimeout` in `finally`, zero automatic retries, explicit
timeout failure, no persistence, no operational authority. The acceptance
covers transport only; every consumer-side finding above stays with its own
work item, and the ban on retries, backoff, circuit breakers, retry queues,
provider abstraction, and AI telemetry architecture carries forward.

> **An optional intelligence dependency may fail. DeptSync's operational
> workflow may not fail with it.**

---

## 2026-09-08 — AI-RETIRE-001 Snag Triage retired

The first retirement under the program, and a different question from the two
reductions before it. Those asked whether Gemini earned its place in a job that
users actually do. This one asked whether the job existed at all.

It did not. Snag Triage had a route, a structured contracts module, a Gemini
classifier with a real prompt, a complete deterministic fallback, a dispatcher
that could write three authoritative tables, and a typed client helper in
`lib/store-ops/client.ts` called `triageSnagReport`. Every piece was finished
work. Nothing called any of it. I searched by symbol, by route URL, by request
and response field names, by the names of the tables it writes, by distinctive
prompt text, and by the `source: "snag_triage"` marker it stamps on walk tasks.
The stack referenced only itself. No button, no screen, no deep link, no cron,
no background job. The sync queue could not replay it either — that queue takes
a closed enum of action types and no snag action was ever in it — and the
service worker treats `/api/` as network-only rather than replayable.

The part GEMINI-001 understated was the authorization tier. It recorded that
dispatch could write three tables with no human confirmation, and that the lack
of a caller mitigated the risk. What reading the route actually shows is that
the gate is `requireStoreOpsActor` — any signed-in store-ops actor, including a
DeptFloor associate. Not supervisor. Not admin. So the three-table write was
reachable at the lowest authenticated tier by anyone who knew the URL, and
`dispatch: true` would create operational records immediately. The mitigation
was that nobody knew the URL, which is not a control. Deleting the job closes
it more honestly than adding a role check to something nobody uses.

Tracing the writes separately was worth doing. The downstock path upserts on
`store_number,department,assigned_week,rotation_id`, so retries were idempotent.
The exception path goes through the shared `reportRotationBarriers` and could
set `markCarriedOver` on a P1. The walk-task path upserts a fresh id and tags
`source: "snag_triage"`, which makes those the only rows attributable to this
job. Each dispatch hits exactly one target, so partial multi-table dispatch was
never possible.

The product test settles it. Snag Triage had evidence input and interpretation,
but no user trigger, no human review, no read-back, no correction, and no
lifecycle closure. It could create operational state that no surface could trace
back to it. Orphaned. And every action it could take already has a clearer
human-owned workflow — Flag Downstock owns the queue, the barrier flow owns
exceptions, Walk & Talk owns shift tasks. That overlap is the evidence for
retiring it. It is not permission to merge anything, and I did not touch those
three workflows.

The deterministic fallback went with the job. `buildLocalSnagTriage` was
literally `normalizeSnagTriageResult({}, input)`, and it had no consumer outside
the retired route. Keeping it because it happens to be deterministic would have
been the exact mistake the tranche exists to avoid: a deterministic
implementation does not justify a product job that has not earned its place. No
deterministic Snag Triage UI was built and nothing was wired into Floor, Map,
Walk & Talk, or Predictive Copilot.

No tombstone. The one AI tombstone we keep, `ai-note-summary`, returns 410 to
redirect real prior consumers to a named replacement owner. Snag Triage never
had a consumer and has no replacement to name, so a tombstone would serve nobody
and would imply the job once shipped. Deleted outright, and the build manifest
confirms the route is no longer emitted.

Historical rows are untouched. No migration, no cleanup SQL, no data rewrite.
Any row out there carrying `source: "snag_triage"` belongs to its owning table
and keeps its provenance exactly as recorded. Retiring the writer is not a
license to rewrite what was written.

No field acceptance, and this is the clearest case yet for saying so: there was
never a user-reachable surface to change. Nothing an associate or supervisor can
do behaves differently, because nothing they could do reached this job in the
first place.

Validation: 816 tests across 59 files pass, 14 of them new in
`lib/store-ops/snag-retirement.test.ts` holding the retirement boundary — the
job is absent, no client helper survives, no deterministic replacement appeared,
the sync queue has no snag path, and the Downstock, barrier/exception, and
shift-task workflows still expose their contracts. Typecheck and build are
clean. Lint is byte-identical to baseline at 114 problems (95 errors, 19
warnings).

**AI-RETIRE-001 — IMPLEMENTATION ACCEPTED — CLOSED.** The third closed tranche
under the program and the first retirement. Two constraints travel with it. The
route must not come back behind a stricter authorization gate — hardening a job
nobody uses would preserve the concept while pretending to fix it — and no
deterministic Snag Triage replacement may be built. AI-SAFETY-001 is unchanged
by this work: removing one unbounded call site was incidental, and the item
still applies in full to every surviving Gemini path.

> **A deterministic implementation does not justify a product job that has not earned its place.**

## 2026-09-08 — AI-REDUCE-002 Deterministic Catalog Taxonomy

The second AI reduction, and the first one where reading the code changed what
the tranche was actually about.

GEMINI-001 had this filed as the easy one: static input, a shipped registry that
already covers all ten catalog codes, a model prompted with the defaults and
asked to expand them, output that lands in `localStorage` and teaches nothing.
All of that verified at HEAD. Gemini never saw a catalog record, an audit, or
anything store-specific — it could not classify unstructured input, learn local
vocabulary, or reconcile an unknown category, because it was never given the
evidence that would let it. It rephrased a list we already ship.

What GEMINI-001 understated was where the output could travel. The generated
taxonomy is `localStorage`-only, which is true and sounds harmless. But
`DepartmentAuditSection` reads the effective tree, renders it as the folder
drill-down, and on log writes the selected folder into the audit record's
`sub_category`. The taxonomy was display metadata; its labels were not. A
model-invented folder name could become part of a persisted audit observation.
That does not weaken the case for removal — it is the strongest argument in the
file.

Tracing the department-code concern turned up a live defect rather than a
theoretical one. `mergeTaxonomies` resolved identity as
`incoming.department_code || base.department_code`, so stored data won over the
caller. A blob saved under `D25` carrying `department_code: "D35"` made
`getTaxonomyForDepartment("D25")` hand back a tree labelled Appliances. The test
I wrote to prove identity was safe failed on the first run, which is the right
way to find out. Identity is now pinned in two places: the override map takes
its code from the storage key, and the effective read restores the caller's
identity after merging. Stored folders may expand a tree. They may not rename a
department.

The persisted-state question answered itself once I looked for the writer. There
was exactly one — the AI generate handler — and no editor anywhere in the
repository. So the stored overrides are provably machine output, not user work.
I still left them alone. Nothing is deleted, no migration was invented, and the
existing clear control stays so an admin can drop stale generated folders on
purpose. `saveTaxonomyOverride` is gone, so nothing writes new ones.

Removed: the `/api/catalog/ai-taxonomy` route, `lib/catalog/ai-taxonomy.ts`
entire (prompt, response schema, normalizer, local fallback, defaults compose),
the Generate button and its handler, the Gemini-specific loading and error
state, and the exclusively-owned `taxonomy` token budget key. Shared Gemini
transport is untouched, as are the six other Gemini paths.

The modal now says what it does. It shows the department's folder tree. When a
device has legacy generated folders it says so plainly and offers to clear them,
rather than advertising a Generate button that would re-ask a model to restate
the registry.

No field acceptance under Law 8. The only surface that changed is the
Master-Admin-only taxonomy manager inside Settings — not a floor surface, not
rotation, audit, or shift work. What an associate sees during a department audit
renders byte-identical to the previous default path. Nothing in the aisle
changed, so there is nothing in the aisle to smoke test.

Validation: 802 tests across 58 files pass, 18 of them new in
`lib/catalog/taxonomies.test.ts` covering registry determinism for all ten
codes, code normalization, safe unknown-department behavior, identity
immutability, legacy-state preservation and clearing, corrupt-payload fallback,
server-side override exclusion, and repository assertions that no generative
path remains. Typecheck and build are clean. Lint is byte-identical to the HEAD
baseline at 114 problems (95 errors, 19 warnings).

One thing this tranche deliberately did not do. Because generated folder labels
could reach an audit's `sub_category`, devices that used Generate may already
hold audit rows carrying a model-authored label. Those rows are left exactly as
they are. Provenance cannot distinguish a model-authored value from an
operator-selected registry folder or a hand-typed one, and guessing would mean
manufacturing evidence about evidence — the precise failure this program exists
to prevent. What changed is that the path which produced them is closed. The
observation is recorded in the plan as §5 A1.9, framed as historical provenance
discovery, not remediation. No work item was opened for it.

**AI-REDUCE-002 — IMPLEMENTATION ACCEPTED — CLOSED.** The second closed tranche
under the program, and the first closed **without** a field gate. That contrast
is the useful precedent. AI-REDUCE-001 earned a gate because the briefing card
lives on the supervisor's phone and its refresh gesture changed. This one did
not, because the surface that changed is a Master-Admin management modal and the
folder tree an associate sees renders byte-identical. The gate is earned by
changed field-facing behavior, not by the act of removing AI — and inventing one
here would have been ceremony, not evidence.

> **Less machinery. Same truth. Same usefulness. Lower dependency.**

## 2026-09-08 — AI-REDUCE-001 field accepted and closed

The deterministic Shift Briefing was tested on a real DS device after shipping.
Twelve bays were staged, the workflow was exercised as though those bays had been
worked, the staged work was cleared and completed, and DeptSync was observed
updating itself to reflect the changed operational state.

That is the entire reported evidence, and it is deliberately recorded without
elaboration. No briefing prose, Focus Bay text, barrier text, bay identity,
refresh timing, network condition, offline behavior, or verification state was
reported, so none is claimed here.

**What the test settles** is the one question the tranche actually had to answer:

> When underlying operational evidence changes, DeptSync recomposes its state and
> intelligence from that evidence rather than depending on a Gemini rewrite.

The removed capability was a prose rewrite sitting on top of computed findings.
The real risk of removing it was never that the sentences would read differently —
it was that something in the evidence-to-expression chain had been quietly leaning
on the model call. Staging twelve bays and then clearing them exercises exactly
that chain: the evidence changed, and the operational state followed. With no
Gemini path present, it followed anyway.

So the recorded conclusions are narrow and concrete. The deterministic briefing
remained operational after Gemini removal. Operational state continued to respond
to changed evidence. No Gemini dependency was required for that response. No new
intelligence architecture was needed. The reduction preserved the intended
operational behavior.

**This result does not generalize.** It is evidence about Shift Briefing, and only
Shift Briefing. Floor-Walk Copilot, Executive Floor Pad, Flooring Insights, Visual
Bay Scan, Bay Audit Validate, and Catalog Taxonomy keep their own GEMINI-001
dispositions and their own gates; nothing here shortens any of them, and UX-005F
remains open on its own terms.

**AI-REDUCE-001 — FIELD ACCEPTED — CLOSED.** The first fully closed implementation
tranche under the Operational Intelligence Evolution program: proposed from
repository evidence in GEMINI-001, implemented against a stated contract, validated
in the field, and closed. AI-REDUCE-002, AI-RETIRE-001, AI-SAFETY-001,
AI-SAFETY-002, SNAP-DECISION-001, and FLOORING-AI-001 all remain NOT STARTED.

> **Less machinery. Same truth. Same usefulness. Lower dependency.**

## 2026-09-08 — AI-REDUCE-001 Deterministic Shift Briefing

The first runtime tranche under OIE, and the smallest possible one on purpose:
remove a paid dependency that GEMINI-001 proved was contributing nothing the
repository could not already derive.

**The premise held at HEAD.** Before editing, all seven GEMINI-001 premises were
re-traced. The deterministic and Gemini responses shared one type; the normalizer
emitted exactly `headline`, `bullets`, and `priority_department`, each falling back
to the local builder, so there were no Gemini-only fields; the hotspot arrived from
`enrichSnapshotBayHealth` *before* the model call, meaning the model was told which
bay to lead with; the card rendered the local brief on boot; the model ran only on
manual refresh; the route performed no writes; and `fetchShiftBriefing` had exactly
one caller. Nothing contradicted the audit, so the reduction proceeded.

**What was removed.** The route `app/api/store-health/ai-summary`, the client's
`fetchShiftBriefing`, the prompt builder, `SHIFT_BRIEFING_RESPONSE_SCHEMA`,
`normalizeShiftBriefing`, and `isShiftBriefingTransportError`. Two helpers became
dead by exclusive ownership and went with them: `compactTelemetryForPrompt`, whose
only caller was the briefing prompt, and the `briefing` key in
`GEMINI_TOKEN_BUDGET`. `callGeminiFlash` and every other Gemini path were left
exactly as they were.

**What the reduction actually simplified.** The interesting part was not deleting
the call — it was that removing it collapsed a distinction that only existed
because of the call. `buildLocalShiftBriefing` was documented as the "institutional
fallback when Gemini is unavailable." It is now just the briefing producer. The
client's `source` union lost `"gemini"`, and the card no longer arbitrates between
an AI result and a local fallback. One truthful path.

**Refresh was the honest question.** Tapping refresh looked like it re-read the
shift's numbers. It did not. `refreshAi` began with `snapshot ?? await
fetchStoreHealth(...)`, so once a snapshot was in state — which boot always
guaranteed — refresh skipped the evidence read entirely and posted the *existing*
evidence to Gemini for re-wording. The gesture the DS performed to "get the latest"
returned the same facts in different sentences. Deleting it outright would have
been defensible, but the underlying need is real on the DS's own phone in the
aisle, so refresh now does
the job it always appeared to do: `fetchStoreHealth(..., { force: true })`
invalidates the SWR entry and re-reads store health, and the deterministic brief
recomposes from fresher evidence. That is the same builder over newer facts, not
new intelligence.

**Copy made truthful, quietly.** "Local health brief · tap refresh for optional AI
rewrite" became "Shift health brief · tap or pull to refresh." The `· AI refresh`
provenance label is gone, `· local metrics` became `· store metrics`, and the
button's `aria-label` no longer offers to re-analyze anything with AI. There is no
"AI-free" badge and no implementation language on the surface — the DS cares about
the briefing, not which helper produced it.

**Nothing operational was given up.** Headline, the three captioned bullets — Focus
Bay, Pending Barriers, Quick-win — and priority department all still come from the
same health snapshot, bay-health flags, bottleneck summary, and velocity telemetry.
The session-refresh auth empty state survived too; it used to arrive through the AI
endpoint's soft 200, and now reaches the card deterministically through
`isStoreOpsAuthFailure` on the health read. IndexedDB hydration, SWR, the pull
gesture, and role behavior are untouched.

**Validation.** 784 tests across 57 files pass, 20 of them new in
`lib/store-ops/shift-briefing.test.ts` covering the deterministic contract,
reproducibility, hotspot and priority selection, barrier/flag composition,
low-signal safety, and repository-level assertions that no Gemini path or dead
endpoint reference remains. Typecheck and build are clean. Lint is byte-identical
to the HEAD baseline at 114 problems (95 errors, 19 warnings) — all pre-existing
and deliberately not touched here.

**AI-REDUCE-001 — IMPLEMENTATION COMPLETE, AWAITING REVIEW.** Engineering complete
is not field accepted (OIE Law 8): the card is field-facing and the refresh gesture
now behaves differently, so a narrow **Samsung / real DS-device field smoke**
remains pending on the supervisor's own phone. GEMINI-001's other
dispositions are unchanged, and AI-REDUCE-002, AI-RETIRE-001, AI-SAFETY-001,
AI-SAFETY-002, SNAP-DECISION-001, and FLOORING-AI-001 all remain NOT STARTED.

## 2026-09-08 — GEMINI-001 Generative Cost & Necessity Audit (discovery complete)

The question GEMINI-001 set out to answer was uncomfortable on purpose: for every
Gemini-backed capability, does the model supply information DeptSync cannot derive
itself? The answer, traced call-site by call-site, is that it usually does not.

**Gemini is not the operational intelligence engine.** There is no Gemini call in
the rotation engine, the attention engine, the appliance consideration composer,
the health calculations, the velocity decay, or the labor balancer. Every Layer 1,
Layer 2, and Layer 4 producer in this repository is deterministic TypeScript. What
Gemini actually does here is interpret unstructured input and write prose.

**Nine live call paths plus one tombstone.** RA-001 named eight candidates; the
audit found a ninth by noticing that `VisualBayScannerModal` has two different
backends. Three mount sites call the ephemeral `/api/store-ops/ai-bay-scan`, which
persists nothing. The Floor mount calls `/api/ai/bay-audit/validate` — a separate
endpoint with its own schema that writes to `bay_audit_logs`. Same modal, same
button, two capabilities with genuinely different risk profiles, so they were split
and given separate dispositions. The tenth path, Note Summary, is a real tombstone:
the route returns 410 and no Gemini import survives in its module graph.

**The Snap Bay lifecycle is severed, and that was verified rather than inferred.**
RA-001 flagged it as a strong static reading; this audit enumerated every call site
and confirmed it. `validateBayAudit` has exactly one caller, and the only mount
supplying `auditContext` passes `department_id` alone — so `rotation_id` is
structurally guaranteed null on every write. `image_url` is never passed. The
supervisor read-back keys on `rotation_id` and therefore cannot join the row. The
FAIL completion gate cannot fire, because both maps feeding the verdict are
permanently empty: one is only ever called to delete keys, and the other's callback
early-returns on the always-absent `rotation_id`. One correction to the original
reading — the insert happens server-side and unconditionally, so the rows *are*
written, just orphaned. The consequence is that a Floor scan spends real inference
money to produce a row nothing can read, which means the model's accuracy on this
path has never been evaluable and cannot be evaluated retroactively. That finding
makes the decision urgent without making it obvious, so `SNAP-DECISION-001` is
recorded as repair-or-retire and deliberately left undecided.

**Shift Briefing has zero Gemini-only fields.** The deterministic and model paths
produce an identical output shape; hotspot selection is already deterministic
*before* the call; the local brief is already what renders by default; and the UI
itself calls the model step an "optional AI rewrite." Nothing is lost by removing
it except the rewrite, which is why `AI-REDUCE-001` became the first approved
implementation candidate.

**Catalog Taxonomy pays repeatedly for a static answer.** The input is effectively
fixed, the shipped deterministic registry already covers every catalog code, the
model never learns from prior runs, the result is stored only in `localStorage`,
and there is no human correction mechanism — so identical inference can recur
indefinitely.

**Snag Triage is an orphan that can still write.** Route, helper, and a three-table
dispatcher all exist with no production invocation path. Its deterministic fallback
is complete, which is precisely the trap: the temptation is to wire it because the
fallback works. The disposition is to retire the job, not to rebuild it a
different way.

**One safety finding is shared by everything.** No Gemini path has an explicit
timeout, an `AbortSignal`, a bounded upstream execution time, or a retry ceiling.
Because all nine funnel through `callGeminiFlash`, that is one change site capping
worst-case exposure across the whole surface — which is why `AI-SAFETY-001` is
resilience work rather than AI reduction. Alongside it: `asGeminiSchema` is a
TypeScript cast, not runtime validation, and the deterministic normalizers are
doing the real enforcement in several paths.

*(Later note: the timeout / abort / bounded-execution half of that finding was
closed by AI-SAFETY-001 on 2026-09-08 — see the entry at the top of this file.
The "retry ceiling" half turned out to be a non-issue: no retry existed, so none
was bounded and none was added. `asGeminiSchema` remains a cast.)*

**The long-term boundary this establishes:** Gemini earns a narrow role at
unstructured-input boundaries where DeptSync cannot reasonably derive the same
interpretation from structured evidence — free-text topology, natural-language task
structuring, possibly image interpretation if its product value and lifecycle are
ever proven. It should not be doing deterministic math, recurrence detection,
rotation reasoning, labor balancing, attention signals, health metrics, static
taxonomy generation, or rewriting already-computed intelligence to sound more
natural.

**GEMINI-001 — DISCOVERY COMPLETE.** Documentation only; no runtime code, test,
API, schema, migration, or Gemini behavior was changed, nothing was removed, and no
reduction was implemented. Every item it created — AI-REDUCE-001, AI-REDUCE-002,
AI-RETIRE-001, AI-SAFETY-001, AI-SAFETY-002, SNAP-DECISION-001, FLOORING-AI-001 —
is NOT STARTED. UX-005F receives repository-level evidence from this audit but is
not closed; its acceptance conditions still require field evidence, and none was
invented.

## 2026-09-08 — OIE-000 Operational Intelligence Evolution Program foundation

RA-001 was a read-only archaeology audit that asked what DeptSync has already
become rather than what it should build next. Its answer reframed the roadmap: the
product's gap is not missing capability. The repeating repository pattern is that
evidence exists, deterministic derivation exists, sometimes a recommendation
exists — and then the chain stops one step before the Department Supervisor.
Engines return structured output and a surface consumes two integers from it.
Evidence is persisted permanently and no screen reads it back.

This tranche is documentation only. It creates
`docs/product/OPERATIONAL_INTELLIGENCE_EVOLUTION_PLAN.md` as the canonical program
map and adds pointers from the roadmap and handoff. No runtime code, test, API
route, schema, migration, or Gemini call site was touched. `tmp/` is untouched.

The program thesis is **the next unit of product value is connection, not
construction** — paired with an equal and deliberately opposing constraint,
**visibility is not validation** (OIE Law 9). An orphaned capability does not earn
a surface by virtue of being orphaned. Several of the hidden surfaces RA-001 found
may be correctly absent, and the plan explicitly prohibits wholesale restoration.

On terminology: the plan adopts the Constitution's Article IX layer numbering
verbatim rather than inventing a parallel stack. Informal program language
("signals", "historical patterns") is mapped onto Layers 1–2 in a reconciliation
table so no second numbering system can take root. Layer 3 (Forecast) is recorded
as thin-to-absent, which the Constitution permits provided order of authority is
never inverted.

Three findings are recorded as **strong static inference, not runtime-confirmed**,
with that qualifier preserved in the document so a later tranche cannot silently
promote them to fact: the `bay_audit_logs` lifecycle severance (missing
`rotation_id` linkage and `image_url` persistence, which if correct means the FAIL
completion gate has never fired), the `sunday_bay_assignments.assigned_week`
column absent from every migration, and edge protection on `/api/v1/*` which the
route handlers themselves do not implement. Each requires verification before any
work proceeds on it.

Existing gates were preserved rather than absorbed:

- **WALK-001 remains deferred.** The UX-005C contract test asserting the read
  helpers stay unimported from Floor and the drawer remains in force and must not
  be weakened without an explicitly owning tranche.
- **APP-TEACH-001 is blocked** on APP-CAT-001A Samsung ESL revalidation plus the
  teach-ahead field experiment. The three quarantined Samsung records remain
  preserved and must not be retried, discarded, or cleared.
- **REC-001 and LAB-001 must not be wired merely because they exist.** Both are
  recorded as intentional parked foundations. For REC-001 the decisive question is
  whether Current Attention already answers enough of it — the same reasoning that
  deferred SI-002. CAP-001 remains rejected; `weekly_bay_target` remains desired
  staging volume, not capacity.
- **UX-005 remains independent.** GEMINI-001 supplies evidence for canonical
  UX-005F rather than replacing it; UX-005D and UX-005E must not be preempted;
  UX-005B and UX-005C Samsung acceptances remain outstanding and unaffected.

RA-001's appliance finding is worth recording separately because it narrows a
previously open question. Catalog teaching and physical observation are **already
separable at the API and data layer** — `POST /api/appliances/catalog/identifiers`
states in its own header that it does not rewrite scans, and
`ApplianceCatalogManageSheet` teaches without ever calling `commitScan`. The two
jobs are fused in exactly one UI callback, `handleQuickAdded`, which calls
`commitScan` after every teach outcome. The practical gap is therefore input
method rather than capability: pure teaching exists but requires typed
identifiers, because wedge scanning is bound only to the observation-producing
surface. FE-001 is designed to determine whether the value lies in teach-ahead as
a workflow or specifically in teach-ahead by scanning. The deliberate unbound
ad-hoc observation path is separately protected under OIE-E2 so a future naming
change cannot eliminate it by accident.

Five field experiments are registered (FE-001 teach-ahead, FE-002 barrier
vocabulary, FE-003 send-back history, FE-004 Walk & Talk continuity, FE-005 ad-hoc
isolation), all **PENDING** with empty result fields. No results were invented and
none may be back-filled without an actual store run.

Nothing in the plan is approved for implementation. Every workstream item is an
evidence-backed candidate with a field gate. Next planned discovery is GEMINI-001,
which is **not** marked started.

**OIE-000 — PROGRAM FOUNDATION COMPLETE.** The documentation foundation was
reviewed and accepted. Completion here means the program map is canonical and
binding on future tranches; it does not approve any workstream item for
implementation, and it carries no field-acceptance claim of any kind.

## 2026-09-07 — UX-005C Floor operational simplicity

Opening the Floor drawer on a phone used to lead with Snap Bay Photo and a bay
freshness grid, so the first screen a DS saw during a shift was a photo button and
a report. The drawer now answers "what can I do right now?" first and "what is
going on?" second. This tranche is presentation / information architecture only.

`ShiftAnalyticsDrawer` is unchanged as the container — still collapsed by default,
still opened by `#floor-pad` hashes and `EXECUTIVE_FLOOR_PAD_OPEN_EVENT`, still
mounting children only when open. Its children were reordered into six primary
shift actions: **Walk & Talk Floor Pad → Flag Downstock → Showroom Quick Touch →
Predictive Copilot → Weekly Audit Rollup → Snap Bay Photo**. Every engine,
persistence path, permission gate, API contract, and Gemini call site behind those
surfaces is untouched; only their order and layout moved. The Snap/Downstock
two-column grid became full-width stacked buttons so a Samsung-sized screen never
depends on a horizontal action strip.

**Snap Bay Photo is retained and demoted to last**, not deleted and not redesigned.
Its Gemini path, `bay_audit_logs` write, and unwired override helper are all
deliberately preserved — whether it earns continued placement is a UX-005F / field
question, not a UI cleanup decision.

Reports moved behind one nested disclosure, `ShiftAnalyticsReportsGroup`, exported
from the same drawer file so drawer chrome keeps a single owner. It is labelled
**Reports & insights**, collapsed on every mount, and its open state is
intentionally not persisted. It holds Audit Velocity, Store Health, Shift Briefing,
and Exception Feed. That is exactly one secondary level — drawer → reports — and no
new global accordion framework was introduced.

Two duplicate presentations were removed. The drawer no longer renders
`BayFreshnessGrid`; the component and `composeBayFreshness` remain in the
repository, and Floor's own readiness line and Current Attention strip still carry
freshness context outside the drawer. Inside this drawer only, Store Health no
longer repeats its "Logged barriers" block, because Exception Feed is the
authoritative visible barrier list here. That is a single explicit presentation
prop, `showLoggedBarriers` (default `true`), so every other Store Health call site
behaves exactly as before. No health calculation and no barrier persistence changed.

- **WALK-001 — Shift Walk Task Read-Back remains deferred.** Walk & Talk still
  writes `shift_walk_tasks` through `dispatchShiftWalkTasks` and nothing reads them
  back; `fetchShiftWalkTasks` has no UI consumer. UX-005C improved Walk & Talk's
  placement and deliberately did not grow into read-back. A contract test asserts
  the read helpers stay unimported here.
- Walk & Talk and Executive Floor Pad were **not** merged or renamed. Their boundary
  still needs product evidence (Question #4).
- No schema, migration, API route, Gemini helper, intelligence engine, scoring,
  rotation/verification semantics, offline queue, RBAC, Map/Roster/More IA, or
  bottom-navigation change. Bottom nav remains Floor · Map · Roster · More.
- Appliance code was not touched. APP-CAT-001A's repaired Samsung ESL validation
  remains pending and is unaffected.
- Contracts: `lib/ux005c.floor-operational-simplicity.contract.test.ts` (21).
- 764 tests, typecheck, and build pass; lint at baseline parity (114). UX-005C is
  **not** field accepted — real-device acceptance is separate from engineering
  completion.

## 2026-09-07 — APP-CAT-001A-FIX-001B Missing-parent sync classification

The historical identifier FK quarantine now has a deterministic product
classification instead of surfacing as "Unknown sync failure" plus raw SQL. The
condition was proven by APP-CAT-001A-FIX-001A, so `SyncFailureReason` gains
`blocked_missing_parent`.

Classification is decided by the constraint name
`appliance_catalog_identifiers_item_fkey` — read from a structured `constraint`
field when the driver provides one, otherwise from message/details — and corroborated
by Postgres `23503` whenever a code is present. It is scoped to
`upsert_appliance_catalog_identifier`, so an unrelated foreign-key violation is never
reported to a DS as "add this appliance item". A different Postgres code carrying our
constraint name is also refused.

`SyncQueuePanel` now leads with `syncActionBlockedExplanation` — "Item 5709242 is not
on DeptSync for this store yet. Add the item, then Retry." — naming the real item when
the payload carries it, with a truthful generic fallback otherwise. The raw constraint
text stays as secondary mono diagnostics, never the primary message. Ownership is
unchanged: `lib/sync-queue` classifies, `lib/sync-conflict` words it, the panel
renders. No new module; the briefly-appearing unowned `catalog-sync-dependency.ts` /
`parent_missing` code was **not** restored, and a contract test asserts it stays gone.

Recovery semantics are unchanged and now tested: **replay never creates the parent**
and never auto-retries. The path stays intentionally ensure the canonical parent →
supervisor Retry. Same-owner replay is idempotent success with no second insert;
different-owner replay still raises a conflict and never steals ownership; the alias
`id` and `created_at` provenance survive Retry.

- Contracts: `lib/appliances/app-cat001a-fix001b.missing-parent.test.ts` (21).
  Verified against pre-repair behaviour: 6 cases fail without the classification.
- No schema change, no migration, no replay transport change. The preserved Samsung
  records are untouched and still await field validation; APP-CAT-001A is **not**
  field accepted.
- 743 tests, typecheck, and build pass; lint at baseline parity (114).

## 2026-09-07 — APP-CAT-001A-FIX-001A Canonical parent before identifier alias

Field inspection of the three quarantined Samsung records (Settings → Device & sync)
showed a foreign-key violation on `appliance_catalog_identifiers_item_fkey`. That
constraint is `FOREIGN KEY (store_number, item_number) REFERENCES
appliance_catalog (store_number, item_number)`, so the alias was rejected because its
canonical parent catalog row did not exist server-side for that store.

FIX-001 made such failures visible instead of silently queued, but it did not make the
legitimate workflow succeed. Link Existing could resolve an item from the device
catalog that was never persisted for the actor's current store — the fail-closed
`store_number` re-stamp moved local rows into a new canonical store scope without
re-persisting them, so `offline: false` records what the device believed, not server
presence. It is a hint only, never proof.

**Repair — parent first, then alias, then observation.** `linkApplianceCatalogIdentifier`
now ensures the one explicitly chosen canonical parent before teaching the alias, via a
new idempotent `POST /api/appliances/catalog/ensure`. An existing parent is returned
untouched (`created: false`, no write, no metadata rewrite); an absent one is inserted
with only the metadata the device already knows — nothing manufactured, and
`sub_category` may stay empty because the column defaults to `''`. The route is
actor/store bound, insert-only so a concurrent creator wins, and refuses to create a
parent whose legacy UPC another canonical item already owns (409). It teaches no
identifiers and accepts no bulk input: exactly one item, never device-catalog
promotion. APP-CAT-001B remains deferred.

Ordering is enforced at the application level across two requests — this is **not** a
database transaction. Parent rejection → no alias attempt, no observation, visible
error. Alias rejection → no observation, visible error. Only after both persist does
`onSaved` fire, which the scan form turns into exactly one `commitScan`.
`ApplianceServerRejectionError` is now the shared "server answered and refused"
contract, with `ApplianceCatalogParentHttpError` and `ApplianceIdentifierHttpError`
beneath it; only a no-response failure may queue.

**Offline dependency ordering.** True-offline teaching is preserved and now queues the
canonical parent (`upsert_appliance_catalog`) ahead of the alias
(`upsert_appliance_catalog_identifier`), reusing the existing parent write and its
`assertNoVersionConflict` guard rather than parallel logic. A parent already confirmed
online is not re-queued. `flushSyncQueue` no longer rewrites the store's queue as
`[quarantined, deferred, failed]` — that grouping could move an alias ahead of the
parent it depends on when the parent failed transiently while the alias was backing
off, reproducing the same FK violation on the next flush. The queue is now rewritten in
enqueue order; the retained set is unchanged and quarantined actions are still held.

**Existing three records.** Not mutated, not retried, not discarded. Their exact
payload identity was not captured and is not claimed. Manual Retry would only succeed
once the missing canonical parent exists server-side for that store and identifier
ownership is uncontested; replay still refuses to steal an identifier owned by another
item, raising a conflict instead.

- Contracts: `lib/appliances/app-cat001a-fix001a.canonical-parent.test.ts` (28),
  `app-cat001a-fix001a.observation-gate.test.ts` (8), plus queue-order cases in
  `lib/sync-queue.test.ts`. Verified to fail against the pre-repair behaviour: 14
  behavioural cases fail without the parent-first sequence, and the order test yields
  `[alias, parent]` under the old grouping.
- No schema change; no migration. 722 tests, typecheck, and build pass; lint at baseline.
- Status: **APP-CAT-001A-FIX-001A IMPLEMENTED — SAMSUNG ACCEPTANCE PENDING.**
  APP-CAT-001A is **not** field accepted.

## 2026-09-07 — APP-CAT-001A-FIX-001 + APP-SYNC-UX-001 Field repair

Real Samsung showroom use (APP-CAT-001A-FIELD-001) proved the identity model is
sound — an unrecognised ESL reached Link Existing, the Lowe's item number resolved
an existing catalog item, and `many identifiers → one canonical Lowe's item` held.
It also surfaced four defects, repaired here.

**A — Active-audit read/render loop (proven).** With an ACTIVE physical audit,
`AppliancePhysicalAuditPanel.refresh` depended on caller-supplied `onStatus` /
`onActiveSessionChange` identity. Every parent render invalidated it, `useEffect`
re-fired audit GETs, and the freshly parsed session object was written back to the
parent — which re-rendered. Unbounded. Repaired at both boundaries: callback props
are read through refs so `refresh` is stable, and the write-back is guarded by
`applianceAuditSessionSignal` (id + status) so one refresh yields one state update.
`ApplianceAuditSection` now passes stable `flashStatus` / `handleContinueScanning` /
`handleAuditStarted`. No polling; audit lifecycle behaviour unchanged.

**C — Online identifier failure misclassification (proven).** `gotHttpResponse` was
set only after `persistIdentifierOnline` fully succeeded, so an HTTP 404/500 was
treated as "no server response", queued, and reported to the user as success — a
deterministically-quarantining queue entry. New `ApplianceIdentifierHttpError`
carries the status and is the contract separating "received a server response" from
"no server response". HTTP success / 409 / other 4xx-5xx never queue; only network
failure and true offline queue.

**D — Quick Add sub-category bounce (proven).** After a successful link, `commitScan`
found the resolved item lacked a valid sub-category and called
`setQuickAddBarcode(item.upc || item.item_number)`, demoting a resolved canonical item
back into the unknown-identifier flow against a *different* identifier, resetting the
mode and replaying the audible prompt. Replaced with an explicit `classify` completion
mode in `QuickAddApplianceModal`: canonical identity is kept and shown, only the
missing classification is requested, the existing catalog path persists it, previously
taught identifiers are preserved, and exactly one physical observation is committed.

**B — Opaque sync attention (APP-SYNC-UX-001).** "N sync items need supervisor
attention" described queued mutations as "items", which reads as merchandise inside
Appliances, and offered no route to inspect them. Copy is now "N sync issues need
attention"; the attention state is an activatable control routing to
`SYNC_QUEUE_INSPECT_HREF` (`/settings#sync-queue`), which opens the existing
`SyncQueuePanel`. New `syncActionSubject` helper renders each queued operation's
real-world subject (Lowe's item #, taught identifier, location, bay, aisle, week) from
identifiers already in the payload — never raw JSON, never opaque uuids, never
manufactured labels. Retry / Discard role safety unchanged.

The three quarantined records on the Samsung were subsequently inspected in
Settings → Device & sync. Their visible failure was a foreign-key violation on
`appliance_catalog_identifiers_item_fkey` — see APP-CAT-001A-FIX-001A below. Their
exact item numbers and identifiers were not captured and are not claimed here. They
remain **preserved**; nothing clears, retries, discards, or purges queue state.

- Contracts: `lib/appliances/app-cat001a-fix001.audit-loop.test.ts` (renders the real
  panel under a deliberately unstable parent; hangs against the old behaviour),
  `app-cat001a-fix001.identifier-failure.test.ts`,
  `app-cat001a-fix001.subcategory.test.ts`, `lib/app-sync-ux001.attention.test.ts`.
- No schema change; no migration. 683 tests, typecheck, and build pass.
- Deferred (recorded, not implemented): `requestConflictResolution` never-settling
  promise guard; zero-retry quarantine policy for audit-session scan binding;
  redundant `notifyQueueChanged`; accordion search-effect behaviour; Escape listener
  resubscription; general queue architecture cleanup; historical vs current quarantine
  grouping; general retry-policy redesign.
- Status: **APP-CAT-001A-FIX-001 + APP-SYNC-UX-001 IMPLEMENTED — SAMSUNG ACCEPTANCE
  PENDING.** APP-CAT-001A is **not** field accepted.

## 2026-09-07 — UX-005B Department-aware Appliances entry
- Floor identity header: compact **Appliances** / Physical audit affordance when Supervisor+/Master, `workingDepartment === "appliances"`, and `canAccessSection(..., "appliances")`.
- Navigates to existing `APPLIANCES_OPERATIONAL_HOME_HREF` (`/appliances` → specialty home). More → Department Tools → Appliances kept as secondary path.
- Visibility helper `shouldShowFloorAppliancesEntry` in `lib/specialty-tools.ts` (Appliances-only pilot; no Flooring mapping; no name heuristics).
- No fifth bottom-nav tab; no audit-session fetch on Floor; no dual-shell / specialty-host / schema / API changes.
- Flooring cycle vs Floor Sunday (Question #6) remains open. Question #1 implemented pending Samsung field evidence — not closed as field-accepted.
- Contracts: `lib/ux005b.floor-appliances-entry.contract.test.ts`; UX-003 / UX-005A / UX-NAV green. Typecheck + build pass.
- Status: **UX-005B IMPLEMENTED — SAMSUNG ACCEPTANCE PENDING** (not committed in this session)

## 2026-09-07 — UX-005 governing backlog preserved
- Canonical program constraints recorded in `docs/product/UX005_OPERATIONAL_SIMPLICITY_BACKLOG.md`.
- UX-005A is first tranche only; Questions 1,3–7 remain open; Question 2 owned by 005A; Question 8 demote-only.
- UX/product/architecture debt, do-not-touch guardrails, and sequence UX-005B→F preserved — not silently closed by 005A.
- Status: **UX-005 GOVERNING BACKLOG ACTIVE**

## 2026-09-07 — UX-005A Appliances operational home simplification
- Presentation / information architecture only: one canonical physical-audit spine on Appliances home.
- Panel owns Start / Continue scanning / Review count / Close; just-closed Reconcile with Lowe's elevated; Phase 1/2 teaching copy removed (closing ≠ recon complete truth retained).
- Section demotes Ad-hoc scan, Manage mappings, ActionBar, and scan log under **More appliance tools** (capabilities preserved, not deleted).
- No schema; no audit/scan/recon/CAT/ROT semantics changed; bottom nav and More top-level IA unchanged.
- Explicitly did **not** preempt UX-005B–F (specialty findability, Floor drawer, Map, language, AI review).
- Contracts: `lib/appliances/ux005a.home.contract.test.ts`; APP-AUD/FIELD/QA/OBS/CAT/ROT + UX-NAV stay green. Typecheck + build pass.
- Status: **UX-005A IMPLEMENTED — REAL-HARDWARE ACCEPTANCE PENDING** (not committed in this session)

## 2026-09-07 — APP-ROT-001 Appliance audit consideration
- Pure composer `lib/appliances/audit-consideration.ts` (`appliance-audit-consideration-v1`): CLOSED audits + audit-bound scans + Option B snapshots → advisory consideration items.
- Reasons: NEEDS_FOLLOW_UP, MISSING_DECLARED_OH, REPEATED_NONZERO_VARIANCE, RECENT_NONZERO_VARIANCE. No risk score, fixed cadence, or stale-day eligibility (days-since is context only).
- Universe = CLOSED-audit history (catalog ≠ expected physical inventory). One CLOSED audit = at most one recon observation.
- UI: compact Consider checking again on Appliances physical-audit panel; tap opens latest CLOSED audit history. Empty-start audits unchanged.
- API: `GET /api/appliances/audits/consideration` (derived, not persisted).
- Not Floor rotation; APP-INT / CAT-001B / BULK-AUD deferred.
- Status: **APP-ROT-001 APPLIANCE AUDIT CONSIDERATIONS — COMMITTED AND PUSHED — REAL-HARDWARE SMOKE PENDING**

## 2026-09-07 — APP-CAT-001A Multi-identifier resolution & teach
- Canonical item remains `(store_number, item_number)`; scannable identifiers are resolution keys only.
- Additive `appliance_catalog_identifiers` (unique store+identifier); legacy `upc` retained + dual-read + idempotent backfill.
- Unknown scan → Link existing (no metadata re-entry) OR Create new; known identifiers stay quiet.
- Offline queue `upsert_appliance_catalog_identifier` refuses silent ownership overwrite on replay.
- No identifier_type; no ESL encoding claims; no bulk local promotion (CAT-001B); no scan rewrite; OBS disposition stays on scan.
- Migration `20260907_appliance_catalog_identifiers.sql` applied + verified on `fmeinlwhixngednabhgy` (catalog/scan fingerprints unchanged; 3 UPCs backfilled → 3 identifier rows). Pre-migration dump retained under `tmp/production-backups/`.
- Status: **APP-CAT-001A COMMITTED, PUSHED, AND PRODUCTION MIGRATION LIVE — ESL / REAL-HARDWARE VALIDATION PENDING**

## 2026-09-07 — APP-OBS-001 Appliance fulfillment disposition
- Per-unit `fulfillment_disposition` on `appliance_scans`: NULL | STAGED_PICKUP | STAGED_DELIVERY.
- NULL = no staged disposition recorded (not official Lowe's availability). Orthogonal to location_type / condition_tag.
- Quiet rapid COUNT; optional last-unit Staged pickup / Staged delivery; edit sheet clear-to-NULL.
- Soft mutable after CLOSED (not in APP-AUD-002B freeze set). Offline/API/queue threaded; membership preserved.
- Derived recon breakdown (showroom / staged pickup / staged delivery / no staged disposition recorded). Plain CSV column.
- Migration `20260907_appliance_scans_fulfillment_disposition.sql` applied + verified on `fmeinlwhixngednabhgy` (fingerprint unchanged; 18 scan rows all NULL). Pre-migration dump retained under `tmp/production-backups/`.
- APP-CAT-001 multi-identifier remains next; no correction history / Excel polish / INT.
- Status: **APP-OBS-001 COMMITTED, PUSHED, AND PRODUCTION MIGRATION LIVE — REAL-HARDWARE VALIDATION PENDING**

## 2026-09-07 — APP-AUD-002B Physical evidence freeze hardening
- Option B: explicit audit membership (omit `audit_session_id` → unbound; removed server ACTIVE auto-bind).
- Ad-hoc + Floor/SIMS (`SpecialtyToolsHost` `ignoreCachedAuditSession`) remain outside Physical Audit lifecycle.
- CLOSED freezes WHAT/WHERE/WHEN/WHICH (item/serial/scanned_at/session/location/location_id/aisle/bay/location_type) at API + DB trigger; soft fields (condition/category/scanned_by/baseline) stay mutable for APP-OBS-001.
- Offline update upserts retain `audit_session_id`; late in-window offline bind (001A) unchanged.
- Migration `20260907_appliance_scans_closed_evidence_freeze.sql` applied + verified on `fmeinlwhixngednabhgy` (fingerprint unchanged; 18 scan rows). Pre-migration dump retained under `tmp/production-backups/`.
- Catalog snapshot provenance deferred (presentation drift only).
- Status: **APP-AUD-002B COMMITTED, PUSHED, AND PRODUCTION MIGRATION LIVE — REAL-HARDWARE VALIDATION PENDING**

## 2026-09-07 — APP-AUD-002A Audit lifecycle clarity & recent history
- Option A: CLOSED = physical observation closed / count frozen; not reconciliation complete.
- Derived recon progress from Option B snapshot rows (OH / variance / outcomes); phases awaiting / in progress / entered.
- Recent Physical Audits (5) with summaries + View all; just-closed banner for recon; Start returns after close.
- No schema; no hard recon lock; no auto-delete. APP-AUD-002B freeze hardening deferred (auto-bind, CLOSED PATCH, catalog snapshot).
- Status: **APP-AUD-002A COMMITTED AND PUSHED — REAL-HARDWARE VALIDATION PENDING**

## 2026-09-07 — APP-ROADMAP-001 Appliance evolution roadmap
- Added `docs/product/APPLIANCE_EVOLUTION_ROADMAP.md`: product purpose, lifecycle, dependency law, field-validation rule, tranche order (APP-AUD-002 next; APP-OBS-001 / APP-CAT-001 queued; APP-ROT-001 / APP-INT-001 later), parking lot.
- Pointers in `MASTER_ROADMAP.md`, `CHAT_HANDOFF.md`, `DEPT_SYNC_STATE.md`. No runtime/schema change.
- Status: **APP-ROADMAP-001 APPLIANCE EVOLUTION ROADMAP — COMMITTED AND PUSHED**

## 2026-09-07 — APP-QA-001 Appliance surface reliability & Gemini anomaly removal
- Root cause (Share/Export): mobile Chrome/Android treats detached `<a download>` clicks as silent no-ops; share AbortError/share failures were not always falling back to a visible download.
- Fix: `shareOrDownloadTextFile` / DOM-attached `downloadTextFile`; cancel vs error vs download status; Copy CSV awaits clipboard with explicit failure; summary **Download CSV Inventory** uses the same helper.
- Removed appliance Gemini path: `ApplianceAnomalyWidget`, `POST /api/appliances/ai-anomaly`, `lib/appliances/ai-anomaly.ts`. Global Gemini retained for Snap Bay / walk parse / Pre-Flight / briefing / taxonomy / flooring insights / etc.
- Deterministic reconciliation (observed physical vs DS-declared Lowe's OH → derived variance) unchanged.
- Future deterministic appliance pattern candidates (not built): duplicate serials; same SKU across distant locations; showroom/topstock split; category/catalog mismatch; recurring recon variance history. No shrink inference from observation alone.
- APP-OBS-001 blue-sticker classification remains deferred until this reliability tranche is field-validated.
- Status: **APP-QA-001 APPLIANCE SURFACE RELIABILITY — COMMITTED AND PUSHED — REAL-HARDWARE VALIDATION PENDING**

## 2026-09-06 — UX-NAV-001 Specialty operational home
- More first card is **Department Tools** (not Floor Utilities). Appliances → `/appliances` → `ApplianceAuditSection` (audit lifecycle). Flooring group: remnant calculator, inventory, cycle audit.
- SpecialtyToolsHost retained for Floor SIMS / event-driven / ad-hoc scanner + remnant calculator modal — not primary More Appliances entry.
- Floor SIMS audit-binding deferred (contextual open remains unbound unless product revisits).
- Status: **UX-NAV-001 SPECIALTY OPERATIONAL HOME — COMMITTED AND PUSHED**

## 2026-09-06 — APP-FIELD-001B Missing physical audit exit on production scanner
- Root cause: Scan & Count opened scanner with `auditSessionId=null` unless Start was used first; banner gated on prop only. Session Total was ad-hoc counter, not durable audit.
- Production evidence: 0 audit sessions; all scans unbound (`audit_session_id` NULL) — not retroactively attached.
- Fix: primary Start / Continue Physical Audit → create/resume + open scanner with audit context; Ad-hoc scan retained and labeled; scanner banner uses resolved session id; Review / Finish unchanged.
- Status: **APP-FIELD-001B AUDIT EXIT WIRING — PRODUCTION CODE LIVE — REAL-HARDWARE VALIDATION PENDING**

- Applied fail-closed `20260907_appliance_catalog_store_number.sql` to `fmeinlwhixngednabhgy` after preflight: catalog rows=0, store_number absent, jwt_matches_store present.
- Verified: store_number text NOT NULL, no default, unique (store_number,item_number), RLS + store isolation policy, 0 rows, 0 fictional 0000 rows. PostgREST select store_number OK.
- Pre-migration dump retained under `tmp/production-backups/`.
- Status: **APP-FIELD-001 APPLIANCE RAPID-FIRE / TEACH / AUDIT EXIT — PRODUCTION LIVE — REAL-HARDWARE REVALIDATION PENDING**

## 2026-09-06 — APP-FIELD-001A Catalog store_number migration fail-closed
- Removed fictional `'0000'` backfill/default from `20260907_appliance_catalog_store_number.sql`.
- Unattributed rows → visible EXCEPTION (no delete, no guessed ownership). Empty production catalog is the clean apply path.
- Future rows: NOT NULL, no manufactured DEFAULT; API must supply actor-bound store_number.
- Status: included in APP-FIELD-001 release

## 2026-09-06 — APP-FIELD-001 Appliance scanner rapid-fire + teach failure + audit exit
- Latency: known COUNT awaited network POST before ready; fixed via `saveApplianceScan({ localFirst: true })` (local upsert + sync queue + background flush). Capture-time `scanned_at` / id / audit_session_id preserved.
- Teach failure: production `appliance_catalog` lacks `store_number` (OpenAPI-proven drift vs 20260810). Migration `20260907_appliance_catalog_store_number.sql` (fail-closed provenance — APP-FIELD-001A).
- Scanner UX: active audit strip + Review / Finish Audit → panel review → Close → Reconcile.
- Status: **APP-FIELD-001 APPLIANCE RAPID-FIRE / TEACH / AUDIT EXIT — PRODUCTION LIVE — REAL-HARDWARE REVALIDATION PENDING**

## 2026-09-06 — APP-AUD-001 production migration applied
- Applied `supabase/migrations/20260906_appliance_audit_sessions.sql` to production `fmeinlwhixngednabhgy` after prerequisite `jwt_matches_store` confirmed.
- Verified: sessions + recon tables, `appliance_scans.audit_session_id`, one-ACTIVE index, FKs, variance check, RLS+store policies, bind trigger. Zero fabricated session/recon rows.
- Pre-migration dump retained in `tmp/production-backups/`.
- Status: **APP-AUD-001 APPLIANCE PHYSICAL AUDIT & RECONCILIATION CLOSED — PRODUCTION LIVE**

## 2026-09-06 — APP-AUD-001A Physical evidence pre-commit verification
- Late offline vs close: close flushes/blocks while session-bound scan upserts pending; UI shows unsynced count; CLOSED bind allowed only when `scanned_at` is within [started_at, closed_at] (API + queue replay + DB trigger). Post-close observations cannot join.
- Reconciliation: Option B — one mutable row per (audit, item) via upsert; not immutable declaration history. Terminology corrected.
- Clear scan ledger: deletes only unbound (`audit_session_id IS NULL`); closed-audit rows protected from single delete.
- Migration: observation-time trigger; RLS skip remains fail-closed (policies require `jwt_matches_store` from prior migrations).
- Status: **APP-AUD-001A VERIFIED + INCLUDED IN APP-AUD-001 COMMIT — PRODUCTION LIVE**

## 2026-09-06 — APP-AUD-001 Appliance physical audit & reconciliation foundation
- Added `appliance_audit_sessions` (ACTIVE|CLOSED, one ACTIVE/store) + `appliance_reconciliation_snapshots` (latest declared Lowe's OH + derived variance per item; mutable upsert) + nullable `appliance_scans.audit_session_id`.
- Evidence: scans OBSERVED; OH DECLARED current state; variance DERIVED (`physical - OH`); blank OH ≠ zero. Outcomes RESOLVED | NEEDS_FOLLOW_UP only.
- UX: Start/Close physical audit; history inspect; reconcile sheet; audit CSV share/export. Destructive clear ledger remains secondary and must not wipe audit-bound scans.
- Authority: actor-bound APIs; recon Supervisor+; online-only reconciliation; offline scan can carry cached session id.
- No Lowe's/SIMS/Zebra integration; no pattern intelligence; legacy NULL session scans untouched.
- Status: **APP-AUD-001 APPLIANCE PHYSICAL AUDIT & RECONCILIATION CLOSED — PRODUCTION LIVE**

## 2026-09-06 — APP-UX-001A Catalog write-path pre-commit verification
- Defect: online API 400 (and other non-401/403 `!ok`) could fall through to direct client Supabase upsert, bypassing actor-bound API + conflict authority.
- Fix: `saveApplianceCatalogItem` — online uses API only; any HTTP response failure (incl. 400/401/403/409/5xx) throws; network-no-response queues offline teach; removed online direct Supabase fallback.
- Tests: `lib/appliance-catalog-write-path.test.ts` (+ existing APP-UX-001 suite).
- Status: **APP-UX-001A VERIFIED + CORRECTED LOCALLY — AWAITING COMMIT REVIEW**

## 2026-09-06 — APP-UX-001 Appliance Teach & Catalog Recovery
- Recovered intentional **Manage appliance mappings** sheet (search + edit UPC / Item # / category / sub-category / description) after `ApplianceCatalogSection` chrome deletion (`b1f3739`) — not a blind restore; no delete button.
- Quiet COUNT scanner: known UPC auto-logs; category/description stay off the count path; **Enter item manually** progressive disclosure; wedge `NumberField` retained.
- Unknown UPC → Quick-Add TEACH (item # + category + sub + description); UPC conflict refuses ambiguous remaps (client + API 409).
- Catalog writes prefer actor-bound `POST /api/appliances/catalog` when online; offline teach still queues. Offline **correction** of existing mappings deferred (needs connectivity).
- No audit sessions, OH, variance, location-tag scan, or reconciliation architecture.
- Tests: `lib/appliance-catalog.test.ts`, `lib/appliance-ux001-teach.contract.test.ts`.
- Status: **APP-UX-001 IMPLEMENTED LOCALLY — AWAITING COMMIT REVIEW**

## 2026-09-06 — TOPO-UX-001 Continuous department mapping
- Field: aisle-by-aisle Bulk Generator closed after every manual success → reselect department.
- Fix (manual mode only): `onGenerated({ source })`; AisleBayManager closes only when `shouldCloseBulkGeneratorAfterGenerated` (exhaustive; unknown fails closed).
- Post-success: KEEP department / type / velocity / workflow / parity / start / end; CLEAR aisle; KEEP sheet open; upsert-safe `N locations saved · Dept · Aisle` from captured aisle.
- Appliances workflow via `workflowTypeForDepartmentCode` on select/init (no effect).
- No schema/API/auth/seasonal/Map changes. Session = open component lifetime.
- Deferred: **RBAC-TOPO-001** Department-Scoped Topology Authority; range seasonal editing; upsert PENDING reset risk unchanged.
- Status: **TOPO-UX-001 COMMITTED — READY FOR SAMSUNG ACCEPTANCE**

## 2026-09-06 — UX-004C.1 Executive Floor Pad durable handoff (local)
- Samsung FAIL only: More → Executive Floor Pad flickered; Walk & Talk did not open.
- Root: hard `location.assign('/dashboard#floor-pad')` without surviving open intent; event was not dispatched across reload; hash unreliable under keep-alive.
- Fix: `buildExecutiveFloorPadHref()` → `/dashboard?open=executive-floor-pad`; More soft `router.push`; Floor `ExecutiveFloorPadIntentBridge` consumes query/legacy hash after mount, dispatches existing `EXECUTIVE_FLOOR_PAD_OPEN_EVENT`, then `syncExecutiveFloorPadIntentConsumedUrl` + `router.replace('/dashboard')`.
- Gate hardening: pathname must be Floor (`/dashboard`); bridge rendered after `TacticalVoiceFloorPad` / drawer listeners; `/` excluded (specialty hub).
- Unchanged: filters, HubPortal, scanner, remnant, SI/LAB/REC, rotation, temporal clocks.
- Status: **UX-004C.1 final commit gate** (Samsung re-smoke after deploy)

## 2026-09-06 — UX-004C Mobile interaction reliability (local)
- Samsung SM-S948U defects: Floor filter horizontal scroll; bottom sheets under BottomNav stacking context; More Floor Utilities dead taps.
- Floor: mobile `grid-cols-2` filter tablist (predicates unchanged).
- Shell: active keep-alive panel remains `z-10` beneath BottomNav `z-30`; Map Walk + Bulk Generator use `HubPortal` → `document.body`; `.hub-modal-sheet` pads device safe-area (not full nav-stack dead space).
- More: `SpecialtyToolsHost` outside `inert` panels; `requestExecutiveFloorPad`; RemnantSection no longer duplicates global remnant-open listener.
- Status: **UX-004C MOBILE INTERACTION RELIABILITY IMPLEMENTED LOCALLY — AWAITING COMMIT REVIEW** (Samsung re-smoke after deploy)

## 2026-09-06 — Temporal copy clarification (staging vs calendar week)
- Audit: Floor W37 vs Map W36 on Sunday are both correct clocks; defect was ambiguous labels.
- Floor: `composeFloorWeekProgressWithStagingWeek` → e.g. `No bays staged · Staging week 2026-W37` (omits ambiguous “this week” on empty progress).
- Map: `formatMapCalendarWeekChrome` → `Calendar week · 2026-W36` (Master); locator includes Calendar week.
- Unchanged: `sundayStagingWeekLabel`, `isoWeekLabel`, cron, rotations, APIs, schema, Map overlay `assignedWeek` prop semantics.
- Fiscal week remains separate. Map overlay staging-week alignment deferred (UX-005).
- Status: **TEMPORAL COPY CLARIFICATION LIVE — DEVICE VALIDATED** (`8e106f3`)

## 2026-09-06 — UX-004B Quiet investigation Show all clear
- Defect: UX004A-01 real-device — quiet Map investigation Show all did not reliably clear URL/strip; elevated cleared with same control.
- Root cause: SI-result-independent control already; soft `router.replace` alone insufficient under keep-alive + null store-map page for search-param-only exit (`useSearchParams` can stay stale).
- Fix: `exitMapAttentionInvestigation` + `syncMapAttentionInvestigationClearUrl` via `history.replaceState(history.state, "", bare)` then `router.replace` (still replace, not push; history.state preserved; no reload).
- Invariant: valid investigation URL + Show all → bare `/admin/store-map` regardless of SI elevated/quiet/degraded/unavailable/loading.
- Deferred: UX004A-02 pin-while-investigating; UX004A-03 week-label ambiguity → temporal copy clarification (clocks unchanged).
- Status: **UX-004B QUIET INVESTIGATION CLEAR RELIABILITY FIX IMPLEMENTED** — device re-smoke PASSED; UX-004 closed on hardware

## 2026-09-06 — UX-004 Floor → Map investigation context

- Floor Current Attention CTA passes navigation intent only: `/admin/store-map?investigate=current-attention&dept=<scope>` (not SI evidence).
- Map resolves elevated MEDIUM/HIGH from its own SI response; current SI wins over stale Floor counts.
- Minimal investigation strip + Show all clear; existing markers emphasized in place; geography not filtered; no ranking/REC/LAB; Standard mode on arrival (no Velocity auto-activate).
- Keep-alive: URL search params + `useSearchParams` (Suspense wrap); department pin synced via `setAdminWorkingDepartment` when intent present.
- Helper: `map-attention-investigation.ts` (presentation/navigation only). No schema/API/SI semantic changes.
- Status: **UX-004 FLOOR → MAP INVESTIGATION CONTEXT IMPLEMENTED** (commit/push ≠ real-device navigation smoke; not production-mobile-validated)
- Known pilot note: while investigation URL holds `dept=X`, pin changes may reconcile back to X until Show all / navigate away (navigation context, not authorization).

## 2026-09-06 — UX-003 Floor decision hierarchy

- Floor remains primary DS command surface; bottom nav unchanged.
- Hierarchy: **identity → verification (conditional) → compact week/freshness → work surface** (thin Stage/On-duty + filters + checklist) → Current Attention (quiet AVAILABLE demoted via `shouldShowFloorAttentionSummary`) → fiscal/season demoted → More tools accordion (renamed from Shift Analytics chrome).
- Pre-commit correction: week progress/freshness moved below verification so operational telemetry does not outrank pending supervisory obligation.
- Filter rename: Needs Attention → Open issues (predicate unchanged; ZebraChecklist empty copy updated).
- Week/readiness compression: `composeFloorFreshnessLine` + week progress (no duplicated staged/verified appendix on Floor).
- No LAB/REC, Map handoff, backend/SI/rotation/verification semantics.
- Tests: `floor-hierarchy.contract.test.ts`, `floor-attention-visibility.test.ts`, freshness tests.
- Status: **UX-003 FLOOR DECISION HIERARCHY IMPLEMENTED** (commit/push ≠ production mobile validation)

## 2026-09-06 — UX-002 Verification authority safety correction

- UX-001 P0: Floor Shift Analytics “Verify awaiting review” → `verifyAllCompletedBays` with empty `completed_rotation_ids` → `verifyWeeklyRotations` stamped `departments.last_verified_*` while UI claimed bays verified (Art VI false-authority risk).
- Correction **A**: removed duplicate CTA + `signOffCompleted` / `verifyBusy` / `verifyMsg` from `FloorTab`; removed unused `verifyAllCompletedBays` helper; false success copy removed. Canonical strip → `SupervisorAuditSummaryModal` → `review_action` verify / send_back / verify_all unchanged (sole bay-review owner).
- Empty-ID week stamp retained only as post-`verify_all` department metadata (legitimate authority B), not as bay verification. No backend verification semantic change.
- Deferred: direct legacy API empty-ID POST without `review_action` hardening (pilot UI path closed).
- No Floor redesign, schema, migration, LAB/REC, assignment, or completion-attempt changes. Feature freeze remains.
- Tests: `verification-authority.contract.test.ts` (+ existing completion-attempt / rotation-metrics / SI summary suites).
- Status: **UX-002 VERIFICATION AUTHORITY SAFETY CORRECTION IMPLEMENTED** (commit/push ≠ production lifecycle validation).

## 2026-09-06 — REC-001 Department Staging Consideration foundation (local)

- Pure domain: `composeDepartmentStagingConsideration` (`department-staging-consideration-v1`).
- Consumes normalized SI-001 signals + Layer-1 planning (`target` / `staged` / `staging_deficit`) + authoritative staged location ids.
- Full qualifying pool (MEDIUM|HIGH + ACTIONABLE + unstaged + eligible); never truncated to deficit; no rank/score; deficit = planning context only (not capacity).
- Statuses: `AVAILABLE` | `NO_ADDITIONAL_STAGING_NEEDED` | `UNAVAILABLE`. Missing **or conflicting** required SI (when deficit > 0) ≠ empty success. Deficit 0 short-circuits without requiring SI. No LAB. No API/UI/schema/persistence/mutation.
- Tests: `staging-consideration.test.ts` (46). Docs updated.
- Status: **REC-001 STAGING CONSIDERATION FOUNDATION IMPLEMENTED** (not LIVE / not DEPLOYED / not production-verified — no runtime consumer). Intelligence foundation phase complete.

## 2026-09-06 — LAB-001 Department Labor Availability foundation

- Pure domain: `composeDepartmentLaborAvailability` + `knownShiftHours` (`department-scheduled-labor-v1`).
- Persisted shift evidence only; unknown duration ≠ 8; no board defaults; home attribution via `specialistHomeDepartment`; Master excluded; Supervisors as schedule evidence only.
- Semantic gates: conflicting duplicate shift keys → `CONFLICTING_SHIFT_DAY` (no invented winner); unavailable sources → `null` aggregates (not zero claims); `known_scheduled_hours` = gross declared schedule including call-out; `expected_on_duty` day-scoped from persisted rows only.
- Tests: `labor-availability.test.ts` (53). No API/UI/schema/persistence/capacity/recommendation/rotation writes. CAP-001 remains deferred.
- Status: **LAB-001 FOUNDATION IMPLEMENTED** (not LIVE — no API/UI/runtime consumer).

## 2026-09-06 — CAP-001 Department Operational Capacity deferred (audit only)

- Architecture-audited; **no implementation**.
- Finding: repository does not currently support a truthful inferred bay-capacity model.
- Rejected: people×3 bays; scheduled hours ÷ productivity constant; `weekly_bay_target` interpreted as capacity; individual productivity ratings; inferred bay absorption ability.
- **`weekly_bay_target` remains desired staging volume / operational target.** Shift hours remain valid for relative assignment distribution; shift hours do **not** prove bay capacity.
- Product decision: **no** second declared Planning Allowance. Capacity may be revisited only when recommendation architecture demonstrates a real product need.
- **Next foundation: LAB-001 Department Labor Availability** — workforce/schedule/call-out evidence only. Labor Availability ≠ Capacity ≠ Productivity ≠ Recommendation ≠ Weekly Target. Not SI-002.
- Docs: handoff / state / roadmap. Status: **CAP-001 NOT IMPLEMENTED — READY FOR LAB-001**.

## 2026-09-06 — SI-002 Operational Priority deferred + SI-001C LIVE closed (docs)

- SI-002 explored via architecture audit; **no implementation**. Name/concept rejected for implementation (semantically overloaded; command risk; collides with draw `priority_*`). Constraint-aware consideration possible but insufficient Day-1 value beyond SI-001 (Arts XX / XXI). **Deliberate DEFER** — not a technical failure. No evaluator/API/UI/schema/score/ranking/rotation coupling. Current Attention remains the final current-state intelligence layer until recommendation architecture needs a stronger intermediate boundary.
- SI-001C canonical status corrected: production Vercel manually confirmed on `88da2e81cfd14e841947f012dd1b1aaa63887ea9` (contains `21e1a72`). **SI-001C FLOOR ATTENTION SUMMARY LIVE — CLOSED.**
- Completion-attempt first natural lifecycle remains pending (no fabricated proof).
- Docs-only: handoff / state / roadmap / journal.

## 2026-09-06 — SI-001C Floor Attention Summary (committed/pushed)

- Commit `21e1a72` (`feat: add Floor current attention summary`) pushed to `origin/main`.
- Pure aggregation + Floor independent SI fetch + compact Current attention strip; verify-batch/barrier success notify locations-changed.
- Unauthenticated production smoke: `/login` OK; attention API 401; `/dashboard` and `/admin/store-map` auth-gate to sign-in.
- Historical note: at commit time Vercel SHA was not CLI-verified; later manual confirmation closed SI-001C as LIVE on `88da2e8` (see entry above).

## 2026-09-06 — SI-001C Floor Attention Summary (local)

- Pure aggregation: `lib/store-ops/location-attention-summary.ts` counts SI-001A `signals` by pressure tier only (no score/rank/reclassify).
- Floor: independent `fetchLocationAttention` in `FloorTab` with SI-001B race helpers; compact `FloorAttentionSummary` after readiness/fiscal strip.
- MEDIUM/HIGH foreground; NONE/LOW → “No Medium/High attention”; degraded keeps counts; unavailable ≠ quiet; Master `all` gated.
- Refresh: `STORE_OPS_LOCATIONS_CHANGED` + dept switch; Sunday/shift Floor reload paths do **not** call SI. `verifyWeeklyRotationBatch` + `reportRotationBarriers` now emit location-changed (evidence mutations).
- Keep-alive: Map+Floor may each GET attention — accepted pilot isolation; not shared snapshot.
- Tests: `location-attention-summary.test.ts`. Docs: handoff/state/roadmap. **SI-001C FLOOR ATTENTION SUMMARY IMPLEMENTED LOCALLY — AWAITING REVIEW** (not LIVE).

## 2026-09-06 — SI-001B Map Attention Surface (local)

- Presentation: `location-attention-presentation.ts` + MapTab fetch/`Attention` status + Focus+Med/High cell marker + Walk sheet Current attention block.
- MEDIUM/HIGH only on cells; NONE/LOW quiet; AVAILABLE quiet ≠ UNAVAILABLE status line.
- Master `all` → NEEDS_DEPARTMENT (no fan-out). Race: AbortController + generation token at state-write boundary.
- Timestamp: displays SI-001A `generated_at` formatted **device-local** (store timezone not on Map without SI-001A/API expansion; not claimed as store-local).
- Seasonal reasons: DS copy from SI `effect` — CONTEXT → “present”; MODIFY → “strengthened”; not from code alone.
- No sort/filter/heatmap/ranking/SI recompute/rotation writes. **SI-001B MAP ATTENTION SURFACE IMPLEMENTED** (awaiting production deploy confirmation).

## 2026-09-05 — SI-001A Attention Read API (local)

- Read boundary: `lib/store-ops/location-attention-read-model.ts` + `GET /api/store-intelligence/attention?department_id=`.
- Owns auth/scope, batched evidence, availability truth, normalization, degradation metadata, `generated_at`; does not own SI pressure/confidence/actionability.
- Hybrid: foundational location fetch fails the request; rotation/barriers/seasonal degrade with flags (empty success = available).
- Barrier open = week exceptions whose `bay_id` (= `store_locations.id`) is not `VERIFIED_COMPLETE`. Exception READ is independent of rotation; open/closed classification requires rotation only when scoped exception rows exist (zero exceptions → barriers AVAILABLE even if rotation failed).
- Eligibility: API returns eligible Map/rotation locations only (`isEligibleRotationLocation`); SI gate remains defensive.
- Duplicate active rotations → conflict → rotation unavailable (no invented authority).
- No schema/UI/persistence/ranking/rotation writes. **SI-001A ATTENTION READ API FOUNDATION IMPLEMENTED** (not Map/Floor LIVE).

## 2026-09-05 — SI-001 semantic correction (local)

### Corrected
- Confidence = evidence maturity (availability flags + substantive current observations); **orthogonal** to actionability / pressure.
- Seasonal LOW/MEDIUM/HIGH differentiated: LOW CONTEXT only; MEDIUM MODIFY without tier raise; HIGH at most +1 when need exists; overlap uses strongest once.
- Evidence count = independent material families (not claim/barrier cardinality).
- Empty vs unavailable via `current_rotation_evidence_available` / `barrier_evidence_available` / `seasonal_context_evidence_available`.
- Eligibility extracted to neutral `location-eligibility.ts` (shared with rotation-metrics; no week import into SI).

### Status
- **SI-001 FOUNDATION IMPLEMENTED** (deterministic engine in app; no API/UI/schema). Not Map/Floor/rotation intelligence LIVE.

## 2026-09-05 — SI-001 Current Attention Pressure (local foundation)

### Shipped (local only — awaiting review)
- Pure Layer-1 engine `lib/store-ops/location-attention-pressure.ts` (`location-attention-pressure-v1`).
- Deterministic pressure / actionability / confidence / reason codes from normalized present facts + declared context claims.
- Context claims preserved per `context_id` (no pre-collapse max). Seasonal MODIFY bounded to +1 tier. CRITICAL deferred.
- Explicit barrier actionability classifier from reviewed `EXCEPTION_REASONS` sets (no fuzzy text).
- Tests: `location-attention-pressure.test.ts` (Garden/Flooring/zero-context/zero-history/overlap/purity).
- No API, UI, schema, persistence, rotation coupling, or manual draw-priority fields.

### Status
- **SI-001 FOUNDATION IMPLEMENTED LOCALLY — AWAITING REVIEW** (not production LIVE).

## 2026-09-05 — FS-003B Map location seasonal context surface

### Shipped
- Presentation `lib/store-ops/map-location-context.ts` + tests — cell badge / detail composition; UNSET omit; NONE detail-only; multi-context `HIGH +N` without score merge; provenance labels.
- Client `fetchOperationalContextLocationRelevanceResolve` — one batched `mode=resolve-locations` read.
- `MapTab` non-blocking Supervisor+ fetch; `StoreLocationGrid` bay badge; `WalkTheFloorSheet` detail. Heatmap colors unchanged.
- No schema/seed/rotation/Floor/SI.

### Status
- **FS-003B MAP CONTEXT SURFACE LIVE** (production empty contexts → no badges until Master declares).
- Completion-attempt first natural lifecycle still pending.
- Next: SI architecture audit (deferred) or Map polish if needed.

## 2026-09-05 — FS-003 location seasonal relevance foundation

### Shipped
- Migration `20260905_operational_context_location_relevance.sql`: `(context_id, location_id)` unique; NONE|LOW|MEDIUM|HIGH; `declared_by`; CASCADE from context + location; RLS authenticated SELECT.
- Domain: `setOperationalContextLocationRelevance`, `resolveLocationContextRelevanceFromRows` / `ForDate`. List includes `location_relevance`. No dept→location inheritance writes. No priority/rotation mutation.
- APIs: Master `PUT /api/admin/operational-contexts/[id]/location-relevance`; Supervisor+ `mode=list` + `mode=resolve-locations`.
- Settings `OperationalContextCard`: optional bay assign/clear under each declared context.
- Tests: `operational-context.location.test.ts`. No Map UI. No SI. No seed.

### Status
- **FS-003 LOCATION SEASONAL RELEVANCE FOUNDATION** (empty production seed valid).
- Production: pre-migration dump `…T00-22-06-828Z.dump` (518573 bytes); table LIVE count=0; contexts/relevance still 0; locations 124.
- Completion-attempt first natural lifecycle still pending.
- Next: Map read badge / SI consumption (deferred).

## 2026-09-05 — FS-002B Floor fiscal + seasonal context surface

### Shipped
- Presentation composition `lib/store-ops/floor-operational-context.ts` + tests — fiscal label, season/event compact labels, department relevance (UNSET/NONE omitted on Floor).
- Client helpers: `fetchFiscalCalendar`, `fetchOperationalContextsResolve` in `lib/store-ops/client.ts`.
- `FloorOperationalContextStrip` under Floor readiness line (`FloorTab`). Supervisor+ non-blocking dual read; failures omit strip; empty contexts → fiscal alone.
- No schema/migration/seeds. No rotation/priority/Map/SI coupling. No Floor edit controls.

### Decisions
- Explicit `NONE` relevance omitted on Floor (noise); Master Settings retains it.
- Offline context cache deferred — omit strip when unavailable.
- Detail disclosure deferred (density).

### Status
- **FS-002B FLOOR CONTEXT SURFACE LIVE**.
- Completion-attempt first natural lifecycle still pending.
- Next: **FS-003** location-level seasonal relevance / overlays.

## 2026-09-05 — FS-002 operational seasons & events foundation

### Shipped
- Migration `20260905_operational_contexts.sql`: `operational_contexts` + `operational_context_department_relevance` (CASCADE relevance; store CASCADE; declared_by → profiles SET NULL). RLS authenticated SELECT (global + actor store); service-role writes.
- Domain `lib/store-ops/operational-context.ts`: Master-declared CRUD, relevance UNSET vs NONE, Gregorian resolve arrays, provenance.
- APIs: `GET /api/operational-contexts` (Supervisor+); Master `POST/PATCH/DELETE /api/admin/operational-contexts*` + relevance PUT.
- More→Settings `OperationalContextCard` (Master only). No Floor chip (FS-002B). No company/public seed. No rotation/priority coupling.
- Tests: `operational-context.test.ts`.

### Production
- Pre-migration dump `tmp/production-backups/deptsync-fmeinlwhixngednabhgy-2026-09-05T19-13-06-331Z.dump` (507080 bytes; prior dumps retained). Migration sha256 `e4fe26cafd602e6c20dbb4ce6f842b79d49b552c27b44a320b1000d644b28c1b`.
- Schema **LIVE**: contexts=0, relevance=0. No company/public seed.

### Status
- **FS-002 SEASONS / EVENTS FOUNDATION LIVE** (empty production seed is valid).
- Completion-attempt first natural lifecycle still pending.
- Next: **FS-002B** Floor context surface and/or **FS-003** location relevance.

## 2026-09-05 — FS-001A minimum fiscal calendar coverage

### Shipped
- Domain: `computeFiscalCoverage` / `computeFiscalCoverageFromYears` / `fetchAuthoritativeFiscalYears` in `fiscal-calendar.ts` — Layer-1 derived coverage (HEALTHY / ATTENTION / URGENT / EXPIRED); thresholds 90 / 30 days as operational constants; gap-aware next-year semantics (FY N+1 only).
- Master-only `GET /api/admin/fiscal-calendar/coverage` (`requireStoreOpsActor` → `requireSuperAdmin`).
- More → Settings `FiscalCoverageCard` (Master only).
- No migration, discovery, promote API, cron, push, or Vendor Gateway fetch. Promotion remains existing importer / offline workflow.
- Tests: `fiscal-calendar.coverage.test.ts`.

### Status
- **FS-001A MINIMUM FISCAL CALENDAR LIFECYCLE LIVE** (coverage awareness only).
- FY2026 authoritative calendar still LIVE; completion-attempt first natural lifecycle still pending.

## 2026-09-05 — FY2026 authoritative fiscal calendar seed

### Source
- Primary: Lowe's Vendor Gateway `https://vendorgateway.lowes.com/vpp/assets/Fiscal_calendar.pdf` — title **FISCAL 4-5-4 CALENDAR (52 WEEKS)**, page labeled **2026**. Retrieval 2026-09-05 (direct curl Akamai 403; content via WebFetch of same URL).
- Secondary: Q1 press release (quarter ended May 1, 2026); Q2 press/10-Q (quarter ended July 31, 2026); FY ends Friday nearest end of January → Jan 29, 2027.
- Discovery: Lowe's fiscal week = **Saturday–Friday** (parallel to ISO Mon–Sun `assigned_week`).

### Seed
- Artifact: `data/fiscal-calendars/lowes-fy2026-company-published.json` (versioned import data; not runtime constants).
- Production: `fiscal_years=1`, `fiscal_weeks=52`; envelope `2026-01-31`→`2027-01-29`; provenance `COMPANY_PUBLISHED` + URL + `source_year=2026`; `declared_by` null.
- Holidays / EARNINGS RELEASED markers **not** imported (FS-002 candidates).
- Pre-seed dump `…T18-19-05-059Z.dump` retained. Completion-attempt first natural lifecycle still pending.
- Status: **FY2026 AUTHORITATIVE FISCAL CALENDAR LIVE**
- Next roadmap: **FS-001A** Fiscal Calendar Lifecycle & Coverage Monitoring — discovery/validation may be automated; promotion to authoritative operational state requires explicit Master approval. Not implemented in this tranche.

## 2026-09-05 — FS-001 Fiscal calendar foundation

### Shipped
- Additive migration `20260905_fiscal_calendar.sql`: `fiscal_years` + `fiscal_weeks` (unique FY; week unique per year; RLS authenticated SELECT; service-role writes).
- Domain owner `lib/store-ops/fiscal-calendar.ts`: provenance (`COMPANY_PUBLISHED` / `MASTER_ADMIN_DECLARED`), import validation (contiguous 7-day weeks, 52/53, 4-5-4 period lengths for 52-week), no silent overwrite, identical re-import no-op, `resolveFiscalContextForDate` / store-timezone instant mapping, ISO↔fiscal overlap by date range, `calendar_unavailable` when uncovered.
- Read API `GET /api/fiscal-calendar?date=YYYY-MM-DD` (Supervisor+). Floor/Map/rotations not dependent on fiscal tables.
- Synthetic test fixtures only — **no fabricated Lowe’s fiscal year**. ISO `assigned_week` unchanged. Seasons/events/pressure deferred (FS-002+ / SI-*).
- Completion-attempt first natural lifecycle still pending (untouched).

### Production
- Schema **LIVE** on `fmeinlwhixngednabhgy` (pre-migration dump `…T18-05-26-994Z.dump`). App ships with this commit.
- **Authoritative FY NOT SEEDED** — fiscal context remains `calendar_unavailable` until proven seed.
- Status: FS-001 FISCAL CALENDAR FOUNDATION LIVE — AWAITING AUTHORITATIVE FY SEED.

## 2026-09-05 — Completion-attempt history production-blocker correction

### Shipped (local only)
- Tightened `isCompletionAttemptHistoryUnavailable` to **this table only** (`42P01` / `PGRST205` + relation name). Missing column, wrong table, permission, unique, network no longer silently disable history.
- Auto-verify idempotent retry recovers a VERIFIED child from parent `completed_at` / `completed_by` / `verified_at` / `verified_by` via `recoverAutoVerifiedAttemptFromParent` (operation-local; no legacy backfill).
- `ON DELETE RESTRICT` retained — location hard-delete may fail once attempts exist (intentional fail-closed; soft-delete deferred).

### Production (updated after migration gate)
- Schema **LIVE** on `fmeinlwhixngednabhgy` via `20260905_weekly_rotation_completion_attempts.sql` (pre-migration dump `…T17-41-43-893Z.dump`).
- App implementation ships with this commit; first natural report/review lifecycle still **pending** (no fabricated rotations).

## 2026-09-05 — Completion-attempt history (local, not migrated)

### Shipped
- Additive migration `20260905_weekly_rotation_completion_attempts.sql`: child history for report/review cycles (`PENDING` / `VERIFIED` / `SENT_BACK`), FK `ON DELETE RESTRICT`, one-PENDING partial unique, RLS via parent `weekly_rotations` store/department.
- Domain owner `lib/store-ops/completion-attempt-history.ts`; wired into `completeWeeklyRotation`, `verifyPendingRotation`, `sendBackWeeklyRotation` (now records reviewer), auto-verify (single VERIFIED attempt).
- Super Admin `GET /api/store-locations/history` attaches `completion_attempts` when table exists.
- No legacy backfill. Parent remains current operational state. Missing-table skip only for relation absence during rollout.
- Privacy: actor ids are provenance, not performance scoring. Enables future first-pass/rework/lag derivation; seasonal correlation deferred.

### Production
- **Migration NOT applied.** Status: COMPLETION ATTEMPT HISTORY IMPLEMENTED LOCALLY — NOT MIGRATED.

### Validation
- Tests A–J in `completion-attempt-history.test.ts`; full suite / typecheck / build / lint regression.

## 2026-09-05 — Specialty M2 production gate (applied)

### Production
- Fresh pre-M2 dump `tmp/production-backups/deptsync-fmeinlwhixngednabhgy-2026-09-05T15-09-55-089Z.dump` (prior dumps retained).
- Preconditions: both specialty tables legacy + 0 rows; no deps.
- Applied `20260905_specialty_catalog_remnants_parity.sql` — Hub recreate + `jwt_matches_store` RLS.
- PostgREST: catalog/remnants former failing queries → **200** empty arrays; specialists still 200 (M1).
- Invented specialty rows: **0**. Anon table access denied (fail-closed).

## 2026-09-05 — Strengthen M2 specialty canonical detection

### Shipped (SQL correction only)
- Tightened already-Hub detection in `20260905_specialty_catalog_remnants_parity.sql`.
- Catalog: required columns include `roll_width_ft` / `updated_at` (+ category/SIMS); proves **full** unique `(store_number, sku)` via constraint or non-partial unique index (`indpred IS NULL`); partial uniques rejected.
- Remnants: required dimension + `updated_at` (+ status/created_at); proves PK/`id` unique (full).
- Mixed Hub/legacy → explicit exception. Recreate/RLS/zero-row/non-CASCADE unchanged.
- Local Postgres Cases 1–7 validated. **M2 still not applied to production.**

## 2026-09-05 — Specialty parity production gate (M1 only)

### Production
- Fresh logical dump taken (PG 17.4 `-Fc`); prior rotation-history dump retained.
- **M1 applied:** `store_specialists.home_department text NULL` — 8 rows unchanged; 0 backfilled.
- PostgREST specialist select including `home_department` → 200.
- **M2 NOT applied:** already-Hub detection insufficient for gate (catalog missing `roll_width_ft`/`updated_at`/unique proof; remnants missing dimension columns). Requires migration correction before apply.
- Catalog/remnants still legacy-shaped, 0 rows, former 400s remain.

## 2026-09-05 — Specialty schema parity migrations (authored, not applied)

### Shipped (SQL + docs only)
- `20260905_store_specialists_home_department.sql`: additive nullable `home_department`; no backfill; `assigned_department` remains canonical.
- `20260905_specialty_catalog_remnants_parity.sql`: zero-row guards → `DROP TABLE` without `CASCADE` → recreate Hub `carpet_catalog` / `carpet_remnants` → store-scoped RLS via `jwt_matches_store`. Full unique `(store_number, sku)` for catalog upserts.
- No application code changes; no production apply in this tranche.
- Live audit (pre-author): specialty tables empty + legacy-shaped; roster missing `home_department` only. App still falls back locally until migrations are applied.

### Validation
- Local: `npm test` · `npm run typecheck` · `npm run build` · lint regression-only.

## 2026-09-04 — Preserve weekly rotation history (Force Draw supersession)

### Shipped
- Migration `20260905_weekly_rotations_superseded.sql`: `superseded_at` / `supersede_source` / `superseded_by`; drop full unique; partial unique on active `(location_id, assigned_week) WHERE superseded_at IS NULL`.
- Force Draw / Admin reset **supersede** incomplete (or all, for admin) active rows instead of hard-delete — original `id` + `created_at` survive.
- Active plan contract: `superseded_at IS NULL`. Layer-1 `weekly-rotation-metrics-v1` filters active rows only (method id unchanged — output meaning matches intended operational plan).
- PostgREST `ON CONFLICT(location_id,assigned_week)` cannot reliably target the partial index → Force Draw stays insert-after-clear; upsert mismatch falls through to active-row merge; unique-violation recovery supersedes conflicts instead of deleting.
- Sunday assignment rows for superseded rotation ids are still cleared (assignment history remains known P1 debt).
- Pre-migration Force Draw deletions remain **UNKNOWN** — no fabricated backfill.
- Tests: `rotation-history.test.ts` Cases A–H (uniqueness Case C is DB-enforced by partial unique index).

### Validation
- Local: `npm test` · `npm run typecheck` · `npm run build` · lint regression-only.
- Migration not applied to production in this tranche — schema validated as SQL + code paths only.

## 2026-09-04 — Canonical Layer-1 rotation metrics (A-1)

### Shipped
- Added `lib/store-ops/rotation-metrics.ts` (`weekly-rotation-metrics-v1`) as the sole owner of staged / reported / pending verification / verified / open / target deficit / verification lag.
- Floor week headline + readiness appendix use verified vs awaiting review — never ambiguous “complete.”
- Store health + weekly audit rollup `completion_pct` / quota deficit key off **verified** complete; reported remains labeled separately.
- Map week overlay paints green only for `VERIFIED_COMPLETE` (not `is_completed` alone). Freshness still uses `last_completed_at` (set on DS verify).
- Tests: Cases A–F in `rotation-metrics.test.ts` + updated `floor-readiness.test.ts`.
- No schema/migrations; no Force Draw / Sunday / mutation changes.

### Validation
- `npm test` · `npm run typecheck` · `npm run build` pass.
- Lint baseline unchanged (108 problems).
- Fixtures: `tmp/layer1-metrics-validation/` (do not commit).

## 2026-09-04 — DeptSync Constitution established

### Shipped (documentation only)
- Added root `DEPTSYNC_CONSTITUTION.md` — governing laws for purpose, human/data/intelligence authority, rotation/verification, UI hierarchy, security, offline intent, and anti-drift evidence tests.
- Baseline pinned to `main` @ `d6d580617a0b8f78abe48c888613a6d8b6b527e8`.
- No application, schema, auth, or rotation behavior changes.
- Cross-refs: `DEPT_SYNC_STATE.md` doc map, `README.md` Docs list.
- Constitutional debt recorded (derived completion vs verification; partial offline; shared roster/auth storage) — not fixed in this tranche.

## 2026-09-04 — Information hierarchy (Floor / Map operate vs configure)

### Shipped
- Floor: removed Topology / Bay Setup CTA (configure stays in More → Store Topology). Stage CTA relabeled **Stage this week**.
- Floor: when `pendingVerifyCount > 0`, first-class **Awaiting your verification** strip opens existing `SupervisorAuditSummaryModal` (no new mutation path).
- Empty week: operational plan (week · 0 staged · target · mapped) + Stage; no Floor route to Master Trigger/cron.
- Map: aisle navigator before **Snap Bay Photo** (tool demoted below grid).
- Copy: Snap Bay Photo; More **Generate this week's list**; targets **weekly auto-stage**. **Needs Attention** filter label unchanged (multi-condition; not verify-only).
- Screenshots: `tmp/hierarchy-implementation/` (do not commit).

## 2026-09-04 — Mobile shell scroll ownership

### Shipped
- Authenticated workflow shell locks to `h-dvh` / `max-h-dvh` with `overflow-hidden` (`.hub-app-shell`). Keep-alive tab panels are `absolute inset-0` and own vertical scroll.
- `.hub-main` bottom padding clears the fixed dock via `--hub-bottom-nav-min-height` + safe-area + breathing room (replaces hard-coded `pb-28`).
- Specialty hub (`app/page.tsx`) uses the same viewport shell so scan tools clear the fixed dock.
- `SessionGate` restore is try/catch wrapped so a corrupt local session cannot leave the splash hung.
- Root cause: `min-h-dvh` + nested `overflow-y-auto` grew with content so mobile touch scrolling trapped on a non-scrolling overflow box while the fixed bottom nav covered unreachable content.

## 2026-09-04 — Two-DS floor pilot polish

### Shipped
- Store identity: `resolveActiveStoreNumber` / `adoptStoreNumberFromSpecialist` — SessionGate + cold restore adopt authenticated profile store when device hub store is unset (fixes `SET STORE #` with known session store).
- Remnant calculator: `composeRemnantArea` live label; empty length no longer looks like a calculated `0.00` with a filled-looking placeholder.
- Sunday assignment: staged-work summary + hours→share copy first; cross-dept access collapsed by default; proportional engine unchanged.
- Floor readiness headline from `composeBayFreshness` + weekly target (`composeFloorReadinessLine`).
- Pilot ops checklist: `DEPT_SYNC_STATE.md` Appendix D.

## 2026-08-17 — Bay workflow profiles + Appliance SIMS / placard checklist

### Shipped
- Topology owns `store_locations.workflow_type` (`STANDARD_MERCH` | `APPLIANCE_SIMS_AUDIT` | `BULK_PALLET_AUDIT`). Migration `20260818_store_location_workflow_type.sql`. Not on `departments`.
- Bulk Generator tags new bays; Appliances/D35 defaults to SIMS. Master can apply a workflow to every mapped bay in a department. Edit Bay + Add Bay honor the same enum.
- Floor `ZebraChecklist` routes `APPLIANCE_SIMS_AUDIT` to `ApplianceSimsChecklist` (placards → continuous scanner → catalog/serial flags → placard confirm → Complete & Submit). Completions still use `completeRotation`. `BULK_PALLET_AUDIT` keeps the standard Quick Touch row.
- Scanner opened from a SIMS bay stamps `appliance_scans.location_id` / `aisle` / `bay_number` (`20260818_appliance_scans_bay_location.sql`). Live carton badge is presentation-only; recon is `lib/appliances/sims-reconciliation.ts` (empty bay / unknown SKU / missing serial — no invented on-hands).

## 2026-08-17 — Department pin reactivity + DS verification queue

### Shipped
- Header pin (`useWorkingDepartment`) uses `useSyncExternalStore` so Floor/Map/Settings update in the same tick. Pin no longer wipes IndexedDB. Floor/Map reset lists on pin change, then peek the target department cache.
- Specialty `?section=` updates React state synchronously with `replaceState`; `popstate` keeps the scan pane aligned. Generic department audit follows a generic pin.
- Week-item review lives on `weekly_rotations.verification_status` (`20260818_weekly_rotation_verification.sql`): `PENDING` → `PENDING_VERIFICATION` → `VERIFIED_COMPLETE`. Location `COMPLETED` waits for DS verify. Associates submit via `POST /api/rotations/complete`; DS/Master auto-verify.
- Floor **Weekly audit rollup** is the DS queue: Verify & Pass, Send Back with Note, Verify All & Close Out Week. Owner: `lib/store-ops/rotation-review.ts`.

## 2026-08-17 — Trigger Weekly Rotation: multi-department batch draw

### Shipped
- `ForceRotationModal` — checkbox popover with Select All / Clear All and summary pill (`All Departments (N)` / `X Departments Selected`).
- `generateRotationsBatch` in `lib/store-ops/client.ts` — posts `{ department_ids, bay_count, force_overwrite }`, invalidates rotation cache once per batch.
- `POST /api/rotations/generate` — batch path runs draws in parallel, aggregates `{ success_count, failed_count, staged_bays }`, dispatches push per successful department. Single-department body unchanged for Flooring Stage/Draw 12.

## 2026-08-17 — Appliance audit: granular edits, location mode, export & reset

### Shipped
- Migration `20260818_appliance_scans_location_condition.sql` — `location_type` (showroom/topstock) + `condition_tag` (NEW_BOXED, SHOWROOM_DISPLAY, SCRATCH_DENT, OPEN_BOX).
- Migration `20260818_appliance_showroom_baseline.sql` — `is_showroom_baseline` for MST-locked display counts across weekly topstock resets.
- Scanner modes: **Showroom Display** (defaults `showroom` + `SHOWROOM_DISPLAY`) vs **Boxed / Topstock**.
- Audit list badges + `Total: N (X Showroom Display, Y Boxed Stock)` summaries; **Lock Showroom Baseline** + reset with preserve baseline.
- `ApplianceScanEditModal` — quantity, per-unit serial + condition, location mode + bay tags.
- `ApplianceScanForm` — top showroom/topstock toggle tags each scan payload.
- `ApplianceAuditActionBar` — Share/Export CSV (`navigator.share` fallback), mailto summary, copy CSV, two-step reset via `DELETE ?scope=store`.
- `lib/appliances/audit-export.ts` — audit CSV + email body formatting.
- `POST /api/appliances/ai-anomaly` — reads location types; local heuristics flag count variance vs prior ledger, split showroom/topstock, condition mismatches.

## 2026-08-17 — Specialty Tools: appliance scanner & remnant calculator navigation

### Shipped
- `lib/specialty-tools.ts` — registry (`SPECIALTY_TOOLS`, `visibleSpecialtyTools`, open events + `#scan` / `#remnants-calculator` hashes).
- `ApplianceScannerModal` wraps `ApplianceScanForm` — continuous UPC scan stays open between logs; `focusOnMount` keeps wedge/camera input on the SKU field.
- `RemnantCalculatorModal` — shared roll length / sq yd / price-tag calculator (used by `RemnantSection` and `CycleAuditSection`).
- **Appliances** (`ApplianceAuditSection`): prominent **Scan & Count Appliances** CTA; Floor tab shortcut when working dept is appliances.
- **Flooring** (`CycleAuditSection` + `RemnantSection`): **Carpet Remnant Calculator** beside Remnant Intelligence / Snap Bay; Floor tab shortcut when working dept is flooring.
- **Global:** Specialty Tools panel on specialty hub (`/`), user menu section in `NavigationHub`, Settings `#remnants-calculator` deep link.

## 2026-08-17 — AI Operations Trio: audit persistence, snag triage, completion gate

### Shipped
- `bay_audit_logs` migration + RLS (`20260818_bay_audit_logs.sql`) — persists multimodal audit verdicts with rubric JSON.
- `POST /api/ai/bay-audit/validate` — rubric scoring (planogram, tags, top-stock banding, aisle clearance) + log insert.
- `POST /api/ai/snag/triage` — equipment-aware snag classification; optional dispatch to `downstock_queue`, `shift_walk_tasks`, or `rotation_exceptions`.
- `POST /api/rotations/complete` — gates on `audit_verdict: FAIL` unless `supervisor_override`; `BayCompleteGatedError` in client.
- `ZebraChecklist` supervisor override button; `VisualBayScannerModal` audit mode via `validateBayAudit`.

## 2026-08-17 — Force Draw clears staged week; Admin Sandbox rotation reset

### Found
- Live DBs may carry `weekly_rotations_store_dept_week_uniq` on `(store_number, department_id, week_number)`, which allows only one bay per department per ISO week and breaks multi-bay Force Draw inserts.
- Force Draw could hit duplicate-key errors when incomplete rows were not fully cleared before upsert.

### Shipped
- `resetStagedWeekRotations` in `lib/store-ops/rotations.ts` — deletes `weekly_rotations`, matching `sunday_bay_assignments`, and resets affected bays to `PENDING`. `replaceIncompleteWeekRotations` delegates to it (incomplete only). Force Draw uses insert-after-clear and retries on unique violations.
- Migration `20260818_drop_weekly_rotations_store_dept_week_uniq.sql` drops the mistaken unique when present.
- `POST /api/admin/rotations/reset` (Master Admin) + `resetStagedRotation` client helper; invalidates rotation cache on success.
- Developer sandbox (3-tap DeptSync logo) **Danger zone / testing actions**: department + ISO week selectors, two-step **Clear staged rotation**.

## 2026-08-17 — Weekly rotation upsert fills week_number from assigned_week

### Found
- Live `weekly_rotations.week_number` is NOT NULL. Force Draw omitted it, so Postgres rejected the insert.

### Shipped
- `parseIsoWeekLabel` in `lib/store-ops/week.ts` owns `2026-W34` → `{ year: 2026, week: 34 }`. Persist sends `week_number` and `year` with `assigned_week`. Invalid labels throw; week 34 is never invented as a default.
- If PostgREST does not have `week_number` / `year`, those columns are stripped and the upsert retries.

## 2026-08-17 — Weekly rotation upsert unique is location + ISO week

### Found
- PostgREST rejected `weekly_rotations` upsert: no UNIQUE matching `onConflict`. `CREATE TABLE IF NOT EXISTS` never added `(location_id, assigned_week)` on older tables. There is no `week_number` column.

### Shipped
- `supabase/migrations/20260817_weekly_rotations_location_week_unique.sql` dedupes, adds `weekly_rotations_location_id_assigned_week_key`, and `NOTIFY pgrst, 'reload schema'`.
- Persist still uses `onConflict: location_id,assigned_week`. On mismatch it merges by that pair instead of inventing `store_number,department_id,week_number`.

## 2026-08-17 — Weekly rotation upsert matches live store columns

### Found
- Force Draw / Sunday cron upserted `weekly_rotations` with `store_id` only. Live tables may have `store_id` (multi-store UUID), `store_number` (JWT RLS), or both. PostgREST PGRST204 ("schema cache") threw on the unknown column.

### Shipped
- Persist stays in `lib/store-ops/rotations.ts` (`upsertWeeklyRotations`). Rows send both store identifiers when known; missing-column errors strip that field and retry. NOT NULL after a cache miss surfaces a reload-schema message instead of a raw PostgREST dump.
- Cron and Force Draw pass the already-resolved store identity so the engine does not depend on a single department column.

## 2026-08-17 — Header department pin filters Floor, Map, and Roster in place

### Found
- Picking Appliances (or any dept) from the header jumped to `/?section=` specialty scans, so Floor/Map/Roster never received the pin.
- Hub title still said Flooring Rotation for Full Store. Roster ignored the pin.

### Shipped
- Pin still owns `lib/admin-department-context.ts` (localStorage + event). `useWorkingDepartment` is the React subscription — not a second store. Header stays on the current workflow tab.
- Floor / Map / Roster subscribe and filter: Floor Rotation vs `${dept} Rotation`; Map aisles for `workingDepartmentId`; Roster expands and highlights the matching accordion.

## 2026-08-17 — Floor title, downstock sheet, department-scoped on-duty strip

### Found
- Full-store Floor titled itself **Flooring Rotation** because the header fell back to D23 when `deptId` was unset.
- Flag Downstock bumped the first unflagged bay note instead of a real picker.
- On Duty Today listed every on-duty associate in Full Store, so the pill strip scrolled sideways.

### Shipped
- Header is `${activeDept.name} Rotation` when a department is pinned, and **Floor Rotation** for All / Full Store.
- Flag Downstock opens `FlagDownstockSheet`: aisle/bay search, Needs Top-stock Drop, persist via `flagForDownstock`. Bay-card Pull remains.
- On-duty strip uses `canAccessDepartment` (home or `accessible_departments`). Full Store with more than 6 people collapses to `[ Users N Associates On Duty ]` and a person filter sheet.

## 2026-08-17 — Pair landing prompts standalone install before Floor

### Found
- `/pair` signed in and sent associates to `/dashboard` in the browser chrome, so the first Hub session stayed a tab instead of fullscreen PWA.

### Shipped
- After PIN redeem, `/pair` composes `lib/pwa-install.ts`: standalone (`display-mode: standalone` / iOS `navigator.standalone`) goes to `/`; captured `beforeinstallprompt` calls `prompt()` then `/`; iOS / blocked prompt shows Lucide `Download` / `Share` / `CheckCircle2` Add to Home Screen card, then Continue to Floor (`/`).
- Manifest already has `"display": "standalone"`, `"start_url": "/"`, and 192/512 icons (`public/manifest.json` + `app/manifest.ts`). No second install-event owner.

## 2026-08-17 — Roster pairing is ephemeral QR, not SMS

### Found
- Add Team Member and Send App Invite required a phone number and SMS'd `/auth/verify/[token]`.
- Phone was in the active roster invite path even when the associate was already on the floor roster.

### Shipped
- Crypto owner: `lib/auth/invite-token.ts` — HMAC payload `{ specialist_id, store_number, nonce, exp }`, 10-minute TTL. Persist SHA-256(nonce) on existing `invite_token_hash` / `invite_token_expires_at` (also mirrored to `auth_token_*` for lookup).
- Compose owner: `lib/onboarding/qr-pair.ts`. Issue: `POST /api/roster/pair` (Master). Redeem: public `POST /api/auth/redeem-invite` (preview without burn; PIN + confirm burns hash, saves PIN, Hub JWT with `store_number`).
- `SpecialistEditSheet` **Pair Device via QR** (`QrCode` / `ShieldCheck` / `Clock`, stroke 1.75) opens a high-contrast `qrcode.react` overlay with countdown and Regenerate QR. Add Team Member is roster-only; optional phone stays for contact / PIN-reset only.
- Associate lands on `/pair?t=` then standalone install (or Add to Home Screen card) then Floor (`/`). `lib/onboarding/roster-invite.ts` is unused by Roster UI (PIN-reset SMS still uses `/auth/verify`).

## 2026-08-17 — Settings is four Lucide cards

### Found
- Settings stacked Sunday schedule, an emoji Appearance card, PIN, quotas, topology, store config, taxonomies, remnants, and Device & sync as separate surfaces.

### Shipped
- Four cards: Profile & Preferences (`UserCheck` / `Sliders`), Department Targets & Sunday Auto-Stage (`Calendar` / `Target`), Store Topology & Bay Setup (`Layers` / `PlusCircle`, still collapsed), Catalog & Remnants (`FolderTree` / `Scissors`).
- Appearance is Lucide `Palette` → existing `UserPreferencesDrawer`. Force Draw is `RefreshCw` Trigger Weekly Rotation Now. No emoji in Settings chrome.

## 2026-08-17 — Roster compact rows; manage sheet owns schedule and grants

### Found
- Roster cards stacked weekly S–S dots, inline Edit Schedule, a full-width On-Duty switch, Send App Invite, and the 11-department access grid on every accordion row.

### Shipped
- Compact `SpecialistCard` rows: name, Specialist/CSA/Supervisor badge, `07:00 – 15:30` (or Off / Call-out), On-Duty switch, Lucide `SlidersHorizontal` manage.
- `SpecialistEditSheet` hosts Edit Schedule (`AssociateScheduleModal` embedded), cross-department chips (`POST /api/admin/department-access` → `store_specialists.accessible_departments`), Pair Device via QR, Change/Reset PIN, and Remove Specialist.
- On-Duty still persists to `associate_shift_days` (not `is_active`) so toggling duty cannot hide the roster row. Optimistic weekRows + rollback on failure. Department headers keep `D23 · Flooring` with Lucide department glyphs (`DoorOpen` for Millwork) at stroke 1.75.

## 2026-08-17 — Map is a floor navigator; topology lives in Settings

### Found
- Map stacked Visual Grid | Manage Aisles & Bays, so walk/heatmap competed with CRUD, bulk generate, and batch delete.
- Settings already hosted a second Bulk Generator accordion, duplicating the Map manage console.

### Shipped
- Map is Standard Map | Velocity Heatmap plus Snap Bay. Aisle accordions show `X Bays · Y Complete / Z Stale` with Lucide `CheckCircle2` / `Clock` / `AlertTriangle` (stroke 1.75). Tap still opens `WalkTheFloorSheet`.
- `AisleBayManager` (Add Single Bay, Bulk Generator, Delete Selected) moved to Settings **Store Topology & Bay Setup** (`#bulk-generate` / `#topology`). One definition; Map no longer mounts it.

## 2026-08-17 — Floor tab on-duty bay queue

### Found
- Floor stacked briefing, velocity, health, Walk & Talk, scan pills, and the bay list in one viewport.
- Specialty scan chips (`Flooring Scan` / `Appliances Scan`) duplicated specialty-hub entry on the Floor fold.
- Sunday staging headlines embedded a lightning emoji.

### Shipped
- Floor primary viewport is `${activeDept.name} Rotation`, Snap Bay / Flag Downstock, today's on-duty pills (`store_specialists` + `associate_shift_days`), and a proportional bay queue.
- `composeOnDutyBayWorkload` groups staged `weekly_rotations` onto on-duty associates (persisted `sunday_bay_assignments` win; unassigned bays are display-only via `planProportionalBayAssignments` — no duplicate rows).
- Shift velocity, store health, Walk & Talk, briefing, copilot, freshness, showroom, exceptions, and verify/rollup nest in collapsed `ShiftAnalyticsDrawer`.
- Floor Lucide icons use `strokeWidth={1.75}`; Sunday headline strings no longer embed emoji.

## 2026-08-17 — Queue specialist stub includes `is_active`

### Found
- `specialistFromSyncPayload` in `lib/store-ops/client.ts` built a synthetic `StoreSpecialist` without required `is_active`, which failed `tsc` / `next build`.

### Shipped
- Stub returns `is_active: true` (queue replay is an active floor actor). `npm run build` compiles with zero type errors.

## 2026-08-17 — Health math + mobile dock polish

### Found
- `completionPct` was copied in `health.ts` and `audit-summary.ts`. Bay flag penalties (28/18/16/12) were duplicated in `bay-health.ts` and `weekly-rotations.ts`.
- Cycle/department Log bars used `fixed bottom-16 max-w-md` while BottomNav is `max-w-lg` + safe-area, so the stack jumped and the undo toast sat on the primary action.
- Variance, aging, SIMS, and clearance pills still used OS emoji.

### Shipped
- `computeDepartmentCompletionPct` and `flagPenalty` / `BAY_HEALTH_FLAG_PENALTY` live in `lib/store-ops/health.ts`. Audit rollup, bay finding scores, and Sunday risk compose them. `health.ts` dynamically imports `bay-health.ts` so scoring is not a circular owner.
- `.hub-bottom-nav` / `.hub-scan-dock` / `.hub-toast-dock` share `--hub-bottom-nav-stack` + `env(safe-area-inset-bottom)`. Specialty hub is `max-w-lg`. Sonner stays top-center under the header.
- Status glyphs: `StatusPills` + HubIcon (`mapPin`, `circleCheck`, `circleAlert`, `tag`, `undo`) at stroke 1.75. Knowledge labels in `aging.ts` / `markdown.ts` no longer embed emoji.

## 2026-08-17 — Store Ops mutations join the offline sync queue

### Found
- Zebra bay complete, downstock flags, and Sunday assignments wrote live HTTP/Supabase only. Dead-zone scans queued Hub audits but dropped floor mutations.

### Shipped
- `enqueueOrExecute` on `lib/sync-queue.ts` for `STORE_OPS_COMPLETE_ROTATION`, `STORE_OPS_DOWNSTOCK_ADD`, `STORE_OPS_SUNDAY_ASSIGN`. Payloads keep live domain fields (`rotation_id`, `downstock_queue` week/dept, Sunday `bay_id` + ISO week). SKU/quantity aliases on downstock are empty — that table has no SKU column.
- `completeRotation`, `flagForDownstock`, and `setSundayBayAssignment` use the pipeline. Optimistic Zebra UI rolls back only on permanent 4xx.
- `SyncStatusPill` on the hub header — hidden at 0, amber pulse with pending count. Auto-flush on `online` was already owned by `installSyncAutoFlush`.

## 2026-08-17 — jwt_row_matches_store(text, text)

### Found
- Live `bay_service_logs.store_id` is `text`, not `uuid`. `jwt_row_matches_store(null, store_id)` resolved as `(unknown, text)` and failed 42883.

### Shipped
- Helper is `(text, text)` with `::text` casts at every policy call site. Re-run `20260817_rls_security_lockdown.sql` (idempotent).

## 2026-08-17 — RLS security lockdown (Hub + Store Ops)

### Found
- Anon `FOR ALL USING (true)` on `store_specialists`, carpet_*, and appliance_* exposed roster secrets and cross-store inventory to the public anon key.
- `manager_notes` authenticated CRUD used `USING (true)`.
- `20260816_store_locations_read.sql` + `20260816_rls_read_write_parity.sql` opened `SELECT USING (true)` on 13 tables (including map/rotation/shift).

### Shipped
- `supabase/migrations/20260817_rls_security_lockdown.sql`: drop anon/open policies; authenticated `jwt_matches_store` on Hub inventory; roster SELECT store-scoped, writes `jwt_is_roster_admin`; manager_notes store+department; Store Ops SELECT store-scoped (writes keep existing JWT FOR ALL). Secret columns revoked from client roles. Realtime publication: `sunday_bay_assignments`, `manager_notes`, `downstock_queue` (canonical names — `sunday_audit_assignments` / `department_downstock_items` do not exist).
- Login no longer SELECTs the roster as anon. `POST /api/auth/hub-bridge` returns a sanitized specialist; AccessGate waits for Hub-bridge JWT before `fetchSpecialists`.

## 2026-08-16 — Sunday draw pre-selects Flooring-tagged associates

### Found
- `mergeShiftRoster` / `defaultShiftRoster` turned every non-Master associate **on**, so Appliances / Millwork / Cabinets were selected on the Flooring Cycle Audit drawer.

### Shipped
- Seed `active` from `associateMatchesSundayDepartment` (home / assigned / job-title slug vs D23 Flooring). Other departments start off. Shift roster cache bumped to `deptsync_shift_roster_v3` so old everyone-on caches do not override the seed.
- Drawer roster + balancer show job-title badges and `Selected: N Flooring associates (… from other depts unselected)`. Cross-dept checkboxes are Master Admin only.

## 2026-08-16 — Hobby cron blocked Vercel deploys

### Found
- Git pushes still reached Vercel. `*/15 * * * *` in `vercel.json` exceeds Hobby’s once-per-day cron limit, so deploys failed with [cron usage/pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing) and production stayed on `4fb0293`.

### Shipped
- Restored Sunday once-daily `0 11 * * 0` (11:00 UTC ≈ 05:00 America/Denver). Store auto-generate / local time / skip-if-staged still apply. Sub-daily polling needs Pro.

## 2026-08-16 — Sunday rotation schedule is store-configurable

### Found
- Trigger was **Vercel Cron only** (`59 23 * * 0` = Sunday 23:59 UTC) → `GET /api/cron/weekly-rotation` (`CRON_SECRET`). No app-mount check. Manual paths: Settings Force Draw and the Flooring staging card Stage/Draw 12 (Master Admin `POST /api/rotations/generate`).
- Cron always upserted even when the ISO week was already staged. Force Draw UI hard-coded “Automated Cron: Active”.

### Shipped
- **Store clock.** `stores.sunday_auto_generate` (default on), `sunday_auto_stage_time` (default 05:00), `timezone` (default America/Denver). Knowledge: `lib/store-ops/sunday-schedule.ts`. UI: Settings `SundayScheduleCard`. API: `GET|PATCH /api/stores/settings`. Apply `20260816_sunday_rotation_schedule.sql`.
- **Dispatch.** Vercel Cron Sunday 11:00 UTC. Per store: skip if auto-run off, not Sunday local, or before stage time. Skip if `weekly_rotations` already exist for the staging week. Sunday stages the upcoming Monday ISO week so Floor/checklist align after 05:00.
- **Manual override.** Staging card shows on Sunday even with 0 bays. Master Recalculate / Force Draw send `force: true` and replace incomplete rows (completed bays stay). Specialist re-assignment stays unrestricted in the drawer.

## 2026-08-16 — Header store number always visible

### Shipped
- Hub brand line is `DeptSync · #2587` (`formatStoreHeaderTag`) instead of truncated `DeptSync · Lowe's #…`.
- If the brand line still overflows, it marquee-scrolls with a pause at each end (`prefers-reduced-motion` disables the ticker).
- D23 pill and account/Online chip stay shrink-0 and aligned; the account chip is narrower on phones so the store digits keep the remaining width.

## 2026-08-16 — Roster Specialist vs CSA floor titles

### Shipped
- Add Team Member role dropdown lists Flooring/Appliances/Millwork/Cabinets **Specialist** and **CSA**, plus Department Supervisor, Associate, Cashier, and Receiving (`ROSTER_JOB_OPTIONS` in `lib/types.ts`).
- Platform `role` stays Associate / Supervisor / MasterAdmin for RBAC. Lowe's job title persists as `store_specialists.floor_title` (`CSA`, `Specialist`, `Cashier`, `Receiving`). Selecting Flooring CSA writes `floor_title=CSA` and `assigned_department`/`home_department=flooring`.
- Roster cards show a Specialist / CSA / Supervisor badge. Accordion grouping is still home department — both titles render under D23 Flooring.
- Apply `20260816_roster_floor_title.sql`.

## 2026-08-16 — Read/write visibility audit

### Found
- **carpet_* RLS.** Policies were anon-only; Hub-bridge after PIN is authenticated, so cycle audits/catalog/remnants were invisible.
- **JWT store/dept.** `jwt_matches_store` was exact string (`2587` ≠ `02587`). `jwt_matches_department_code` was exact (`flooring` ≠ `D23`). Client-written Sunday/downstock/shift rows failed RLS.
- **Sunday CHECK.** Writers sent `CARRIED_OVER`; column only allowed lowercase pending|assigned|completed|cleared.
- **SELECT filters.** weekly_rotations GET used a single department UUID; carpet/appliance reads used exact store_number.

### Shipped
- Department family on weekly-rotations GET; flooring/D23 aliases on Sunday/downstock/shift-task SELECTs; store aliases on carpet_* and appliance_scans.
- Cache invalidate on showroom complete, week verify, and department target/active.
- Apply `20260816_rls_read_write_parity.sql`.

## 2026-08-16 — store_locations Map/Floor visibility (PENDING + RLS + cache)

### Shipped
- **Status.** Map/Floor `GET /api/store-locations` does not filter rotation `status`. New bays stay `PENDING` (available for Sunday draw, not an approval gate) and `is_active=true`. Visual Grid and Manage show a Pending chip instead of hiding them. There is no location status named `ACTIVE`.
- **Department join.** Hub pin `flooring` matches live `departments.code` `flooring` or Lowe's `D23` (and the same family for D35/appliances, …). GET expands to every matching `department_id` in the store so Aisle 41 tags under UUID `afd0bf9b-…` render when the UI pin is D23 Flooring.
- **RLS.** Apply `20260816_store_locations_read.sql` — `Allow read access for store locations` SELECT `USING (true)` for `anon` and `authenticated`. List API still uses the service role; this unblocks direct client reads.
- **Cache.** `bulkGenerateLocations` awaits `invalidateStoreOpsListCaches()` (clears L1 TTL + IndexedDB) then notifies keep-alive Map/Floor to refetch so an empty snapshot cannot hide newly inserted bays.

## 2026-08-16 — Live Store Ops writes; no fake-success fallbacks

### Shipped
- **Bay / rotation reads.** `GET /api/weekly-rotations` and `fetchThisWeekRotations` throw on failure instead of returning an empty week. Map/Floor keep last live snapshot rather than painting dummy bays.
- **Downstock, shifts, walk tasks.** `downstock_queue`, `associate_shift_days`, and `shift_walk_tasks` write Supabase first; localStorage only caches a successful row. Missing tables surface a migration error instead of silent local success.
- **Store bind.** `stores` lookup and Sunday/shift/downstock queries use store-number aliases (`2587` / `02587`). Settings/targets no longer inject `fallback:*` department IDs.

## 2026-08-16 — Roster UI no longer drops live store_specialists rows

### Shipped
- **Store bind.** Accordion fetch keeps rows whose `store_number` is digit-equal to the hub session (`2587` = `02587`). Strict string equality was dropping the live roster after `.in(store_number, aliases)` succeeded.
- **Department normalize.** `parseDepartmentScope` maps `appliances`, `D35`, `d35`, and `D35 · Appliances` to the same accordion. Grouping prefers `home_department`, then `assigned_department`.
- **No invite/auth filter.** `fetchSpecialists` still SELECTs by store only — `invite_token` / `auth_user_id` null rows stay in the list. Database UUIDs are never treated as placeholder names, and distinct UUID cards are not collapsed by display name.

## 2026-08-15 — Unified roster create pipeline

### Shipped
- **One write path.** Roster header **+ Add Team Member** (`RosterTab` → `AddTeamMemberSheet`) inserts through `POST /api/roster/members` → `createRosterMember` → `store_specialists`. Department accordions read the same table via `fetchSpecialists` (no `useRoster` / `team_members` / `roster_members`).
- **Disconnected legacy create.** `SpecialistModal` is picker-only (no client `saveSpecialist` upsert with default PIN `1234`). `saveSpecialist` now updates existing UUID rows only. `POST /api/admin/invite-supervisor` is SMS invite / re-invite only.
- **Instant accordion.** Verified UUID → `invalidateRosterCache` + optimistic append + `fetchSpecialists` refetch so the new member’s home-department accordion appears immediately.

## 2026-08-15 — Roster insert logging + RLS + store bind

### Shipped
- **Logged mutation.** `persistSpecialistPatch` logs insert payload (`store_id`, `store_number`, `name`, `role`, `home_department`) and `console.error("Roster Insert Failed:", error)` when Supabase returns an error or 0 rows. Add Team Member does not toast success unless a UUID row comes back.
- **RLS.** Apply `20260815_roster_insert_rls.sql` — authenticated INSERT/SELECT policies allow roster-only rows (`auth_user_id IS NULL`). Hub-bridge sessions use the authenticated JWT, so the old “anon all” policy never saw those inserts.
- **Store bind.** Insert writes the same Lowe's `store_number` the Roster tab queries (leading-zero aliases). Fetch uses `.in(store_number, aliases)` and never filters `auth_user_id IS NULL`.

## 2026-08-15 — Roster create, dynamic departments, auth claim

### Shipped
- **Nullable Auth link.** `store_specialists.auth_user_id` / `email` are optional. Live `user_id` / `auth_id` aliases drop NOT NULL so Add Team Member can insert name, role, home department, and today's on-duty shift without an `auth.users` row. Apply `20260815_roster_auth_link.sql`.
- **Insert resilience.** `persistSpecialistPatch` omits empty auth identity columns, retries missing optional columns (including `invite_token`, `email`, `home_department`), and surfaces a migration hint on auth NOT NULL failures. Create invalidates the 45s roster SWR cache; Roster paints the new card immediately then re-fetches.
- **Dynamic grouping.** `composeRosterDepartmentGroups` emits a collapsed accordion for every home department that has members. Headings use Lowe's codes (`D23 · Flooring`, `D28 · Inside Garden`). `parseDepartmentScope` maps D23/D28I/… so associates no longer collapse into Flooring.
- **Auth claiming.** Signup / invite / Hub-bridge stamps `auth_user_id` on the matching roster row (email, invite token, specialist id, or phone) and promotes invited/pending → active. Never inserts a second roster card. `handle_new_user` composes the same claim.

## 2026-08-15 — Roster-only members vs app invite

### Shipped
- **Decoupled roster from auth.** Add Team Member defaults to floor roster only: Name, Role, Initial Department required; phone optional; **Send Mobile App Invite** unchecked. Inserts `status=active` with `auth_token_hash`, `auth_token_expires_at`, and `pin_hash` null — immediately available for schedules, walks, and rotations. No SMS, no tokens.
- **Optional invite** still composes `issueRosterInvite` when the checkbox is on (phone required) or via **Send App Invite** on a Roster Only card.
- **App access badges** (Roster Only / Invited / Active) use `pin_updated_at` — roster lists never select `pin_hash`. Apply `20260815_roster_app_access.sql` to backfill existing PINs.
- Hub-bridge refuses roster-only profiles (`This profile has no app access yet`) instead of matching the default PIN.

## 2026-08-15 — Unified SMS token invite + self-service PIN reset

### Shipped
- **Schema** — `auth_token_hash`, `auth_token_expires_at`, `pin_hash`, `pin_updated_at`; `status` is `invited | active | suspended`. Apply `20260815_unified_auth_token.sql`.
- **Invite Associate** (`lib/onboarding/roster-invite.ts`) issues a 256-bit token, stores SHA-256 only, sets `invited`, SMS `/auth/verify/[token]`.
- **Request PIN Reset** (`lib/onboarding/pin-reset.ts` + `POST /api/auth/pin-reset/request`) validates registered phone, invalidates prior tokens, 30-minute hashed link.
- **Redemption** (`/auth/verify/[token]`) consumes the hash on GET (replay-safe cookie), then POST sets a 4–6 digit `pin_hash`, `pin_updated_at = now()`, `status=active`, and mints Hub-bridge Auth + hub-gate cookies for RLS.
- Crypto owner is `lib/auth-token.ts`. `lib/invite.ts` owns SMS copy only. Legacy `/invite/[token]` redirects here.

## 2026-08-15 — Roster SMS/link invite + PIN setup

### Shipped
- **Roster add-member** no longer accepts a manual PIN. Form is Name, Role, Initial Department, Phone. Master submits roster-only → `POST /api/roster/members`. Send Mobile App Invite → `POST /api/admin/invite-supervisor`.
- **Onboarding service** (`lib/onboarding/roster-invite.ts`) generates a 6-digit temp PIN and a 256-bit one-time token, SHA-256-hashes the token before persist, sets `status=invited`, and dispatches SMS (`lib/onboarding/sms-dispatch.ts`: Twilio, else webhook stub / copyable `sms:` preview).
- **Activation** is `/invite/[token]` (`InviteOnboardingView`). Legacy `/invite?token=` redirects. `GET/POST /api/invite/[token]` looks up `invite_token_hash`, verifies the temp PIN, consumes the token (`invite_consumed_at`), hashes the permanent 4–6 digit PIN, and sets `status=active`.
- Apply `supabase/migrations/20260815_roster_invite_onboarding.sql` (`status`, `invite_token_hash`, `invite_consumed_at`). Hub-bridge refuses `invited` rows until the invite link is completed.

## 2026-08-15 — Enterprise ingest contracts (stubs)

### Shipped
- **Contracts** — `src/types/enterpriseIntegration.ts` owns Zod schemas + inferred types for bay topology ingest, freight stage events, and floor-touch telemetry. Does not persist and does not own `store_locations`, rotations, or bay-service.
- **Transport** — `lib/enterprise-integration/ingest.ts` parses JSON with `.safeParse()` and returns a standardized 400 `{ success: false, error: "Bad Request", issues }`.
- **Stubs** — `POST /api/v1/topology/ingest` → `{ success: true, processed_bays: 1 }`. `POST /api/v1/freight/stage` → `{ success: true, queued_items }`. No UI or Store Ops write path.

## 2026-08-15 — URL stealth + HTTP-only auth gate

### Shipped
- **De-index** — `public/robots.txt` (`User-agent: *` / `Disallow: /`) plus global `X-Robots-Tag: noindex, nofollow, noarchive` in `next.config.ts` (`/` and `/:path*`) and root metadata `robots: noindex`.
- **Edge gate** — `proxy.ts` (Next 16 successor to `middleware.ts`; both files cannot coexist). Unauthenticated `/`, `/dashboard`, and other HTML routes redirect to `/login` before RSC. `/api/*` (except `/api/auth`, `/api/cron`, `/api/invite`) requires the hub cookie or `Authorization: Bearer`. Cron still uses `CRON_SECRET`.
- **HTTP-only session** — `POST /api/auth/gate` mints `deptsync_hub_gate` (HttpOnly, SameSite=Lax, 8h) after a live Supabase JWT. `startAuthSession` / logout sync it. `/login` (`AccessGate`) is the public AuthWall; `/access-gate` and `/auth` redirect there. SW shell cache is `deptsync-shell-v6-stealth` and no longer precaches `/`.

## 2026-08-15 — Tactical Voice Hub + bay freshness on Floor

### Shipped
- **Promoted Floor Pad** from Settings to the Floor dashboard. `TacticalVoiceFloorPad` is a high-access Walk & Talk dock (Master/DS) with listening pulse + bottom-sheet capture. Full TipTap `ExecutiveFloorPad` remains available from the sheet. `/manager-notes` and Settings `#manager-notes` redirect to `/dashboard#floor-pad`.
- **Voice-to-task Copilot** — Web Speech API with pause/stop parse and keyboard scratchpad fallback. `POST /api/copilot/parse-walk` + `lib/store-ops/ai-walk-parse.ts` extract structured tasks (location_tag, category, priority, window, assignee). Local heuristic when Gemini or the network is down.
- **Shift dispatch** — `lib/store-ops/shift-tasks.ts` owns walk tasks (`shift_walk_tasks` + localStorage). **Dispatch All to Shift Board** stamps freshness, syncs Supabase, and composes DOWNSTOCK into `downstock.ts`. Haptic: `hapticSuccess`.
- **Bay freshness** — `lib/heatmap/bay-tracker.ts` + `BayFreshnessGrid`. Fresh 0–2d (emerald) / Warm 3–4d (amber) / Stale 5+d (crimson). Composes `last_serviced_at` / `last_completed_at` plus walk/dispatch/checkoff/audit overlays. Does not own IRP velocity or bay-health diagnostics. Apply `20260815_shift_walk_tasks.sql`.

## 2026-08-15 — Store Ops instant-render SWR + map/briefing performance

### Shipped
- **Durable SWR** (`lib/store-ops/cache.ts`) — IndexedDB object stores for `store_locations`, `weekly_rotations`, and `shift_briefings`. Map/Floor peek cache first (<20ms), then background network; React state updates only when the fingerprint changes. `ttl-cache.ts` stays L1; `client.ts` write-through + `invalidateStoreOpsListCaches` clears both.
- **Shift briefing** — `ShiftBriefingCard` hydrates from IDB, memoizes `localShiftBriefingFromHealth`, yields before health fetch. Predictive Copilot defers compose to `requestIdleCallback`; decay scores run in `scoreLocationDecaysAsync` (yield every 40 bays).
- **Map DOM** — Visual Grid and Manage console chunk 16 aisles / 24 bays; Manage starts collapsed. Cadence maps + SVG aisle heat strips are memoized; Sell/Top uses a local overlay so toggling a face does not reload the map.
- **Indexes** — apply `20260815_performance_indexes.sql` (`idx_store_locations_dept_aisle`, `idx_bay_service_logs_bay_time`, `idx_rotations_active`) on canonical columns.

## 2026-08-15 — Theme, preferences, audio & haptics engine

### Shipped
- **Feedback** (`lib/ui/feedback.ts`) — Web Audio `playSuccessTone` / `playErrorTone` / `playTapTone` (no assets) and `hapticLight` / `hapticSuccess` / `hapticWarning`. Gated by `soundEnabled` / `hapticsEnabled`. `utils/haptics.ts` and `lib/scan-feedback.ts` compose this owner.
- **Prefs** — same `deptsync_theme_prefs` catalog (`lib/theme.ts`): Cyber-Dark, Midnight Sapphire, Industrial Emerald, Solar Daylight, plus high contrast, comfortable/compact density, sound, haptics. React mirror: `lib/ui/preferences-context.tsx`.
- **Drawer** — `UserPreferencesDrawer` for every role from header **🎨 Appearance & Preferences** and Settings. CSAs get handheld controls without store Settings. Test Tap / Success / Alert buttons.
- Wired on bay complete, packdown walk log, barcode hit/mismatch, tab taps (`HapticsListener`), Sunday draw / assign, force draw, and sync conflicts.

## 2026-08-15 — Role-based views + 3-tap developer sandbox

### Shipped
- **Hub view roles** — `lib/rbac.ts` maps platform roles to `MASTER_ADMIN` / `DEPARTMENT_SUPERVISOR` / `ASSOCIATE_CSA`. Associates get My Shift + Store Map only. DS keeps Floor/Map/Roster/Settings, department-scoped roster, shift schedules, and Map Manage (bay priorities). Master keeps full chrome and admin tools.
- **Associate Floor** — Shift Briefing + locked “mine” Zebra queue (packdown/downstock). Sunday staging, scan chips, Copilot, health, showroom, verify, and exception feed stay hidden.
- **Associate Map** — read-only Visual Grid locator. Manage Aisles & Bays and Snap Bay chrome are hidden. Walk-the-floor tap remains.
- **Developer sandbox** — Master Admin 3-taps the DeptSync logo within 800ms → `DevSandboxDrawer`. Preview As Role + Simulate Department overlays chrome via `sessionStorage` (`lib/dev-sandbox.ts`); JWT and roster credentials are unchanged. Amber banner: “⚡ Simulating: [Role] — Tap to Exit”.

## 2026-08-15 — Roster weekly schedule matrix

### Shipped
- **Collapsed departments** — Roster accordions start closed; tap to expand a home department.
- **Weekly calendar** — `AssociateScheduleModal` replaces the time-only sheet: associate + home dept + active week (Sun–Sat), cyan day toggles, Open/Mid/Close presets, per-day start/end. Saves `associate_shift_days` (`specialist_id`, `work_date`, `start_time`, `end_time`, `is_scheduled_today`) via `upsertShiftWeek`; localStorage fallback if the table is missing.
- **Card summary** — S M T W T F S dots (green scheduled / gray off), `Today: 07:00 - 15:30` or `Today: Off`, Edit Schedule.

## 2026-08-15 — Map Visual Grid walk-only

### Shipped
- **Map tab** — Removed Department Overview accordion (department cron toggles stay in Settings `DepartmentTargetsMatrix`).
- **Visual Grid** (`StoreLocationGrid`) — No aisle/bay checkboxes, batch delete, Add Bay, prune, or row Edit/Delete. Cadence dots, bay tags, Sell/Top, tap-to-walk remain. Empty map points to Manage.
- **Walk sheet** — Walk + Snap Bay + pin only. Aisle/bay/department/delete lives in `EditBayDrawer` on Manage.
- **Manage Aisles & Bays** — Owns multi-select, batch delete, duplicate prune, Add Bay, Bulk Generator, and full bay edit.

## 2026-08-15 — Velocity tier & priority seeding on Map tools

### Shipped
- **Bulk Generator** — Default Velocity Tier: Standard (14-day), High Velocity / Fast Mover (5-day), Priority Lock (always in Sunday draw). Writes `velocity_tier`, `priority_override`, and `custom_decay_days` via `velocitySeedFromPreset` (`lib/store-ops/velocity.ts`).
- **Edit bay drawer** — High-Velocity Hotspot, Lock Priority Override, and 3–21 day decay slider persist on `store_locations`. Manage list shows LOCK when `priority_override`.
- **Sunday draw** — `rotation.ts` pulls cadence-due bays (age ≥ custom/tier decay) into the velocity-priority pool. `adaptiveDrawWeight` multiplies by `decayDrawMultiplier`. Apply `20260815_custom_decay_days.sql`.

## 2026-08-15 — Call-out carry-over loop + Predictive Shift Copilot

### Shipped
- **Carry-over loop** — Call-out "Carry Over" (and auto fallback when no on-duty peers) stamps `sunday_bay_assignments` `CARRIED_OVER` / `is_carried_over` and `store_locations` `priority_override`, `carried_over`, `last_carried_over_at`. Sunday generate (`rotation.ts` `pickSundayCarryOverFirst` → `rotations.ts`) prepends `carried_over` OR `priority_override` OR status `CARRIED_OVER` before cadence decay, then clears `carried_over` on assign/complete. Amber Geist Mono **Carry-Over Priority** badge on Floor checklist + Sunday modal.
- **Predictive Copilot** — `lib/store-ops/predictive-copilot.ts` composes walk logs, Sunday assignments, downstock queue, and locations (hot weekday packdowns, 14-day adjacent decay, on-duty pace). `PredictiveCopilotBanner` sits under Shift Briefing with 1-tap Stage / Downstock (optimistic + toast). Does not call Gemini or invent bays.
- Apply `20260815_carry_over_priority.sql` (with `20260815_associate_shift_days.sql`).

## 2026-08-15 — Map aisle console + Roster shift / call-out

### Shipped
- **Map `[ Visual Grid | Manage Aisles & Bays ]`** — Visual Grid stays `StoreLocationGrid` (heatmap + `WalkTheFloorSheet`). Manage console is `AisleBayManager`: department-filtered aisle accordions, mapped-bay badge, Add Single Bay (`AddBaySheet`), Bulk Generator sheet, Select All / Delete Selected, Edit drawer (`EditBayDrawer`: aisle / bay / department / priority), per-bay delete toast. Locations still filter via header pin (`workingDepartmentId`).
- **Roster department groups** — associates accordion by primary `assigned_department` with roster count + on-duty today. Shift pill `07:00 - 15:30` + Edit Schedule (Supervisor/Master). Access chips remain on the card (`accessible_departments`).
- **Daily shift board** — `lib/store-ops/shift-status.ts` owns `start_time` / `end_time` / `is_scheduled_today` / `is_call_out` / `ABSENT_CALLOUT`. localStorage first; upserts `associate_shift_days` when the table exists; mirrors hours into `ShiftRosterMember` so Sunday balancer stays in sync.
- **Call-out rebalance** — `lib/store-ops/call-out.ts` composes `sunday-audit` + `planProportionalBayAssignments`. Dialog: Return to Department Pool · Auto-Redistribute to On-Duty Peers · Carry Over (`CARRIED_OVER`). Does not generate rotations.
- **RBAC** — `canManageShiftBoard` = Master or Supervisor. Team add/delete stays Master-only. Apply `20260815_associate_shift_days.sql`.

## 2026-08-15 — Geist typography + 4-tab chrome lock

### Shipped
- **Geist / Geist Mono** — `next/font/google` in `app/layout.tsx` (`--font-geist-sans`, `--font-geist-mono`). Tailwind `@theme` maps `--font-sans` / `--font-mono`. Body uses `font-sans`.
- **Identity mono** — `formatBayTag` (`A14-B06`, `BW-B12`) plus `font-mono tracking-tight tabular-nums` on bay tags, SKUs, cadence badges, and timestamps (Floor, Map, Exception feed, Sunday drawer, scan logs).
- **4-tab chrome** remains locked: Floor · Map · Roster · Settings. Hamburger / More / Admin Tools stay gone. Bulk Generator, Force Rotation, and Department Targets live in Settings accordions/modals.

## 2026-08-15 — Chrome consolidation: 4-tab-only DeptSync

### Shipped
- **Strict 4-tab bar** — Floor `/dashboard` · Map `/admin/store-map` · Roster `/roster` · Settings `/settings`. Hamburger drawer, More overflow sheet, and Admin Tools slide-over are gone. Header is title/store #, department pill, account/PIN chip only.
- **Settings owns former Admin Tools** — Bulk Generator, Taxonomies, Force Rotation, store number, Floor Pad, remnants, weekly targets, theme, push, and device/sync live in `SettingsSection` accordions/modals. Hash deep-links (`#bulk-generate`, `#weekly-rotation`, `#taxonomies`, `#manager-notes`, `#remnants`) still work, including keep-alive Settings.
- **Unified Floor** — one checklist header for every role: Sunday staging (non-associates), scan chips, health/rollup, showroom, in-place **Verify completed bays**, `ZebraChecklist` (Rotation/Downstock + Barrier chips), `ExceptionFeed`. `/verify-rotation`, `/admin/exceptions`, and `/department` redirect to `/dashboard`.
- **Unified Map bay sheet** — `WalkTheFloorSheet` is the only overlay: 2-second walk log + Snap Bay + Master Admin edit/pin. `BayActionsSheet` deleted. Bulk generate CTAs go to `/settings#bulk-generate`.
- **Roster** remains canonical team/PINs/chips. `/admin/supervisors` and `/admin/roles` still redirect here.
- **Dead chrome deleted** — `CatalogSection`, `ApplianceCatalogSection`, `CatalogItemCard`, `SuperAdminQuickActions`, `AdminRosterManager`, `AdminToolsDrawer`, `admin-tools-events.ts`, `StockTab`. `/stock` and `/manager-notes` redirect (Floor / Settings).
- **Toasts** — Sonner host in root layout (`lib/toast.ts`). PATCH `/api/store-locations` accepts `department_id` + `priority_override`.

## 2026-08-14 — Multi-department role & scope access

### Shipped
- **`accessible_departments`** on `store_specialists` (hub scopes) and `profiles` (store-ops codes). Session list is always primary `assigned_department` plus granted extras (`lib/department-access.ts`).
- **JWT / RLS** — `jwt_matches_department_code` also matches `app_metadata.accessible_departments`. Token hook + profile sync inject the array.
- **Roster chips** — Associate edit/invite drawers and Settings / `/admin/roles` toggle extra departments. Supervisors grant on associates via instant `POST /api/admin/department-access`.
- **Header switcher** — if `accessible_departments.length > 1`, the department pill becomes a dropdown. Pinning updates Floor / Map / Stock (no reload) and APIs reject department ids outside the granted set.

## 2026-08-14 — IRP velocity heatmap on store_locations

### Shipped
- **Canonical bay table** — IRP cadence lives on `store_locations` (`last_serviced_at`, `velocity_tier`, `priority_override`, denormalized `department_code`). Walk-the-floor writes `bay_service_logs.location_id` (no `bays` / `bay_tags` tables). Weekly `last_completed_at` is unchanged.
- **Store Map modes** — `[ Standard Map | Velocity Heatmap ]` on `StoreLocationGrid` (Map tab / `/admin/store-map`). Standard still uses `map-readiness.ts`. Heatmap colors by `classifyVelocityHeat`: cyan ≤7d, amber 8–18d, gray/orange >18d or null, pulse red/purple for `high` / `critical_hotspot`. Legend at the bottom of heatmap view.
- **2-second walk-the-floor** — tapping a bay opens `WalkTheFloorSheet` (`light_touch` / `heavy_packdown` / `critical_hole`). `POST /api/store-locations/service` inserts the log, stamps `last_serviced_at`, and promotes velocity when 2+ heavy/critical logs land in 30 days (`lib/store-ops/velocity.ts` + `bay-service.ts`).
- **Sunday draw** — `lib/store-ops/rotation.ts` `pickSundayVelocityPrioritized` runs after CARRIED_OVER so `velocity_tier IN ('high','critical_hotspot')` and `priority_override` fill the remaining weekly target first. `adaptiveDrawWeight` also multiplies those locations.

## 2026-08-14 — Instant Floor/Map/Stock/Settings tab shell

### Shipped
- **Keep-alive workflow shell** — `app/(workflow)/layout.tsx` + `WorkflowTabShell` keep Floor / Map / Stock / Settings mounted behind `hidden`. Tab switches no longer unmount SessionGate, NavigationHub, Zebra, or scroll position.
- **Stale-while-revalidate** — `createTtlCache.getSWR` (45s) on departments, weekly rotations, store locations, and roster so revisiting a tab paints cached data before the network.
- **Shared Realtime** — one `postgres_changes` channel per logical name; extra subscribers add JS listeners only. Rapid tab switches do not reconnect.
- **Code-split modals** — Snap Bay, Bulk Generate, Force Rotation, Sunday assign, Taxonomy, and Floor Pad stay out of the primary tab tree via `next/dynamic`.

## 2026-08-14 — Department seed respects UNIQUE(code) so D29 duplicate is not an error

### Shipped
- **`ensureDepartmentsForStore`** — upserts templates with `ignoreDuplicates: true`. Tries `onConflict: 'store_id,code'` then `'code'` to match live `departments_code_key`. Duplicate D29 is logged and ignored; GET still SELECTs existing rows.
- **List fallback** — if store-scoped queries are empty, unscoped `SELECT * FROM departments` hydrates the global unique-code catalog.
- **Store Map** — duplicate-key is not a red banner. Department Overview hydrates from the DB list; seed conflict retries the list after cache invalidate.

## 2026-08-14 — Admin Tools department load no longer red-banners

### Shipped
- **Exact error logging** — `[departments GET]`, `[ensureDepartmentsForStore]`, `[AdminTools] Could not load departments` log the caught error instead of swallowing it into a generic banner.
- **Hydration guard** — Admin Tools waits for a store number, retries on `STORE_CHANGED_EVENT`, and GET skips until `store_number` is present.
- **UUID-safe list** — `listDepartmentsForStore` queries `store_id` only when it is a UUID; otherwise (and on empty/invalid-uuid errors) it uses `store_number` like `2587`.
- **SELECT then INSERT seed** — `ensureDepartmentsForStore` no longer upserts on `(store_id, code)` (which 500s when live UNIQUE is still `code`). Seed failures are logged and do not fail GET.
- **Static fallback** — Admin Tools / targets matrix render `STORE_DEPARTMENT_TEMPLATES` when the query is empty or fails. Auth still shows the amber Hub PIN hint; the red “Could not load departments for admin tools” banner is gone.

## 2026-08-14 — Lucide department glyphs, Realtime subscribe order, Cabinets on Store Map

### Shipped
- **Department Lucide icons** — roster, department pickers, header pin, and Store Map overview use `DepartmentIcon` (Layers / Zap / Paintbrush / DoorClosed / Archive / Wrench / Trees / Droplets). Native `<option>` emoji removed; `DepartmentPicker` hosts SVGs. Role chips use HubIcon crown / shield / user.
- **Realtime lifecycle** — `lib/store-ops/realtime.ts` binds `postgres_changes` before `subscribe()`, uses unique channel instance names, and unsubscribes on unmount so Zebra + Sunday drawer + Fast Refresh no longer hit “cannot add callbacks after subscribe()”.
- **Cabinets on Store Map** — `ensureDepartmentsForStore` upserts on `(store_id, code)` so D29 is inserted for existing stores (weekly target 6). Department Overview lists Cabinets with toggle, target, and tag metrics.

## 2026-08-14 — Shift briefing, Cabinets D29, Specialist vs CSA roster

### Shipped
- **Local-first shift briefing** — `ShiftBriefingCard` loads a deterministic health brief (open bays, barriers, pace) from `GET /api/store-health` + `buildLocalShiftBriefing`. Gemini is only called on manual refresh / pull-to-refresh. Quota and GoogleGenerativeAI RPC errors fall back silently to the local brief; raw JSON is never shown. `/api/store-health/ai-summary` also returns the local brief when Gemini fails.
- **Sunday Cycle Audit Engine** — staging card opens the assignment drawer in-place (`requestSundayAuditDrawer`). `/flooring`, `/sunday-audit`, and `/sunday-rotation` redirect to `/dashboard` with the drawer instead of 404 / “page cannot be loaded”. Header Flooring pin no longer hops through `/flooring`.
- **Cabinets (D29)** — first-class hub department (`cabinets`) with store-ops code `D29`, taxonomy tree, Admin pin, department target seed (`20260814_cabinets_d29.sql`), and rotation template.
- **Retail roster titles** — specialty depts (Flooring, Appliances, Millwork, Cabinets) display **Specialist**; core depts display **CSA**. Lightweight `AssociateRosterPanel` on Settings, Admin Tools, and the Sunday drawer. Sunday Shift Balancer allocates 4h / 6h / 8h quotas to on-duty Specialists/CSAs.

## 2026-08-14 — Slice 1 Intelligence Architecture Hardening

### Shipped
- **Structured outputs** — `lib/ai/gemini.ts` is `server-only`. Callers pass `responseSchema` + `maxOutputTokens` via `jsonGenerationConfig`. Regex JSON extract remains a safety net. Budgets: briefing 256, Snap Bay 512, Floor Pad/insights 2048, Pre-Flight parse 2048. Schema types live in isomorphic `lib/ai/gemini-schema.ts` so client domain modules do not load the SDK.
- **Compact-then-narrate** — Flooring insights and appliance anomalies run local aging/variance/serial heuristics first, then send a findings packet (bound IDs/SKUs) to Gemini for narration. Merge overlays rationale/priority onto local rows; invented SKUs are dropped.
- **Auth + server fetch** — `/api/flooring/ai-insights` and `/api/appliances/ai-anomaly` require Store Ops JWT and load column-pruned remnants/audits/scans from the actor’s store. `/api/catalog/ai-taxonomy` requires supervisor/admin. Widgets send Bearer headers, not table dumps.
- **Legacy canvas synthesis retired** — `POST /api/store-ops/ai-note-summary` returns 410. Floor Pad `extractTasksAndTag` is the canonical Copilot. `NoteActionItem` moved to `lib/store-ops/manager-notes.ts`. Pre-Flight input capped at 24k chars.

## 2026-08-14 — P0 FTUX landing + brand unification

### Shipped
- **PWA mark** — `public/icons/` (192 / 512 / apple-touch) plus `mark.svg` are the cyan/gold floating layers+barcode, not the enclosed green shield. SW cache `deptsync-shell-v5-brand-floor`.
- **Boot splash** — `DeptSyncSplash` pins midnight `#090d16` and `DeptSyncBadge branded` so SSR/theme FOUC cannot flash emerald. AuthWall and invite use the same branded mark.
- **First land** — authenticated `/` without a specialty `?section=` replaces to `/dashboard`. Floor tab is only active on `/dashboard`. Scan tools stay at `/?section=audit|appliances|department` (More → Scan & Audit).
- **Associate Floor** — bay checklist is the first viewport. Sunday engine, shift briefing, and health widgets stay supervisor/Master.
- **Empty states** — associates see “No bays scheduled on your rotation — see your supervisor.” Stock empty queue explains Flag for Downstock + Go to Floor. Map empty is role-split (Map your first aisle vs ask supervisor).
- **Microcopy** — user-facing Zebra copy → Floor; role chip is Master Admin / Supervisor / Associate; Floor/Overhead instead of SELLING/TOPSTOCK; measurement pad lin ft / sq yd / sq ft.

## 2026-08-14 — Phase 2 DeptSync UX/UI consolidation

### Shipped
- **Roll Measurement Pad** (`components/inventory/RollMeasurementPad.tsx`) — Cycle Audit composes a single card: live CLF / SQYD in the header, whole-inch stepper, 1/8–7/8 keypad, +5/+10/+20 rounds. Carton mode uses the same pad shell. Form state stays in `CycleAuditScanForm`.
- **AI chips** — Remnant Intelligence is a collapsible trigger (`FlooringAIInsightBanner compact`); Snap Bay is a header chip. Measurement pad sits above the fold; Sunday staging and the shift log stay below.
- **Admin Tools grid** — menu is a 2-column categorized card grid: Floor Architecture · Rotations & Quotas · System & Security. Each card has a Lucide badge + subtitle. Drawer ownership unchanged.
- **Department targets matrix** (`DepartmentTargetsMatrix`) — compact table (dept / weekly quota / on-off). Auto-save on blur and toggle; one **Save All Targets** footer for dirty rows. Settings still imports `WeeklyBayTargetCard` (re-export).

## 2026-08-14 — Phase 1 DeptSync UX/UI consolidation

### Shipped
- **Splash** — `DeptSyncBadge` no longer sits in a hard dark tile. The shield/barcode mark floats on a soft `--glow-accent` radial. `DeptSyncSplash` + `app/loading.tsx` (and AuthWall / SessionGate / hub boot) use clean typography instead of a boxed logo.
- **Department pill** — Master Admin horizontal context tabs are gone. `AdminDepartmentSwitcher` is a compact header dropdown (D23 / D35 / All). Other roles get a read-only department chip. Owner remains `lib/admin-department-context.ts`.
- **Workflow bottom nav** (`lib/nav-hub.ts` + `BottomNav.tsx` + `HubHeader.tsx`) — one primary bar for every role: **Floor** (`/dashboard` + hub audits) · **Map** (`/admin/store-map`) · **Stock** (`/stock`) · **Settings** (`/settings`). Team / Alerts / Verify / Notes live in More. Inventory `BottomNavBar` no longer mounts on `/`.
- **Stock** (`app/stock/page.tsx`) composes Zebra `lockedQueue="downstock"` + `RemnantSection`. Hub `?section=remnants|settings` redirects to `/stock` / `/settings`.
- **Store Map rows** — Bay name + readiness on the left; compact Selling/Topstock dual-pill; Lucide MoreVertical menu (Edit / Trash). Super Admin mutates; supervisors/associates get a read heatmap (`canMutate`).

## 2026-08-14 — Theme engine & personalization

### Shipped
- **Theme catalog** (`lib/theme.ts`) owns five dark tactical presets, localStorage prefs, and `data-theme` / `data-contrast` / `data-density` apply. `ThemeProvider` (`lib/theme-context.tsx`) only mirrors live state. Blocking boot script in `app/layout.tsx` prevents FOUC.
- **Presets:** Midnight Tactical (default, ice-blue) · Emerald Ops · Amber Precision · Obsidian OLED · Cobalt Command. Glass chrome, primary glow, nav active, and bay pulse bind to CSS variables.
- **Settings Appearance** (`components/settings/ThemeSelector.tsx`) — live swatches, High Contrast (crisper borders), Compact Density (tighter rows). Instant, no reload.
- **Token integration** — NavigationHub / HubChrome / NavIcons / ZebraChecklist / StoreLocationGrid / HeaderNetworkStatus / DeptSyncBadge / core modals use `theme-accent-surface`, `theme-nav-active`, `theme-modal`, `text-accent`.

## 2026-08-14 — Layout, navigation, and vector iconography polish

### Shipped
- **Thumb-zone chrome** — sticky header uses `pt-safe` + `min-h-12`; Master Admin context strip dropped the redundant label row; ops/inventory bottom tabs stay `min-h-16` with `pb-safe`.
- **Above-the-fold density** — `.hub-main` (`px-3 pt-2 pb-28`) on Store Ops routes; dashboard / Store Map / health / briefing / Sunday staging cards dropped `p-4`/`mb-4`/`space-y-6` so bay rows, status pills, and pace timers sit higher on handhelds.
- **Unified Lucide catalog** (`components/hub/NavIcons.tsx`) — `HubIcon` + `NavIcon` share stroke 2. Replaced emoji/raster marks in `HeaderNetworkStatus`, `SundayAuditStagingCard`, Store Map (`StoreMapBody` + `StoreLocationGrid`), Zebra Quick Touch / downstock / barrier, HubHeader, Admin Tools close.
- **Touch targets** — `.chip-filter` and `.btn-quick-touch` are 44px minimum; Quick Touch / Pull / Barrier are icon-first with 44px hit boxes; department cron switch padded to 44px; Selling/Topstock toggle `min-h-11`.

## 2026-08-14 — Downstock queue, Store Map heatmap, supervisor weekly rollup

### Shipped
- **Downstock queue** (`lib/store-ops/downstock.ts`) — Zebra bay chip **Flag for Downstock** (optional pallet/SKU note). **Downstock Queue** tab isolates overhead pulls; assign to a CSA via existing Sunday assignment. Persists to `downstock_queue` (migration `20260814_downstock_queue.sql`) with localStorage fallback.
- **Store Map heatmap** (`lib/store-ops/map-readiness.ts` + `StoreLocationGrid`) — green verified this ISO week, yellow scheduled rotation, red stale >7d or barrier. Quick Touch / complete emits `BAY_READINESS_EVENT` so the map turns green immediately.
- **Supervisor weekly rollup** (`lib/store-ops/audit-summary.ts` + `SupervisorAuditSummaryModal`) — quota vs completed, associate/shift breakdown (Sunday assignees, not guessed tappers), resolved vs open barriers. One-tap copy. Dashboard + Department Overview.

## 2026-08-14 — Store Map bay edit, delete, and odd/even-only generate

### Shipped
- **Bay pattern** is Odd Only / Even Only only (`lib/store-ops/bay-pattern.ts`). Default Odd Only. Legacy CSV `sequential` maps to odd.
- **Store Map** (`StoreLocationGrid`): per-bay Edit (aisle, bay, SELLING/TOPSTOCK, status, zone, audit frequency) and Delete with inline confirm. Multi-select + **Delete Selected (N) Bays**. Duplicate prune now hard-deletes.
- **Bulk Generator Clean-Up** tab: prune an entire aisle or an odd/even bay range (SELLING / TOPSTOCK / both).
- **API:** `PATCH /api/store-locations` Super Admin can update aisle, bay, type, status. `DELETE` hard-deletes by `?id=`, `{ id }`, or `{ ids: string[] }` (cascades `weekly_rotations`).

## 2026-08-14 — Shift workload balancer + clustered bay assignment

### Shipped
- **Shift balancer** in Sunday assignment (`SundayAuditAssignmentModal`): toggle CSAs, 4/6/8h or start–end times. Hours persist per store/week in localStorage.
- **Proportional clustered plan** (`lib/store-ops/weekly-rotations.ts`) — largest-remainder quotas by hours; aisle/face clusters stay together; stale >7d / unworked top-stock clusters feed the longest shifts. Persistence stays in `sunday-audit.ts` (`applySundayAssignmentPlan`). Rotation draw stays in `rotations.ts`.
- **Zebra** assignment badges show name + shift tag; filter All / Mine / associate. Checklist header shows **Ahead / On Track / Behind** weekly pace (`forecastWeeklyPace` in `week.ts`).
- **Store Map prune** — `findDuplicateLegacyBays` groups same dept+aisle+bay+type (numeric aisle padding collapsed). Super Admin deletes extra tags via `DELETE /api/store-locations` (cascades weekly rotations). See later **bay edit/delete** entry for hard-delete + per-bay actions.

## 2026-08-14 — Smart Floor Insights & Operational Velocity

### Shipped
- **Quick Touch** on Zebra assigned bays (`ZebraChecklist`) — one-tap facing/readiness complete via existing `completeRotation`; optimistic overlay + timestamp on the completed list. Does not open an itemized count.
- **Shift briefing** composes `bay-health.ts` into Gemini/local context (`stale >7d`, unworked top-stock, barrier flags, hotspot aisle/bay). Prompt + local fallback are 3 bullets: Focus Bay, Pending Barriers, Quick-win. `GET /api/store-health` attaches compact `bay_health`; `POST /api/store-health/ai-summary` enriches if the client snapshot omitted it.
- **Remnant rack aging** — floor-ops bands Fresh <14d / Watch 14–30d / Critical >30d (`classifyRackAging` in `lib/aging.ts`, composed by `remnantRackAlert` in `lib/remnants.ts`). Critical available rolls without a markdown get a Suggest markdown chip. Institutional 30/60/90 markdown aging is unchanged.
- **Header network chip** — `HeaderNetworkStatus` owns `useNetworkBadge` so pending-queue ticks do not re-render NavigationHub / Admin Tools / child forms. Badge `setState` skips identical online/pending values.

## 2026-08-14 — Admin Tools React #306 (undefined lazy component)

### Root cause
- `dynamic(() => import(...).then((mod) => ({ default: mod.AdminToolsDrawer })))` passed `undefined` into React.lazy when the client chunk exposed the drawer on `mod.default` (interop), not `mod.AdminToolsDrawer`. Minified React error #306.

### Shipped
- Drawer keeps `export default` + named `export { AdminToolsDrawer }`.
- NavigationHub loads with `dynamic(() => import("@/components/hub/AdminToolsDrawer"), { ssr: false })`.
- Floor Pad nested lazy uses named `mod.ManagerNotesWorkspace`; shim also has a default export.

## 2026-08-14 — Admin Tools chunk isolation + Bay Health diagnostics

### Root cause (Admin Tools "couldn't load")
- `next/dynamic` imported the drawer as a whole module while `AdminToolsDrawer` **statically imported** Executive Floor Pad / TipTap. Evaluating that graph on first open could reject the lazy chunk; React.lazy then bubbled to the Next.js page error ("This page couldn't load") because nothing caught it.
- Closing the drawer unmounted the dynamic component (`adminOpen` only), so the next open remounted and re-fetched the chunk.
- The loading shell ignored `error` / `retry` from `next/dynamic`.

### Shipped
- Named-export loader `{ default: mod.AdminToolsDrawer }`, `adminHosted` keep-alive, `ChunkErrorBoundary` + loading-shell retry with `console.error`.
- Floor Pad/TipTap is a nested `dynamic()` and mounts only when notes open.
- Service worker cache bumped to `deptsync-shell-v4-admin-tools`.
- **Bay health:** `lib/store-ops/bay-health.ts` flags >7d stale / never completed, un-inventoried TOPSTOCK, and SIMS/variance mismatches. Zebra shows a compact scorecard badge.

## 2026-08-14 — Phase 3: Bay-Readiness Velocity & Floor Workflow

### Shipped
- **ZebraChecklist** (`components/store-ops/ZebraChecklist.tsx`) owns the floor checklist: optimistic complete (no loading flash), haptic + next-bay `bay-advance-pulse`, SELLING/TOPSTOCK filter, Sunday assignment queue, one-tap Barrier chips.
- Dashboard silent-refreshes rotations on complete and on `SUNDAY_AUDIT_EVENT`; Zebra subscribes to Sunday Realtime (cache invalidate on change) so specialist assignments appear without a page refresh.
- **Audit mode:** `lib/store-ops/audit-location-mode.ts` + `AuditLocationModeToggle` — Cycle / Department forms label SELLING (lower floor) vs TOPSTOCK (overheads). Logs, discrepancy filters, and audit reports carry the mode; the toggle is not reset after each log.
- **Verify All Completed Bays** on `/verify-rotation` stamps the week without completing remaining open bays. `/admin/exceptions` batch-verifies pending depts with 0 open. Barrier chips: Blocked Bay, Unpalletized Top-Stock, Missing SIMS Tags.
- Mid-week barriers: `POST /api/rotations/exceptions` + `reportRotationBarriers` (CARRIED_OVER, does **not** stamp `last_verified_week`). End-of-week verify composes the same insert then stamps.

## 2026-08-14 — Admin Tools open + odd/even bulk bays

### Shipped
- Admin Tools chrome clicks set `adminOpen` immediately (`requestAdminTools`), then dispatch the event. Drawer uses `next/dynamic` default export + `{ ssr: false }` and a loading shell so the first open actually renders.
- Bulk Generator **Bay pattern**: Odd Only / Even Only (default odd). `expandBayNumbers` steps by 2 (`lib/store-ops/bay-pattern.ts`). CSV optional `bay_pattern` column; legacy sequential maps to odd.
- Store Map GET retries without `last_completed_at` on 42703/PGRST204 and always returns `last_completed_at: null` when the value or column is absent.

## 2026-08-14 — Admin Tools drawer open path

### Shipped
- `openAdminTools()` keeps a pending payload and `subscribeAdminTools()` replays it so a click before NavigationHub's listener attaches still opens the drawer.
- Hamburger / More / account / Settings / hash deep-links all dispatch `openAdminTools`.
- `AdminToolsDrawer` stays dynamically imported (`ssr: false`, named export as `{ default }`) with an immediate loading shell. After the first open it stays hosted (`adminHosted`) so later opens do not remount the lazy chunk.

## 2026-08-14 — Phase 2 UI streamlining (tab latency, draft debounce, form isolation)

### Shipped
- Cycle / Appliance audit drafts write to localStorage on a **300ms debounce** (`scheduleAuditDraftSave` / `scheduleApplianceScanDraftSave`). Immediate flush on submit, tab hide, unmount, and when the hub section is hidden (keep-alive).
- Scan/input state lives in `CycleAuditScanForm` and `ApplianceScanForm`. Historical logs stay in the parent sections so keystrokes do not reconcile the shift tables.
- `GET /api/weekly-rotations` and departments remain 45s TTL + in-flight dedupe (`lib/store-ops/client.ts`). Sunday assignments use the same TTL cache (`lib/store-ops/sunday-audit.ts`); writes invalidate. Staging card no longer double-fetches on assignment events.
- Hub `/?section=` switches use `React.startTransition` and keep visited sections mounted (`hidden` + `aria-hidden`) so Cycle Audit / Sunday staging do not remount. Wedge scanners disable when a pane is hidden. Bottom padding is stable (`pb-44`) to avoid layout shift.

## 2026-08-14 — P0 index SQL: `store_number` vs `store_id`

### Shipped
- `20260813_p0_query_indexes.sql` no longer assumes `store_number` on every table (live 42703).
- Hub `carpet_audits` / `carpet_remnants`: `ADD COLUMN IF NOT EXISTS store_number` then composite index (these tables have no `store_id`).
- Store Map / rotations: index `store_id` (and `store_number` only if JWT RLS added it).
- Floor Pad: Phase 2 index on `(store_number, is_archived, department, created_at)`; legacy fallback `(store_id, is_archived, department_code, created_at)`. Missing columns skip with NOTICE.

## 2026-08-14 — P1 Gemini latency, Snap Bay payload, Store Map columns

### Shipped
- Snap Bay camera targets **1280×720**; live/upload snapshots are a single-pass JPEG (quality 0.70, max edge 960px). `scanBayVisual` strips data-URL prefixes so Gemini receives raw base64. Route rejects images over ~1.5MB chars.
- Gemini Flash uses `responseMimeType: application/json` and `maxOutputTokens: 1024` (`GEMINI_JSON_GENERATION_CONFIG` in `lib/ai/gemini.ts`) so bay-scan JSON is not truncated.
- Floor Pad Copilot sends `editor.getText()` / stripped HTML, capped at 8,000 characters. Prompt is schema-only (no example JSON blobs). TipTap HTML is unchanged for persist/checkboxes.
- `GET /api/store-locations` selects Store Map columns only (no `SELECT *`).

## 2026-08-13 — P0 mobile boot path (roster-only + code-split + bounded queries)

### Shipped
- Hub boot (`app/page.tsx`) fetches **roster only** before AuthWall. Catalog / remnants / appliance catalog load after unlock when the relevant section mounts.
- `next/dynamic` for AuthWall, NavigationHub, and the five hub sections.
- `AdminToolsDrawer` loads only when `adminOpen` (event bus extracted to `admin-tools-events.ts` so TipTap is not on the chrome chunk).
- Cycle Audit mounts Visual Bay Scan, Audit Report, and SIMS Finder on demand.
- `fetchAudits` bounded to today + `.limit(200)`. Appliance scans GET `.limit(200)`.
- `fetchSpecialists` column list — no `pin_code` / `temp_pin_hash`; Hub-bridge remains PIN source of truth.
- Migration `20260813_p0_query_indexes.sql` — composite indexes for audits, remnants, locations, rotations, manager notes. Hub tables (`carpet_audits` / `carpet_remnants`) key on **`store_number`** (added if missing — original CREATE omitted it). Store Ops (`store_locations` / `weekly_rotations`) key on **`store_id`**. Floor Pad uses **`store_number` + `department`** (Phase 2) or **`store_id` + `department_code`** (legacy). Script skips any index whose columns are absent.

## 2026-08-12 — Master Admin PIN reset via service-role API

### Shipped
- `POST /api/auth/reset-pin` + `lib/store-ops/reset-pin.ts` — Super Admin Bearer or `current_pin` auth; service-role writes `store_specialists.pin_code` and **UPSERTs** `store_profiles` (creates Master Admin row when missing).
- `updateSpecialistPin` / Change PIN modal now call the API (no more update-only `store_profiles` miss).
- Best-effort sync of linked `profiles.pin_code` + Auth password for Hub bridge continuity.

## 2026-08-12 — Enable RLS on flagged public tables

### Shipped
- Migration `supabase/migrations/enable_rls_flagged_tables.sql` — `ENABLE ROW LEVEL SECURITY` on `appliance_catalog`, `appliance_scans`, `store_specialists` (gap from appliance migration / schema-only roster RLS).
- Loop enables RLS on any remaining `public` base tables, then asserts none lack `relrowsecurity`.
- Keeps permissive anon/authenticated policies on the flagged hub tables so floor PWA access is not locked out.

## 2026-08-12 — Immersive Snap Bay AI Audit camera

### Shipped
- `VisualBayScannerModal` rebuilt as full-screen (`100dvh`) immersive overlay — live `<video>` is `object-cover` edge-to-edge (Carb Buddy–style).
- Top glass header (title + Aisle/Bay) and bottom camera-app control cluster (shutter / Open Live Camera + Upload Photo); close ✕ top-right.
- WebRTC cascade: `facingMode: { exact: "environment" }` → `facingMode: "environment"` → `video: true`; `playsInline` + `muted` + `autoPlay` with post-mount attach.
- Pulsing red connecting indicator while the rear camera initializes.

## 2026-08-12 — Master Admin bootstrap + Hub-bridge resilience

### Shipped
- `POST /api/auth/bootstrap-admin` (Bearer `CRON_SECRET` / `BOOTSTRAP_SECRET`) + `lib/store-ops/bootstrap-admin.ts` + `scripts/bootstrap-admin.mjs`.
- Seeds/resets Master Admin roster (`master_admin` / PIN `1234` or `HUB_MASTER_PIN`), links `auth.users` + `profiles` (`super_admin`), clears orphan profile rows.
- Hub-bridge now looks up by `specialist_id` / name aliases; **master PIN auto-provisions** Super Admin so login never dead-ends.
- Executed local bootstrap against live project: store `2587`, username `master_admin`, Auth smoke test passed.

## 2026-08-12 — Hub PIN → Auth bridge (Master Admin unlock)

### Shipped
- `POST /api/auth/hub-bridge` + `lib/store-ops/hub-bridge.ts` — service-role verifies roster PIN, ensures Auth user + `profiles` link, mints Supabase session (no phone OTP).
- Client `hub-bridge-client.ts` + AuthWall login/setup/unlock call `setSession` after PIN verify.
- Cold restore without Auth JWT forces PIN unlock wall so Store Ops (Admin Tools, map, briefing, invites) unlock with Hub PIN alone.
- Biometric paths require an existing Auth session (otherwise PIN once).
- Soft-fail banners retargeted to Hub PIN unlock copy; phone OTP remains optional recovery.

## 2026-08-12 — Soft-fail Store Map / Bulk Admin auth

### Shipped
- `GET /api/departments` + `GET /api/store-locations` warm `createSupabaseServerClient` and return empty lists + `auth_required` instead of hard 401 UI blockers.
- Bulk generate keeps 401 for writes but returns a structured Auth hint; Bulk + Admin Tools show OTP refresh copy.
- Store Map amber banner with Retry; env helpers also accept `SUPABASE_URL` / `SUPABASE_ANON_KEY` aliases.
- Verified `.env.local`: `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` are set.

## 2026-08-12 — Soft-fail Shift Intelligence Briefing auth

### Shipped
- `POST /api/store-health/ai-summary` warms `createSupabaseServerClient` (cookie session) and returns a 200 session-refresh briefing when Auth is missing instead of hard 401.
- `fetchShiftBriefing` client mirrors the soft fallback; `ShiftBriefingCard` shows an amber OTP refresh prompt.

## 2026-08-12 — Floor Pad voice dictation + follow_up_date

### Shipped
- Mic / Stop & Parse control on Floor Pad toolbar (Web Speech API) with pulsing rec indicator.
- Stop appends transcript to TipTap then auto-runs `extractTasksAndTag` (aisle/bay, tasks, metadata).
- Metadata now includes `follow_up_date` (ISO) from Gemini + local weekday / “in N days” heuristics.

## 2026-08-12 — Floor Pad Gemini metadata extract

### Shipped
- Gemini Copilot prompt/schema now returns structured `metadata`: appliance_serials, carpet_remnants, operational_hotspots, vendor_mentions (`lib/store-ops/ai-note-extract.ts`).
- Migration `20260812_manager_notes_metadata.sql` — `manager_notes.metadata` JSONB + GIN index.
- `ManagerNote.metadata?: Record<string, any>` persisted on save/upsert; Floor Pad stamps metadata from Copilot into autosave.

## 2026-08-12 — Fix manager_notes RLS (Floor Pad upserts)

### Shipped
- Patch migration `20260812_fix_manager_notes_rls.sql` — authenticated SELECT/INSERT/UPDATE/DELETE with `USING/WITH CHECK (true)`; drops JWT store/dept policy that blocked inserts.
- `saveManagerNote` always stamps `author_id` from `supabase.auth.getUser()` (throws if no Auth session); DB trigger backfills `author_id` from `auth.uid()` when omitted.
- Aligned `20260812_manager_notes.sql` + JWT RLS manager_notes block to the same permissive policies.

## 2026-08-12 — Floor Pad layout densify + expanded font suite

### Shipped
- Collapsed Dept/Aisle/Bay into one horizontal pill bar under the Floor Pad title; title + formatting + Gemini merged into a single sticky toolbar row.
- TipTap `.ProseMirror` canvas targets ≥80dvh writing height; chrome/footer compacted.
- Dynamic Google Fonts load on pad open (15 faces: Inter/Montserrat/Poppins/Open Sans, Merriweather/Playfair/Lora/Cormorant, Roboto Mono/Fira Code/JetBrains Mono, Caveat/Kalam/Dancing Script/Shadows Into Light).
- Custom font picker renders each option in its own typeface.

## 2026-08-12 — Executive Floor Pad (rich-text Manager Notes)

### Shipped
- Replaced S Pen canvas workspace with full-screen **Executive Floor Pad** under `components/manager-notes/` (TipTap rich text).
- Typography toolbar: Inter / Roboto Mono / Merriweather / Caveat, sizes, bold, bullets, checkable task lists.
- Compact auto-filling Dept / Aisle / Bay header pills.
- Gemini Copilot Server Action `extractTasksAndTag` (`app/actions/manager-notes.ts`) — appends task checkboxes + fills missing aisle/bay; domain in `lib/store-ops/ai-note-extract.ts`.
- Migration `20260812_manager_notes_archive.sql` — `is_archived` for durable archive without cluttering active shift list.
- Debounced autosave (~700ms) on keystroke via Supabase upsert; Archive action on selected notes.
- Compatibility shim: `components/store-ops/ManagerNotesWorkspace.tsx` re-exports Floor Pad.

## 2026-08-12 — Phase 3: Offline Resilience & Conflict Resolution

### Shipped
- `components/offline/ConflictResolutionModal.tsx` — side-by-side Local vs Server conflict UI (Keep Local / Accept Server).
- `lib/sync-conflict.ts` — conflict events + SyncConflictError; flush pauses for supervisor choice.
- `lib/sync-queue.ts` — transaction UUIDs, optimistic timestamps, exponential backoff retries, version/409 conflict detection, `installSyncAutoFlush` on `online` + `visibilitychange` + `focus`.
- Orphan sweep: removed unused `DefaultPinNotice`, `FirstLoginCredentialsModal`, and PIN “Remind Later” helpers (AuthWall owns setup).

## 2026-08-12 — Phase 1: Security & Identity Handshake

### Shipped
- Removed emergency unlock (`MASTER-2026-TEMP`, `lib/emergency-access.ts`, `POST /api/auth/emergency-unlock`) from AuthWall and the API surface.
- Store Ops actor resolution is Supabase Auth only: `getRequestAuthUser` → `profiles` (`id = auth.users.id`); `x-store-ops-*` headers are no longer trusted (`parseStoreOpsActor` always null).
- Client APIs send `Authorization: Bearer` via `storeOpsAuthHeadersAsync` / `getSupabaseAccessToken` (same localStorage session as phone OTP).
- Push subscribe maps `user_id` to Auth profile id; `specialist_id` cleared on upsert.
- Phone reset confirm links Auth user → `profiles` + JWT `app_metadata` (`linkAuthUserToSpecialistProfile`).
- Migration `supabase/migrations/20260812_jwt_rls_policies.sql`: defensive JWT/RLS (table existence checks, `store_number` isolation), Custom Access Token Hook, `sync_profile_app_metadata`.
- **Applied in Supabase:** Phase 1 SQL + Custom Access Token Hook enabled.

## 2026-08-12 — Phase 2: Data Durability & UI Cleanup

### Shipped
- Migration `supabase/migrations/20260812_manager_notes.sql` — durable `manager_notes` with `store_number`, `department`, `author_id`, `category`, `updated_at`; JWT store/dept RLS; preserves S Pen / AI columns from 20260811.
- `lib/store-ops/manager-notes.ts` — Supabase list/upsert/delete + realtime subscribe; optimistic UI in `ManagerNotesWorkspace`.
- Migration `supabase/migrations/20260812_sunday_bay_assignments.sql` — `sunday_bay_assignments` unique per store/dept/week/bay; JWT RLS; `roster_specialist_id` bridge to hub roster.
- `lib/store-ops/sunday-audit.ts` — server sync via Supabase (ISO week → `week_starting` Monday); staging card + assignment modal optimistic writes + realtime.
- Retired orphan `components/barcode/MarryBarcodeModal.tsx` (superseded by Quick-Add / scan link flow).

### Ops follow-up
- Apply both Phase 2 migrations (after Phase 1 JWT helpers). Enable Realtime on `manager_notes` and `sunday_bay_assignments` if not auto-enabled.

## 2026-08-11 — Native mobile: splash theme, haptics, offline banner

### Shipped
- PWA splash/theme aligned to `#090d16` (`public/manifest.json`, `app/manifest.ts`, layout `themeColor`, CSS void, TWA colors).
- `utils/haptics.ts` + root `HapticsListener` — short `navigator.vibrate` pulse on buttons, switches, and nav tabs.
- `OfflineNetworkBanner` floating toast when offline; auto `flushSyncQueue` on reconnect with synced confirmation.

## 2026-08-11 — Mobile UI polish: SVG bottom nav, header, action buttons

### Shipped
- Lucide React icons via `components/hub/NavIcons.tsx`; replaced emoji bottom-nav / drawer glyphs.
- Navigation Hub bottom bar capped at 4–5 tabs; Notes/Settings overflow into a More sheet (`lib/nav-hub` `overflow` flag).
- Header consolidates Online / queued / role into one status chip; department context pills stay single-row `overflow-x-auto no-scrollbar`.
- Safe-area utility `.pb-safe`; shared button tokens (`.btn-primary-glow` h-12, `.btn-grid-action-*`, `.btn-icon-touch`).
- Roster action grid + primary Add Supervisor CTA normalized to touch targets and glass accents.

## 2026-08-11 — Manager Notes & S Pen Canvas (Gemini synthesis)

### Shipped
- Migration `supabase/migrations/20260811_manager_notes.sql` — `manager_notes` table (UUID `store_id` FK to `stores`, dept/aisle/bay context, canvas PNG data-URL, `ai_summary`, `action_items` jsonb).
- Domain `lib/store-ops/ai-note-summary.ts` — prompt, normalize, local heuristic fallback; `lib/store-ops/manager-notes.ts` — offline localStorage note list aligned to schema.
- `POST /api/store-ops/ai-note-summary` — Store Ops actor auth; accepts title/content + optional S Pen PNG; Gemini Flash multimodal → 2-sentence executive summary, action items (`task` / `priority` / `assignee_role`), referenced SKUs/aisles/bay exceptions; graceful local fallback without key.
- Client `synthesizeManagerNote` + glass `ManagerNotesWorkspace` (stylus pressure strokes, undo/clear/colors, ✨ Synthesize Action Items → glowing checkbox cards).
- Entry points: Admin Tools → **Manager Notes & S Pen**, `/manager-notes` hub route (Master + Supervisor nav), hash `#manager-notes`.

## 2026-08-11 — AI Visual Bay Scan (Gemini multimodal)

### Shipped
- Domain module `lib/store-ops/ai-bay-scan.ts` — prompt, normalize, local fallback for carton/pallet estimates + cleanliness score + severity-ranked issues.
- `POST /api/store-ops/ai-bay-scan` — Store Ops actor auth; accepts base64 / data-URL bay photo + optional aisle/bay/department_code; Gemini Flash multimodal; graceful local fallback when `GEMINI_API_KEY` missing.
- Client `scanBayVisual` + `VisualBayScannerModal` (live camera / Zebra upload, scan beam animation, obsidian results drawer with severity pills + quick actions).
- Mounted **📷 Snap Bay AI Audit** on Store Map header, bay actions sheet (`StoreLocationGrid`), and Flooring Cycle Audit.

## 2026-08-11 — Sunday Flooring Cycle Audit staging + Master Admin dept context

### Shipped
- Master Admin **My Department Context** pin (`lib/admin-department-context.ts` + `AdminDepartmentSwitcher` in NavigationHub) — Full Store / D23 Flooring / D35 Appliances / Plumbing; privileges unchanged.
- `SundayAuditAssignmentModal` + glowing `SundayAuditStagingCard` — pending Flooring weekly bays, specialist assignment dropdowns, **Auto-Assign All to Me (Flooring DS)**, Stage/Draw 12 bays (composes existing generate API).
- Surfaced on `/dashboard` (Pending Cycle Audits), Cycle Audit tab header, Admin Tools → **Sunday Rotation Engine**, and `/flooring` deep link → `/?section=audit` with D23 pin.
- Person assignments persist locally per store/week (`lib/store-ops/sunday-audit.ts`); bay engine ownership stays in rotations/cron.

## 2026-08-11 — Store Audit Velocity & Health Telemetry Chart

### Shipped
- `lib/store-ops/telemetry.ts` — hourly shift velocity (06:00–22:00), linear target baseline to 100%, exception-spike flags; Overall / D23 Flooring / D35 Appliances series.
- `GET /api/store-health` snapshot now includes `telemetry` (composed from `weekly_rotations.completed_at` + `rotation_exceptions`).
- `StoreHealthChart` glass SVG (Dexcom-style neon curve + dashed target + amber/rose spikes) mounted on `/dashboard` under Shift Briefing.
- `POST /api/store-health/ai-summary` + shift-briefing prompt fold `audit_velocity` into Gemini / local 3-bullet briefing; client passes telemetry from health fetch.

## 2026-08-11 — Obsidian-glass pass: AuthWall, Store Map, modals

### Shipped
- Extended glass tokens in `app/globals.css`: stronger `glass-input` emerald rings, `.glass-backdrop`, `.glass-void`, `.glass-label`, bay status helpers (`.glass-bay-complete` / pending / cyan).
- `AuthWall` floats a `.glass-card` over `.glass-void` with emerald glow; PIN pads / WebAuthn / emergency + phone-reset CTAs use `min-h-[44px]` + emerald focus / `btn-primary-glow`.
- Store Map header + department overview + `StoreLocationGrid` / bay action sheet glassified; S/T cells use high-contrast emerald / amber / cyan status glows.
- Remaining overlay modals (PIN, credentials, Quick-Add, Marry, Confirm, Audit Report, Sims finder, Force Rotation, etc.) use `bg-black/60 backdrop-blur-md` backdrops + `.glass-card` bodies; shared `NumberField`/`TextField` focus rings match glass tokens.
- Auth session mechanics and Supabase calls unchanged (presentation-only).

## 2026-08-11 — Department Catalog Taxonomies + AI Taxonomy Generator

### Shipped
- Central registry `lib/catalog/taxonomies.ts` maps Lowe's catalog codes (D21 Lumber → D52 Tools) to default category / sub-category trees; hub departments resolve via `taxonomyCodeForHubDepartment`; AI overrides persist in `localStorage` (`deptsync_catalog_taxonomies`).
- Domain AI module `lib/catalog/ai-taxonomy.ts` + `POST /api/catalog/ai-taxonomy` — Gemini Flash generates department taxonomies; graceful registry fallback when `GEMINI_API_KEY` missing.
- `TaxonomyManagerModal` (glass-card) in Admin Tools → **Catalog Taxonomies** with ✨ Generate / Refresh AI Taxonomy.
- `TaxonomyDrillDown` accordion on `DepartmentAuditSection` + `/department` overview; selected sub-category stamps audit `sub_category` and filters today's logs.

## 2026-08-11 — Appliance Scan Anomaly Detection

### Shipped
- `POST /api/appliances/ai-anomaly` — Gemini Flash anomaly detection over `appliance_scans` + `appliance_catalog`; local heuristics fallback when key missing (duplicate serials / distant locations / category mismatch / unscanned high-value models).
- Domain module `lib/appliances/ai-anomaly.ts`; widget `ApplianceAnomalyWidget` mounted in `ApplianceAuditSection` with emerald/amber/rose status glow and Zebra `min-h-[44px]` actions.

## 2026-08-11 — Zebra Shift Intelligence Briefing

### Shipped
- `POST /api/store-health/ai-summary` — builds briefing from `buildStoreHealthSnapshot` (pace, bottlenecks, exceptions); Gemini 3-bullet executive brief; local metrics fallback without API key.
- Domain module `lib/store-ops/shift-briefing.ts` + client `fetchShiftBriefing`.
- `ShiftBriefingCard` glass banner atop `/dashboard` with emerald glow, priority department, tap refresh + pull-to-refresh.

## 2026-08-11 — Flooring AI Remnant Aging & Variance Intelligence

### Shipped
- `POST /api/flooring/ai-insights` — Gemini Flash analyzes cycle audit variance + remnant inventory against 30/60/90+ age bands; local aging fallback when `GEMINI_API_KEY` missing.
- Domain module `lib/flooring/ai-insights.ts` composes `lib/aging` + `lib/variance`; markdown math stays in `lib/markdown`.
- `agingBand()` added to `lib/aging.ts` (0-29 / 30-59 / 60-89 / 90+).
- `FlooringAIInsightBanner` glass card on Flooring Cycle Audit + Remnants with one-touch **Apply Recommended Markdown** → `computeMarkdown` + `saveRemnant`.

## 2026-08-11 — AI Pre-Flight for Bulk Location Generator

### Shipped
- `POST /api/store-locations/ai-parse` — Super Admin only; Gemini parses messy aisle/bay text or CSV into structured locations + `corrections_made`.
- Shared normalizer `lib/store-ops/ai-parse.ts` enforces `isValidAisle` / bay swap / department code allow-list after model output.
- Client helper `aiParseLocations`; Bulk Generator gains **✨ AI Pre-Flight** tab with glass preview table and **Confirm & Bulk Create** → existing `/api/store-locations/bulk` (`bulkGenerateLocations` → `bulkInsertLocations`).
- Requires `GEMINI_API_KEY` (503 when missing).

## 2026-08-11 — Gemini AI integration layer

### Shipped
- Added `@google/generative-ai` dependency.
- Server-only helper `lib/ai/gemini.ts`: `callGeminiFlash`, `callGeminiFlashJson`, `extractGeminiJsonText` / `parseGeminiJson`, `isGeminiConfigured`.
- Env: `GEMINI_API_KEY`, `GEMINI_MODEL` (default `gemini-3.5-flash`) in `.env.local` (gitignored).
- Owns transport + JSON extraction only; product prompts / API routes compose on top.

## 2026-08-11 — Obsidian-glass design system (glassification)

### Shipped
- Global tokens shifted to obsidian void (`#09090b` / zinc-950) with emerald + cyan glow accents in `app/globals.css`.
- Utility classes: `.glass-card`, `.glass-panel`, `.glass-input`, `.btn-primary-glow`, `.glass-focus`, typography helpers, status pills.
- Applied to `NavigationHub` / `HubChrome` headers + drawers + bottom nav (backdrop-blur glass panels).
- `BulkLocationGenerator` form + CSV dropzone glassified with emerald focus rings and cyan batch CTA.
- Flooring / Appliances / Dept Audit section cards use `.glass-card` + emerald/cyan mode pills; variance accents updated in `lib/variance.ts`.
- AuthWall / PIN / credentials, Store Map + location grid, and remaining overlay modals use `.glass-void` / `.glass-backdrop` / `.glass-card` with Zebra `min-h-[44px]` targets (2026-08-11 pass).
- No changes to sync queue, Supabase clients, or audit state logic.

## 2026-08-11 — Emergency unlock: update-only (no username insert clash)

### Fixed
- `POST /api/auth/emergency-unlock` never `.insert()`s; finds existing `store_specialists` by username (`master_admin`) / name / MasterAdmin role and `.update()`s unlock flags only.
- Preserves existing username to avoid `store_specialist_username_key`; on miss or update failure still returns a local Master Admin specialist so `MASTER-2026-TEMP` authenticates immediately.

## 2026-08-11 — Emergency admin bypass + phone OTP recovery

### Shipped
- Temporary master code `MASTER-2026-TEMP` on AuthWall login/unlock → `POST /api/auth/emergency-unlock` sets `store_specialists` to Master Admin (`is_active`, clears invite/temp credential flags) and starts `deptsync_auth_session` in localStorage.
- Profile setup requires verified mobile (`phone_number`); login offers **Forgot Access Code? Reset via Phone** using `supabase.auth.signInWithOtp` + verify → `/api/auth/phone-reset/confirm`.
- Supabase browser client persists Auth sessions in localStorage (`persistSession` / `autoRefreshToken`); roster wall session already restored without re-auth until logout or 8h idle.

## 2026-08-11 — Roster: no hardcoded seeds + DB-driven temp credentials

### Fixed
- Removed auto-injection of Master Admin / Flooring Supervisor / Amber seed profiles (`ensureRosterSeeds`); roster renders `store_specialists` from Supabase (+ offline-only real profiles).
- Legacy `seed-*` local rows are purged on fetch; **Delete User** removes unwanted profiles without revival.
- "Temporary Credentials Active" badge uses only `must_change_credentials` / `must_change_pin` flags.

## 2026-08-11 — Settings connection test + operational cache UI

### Fixed / Shipped
- Test Connection probes `appliance_scans` head count; shows **Connected (Database Live)** (green) or **Offline / Unreachable** (red).
- Local storage panel lists Appliance Audit Cache · Remnant Inventory Cache · Pending Queue only (catalog cache removed) with one-tap **Clear Local Cache**.

## 2026-08-11 — Offline sync queue counter reset

### Fixed
- `flushSyncQueue` drops successful actions and rewrites localStorage; when a store has zero remaining items it re-notifies UI subscribers.
- Header badge + Settings/Admin pending counts use reactive `usePendingSyncCount` / `useNetworkBadge` listeners on `carpet-sync-queue-changed` so the toast and `0 queued` update together.

## 2026-08-11 — Remove Catalog bottom-nav tab

### Shipped
- Catalog removed from Master Admin bottom nav; 4-up grid: Flooring · Appliances · Remnants · Master.
- `/catalog` redirects to `/appliances` → `/?section=appliances`. Catalog section UI no longer mounted in the hub.

## 2026-08-11 — Appliance scan log category accordion + pagination

### Shipped
- Scan log groups by main category (collapsed by default) with sub-category sections and unit totals (`🍳 Cooking / Ranges — 42 units`).
- Search / filter auto-expands only matching category accordions and hides non-matches.
- Expanded groups paginate SKU cards at 10 per page (`Prev` / `Next`).

## 2026-08-11 — Appliance scan log filter layout polish

### Fixed
- Removed sticky/absolute filter bar that overlapped scan cards; static `flex flex-col gap-3` header with full-width search + horizontally scrollable pills (`no-scrollbar`).
- Active pill uses `border-emerald-500 bg-emerald-950/40 text-emerald-400`; All shows `Showing All · N SKUs`.

## 2026-08-11 — Alphanumeric aisle codes (BW / RW / 12 / A1)

### Shipped
- `store_locations.aisle` is TEXT (migration `20260811_alphanumeric_aisle.sql`); values normalized `.trim().toUpperCase()`.
- Bulk Generator aisle input is `type="text"` with live auto-caps (`bw 01` → `BW 01`).
- Batch CSV parser (`lib/store-ops/aisle.ts` → `parseLocationBatchCsv`) accepts alphanumeric aisle strings — no `parseInt` / numeric-only validation on aisle.
- Types + bulk API treat aisle as `string`; Store Map aisle groups sort with natural alphanumeric compare.

## 2026-08-11 — Appliance scan log aggregation + editor + export

### Shipped
- Scan log UI groups by `item_number` with bold **Qty** on each card; expand for per-unit timestamps, serials, locations.
- Sticky filter bar: category pills (All · Ranges/Cooktops · Wall Ovens · Refrigeration · …) + quick search (SKU / location).
- In-line **Edit** modal: increment/decrement quantity, edit/append serials, bulk location/bay update for the SKU group (`PATCH` + create/delete under the hood).
- CSV export now ships **SUMMARY** (`Item Number`, `Description`, `Category`, `Total Count Scanned`, `Locations Found`) plus **RAW DETAIL** audit trail columns.

## 2026-08-10 — Appliance Scanner continuous hands-free mode

### Shipped
- Barcode detect → immediate `POST /api/appliances/scans` (no "Log & Reset" / Submit gate).
- Known `appliance_catalog` hits: success chime + haptic, session counter ++, clear for next scan (location sticky).
- Unrecognized / missing sub_category: pause on Quick-Add modal → save catalog → auto-log scan → continue.
- Sticky floating **Session Total: N items scanned** counter at top of Appliance Scanner.

## 2026-08-10 — Appliance scan save: no silent offline success

### Fixed
- `saveApplianceScan` POSTs to `/api/appliances/scans` when online and **throws** on failure (removed catch→offline success path).
- API insert uses explicit logging + thrown errors; schema body: `item_number`, `serial_number`, `location`, `category`, `sub_category`, `scanned_by`.
- Scanner UI shows red toast `Failed to save scan: …` and re-fetches the scan list after a successful write.

## 2026-08-10 — Dedicated appliance_catalog + appliance_scans

### Shipped
- New tables `public.appliance_catalog` (`item_number`, `upc`, `description`, `category`, `sub_category`) and `public.appliance_scans` (`item_number`, `serial_number`, `location`, `category`, `sub_category`, `scanned_by`, `scanned_at`) with store scoping + migration backfill from legacy carpet_* appliance rows.
- Types `ApplianceCatalogItem` / `ApplianceScan`; client libs `lib/appliance-catalog.ts` / `lib/appliance-scans.ts`; sync queue actions; API routes `GET|POST|DELETE /api/appliances/catalog` and `/api/appliances/scans` (CSV via `?format=csv`).
- Top-level suites: Laundry · Refrigeration · Cooking / Ranges · Dishwashers · Microwaves / Venting; required sub chips on UPC link (`QuickAddApplianceModal`).
- Appliance Scanner + Appliance Catalog sections own the new tables; CSV columns: Category, Sub-Category, Item #, Serial #, Location.

## 2026-08-10 — Appliance suite categories + sub_category linking

### Shipped
- Top-level appliance suites: Laundry · Refrigeration · Cooking · Dishwashers · Microwaves (Washer/Dryer collapsed into Laundry).
- Required sub-category chips on Quick-Add UPC→SKU link and Appliance audit / catalog forms (`ApplianceCategoryFields`).
- `sub_category` on `carpet_catalog` / `carpet_audits` (migration `20260810_appliance_sub_category.sql`); CSV + audit report include Sub-category.
- Legacy flat labels remapped on read + in migration (Washer→Laundry/Washer, Refrigerator→Refrigeration, etc.).

## 2026-08-10 — Store Map bay rows mobile UX

### Shipped
- Removed inline ★ Week / Show micro-buttons from S/T rows.
- Assigned-week status shown as a non-clickable amber dot on the Bay label.
- S/T switches use ≥44×44 touch targets.
- Tap Bay label → bottom sheet: Pin to Current Week, View Audit Log/History, Edit Location Details.

---

## 2026-08-10 — Dept toggles, adaptive priority, showroom zones

### Shipped
- Migration `20260810_dept_priority_showroom.sql`: departments default `is_active=false` except Flooring; `manual_priority_count`; `location_type` (`STANDARD`|`SHOWROOM_STACKOUT`) + `audit_frequency_days` (orthogonal to Selling/Topstock `type`).
- Sunday cron already filters `departments.is_active`; Super Admin master toggles on Store Map Overview + Settings Department Overview.
- Adaptive draw weights `(1 + manual_priority_count) × age_days` via `last_completed_at`; ★ Week on Store Map bumps priority and assigns to current week.
- Showroom Quick Touch card on Zebra dashboard — rapid cycle independent of weekly aisle rotation.

---

## 2026-08-10 — Associate floor permissions & nav

### Shipped
- Store Ops actor role `associate`: read dept weekly rotations / locations, complete bays, verify + create `rotation_exceptions`; denied targets PATCH, location admin PATCH, invite, generate/reset, Admin Tools / `/admin/*`.
- Associate ops nav only: My Department Checklist, Barriers / Log, Specialty Tools, My Profile / PIN (in-page specialty switcher on `/`).

---

## 2026-08-10 — Auto-generated invite PIN on Add Supervisor

### Shipped
- Add Supervisor modal no longer accepts a typed default password (`ChangeMe123` removed from admin issue path).
- Read-only **🎲 Auto-Generated 6-Digit PIN** badge; submit calls `/api/admin/invite-supervisor` and opens the invite/SMS preview with the returned `temporary_pin`.
- Reset credentials also re-issues via invite (random PIN + preview). Invite API preserves `MasterAdmin` role.

---

## 2026-08-10 — Admin Invite Testing Harness

### Shipped
- Roster **Test Invite Flow** generates `test_mode` invite (`/invite?token=…&test=1`), opens harness modal with 6-digit PIN, welcome SMS preview, **Copy Invite Link**, **Copy Full SMS Text**.
- SMS copy: `Welcome to DeptSync! Access your department portal here: [Link]. Your temporary PIN is: [PIN].`
- `/invite` with `test=1`: console logs `Token Validated`, `PIN Reset Success`, `Biometric Prompt Fired`; complete is dry-run (token + temp PIN preserved for repeat rehearsals).

---

## 2026-08-10 — Supervisor Invite & Onboarding Engine

### Shipped
- Migration `20260810_supervisor_invite.sql`: `invite_token`, `invite_token_expires_at`, `must_change_pin`, `temp_pin_hash`, `phone_number` on `store_specialists`.
- `POST /api/admin/invite-supervisor` — Super Admin issues 6-digit temp PIN (hashed) + UUID token; Twilio SMS when configured, else copyable `sms:` preview.
- Public `GET/POST /api/invite/[token]` — preview, verify temp PIN, complete permanent PIN (clears invite fields).
- `/invite?token=` onboarding: temp PIN → Create New PIN → Add to Home Screen (`beforeinstallprompt`) → WebAuthn Face ID / Fingerprint → Zebra dashboard.
- Roster **Invite** action + invite preview card (PIN / URL / SMS copy).

---

## 2026-08-10 — Mobile floor UX Waves A–C

### Wave A — Admin Tools drawer + DS lockdown
- `AdminToolsDrawer`: slide-over (defaults closed) for Bulk Generate, Force Rotation, all-dept targets, store #, diagnostics, supervisor link.
- Wired via NavigationHub **Admin** chip + hamburger + `openAdminTools()` / hash deep-links.
- Removed permanent Quick Actions from `/dashboard`; Store Map bulk accordion moved into drawer.
- Settings: Supervisors see PIN, own bay target, push, collapsed Device & sync. Master setup not permanent page chrome.

### Wave B — Density
- Compact single-line rotation rows; completed lists default collapsed.
- Store Map bay rows: inline S/T toggles on one line.
- Exceptions: Pending / Verified / Barriers / All tabs.
- Verify: collapsed completed + sticky Confirm/Submit bar.

### Wave C — Progressive disclosure
- `/department` = overview links only (no embedded auditor).
- Catalog/Remnant add-edit → bottom sheets; dense rows + overflow menus.
- Auditors: collapsible summaries; flooring “More details” + collapsed filters; denser shift log; Show All (5) on department Today.

---

## 2026-08-10 — Store Health Scorecard

### Shipped
- `lib/store-ops/health.ts` + `GET /api/store-health`: week rotations by dept (assigned/completed) + exception bottlenecks.
- `components/StoreHealthCard.tsx`: DS pace bar + barriers; Super Admin storewide grid + Bottleneck Summary (Freight/Staffing/Traffic).
- Embedded at top of `/dashboard` (first card after login for rotation roles).

---

## 2026-08-10 — Per-department weekly_bay_target settings

### Shipped
- Settings card lists every department with editable `weekly_bay_target` (Master Admin) or own dept (Supervisor); null/0 → 10.
- Draw engine already selects `departments.weekly_bay_target` in `generateWeeklyRotations` when choosing PENDING → ASSIGNED count.

---

## 2026-08-10 — Nested location grid + weekly_bay_target draw

### Shipped
- Store Location Grid: dept accordion → aisle accordion → bay row with Selling|Topstock toggles (depts collapsed by default).
- `generateWeeklyRotations` reads `departments.weekly_bay_target` per dept (null/0 → 10); cron uses the same path.

---

## 2026-08-10 — Store Map overview + force-draw modal

### Shipped
- Primary Store Map: department overview + location grid; Bulk Generator in accordion **Map Management & Bulk Add**.
- Weekly controls moved into **Trigger Weekly Rotation** modal; CTA **Force Draw New Rotation**; shows Automated Cron / current ISO week status.

---

## 2026-08-10 — Bulk Generator BOTH Selling + Topstock

### Shipped
- Location type radios: BOTH (default) / SELLING / TOPSTOCK — BOTH inserts two rows per bay.
- Upsert `onConflict: department_id,aisle,bay,type`; migration `20260810_store_locations_type_unique.sql`.
- Weekly Rotation Engine subtitle clarifies scheduled automation vs manual override panel.

---

## 2026-08-10 — Bulk Generator clean error messages

### Shipped
- Bulk location generate catch uses `err?.message || 'Failed to generate locations'` (no nested readableError rewrap).
- `storeOpsFetch` / `bulkInsertLocations` / `readableError` skip re-humanizing already-built Error messages.

---

## 2026-08-10 — Zebra rotations empty-week soft fail

### Shipped
- `/api/weekly-rotations` selects safe columns; ignores null `assigned_week`; returns `[]` on schema/empty failures (no red schema toast).
- Dashboard / `fetchThisWeekRotations` try/catch renders empty checklist when zero bays are assigned.

---

## 2026-08-09 — Exception summary empty-week defaults

### Shipped
- `weekly_rotations` summary select: `id, department_id, cycle_number, is_completed, completed_at` (falls back if `cycle_number` absent).
- Exception Log / `fetchExceptionSummary` try/catch defaults to empty summary + `[]` exceptions (UI shows 0/0 verified, 0 rows).

---

## 2026-08-09 — Exception log store_locations select harden

### Shipped
- `listRotationExceptions` joins `store_locations(id, aisle, bay)` only — no optional `type`/`status` columns.
- Empty week / missing log returns `[]` instead of crashing the Exception Log page.

---

## 2026-08-09 — Departments upsert onConflict = code

### Shipped
- Store Map / store resolve seeds via `ensureDepartmentsForStore` now upsert with `onConflict: 'code'` to match the live UNIQUE constraint (fixes constraint mismatch).

---

## 2026-08-09 — Dynamic store_number (no hardcoded defaults)

### Shipped
- `lib/store.ts`: no fallback to `1234` / `1852`; blank when unset; `setStoreNumber` may clear.
- Settings: free-edit draft + explicit **Save Store Number** (no blur/debounce auto-commit / lockout).
- Session / biometric / active specialist: mismatch only when both sides have a store number.
- Store-ops auth/resolve: require a real store number — never invent `#1234`.

---

## 2026-08-09 — Single-session auth UX

### Shipped
- Valid localStorage session → Hub `ready` with no PIN unlock on cold start / navigation.
- Removed action-level PIN gates (profile switch, manager markdown, discrepancy filter).
- Store number change no longer forces re-login; session store_number updates in place.
- SessionGate only admits/denies on session presence — never prompts credentials.

---

## 2026-08-09 — Upsert constraint audit + readable errors

### Shipped
- Audited all Supabase `.upsert()` calls against live unique keys.
- Store-ops: `stores` → `store_number`; `departments` → `code`; `store_locations` → `department_id,aisle,bay`; `weekly_rotations` → `location_id,assigned_week`.
- Inventory: catalog `store_number,sku`; specialists `store_number,name`; remnants/audits `id`; push `endpoint`.
- `lib/store-ops/errors.ts` humanizes PostgREST/constraint errors for Settings, Bulk Generator, Store Map, and API JSON responses.

---

## 2026-08-09 — Multi-store store_id + bulk upsert fix

### Shipped
- Migration `20260809_multi_store.sql`: `stores` registry; `store_id` on `departments`, `store_locations`, `weekly_rotations`; department code unique per store; location unique `(department_id, aisle, bay)`.
- Bulk generator upsert: `onConflict: 'department_id,aisle,bay'` with `status: PENDING`, `is_active: true`.
- APIs resolve hub `store_number` → `stores.id` via `x-store-ops-store-number`; filter/associate by active store (user-entered; no hardcoded default).
- Cron iterates active stores, then each store’s active departments safely.

### Ownership
| Concern | Owner |
|---|---|
| Store registry resolve | `lib/store-ops/stores.ts` |
| Hub store_number session | `lib/store.ts` |
| Bulk map upsert | `lib/store-ops/locations.ts` |

---

## 2026-08-09 — Supervisor verification & exception logging

### Shipped
- Migration `20260809_rotation_verification.sql`: `rotation_exceptions`, `CARRIED_OVER` status, `last_verified_week` on departments.
- `/verify-rotation` — Confirm All Completed or Report Incomplete Bays (reasons → exceptions + CARRIED_OVER).
- Next-week picks prioritize `CARRIED_OVER` before `PENDING`.
- `/admin/exceptions` — Super Admin weekly verification status + bottleneck log.
- Nav Hub links for Verify (supervisors) and Exceptions (admin).

---

## 2026-08-09 — Cron route bypass in Next.js Proxy

### Shipped
- Added root `proxy.ts` (Next 16 successor to middleware): immediate `NextResponse.next()` for `/api/cron/*` so Vercel Cron reaches JSON handlers with `CRON_SECRET` (no session cookie).
- Note: this repo had no prior middleware; HTML login responses on cron are often **Vercel Deployment Protection** — also set Protection Bypass / ensure Cron is allowed in project settings.

---

## 2026-08-09 — Automated weekly rotation cron + bay targets

### Shipped
- Migration `20260809_weekly_rotation_cron.sql`: `departments.weekly_bay_target` (default 10), `is_active`; Paint D24P, Inside/Outside Garden D28I/D28O, Millwork D30, Tools D25; Flooring / Home Decor merged.
- `GET /api/cron/weekly-rotation` — `CRON_SECRET` Bearer auth; queues each active dept up to its target (cycle reset when all COMPLETED).
- `vercel.json` cron: `59 23 * * 0` (Sunday 23:59 UTC).
- Settings → Weekly bay target card (`PATCH /api/departments`).

---

## 2026-08-09 — Fix Supabase service-role client + placeholder env detection

### Shipped
- `lib/supabase/admin.ts` — `createAdminClient()` requires real `SUPABASE_SERVICE_ROLE_KEY` (no anon fallback).
- `lib/supabase/env.ts` — rejects placeholder URL/keys so fake `.env.local` values fail loudly.
- API 503s return actionable missing-env messages; Store Map hint updated.

---

## 2026-08-09 — Web Push for weekly rotation alerts

### Shipped
- Migration `supabase/migrations/20260809_push_notifications.sql` — `push_subscriptions` + RLS (`auth.uid() = user_id`); hub bridge columns `specialist_id` / `department_code`.
- `lib/push/*` — VAPID config, browser subscribe helpers, `usePushNotifications` hook, server dispatch via `web-push`.
- APIs: `GET /api/push/vapid-public-key`, `POST|DELETE /api/push/subscribe`, `POST /api/push/dispatch`; rotation generate fans out pushes on success.
- Service worker `push` + `notificationclick` → opens `/dashboard`.
- Settings → **Phone rotation alerts** enable/disable card.

---

## 2026-08-09 — Navigation Hub (role-aware Zebra chrome)

### Shipped
- `lib/nav-hub.ts` — Super Admin vs Supervisor route menus + compact role badges (`[SUPER ADMIN]`, `[FLR DEPT]`).
- `components/hub/NavigationHub.tsx` — high-contrast hamburger drawer, user menu (role badge + login username), ops bottom nav.
- Routes: `/admin/supervisors`, `/settings`, `/department`; Store Map + Dashboard wrapped in Nav Hub + SessionGate.
- `SuperAdminQuickActions` on Store Map & Dashboard (Bulk Generate · Trigger Rotation · Manage Supervisors).
- Inventory `/` uses NavigationHub header; BottomNavBar still owns audit/catalog section tabs.

---

## 2026-08-09 — Store Operations: multi-dept map, RBAC, weekly rotations

### Shipped
- Migration `supabase/migrations/20260809_store_operations_rbac.sql`: enums (`user_role`, `location_type`, `rotation_status`), tables (`departments`, `profiles`, `store_locations`, `weekly_rotations`), RLS (super_admin full CRUD; department_supervisor read/update on assigned dept).
- Domain: `lib/store-ops/*` — rotation engine (PENDING pick → ASSIGNED; cycle bump when all COMPLETED; cool-down until reset), bulk bay generator, hub MasterAdmin/Supervisor → store-ops actor bridge.
- APIs: `POST /api/rotations/generate`, `POST /api/rotations/complete`, `GET /api/weekly-rotations`, departments + store-locations (+ bulk) routes (service role).
- UI: `/admin/store-map` Super Admin bulk generator + location grid + weekly generate; `/dashboard` Zebra supervisor checklist with optimistic complete.
- Settings → Store Operations links; `.env.example` adds `SUPABASE_SERVICE_ROLE_KEY`.

---

## 2026-07-30 — Biometric login + password manager autocomplete

### Shipped
- Login/setup/unlock forms: `method="post"`, `name` + `autocomplete` (`username` / `current-password`) for native OS keychain save prompts.
- `lib/biometric-auth.ts` — WebAuthn platform authenticator register/get; credential id stored in `deptsync_biometric_credential`.
- AuthWall: post-login “Enable Fingerprint / Touch ID” banner; returning “👆 Login with Fingerprint / Touch ID” when a passkey exists.

---

## 2026-07-30 — Login field cleanup + password eye toggle

### Shipped
- AuthWall login/setup/unlock: removed all username/password placeholder hints (empty fields on load).
- `TextField` `passwordToggle` — inline eye / eye-off SVG (no icon package) reveals or obscures password with aria-label + 44px touch target.

---

## 2026-07-30 — Soft-delete specialist roster (fix revive-after-delete)

### Shipped
- Root cause: `ensureRosterSeeds` re-inserted Amber / Flooring / Master after hard `removeLocal`.
- Added `store_specialists.is_active` (default true); delete now soft-deactivates locally + in Supabase, then best-effort hard DELETE.
- Inactive tombstones stay in localStorage so seeds are not revived; `fetchSpecialists` returns active-only.
- Admin roster: optimistic card removal, green toast `User [Name] has been removed from the roster.`, error toast on DB failure.
- Sync queue `delete_specialist` soft-deletes first; RLS policy note for update/delete.

---

## 2026-07-30 — Zero-Access Authentication Wall

### Shipped
- Non-dismissible `AuthWall` (`components/auth/AuthWall.tsx`) — full-screen blur gate; no Remind Later, ✕, or backdrop bypass.
- Workspace chrome/tabs/data hidden until login, credential setup, or quick unlock succeeds.
- Login: username + password/PIN against store roster (Amber temp → forced permanent credential setup).
- `lib/auth-session.ts` — sessionToken + lastActiveTimestamp in localStorage; 8-hour inactivity lock; header 🔒 logout.
- Returning session prompts quick 4-digit PIN (or password) unlock; Master Admin unlocks full-store tabs.

---

## 2026-07-30 — Soft keyboard + global hardware scanner

### Shipped
- Removed programmatic `.focus()` on tab/section mount (Flooring, Appliances, Department) so iOS/Android soft keyboards no longer open on every bottom-nav tap.
- `lib/hardware-scanner.ts` — window-level wedge listener (6+ chars, ≤150ms gaps) routes scans into the active section’s SKU lookup without focusing an input.
- Tap-to-type only: `selectOnFocus` highlights existing text; post-log / Quick-Add cancel uses `blurActiveInput()` to dismiss the keyboard.
- `app/page.tsx` blurs on section switch; Quick-Add no longer autoFocuses Item #.

---

## 2026-07-30 — DeptSync branding metadata alignment

### Shipped
- Locked PWA/layout/header copy to **DeptSync Hub** (no remaining Carpet/Flooring Hub titles).
- Manifest: name `DeptSync — Department & SIMS Audit Hub`, short_name `DeptSync`.
- Layout: title `DeptSync Hub · Department & SIMS Audit`, description inventory suite for Lowe's, appleWebApp title `DeptSync`.
- Header chrome: brand `DeptSync Hub`, subtitle `DeptSync · Lowe's #[store]`.

---

## 2026-07-30 — Audit Report Exporter & Printable Email Engine

### Shipped
- `lib/audit-report.ts` — report composition (metrics, sort by SIMS bay, email body, Markdown clipboard, mailto / Web Share).
- `components/hub/AuditReportModal.tsx` — formal printable inventory report with Print / Save PDF, Send via Email, Copy Formatted Summary.
- Export / Print Report action on Flooring (Cycle) shift summary, Appliances shift card, and generic Department shift cards.
- Print CSS in `globals.css` (`@media print`) strips chrome/nav/actions and renders high-contrast letter-size B&W tables.

---

## 2026-07-30 — Master Admin Team & Department Roster Manager

### Shipped
- Expanded `DepartmentScope` to full Lowe's store list (flooring → hardware + `all`) with `DEPARTMENT_META` icons/labels.
- Master Admin–only **👥 Team & Department Roster Manager** (`AdminRosterManager`): roster cards, reset credentials, edit scope, delete access.
- **+ Add Department Supervisor / Specialist** modal: role, department, auto username, temp password `ChangeMe123`, require first-login reset; shareable issued-credentials card.
- Helpers: `resetSpecialistCredentials`, `updateSpecialistScope`, `deleteSpecialist` (+ `delete_specialist` sync queue).
- Dynamic tabs: generic departments (plumbing, electrical, …) open `DepartmentAuditSection` + department catalog + profile; appliances/flooring/Master Admin unchanged.

---

## 2026-07-30 — DeptSync rebrand + department-scoped RBAC

### Shipped
- Rebranded to **DeptSync Hub** (manifest short_name `DeptSync`, layout meta, header eyebrow `DeptSync · Lowe's #… · Inventory & SIMS Audit`).
- New multi-department scanner/shield badge (`DeptSyncBadge`) + refreshed PWA icons (emerald boxes + amber barcode).
- Role schema: `MasterAdmin` | `Supervisor` | `Associate` with `assigned_department`, `username`, `must_change_credentials` on `store_specialists` (local + Supabase schema).
- `lib/rbac.ts` owns section visibility; Hub bottom nav filters tabs (Master Admin = all 5; Appliances Supervisor = Appliances / Catalog / Profile).
- First-login non-dismissible credential modal for supervisors on default credentials (`amber_appliance` / `ChangeMe123`).
- Catalog domain filter for department supervisors; store number change restricted to Master Admin.

---

## 2026-07-27 — Catalog category folder browse

### Shipped
- Catalog default view is category folder cards (icon, SKU count, SIMS bay preview); appliances roll up under 🔌 Appliances.
- Drill-down with ← Categories back badge + “+ Add [Category] Item”; search/scan bypasses folders and lists matches across all categories.
- 📂 / 📋 toggle next to search switches Folders vs flat master list; item cards extracted to `CatalogItemCard`.

---

## 2026-07-27 — Appliances Inventory & SIMS Audit workspace

### Shipped
- New hub tab **🔌 Appliances** (`HubSection: appliances`) in bottom nav + `HUB_SECTIONS`.
- `ApplianceAuditSection`: scan-to-catalog, appliance categories, SIMS staging chips, unit stepper, sticky Log Appliance & Reset (reuses `carpet_audits` / `carpet_catalog`).
- `APPLIANCE_CATEGORIES` + `CatalogCategory` union; Quick-Add `domain="appliances"`; Catalog / SIMS Finder search by appliance category & staging tags.

---

## 2026-07-27 — Handheld focus, 12/15 ft rolls, undo + live area

### Shipped
- `lib/focus-input.ts` — `focusAndSelect` (rAF + 100ms) restores SKU soft keyboard after modal close, reset, log, and drawer dismiss.
- Roll width presets: **12 ft / 15 ft** (default 12); legacy 6 ft remapped via `normalizeRollWidthFt`. Catalog edit saves `roll_width_ft` to Supabase.
- Log Roll & Reset / Quick-Add cancel fully clear SKU + measure fields (no sticky zeros); undo toast (6s) deletes last audit in one tap.
- Live roll badge: CLF | SQFT | SQYD from CLF × width; success double-beep + Quick-Add soft-pop via Web Audio.

---

## 2026-07-26 — Remove redundant header hamburger / NavDrawer

### Shipped
- Section switching is bottom-nav only; removed hamburger button, `NavDrawer`, and `menuOpen` state from header / page shell.
- Header now: Flooring Hub · store · network (left) + specialist badge · PIN gear (right).

---

## 2026-07-26 — Handheld layout pass (bottom nav + scan-first audit)

### Shipped
- Fixed PWA bottom nav (Audit / Catalog / Remnants / Settings) with emerald active glow; hamburger drawer retained as fallback.
- Cycle Audit: collapsible 1-line shift summary (default collapsed); sticky Log & Reset bar above bottom nav; in-form 📍 SIMS Stock opens SimsLocationFinder without leaving Audit.
- Replaced `window.prompt` / `window.confirm` with `TextPromptModal` (barcode link, remnant reserve) and `ConfirmModal` (remnant delete).
- Main column `pb-32` / audit `pb-44`; body `overflow-x: hidden`; touch targets stay at `h-12`.

---

## 2026-07-26 — APP_LAYOUT_MAP blueprint

### Shipped
- Added root `APP_LAYOUT_MAP.md`: shell/header, four workspace views, modal inventory, scan-path UX friction analysis for layout evaluation.

---

## 2026-07-26 — Dual scan trigger + auto-focus SKU

### Shipped
- SKU / barcode field auto-focuses on audit mount and after form reset.
- Enter on SKU always `preventDefault` + `handleSkuLookup` (fixed prior blur-without-lookup bug).
- Rapid digit burst (≥8 digits, ≤150ms gaps) auto-looks up after 250ms quiet — works when scanner omits Enter.
- Unmatched scans open ⚡ Quick-Add with barcode pre-filled.

---

## 2026-07-26 — Sheet Vinyl as Mode A roll goods

### Shipped
- Added `Sheet Vinyl` to `FLOORING_CATEGORIES`; `isRollGoodsCategory` treats Carpet + Sheet Vinyl as Mode A.
- 6ft / 12ft roll-width pickers on Audit, Quick-Add, Catalog, and Remnant forms.
- Remnant Rack form now includes Category dropdown (catalog auto-fill).

---

## 2026-07-26 — Universal Flooring & SIMS Audit Hub

### Shipped
- Multi-category schema/types: `category`, `sims_location` / `default_sims_location`, `box_count`, `calculated_sqft`, `sqft_per_box` on `carpet_*` tables (flooring_audits alias).
- Scan-to-Catalog: match auto-fills + chime + focus measure/count; unlinked UPC opens ⚡ Quick-Add modal → writes `carpet_catalog` and continues audit.
- Dual audit engine: Mode A Carpet CLF; Mode B carton/unit sq ft (`cartons × sqft_per_box`).
- SIMS Location Finder drawer in Catalog (`lib/sims.ts` aggregates audits + catalog defaults).
- Mid-scan draft (`carpet_hub_audit_draft`) + existing offline sync queue for dead zones.
- Hub copy / PWA manifest → Flooring Hub — SIMS Audit.

### Ownership
| Concern | Owner |
|---|---|
| Categories / audit mode | `lib/types.ts` |
| Carton math | `lib/calc.ts` |
| Quick-Add | `QuickAddCatalogModal` |
| SIMS locations | `lib/sims.ts`, `SimsLocationFinder` |
| Audit draft | `lib/storage.ts` |

---

## 2026-07-25 — Never query Supabase with fallback profile IDs

### Shipped
- PIN save resolves Supervisor by name/role when `id` is not a UUID; inserts without `id` when missing; only `.eq('id', …)` with real UUIDs (avoids 22P02).
- Load sync prefers DB Supervisor UUID + `pin_code` over seed/fallback session ids.

---

## 2026-07-25 — Supervisor PIN upsert + friendly errors

### Shipped
- PIN save upserts Supervisor into `store_specialists` when ID is a seed/fallback or update hits zero rows; persists real UUID + pin to session.
- Error copy uses Profile/Supervisor (not "specialist"); success toast "✅ Supervisor PIN updated successfully!"; dismisses change modal + default-PIN banner.

---

## 2026-07-25 — Fix PIN persistence across reloads

### Shipped
- `updateSpecialistPin` now updates Supabase by specialist `id` (resolves seed IDs via name), throws on failure (modal stays open).
- On success: immediately writes `carpet_active_specialist` + React state with new `pin_code`.
- On load: `syncActiveSpecialistFromRoster` merges DB roster into active session; dismisses default-PIN banner when `pin_code !== 1234`.

---

## 2026-07-25 — Offline sync, SW shell, multi-store, manager markdown

### Shipped
- `public/sw.js` + `ServiceWorkerRegister`: cache-first static shell, network-first HTML, network-only APIs.
- `lib/sync-queue.ts` (`carpet_hub_sync_queue`): enqueue offline writes; auto-replay on `online` with green sync toast.
- Header network badge: 🟢 Online / 🟠 Offline Mode (+ pending queue count).
- Store context (`lib/store.ts`): Lowe's # selector in Settings; `store_number` on all entities + Supabase `.eq` filters.
- Manager markdown: 60+ / Supervisor-gated modal (%, fixed $); clearance badge on remnant cards.
- Schema: `store_number`, markdown columns, per-store unique indexes.

---

## 2026-07-25 — Deduplicate supervisors + default PIN customization

### Shipped
- `dedupeRoster()` merges duplicate Supervisor / "Department Supervisor" cards (local + remote + UI).
- After login with default PIN `1234`, show security banner: Set New PIN / Remind Me Later.
- `ChangePinModal`: Current PIN + New 4-digit + Confirm; saves to Supabase/`pin_code`.
- Header ⚙️ Change PIN + Settings shortcut; green toast on success.

---

## 2026-07-25 — Supervisor PIN security & roster cleanup

### Shipped
- Removed Alex/Dave placeholder seeds; default roster is **Department Supervisor** (PIN `1234`) or a clean team the store registers.
- Role badges: 🛡️ Department Supervisor / 👤 Associate.
- PIN keypad for Supervisor (or any profile with `pin_code`); incorrect PIN shakes + stays on current user.
- Discrepancies-only filter gated behind supervisor session or PIN unlock.
- Settings: **Change Supervisor PIN** (verify current → set new).
- Add Team Member: name, role, optional/required PIN.

---

## 2026-07-25 — PWA, specialists, variance & remnant aging

### Shipped
- PWA manifest (`Carpet Hub — Flooring Dept`, standalone, theme `#022c22`) + iOS web-app meta/icons.
- Active specialist badge + Select Specialist modal (`store_specialists`); stamps `audited_by` / `logged_by`.
- System On-Hand CLF → variance (Physical − System) with match / shortage / overage badges (±2 CLF tolerance).
- Remnant aging badges (0–29 / 30+ / 60+) + Logged by display.
- Supervisor audit filters: specialist, location, discrepancies only.

### Ownership
| Concern | Owner |
|---|---|
| PWA manifest | `app/manifest.ts`, `app/layout.tsx` |
| Specialists | `lib/specialists.ts`, `SpecialistModal` |
| Variance math | `lib/variance.ts` |
| Remnant aging | `lib/aging.ts` |

---

## 2026-07-25 — Handheld barcode + Marry Barcode workflow

### Shipped
- `carpet_catalog.upc_barcode` (nullable, indexed) + local/offline support.
- Scanner-friendly inputs: strip leading zeros, Enter commit, rapid-key heuristic.
- Smart resolve: SKU/UPC match → chime + flash + auto-fill; unlinked vendor barcode → Marry modal.
- Marry modal: link existing catalog row or create new Item # with UPC attached.
- Catalog cards show **Barcode Linked** badge; link / unlink / edit UPC.

### Ownership
| Concern | Owner |
|---|---|
| Scan sanitize / resolve | `lib/barcode.ts` |
| Success chime | `lib/scan-feedback.ts` |
| Marry UI | `components/barcode/MarryBarcodeModal.tsx` |
| Catalog persistence | `lib/catalog.ts` |

---

## 2026-07-25 — Carpet Management Hub overhaul

### Shipped
- Multi-section **Carpet Hub** with sticky header + translucent slide-over drawer (Audit / Catalog / Remnants / Settings).
- Fixed sticky leading-zero typing via string-based `NumberField` + sanitizers + focus-select.
- Cycle Audit: catalog SKU auto-fill, **+ Save to Catalog**, shift log capped at 5 with Show All.
- Catalog Manager: search, add/edit/remove wall SKUs (vendor + roll width).
- Remnant Rack: status filters, W×L → sq ft / sq yd, reserve/sold/edit/delete.
- Settings: Supabase config/ping + localStorage cache counts.
- Schema expanded: `carpet_catalog`, `carpet_remnants`.

### Ownership
| Concern | Owner |
|---|---|
| Hub navigation | `app/page.tsx`, `components/hub/HubChrome.tsx` |
| Number UX | `lib/number-input.ts`, `components/ui/NumberField.tsx` |
| Catalog | `lib/catalog.ts` |
| Remnants | `lib/remnants.ts` |
| Audits | `lib/storage.ts` |

---

## 2026-07-25 — Visual / mobile layout polish

### Changes
- Outer shell: `max-w-md mx-auto w-full px-4 py-6` phone-app column on desktop.
- Rounds stepper: `flex w-full gap-2.5` with `shrink-0` ± buttons and `min-w-0 flex-1` input (no overflow past card).
- Measurement header: inline flex with emerald `8.50"` badge (no stacked overlap).
- Fraction pad `grid-cols-4` / chips `grid-cols-3`, `min-h-[44px]`; inputs `text-base`/`text-lg` for iOS zoom.
- Palette: slate-950 body, slate-900/90 cards, emerald accents for CLF / active location / CTA; formula card gradient + glow border.

---

## 2026-07-25 — Cycle count form defaults & schema alignment

### Changes
- All measurement inputs default to **0** (whole inches, fraction `0"`, rounds).
- Added **Carpet Name / Style** under SKU; SKU field shows barcode indicator.
- Rounds quick chips: **+5 / +10 / +20**; stepper allows 0 until submit.
- Submit button **Log Roll & Reset** clears form to defaults after save.
- Live formula card: `8.50" × 23 rounds × 0.2625 = 51.32 CLF`.
- Summary bar: Floor vs Top Stock roll counts + cumulative CLF; Copy Shift Summary + Export CSV.
- Measurement accordion includes SVG diagram.
- Supabase columns aligned: `sku`, `carpet_name`, `location_type`, `measurement_inches`, `measurement_fraction`, `rounds`, `calculated_clf`.
- Added `npm run typecheck`.

### Ownership (unchanged)
| Concern | Owner |
|---|---|
| CLF math | `lib/calc.ts` |
| Persistence | `lib/storage.ts` |
| Presentation | `app/page.tsx` |
| Schema | `supabase/schema.sql` |

---

## 2026-07-25 — Initial standalone auditor

### What shipped
- Next.js App Router + Tailwind CSS v4 mobile-first carpet roll auditor.
- Core formula: `CLF = measurement_inches × rounds × 0.2625`.
- Fraction quick-pad (0" through 7/8") with live decimal + CLF banner.
- Location segmented control: Sales Floor / Top Stock.
- Supabase `carpet_audits` persistence via `@supabase/supabase-js`.
- Offline fallback: failed or unconfigured network writes land in `localStorage` (`carpet_audits_offline`).
- Session summary panel with copy-to-clipboard.
- Audit feed (reverse chronological) with per-row delete.
- Collapsible measurement visual aid.

### Ownership
| Concern | Owner |
|---|---|
| CLF math | `lib/calc.ts` |
| Persistence (remote + offline) | `lib/storage.ts` |
| Supabase client | `lib/supabase.ts` |
| Domain types | `lib/types.ts` |
| Presentation / entry UX | `app/page.tsx` |
| Schema | `supabase/schema.sql` |

### Notes
- Touch targets intentionally ≥ 48px for ladder/floor one-handed use.
- Dark slate theme chosen for warehouse glare / night-shift readability.
- Anon RLS policies in schema are permissive for a floor tool; tighten before multi-store production.
