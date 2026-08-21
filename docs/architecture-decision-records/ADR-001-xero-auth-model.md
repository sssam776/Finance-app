# ADR-001: Xero Authentication Model

## Status

Accepted for the quick version. Revisit before enabling a second Xero app
or write scopes.

## Context

Spec §8.1 requires one or more Xero Web App OAuth 2.0 authorization-code
registrations, because the server must securely hold client secrets and
the platform may connect multiple organisations. No existing auth model
was found in this repository (it was empty at session start), so this is
a fresh design decision, not a migration.

## Decision

- One Xero app registration (`ramwall_read_core_dev`, environment=`development`,
  purpose=`read_core`, tier=Starter, `compliance_status='draft'`), seeded
  in `db/seed.ts` and stored in the `xero_apps` table — never hard-coded
  into a route or component.
- Standard OAuth 2.0 authorization-code flow via `xero-node`'s `XeroClient`.
  No PKCE yet — deferred, not rejected; add it if the Cloudflare Worker
  spike (ADR-002) shows it composes cleanly with `xero-node`.
- State management: a one-time `xero_oauth_states` row per attempt, keyed
  by a random 32-character token, expiring in 10 minutes, resolving the
  Xero app server-side from the state row — never from a query parameter
  (spec §8.7).
- Every Xero call is required to go through `lib/xero/gateway.ts::resolveXeroRoute`,
  which resolves `{xeroAppId, authorizationId, connectionId, tenantId}` from
  the `entity_xero_app_assignments` table and fails closed on zero or
  multiple active matches for an entity/purpose pair (spec §10.1).
- Only `read_core_v1` scopes are requested (`lib/xero/scopeProfiles.ts`).
  No write or payroll scope exists anywhere in the codebase yet.

## Consequences

- Adding a second Xero app (e.g. for a second environment, or a
  controlled-write app later) requires no schema change — just another
  `xero_apps` row and its secret env vars, then an
  `entity_xero_app_assignments` row per entity that should use it.
- Multi-app entity-allocation rules (§7.6: no automatic capacity spillover,
  write/payroll never falls back to read) are enforced at the assignment
  level today even though only one app exists, so the router does not need
  to change when a second app is added — only the compliance gate (§9.6)
  still needs building (see ADR-004).
- Token-refresh concurrency locking (§8.5) is **not implemented**. A
  Durable Object or D1 lease is required before this runs under concurrent
  load; documented as an open gap rather than silently skipped.

## Alternatives considered

- **Custom Connection (machine-to-machine)**: rejected for now — it
  connects one organisation per subscription and doesn't fit the
  multi-entity registry model this build establishes from the first
  migration.
- **SPA/implicit token flow**: rejected — spec explicitly prohibits
  converting this into a browser-only token flow (§8.1); secrets must stay
  server-side.
