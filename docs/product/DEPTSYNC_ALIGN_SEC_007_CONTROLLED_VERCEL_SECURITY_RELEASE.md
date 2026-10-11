# DEPTSYNC-ALIGN-SEC-007 — Controlled Vercel Security Release

**Status:** LOCAL COMMIT PREPARED  
**Date:** 2026-10-10  
**Push / Vercel deploy / production mutation:** NOT AUTHORIZED by this document  

## Scope

Single reviewable release packing ALIGN-002 ratification + ALIGN-SEC-001…006 security stabilization (implementation, tests, env docs, read-only RLS script, recovery protection).

## Operator-confirmed Production env (values never accessed here)

`HUB_GATE_SECRET`, `BOOTSTRAP_SECRET`, `HUB_MASTER_PIN`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`.

## Migration

**None required** for deploy. Schema seed PIN removal affects fresh `schema.sql` applies only — not live Production rows. Optional post-deploy bootstrap rewrite hashes Master `pin_code` (operator-authorized separately).

## SEC-004 note

ALIGN-SEC-004 was a read-only Master PIN dependency investigation (no separate product doc / no code). Findings absorbed into SEC-003/005/006.

## Boundary

Authorized: local verification + one local commit.  
Not authorized: push, deploy, Production SQL, bootstrap execution, credential rotation.
