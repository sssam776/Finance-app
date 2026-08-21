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
npx tsx db/seed.ts
npm run dev
```

Open http://localhost:3000. Pages:

- **Cash Position** (`/`) — bank vs. Xero balance variance.
- **Entities** (`/entities`) — the seeded (unverified) entity list, bank
  account mappings, and a manual "sync now" trigger.
- **Bank Imports** (`/imports`) — upload an ASB/BNZ CSV export.
- **Xero Connections** (`/xero`) — connect a Xero organisation and assign
  it to an entity.

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
