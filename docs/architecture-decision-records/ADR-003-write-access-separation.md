# ADR-003: Write-Access Separation

## Status

Deferred — no write scopes, write routes, or write UI exist in this build.
This ADR records why, and what has to be true before one is added.

## Context

Spec §2.1 and §9 require controlled Xero write-back to be a separate
release gate, never an automatic continuation of the read-only build. The
non-negotiable rules (spec §1.2) prohibit executing a write directly from
an AI response, require a deterministic validator and human approval for
every proposed action, and require read-back verification before marking
any write as applied.

## Decision

This session builds **read-only** capability only:

- `xero_apps.purpose` supports `controlled_write` and `payroll_draft` as
  enum values (so the schema does not need to change later), but the
  seeded app is `purpose='read_core'` with `read_core_v1` scopes only.
- No `accounting.invoices`, `accounting.manualjournals`,
  `accounting.banktransactions`, `accounting.contacts`, or
  `accounting.attachments` write scope appears anywhere, including in
  `lib/xero/scopeProfiles.ts`.
- No `proposed_actions`, `approvals`, `action_executions`, or
  `verification_results` tables exist yet (spec §14.9) — building them
  without a write path to feed them would be dead schema.

## Required before write-back is added (not yet satisfied)

1. Model A vs. Model B decision (spec §9.5): one app with progressively
   expanded scopes, or a separate write/payroll app. Not yet decided —
   requires the Financial Controller's input on credential blast-radius
   tolerance.
2. `controlled_write_v1` / `payroll_draft_v1` scope profiles, added only
   once the action types they enable are also approved (spec §9.4).
3. The proposed-action/approval/execution schema (spec §14.9), a
   deterministic validator, and a documented rollback or compensating
   procedure per action type (spec §3.12, §28 WRITE-009) — action-specific,
   not a blanket "everything is undoable" claim.
4. Idempotency and read-back verification (spec §28 WRITE-006, WRITE-007)
   before any write is ever marked as applied.

## Consequences

Nothing in the current codebase needs to change structurally to add
write-back later — `entity_xero_app_assignments.purpose` and
`xero_apps.purpose` already model `controlled_write` and `payroll_draft` as
first-class values. But no write path should be added by extending the
existing read routes; it needs its own reviewed slice per the phase plan
in `docs/implementation-plan.md`.
