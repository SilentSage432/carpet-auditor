# UX-REDUCE-005 — More → Setup & Administration

> **Mode:** Authorized information-architecture tranche.  
> **Baseline:** `main @ f5d5648` — PERF-LOAD-002 (Samsung field-accepted).  
> **Date:** 2026-09-18  
> **Samsung visual acceptance:** Pending.

---

## Governing laws

1. **More contains setup and administration, not everyday operations.**
2. **Operational complexity belongs behind progressive disclosure.**
3. **Complexity underneath must earn simplicity above.**
4. **Authority does not imply visual prominence** (Master capability ≠ everyday chrome).

Accepted shell identities remain:

| Tab | Job |
|-----|-----|
| Floor | Who has what this week? |
| Map | Where are we across the department? |
| Roster | Who do I have, and when are they scheduled? |
| **More** | **Configure and administer DeptSync.** |

PERF-LOAD-002 remains locked: More mounts only on first visit.

---

## Final information architecture

```text
More
  Floor Pad                          [DS + Master] PROTECTED
  Department Setup                   [map console]
    └─ Aisles & bays (accordion)     topology mutation
  Rotation Setup                     [Master]
    └─ Seasonal Context              PROTECTED cadence input
  Device & Account                   [all More users]
    └─ sync / PIN / theme / push
  Master Admin                       [Master, collapsed]
    └─ weekly targets (legacy)
    └─ Sunday schedule
    └─ fiscal coverage signal
    └─ Advanced recovery (Force)
    └─ catalog taxonomies (legacy)
    └─ store number
```

---

## Mounted-surface classification (HEAD → disposition)

| Control | Role | Runtime consumer | Classification | Disposition |
|---------|------|------------------|----------------|-------------|
| Floor Pad / Walk & Talk | DS+Master | Floor Pad hash/intent | PROTECTED | KEEP PRIMARY |
| AisleBayManager | DS+Master map console | `store_locations` topology | CORE SETUP | KEEP PRIMARY (Department Setup) |
| Seasonal Context (`OperationalContextCard`) | Master | ENGINE-PROD-004 selector + Floor/Map resolve | PROTECTED | KEEP PRIMARY (Rotation Setup) |
| Weekly bay targets matrix | was DS+Master UI | `departments.weekly_bay_target` (legacy/admin; auto plan = 3/person) | ADVANCED / LEGACY | MOVE MASTER ADVANCED |
| Sunday schedule | Master | `stores` auto-stage time/tz | ADVANCED | MOVE MASTER ADVANCED |
| Force / Generate this week | Master | ForceRotationModal recovery | ADVANCED / RECOVERY | MOVE MASTER ADVANCED |
| Fiscal coverage card | Master | FS-001A diagnostic; Floor strip still *reads* fiscal calendar | ADVANCED | MOVE MASTER ADVANCED (no schema delete) |
| Catalog taxonomies | Master | TaxonomyManagerModal; specialty/audit residue | LEGACY CANDIDATE | MOVE MASTER ADVANCED → UX-REDUCE-006 |
| Store number | Master | local store pin | DEVICE / ACCOUNT (Master) | MOVE MASTER ADVANCED |
| Device sync / PIN / theme / push | signed-in | sync-queue, auth session | DEVICE / ACCOUNT | KEEP PRIMARY |
| Appliance/remnant local cache counts | diagnostics | offline specialty caches | LEGACY CANDIDATE (labels) | DEMOTE inside Device accordion (kept as clearable offline residue) |
| Specialty launchers (Appliances, remnants, cycle audit) | — | already disconnected REDUCE-004 | LEGACY | REMOVE MOUNT ONLY (already) |

---

## Role behavior

- **Associate:** no More tab (unchanged simplified shell).
- **DS:** Floor Pad, Department Setup (aisles & bays), Device & Account. No Master machinery, no weekly-target matrix, no Force, no Seasonal write UI (Seasonal remains Master-declared).
- **Master:** same clean primary surface + Rotation Setup (Seasonal) + collapsed Master Admin.

---

## Progressive fetch

- Topology `fetchDepartmentsDetailed` / locations load only when Aisles & bays opens or Master Admin / Force / Taxonomy needs the graph.
- Master Admin children (targets, Sunday, fiscal, Force entry, taxonomies, store #) mount only when the section is expanded (or hash deep-link expands it).
- Seasonal Context mounts with primary Rotation Setup for Master (authorized cadence config).
- Heavy admin widgets use `next/dynamic`.

---

## Explicitly unchanged

Floor, Map, Roster, WorkflowTabShell visit-on-demand, Sunday cron, ENGINE-PROD-002/003/004, seasonal selector semantics, quota (3/person), verification, TIME-DUTY, BAY-UNIT, auth/RLS, schema, Floor Pad Gemini, SpecialtyToolsHost dormancy.

---

## UX-REDUCE-006 candidates (mount already demoted)

1. Catalog taxonomy manager + remaining taxonomy writers  
2. Specialty offline cache chrome (appliance/remnant counts) if specialty runtime retires  
3. Fiscal *admin* card if Floor fiscal read path is later retired/simplified  
4. Legacy weekly_bay_target UI if product drops matrix entirely (schema later)  
5. SpecialtyToolsHost dormant scanners/calculators  

Do not begin UX-REDUCE-006 in this tranche.
