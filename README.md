# Ramwall Finance Control

A finance control platform for the Ramwall Group: entity registry, ASB/BNZ
bank CSV import, read-only Xero connections, Cash Position, P&L movement,
balance-sheet reconciliation, and the canonical portfolio layer that the CFO
dashboard will be built on.

**Start with [`docs/phase-status.md`](docs/phase-status.md)** — it states, phase
by phase, what is built, what is partial, and what has not been started. A
table with no rows in it is not recorded there as a working feature.

Two specifications govern this work, and they do not agree on ordering:

- `docs/Ramwall_Xero_Finance_Automation_Master_Build_Spec_v4_Multi_App.md` —
  the original Xero automation spec that the built modules follow.
- `docs/Ramwall_Finance_Platform_Rebuild_Spec.md` and
  `docs/Ramwall_CFO_Dashboard_Architecture.md` — the later rebuild, which
  widens scope to the CFO portfolio dashboard and **moves Xero to the last of
  six phases**. Phase 1 is the canonical data layer, not the dashboard.

Read `docs/current-state-audit.md` for how this started — the repository was
empty, so this is greenfield work following the spec's engineering rules, not
a remediation of an existing app.

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

If you lose the admin password, `npx tsx scripts/reset-admin-password.ts`
generates a new one, prints it once and revokes that user's sessions. Local
development databases only.

Open http://localhost:3000 and sign in. Pages:

- **Cash Position** (`/`) — bank vs. Xero balance variance, exceptions
  flagged against the configured threshold, and per-row drill-through to the
  bank import and Xero sync run behind each figure.
- **P&L Movement** (`/variance`) — month against prior month or the same month
  last year, with favourable/adverse judgement and commentary.
- **Balance Sheet** (`/reconciliation`) — trial-balance accounts against what
  substantiates them, and period locking.
- **Entities** (`/entities`) — the seeded (unverified) entity list, bank
  account mappings, and a manual "sync now" trigger.
- **Bank Imports** (`/imports`) — upload an ASB/BNZ CSV export.
- **Xero Connections** (`/xero`) — connect a Xero organisation and assign
  it to an entity.

Two development Xero apps are seeded, each with its own credentials and its own
five-connection Starter limit. Which app an organisation connects through is
chosen on `/xero`; there is deliberately no automatic spillover when one fills
up (spec 7.6.2). Note that spec 3.3 treats a second same-purpose Starter app as
a free-tier workaround rather than a supported capacity strategy, and the
production compliance gate refuses it — these registrations are development
only.

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
parsing, real SQLite persistence) — nothing is mocked.

The honest summary, with the full breakdown in
[`docs/phase-status.md`](docs/phase-status.md):

- **Working:** authentication and per-entity access control, bank import, Cash
  Position variance, P&L movement, balance-sheet reconciliation, and the Xero
  read layer.
- **Schema and calculations only:** the portfolio layer — properties, lenders,
  facilities, security pools, valuations, NOI and covenant rules. The tables
  exist and the LVR, headroom, debt yield and interest-cover engines are
  tested, but there is no API, no screen and no data in them.
- **Not started:** the CFO dashboard itself, the sell-and-redeploy model, and
  the cash-flow forecast.
- **Never run against real data:** no Xero organisation has been connected, so
  two report-parsing assumptions remain unconfirmed. Both degrade to no-match
  rather than to a wrong number.

The app runs on local SQLite and disk rather than Cloudflare D1/R2 — see
`docs/architecture-decision-records/ADR-002-cloudflare-xero-sdk.md` for the
migration path. **It needs a persistent disk**, so it will not run on Vercel,
Netlify or Cloudflare Workers as written.

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
npm run dev                                                  # in another terminal
ADMIN_PASSWORD=... npx tsx scripts/verify-http.ts             # auth boundary
ADMIN_PASSWORD=... npx tsx scripts/verify-cash.ts             # cash position, --keep leaves demo data
ADMIN_PASSWORD=... npx tsx scripts/verify-access.ts           # entity scoping, rotation, throttling
ADMIN_PASSWORD=... npx tsx scripts/verify-variance.ts         # P&L movement
ADMIN_PASSWORD=... npx tsx scripts/verify-reconciliation.ts   # balance sheet
```

Each script removes the data it creates, and refuses to run against anything
but a local development database. Prefer `ADMIN_PASSWORD=` over passing the
password as an argument — an argument is visible in shell history and in the
local process list.

Run the suite under UTC as well as your own timezone:

```bash
TZ=UTC npx vitest run
```

That is not redundant. One date defect reproduced only under UTC and would have
been wrong by up to a day on any UTC host.

## Third-party code

Uses the official `xero-node` SDK (MIT licence) for OAuth and the
Accounting API — see `THIRD_PARTY_NOTICES.md`.
