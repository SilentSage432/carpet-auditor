# DEPTSYNC-SEC-OPS-007C — Production Secure Session Bootstrap Incident

**Date:** 2026-10-11  
**Mode:** Diagnostic only  
**Production mutations:** NOT AUTHORIZED (none executed)  
**Commit / push / deploy:** NOT AUTHORIZED  
**Hotfix under review:** SEC-OPS-007B `ff2b30b` / Vercel `ED2oSLiAtovm3xWY944KCF74VDAB`  
**Canonical project:** `fmeinlwhixngednabhgy`

---

## Exact bootstrap execution path

Operator-visible copy matches:

`Loading DeptSync secure session…`

| Surface | File | When shown |
|---------|------|------------|
| **Primary (login)** | `components/auth/AccessGate.tsx` **L111–112** | `mode === "booting"` |
| Login Suspense fallback | `app/login/page.tsx` **L12** | `useSearchParams` not ready |
| Hub cold start | `app/page.tsx` **L58–59** / dynamic AuthWall loading | Hub boot / AuthWall chunk load |
| Workflow routes | `components/hub/SessionGate.tsx` **L94–95** | `!ready` (different string: “Loading secure session…”) |

### AccessGate boot (production login path)

```48:95:components/auth/AccessGate.tsx
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const session = readAuthSession();
      if (!session || isAuthSessionExpired(session)) {
        // → setMode("login")  — PIN UI appears
        ...
        return;
      }

      const { data } = supabase
        ? await supabase.auth.getSession()
        : { data: { session: null } };
      const hasJwt = Boolean(data.session?.access_token);

      let team: StoreSpecialist[] = [];
      if (hasJwt) {
        team = dedupeRoster(await fetchSpecialists()); // can throw
      }
      ...
      if (!hasJwt) {
        setMode("unlock"); // PIN unlock UI
        return;
      }

      await enterWorkspace(matched); // mode never leaves "booting" until navigation
    })(); // NO try/catch
```

| Condition | Exit from splash? |
|-----------|-------------------|
| No / expired `deptsync_auth_session` | **Yes** → `login` (PIN form) |
| Local session, no JWT | **Yes** → `unlock` (PIN form) |
| Local session + JWT, roster OK, enterWorkspace completes | Leaves `/login` via `router.replace` |
| Local session + JWT, `fetchSpecialists()` **throws** | **No** — `mode` stays `"booting"` forever |
| `enterWorkspace` / navigation never settles | **No** — remains `"booting"` |

`fetchSpecialists` **rethrows** on select failure (`lib/specialists.ts` ~L789–791).

---

## Production evidence

| Check | Result |
|-------|--------|
| Vercel status for `ff2b30b` | **success** → `ED2oSLiAtovm3xWY944KCF74VDAB` |
| Supabase project | `fmeinlwhixngednabhgy` |
| `/login` | **200** |
| `/` unauth | **307** → `/login` |
| `POST /api/auth/hub-bridge` empty | **400** |
| `/sw.js` | **200** (`deptsync-shell-v6-stealth`) |
| Clean browser `/login` | **PIN login UI renders** (confirmed) |
| Operator device DevTools / Vercel function logs for this hang | **Not available** in this diagnostic |

### Controlled reproduction (isolated browser)

1. Clean `/login` → login form OK.  
2. Inject valid-shaped `deptsync_auth_session` only → **Unlock** PIN UI OK.  
3. Inject `deptsync_auth_session` **plus** invalid Supabase auth token in `sb-fmeinlwhixngednabhgy-auth-token` → page stuck on **“Loading DeptSync secure session…”** indefinitely.  
4. Network showed `store_specialists` fetch (~362ms) then no UI recovery — consistent with **thrown roster error + uncaught rejection**.

Diagnostic storage cleared afterward. No credentials exposed.

---

## Confirmed root cause

**Client bootstrap defect in `AccessGate`:** when a local hub session exists and Supabase `getSession()` reports an access token, boot awaits `fetchSpecialists()` with **no try/catch / no timeout / no fallback to `login`**. A failed roster select leaves `mode === "booting"` permanently, so the PIN UI never mounts.

This is **independent of PIN validity** and **independent of `store_specialists` scrypt1 verify** (verify never runs while stuck on splash).

### Whether SEC-OPS-007B is implicated

| Question | Finding |
|----------|---------|
| Does 007B change AccessGate / splash logic? | **No** |
| Does 007B break clean `/login` with empty storage? | **No** (proven) |
| Can prior auth incidents leave JWT + local session that trigger the hang? | **Yes — plausible** (007A link failures / partial hub-bridge attempts) |
| Is 007B the code defect causing permanent splash? | **No** — defect is pre-existing AccessGate error handling |

---

## Plausible causes not yet proven on the operator device

1. Exact operator `localStorage` contents (`deptsync_auth_session` + `sb-*-auth-token`).  
2. Whether roster fail is 401 vs refresh hang (repro saw completed fetch; hang still possible on other networks).  
3. Service-worker HTML cache serving an older login shell (SW caches `/login`; **not required** to explain the repro).  
4. Hub `app/page.tsx` boot (`await loadStoreData()` without catch) if operator somehow lands on `/` with a gate cookie.

---

## Minimal recommended correction (NOT implemented)

1. Wrap AccessGate boot async body in `try/catch`.  
2. On failure: clear or ignore broken JWT/session as needed; **`setMode("login")`** (or `"unlock"`).  
3. Never leave `mode === "booting"` after a settled rejection.  
4. Mirror the same recovery on `app/page.tsx` hub boot.  
5. Optional: if `fetchSpecialists` fails with auth error, `supabase.auth.signOut()` / clear stale token.  
6. Operator **immediate workaround:** clear site data for `deptsync-hub.vercel.app` (or remove `deptsync_auth_session` + `sb-fmeinlwhixngednabhgy-auth-token`) and reload `/login`.

Do **not** roll back 007B (would restore `pin: null` login break). Do **not** change Master PIN / RLS / rate limits.

---

## Regression test findings

`lib/store-ops/sec-ops-007c.session-bootstrap.test.ts` — **3/3 PASS**

- AccessGate boot lacks try/catch around `fetchSpecialists` / `enterWorkspace`  
- Hub page boot awaits `loadStoreData` without try  
- `fetchSpecialists` rethrows select failures  

---

## Remaining uncertainty

- Operator device storage / console not inspected live.  
- Whether SW stale shell contributes on that device (secondary).  
- Whether `getSession()` refresh can hang without throwing on some clients.

---

## GO / NO-GO for a repair release

| Action | Verdict |
|--------|---------|
| Diagnostic complete | **GO** |
| Separate AccessGate bootstrap recovery hotfix | **GO** (authorize as SEC-OPS-007D) |
| Implement/deploy in this diagnostic | **NO-GO** |
| Blame / revert SEC-OPS-007B | **NO-GO** |
| Production SQL / credential changes | **NO-GO** |

**Overall:** Confirmed hang path is uncaught roster failure during AccessGate boot when a local session + JWT are present. Clean login works on current production. Repair should add fail-closed recovery to PIN UI without weakening auth.

---

## Execution boundary confirmation

- Diagnostic + local/browser reproduction only  
- No production SQL / credential changes  
- No commit / push / deploy  

**STOP.**
