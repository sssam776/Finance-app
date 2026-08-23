# Ramwall Finance Control — quick version

A first vertical slice of the Ramwall Group Xero Finance Automation
platform: entity registry, ASB/BNZ bank CSV import, a single read-only
Xero app connection, and a Cash Position dashboard comparing bank balances
to Xero balances.

Built against `docs/Ramwall_Xero_Finance_Automation_Master_Build_Spec_v4_Multi_App.md`.
Read `docs/current-state-audit.md` first — the repository was empty when
this build started, so this is greenfield work following the spec's
engineering rules, not a remediation of an existing app.

## Run it locally

```bash
npm install
cp .env.example .env.local   # fill in Xero credentials + encryption key
npx tsx db/migrate.ts
npx tsx db/seed.ts           # prints the generated admin password — save it
npm run dev
```

The seed creates the first admin account from `ADMIN_EMAIL` (default
`admin@ramwall.local`). Leave `ADMIN_INITIAL_PASSWORD` blank and it generates
a random password and prints it **once** — only the scrypt hash is stored, so
it cannot be recovered afterwards. Re-running the seed never resets an
existing account's password.

Open http://localhost:3000 and sign in. Pages:

- **Cash Position** (`/`) — bank vs. Xero balance variance, exceptions
  flagged against the configured threshold, and per-row drill-through to the
  bank import and Xero sync run behind each figure.
- **Entities** (`/entities`) — the seeded (unverified) entity list, bank
  account mappings, and a manual "sync now" trigger.
- **Bank Imports** (`/imports`) — upload an ASB/BNZ CSV export.
- **Xero Connections** (`/xero`) — connect a Xero organisation and assign
  it to an entity.

## Access control

Two roles. `viewer` reads every page; `admin` can additionally import
statements, map bank accounts, connect Xero organisations, assign connections
and change variance thresholds. Every write is recorded in `audit_events`
against the signed-in user — actor identity is never taken from a request
body or form field.

`middleware.ts` redirects signed-out browsers to `/login`, but it is not the
security boundary: it runs on the Edge runtime and can only see whether a
cookie exists. Each API route resolves the session itself and rejects a
forged or expired one.

There is no change-password or reset flow yet, and `/api/auth/login` is
audited but not rate-limited. Both are tracked in
`docs/implementation-plan.md`.

## What's real vs. what's a placeholder

Everything above runs against real code paths (real Xero OAuth, real CSV
parsing, real SQLite persistence) — nothing is mocked. What's *not* built
yet, and why, is tracked in `docs/requirements-traceability.md` and
`docs/implementation-plan.md`. In short: this is Cash Position only
(spec Module A); board reporting, GST, intercompany, write-back and payroll
are future phases, and the app currently runs on local SQLite/disk rather
than Cloudflare D1/R2 (see `docs/architecture-decision-records/ADR-002-cloudflare-xero-sdk.md`
for the migration path).

## Testing

```bash
npm run typecheck
npm test
npm run build
```

## Third-party code

Uses the official `xero-node` SDK (MIT licence) for OAuth and the
Accounting API — see `THIRD_PARTY_NOTICES.md`.
