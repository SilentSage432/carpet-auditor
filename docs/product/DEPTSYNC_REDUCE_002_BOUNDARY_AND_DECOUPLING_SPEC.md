# DEPTSYNC-REDUCE-002 — Canonical Product Boundary & Safe Decoupling Spec

**Status:** BOUNDARY LOCKED (docs) · **Amended by:** [REDUCE-002A](./DEPTSYNC_REDUCE_002A_FLOOR_PAD_PROTECTION.md) · [REDUCE-003A](./DEPTSYNC_REDUCE_003A_SEASONAL_CONTEXT_PROTECTION.md)  
**Date:** 2026-09-15  
**Git baseline at archaeology:** `05b0dc4`  
**Authority:** Beneath `DEPTSYNC_CONSTITUTION.md`. Implementation not authorized by this document alone.

This file is the repository-canonical lock of the REDUCE-002 design tranche (originally delivered in session) **as amended by REDUCE-002A (Floor Pad) and REDUCE-003A (Seasonal Context)**.

---

## 1. Canonical product definition

> **DeptSync is an intelligent continuous-coverage rotation system that helps a Department Supervisor select, distribute, verify, and remember recurring aisle/bay coverage across a merchandising workforce — without replacing Lowe’s task workflow.**

Product character: a quiet, stubborn coverage instrument for physical merchandising environments. Not a broad store-operations platform. Not required for every department.

Canonical Lowe’s boundary (Art. II):

> DeptSync manages the rotation; Lowe’s manages the task; the DS validates the work.

---

## 2. Constitutional posture

| Article | Stance |
|---------|--------|
| I–II, V–VI, XIII–XXI | Reduction aligns; specialty **MAY** (XII / II.1) is optional — retirement of OOS specialty **complies** without amendment |
| Soft amendment recommended (separate docs tranche) | Clarify Art. I identity toward rotation thesis; specialty as optional extension |
| VII–X | Intelligence may interpret; must not manufacture. Gemini is not authority |

---

## 3. Surviving model (summary)

Store · department · topology · eligibility · roster · schedules/labor · coverage cycle · weekly staging · assignment · barriers/carryover · verification · coverage memory · deterministic selection/cadence · **seasonal context (cadence evidence)** · Floor primary · Map (geography) · Roster · More (config).

**Three separated pipeline concerns:**

1. **Coverage selection** — which bays this week (`rotations.ts` / cron / Force Draw)  
2. **Weekly workforce allocation** — who owns them (`sunday_bay_assignments` + future week-labor Balance Assign)  
3. **Shift-aware surfacing** — current expected availability is derived from persisted `associate_shift_days` + store-local time (TIME-DUTY-002: On now / Later today / Off / Called out). Weekly ownership stays; not Lowe's punch/attendance. Do not Monday-dump.

Schedule-aware allocation remains a **future CORE** correction (LAB-001 fold), not a specialty issue.

---

## 4. Specialty / capability dispositions (post–REDUCE-002A)

| Capability | Disposition |
|------------|-------------|
| Appliances + APP-UPC | **OUT OF SCOPE** — disconnect/retire after sync-queue + Floor/Zebra decouple; schema dormant; APP-UPC workspace **protected** until historical git capture then explicit retirement |
| Flooring **department** rotation | **CORE** — keep |
| Flooring cycle audit / remnants / generic dept audit | **OUT OF SCOPE** — retire after nav disconnect |
| Enterprise `/api/v1/*` stubs | **RETIRED (REDUCE-003)** — routes + Zod contracts + transport deleted; no schema |
| Visual Bay Scan (ephemeral) | **Retirement candidate** (mounts first); keep `bay_audit_logs` dormant; **do not remove Map seasonal badges with Snap** |
| Predictive Copilot banner | **Disconnect candidate** (reads CORE; not required) |
| **Seasonal Context / seasonality intelligence** | **KEEP / PROTECTED — ROTATION CADENCE INPUT** ([REDUCE-003A](./DEPTSYNC_REDUCE_003A_SEASONAL_CONTEXT_PROTECTION.md)) |
| **Seasonal UI** | **PROTECTED FROM GENERIC DELETION**; presentation may be reconsidered in later rotation UI simplification |
| **Walk & Talk** | **PROTECTED — ROTATION OBSERVATIONAL CAPTURE EVALUATION PENDING** |
| **Executive Floor Pad** | **PROTECTED — ROTATION OBSERVATIONAL CAPTURE EVALUATION PENDING** |
| **TacticalVoiceFloorPad** | **PROTECTED** until FLOORPAD-001 resolves ownership |
| **Floor Pad intents / SpecialtyToolsHost Floor-Pad seam** | **PROTECTED from accidental deletion** in early reduction; host is **not** wholly CORE — other children (appliance/remnant) may still retire |
| Gemini transport | **Not globally KEEP** — cannot be **fully** retired until FLOORPAD-001 decides whether AI interpretation earns a place; **unrelated consumers may still be removed independently** |

---

## 5. Safe reduction sequence (amended)

| # | Tranche | Notes |
|---|---------|--------|
| 0 | Boundary lock (this doc + 002A) | Docs |
| 1 | Delete enterprise stubs | **DONE — REDUCE-003** (routes + contracts removed; no schema) |
| 2 | Nav/UI disconnect of **non-protected** OOS (appliances, cycle audit, remnants, Visual Bay mounts, Predictive, etc.) | **DONE — REDUCE-004** (mount/link disconnect; runtime dormancy; must not remove Walk & Talk / Floor Pad / Seasonal Context) |
| 3 | Sync-queue specialty leak break (`physical-audit` import) | Required before appliance code delete |
| 4 | APP-UPC git capture (commit privacy history) | Before appliance runtime delete |
| 5 | Specialty runtime retirement batches | **EXCLUDE** protected Walk & Talk / Floor Pad / TacticalVoiceFloorPad / Floor Pad intent infrastructure / Gemini transport **required by** Floor Pad / **Seasonal Context runtime+schema+required presentation** until FLOORPAD-001 (Floor Pad) — seasonality has no retirement gate; keep |
| 6 | Host/shell cleanup | Only after protected evaluation or confirmed unused seams |
| 7 | Schedule-aware allocation | CORE future |
| 8 | Field proof of rotation thesis | Multi-week |

**FLOORPAD-001** is the decision gate before any Floor Pad retirement or redesign. See [REDUCE-002A](./DEPTSYNC_REDUCE_002A_FLOOR_PAD_PROTECTION.md).  
**Seasonal Context** has no retirement gate under reduction — see [REDUCE-003A](./DEPTSYNC_REDUCE_003A_SEASONAL_CONTEXT_PROTECTION.md).

---

## 6. Shared seams (unchanged from REDUCE-002)

- `sync-queue` → `mayBindScanToAuditSession` leak: **block appliance deletion** until decoupled (smallest local separation; no plugin framework).  
- `SpecialtyToolsHost`: surgical — protect Floor Pad seam; retire other children.  
- `ShiftAnalyticsDrawer`: may lose OOS children **except** protected Walk & Talk / Floor Pad until FLOORPAD-001.  
- `hardware-scanner`: keep until last scan form retired.  
- `bay_audit_logs`: historical dormant — no DROP.  
- No immediate specialty schema drops.  
- APP-UPC: prefer commit-then-retire over discard-uncommitted.

---

## 7. Final test

Every surviving capability must answer:

> How does this help DeptSync intelligently select, distribute, verify, remember, or continuously rotate physical aisle/bay coverage?

**Protected Floor Pad exception:** it is retained for **evaluation** of observational capture that may feed confirmed evidence into that pipeline — not as proven CORE yet, and not as unconstrained AI.

Infrastructure may answer: what surviving capability fails without me?

---

*End of REDUCE-002 (as amended by REDUCE-002A).*
