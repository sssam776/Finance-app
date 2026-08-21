# Phase 0 — Current-State Audit

## Repository state at session start

The repository (`sssam776/Finance-app`) contained no commits and no files
other than `.git`. **This contradicts the master spec's working assumption
of an existing Ramwall Cash Position application to extend** (spec §0,
§1.1, REM-001 through REM-007, CASH-001). There was no React UI, no
Next.js/Cloudflare/D1 configuration, no ASB/BNZ import code, no hard-coded
account numbers to remove, and no prior authentication layer to inspect.

**Status: verified in code** — confirmed by `git status` and `ls -la`
returning an empty tree before this session's commits.

Because the foundation-remediation items (REM-001..007) describe fixing
problems in an app that does not exist here, this build treats the project
as **greenfield**, not brownfield. The remediation *principles* (no
hard-coded accounting policy in components, server-side CSV ingestion, no
writes on GET, source-date/import-time separation, preserved lineage, no
duplicate constants, decimal money/date primitives) were followed from the
first commit instead of being retrofitted — see the schema and `lib/`
modules built in this session.

If an existing Ramwall Cash Position app exists in a different repository
or branch that was not attached to this session, say so before the next
phase — the intended remediation work (REM-001..007 as literally written)
still needs to happen against that codebase, and it should not be
silently abandoned in favour of this greenfield build.

## Stack decision for this quick version

| Spec requirement | This build | Status |
|---|---|---|
| Next.js 16, React 19, TypeScript | Next.js 15.5 (latest stable at build time), React 19, TypeScript strict | **verified in code** — React 19 available; Next.js 16 not yet released to npm at build time |
| Cloudflare D1 | Drizzle ORM against local SQLite (better-sqlite3) | **unverified — decision required**: schema is D1-dialect-compatible (see ADR-002) but not deployed to a Worker yet |
| Cloudflare R2 | Local disk (`lib/rawFileStore.ts`) | **unverified — decision required**: same reasoning as D1 |
| Cloudflare Web Crypto for token encryption | Node `crypto` AES-256-GCM (`lib/xero/crypto.ts`) | **unverified — decision required**: same envelope shape, swap implementation before deploying to a Worker |
| Durable Object token-refresh lock | Not implemented | **unverified — decision required**: no concurrent-refresh protection yet; single-user quick version accepted this gap explicitly |

These are pragmatic, documented deviations to get a working vertical slice
in front of the Financial Controller quickly, not silent scope-cuts — each
is logged as an open decision in the ADRs and traceability matrix.

## What was built in this session (Phase 0 + first vertical slice)

- Entity registry (`entities`, `entity_bank_accounts`), seeded with the
  spec §7.1 candidate list, all rows `status='unverified'` pending
  confirmation of which legal entities have a separate Xero organisation.
- Money and date primitives (`lib/money.ts`, `lib/dates.ts`) — Decimal.js,
  no floating point, NZ timezone display, date-only vs. timestamp
  separation (REM-007, §15, §16).
- Server-side CSV ingestion for ASB/BNZ-style exports (`lib/csv/parseBankCsv.ts`,
  `app/api/imports/route.ts`) — raw file stored by checksum first, parsed
  server-side, replayable, no live totals seeded (REM-002, REM-003, REM-004,
  REM-005).
- Xero app registry (`xero_apps`), single development Starter app seeded
  with `compliance_status='draft'` and `read_core_v1` scopes only — no
  write scopes exist anywhere in this build (§9.4, non-negotiable rule).
- Full OAuth authorization-code flow (`/api/xero/apps/[appKey]/oauth/start`,
  `/api/xero/oauth/callback`) resolving the app from a one-time, ten-minute
  state record — never from a free-form query parameter (§8.7).
- Encrypted token storage with a key-version envelope (§8.6).
- A `XeroCallContext`-equivalent route resolver (`lib/xero/gateway.ts`
  `resolveXeroRoute`) that fails closed on zero or multiple active
  assignments and never lets a write/payroll purpose fall back to
  `read_core` (§10.1, §7.6).
- Minimal read sync (Accounts + Bank Summary report) with full lineage
  (`xero_app_id`, `connection_id`, `tenant_id`, `sync_run_id`) on every
  synced row (§10.5).
- Cash Position dashboard: bank balance vs. Xero balance variance, oldest
  source-date banner, loan facilities excluded from available cash
  (CASH-001 through CASH-006).

## What was explicitly not built (see implementation-plan.md)

Board/management reporting, P&L variance, balance-sheet substantiation,
rules/exceptions engine, intercompany reconciliation, GST audit, debt/lender
view, attachments/extraction, AI assistance, controlled write-back, payroll
timesheets, multi-app router/compliance gate, and all Cloudflare deployment
work. None of these have any code, stub, or placeholder table in this
build — they are listed as roadmap items, not half-implemented.
