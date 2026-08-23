# Implementation Plan

## Delivered in this session: Phase 0 + first vertical slice

A running local app: entity registry (unverified, seeded from spec §7.1),
ASB/BNZ CSV import with full lineage, a single Xero Starter app with
read-only scopes, real OAuth against Xero, a minimal read sync (accounts +
bank summary), and a Cash Position dashboard computing Xero-to-bank
variance. See `docs/current-state-audit.md` for exactly what is and is not
implemented, and `docs/requirements-traceability.md` for the requirement-
by-requirement mapping.

This intentionally skipped the spec's instruction to do audit-only on the
first pass (§1.1) because the repository was empty — there was no existing
app to audit, and the user asked for a working quick version first. The
audit that *was* possible (confirming the repo is greenfield) is recorded
above.

## Immediate next steps (before treating any number as real)

1. **Confirm entity-to-Xero-organisation mapping.** Every seeded entity is
   `status='unverified'`. Connect the Xero Demo Company (or real orgs, with
   the Financial Controller's approval) via the `/xero` page and confirm
   which of the eight candidates are active, dormant, or don't have a
   separate Xero organisation at all (spec §7.1, §7.9).
2. **Verify the Bank Summary report parsing assumption.** `lib/xero/reports.ts`
   assumes the last cell in each account row is the closing balance. Run a
   real sync against the Demo Company and check the raw report shape
   before trusting a variance number.
3. **Verify the ASB/BNZ CSV column assumption.** `lib/csv/parseBankCsv.ts`
   assumes a running-balance column exists per the bank's "include balance"
   export option. Test against one real ASB and one real BNZ export.
4. **Generate an encryption key and a real Xero app registration** (see
   `.env.example`) before doing anything beyond local testing.

## Phase 1 — Harden the read slice

Done since the first slice:

- **Authentication and actor identity.** Email/password sign-in with scrypt
  hashing, hashed session tokens in httpOnly cookies, and `admin`/`viewer`
  roles. Every route resolves its actor from the session — no route accepts
  an actor email from a request body any more.
- **Production compliance gate (§9.6)** enforced at `buildXeroClient`, the
  single choke point for every Xero call.
- **Concurrent token-refresh locking (§8.5)** as a compare-and-swap on
  `refresh_version`. No Durable Object needed; the same CAS works against D1.
- **CASH-005** configurable variance thresholds and **CASH-006** drill-through
  to the originating bank import and Xero sync run.

- **Per-entity scoping (§14.1).** `entity_permissions` plus the rule in
  `lib/entityAccess.ts`, enforced on writes as well as reads.
- **Connection capacity (§7.6.7)** checked before the OAuth consent URL is
  built, so hitting the five-connection Starter ceiling is a recorded admin
  decision rather than a Xero error page after consent.
- **Connection health and staleness (§17.6)** surfaced on `/xero`.
- **Password rotation** with revocation of the user's other sessions, and
  **login throttling** counted from the audit trail itself.

Still open in this phase:

- The eight seed roles in §31. Only `admin` and `viewer` exist, and §31 says
  not to build a second identity system without an ADR, so this needs a
  decision before code.
- Contacts, invoices, bank transactions, manual journals sync (currently
  only Accounts + Bank Summary are pulled).
- Password reset for a user who has forgotten theirs. Rotation works; there
  is no out-of-band recovery, so a locked-out user needs an admin to reset
  the row directly.
- Scheduled sync. Everything is manually triggered today.

## Module plans

`module-plans.md` holds a concrete implementation plan for Modules B, C, E, F,
G, H, I, J and K: real table names with real columns, real route paths, the
Xero scopes and endpoints each needs, what each is blocked on, and an effort
estimate. Modules D and L are not covered there yet.

Those are plans, not commitments. Nothing described in them exists.

## Phase 2 — Board and management reporting (Module B, C, D)

P&L by entity, group account mapping, consolidation/eliminations, tracking-
category breakdown, the board-pack structure (§19 BOARD-001..009), budget
variance (§20). Requires the Xero Worker-compatibility spike outcome
recorded in ADR-002 if moving off Node.

## Phase 3 — Balance sheet, rules, intercompany, GST (Modules D-G)

Balance-sheet substantiation workpapers, the versioned rule engine and
exception lifecycle, two-sided intercompany matching, and GST audit/
reconciliation against finalised Xero tax reports. These depend on Phase 2's
account mapping and Phase 1's fuller transaction sync.

## Phase 4 — Debt/lender view, attachments, optional AI (Modules H, I, J)

Loan Register integration, document extraction, and schema-validated AI
commentary that can only cite locked structured facts, never invent a
number.

## Phase 5 — Controlled write-back and payroll (Modules K, L)

Separate write/payroll Xero app(s) (§9.5), proposed-action queue with
deterministic revalidation and human approval (§28 WRITE-001..009), isolated
draft-only SharePoint-to-Xero timesheets (§29 PAY-001..007). Live write
scopes stay disabled until each of these has an approved governance
decision recorded — this is a hard gate, not a target date.

## Deployment migration (parallel track, before any production use)

- Prove the Cloudflare Worker compatibility spike (§10.3): `xero-node`
  OAuth/token-refresh/Web-Crypto behaviour inside an actual Worker, for at
  least two app registrations. Record the outcome in ADR-002.
- If it passes: swap `db/client.ts` to `drizzle-orm/d1`, `lib/rawFileStore.ts`
  to an R2 binding, and `lib/xero/crypto.ts` to Web Crypto, all behind their
  existing call signatures — no caller changes needed.
- If it fails: generate a typed client from `Xero-OpenAPI` or isolate Xero
  calls in a small Node service per §10.3's fallback.
- Only after that: build the multi-app registry/router/compliance-gate
  work in full (§7.6-§9.6) — this quick version's registry is deliberately
  single-app until there's a second real app to route between.
