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

Two axes. **Role** decides what you may do: `viewer` reads, `admin` can also
import statements, map bank accounts, connect Xero organisations, assign
connections and change variance thresholds. **Entity permissions** decide
which entities you may do it to.

The scoping rule: an explicit grant is authoritative for that user whatever
their role, so granting an admin one entity restricts them to it. With no
grants at all, an admin sees every entity and a viewer sees none. The
asymmetry is deliberate — a freshly seeded system has one admin and no grants,
and that admin has to be able to set it up, whereas nobody has yet decided
what a new viewer should see.

Every write is recorded in `audit_events` against the signed-in user. Actor
identity is never taken from a request body or form field.

Failed logins are throttled: five in fifteen minutes returns 429 until the
oldest attempt ages out. Changing your password on `/account` signs out your
other sessions.

`middleware.ts` redirects signed-out browsers to `/login`, but it is not the
security boundary: it runs on the Edge runtime and can only see whether a
cookie exists. Each API route resolves the session itself and rejects a
forged or expired one.

There is no out-of-band password reset: a user who forgets theirs needs an
admin. Tracked in `docs/implementation-plan.md`.

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

The unit tests cover the pure rules. The scripts in `scripts/` drive the real
routes against a running server, which is the only way to check that
middleware, cookies, roles and entity scoping behave together:

```bash
npm run dev                                          # in another terminal
npx tsx scripts/verify-http.ts   <admin-password>    # auth boundary
npx tsx scripts/verify-cash.ts   <admin-password>    # cash position, add --keep to leave demo data
npx tsx scripts/verify-access.ts <admin-password>    # entity scoping, rotation, throttling
```

Each script removes the data it creates.

## Third-party code

Uses the official `xero-node` SDK (MIT licence) for OAuth and the
Accounting API — see `THIRD_PARTY_NOTICES.md`.
