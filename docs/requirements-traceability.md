# Requirements Traceability Matrix

Status values: **built**, **partial**, **not started**. Every "built" row
cites the file that implements it. Every requirement not listed as built is
deliberately deferred — see `implementation-plan.md` for phasing.

## Foundation remediation (Part X)

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| REM-001 | No accounting policy in presentation code | built | `entities`, `entity_bank_accounts` tables (`db/schema.ts`); no literal balances/account numbers in `app/` |
| REM-002 | Server-side CSV ingestion | built | `app/api/imports/route.ts`, `lib/rawFileStore.ts` |
| REM-003 | No writes on GET; no auto-seeded live totals | built | All mutating routes are `POST`; `db/seed.ts` seeds only `unverified` entities and a `draft`-status dev Xero app |
| REM-004 | Balance date vs. import time separated | built | `bank_balance_snapshots.balanceDate` vs. `bank_imports.fileReceivedAt/processedAt` |
| REM-005 | Raw source + lineage preserved | built | `bank_imports.sourceFileKey/sourceFileChecksum/parserVersion`, `bank_balance_snapshots.sourceRowRef` |
| REM-006 | No duplicate constants | built | single schema source of truth in `db/schema.ts` |
| REM-007 | Money/date primitives | built | `lib/money.ts`, `lib/dates.ts` |

## Xero app registry, auth, routing (Parts VI-VIII)

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| §7.3 | Xero app registry | built (single app) | `xero_apps` table, `db/seed.ts` |
| §7.6 | Multi-app entity allocation rules | partial | `entity_xero_app_assignments` enforces one active assignment per entity/purpose (`app/api/xero/assignments/route.ts`); only one app exists so multi-app spillover/capacity rules are unexercised |
| §8.2-8.7 | OAuth flow, state, secret resolution | built | `app/api/xero/apps/[appKey]/oauth/start`, `app/api/xero/oauth/callback`, `lib/xero/appRegistry.ts` |
| §8.5 | Token-refresh concurrency lock | **not started** | `lib/xero/gateway.ts` refreshes without a Durable Object/D1 lease — documented gap |
| §8.6 | Token encryption | partial | AES-256-GCM via Node `crypto`, key-version envelope (`lib/xero/crypto.ts`); needs Web Crypto port for Workers |
| §9.6 | Production compliance gate | **not started** | No `XERO_MULTI_APP_ENABLED` flag or compliance-status enforcement at runtime yet; `compliance_status` column exists but nothing reads it |
| §10.1 | Xero app router (fail closed) | built | `lib/xero/gateway.ts::resolveXeroRoute` |

## Module A — Cash Position (Part XIII §18)

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| CASH-001 | Preserve existing cash dashboard | n/a | no pre-existing dashboard found (see current-state-audit.md) |
| CASH-002 | Loans excluded from available cash | built | `entity_bank_accounts.isLoanFacility`, filtered in `app/api/cash-position/route.ts` |
| CASH-003 | Source-date integrity | built | `oldestSourceDate` per row and overall in cash-position response |
| CASH-004 | Xero-to-bank variance | built | `app/api/cash-position/route.ts` (Bank Summary report vs. latest snapshot) |
| CASH-005 | Configurable exception thresholds | **not started** | no threshold config table/UI yet |
| CASH-006 | Variance evidence view | partial | variance shown with dates and amounts; no drill-through to source sync/import run in the UI yet |

## Everything else (Modules B-L, Parts XIV-XVIII)

**Not started.** Board reporting, P&L/budget variance, balance-sheet
substantiation, rules/exceptions, intercompany reconciliation, GST audit,
debt/lender view, attachments/extraction, AI assistance, controlled
write-back, payroll timesheets, UI roles/permissions, security hardening
beyond token encryption, observability/alerting, and the full test/gate
strategy in Part XVII are all future phases. See `implementation-plan.md`.
