# DEPTSYNC-ALIGN-SEC-001 — Single-Operator Security Stabilization

**Status:** IMPLEMENTATION COMPLETE (local) · **Deployment / production mutation / commit / push:** NOT AUTHORIZED  
**Date:** 2026-10-10  
**Authority:** Constitution Art. XVIII; ALIGN-002 single-operator identity  
**Does not implement:** sections, department split, walkthroughs, UI redesign, associate auth retirement, integrations

---

## 1. Authentication dependency map (investigation)

| Mechanism | Required for current operator? | Notes |
|-----------|--------------------------------|-------|
| Specialist / Master **PIN** → `POST /api/auth/hub-bridge` | **Yes** | Primary login; service-role PIN verify; mints Supabase session |
| `HUB_MASTER_PIN` | **Yes** (Master path) | Fail-closed when unset |
| Supabase Auth session (JWT) | **Yes** | Store Ops API actor resolution; `POST /api/auth/gate` |
| Hub gate cookie (`deptsync_hub_gate`) | **Yes** | Edge HTML + protected `/api/*` after ALIGN-SEC-001 |
| `HUB_GATE_SECRET` | **Yes** | Sole HMAC for gate / pairing / verify cookies |
| `syncHubGateCookie` after login | **Yes** | AccessGate / auth-session |
| Session inactivity (8h) | **Yes** | `AUTH_SESSION_TIMEOUT_MS` / gate TTL |
| `BOOTSTRAP_SECRET` + `/api/auth/bootstrap-admin` | Recovery (HTTP) | Dedicated secret only |
| `scripts/bootstrap-admin.mjs` | Recovery (local) | Service role + `HUB_MASTER_PIN`; no BOOTSTRAP_SECRET |
| `CRON_SECRET` + `/api/cron/*` | Cron only | Not a gate/bootstrap substitute |
| Service-role in API routes | **Yes** (server) | Must still check actor; proxy pass ≠ authorization |
| Associate PIN / QR pair / invite SMS | Legacy / associate | **Not removed** this tranche |
| Phone OTP | Optional recovery | Retained |

---

## 2. Behavior changes

| Area | Before | After |
|------|--------|-------|
| Gate secret | Fallback cron → service role → anon → hardcoded | `HUB_GATE_SECRET` only; fail closed |
| Proxy `/api/*` | Public **or** gate cookie **or any Bearer** | Public / cron / **verified gate cookie** only |
| Bootstrap HTTP | `BOOTSTRAP_SECRET` \|\| `CRON_SECRET` | `BOOTSTRAP_SECRET` only |
| Pairing / auth-verify HMAC | Same unsafe fallbacks | `HUB_GATE_SECRET` only |
| `schema.sql` demo PINs | Seeded `1234` / `ChangeMe123` | Removed from seed path |

---

## 3. Required environment (names only)

| Variable | Role |
|----------|------|
| `HUB_GATE_SECRET` | **Required** — hub gate + pairing + auth-verify HMAC |
| `HUB_MASTER_PIN` | **Required** — Master PIN login / bootstrap PIN source |
| `BOOTSTRAP_SECRET` | **Required for HTTP bootstrap**; optional if using local script only |
| `CRON_SECRET` | **Required for cron**; not a substitute for gate/bootstrap |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser + user JWT client |
| `SUPABASE_SERVICE_ROLE_KEY` | Server privileged writes (never for gate HMAC) |

**Credential rotation (separate; not executed here):** If production ever used fallback-signed gate cookies, rotate `HUB_GATE_SECRET` and re-login. If demo PIN `1234` exists in a live roster, rotate via bootstrap / PIN reset — do not mutate production from this tranche.

---

## 4. Operator access & recovery

1. **Normal:** username/PIN → hub-bridge → Supabase session → `syncHubGateCookie` → operate.  
2. **HTTP recovery:** `POST /api/auth/bootstrap-admin` with `Authorization: Bearer <BOOTSTRAP_SECRET>` (requires `HUB_MASTER_PIN`).  
3. **Local recovery:** `node --env-file=.env.local scripts/bootstrap-admin.mjs` (service role + `HUB_MASTER_PIN`).  

Associate auth surfaces are unchanged (not retired).

---

## 5. RLS verification

Read-only script: [`scripts/sql/align-sec001-rls-verify-readonly.sql`](../../scripts/sql/align-sec001-rls-verify-readonly.sql)  
**Not executed against production in this tranche.** Repository migrations are not proof of live RLS.

---

## 6. Remaining risks

- Production env may lack `HUB_GATE_SECRET` / `BOOTSTRAP_SECRET` until operator configures (deploy not authorized here).  
- Live roster may still contain historical demo PINs — rotation is a separate ops action.  
- Permissive RLS policies may still exist in some environments — run the SQL script.  
- Associate PIN/QR/invite surface area retained by design.  
- Proxy pass still does not equal handler authorization — ongoing audit of service-role routes recommended.

---

*End of ALIGN-SEC-001.*
