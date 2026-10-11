# DEPTSYNC-SEC-OPS-007 — Legacy Credential Mirror Cleanup

**Date:** 2026-10-11  
**Mode:** Controlled production security remediation  
**Canonical Supabase:** `fmeinlwhixngednabhgy` (ACTIVE_HEALTHY, us-west-2)  
**Application:** https://deptsync-hub.vercel.app  
**App writers release:** SEC-OPS-006 / `e36bfb5` / Vercel `CkWcALCvQTJYbaEw9Xm49Yas8E3B`  
**Production SQL:** Exact credential-field clear only (no app deploy)

---

## Pre-cleanup inventory

| Table | Digit-shaped | scrypt1 | Notes |
|-------|-------------:|--------:|-------|
| `store_specialists` | **0** | **1** | MasterAdmin already scrypt1 |
| `profiles` | **1** | 0 | Superseded mirror |
| `store_profiles` | **1** | 0 | Orphan store 1852 |

---

## Exact targeted records

Resolved full identifiers (not prefix-only):

| Table | Full id | Gates |
|-------|---------|-------|
| `profiles` | `0f3b20ce-85bf-4d1b-8103-4b81648d396d` | store `2587`; role `super_admin`; `specialist_id`=`f9e36630-9793-40cd-9d3c-53b5ee450b1c`; digit `pin`+`pin_code`; empty `pin_hash` |
| `store_profiles` | `0b7d86d3-5f14-447d-b2f5-5ff8997947a7` | store `1852`; username `master_admin`; role `admin`; digit `pin`+`pin_code` |
| Master (untouched) | `f9e36630-9793-40cd-9d3c-53b5ee450b1c` | store `2587`; `MasterAdmin`; active; **scrypt1** `pin_code`+`pin_hash` |

### Authentication dependency

| Question | Finding |
|----------|---------|
| Consumed by hub-bridge verify? | **No** — verifies `store_specialists` only; `profiles` selected for `id` link only |
| Required by SEC-OPS-005 writers? | **No** — writers hash roster / null mirror PIN fields |
| STOP required? | **No** |

---

## Backup verification

| Field | Value |
|-------|--------|
| Dump | `tmp/production-backups/deptsync-fmeinlwhixngednabhgy-2026-10-11T17-42-19-227127000Z.dump` |
| Meta | `…17-42-19-227127000Z.meta.json` |
| Size | **587358** bytes |
| TOC | **938** |
| TOC includes | `profiles`, `store_profiles`, `store_specialists` |
| Client | `pg_dump (PostgreSQL) 17.11 (Homebrew)` |

**Rollback:** restore from this dump (authorized separately). App rollback not required for this SQL-only change. Do not roll app before `4fd914d` (scrypt verify).

---

## Cleanup execution result

SQL: `scripts/sql/sec-ops-007-legacy-mirror-cleanup.sql`

| Step | Result |
|------|--------|
| First attempt (`pin = null`) | **ROLLBACK** — `profiles.pin` / `store_profiles.pin` are **NOT NULL** |
| Corrected clear | `pin = ''` (non-secret, non-digit); `pin_code`/`pin_hash` = NULL where nullable |
| Pre-gates | profiles=1 / store_profiles=1 / master scrypt=1 |
| Rows updated | **1** profiles + **1** store_profiles |
| Post-gates in txn | digit counts 0; identities preserved; master scrypt1 |
| Transaction | **COMMIT** |

MasterAdmin `store_specialists` credential **not modified**. Operator PIN **not changed**.

---

## Post-cleanup inventory

| Table | Digit-shaped | scrypt1 | Row existence |
|-------|-------------:|--------:|---------------|
| `store_specialists` | **0** | **1** | Master `f9e36630…` active / 2587 |
| `profiles` | **0** | 0 | `0f3b20ce…` still present; role/store/specialist_id unchanged; `pin=''`; `pin_code`/`pin_hash` null |
| `store_profiles` | **0** | 0 | `0b7d86d3…` still present; role/store/username unchanged; `pin=''`; `pin_code` null |

---

## MasterAdmin preservation

| Field | Result |
|-------|--------|
| Id | `f9e36630-9793-40cd-9d3c-53b5ee450b1c` |
| Role / store / status | `MasterAdmin` / `2587` / `active` |
| Credential shape | **scrypt1** / **scrypt1** |
| PIN value | **unchanged** |

---

## Authentication verification

| Check | Result |
|-------|--------|
| `/` | **307** → `/login` |
| `/login` | **200** |
| `/dashboard` | **307** → `/login` |
| hub-bridge empty / bad PIN | **400** / **401** |
| bootstrap unauth | **401** |
| Anon containment (bay logs / exceptions / specialists / profiles) | **401** `42501` |
| Rate-limit RPC attempt+clear | **operational** |
| Operator interactive login | **NOT PERFORMED — MANUAL VERIFICATION REQUIRED** |

---

## Remaining security risks

1. `profiles.pin` / `store_profiles.pin` remain NOT NULL with empty-string clear — writers that send `pin: null` may fail on mirror sync until adapted to `''` or schema softened (follow-on; not this tranche).  
2. Plaintext verify fallback still enabled in app.  
3. Operator login against live scrypt credential still needs manual confirmation.  
4. Historical dumps retain pre-clear digit values offline.

---

## Plaintext fallback retirement readiness

`DEPTSYNC_ALLOW_PLAINTEXT_PIN_VERIFY` was **not** disabled. Legacy verify code was **not** removed.

| Prerequisite (SEC-OPS-005) | Status |
|----------------------------|--------|
| SEC-OPS-005 writers deployed | **Yes** (SEC-OPS-006) |
| Digit inventory = 0 on specialists + profiles + store_profiles | **Yes** (this tranche) |
| Operator login verified against scrypt | **Pending manual** |
| Separate authorization for env flag + code removal | **Not granted here** |

**Verdict:** Inventory prerequisite **satisfied**. Overall fallback retirement remains **CONDITIONAL GO** for a **separate** authorized tranche after manual operator login confirmation — **NO-GO to disable now**. Zero-row digit inventory alone is not sufficient.

---

## GO / NO-GO assessment

| Action | Verdict |
|--------|---------|
| Legacy mirror credential cleanup | **GO — COMPLETE** |
| Disable plaintext PIN verify now | **NO-GO** |
| MasterAdmin PIN / account changes | **NO-GO** / not performed |
| App deploy in this tranche | **N/A** (not authorized; not performed) |

**Overall:** Obsolete plaintext mirrors cleared. Canonical Master scrypt preserved. Next authorized security step: manual operator login confirm, then plaintext-fallback retirement tranche.
