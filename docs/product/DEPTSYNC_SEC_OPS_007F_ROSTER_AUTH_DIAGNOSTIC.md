# DEPTSYNC-SEC-OPS-007F — Production Roster Authorization Investigation

**Date:** 2026-10-11  
**Mode:** Diagnostic only  
**Production mutations:** NOT AUTHORIZED (none executed)  
**Commit / push / deploy:** NOT AUTHORIZED  
**Production app:** https://deptsync-hub.vercel.app  
**Supabase:** `fmeinlwhixngednabhgy`  
**Related:** SEC-OPS-002 containment · SEC-OPS-007D/007E bootstrap  

---

## Device evidence (operator Chrome DevTools)

| Observation | Value |
|-------------|--------|
| Request | `GET /rest/v1/store_specialists` |
| HTTP | **401** |
| PostgreSQL | **42501** |
| Message | `permission denied for table store_specialists` |
| Hint | Grant privileges to the **current role** |
| App log | `[fetchSpecialists] store_specialists select failed` |
| Promise | `Uncaught (in promise) Object` |
| UI | `Loading DeptSync secure session…` |

**42501 is a privilege failure**, not an RLS row filter miss (RLS denial typically yields empty `200` / no rows).  
**Not assumed:** PIN invalidity; that broadening `anon` grants is required; that caching is the only cause.

---

## 1. Request authority

### Exact client query contract

`lib/specialists.ts` → `fetchSpecialists` → `loadSpecialists(store)`:

```text
getSupabase()  // browser singleton, anon apikey + optional user Authorization
  .from("store_specialists")
  .select(SPECIALIST_LIST_SELECT)   // explicit columns — not "*"
  .eq / .in ("store_number", 2587 keys)
  .order("name")
```

On error: `console.error("[fetchSpecialists] …"); throw err` (plain PostgREST object → “Uncaught Object”).

### Which component initiates it

| Bootstrap consumer | Calls `fetchSpecialists`? | Requires Supabase JWT first? | Catches rejection? |
|--------------------|---------------------------|------------------------------|--------------------|
| **`AccessGate`** (`/login`) | Only if `getSession()` reports `access_token` | **Yes** (awaits `getSession`) | **Yes** on 007D; **No** on pre-007D |
| **`app/page.tsx` hub boot** | **Always** via `loadStoreData()` | **No** — runs before `resolveGateFromSession` / `getSession` | **No** |
| WorkflowTabShell / FloorTab / etc. | After SessionGate | Session assumed | Mixed |

Hub wall session (`deptsync_auth_session`) and Supabase Auth JWT are **different**. Hub cookie `deptsync_hub_gate` can admit `/` HTML while the browser still has **no** authenticated PostgREST role.

### Live reproduction (anon — read-only)

Using production anon key as `apikey` + `Authorization: Bearer <anon>` against the same projection / store filter:

| Field | Result |
|-------|--------|
| HTTP | **401** |
| `code` | **42501** |
| `message` | `permission denied for table store_specialists` |
| Hint names role | **`anon`** (`GRANT SELECT … TO anon`) |

**Byte-level match** to the operator failure class. The failing request executes as PostgreSQL role **`anon`**.

Service-role smoke (status only, no credential columns printed): `select=id,store_number,name` → **206** (rows exist; table not missing).

Authenticated end-user JWT smoke: **not performed** (no credential guessing / no session mint in this diagnostic).

### JWT role metadata (safe)

| Credential | Claimed `role` (JWT payload only) |
|------------|-------------------------------------|
| Anon apikey | `anon` |
| Service role key | `service_role` |
| Operator user JWT | Not inspected (do not print tokens) |

---

## 2. Database privileges (read-only)

### SEC-OPS-002 (applied) — intentional state

From `supabase/migrations/20261013_sec_ops_002_rls_containment.sql` + containment report:

| Role | `store_specialists` |
|------|---------------------|
| **anon** | **REVOKE ALL** — no table privileges |
| **authenticated** | Table `SELECT` revoked; **column-level SELECT** on non-secret columns only |
| **service_role** | Unchanged (API after authz) |

Secret columns excluded from client SELECT: `pin`, `pin_code`, `pin_hash`, `temp_pin_hash`, `invite_token`, `invite_token_hash`, `auth_token_hash`.

Post-002 catalog checks (report §F): authenticated `name` SELECT **true**; `pin_code` SELECT **false**; anon table SELECT **false**.

Live PostgREST `information_schema` views: **not exposed** (404) — privilege re-list via REST catalog unavailable; anon behavior + migration text + prior §F checks used.

### RLS

Store-scoped authenticated policies remain (lockdown lineage). **42501 is not an RLS deny** — it is missing `GRANT` for the role used on the wire (`anon`).

### Does the failing query need privileges intentionally revoked?

**Yes for `anon`.** SEC-OPS-002 deliberately revoked anon access to `store_specialists`. The device error is that containment working as designed when the client calls PostgREST **without** an authenticated user JWT.

---

## 3. Query projection

`SPECIALIST_LIST_SELECT` columns:

`id, store_number, name, role, floor_title, username, assigned_department, home_department, accessible_departments, must_change_credentials, must_change_pin, phone_number, is_active, status, pin_updated_at, email, auth_user_id, created_at`

| Check | Result |
|-------|--------|
| `select("*")` | **No** |
| Requests `pin` / `pin_code` / `pin_hash` / invite secrets | **No** |
| ⊆ SEC-OPS-002 authenticated column grants | **Yes** (all listed columns are in the grant set) |

A restricted non-secret projection **already exists**. Column projection is **not** the cause of this 42501. Granting anon or re-adding secret columns is **not** required for this SELECT shape.

**Residual (not this incident):** other helpers in `lib/specialists.ts` still call `.select("*")` on write/read paths. Those are separate from `fetchSpecialists` list bootstrap and may fail under authenticated column grants even after JWT sequencing is fixed — track separately; do not “fix” by restoring secret SELECT.

---

## 4. Bootstrap failure path

```text
Hub cold start (/) with hub-gate cookie, OR AccessGate with perceived JWT
  → fetchSpecialists() via browser anon client (no authenticated role on wire)
  → PostgREST 401 / 42501 permission denied for table
  → throw plain object
  → uncaught rejection (hub page always; AccessGate if pre-007D)
  → mode/gate stays booting → "Loading DeptSync secure session…"
```

### Why uncaught + persistent loading

| Code path | Behavior on 42501 |
|-----------|-------------------|
| Current **AccessGate** (007D, prod chunk `2yj418yf7-0ff.js`) | Catches; `isLikelyAuthRejection` treats **42501** / “permission denied”; → **unlock** + local signOut |
| Pre-007D AccessGate | No catch → **Uncaught Object** + permanent splash |
| **`app/page.tsx`** `loadStoreData` | No try/catch; **no `getSession` before fetch** → **Uncaught Object** + `gate === "booting"` splash |

Device triad (42501 + fetchSpecialists log + Uncaught + splash) is **compatible with hub boot** and/or **stale AccessGate**, and **incompatible with executing current AccessGate recovery**.

### Phone current vs stale JS

007E established production CDN serves 007D AccessGate. Uncaught on `/login` still implies stale AccessGate JS **or** the failure is on **hub `/`**, not AccessGate.  
**Do not treat caching as the only cause** — hub `loadStoreData` is a live source-level defect that reproduces anon 42501 + hang without any stale bundle.

---

## 5. Did SEC-OPS-002 cause a legitimate application regression?

| Statement | Verdict |
|-----------|---------|
| SEC-OPS-002 anon revoke is correct security | **Yes** |
| App still performs browser `store_specialists` SELECT during bootstrap | **Yes** |
| That SELECT succeeds only as **authenticated** (column grants) | **Yes** (by design) |
| Hub boot / any path that queries as **anon** now hard-fails | **Yes — legitimate app regression relative to pre-revoke anon reads** |
| Fix by restoring anon table access | **NO-GO** |
| Authenticated JWT + same projection should be sufficient (per 002 grants) | **Expected**; live user-JWT smoke still **NOT VERIFIED** since 002 |

SEC-OPS-002 did not “break” SQL grants for authenticated roster list columns; it **exposed** clients that still hit the table as `anon` during restore.

---

## Confirmed root cause

1. **Immediate DB denial:** Request runs as role **`anon`**, which has **no** privileges on `public.store_specialists` after SEC-OPS-002 (`42501`).  
2. **Application fault:** Bootstrap/roster restore uses the **browser Supabase client** to SELECT the roster **without ensuring an authenticated PostgREST session is on the wire** — especially `app/page.tsx` `loadStoreData()` (always, before `getSession`), and any AccessGate path that still surfaces uncaught rejections (stale bundle).  
3. **UI fault:** That rejection is not handled on the hub boot path → permanent secure-session splash.  
4. **Not the cause:** Missing non-secret column projection; need for anon credential-table access; PIN verify against scrypt (never reached).

---

## Minimal safe repair proposal (NOT implemented)

Prefer application sequencing and fail-closed UX — **not** broad grants.

1. **Hub boot:** Await `getSession()` (or skip network roster) before `fetchSpecialists`; wrap `loadStoreData` in try/catch; on 42501/401 → unlock/login, never stay booting.  
2. **AccessGate:** Keep 007D recovery; ensure phones load current chunk (`2yj418yf7-0ff.js`); optional one-time SW cache-version bump.  
3. **Do not** `GRANT` to `anon` on `store_specialists`.  
4. **Do not** restore secret-column SELECT.  
5. If a DB grant is ever proposed: only **confirm** authenticated column grants still match `SPECIALIST_LIST_SELECT` (already designed); application-level sequencing is still required so cold start cannot race as anon.  
6. Optional later: authorized **server** roster read (service role after hub-bridge / cookie auth) for first paint — out of scope unless product wants to remove client SELECT entirely.

---

## 6. Reproduction matrix

| Case | Method | Result |
|------|--------|--------|
| Anon roster query | PostgREST + anon Bearer + list projection | **401 / 42501** — matches device |
| Anon `select=id` | Same | **401 / 42501** |
| Authenticated roster query | Not run (no session mint) | Expected OK per 002 column grants — **unverified live** |
| Missing/expired session + hub boot | Code path | `fetchSpecialists` as anon → throw → hang |
| Restricted column grants | Migration + projection diff | List columns ⊆ grants; secrets excluded |
| Rejected roster during bootstrap | 007D unit + hub source | 007D recovers; hub does not |

Diagnostic tests: `lib/store-ops/sec-ops-007f.roster-auth-diagnostic.test.ts`.

---

## GO / NO-GO

| Action | Verdict |
|--------|---------|
| Diagnostic complete | **GO** |
| Restore anon SELECT on `store_specialists` | **NO-GO** |
| Broaden table/secret grants | **NO-GO** |
| Production SQL in this tranche | **NO-GO** |
| Commit / push / deploy | **NO-GO** |
| App repair: hub boot sequencing + catch + keep 007D | **GO** (authorize separately, e.g. SEC-OPS-007G) |
| Operator workaround | Hard reload `/login`; if needed clear site data for hub origin only; complete hub-bridge PIN login so an **authenticated** JWT exists before roster SELECT |

---

## Execution boundary confirmation

- Diagnostic + read-only anon PostgREST + local source/tests only  
- No production SQL / grants / RLS changes  
- No commit / push / deploy  
- No credential guessing  

**STOP.**
