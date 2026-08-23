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
| §8.5 | Token-refresh concurrency lock | built | Compare-and-swap on `xero_authorizations.refresh_version` in `lib/xero/gateway.ts` — exactly one caller may move the version from N to N+1, so exactly one caller refreshes; losers wait for that result via `awaitPeerRefresh`. Becomes the same CAS against D1 on Cloudflare (ADR-002), so no Durable Object is required |
| §8.6 | Token encryption | partial | AES-256-GCM via Node `crypto`, key-version envelope (`lib/xero/crypto.ts`); needs Web Crypto port for Workers |
| §9.6 | Production compliance gate | built (single-app scope) | `lib/xero/compliance.ts`, enforced in `lib/xero/appRegistry.ts::buildXeroClient` — the one choke point every Xero call passes through. Checks `enabled`, terminal statuses in all environments, and in production: `compliance_status='approved'`, operational owner, scope profile, approval reference, and `XERO_MULTI_APP_ENABLED` consistency with the enabled production app count. The "successful app-routing and tenant-isolation test run" condition is **not** machine-checked — there is no test-run record to read |
| §10.1 | Xero app router (fail closed) | built | `lib/xero/gateway.ts::resolveXeroRoute` |

## Identity and access (Part XI §15.1)

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| §15.1 | Authenticated users | built | `users` table; scrypt password hashing in `lib/auth.ts` (Node stdlib, no native dependency); first admin created by `db/seed.ts` from `ADMIN_EMAIL`/`ADMIN_INITIAL_PASSWORD`, with a generated password printed once and never reset by re-seeding |
| §15.1 | Sessions | built | `sessions` table keyed by the SHA-256 of the token, so the raw token exists only in the user's httpOnly cookie; 8-hour TTL; disabled users lose access on their next request, not their next login |
| §15.1 | Actor identity on every write | built | `lib/session.ts::requireSession` — reads take `viewer`, writes take `admin`. No route accepts an actor email from a request body or form field any more; `audit_events.actor_email` is now always the signed-in user |
| §15.1 | Roles | partial | Two roles (`admin`, `viewer`) gate read vs. write. `entity_permissions` — per-entity scoping, so a user can be admin for one entity and have no access to another — is **not started** |

**Known limitation:** `middleware.ts` only checks that a session cookie is
present, because Next.js middleware runs on the Edge runtime and cannot reach
SQLite. It is a redirect for signed-out browsers, not an authorisation check.
Every API route independently resolves the session and rejects a forged or
expired cookie. Do not move an authorisation decision into middleware.

## Module A — Cash Position (Part XIII §18)

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| CASH-001 | Preserve existing cash dashboard | n/a | no pre-existing dashboard found (see current-state-audit.md) |
| CASH-002 | Loans excluded from available cash | built | `entity_bank_accounts.isLoanFacility`, filtered in `app/api/cash-position/route.ts` |
| CASH-003 | Source-date integrity | built | `oldestSourceDate` per row and overall in cash-position response |
| CASH-004 | Xero-to-bank variance | built | `app/api/cash-position/route.ts` (Bank Summary report vs. latest snapshot) |
| CASH-005 | Configurable exception thresholds | built | `variance_thresholds` table (entity row overrides the `"*"` group default), resolution and comparison in `lib/thresholds.ts`, read/write via `app/api/thresholds/route.ts`, edited on the Cash Position page. Breaching either the amount or the percent trigger flags an exception |
| CASH-006 | Variance evidence view | built | `app/api/cash-position/route.ts` returns the bank import (id, checksum, importer, receipt time, parser version, source row) and the Xero sync run (id, tenant, account, status, timings, records read) behind each figure; `app/page.tsx` renders them in an expandable evidence panel per row |

## Everything else (Modules B-L, Parts XIV-XVIII)

**Not started.** Board reporting, P&L/budget variance, balance-sheet
substantiation, rules/exceptions, intercompany reconciliation, GST audit,
debt/lender view, attachments/extraction, AI assistance, controlled
write-back, payroll timesheets, per-entity permissions, observability/alerting,
and the full test/gate strategy in Part XVII are all future phases. See
`implementation-plan.md`.
