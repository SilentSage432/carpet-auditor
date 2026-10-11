# DEPTSYNC-SEC-OPS-007E — Device Evidence Authentication Investigation

**Date:** 2026-10-11  
**Mode:** Diagnostic only  
**Production mutations:** NOT AUTHORIZED (none executed)  
**Commit / push / deploy:** NOT AUTHORIZED  
**Prior hotfix under investigation:** SEC-OPS-007D `75efe82` / Vercel `FqTvT3XYWuHTE55u8e7ZfRdoLAgj`  
**Canonical Supabase:** `fmeinlwhixngednabhgy`  
**Application:** https://deptsync-hub.vercel.app  

---

## Device evidence interpretation

Operator phone console (actual device observations):

| Observation | Interpretation |
|-------------|----------------|
| Supabase request HTTP **401** | **Authentication** failure at PostgREST / GoTrue boundary (invalid, expired, or missing usable JWT) — **not** proven as RLS **403** authorization denial |
| `[fetchSpecialists] store_specialists select failed` | Client reached `loadSpecialists` → `store_specialists` SELECT for store **2587**; error path logged then **rethrows** (`lib/specialists.ts`) |
| `Uncaught (in promise) Object` | Rejection was a **plain object** (typical supabase-js / PostgREST error), and **no caller catch** consumed it — browser surfaces “Object”, not `Error` |
| Splash: `Loading DeptSync secure session…` | Matches AccessGate / login Suspense / hub `HubBootFallback` — **not** SessionGate (`Loading secure session…`) |

**Not assumed:** PIN invalidity; that the phone is executing 007D; that 401 alone is the UI hang (hang requires an unhandled bootstrap rejection or never leaving `booting`).

---

## 1. Deployed asset identity

### Expected 007D deployment

| Field | Value |
|-------|--------|
| Commit | `75efe828a83bb5820b14d8f4f19678a9f5f2ab09` (`75efe82`) |
| Vercel deployment id | `FqTvT3XYWuHTE55u8e7ZfRdoLAgj` |
| Repo HEAD at investigation | `55d2a35` (docs only after `75efe82`) |

### Production `/login` probe (read-only HTTP, 2026-10-11)

| Field | Value |
|-------|--------|
| HTTP | **200** |
| `x-matched-path` | `/login` |
| `x-vercel-cache` | HIT |
| `etag` | `afa4f49a756073842bc01ccf08d96010` |
| HTML sha256 | `376c3fafbb582e62fc4b4e70d6ed83168b27e42dba59c0474c541c9d0930d067` |
| `sw.js` | **200**, byte-identical to repo `public/sw.js` (sha256 prefix `fe47b245fd7bc531…`) |
| SW `CACHE_VERSION` | `deptsync-shell-v6-stealth` |

### 007D JavaScript asset (production)

Login HTML references hashed chunks under `/_next/static/chunks/`. The AccessGate + specialists + bootstrap decision table live in:

| Asset | Role | Evidence |
|-------|------|----------|
| **`/_next/static/chunks/2yj418yf7-0ff.js`** | AccessGate + `fetchSpecialists` + boot decision helper | sha256 `5016c1ea1b02fc40e9d371f13acb801b00f0b04913994f19ba3770e0e8a4ce39` (69 210 bytes) |

**Markers present in that production chunk (minified):**

- `roster_auth_rejected` / `roster_network_error` / `clearSupabaseLocal`
- `Loading DeptSync secure session…`
- `[fetchSpecialists] store_specialists select failed`
- Boot pattern: `try { … await fetchSpecialists() … } catch (e) { c = e; a = null }`
- Outer fail-closed: `catch { … g("login") }`
- Generation guard: `y.current += 1` (minified `bootGenRef`)

**Conclusion (edge/CDN):** Production alias is serving **007D AccessGate recovery code**. Function name `decideAccessGateBoot` is minified away; string reasons prove the helper.

### Phone asset identity — **not established remotely**

This investigation could not attach to the operator device. **Required browser evidence:**

1. **Network** → document request for `/_next/static/chunks/*.js` — is **`2yj418yf7-0ff.js`** loaded?  
2. **Console stack** of `Uncaught (in promise) Object` — AccessGate vs `app/page` vs other.  
3. **Application → Service Workers** — script URL `/sw.js`, state activated, controller present?  
4. **Cache Storage → `deptsync-shell-v6-stealth`** — cached `/login` and any older `/_next/static/chunks/*` hashes.  
5. **Address bar** — `/login` vs `/` / `/dashboard` (hub gate cookie path).  
6. Whether a **full reload** occurred after deploy `FqTvT3…` (stale tab keeps pre-007D heap).

---

## 2. Failed request path

```
AccessGate boot (or hub loadStoreData)
  → getSupabase()  // NEXT_PUBLIC URL/anon for fmeinlwhixngednabhgy
  → supabase.auth.getSession()  // localStorage sb-*-auth-token
  → if access_token present:
       fetchSpecialists() → loadSpecialists(store)
         → from("store_specialists").select(…).eq/in(store_number, 2587 keys)
         → on error: console.error("[fetchSpecialists] …"); throw err
```

| Question | Finding |
|----------|---------|
| Which client? | Browser `getSupabase()` (`@supabase/supabase-js`, persistSession + localStorage) |
| Which JWT? | Whatever `getSession()` restores from Supabase auth storage (not printed) |
| Session restoration? | Hub wall session (`deptsync_auth_session`) **and** Supabase JWT probe both run before roster SELECT when wall session exists |
| JWT expired/invalid? | **Consistent with HTTP 401** — not proven which exact claim failed without response body (do not log secrets) |
| Expected project? | Canonical `fmeinlwhixngednabhgy` (app + prior SEC-OPS docs) |
| Failure caught? | **Caught in current AccessGate (007D).** **Rethrown uncaught** in pre-007D AccessGate and in current **`app/page.tsx` hub boot** |

### 401 vs 403

| Status | Meaning here |
|--------|----------------|
| **401** (observed) | Authn — JWT missing/invalid/expired for the REST call |
| **403** / RLS | Authz — authenticated but policy denies; **not** what the device reported |

Do not treat 401 as “wrong PIN”; PIN verify never runs while splash is stuck.

---

## 3. Unhandled rejection source

### Current production AccessGate (007D) — **does not** leave uncaught roster rejection

Minified production boot:

```text
if (hasJwt) try { team = dedupeRoster(await fetchSpecialists()) }
catch (e) { rosterError = e; team = null }
→ decideAccessGateBoot(…) → setMode("unlock"|"login"|"setup") or enter
```

Therefore: **device triad (401 + fetchSpecialists log + Uncaught Object + permanent splash) is incompatible with executing current AccessGate.**

### Sources that **do** produce Uncaught Object + splash

| Source | Splash copy | Uncaught on roster throw? | Leaves booting? |
|--------|-------------|---------------------------|-----------------|
| **Pre-007D AccessGate** (`75efe82^`) | `Loading DeptSync secure session…` | **Yes** | **Yes** (permanent) |
| **`app/page.tsx` hub boot** (current) | same | **Yes** (`await loadStoreData()` no try) | **Yes** while `gate === "booting" \|\| !rosterReady` |
| `WorkflowTabShell` `fetchSpecialists().then` no `.catch` | N/A (post-SessionGate) | Yes | No splash of this copy |
| Current AccessGate 007D | same | **No** | **No** (→ unlock/login) |

**Best match to operator screenshot + console:**  
**(B) stale pre-007D AccessGate still executing**, or **hub `/` boot with gate cookie** still on the uncaught `loadStoreData` path.

Login Suspense fallback can show the same splash briefly; it does not call `fetchSpecialists`.

---

## 4. SEC-OPS-007D recovery verification

| Claim | Verified? |
|-------|-----------|
| Every AccessGate bootstrap rejection handled | **Yes** in source + prod chunk |
| AccessGate exits `booting` | **Yes** (login / unlock / setup / enter→unlock fallback) |
| Failed auth never grants workspace entry | **Yes** (`decideAccessGateBoot` never `enter` on `rosterError`) |
| Invalid sessions transition safely | **Yes** (auth reject → unlock + local `signOut`; expired wall → login + clear hub session) |
| Recovery does not clear unrelated app data | **Yes** (no full site wipe; only hub session / local Supabase scope as decided) |

Unit tests: `access-gate-bootstrap.test.ts` + `sec-ops-007c.session-bootstrap.test.ts` — **PASS** (10).

**Residual gap (007D explicitly deferred):** `app/page.tsx` hub cold start still uncaught — relevant if `deptsync_hub_gate` cookie admits HTML past `proxy.ts` while JWT is bad.

---

## 5. Service worker findings

File: `public/sw.js` (prod identical).

| Behavior | Detail |
|----------|--------|
| Register | `ServiceWorkerRegister` → `/sw.js` |
| Cache name | `deptsync-shell-v6-stealth` (**unchanged** by 007D) |
| Precache | `/login`, manifests, icons |
| Navigation | **network-first** → update cache on OK; cache on network failure |
| `/_next/static/*` JS | **cache-first** |
| Activate | `skipWaiting` + `clients.claim`; deletes other cache **names** only |

**Can a phone remain on an obsolete auth bundle after a successful Vercel deploy?**

| Mechanism | Risk |
|-----------|------|
| Tab never reloaded after deploy | **High** — old JS stays in memory; 007D never runs |
| Offline / failed navigation fetch | **Medium** — network-first falls back to cached `/login` HTML → old chunk hashes → cache-first serves old JS |
| Successful online reload of `/login` | **Low** for AccessGate — new HTML should request `2yj418yf7-0ff.js` with 007D recovery |
| CACHE_VERSION bump | **Not done** in 007D — old hashed chunks remain in Cache Storage until unused |

007D did **not** change `sw.js`; activation alone does not flush same-named cache entries.

---

## 6. Reproduction results

| Case | Setup | Expected (current tree) | Matches device? |
|------|--------|-------------------------|-----------------|
| **A** Current bundle + rejected `fetchSpecialists` | 007D AccessGate + 401-shaped error | Unlock PIN; JWT local sign-out; **no** uncaught | **No** (device has uncaught) |
| **B** Stale pre-007D + rejected `fetchSpecialists` | AccessGate without try/catch | Permanent splash + console.error + **Uncaught Object** | **Yes** |
| **C** Clean browser + no session | Empty storage `/login` | PIN login (007C/007D verified) | Not the stuck state |
| **D** Existing session + invalid JWT | Wall session + bad `sb-*-auth-token` | **007D:** unlock; **pre-007D / hub page:** hang | Device matches hang branch |

**007C** already reproduced **D** on pre-007D as infinite splash. **007E** confirms production CDN now serves the 007D catch; device uncaught implies **stale client or hub path**, not “007D missing from Vercel”.

Diagnostic tests added: `lib/store-ops/sec-ops-007e.device-auth-diagnostic.test.ts` (no product fix).

---

## Confirmed root cause (with confidence)

| Layer | Verdict |
|-------|---------|
| Edge/CDN serving 007D AccessGate | **Confirmed** via chunk markers on `2yj418yf7-0ff.js` |
| Device executing that AccessGate | **Not confirmed** — console uncaught contradicts it |
| Immediate hang mechanism | **Confirmed pattern:** uncaught `fetchSpecialists` rejection while UI state remains `booting` / hub booting |
| Most likely device explanation | **Stale pre-007D JS still running** (no reload or SW stale HTML→old chunks), **or** hub `app/page.tsx` boot behind hub-gate cookie |
| PIN / MasterAdmin / RLS weaken | **Not implicated** by this evidence |

**Root cause for the operator’s stuck splash is therefore: bootstrap path without a settled error boundary around roster restore — on the code the phone actually executed — while a local session + JWT triggered `store_specialists` and received HTTP 401.**  
Whether that code is pre-007D AccessGate or current hub page remains a **device-asset identity** question (evidence list above).

---

## Minimal proposed correction (NOT implemented)

1. **Operator immediate (no auth weaken):** hard reload `/login`; if still stuck, clear **only** site data for `deptsync-hub.vercel.app` (or remove hub session + Supabase auth storage keys) — not unrelated device data.  
2. **Engineering (authorize as SEC-OPS-007F or similar):**  
   - Mirror AccessGate fail-closed around `app/page.tsx` `loadStoreData` / hub boot.  
   - Add `.catch` on WorkflowTabShell roster refresh (secondary).  
   - Optionally bump SW `CACHE_VERSION` and/or stop cache-first for HTML-referenced `/_next/static` during auth shell updates so phones cannot run obsolete AccessGate after deploy.  
3. Do **not** reset Master PIN, weaken RLS, disable rate limits, or roll back 007B/007D.

---

## GO / NO-GO

| Action | Verdict |
|--------|---------|
| Diagnostic complete | **GO** |
| Repair implementation in this tranche | **NO-GO** |
| Blame “007D missing from Vercel” | **NO-GO** (CDN chunk proves 007D present) |
| Assume phone runs 007D | **NO-GO** (uncaught contradicts) |
| Production SQL / credential / RLS / rate-limit changes | **NO-GO** |
| Commit / push / deploy | **NO-GO** |
| Next repair authorization | **GO** only after operator confirms chunk hash **or** accepts stale-client + hub-boot fix scope |

---

## Execution boundary confirmation

- Diagnostic + read-only production HTTP + local tests only  
- No production SQL / credential changes  
- No commit / push / deploy  
- No cache or production mutation  

**STOP.**
