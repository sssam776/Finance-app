# ADR-004: Xero Multi-App Routing and Compliance

## Status

Partial — the data model and router support multiple apps; the production
compliance gate (spec §9.6) is not implemented; only one app exists today.

## Context

Spec §3.2-§3.3 and §7.6-§9.6 require the architecture to support multiple
independent Xero app registrations from the first migration, while
separating **technical capability** from **approved production
activation** — Xero's terms prohibit bypassing usage limits via duplicate
same-purpose apps without written consent.

## Decision

Built now:

- `xero_apps`, `xero_authorizations`, `xero_connections`,
  `entity_xero_app_assignments` model the full hierarchy from spec §8.3,
  each already carrying `xero_app_id`/`connection_id`/`tenant_id` lineage
  fields (spec §10.5), even though only one app row exists.
- `lib/xero/gateway.ts::resolveXeroRoute` resolves one active,
  effective-dated assignment per entity/purpose and throws on zero or
  multiple matches — it does not pick an app because it has spare capacity,
  and a write/payroll purpose is never resolved by falling back to
  `read_core` (spec §7.6 rules 2, 4, 5, §10.1).
- Creating a new assignment for the same entity/purpose retires the
  previous active one rather than allowing two active same-purpose
  assignments to coexist (spec §7.6 rule 3), enforced in
  `app/api/xero/assignments/route.ts`.
- `xero_apps.complianceStatus` exists as a column
  (`draft | internal_review | xero_confirmation_required | approved | rejected | retired`)
  and the seeded dev app is `draft` — deliberately not `approved`, because
  no one has reviewed it.

Not built yet:

- **The production compliance gate itself.** Spec §9.6 requires production
  jobs to check `XERO_MULTI_APP_ENABLED`, at least two enabled production
  apps each with an owner/scope-profile/`compliance_status='approved'`,
  an approval/exemption reference where required, no duplicate same-purpose
  assignment outside a migration window, and a passing app-routing/tenant-
  isolation test run — as a runtime check, not just documentation. Nothing
  in this codebase currently reads `complianceStatus` before allowing a
  sync or OAuth flow to proceed.
- App capacity checks before starting OAuth (spec §7.6 rule 7) — the OAuth
  start route does not currently count active connections against
  `xeroApps.connectionLimit`.
- Migration/shadow-assignment support (spec §7.8, §10.6) — the
  `entity_xero_app_assignments.status` enum includes `shadow_migration`,
  but no dual-read comparison logic exists.

## Consequences

A second Xero app can be added today purely as data (a new `xero_apps` row
plus its secret env vars) without a schema or router change. But **nothing
currently stops someone from enabling a second same-purpose production app
without the required Xero approval** — the compliance gate is the load-
bearing control the spec relies on for that, and it is explicitly not built
yet. Do not treat the presence of the multi-app schema as evidence that
multi-app production use is already compliant or supported end-to-end.
