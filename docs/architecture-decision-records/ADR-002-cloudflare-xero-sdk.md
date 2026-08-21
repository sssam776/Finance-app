# ADR-002: Cloudflare/Xero SDK and Runtime

## Status

Provisional — the Worker-compatibility spike required by spec §10.3 has
**not** been run yet. This ADR records the quick-version substitute and
what must happen before deploying to Cloudflare.

## Context

Spec §10.3 mandates D1, R2, Web Crypto and a proven `xero-node` Worker
compatibility spike before committing to Cloudflare Workers as the runtime.
The repository was empty at session start (no existing Cloudflare
configuration to inspect or preserve), and the user asked for a working
quick version first rather than a Phase-0-only audit.

## Decision (quick version)

Run on plain Node.js instead of a Cloudflare Worker, using:

- **Database**: `drizzle-orm/better-sqlite3` against a local file
  (`db/client.ts`). The schema (`db/schema.ts`) is written in Drizzle's
  SQLite dialect, which is the same dialect D1 uses — the intent is that
  `drizzle-orm/d1` can be substituted later with the same schema file and
  minimal query changes, not a rewrite.
- **File storage**: local disk keyed by SHA-256 checksum
  (`lib/rawFileStore.ts`), standing in for an R2 binding. Callers only
  depend on `storeRawFile`'s return shape (`{key, checksum}`), so an R2
  implementation can replace the module body without touching callers.
- **Token encryption**: Node `crypto` AES-256-GCM (`lib/xero/crypto.ts`)
  with a key-version envelope, standing in for Cloudflare Web Crypto.
  Same reasoning: callers depend on `encryptTokenSet`/`decryptTokenSet`,
  not on which crypto API backs them.
- **Xero SDK**: `xero-node` (official SDK), used directly — this part is
  not a substitute, it's the spec's own first choice (§11.1), and nothing
  here contradicts using it in a Worker if the spike passes.

## What is deliberately not decided yet

- Whether `xero-node` actually runs cleanly in the Cloudflare Workers
  runtime (its dependency on `openid-client` and Node built-ins is a known
  risk area per spec §10.3). This build does not attempt that today.
- Cloudflare Cron Triggers / Queues for scheduled sync — there is currently
  no scheduler at all; sync is triggered manually from the UI.
- Durable Object for token-refresh locking (see ADR-001).

## Required before any Cloudflare deployment

1. Run the §10.3 spike: app-specific OAuth URL generation, callback
   exchange, token refresh without cross-app contamination, one read call,
   one paginated call, Web Crypto encryption, and a bundle-size/Node-
   compatibility check, against at least two Xero app registrations, inside
   an actual Worker (not just documentation reading).
2. If it passes: swap the three modules above for their Cloudflare-native
   implementations. No other file in the codebase should need to change,
   because nothing outside `db/client.ts`, `lib/rawFileStore.ts`, and
   `lib/xero/crypto.ts` depends on Node-specific behaviour.
3. If it fails: follow the spec's fallback — a thin typed REST client
   generated from `Xero-OpenAPI`, or an isolated small Node service with a
   documented security boundary (§10.3) — and update this ADR with the
   outcome and the reasoning.

## Consequences

Running on Node today means this cannot yet be deployed to Cloudflare
Workers as-is. That tradeoff was made deliberately to get a real, testable
vertical slice in front of the Financial Controller quickly. It must not be
mistaken for a finished infrastructure decision — the spike above is still
required.
