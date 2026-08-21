# Ramwall Group Xero Finance Automation
## Master Build Specification for Claude Code — Version 4.0 (Multi-App Compatible)

**Prepared for:** Shivana Prasad, Financial Controller, Ramwall Group  
**Date:** 21 August 2026  
**Status:** Implementation-ready master specification, subject to Phase 0 repository, Xero capability and app-use-case validation  
**Supersedes:** `Ramwall_Finance_Automation_Proposal.pdf`, `Ramwall_Xero_Automation_Proposal_v1.md`, `Ramwall_Xero_Automation_Proposal_v2.md`, and Master Build Specification v3.0  
**Version 4 change:** The system is now designed to support multiple independent Xero app registrations and connection pools without hard-coding a single OAuth app. Production use of multiple same-purpose Starter apps remains subject to Xero approval and terms.

---

## 0. Purpose of this document

This is the single source of truth for extending Ramwall's existing Cash Position application into a production-grade, multi-entity finance control system connected directly to Xero.

It is written for use with Claude Code. It consolidates:

- the three earlier Ramwall proposals;
- the later Xero pricing, scope and API corrections;
- the full multi-entity, intercompany, GST, board reporting and controlled write-back requirements;
- the official Xero GitHub projects already identified;
- a first-class Xero app registry, app router and multi-app connection-pool model;
- production requirements that the earlier proposals did not cover, including token security, rate-limit handling, tenant isolation, idempotency, approval workflows, audit evidence, data lineage, testing, observability and deployment controls.

This document is intentionally more detailed than a business proposal. It is a product requirements document, architecture specification, implementation plan and acceptance-test baseline in one file.

### Source precedence

Where sources conflict, use this order:

1. Current official Xero documentation and terms checked at implementation time.
2. This master specification.
3. Proposal v2.
4. Proposal v1.
5. The four-page PDF proposal.

Do not silently rely on an older proposal statement if current Xero documentation contradicts it.

---

# Part I — Instructions to Claude Code

## 1. How Claude Code must use this specification

Claude Code must read this file in full before making code changes.

### 1.1 First response: inspect, do not build

On the first pass, Claude Code must not write feature code. It must:

1. Inspect the repository tree, `package.json`, lockfile, TypeScript configuration, database schema, Drizzle migrations, Cloudflare configuration, routes, authentication, tests and deployment scripts.
2. Confirm whether the proposal's stated stack is still accurate:
   - Next.js 16;
   - React 19;
   - TypeScript;
   - Cloudflare Workers;
   - Cloudflare D1;
   - Drizzle ORM.
3. Locate and inspect the current implementation of:
   - ASB and BNZ imports;
   - entity aliases and account classification;
   - cash and loan calculations;
   - seeding and migrations;
   - `GET /api/accounts` or its current equivalent;
   - any hard-coded account numbers or balances;
   - existing authentication and authorisation.
4. Produce the following before implementation:
   - `docs/current-state-audit.md`;
   - `docs/requirements-traceability.md`;
   - `docs/implementation-plan.md`;
   - `docs/architecture-decision-records/ADR-001-xero-auth-model.md`;
   - `docs/architecture-decision-records/ADR-002-cloudflare-xero-sdk.md`;
   - `docs/architecture-decision-records/ADR-003-write-access-separation.md`;
   - `docs/architecture-decision-records/ADR-004-xero-multi-app-routing-and-compliance.md`.
5. Mark every assumption as one of:
   - **verified in code**;
   - **verified in Xero documentation**;
   - **confirmed by Shivana**;
   - **unverified — decision required**.

### 1.2 Non-negotiable engineering rules

Claude Code must follow these rules throughout the project:

- Extend the existing Ramwall finance app. Do not create a second standalone product unless a documented architecture decision proves that extension is unsafe.
- Keep the accounting core deterministic. An LLM must never be the source of a financial total, reconciliation result, GST calculation or posting amount.
- Build read-only capability first. Live Xero write scopes remain disabled until the read layer has passed acceptance testing and a governance decision has been recorded.
- Never use browser automation, scraping or simulated clicks in Xero.
- Never send Xero API data to a provider for model training or fine-tuning.
- Never commit Xero credentials, refresh tokens, access tokens, encryption keys or live financial data.
- Never instantiate a Xero client from process-global credentials in finance modules; resolve an immutable app-registration/authorisation/connection/tenant context server-side.
- Never activate a second same-purpose live Starter registration unless the recorded Xero compliance gate is satisfied.
- Treat every Xero app registration as an independent security principal. No token, client secret, authorisation, connection or rate budget may be used under the wrong app.
- Do not hard-code a single Xero client ID or app name into domain logic. All Xero calls must resolve through the app registry and app router.
- Multi-app production mode must fail closed unless each enabled app has a documented purpose, owner, scope profile and compliance status.
- Do not create or operate duplicate same-purpose Xero apps to exceed or bypass platform limits without Xero's explicit written consent. Technical multi-app capability is required; entitlement to use it is a governance decision.
- Never trust a tenant identifier supplied by a browser request. Resolve permitted tenant access server-side.
- Never use JavaScript floating-point arithmetic for accounting calculations.
- Never claim a write is reversible unless the relevant Xero resource and status support a verified rollback. Where rollback is unavailable, document a compensating or manual reversal procedure.
- Never execute a write directly from an AI response. AI output may create a proposed action only; a deterministic validator and human approval are mandatory.
- Never mark a write as applied until a follow-up Xero read confirms the expected state.
- Never mix live data and fixtures. Production data must not appear in tests, screenshots, GitHub issues or prompts.
- Prefer small, reviewable commits grouped by requirement and phase.

### 1.3 Required implementation workflow

For each phase:

1. Update the traceability matrix.
2. Write tests or fixtures before or with the implementation.
3. Implement the smallest end-to-end vertical slice.
4. Run type-checking, unit tests, integration tests and migrations locally.
5. Test against the Xero Demo Company before any live connection.
6. Document any Xero behaviour that differs from the official documentation.
7. Provide a concise change summary, test evidence and any decision still required.
8. Stop at the phase gate. Do not begin the next phase without approval.

### 1.4 Suggested opening prompt for Claude Code

Use this prompt after placing this file in the repository:

> Read `Ramwall_Xero_Finance_Automation_Master_Build_Spec_v4_Multi_App.md` completely. Do not change code yet. Inspect the existing repository and produce the Phase 0 current-state audit, requirements traceability matrix, implementation plan and the four required ADRs. The architecture must support one or more Xero app registrations from the first migration: app registry, app-purpose profiles, app-specific secrets, authorisations, tenant connections, rate budgets and deterministic entity-to-app routing. Identify conflicts between the specification and the actual code. For every conclusion, cite the file and line or configuration entry that supports it. Do not guess missing accounting rules, Xero tenant mappings, app entitlements or approval status.

# Part II — Executive Product Decision

## 2. Product decision

Build one internal Ramwall finance control platform by extending the existing Cash Position app and adding Xero as a governed data source.

The platform must be **multi-Xero-app compatible from day one**. It must be able to route different Ramwall entities and action types through different Xero app registrations while presenting one consolidated finance system to users.

The system will:

1. register and manage one or more independent Xero OAuth apps;
2. assign each entity to an approved read, write and payroll app purpose;
3. pull finance data from each connected Xero organisation on a schedule;
4. preserve source lineage, including the Xero app, authorisation and tenant used;
5. normalise entities, accounts, contacts, tracking and projects across app boundaries;
6. produce board reporting and finance-control views across all connected entities regardless of which app supplied the data;
7. reconcile intercompany positions only where both sides are available;
8. perform transaction-level GST and coding tests;
9. create a controlled exception and proposed-fix queue;
10. optionally write approved drafts or controlled corrections to Xero through the explicitly assigned write app;
11. keep payroll write-back isolated and draft-only;
12. use AI only where language understanding adds value.

### 2.1 Recommended delivery target

The first production release should be **read-only across the approved connected entities** and include:

- Xero app registry, capacity dashboard and deterministic app router;
- connection health and scheduled incremental sync;
- cash position plus Xero-to-bank balance variance;
- P&L, balance sheet, trial balance and budget views;
- board-pack data and export;
- project-code and coding exceptions;
- two-sided intercompany reconciliation, including pairs connected through different Xero apps;
- GST audit and period reconciliation;
- audit trail and source evidence.

Controlled Xero write-back is a separate release gate, not an automatic continuation of the read-only build.

### 2.2 Supported deployment modes

The codebase must support all of the following without a rewrite:

1. one Starter app with up to five connections;
2. multiple approved Xero app registrations, each with its own connections and credentials;
3. one Core app for the full group;
4. separate read-only, controlled-write and payroll apps where governance requires separation;
5. Custom Connections for exceptional single-organisation cases.

The default compliant production recommendation for more than five organisations performing the same use case remains one Core app unless Xero confirms an exemption or gives written approval for another structure.

### 2.3 Why this is the right architecture

The earlier proposals correctly identified that the existing app already contains reusable infrastructure: interface, deployment, database, entity normalisation and bank CSV processing. They also correctly separated deterministic checks from optional AI.

The later research changes the implementation in important ways:

- Xero meters connection count and egress at the app level, so every app registration needs its own capacity and rate tracking.
- A multi-app-capable data model prevents a later rework if Ramwall uses separate read/write apps, multiple approved app registrations, different environments or Custom Connections.
- Xero's terms prohibit attempts to bypass usage limits and prohibit multiple versions of an app that do the same or similar thing. The system therefore separates **technical capability** from **approved production activation**.
- Xero does not charge per API call; limits and egress apply instead.
- full system-generated `Journals` and user-created `ManualJournals` are different endpoints.
- `ManualJournals` remain available on Starter and Core and can be read and written with granular scopes.
- finalised NZ GST reports are available through the API.
- purchase bills, bank transactions, tracking categories, attachments, budgets and manual journals are accessible through granular scopes.
- the official Xero MCP server is useful but does not expose every endpoint required for the Ramwall system, so production must use the official SDK or direct API for missing functions.

# Part III — Corrections to the Earlier Proposals

## 3. Current Xero facts that replace older assumptions

All pricing, limits, scopes and terms must be rechecked at implementation time. The statements below reflect official Xero material reviewed for this version.

### 3.1 Pricing and connections

For a standard Xero OAuth app:

| Tier | Maximum connections per app | Monthly fee | Daily API limit per organisation | Included monthly egress |
|---|---:|---:|---:|---:|
| Starter | 5 | No charge | 1,000 calls | Not metered as a paid allowance |
| Core | 50 | AUD 35, tax exclusive | 5,000 calls | 10 GB |
| Plus | 1,000 | AUD 245, tax exclusive | 5,000 calls | 50 GB |
| Advanced | 10,000 | AUD 1,445, tax exclusive | 5,000 calls | 250 GB |

Core egress overage is AUD 2.40 per GB. API ingress is unlimited for pricing purposes.

**There is no Xero per-call charge.** An API request consumes a rate-limit allowance and contributes to egress volume; it is not billed as a transaction.

### 3.2 App-level metering and multiple app registrations

Xero measures connection count and API data consumption at the **app level**. Apps cannot share connection counts or egress allowances, even where the same developer owns them.

Technically, two separate Starter app registrations can each hold up to five connections. This specification therefore requires first-class support for multiple Xero apps. However, technical separation does not by itself make a multi-app production structure compliant.

Every Xero app registration must have its own:

- Xero client ID and secret;
- redirect URI configuration;
- approved purpose and scope profile;
- encrypted authorisations and rotating tokens;
- connections and capacity count;
- per-tenant and app-level rate budgets;
- operational owner and backup owner;
- compliance/approval record;
- audit trail.

### 3.3 Compliance boundary for multiple apps

Xero's Developer Platform Terms state that developers must not:

- try to exceed or bypass applicable usage limits; or
- create multiple versions of an app when they all do the same or a similar thing.

Therefore:

- the software **must** support multiple app registrations;
- development, staging, production, read-only, controlled-write and payroll apps may be separate where they are genuinely distinct and approved;
- multiple same-purpose Starter apps must not be activated in production solely as a free-tier bypass without Xero's explicit written consent;
- where Ramwall believes an internal single-client or bespoke integration exemption applies, obtain written confirmation and store the approval reference;
- absent written confirmation, budget and operate one Core app once the sixth same-purpose production connection is required.

The code must enforce this through a production compliance gate rather than relying only on documentation.

### 3.4 Standard OAuth app versus Custom Connections

Use one or more standard Web App OAuth code-flow registrations for multi-organisation access.

- One standard app can connect multiple Xero organisations up to its tier limit.
- Starter supports five connections; Core supports fifty under the commercial plan.
- Xero's OAuth guide currently states a practical limit of 25 tenants for a code or PKCE app before certification. Ramwall's expected group size fits within this limit and Core's commercial limit.
- A Custom Connection is machine-to-machine but connects to one organisation only and carries a separate monthly subscription.
- Custom Connections do not count toward an organisation's two-uncertified-app limit and may be a contingency where an organisation's app slots cannot be freed.

### 3.5 App-slot constraint

Each Xero organisation can connect a maximum of two uncertified apps. This matters if Ramwall connects the same organisation to separate read and write apps, or during migration when an old and new app overlap.

Phase 0 must check the Connected Apps position for every in-scope organisation. Do not disconnect anything without owner approval.

### 3.6 Rate limits

Design for all current limits:

- maximum five calls in progress per tenant/app connection;
- maximum sixty calls per minute per tenant/app connection;
- 1,000 calls per day per tenant/app connection on Starter;
- 5,000 calls per day per tenant/app connection on Core and above;
- 10,000 calls per minute across each app;
- HTTP 429 handling using `Retry-After` and Xero rate-limit headers.

Keep at least a 20% daily reserve for user-triggered refreshes and recovery jobs. Rate budgets must be keyed by both `xero_app_id` and `xero_connection_id`.

### 3.7 Journals versus Manual Journals

Do not conflate these endpoints:

- `Journals` provides the complete system-generated general ledger, including journals created from invoices, payments, payroll and other Xero events. It is a premium Advanced-tier feature and requires approval.
- `ManualJournals` represents user-created manual journals. It remains available on all tiers through `accounting.manualjournals.read` or `accounting.manualjournals`.
- The Manual Journals API supports retrieval, creation, update and attachments. Lines can include account code, tax type, tracking and tax amount.
- Some reserved accounts, including bank, accounts receivable, accounts payable and retained earnings, cannot be used in manual journal lines.

The first production release must not depend on the premium `Journals` endpoint.

### 3.8 GST reports

The API exposes finalised NZ GST reports through `accounting.reports.taxreports.read`.

Limitations:

- the endpoint lists finalised/published GST reports;
- a current unfinalised period may need to be reconstructed from transaction-level data and tax rates;
- the system must state clearly whether a result is a comparison to a finalised Xero report or a reconstructed pre-filing position.

The GST PDF is therefore not always a manual prerequisite. It remains an optional evidence source or fallback.

### 3.9 Bills, bank transactions, tracking, attachments and budgets

A custom app can request granular access to:

- purchase bills and sales invoices;
- payments, prepayments and overpayments;
- bank transactions and bank transfers;
- manual journals;
- accounts, tax rates and tracking categories;
- contacts and contact groups;
- attachments;
- budgets and budget reports;
- P&L, balance sheet, trial balance, aged reports, bank summary and tax reports.

The limited Xero connector available inside a chat product is not the capability ceiling for the custom app.

### 3.10 Bank reconciliation

The standard Accounting API does not permit the app to tick off or reconcile raw Xero bank statement lines. Do not promise automated Xero bank reconciliation.

The app may compare:

- Xero's account balance; and
- actual ASB/BNZ balance imported into the existing application.

That variance is a useful control and a proxy for unreconciled or timing items, but it is not line-by-line bank reconciliation.

### 3.11 AI and browser automation restrictions

- Xero API data must not be used to train or fine-tune AI/ML models.
- The runtime may use an AI model for inference only under approved no-training data-handling controls.
- Do not use Playwright, Puppeteer, browser extensions, RPA or similar tools to sign in to Xero, scrape Xero or simulate user actions as a workaround.

### 3.12 Undo is not universal

The earlier proposals said every change could be undone. Replace that with action-specific rollback rules.

Examples:

- a draft invoice may be updated or deleted/voided subject to Xero status rules;
- an authorised accounting transaction may require voiding, reversal or a correcting transaction;
- a posted manual journal may require a reversing journal rather than destructive deletion;
- an approved timesheet can be reverted through the Payroll API, but the Ramwall application will not approve it in the first place;
- a recorded payment may be difficult to reverse and is excluded from the initial write scope.

Every approved write action type must have a documented and tested rollback or compensating procedure before production enablement.

# Part IV — Business Outcomes and Success Measures

## 4. Business outcomes

### 4.1 Primary outcomes

- Remove monthly manual Xero exports for connected entities.
- Produce a repeatable, traceable board pack from source data.
- Detect GST, project-code, account-code and related-party exceptions before period end.
- Reconcile material intercompany balances using both sides of the transaction.
- Combine Xero data with bank CSV balances and loan schedules in one finance-control system.
- Reduce the Financial Controller's work to review, judgement and approval rather than re-keying and manual assembly.

### 4.2 Success measures

| Measure | Target for production release |
|---|---|
| Connected-entity sync freshness | Last successful scheduled sync within 24 hours, with visible status |
| Board-pack data preparation | No manual Xero export for connected entities |
| Data lineage | 100% of report and exception figures trace to source entity, Xero resource ID, sync run and period |
| Tenant isolation | Zero cross-entity leakage in automated tests and production logs |
| Intercompany integrity | No pair marked reconciled unless both sides are connected and matched |
| Write governance | Zero Xero write without an authorised human approval record |
| Duplicate writes | Zero duplicate writes under retry and double-click tests |
| GST audit | Transaction-level evidence for every flagged item and reconciliation difference |
| Cash freshness | Every consolidated cash number shows its oldest underlying balance date |
| Error visibility | Failed or partial sync is visible; stale data can never appear as current without warning |
| AI reliability | AI cannot change a numeric result and every AI output is schema validated |

### 4.3 Historical validation case

Create an anonymised regression fixture from the Ramwall (2010) GST review for 1 June to 31 July 2026.

The fixture should test the known pattern of approximately forty GST-bearing invoices with missing project tracking and the known GST understatement identified in the prior review. Exact expected amounts must be supplied or verified from the audit source before the fixture is locked.

---

# Part V — Scope

## 5. In scope

### 5.1 Data sources

- Existing ASB CSV imports.
- Existing BNZ CSV imports.
- Xero Accounting API.
- Xero Payroll NZ API for the isolated timesheet module.
- SharePoint timesheet files or lists.
- Existing budget workbooks where Xero budget detail is insufficient.
- Existing Loan Register and debt schedules.
- Wunderbuild project-code mapping and other approved group accounting rules.
- Optional invoice and receipt attachments.

### 5.2 Core modules

1. Foundation remediation of the existing app.
2. Xero app registry, OAuth, connection management and deterministic app routing.
3. Entity registry and account mappings.
4. Scheduled and on-demand Xero sync.
5. Cash position and Xero-to-bank balance variance.
6. Board and management reporting.
7. P&L movement and budget variance.
8. Balance-sheet substantiation.
9. Account and project categorisation exceptions.
10. Two-sided intercompany reconciliation and eliminations.
11. GST audit and return reconciliation.
12. Exception workflow and evidence.
13. Proposed-fix queue and approval governance.
14. Controlled Xero write-back, if approved.
15. SharePoint-to-Xero draft timesheets, if approved.
16. Optional attachment extraction and AI commentary.
17. Debt, funding and lender view using the existing Loan Register and finance data.

## 6. Explicitly out of scope for the first production release

- Xero bank-statement-line reconciliation.
- Autonomous approval or posting of invoices, journals, timesheets, pay runs or payments.
- Payroll approval or pay-run creation.
- Filing GST returns with Inland Revenue.
- Access to the premium Xero `Journals` endpoint.
- Browser automation in Xero.
- Training or fine-tuning an AI model on Xero data.
- Replacing Xero as the accounting system of record.
- Replacing Wunderbuild as the project source where it remains authoritative.
- Replacing the formal Loan Register with inferred loan balances from Xero.
- A public multi-customer SaaS product or Xero App Store listing.
- Automatic accounting-policy decisions where the policy has not been approved and encoded.

---

# Part VI — Entity, Xero App and Connection Strategy

## 7. Entity registry

The application must have a database-backed entity registry. No accounting policy, tenant mapping or Xero app selection may remain embedded in a React component or environment-specific branch.

### 7.1 Initial entity candidates

The registry should be seeded only after verifying which are active and which have separate Xero organisations. Current candidates include:

- Ramwall (2010) Limited;
- Ramwall Developments Limited;
- Vikat Holdings Limited;
- Kayo Investments Limited;
- Kerrs Village Limited;
- Hebcohg Limited;
- CHH Trust;
- Wallson Holdings Limited;
- other active Ramwall/Sami group entities confirmed during discovery.

Do not assume that every legal entity has a separate Xero organisation. Use `/connections`, organisation details and user confirmation.

### 7.2 Required entity fields

Each entity record must support:

- internal immutable ID;
- legal name;
- short code and display name;
- entity type;
- active, dormant or excluded status;
- Xero tenant ID and organisation name;
- active read-app assignment;
- optional controlled-write-app assignment;
- optional payroll-app assignment;
- authorisation and connection IDs for each assignment;
- Xero connection health;
- financial year end;
- reporting currency;
- GST registration status and basis;
- bank-account mappings;
- Xero account-code mappings;
- group reporting mappings;
- intercompany contact IDs and control accounts;
- tracking-category and option IDs;
- project-code requirements;
- materiality thresholds by module;
- budget source;
- loan-register mapping;
- approval policy;
- last successful sync by resource.

## 7.3 Xero app registry

The application must treat Xero app registrations as first-class records.

Each app record must include:

- immutable internal ID and human-readable key;
- Xero Developer Portal app name;
- environment: `development`, `staging` or `production`;
- purpose: `read_core`, `controlled_write`, `payroll_draft`, `demo`, `migration` or another approved value;
- tier: Starter, Core, Plus, Advanced, Enterprise or Custom Connection;
- configured connection limit;
- scope profile;
- redirect URI;
- client-ID secret reference;
- client-secret secret reference, where applicable;
- active connection count and remaining capacity;
- operational owner and backup owner;
- compliance status;
- Xero approval/exemption reference where required;
- enabled/disabled state;
- creation and retirement dates.

No Xero client secret is stored directly in D1. The registry stores only the name of the Cloudflare secret binding or secure secret reference.

### 7.4 Supported deployment modes

| Mode | Technical shape | Suitable use | Compliance position |
|---|---|---|---|
| `starter_single_app` | One Starter app, up to five connections | Build, Demo Company and five-entity pilot | Standard |
| `starter_multi_app_approved` | Two or more independent Starter apps, up to five connections each | Distinct approved use cases or an arrangement explicitly approved by Xero | Must have approval/evidence before production activation |
| `core_single_app` | One Core app, up to fifty connections | Full same-purpose group rollout | Default recommendation after connection five |
| `segregated_read_write` | Separate read and write/payroll apps | Stronger scope and credential separation | Each app must be valid for its purpose and app slots must be available |
| `custom_connection` | One client-credentials app per organisation | Exceptional machine-to-machine or app-slot case | Separate subscription per organisation |

The code must support all modes. It must not silently choose a mode based on cost.

### 7.5 Pilot selection rule

If the build begins with one Starter app and five free connections, choose the set that maximises covered intercompany relationships, not simply the five largest entities.

Default first pool candidate:

1. Ramwall (2010) Limited;
2. CHH Trust;
3. Vikat Holdings Limited;
4. Kayo Investments Limited;
5. Kerrs Village Limited.

Before connecting, build an intercompany edge matrix using known balances and transaction frequency. Score each pair by:

- absolute balance;
- annual transaction value;
- transaction count;
- GST or tax risk;
- importance to board and lender reporting.

If Hebcohg's management-fee relationships are more material than the least-connected property entity, include Hebcohg. If development WIP and project-cost control are the first priority, include Ramwall Developments.

### 7.6 Multi-app entity allocation rules

When more than one Xero app is enabled:

1. Every entity/action purpose must have one explicit active assignment.
2. The app router must never pick an app merely because it has spare capacity.
3. No entity may have two active same-purpose read assignments except during a time-bounded migration or validation run.
4. A write request must use the entity's approved write assignment; it must never fall back to the read app automatically.
5. A payroll request must use the approved payroll assignment and fail closed if none exists.
6. App assignment changes require an audited configuration change and effective date.
7. Capacity is checked before starting OAuth; reaching capacity creates an admin decision, not an automatic spillover.
8. Each Xero connection must be unique within an app. Duplicate tenant connections across apps are allowed only for distinct purposes or migration and must respect the organisation's two-uncertified-app limit.

### 7.7 Cross-app reporting and intercompany

Once data is normalised into D1, the Xero app boundary must not fragment reporting.

- Board packs aggregate all authorised entities regardless of the source app.
- Intercompany matching may pair two entities connected through different apps.
- Evidence retains `xero_app_id`, authorisation ID, connection ID and tenant ID.
- A connection failure in one app marks only the affected entities stale.
- Group reports must display coverage, excluded entities and stale entities.

### 7.8 Migration between app structures

The system must support migration from multiple app registrations to one Core app, or from one app to segregated read/write apps.

Tokens cannot be transferred between Xero apps. Migration requires reauthorisation.

Required migration process:

1. create or upgrade the target app;
2. authorise the target entity under that app;
3. run dual-read comparison for an approved validation period;
4. confirm report and transaction parity;
5. switch the entity's effective-dated assignment;
6. stop jobs against the old assignment;
7. revoke or disconnect the old connection after sign-off;
8. preserve the old connection history and audit evidence.

### 7.9 App-slot discovery checklist

For every entity:

- identify current Connected Apps;
- identify whether both uncertified app slots are used;
- identify the app owner and purpose;
- confirm whether any app is inactive and can be disconnected;
- identify whether a second Ramwall app is required for read/write separation or migration;
- record the result in the entity registry;
- do not disconnect anything without owner approval.

---

# Part VII — Xero Authentication, Scopes and Multi-App Connection Management

## 8. Authentication model

### 8.1 Recommended model

Use one or more Xero **Web App registrations using the OAuth 2.0 authorisation-code flow** because the server can securely store client secrets and the platform may connect multiple organisations.

Each Xero app registration is an independent OAuth client and security principal. PKCE may be added as defence in depth if supported cleanly by the chosen SDK and runtime, but do not convert the app into a browser-only SPA token flow.

### 8.2 App registry and secret resolution

App metadata is stored in `xero_apps`. Secrets are resolved server-side through named Cloudflare secret bindings.

Recommended secret naming pattern:

```text
XERO_<APP_KEY>_CLIENT_ID
XERO_<APP_KEY>_CLIENT_SECRET
```

`APP_KEY` must be an allow-listed registry value. Never construct an arbitrary secret name from untrusted request input.

### 8.3 Authorisation data model

Model the hierarchy explicitly:

- `xero_apps`: one row per Xero Developer Portal app registration;
- `xero_authorizations`: one encrypted rotating token set belonging to one `xero_app_id` and OAuth principal/consent;
- `xero_connections`: one tenant connection belonging to one `xero_app_id` and one authorisation;
- `entity_xero_app_assignments`: effective-dated entity/purpose routing to a connection;
- `entities`: Ramwall legal/reporting entities.

A consent may expose multiple connections for the same app/principal. Never reuse an authorisation across different Xero app IDs.

### 8.4 Mandatory Xero call context

Every gateway call must receive a server-created context containing:

```ts
interface XeroCallContext {
  xeroAppId: string;
  authorizationId: string;
  connectionId: string;
  tenantId: string;
  entityId: string;
  purpose: 'read_core' | 'controlled_write' | 'payroll_draft' | 'demo' | 'migration';
  syncRunId?: string;
  proposedActionId?: string;
}
```

A raw tenant ID from the browser is insufficient. The server must resolve and verify the complete context from the authenticated user, entity permission and active app assignment.

### 8.5 Token refresh coordination

Concurrent jobs must not refresh the same token set at the same time.

Lock key:

```text
xero-token:<xero_app_id>:<authorization_id>
```

Implement one of:

1. a Cloudflare Durable Object keyed by the lock key; or
2. a robust D1 lease with expiry, optimistic versioning and retry.

The Durable Object approach is preferred if the existing Cloudflare plan and architecture support it cleanly.

### 8.6 Token encryption and app-specific secrets

- Encrypt token sets using AES-256-GCM.
- Use Cloudflare Web Crypto in Worker code; do not assume Node `crypto` is available.
- Store encryption keys only as Cloudflare secrets.
- Include key version in the encrypted payload to support rotation.
- Separate client secret resolution from token encryption keys.
- Never log app client IDs in full, access tokens, refresh tokens or callback query strings.
- Store token expiry, granted scopes and refresh status separately for operations.
- A secret rotation for one app must not interrupt another app.

### 8.7 OAuth flow controls

Recommended routes:

```text
POST /api/xero/apps/:appKey/oauth/start
GET  /api/xero/oauth/callback
```

Controls:

- `:appKey` is looked up in the registry and must be enabled for the current environment;
- exact registered redirect URI per app/environment;
- state record stores `xero_app_id`, initiating user, intended entity/purpose and expiry;
- state is one-time and expires within ten minutes;
- callback resolves the app from the state record, never from a free-form query parameter;
- `offline_access` required;
- explicit tenant-selection and entity-mapping step;
- do not assume the first returned tenant is the correct entity;
- authorising user must have required Xero permissions;
- payroll authorisation must be performed by a Payroll Admin;
- capacity and app-slot checks occur before the connection is activated.

### 8.8 Connection health states

Use at least:

- `pending_authorisation`;
- `healthy`;
- `refresh_due`;
- `reauthorisation_required`;
- `permission_missing`;
- `rate_limited`;
- `sync_error`;
- `disconnected`;
- `disabled`;
- `capacity_blocked`;
- `compliance_blocked`;
- `migration_shadow`.

A broken connection must never fail silently. Surface the affected app, entity and last successful data date.

### 8.9 App capacity and compliance states

Each app must expose:

- tier limit;
- current distinct tenant count;
- remaining connection capacity;
- current scope profile;
- approval/compliance status;
- last successful OAuth and API call;
- environment and purpose.

Recommended compliance states:

- `draft`;
- `internal_review`;
- `xero_confirmation_required`;
- `approved`;
- `rejected`;
- `retired`.

Production jobs may use only `approved` apps. A single ordinary Starter app may be internally approved without a special Xero reference. A multi-app same-purpose production structure must carry the required written approval or exemption reference.

## 9. Scope strategy

Scopes are additive and cannot be removed from an existing token without revocation and reauthorisation. Request the minimum set needed for each app's purpose.

### 9.1 Scope profiles

Define versioned scope profiles rather than free-form strings:

- `read_core_v1`;
- `controlled_write_v1`;
- `payroll_draft_v1`;
- `demo_full_v1`;
- `migration_read_v1`.

Each Xero app is assigned one approved scope profile. A scope-profile change requires review, reauthorisation planning and an audit event.

### 9.2 Read-only core scopes

Initial `read_core_v1` candidate:

```text
openid
profile
email
offline_access
accounting.settings.read
accounting.contacts.read
accounting.invoices.read
accounting.payments.read
accounting.banktransactions.read
accounting.manualjournals.read
accounting.reports.aged.read
accounting.reports.balancesheet.read
accounting.reports.banksummary.read
accounting.reports.budgetsummary.read
accounting.reports.executivesummary.read
accounting.reports.profitandloss.read
accounting.reports.trialbalance.read
accounting.reports.taxreports.read
accounting.attachments.read
accounting.budgets.read
```

Do not request `accounting.journals.read` for the Starter/Core architecture.

### 9.3 Payroll read scopes

Add only for the isolated payroll app/profile:

```text
payroll.employees.read
payroll.settings.read
payroll.timesheets.read
```

### 9.4 Write scopes

Do not add write scopes until the write-access ADR is approved.

Potential `controlled_write_v1` scopes, added only for approved action types:

```text
accounting.invoices
accounting.manualjournals
accounting.banktransactions
accounting.contacts
accounting.attachments
```

Potential payroll draft write scope:

```text
payroll.timesheets
```

`accounting.payments` is excluded from the first write-back release unless separately approved.

### 9.5 App separation models

**Model A — one app, progressively expanded scopes**

- lower Xero platform cost;
- simpler connection management;
- larger credential blast radius after write scopes are granted.

**Model B — separate read-only and write/payroll apps**

- stronger technical separation;
- separate credentials, consent, app assignments and audit trails;
- may use both uncertified-app slots in an organisation;
- each app's connection tier is measured separately.

**Model C — multiple approved same-purpose connection pools**

- entities are allocated across multiple app registrations;
- group reporting and reconciliation span app boundaries;
- technically supported by this specification;
- production activation requires a documented Xero-approved basis and the compliance gate.

Default for the read-only build: implement the registry/router and operate the smallest approved number of apps. Decision gate before write-back: approve Model A or Model B. Decision gate before same-purpose multi-app production: record Xero approval or use Core.

### 9.6 Production compliance gate

Production multi-app routing must require all of the following:

- `XERO_MULTI_APP_ENABLED=true`;
- at least two enabled production app records;
- every enabled app has a purpose, owner and approved scope profile;
- `compliance_status='approved'` for each app;
- where required, a non-empty approval/exemption reference and approval date;
- no duplicate same-purpose entity assignment outside a migration window;
- a successful app-routing and tenant-isolation test run.

The feature flag alone is not sufficient. Database approval records must also pass.

# Part VIII — Target Architecture

## 10. Logical architecture

```text
                         Microsoft / Cloudflare Access
                                     |
                              Existing Next.js UI
                                     |
                      Cloudflare Worker / API layer
                                     |
                       Xero App Registry and Router
                     purpose + entity + environment + policy
             +-----------------------+------------------------+
             |                       |                        |
       Bank CSV ingestion      Xero App Pool A          Xero App Pool B...
       ASB / BNZ               OAuth + API              OAuth + API
             |                       |                        |
             +-----------+-----------+-----------+------------+
                         |                       |
                Cloudflare D1              Cloudflare R2
              metadata / facts       raw CSVs / raw API payloads /
              app routing / rules    cached attachments / exports
                         |
                  Deterministic domain layer
       money, dates, entity mapping, rules, reconciliation, GST
                         |
             +-----------+------------+----------------+
             |                        |                |
        Reports and pack         Exceptions       Proposed actions
             |                        |                |
             +------------------------+----------------+
                                      |
                         Human approval and execution
                                      |
                       Assigned Xero write/payroll app
```

The UI and accounting modules see one Ramwall data platform. Xero app boundaries remain visible in lineage, operations and security but do not split finance reporting.

### 10.1 Xero app router

No route, component or domain service may directly choose a client ID or token.

The router resolves:

```ts
interface XeroRouteRequest {
  entityId: string;
  purpose: 'read_core' | 'controlled_write' | 'payroll_draft' | 'demo' | 'migration';
  environment: 'development' | 'staging' | 'production';
}

interface ResolvedXeroRoute {
  xeroAppId: string;
  authorizationId: string;
  connectionId: string;
  tenantId: string;
  entityId: string;
  scopeProfile: string;
}
```

Routing rules:

- resolve only active, effective-dated assignments;
- verify user permission and action purpose;
- verify app compliance, capacity and connection health;
- fail closed on zero or multiple matches;
- never use capacity-based automatic spillover for accounting calls;
- write and payroll routes never fall back to read routes;
- log the routing decision without secrets.

### 10.2 Optional coordination components

- Cloudflare Cron Triggers for schedules.
- Cloudflare Queues for per-app/per-tenant sync jobs, if available and justified.
- Durable Object keyed by Xero app plus authorisation for token refresh and concurrency control.
- A small Node-compatible runner for OCR or SDK functions that do not run reliably in Workers.

### 10.3 Worker compatibility spike

The official `xero-node` SDK is preferred, but its compatibility with the actual Cloudflare Worker runtime must be proven.

Phase 0 must test, for at least two mocked or Demo app registrations:

- app-specific OAuth URL generation;
- callback exchange and state-to-app resolution;
- token refresh without cross-app contamination;
- one read call per app;
- one paginated call;
- Web Crypto token encryption;
- bundle size and Node compatibility.

If `xero-node` is reliable, use it behind one provider module. If not, use a thin typed REST client generated from Xero's OpenAPI specification or isolate Xero calls in a small Node service with a documented security boundary. Record the decision in ADR-002.

### 10.4 One Xero provider module

All Xero access must go through a single abstraction. No route or UI component may call Xero directly.

Suggested interface:

```ts
interface XeroGateway {
  listConnections(appId: string, authorizationId: string): Promise<XeroTenant[]>;
  getOrganisation(ctx: XeroCallContext): Promise<OrganisationSnapshot>;
  syncAccounts(ctx: XeroCallContext): Promise<SyncResult>;
  syncContacts(ctx: XeroCallContext): Promise<SyncResult>;
  syncInvoices(ctx: XeroCallContext, cursor?: SyncCursor): Promise<SyncResult>;
  syncBankTransactions(ctx: XeroCallContext, cursor?: SyncCursor): Promise<SyncResult>;
  syncManualJournals(ctx: XeroCallContext, cursor?: SyncCursor): Promise<SyncResult>;
  getReport(ctx: XeroCallContext, request: ReportRequest): Promise<ReportSnapshot>;
  executeApprovedAction(ctx: XeroCallContext, action: ValidatedXeroAction): Promise<XeroWriteResult>;
}
```

Every method verifies that the context's app, authorisation, connection, tenant, entity and purpose are mutually consistent.

### 10.5 Cross-app normalisation

Normalised facts use Ramwall entity IDs and source identifiers. Every Xero-derived record must also preserve:

- `xero_app_id`;
- `authorization_id`;
- `connection_id`;
- `tenant_id`;
- source object ID;
- source updated timestamp;
- sync run ID.

This permits one board pack and one intercompany engine across multiple app pools while maintaining complete source lineage.

### 10.6 Multi-app migration support

The architecture must support temporary dual connections for migration. Dual-read data is stored in isolated staging snapshots and compared; it must not double-count in visible reports.

A single `active` effective-dated assignment determines the production source for each entity/purpose. Shadow migration assignments are explicitly marked and excluded from normal reporting.

# Part IX — Official GitHub Reuse Plan

## 11. GitHub projects to use

No single open-source repository found is a drop-in Ramwall finance application. Use official Xero projects as foundations and references, not as an unreviewed full product.

### 11.1 `XeroAPI/xero-node`

**Role:** preferred production SDK, subject to the Worker compatibility spike.

Use for:

- OAuth 2.0;
- token refresh;
- Accounting API and Payroll API models;
- typed API operations;
- date parsing where supported.

Do not fork unless necessary. Pin a tested version and use a dependency-update process.

### 11.2 `XeroAPI/xero-prompt-library`

**Role:** production integration guidance for Claude Code.

Use the JavaScript/TypeScript `SKILL.md` as a reference for:

- granular scopes;
- token rotation;
- tenant selection;
- encrypted token storage;
- idempotency;
- rate-limit handling;
- date, money and tax normalisation;
- Xero production gotchas.

Important adaptation: its examples often assume Node and Postgres. Ramwall uses Cloudflare/D1, so use Web Crypto and the project's actual database abstractions.

Suggested project action:

- copy or reference the relevant Xero skill in a project-local `.claude/skills/xero-integration/` folder;
- retain attribution and verify its current licence before copying text or code;
- re-check Xero scope documentation during implementation.

### 11.3 `XeroAPI/xero-mcp-server`

**Role:** optional local development, exploration and conversational testing.

Useful for:

- confirming authentication;
- trying basic reads and writes against the Demo Company;
- exposing selected Xero tools to an MCP-compatible development client;
- understanding standard tool schemas.

Do not make it the sole production integration because:

- its exposed tool list does not cover every Ramwall requirement;
- known gaps include complete general-ledger reporting, GST tooling in some versions, attachments, budgets and other workflow functions;
- a local stdio MCP process is not the same as a Cloudflare production service;
- direct SDK/API control is needed for rate budgets, persistence, audit evidence and deterministic workflows.

### 11.4 `XeroAPI/xero-agent-toolkit`

**Role:** reference for optional AI-agent patterns.

Use for:

- tool wrapping;
- agent specialisation;
- schema-based tool calls;
- optional interactive finance assistant patterns.

Do not copy the demo's general autonomous assistant into production. Ramwall's AI layer must have read-only tools by default and must create proposed actions rather than execute them.

### 11.5 `XeroAPI/xero-command-line`

**Role:** developer diagnostics and smoke testing.

Use for:

- testing an OAuth profile;
- listing accounts, contacts, invoices, manual journals and reports;
- obtaining raw JSON or CSV for fixture creation;
- checking whether an API issue is in the app or in Xero access.

Do not use it as a runtime dependency or store production tokens on an unmanaged developer machine.

### 11.6 `XeroAPI/xero-node-oauth2-app`

**Role:** OAuth reference implementation only.

Use to compare:

- consent flow;
- callback handling;
- tenant discovery;
- SDK setup.

It is a demonstration app and must not be treated as production security architecture.

### 11.7 `XeroAPI/Xero-OpenAPI`

**Role:** source for generated types or a Worker-safe client if `xero-node` cannot run reliably.

Generate only the APIs needed by this project. Do not expose the entire generated client to the UI.

### 11.8 Licence and supply-chain controls

For every reused repository or package:

- verify the current licence;
- retain required notices;
- pin versions or commit SHAs for copied code;
- run dependency and secret scanning;
- record the source and modifications in `THIRD_PARTY_NOTICES.md`;
- do not copy an example `.env` containing real credentials.

---

# Part X — Foundation Remediation

## 12. Required remediation before Xero features

These requirements preserve and strengthen the findings in Proposal v2.

### REM-001 — Move accounting policy out of presentation code

Remove literal bank account numbers, entity mappings, the Kerrs Village figure and loan classification rules from React components and route handlers.

Move them to:

- entity registry;
- bank account mappings;
- rules tables;
- versioned configuration migrations.

### REM-002 — Server-side CSV ingestion

- Upload raw source file to the server.
- Validate file type and size.
- Store original file in R2 with checksum.
- Parse and classify server-side.
- Save raw import metadata and normalised balances.
- Make imports replayable after mapping-rule changes.

### REM-003 — No writes on GET

GET routes must be side-effect free.

- migrations run through deployment or an explicit migration command;
- seed data is explicit and environment-specific;
- production does not seed historical balances automatically;
- any demo data is visibly labelled and cannot be included in live totals.

### REM-004 — Separate balance date from import time

Store:

- source balance date;
- source timezone;
- file received time;
- processing time;
- imported by user;
- source institution.

Every consolidated cash figure must display the oldest underlying source date.

### REM-005 — Preserve raw source and lineage

Every normalised bank record must trace to:

- source file object key;
- row number or source reference;
- import run;
- parser version;
- mapping-rule version.

### REM-006 — Remove duplicate constants

No figure or account mapping may exist in more than one code location.

### REM-007 — Establish money and date primitives

Before finance calculations, create shared domain types and tests for:

- decimal money;
- currency;
- account date versus timestamp;
- NZ timezone display;
- sign conventions;
- GST-inclusive and GST-exclusive amounts.

---

# Part XI — Data Model and Lineage

## 13. Storage strategy

### 13.1 D1

Use D1 for:

- configuration;
- connection metadata;
- encrypted token blobs;
- normalised finance facts;
- sync status;
- rules;
- exceptions;
- approvals;
- audit events;
- report metadata.

### 13.2 R2

Use R2 for:

- original ASB and BNZ files;
- large raw Xero responses where retention is justified;
- cached attachments;
- document-extraction inputs and outputs;
- generated board-pack and audit exports;
- anonymised test fixtures.

Do not place large attachments or repeated raw payloads directly in D1.

### 13.3 Data retention

Retention periods must follow Ramwall's approved records policy. Until that policy is documented:

- do not implement automatic deletion of finance records;
- do not retain redundant attachment copies indefinitely;
- use configurable retention classes;
- preserve audit logs and source hashes.

## 14. Required tables

Names may adapt to repository conventions, but the concepts are required.

### 14.1 Identity and access

- `users`
- `roles`
- `user_roles`
- `entity_permissions`

### 14.2 Entity, app assignment and mapping

- `entities`
- `entity_aliases`
- `entity_bank_accounts`
- `entity_xero_app_assignments`
- `group_account_mappings`
- `entity_account_overrides`
- `tracking_categories`
- `tracking_options`
- `project_code_mappings`
- `materiality_policies`
- `approval_policies`

Key fields for `entity_xero_app_assignments`:

- ID;
- entity ID;
- purpose;
- Xero app ID;
- connection ID;
- effective from/to;
- status: active, shadow migration, retired;
- approval event ID;
- created by/at;
- retired by/at.

Uniqueness rule: one active assignment per entity, purpose and environment, excluding explicitly controlled migration-shadow rows.

### 14.3 Xero apps, OAuth and connections

- `xero_apps`
- `xero_app_scope_profiles`
- `xero_app_approval_records`
- `xero_authorizations`
- `xero_connections`
- `xero_oauth_states`
- `xero_connection_events`
- `xero_rate_budgets`
- `xero_app_capacity_snapshots`

Key fields for `xero_apps`:

- ID and stable app key;
- Xero app display name;
- environment;
- purpose;
- tier and configured connection limit;
- scope-profile ID;
- redirect URI;
- client-ID secret reference;
- client-secret secret reference;
- operational owner and backup owner;
- compliance status;
- approval/exemption reference and date;
- enabled state;
- created, updated and retired timestamps.

Key fields for `xero_authorizations`:

- ID;
- Xero app ID;
- encrypted token set;
- encryption-key version;
- token expiry;
- granted scopes;
- refresh version;
- status;
- last refresh;
- last refresh error;
- authorising user identity.

Key fields for `xero_connections`:

- ID;
- Xero app ID;
- authorisation ID;
- Xero tenant ID and tenant type;
- Xero organisation name;
- connection status;
- first and last connected timestamps;
- last successful call;
- disconnected/revoked timestamp and reason.

Uniqueness rule: `xero_app_id + tenant_id` is unique among active connections.

### 14.4 Sync and lineage

- `sync_runs`
- `sync_jobs`
- `sync_cursors`
- `source_objects`
- `source_payload_hashes`
- `data_quality_events`

Every imported fact must include:

- source system;
- source Xero app, authorisation and connection where applicable;
- source tenant/entity;
- source resource type;
- source resource ID;
- source updated time;
- sync run ID;
- payload hash;
- normaliser version.

### 14.5 Xero reference data

- `xero_organisations`
- `xero_accounts`
- `xero_contacts`
- `xero_tax_rates`
- `xero_tracking_categories`
- `xero_tracking_options`

### 14.6 Xero transactions

- `xero_invoices`
- `xero_invoice_lines`
- `xero_credit_notes`
- `xero_payments`
- `xero_prepayments`
- `xero_overpayments`
- `xero_bank_transactions`
- `xero_bank_transaction_lines`
- `xero_bank_transfers`
- `xero_manual_journals`
- `xero_manual_journal_lines`

Use soft deletion or source status rather than physically deleting historical rows when Xero marks a resource voided or deleted.

### 14.7 Reports and budgets

- `report_snapshots`
- `report_rows`
- `budget_snapshots`
- `budget_rows`
- `board_pack_runs`
- `board_pack_sections`
- `consolidation_eliminations`

Report snapshots must be immutable by run. A refresh creates a new snapshot rather than silently replacing historical evidence.

### 14.8 Cash, loans and external schedules

- `bank_imports`
- `bank_balance_snapshots`
- `loan_register_snapshots`
- `loan_facilities`
- `loan_rates`
- `loan_covenants`

### 14.9 Rules, exceptions and workflow

- `rule_definitions`
- `rule_versions`
- `rule_runs`
- `exceptions`
- `exception_evidence`
- `exception_comments`
- `proposed_actions`
- `action_payload_versions`
- `approvals`
- `action_executions`
- `verification_results`
- `audit_events`

### 14.10 Attachments and extraction

- `attachment_metadata`
- `attachment_downloads`
- `document_extractions`
- `document_fields`

### 14.11 Payroll

- `timesheet_sources`
- `timesheet_imports`
- `timesheet_rows`
- `timesheet_mappings`
- `xero_timesheet_drafts`
- `timesheet_reconciliations`

## 15. Money storage and calculation

- Store currency explicitly.
- Preserve Xero amounts to four decimal places where provided.
- Use a decimal library or scaled 64-bit integer representation.
- Do not use binary floating point for totals, GST or variance tests.
- Store original amount, tax amount, gross amount and line-amount type.
- Apply rounding only at an explicitly documented reporting or Xero boundary.
- Derive GST rates from Xero tax-rate data, not a hard-coded 15% assumption.

## 16. Date handling

- Store timestamps in UTC.
- Store accounting dates as date-only strings.
- Render operational times in `Pacific/Auckland` unless user settings say otherwise.
- Preserve Xero's source timezone and date semantics.
- Distinguish:
  - invoice date;
  - due date;
  - payment date;
  - report as-at date;
  - source updated time;
  - sync time;
  - bank balance date;
  - file import time.

---

# Part XII — Sync Engine

## 17. Sync design

### 17.1 Sync modes

- initial backfill;
- scheduled incremental;
- user-requested refresh;
- targeted resource refresh;
- recovery/replay;
- full validation refresh.

### 17.2 Initial backfill policy

Default proposal:

- current financial year plus prior financial year for P&L and board reporting;
- all open invoices, bills, payments and intercompany items;
- sufficient historical supplier coding to establish a baseline;
- manual journals for the same periods;
- finalised GST reports available for the audit comparison period;
- longer history only when needed for a defined rule or report.

The backfill period must be configurable by entity and resource.

### 17.3 Incremental retrieval

Use Xero-supported mechanisms such as:

- `If-Modified-Since` where reliable;
- updated timestamps;
- paging;
- targeted date windows;
- open-status refreshes.

Do not assume every report endpoint is incrementally retrievable. Reports may need scheduled snapshots.

### 17.4 Per-app and per-tenant queue

Every sync job carries `xero_app_id`, `authorization_id`, `connection_id`, `tenant_id`, `entity_id` and resource.

Controls:

- one logical queue partition per app/tenant connection;
- no more than five concurrent calls per tenant/app connection;
- default operational concurrency below the hard limit;
- sixty-per-minute token bucket per tenant/app connection;
- daily budget with 20% reserve per tenant/app connection;
- 10,000-per-minute protection per app;
- app-specific egress tracking;
- exponential backoff for transient errors;
- `Retry-After` honoured for 429;
- circuit breaker after repeated auth or permission failures;
- one app or authorisation failure does not block unrelated app pools;
- token refresh lock keyed by app and authorisation.

Scheduled jobs are generated from active entity/app assignments, not from a hard-coded entity list.

### 17.5 Completeness and atomicity

A sync run may be:

- `queued`;
- `running`;
- `complete`;
- `partial`;
- `failed`;
- `cancelled`.

Never replace a complete visible snapshot with a partial one. Stage data, validate counts and checksums, then publish the run.

### 17.6 Sync dashboard

Show per entity, Xero app and resource:

- assigned app name, purpose and tier;
- app connection capacity used/remaining;
- connection status;
- last successful sync;
- last attempted sync;
- records read;
- calls used;
- egress estimate;
- cursor/watermark;
- error;
- stale-data warning;
- next scheduled run.

### 17.7 Attachments and egress control

- sync attachment metadata, not all bytes;
- download only on demand or when a rule requires evidence;
- cache by Xero attachment ID and checksum;
- never redownload unchanged files;
- monitor monthly egress separately for each app;
- create alerts at 70%, 85% and 95% of the applicable app allowance;
- on Starter, track bytes for operational visibility even where no paid egress allowance applies.

---

# Part XIII — Functional Requirements

## 18. Module A — Cash Position and Xero-to-Bank Variance

### CASH-001 — Preserve existing cash dashboard

All current validated Cash Position functionality must continue to work after remediation.

### CASH-002 — Loans excluded from available cash

The existing policy that loan facilities are not available cash must be encoded as a versioned rule, not duplicated code.

### CASH-003 — Source-date integrity

Every cash total shows:

- the as-at date of each bank source;
- the oldest source date included in the total;
- whether any account is stale.

### CASH-004 — Xero-to-bank balance comparison

For each mapped bank account:

```text
Actual bank balance from latest approved ASB/BNZ import
minus
Xero bank-account balance for the same effective date
=
variance requiring explanation
```

Do not label this as bank reconciliation.

### CASH-005 — Exception thresholds

Thresholds are configurable by entity and bank account. Support absolute and percentage thresholds.

### CASH-006 — Evidence

A variance must show:

- entity;
- bank account;
- bank source and balance date;
- Xero source and report date;
- amount;
- age;
- linked sync/import runs.

## 19. Module B — Board and Management Reporting

### BOARD-001 — Entity P&L

Pull P&L by entity for selectable periods with prior-period and prior-year comparisons.

### BOARD-002 — Group account mapping

Map entity account codes to a common group reporting structure. Mapping changes must be versioned and effective-dated.

### BOARD-003 — Consolidation

Produce:

- entity-level results;
- gross group aggregation before eliminations;
- intercompany elimination entries;
- consolidated result after eliminations;
- unresolved elimination differences.

### BOARD-004 — Tracking/project breakdown

Where supported, include Xero tracking-category breakdown and map it to Ramwall/Wunderbuild project codes.

### BOARD-005 — Board-pack structure

Seed the board pack with the established Ramwall format:

1. Executive Summary;
2. Cash and Liquidity;
3. Management Accounts Summary;
4. Adjusted Group Profit excluding approved WIP treatments;
5. Entity Review;
6. Ramwall and Ramwall Developments project view;
7. Balance Sheet and Reconciliations;
8. Debt and Funding;
9. Bank Credit Stress Test and Lender View;
10. Change from Prior Period;
11. Interest Rate and Lock-in Position;
12. Risks, Decisions and Future Actions.

The final section order and workbook layout must be verified against the current approved board-pack template.

### BOARD-006 — Materiality

Show exceptions and movements based on entity-specific and group thresholds. Support:

- absolute amount;
- percentage change;
- variance to budget;
- new account/activity;
- recurring versus one-off classification.

### BOARD-007 — WIP and adjusted performance

Support approved management adjustments such as excluding development WIP from operating profit. Every adjustment requires:

- rule or manual adjustment ID;
- entity and period;
- account/source lines;
- amount;
- reason;
- approver;
- before/after view.

### BOARD-008 — Exports

First release:

- web view;
- Excel export matching current conventions;
- CSV detail for audit.

PDF generation is optional and must not delay core delivery.

### BOARD-009 — Commentary

AI commentary is optional and generated only from a locked structured fact set. It must:

- cite the report rows or metrics used;
- never invent a driver not supported by data;
- distinguish fact, calculation and management explanation;
- be editable before inclusion;
- never change the numbers.

## 20. Module C — P&L Movement and Budget Variance

### VAR-001 — Prior-period movement

Show account movements against:

- prior month;
- same month prior year;
- year-to-date prior year;
- selected comparison.

### VAR-002 — Budget source priority

1. use detailed Xero budget data if the Phase 0 capability test confirms sufficient account and tracking detail;
2. otherwise import the approved budget workbook and pull actuals from Xero;
3. store budget version and approval date.

### VAR-003 — Exception view

Rank movements by materiality and show the top items, but allow full drill-down.

### VAR-004 — Commentary evidence

Any explanation created by a user or AI is stored separately from calculated variance facts.

## 21. Module D — Balance-Sheet Reconciliation

### BS-001 — Reconciliation workpapers

For each material account, support:

- Xero trial-balance amount;
- substantiating source;
- reconciled amount;
- difference;
- preparer;
- reviewer;
- status;
- evidence;
- period lock.

### BS-002 — Standard substantiations

- Accounts receivable to aged receivables.
- Accounts payable to aged payables.
- GST control to finalised report or reconstructed GST position.
- Intercompany to counterparty entity.
- Bank accounts to latest approved bank balance, clearly labelled as a balance comparison rather than statement-line reconciliation.
- Loans to the approved Loan Register.
- WIP to project cost schedules.
- Fixed assets to Xero Assets or an approved asset schedule where in scope.

### BS-003 — Sign and currency rules

Normalise debit/credit sign conventions and currency before comparison. Preserve source signs for evidence.

### BS-004 — Period status

Use:

- not started;
- in progress;
- reconciled;
- reconciled with timing difference;
- unresolved;
- reviewed;
- locked.

### BS-005 — No false completeness

If the required counterparty or supporting schedule is unavailable, mark the account `unsubstantiated` or `partial`. Do not infer a reconciliation.

## 22. Module E — Rules and Categorisation Exceptions

### RULE-001 — Versioned rule engine

Accounting rules are data, not scattered `if` statements. Each rule includes:

- ID and name;
- description;
- legal entities;
- effective dates;
- source resources;
- conditions;
- severity;
- materiality;
- evidence requirements;
- recommended action;
- owner;
- version and approval.

### RULE-002 — Initial rules

Implement configurable versions of:

- GST-bearing construction cost requires a project/Wunderbuild tracking code;
- mixed-project invoice requires line-level allocation;
- supplier coding differs materially from approved historical pattern;
- related-party cost has not been recharged;
- recharge contains an unapproved margin;
- deposit requires balance-sheet treatment;
- retention is recognised only under the approved policy;
- loan balance is excluded from available cash;
- development construction cost is treated under the approved WIP policy rather than ordinary P&L expense;
- non-GST-registered parties must not be treated as GST-registered;
- unusual or missing tax type;
- duplicate invoice or credit-note indicators;
- missing attachment where policy requires evidence.

### RULE-003 — Supplier-history anomaly

Use deterministic statistics first:

- dominant account code;
- dominant tax type;
- dominant tracking option;
- amount distribution;
- entity-specific behaviour;
- recency weighting.

An LLM may explain an anomaly but cannot decide the accounting code automatically.

### RULE-004 — Exception lifecycle

Use:

- detected;
- triaged;
- assigned;
- investigating;
- proposed fix;
- pending approval;
- resolved;
- accepted exception;
- false positive;
- closed.

Every status change is audited.

## 23. Module F — Intercompany Reconciliation

### IC-001 — Pair-first logic

An intercompany control is two-sided. Never mark an item matched or reconciled when only one entity is connected.

### IC-002 — Relationship registry

Store approved relationships such as:

- Ramwall (2010) recharges to property and development entities;
- CHH Trust treasury loans and interest recharges;
- Hebcohg management fees;
- Wallson-related management or property transactions;
- other approved group relationships.

Do not rely on contact names alone. Map Xero Contact IDs, accounts and expected counterparties.

### IC-003 — Matching hierarchy

Apply matching in tiers:

1. exact source/reference and equal amount;
2. invoice number/reference and equal amount within date tolerance;
3. equal amount and mapped counterpart within date tolerance;
4. grouped one-to-many or many-to-one amount match;
5. timing difference across periods;
6. probable match requiring review;
7. unmatched.

### IC-004 — Matching dimensions

Consider:

- entity pair;
- counterparty contact ID;
- intercompany account;
- invoice/reference;
- date and due date;
- gross, net and GST;
- currency;
- sign reversal;
- tracking/project;
- payment status;
- source resource type.

### IC-005 — Statuses

- matched;
- matched with timing difference;
- matched with GST difference;
- matched with amount difference;
- missing in Entity A;
- missing in Entity B;
- one side not connected;
- excluded by approved rule;
- needs review.

### IC-006 — Consolidation elimination

Matched balances and transactions may feed elimination entries. Unmatched differences remain visible and cannot be silently eliminated.

### IC-007 — Treasury relationships

For CHH Trust relationships, distinguish:

- principal;
- interest;
- fees;
- repayments;
- capitalised interest;
- timing differences;
- one-sided journals.

### IC-008 — Recharge policy

For group recharges, compare:

- originating cost;
- recharged amount;
- GST basis;
- margin policy;
- project/entity allocation;
- recharge date;
- status of draft or authorised invoice.

### IC-009 — Pilot acceptance

The pilot must demonstrate at least:

- one CHH Trust loan or interest pair;
- one Ramwall recharge pair;
- one timing difference;
- one missing counter-entry;
- one many-to-one match;
- correct refusal to reconcile a one-sided entity.

## 24. Module G — GST Audit and Reconciliation

### GST-001 — Two operating modes

**Finalised-report mode**

- retrieve the published NZ GST report;
- map report boxes and period;
- reconcile to transaction-level data and control accounts.

**Pre-filing reconstruction mode**

- calculate the position from invoices, bills, credit notes, bank transactions, manual journals, payments and tax types;
- state that it is reconstructed and not a filed Xero return;
- compare to any available draft/export provided by the user.

### GST-002 — Transaction coverage

The audit must account for relevant:

- ACCREC and ACCPAY invoices;
- credit notes;
- spend and receive money bank transactions;
- payments-basis timing where applicable;
- manual journals with tax types;
- prepayments and overpayments where material;
- voided and deleted status;
- period cut-off.

### GST-003 — Core tests

- missing project code on GST-bearing project costs;
- incorrect tax type against supplier/account history;
- zero-rated or exempt treatment anomaly;
- duplicate invoice, bill or credit;
- transaction outside the return period;
- GST on deposits and retentions inconsistent with policy;
- GST-bearing manual journal not included in the expected control;
- intercompany GST mismatch;
- amount/tax arithmetic mismatch;
- missing or inconsistent GST registration information;
- attachment missing for material claim;
- cash-versus-invoice-basis timing difference.

### GST-004 — Evidence

Every finding must show:

- Xero organisation;
- resource type and ID;
- document number/reference;
- contact;
- date;
- account;
- tracking/project;
- net, GST and gross amount;
- tax type;
- GST period and relevant box/category;
- rule and reason;
- source attachment where available.

### GST-005 — Reconciliation output

Show:

- Xero report total or reconstructed total;
- transaction-derived total;
- control-account amount;
- known adjustments;
- unresolved difference;
- exception count and value by category.

### GST-006 — Deterministic calculation

Use the rules engine and decimal arithmetic. AI may summarise findings but cannot calculate the return.

### GST-007 — Manual journal limitation

Manual journals are available, but reserved-account rules and tax handling must be tested in the Demo Company. The application must not assume every GST correction can be made by a manual journal.

## 25. Module H — Debt, Funding and Lender View

### DEBT-001 — Source of truth

The approved Loan Register remains the detailed source for facility limits, lender, term, rate, maturity, security and covenant data. Xero supports actual interest and balance checks but does not replace the register.

### DEBT-002 — Facility view

Show by entity and lender:

- facility limit;
- drawn balance;
- available amount;
- fixed/floating split;
- rate;
- maturity;
- principal-versus-interest-only status;
- security group;
- covenant threshold;
- source date.

### DEBT-003 — Xero comparison

Compare relevant Xero loan and interest accounts to the Loan Register and flag differences.

### DEBT-004 — Covenant and stress tests

Support configurable calculations such as:

- LVR for the ASB charging group;
- interest-rate sensitivity;
- debt-service coverage where inputs are approved;
- upcoming expiries;
- liquidity after committed payments.

Do not hard-code the 55% covenant or any facility term outside versioned entity/lender configuration.

### DEBT-005 — Lender adjustments

Maintain a transparent schedule of lender reporting adjustments, including depreciation, intercompany charges, management fees and other approved add-backs or removals. Each adjustment needs evidence and period-specific approval.

## 26. Module I — Attachments and Document Extraction

### DOC-001 — Metadata first

Retrieve attachment metadata during sync. Download bytes only when:

- a user opens the evidence;
- a rule requires the document;
- an extraction job is requested;
- the document is not already cached.

### DOC-002 — Extraction pipeline

Use this order:

1. structured Xero fields;
2. native PDF text extraction;
3. supplier-specific template extraction;
4. OCR only when needed;
5. optional LLM extraction for genuinely unstructured documents.

### DOC-003 — Runtime placement

Do not run Tesseract or heavy PDF processing inside a normal Cloudflare Worker. Use a controlled local or Node-compatible runner and write the results back through an authenticated job interface.

### DOC-004 — Data controls

- checksum every file;
- retain source and extraction version;
- redact unnecessary personal data before external AI use;
- no provider training;
- record provider, model, prompt version and fields returned;
- human validation before extracted data can support a write.

## 27. Module J — Optional AI Assistance

### AI-001 — Optional architecture

The system must operate without an AI provider. Implement AI behind a provider interface and feature flag.

### AI-002 — Approved uses

- board-pack narrative from structured facts;
- summarising exception clusters;
- mapping messy timesheet notes to candidate project codes;
- extracting fields from unseen document layouts;
- answering read-only questions over already-normalised data.

### AI-003 — Prohibited uses

- computing accounting totals;
- deciding whether a reconciliation balances;
- choosing a final account code without policy/human approval;
- approving or executing a Xero write;
- training or fine-tuning on Xero API data;
- receiving complete datasets when a small exception payload is enough.

### AI-004 — Output controls

- JSON-schema output;
- deterministic validation;
- confidence and reason fields;
- source IDs;
- no free-form tool payload sent directly to Xero;
- cost and token telemetry;
- prompt versioning.

## 28. Module K — Proposed Fixes and Controlled Write-Back

### WRITE-001 — Separate proposal from execution

The state machine is:

```text
exception detected
→ investigation complete
→ proposed action created
→ deterministic validation
→ pending human approval
→ approved or rejected
→ queued for execution
→ sent to Xero with idempotency key
→ read-back verification
→ applied, failed or manual follow-up
```

There is no direct path from detection or AI output to execution.

### WRITE-002 — Initial permitted action types

Subject to governance approval:

- update account code or tracking on an editable draft invoice/bill;
- create a draft recharge invoice;
- create a draft manual journal;
- update an editable draft manual journal;
- create a draft timesheet or add timesheet lines;
- create or update a contact where needed for a draft workflow;
- attach evidence to a newly created draft resource.

### WRITE-003 — Initially prohibited action types

- authorise invoice or bill;
- post a manual journal automatically;
- create or approve a payment;
- approve a timesheet;
- create or post a pay run;
- file GST;
- alter bank reconciliation;
- void an authorised transaction without a separate approved workflow.

### WRITE-004 — Action payload

Every proposed action must contain:

- action type and schema version;
- entity, Xero app registration, connection and tenant;
- source exception and evidence IDs;
- resource ID and current status;
- before-state snapshot;
- proposed after-state;
- amount, tax and tracking impact;
- accounting reason;
- rule/version that generated it;
- preparer;
- required approver role;
- materiality and risk rating;
- idempotency key;
- expiry/revalidation date.

### WRITE-005 — Revalidation before execution

Immediately before writing:

- re-read the Xero resource;
- confirm the tenant ID;
- confirm resource status remains editable;
- confirm source version/updated time has not changed;
- re-run deterministic validation;
- reject execution if the resource changed after approval.

### WRITE-006 — Idempotency

Use two layers:

1. application-level unique logical action ID and database constraint;
2. Xero `Idempotency-Key` for the mutating request where supported.

A retry must reuse the exact payload and key within the Xero idempotency window. If an error is ambiguous, read Xero before attempting a new key.

### WRITE-007 — Read-back verification

After execution, GET the resource and compare the expected fields. Store the Xero response ID, updated time and verification result.

### WRITE-008 — Approval model

Roles:

- preparer: can create and edit proposals;
- approver: can approve within delegated threshold;
- senior approver: required above configurable materiality or for manual journals;
- administrator: manages configuration but cannot bypass accounting approval.

A user cannot approve their own proposal where segregation-of-duties policy requires separation.

### WRITE-009 — Rollback

Per action type, document:

- whether automated rollback is supported;
- status preconditions;
- compensating action;
- manual instruction;
- approval requirement.

Do not use one generic Undo implementation.

## 29. Module L — SharePoint to Xero Payroll Timesheets

### PAY-001 — Isolation

Payroll is a separate module, feature flag, permission set, audit stream and release gate.

### PAY-002 — Source discovery

Phase 0 must confirm:

- SharePoint site and library/list;
- file or list format;
- employee identifiers;
- pay period fields;
- project/job reference fields;
- approval status;
- revision behaviour.

### PAY-003 — Validation

Before creating a Xero draft:

- employee exists and is active;
- pay calendar and period match;
- hours are within configured limits;
- duplicate source timesheet is absent;
- earning rate is mapped;
- project/tracking mapping is valid;
- source is approved for import under Ramwall process.

### PAY-004 — Project mapping

Map free text to Wunderbuild/project codes using:

1. exact mapping;
2. alias mapping;
3. deterministic pattern;
4. AI candidate suggestion;
5. human selection if unresolved.

### PAY-005 — Draft only

The app may create draft Xero timesheets and lines. It must never call Approve Timesheet and never touch pay runs.

### PAY-006 — Reconciliation

Show SharePoint hours versus Xero draft hours by:

- employee;
- date;
- earning rate;
- project/tracking;
- total period.

### PAY-007 — Duplicate protection

Use source-system ID, employee, period and row hash to prevent duplicate imports.

---

# Part XIV — User Interface and Permissions

## 30. Required application areas

1. **Home / Finance Watchtower**
   - cash;
   - exceptions;
   - stale entities;
   - unresolved intercompany;
   - GST risk;
   - pending approvals.

2. **Entities**
   - mappings;
   - assigned Xero app registration by capability class;
   - connection health;
   - last sync;
   - permissions;
   - materiality.

3. **Cash and Liquidity**
   - current bank imports;
   - available cash;
   - loans excluded;
   - Xero variance;
   - source dates.

4. **Board Pack**
   - period selector;
   - group/entity views;
   - eliminations;
   - export;
   - commentary draft.

5. **Reconciliations**
   - balance sheet;
   - supporting schedules;
   - preparer/reviewer workflow.

6. **Intercompany**
   - pair matrix;
   - matched/unmatched;
   - timing differences;
   - drill-down;
   - eliminations.

7. **GST Audit**
   - finalised/reconstructed mode;
   - reconciliation;
   - exceptions;
   - evidence export.

8. **Exceptions**
   - filters;
   - severity;
   - assignment;
   - evidence;
   - status.

9. **Fix Queue**
   - proposed before/after;
   - financial impact;
   - approval;
   - execution and verification.

10. **Timesheets**
    - source imports;
    - mapping;
    - validation;
    - draft status;
    - reconciliation.

11. **Debt and Funding**
    - facilities;
    - rates;
    - covenants;
    - lender adjustments.

12. **Xero Apps and Connections**
    - app registrations by environment and purpose;
    - tier, capacity used and remaining;
    - scope profile and compliance status;
    - app owner and approval reference;
    - authorisations and tenant connections;
    - entity read/write/payroll assignment matrix;
    - OAuth connect, reauthorise, migrate and retire workflows;
    - rate, egress and health dashboards.

13. **Settings**
    - entity registry;
    - account mapping;
    - rules;
    - materiality;
    - approval policy;
    - AI provider controls;
    - audit log.

## 31. Role model

Seed roles:

| Role | Access |
|---|---|
| Finance Controller | Full read, configuration, prepare and approve within policy, release reports |
| Finance Preparer / VA | Read assigned entities, prepare reconciliations and proposals, no execution approval |
| Finance Reviewer | Review reconciliations and exceptions, approve within policy |
| Board Viewer | Read released board packs only |
| Payroll Preparer | Timesheet preparation and validation only |
| Payroll Approver | Reviews in Xero; app does not approve |
| System Administrator | Technical operations and connections; no implied accounting approval |
| Service Account | Scheduled sync only, no interactive login |

Use existing authentication if suitable. Do not create a second identity system without an ADR. Prefer Microsoft Entra ID / Cloudflare Access for the internal app if the current repository lacks robust authentication.

## 32. UX controls

- visible environment banner for local, staging and production;
- visible live-Xero indicator before any write;
- entity, tenant and Xero app/purpose shown on every write screen;
- stale-data badge;
- partial-sync warning;
- before/after financial impact;
- confirm dialog requiring typed entity short code for high-risk actions;
- no bulk write without item-level review and total impact;
- downloadable evidence pack.

---

# Part XV — Security, Privacy and Compliance

## 33. Security requirements

### SEC-001 — Least privilege

Request only current-phase scopes and restrict users by entity and role.

### SEC-002 — Secrets

Use Cloudflare secret storage. No credentials in D1 except encrypted token payloads. No secrets in client bundles.

### SEC-003 — Encryption

- TLS in transit;
- AES-256-GCM token encryption;
- R2 server-side encryption plus application controls;
- encryption-key rotation procedure.

### SEC-004 — Audit log

Append-only audit events for:

- login;
- connection and disconnection;
- scope change;
- sync run;
- rule/config change;
- exception change;
- approval;
- write attempt;
- write result;
- export;
- data deletion.

### SEC-005 — Data minimisation

Store only what is needed for the defined module, audit evidence and approved retention.

### SEC-006 — AI controls

- no training/fine-tuning;
- provider no-training/zero-retention setting where available;
- approved provider register;
- minimum necessary fields;
- no tokens or credentials;
- record each AI invocation and purpose;
- ability to disable globally.

### SEC-007 — Browser automation prohibition

No Playwright, Puppeteer, browser extension or RPA may sign in to Xero or simulate Xero user actions as a workaround.

### SEC-008 — Tenant isolation tests

Every server query and action must enforce entity/tenant permission from trusted session context. Add tests that attempt cross-tenant IDs.

### SEC-009 — Dependency security

- lockfile committed;
- dependency scanning;
- secret scanning;
- critical vulnerability policy;
- third-party notices;
- package provenance reviewed for Xero and AI libraries.

### SEC-010 — Production access

- 2FA through identity provider;
- least-privilege admin access;
- no shared user accounts;
- break-glass procedure;
- connection owner and backup owner documented.

### SEC-011 — Multi-app credential isolation

- independent secret references for every app;
- no global singleton Xero token client;
- cache keys include Xero app ID;
- refresh locks include Xero app ID;
- logs include app key but redact client IDs and all secrets;
- one app may be disabled or rotated without affecting another;
- automated tests prove that a token from app A cannot be used for app B;
- production same-purpose multi-app mode is blocked without the required compliance record.

## 34. Xero terms compliance checklist

- [ ] API data is not used to train or fine-tune a model.
- [ ] No browser automation or security-control bypass.
- [ ] Current developer terms accepted by the correct legal entity.
- [ ] Current tier and billing method recorded.
- [ ] Connection count and egress monitored.
- [ ] App-slot limits checked.
- [ ] Granular scopes used.
- [ ] Data-use and privacy notice approved internally.
- [ ] Exemption status, if claimed, confirmed by Xero in writing.
- [ ] Every Xero app has a documented, approved use case and owner.
- [ ] Multiple same/similar production apps are not being used to bypass limits without Xero's written consent.
- [ ] App-specific connection counts, egress and rate limits are monitored.
- [ ] Each entity/purpose has one unambiguous active app assignment.

---

# Part XVI — Observability, Operations and Recovery

## 35. Operational telemetry

Capture:

- request count by Xero app, tenant and resource;
- app connection count and remaining capacity;
- app compliance status;
- 429 and retry count;
- daily-limit remaining;
- app-minute remaining;
- egress estimate;
- sync duration;
- records created/updated/voided;
- token refresh count and failures;
- exception counts;
- write success/failure/verification;
- AI usage and cost;
- R2/D1 usage.

Do not log raw financial payloads by default.

## 36. Alerts

At minimum:

- Xero reauthorisation required;
- Xero app registration nearing connection capacity;
- registration compliance status blocks activation;
- registration credential/callback failure affecting multiple assigned entities;
- scheduled sync missed;
- partial sync published attempt;
- rate budget below reserve;
- per-app egress thresholds;
- app capacity at 80%, 100% and attempted overflow;
- multi-app compliance gate failure;
- stale bank CSV;
- failed write or verification mismatch;
- unresolved high-severity GST exception;
- token decryption or key-version failure;
- data lineage gap.

## 37. Backup and recovery

Document and test:

- D1 backup/export and restore;
- R2 object versioning or recovery policy;
- encryption-key backup and rotation;
- rebuild of normalised data from source objects;
- Xero reconnection under the correct app;
- migration from one app assignment to another;
- replay of a failed sync;
- recovery from a partially executed action.

The raw source and lineage model should make most normalised facts reproducible.

## 38. Feature flags

Required flags:

- Xero connection globally and per app registration;
- multi-app registry and router;
- production multi-app activation;
- scheduled sync;
- each major report module;
- AI commentary;
- document extraction;
- proposed actions;
- live Xero write execution;
- payroll;
- bulk actions.

Production write execution defaults to off.

---

# Part XVII — Testing and Acceptance

## 39. Test strategy

### 39.1 Unit tests

- money and rounding;
- Xero date normalisation;
- sign conventions;
- GST calculations;
- account and entity mapping;
- materiality;
- intercompany matching;
- consolidation eliminations;
- idempotency logic;
- approval state machine;
- stale-data logic.

### 39.2 Contract tests

Against recorded, anonymised API shapes:

- invoices and bills;
- bank transactions;
- manual journals;
- reports;
- tracking;
- attachments metadata;
- payroll timesheets.

### 39.3 Xero Demo Company integration tests

- OAuth and tenant selection;
- token refresh and rotation;
- pagination;
- 429 retry simulation;
- read-only reports;
- draft invoice creation;
- draft manual journal creation;
- draft timesheet creation;
- attachment upload where approved;
- read-back verification.

No live-write test is permitted until Demo Company tests pass.

### 39.4 Multi-entity and multi-app tests

- two tenants under one authorisation for the same app where supported;
- two or more independent Xero app registrations;
- five mock connections in app A and five in app B;
- correct entity-to-app routing for reads;
- correct explicit app routing for writes and payroll;
- no automatic write fallback to a read app;
- cross-app board-pack consolidation;
- intercompany pair where each side is connected through a different app;
- distinct tenant data never crosses;
- token from app A is rejected for app B;
- refresh updates only the correct app/authorisation;
- rate budgets are isolated by app and connection;
- one disconnected app does not corrupt other entity data;
- duplicate same-purpose active assignment is rejected;
- migration shadow data is excluded from normal reports;
- production multi-app mode is blocked when compliance approval is absent.

### 39.5 Golden-file tests

Use approved anonymised outputs for:

- board pack;
- GST audit;
- intercompany report;
- cash dashboard;
- balance-sheet workpaper;
- Excel export.

### 39.6 Write safety tests

- double click;
- network timeout after Xero accepts request;
- same idempotency key and same payload;
- same key and changed payload;
- resource changed after approval;
- wrong entity/tenant;
- expired approval;
- insufficient scope;
- write succeeds but verification differs;
- rollback unsupported.

### 39.7 Security tests

- OAuth state replay;
- forged tenant ID;
- role escalation;
- token exposure in logs;
- secret exposure in client bundle;
- malformed upload;
- spreadsheet formula injection in exports;
- attachment content-type mismatch;
- AI prompt injection from document text.

## 40. Phase acceptance gates

### Gate A — Foundation

- no accounting policy in presentation code;
- server-side replayable bank imports;
- no GET writes;
- source dates correct;
- existing dashboard regression tests pass.

### Gate B — Xero read integration

- Demo Company and at least one approved live entity connect;
- app registry and deterministic router are operational;
- token refresh survives expiry and remains isolated by app;
- sync dashboard is accurate;
- no tenant leakage;
- P&L, BS and TB reconcile to Xero for test periods.

### Gate C — Multi-entity reporting

- entity and app assignments approved;
- board-pack values reconcile to source reports across app boundaries;
- cash variance evidence is complete;
- stale-data warnings work.

### Gate D — Intercompany and GST

- two-sided matching scenarios pass;
- one-sided relationships are not falsely reconciled;
- historical GST fixture passes;
- finalised and reconstructed modes are clearly distinguished.

### Gate E — Write-back

- governance ADR approved;
- scopes, app model and write-app assignment approved;
- Demo Company write tests pass;
- audit, idempotency and verification pass;
- production feature flag remains off until formal sign-off.

### Gate F — Payroll

- source format approved;
- duplicate protection passes;
- draft-only flow verified;
- no approval/pay-run API exists in code path.

---

# Part XVIII — Delivery Plan

## 41. Revised implementation phases

The earlier 31-day estimate covered a narrower feature set and did not fully include production auth, tenant isolation, evidence, approval, observability, security and test requirements. Use the ranges below for planning.

### Phase 0 — Repository audit and foundation remediation

**Estimated:** 4–7 focused developer days

Deliver:

- current-state audit;
- four ADRs;
- remediation requirements REM-001 to REM-007;
- test harness;
- environment separation;
- Xero SDK/Worker spike;
- Xero app-slot and permissions checklist.

### Phase 1 — Xero app registry, OAuth, routing and sync foundation

**Estimated:** 8–13 days

Deliver:

- multi-app registry and secure secret resolution;
- purpose/scope profiles and compliance states;
- app-specific OAuth flow;
- encrypted authorisation model linked to app IDs;
- deterministic entity-to-app routing;
- tenant mapping and effective-dated assignments;
- connection health and capacity dashboard;
- accounts, contacts, tracking and organisation sync;
- per-app/per-tenant queue and rate budget;
- cross-app normalisation;
- sync dashboard.

### Phase 2 — Transaction sync and read-only finance views

**Estimated:** 7–11 days

Deliver:

- invoices/bills;
- bank transactions;
- payments;
- manual journals;
- report snapshots;
- P&L, BS, TB, cash variance;
- data lineage and drill-down.

### Phase 3 — Board reporting, budgets and debt view

**Estimated:** 6–10 days

Deliver:

- group account mappings;
- prior-period movement;
- budget actual;
- board-pack web/Excel output;
- Loan Register import and debt view;
- approved management adjustments.

### Phase 4 — Rules, exceptions and project coding

**Estimated:** 5–8 days

Deliver:

- versioned rules engine;
- initial project/GST/coding rules;
- supplier-history anomaly;
- exception workflow;
- evidence export.

### Phase 5 — Intercompany and balance-sheet reconciliation

**Estimated:** 7–12 days

Deliver:

- relationship registry;
- matching engine;
- pair matrix;
- consolidation eliminations;
- reconciliation workpapers;
- reviewer workflow.

### Phase 6 — GST audit

**Estimated:** 6–10 days

Deliver:

- finalised GST report mode;
- pre-filing reconstruction;
- transaction tests;
- control reconciliation;
- historical regression fixture;
- audit export.

### Phase 7 — Proposed actions and controlled write-back

**Estimated:** 8–14 days

Deliver:

- proposal and approval state machine;
- deterministic payload validation;
- idempotent execution;
- read-back verification;
- initial approved action types;
- audit log;
- per-action rollback documentation.

### Phase 8 — Payroll timesheets

**Estimated:** 5–9 days

Deliver:

- SharePoint source adapter;
- employee/pay-calendar validation;
- project mapping;
- duplicate protection;
- draft Xero timesheets;
- reconciliation.

### Phase 9 — Optional AI and document extraction

**Estimated:** 4–8 days

Deliver:

- provider abstraction;
- no-training controls;
- board commentary;
- local/runner extraction pipeline;
- AI audit telemetry.

## 42. Overall effort range

| Delivery target | Focused developer effort | Likely part-time calendar |
|---|---:|---:|
| Read-only five-entity pilot with multi-app-ready foundation | 19–29 days | 7–11 weeks |
| Production read-only platform across active entities | 38–60 days | 3–6 months |
| Full system including write-back, payroll and optional AI | 54–86 days | 5–8 months |

The multi-app registry/router adds modest initial effort but avoids a high-risk authentication and schema rewrite later. These are implementation ranges, not elapsed time guarantees. Xero authorisation, accounting-rule decisions, app approval, data mapping and acceptance testing can dominate calendar time.

### 42.1 Shivana's expected input

Plan for approximately 3–5 working days spread across the project for:

- entity scope, app-registration purpose, ownership and compliance evidence;
- account and group mapping;
- materiality thresholds;
- intercompany relationships;
- GST and WIP policy;
- Loan Register mapping;
- board-pack acceptance;
- approval matrix;
- validation of exceptions and reports.

---

# Part XIX — Cost Model

## 43. Xero platform cost

### 43.1 One Starter app

- no monthly Xero developer fee for up to five connections;
- 1,000 API calls per day per organisation;
- suitable for Demo Company and a carefully selected five-entity pilot;
- no per-call fee.

### 43.2 Multiple Starter app registrations

Technically, connection counts are measured separately for each app. Therefore, if Xero approves the use cases, two Starter apps could each hold up to five connections and the Xero developer tier fee for those apps would be zero.

Do **not** treat that as the default budget or entitlement. Xero's terms prohibit attempts to bypass usage limits and multiple versions of an app doing the same or similar thing. The system may operate this mode only where:

- the apps have genuinely distinct approved purposes; or
- Xero has confirmed the multi-app structure or bespoke exemption in writing.

Until that confirmation exists, budget Core for the sixth same-purpose connection.

### 43.3 One Core app

- AUD 35 per month, tax exclusive;
- up to fifty connections;
- 5,000 calls per day per organisation;
- 10 GB monthly egress;
- AUD 2.40 per excess GB;
- recommended default for full-group same-purpose read coverage.

There is no per-call fee.

### 43.4 Separate read and write apps

If read and write/payroll are genuinely separated:

- each app has its own tier and connection count;
- if each remains at five or fewer connections and the structure is approved, each may remain Starter;
- if both connect more than five entities, budget two Core app fees: AUD 70 total per month before tax;
- each connected organisation may consume both uncertified-app slots.

### 43.5 Custom Connection comparison

- one organisation per Custom Connection;
- separate monthly subscription per organisation;
- useful only for exceptional single-organisation or app-slot cases;
- not recommended as the main group-wide architecture.

### 43.6 Possible bespoke exemption

Xero states that some bespoke integrations for accountants and bookkeepers built for their own practice or a single client may be excluded from the new app-tier pricing model at Xero's discretion.

Do not assume Ramwall qualifies. Ask Xero and retain the written response in `xero_app_approval_records`.

## 44. Other running costs

| Item | Expected treatment |
|---|---|
| Existing Cloudflare Worker/D1 | Reuse; verify current plan and limits |
| R2 storage and egress | Low at expected volume; monitor rather than assume zero |
| Cloudflare Queues/Durable Objects | Depends on selected architecture and plan |
| AI API | Optional; initially off or low-use only |
| OCR runner | Local or small controlled runner; operational cost depends on hosting |
| Claude Code | Development subscription, not runtime dependency |

### 44.1 Practical monthly operating budgets

Use scenario-based budgets:

| Scenario | Xero developer tier cost | Conservative total operating budget |
|---|---:|---:|
| One Starter app, up to five entities | AUD 0 | Approximately NZD 20–60/month depending on Cloudflare/AI |
| Approved multiple Starter apps, each at five or fewer | Potentially AUD 0 | Approximately NZD 25–75/month; approval required |
| One Core app for the group | AUD 35 + tax | Approximately NZD 65–100/month |
| Separate read and write Core apps | AUD 70 + tax | Approximately NZD 110–160/month |

Actual AI, Cloudflare, egress and FX usage must be measured before finalising the budget.

# Part XX — Risk Register

## 45. Key risks and controls

| Risk | Consequence | Required control |
|---|---|---|
| Wrong Xero tenant used | Change to wrong legal entity | Server-side entity mapping, explicit full call context, revalidation and tests |
| Wrong Xero app selected | Token failure, wrong scopes or governance breach | Deterministic app router, effective-dated assignments, fail closed on ambiguity |
| Cross-app token contamination | Security incident and broken authorisation | App-scoped token store, cache keys and refresh locks; isolation tests |
| Refresh-token race | Broken authorisation | App+authorisation keyed Durable Object/lease |
| Duplicate same-purpose Starter apps used as a limit bypass | Xero terms breach or suspension | Production compliance gate, written Xero approval/exemption, Core fallback |
| App capacity exceeded | Cannot connect entity | Capacity dashboard, pre-OAuth check and approved tier/app decision |
| App slots already full | Cannot connect entity or second purpose app | Phase 0 Connected Apps audit and contingency plan |
| App assignment changed without controlled cutover | Duplicate or missing data | Effective dates, migration shadow mode, dual-read comparison and sign-off |
| Partial sync appears current | Incorrect reporting | Stage, validate and publish; stale/partial banner |
| Floating-point rounding | Financial differences | Decimal/scaled-integer domain type |
| Duplicate write | Duplicate invoice/journal/timesheet | DB uniqueness, Xero idempotency, read-before-retry |
| Resource changes after approval | Stale or wrong correction | Re-read and compare version before execution |
| One-sided intercompany | False reconciliation | Pair-first rule and `counterparty unavailable` status |
| Premium Journals unavailable | Incomplete GL detail | Transaction resources, reports and ManualJournals; disclose limitation |
| Attachment egress spike | Unexpected cost | Metadata-first, cache-once and per-app egress monitoring |
| AI hallucination | Misleading explanation or action | Structured facts, schema validation, no direct writes |
| Xero terms breach | Access suspension | No training, no browser automation, approved use cases and compliance evidence |
| Hard-coded accounting rules | Silent stale policy | Database-backed versioned rules and approval |
| Stale bank CSV | Misleading liquidity | Source-date display and alerts |
| Payroll duplicate | Incorrect hours | Source hash and period/employee uniqueness |
| Unverified rollback | False sense of safety | Per-action rollback matrix and manual reversal |
| Cloudflare SDK incompatibility | Delayed integration | Phase 0 multi-app spike and typed REST fallback |
| Sensitive data in logs | Privacy/security incident | Structured redacted logs and secret scanning |
| Mapping changes alter history | Inconsistent reports | Effective-dated mappings and immutable snapshots |

# Part XXI — Decision Register

## 46. Decisions required before or during build

### Before Phase 1

1. Confirm actual repository and deployment environment.
2. Confirm active in-scope entities and which have separate Xero organisations.
3. Confirm Connected Apps slots and authorising-user permissions.
4. Define the initial Xero app registry: app names, environments, purposes, owners and scope profiles.
5. Decide the initial deployment mode: one Starter app, approved multiple apps, or Core.
6. If multiple same-purpose Starter apps are proposed, obtain and record Xero's written approval or exemption before production activation.
7. Confirm the first five-entity pool and any planned second pool.
8. Confirm historical backfill window.
9. Confirm whether the Xero bespoke-pricing exemption will be queried.

### Before Phase 3

10. Provide current approved board-pack template.
11. Approve group account mapping and WIP adjustments.
12. Confirm budget source by entity.
13. Provide approved Loan Register format and covenant rules.

### Before Phase 4

14. Approve initial accounting-rule catalogue.
15. Confirm Wunderbuild/project mapping source.
16. Confirm GST-registration exceptions and effective dates.
17. Approve materiality thresholds and exception severities.

### Before Phase 5

18. Approve intercompany relationship registry.
19. Confirm expected margin and GST policy for each recharge relationship.
20. Confirm consolidation elimination rules.
21. Approve cross-app pair coverage and identify any unconnected counterparties.

### Before Phase 7

22. Decide one app versus separate read/write apps.
23. Approve permitted write action types.
24. Approve each entity's explicit write-app assignment.
25. Approve approval matrix and segregation of duties.
26. Approve materiality thresholds for single and bulk writes.
27. Approve rollback/compensating-action procedures.

### Before Phase 8

28. Confirm SharePoint location and timesheet schema.
29. Confirm Payroll Admin and review process.
30. Confirm earning-rate and project mappings.
31. Approve the payroll app and entity assignments.

### Before Phase 9

32. Approve AI provider, no-training setting and data-handling control.
33. Approve whether local model/runner is operationally acceptable.
34. Approve which document types may be sent to an external model.

# Part XXII — Requirements Traceability Summary

## 47. Minimum traceability matrix

Claude Code must expand this into `docs/requirements-traceability.md` with code, migration and test references.

| Requirement group | Phase | Primary proof |
|---|---:|---|
| REM-001 to REM-007 | 0 | repository diff and regression tests |
| OAuth/token/tenant controls | 1 | Demo OAuth, refresh and isolation tests |
| Sync and lineage | 1–2 | sync dashboard, source IDs and replay test |
| CASH | 2 | reconciled cash fixtures and stale-date tests |
| BOARD / VAR / DEBT | 3 | golden workbook and source drill-down |
| RULE | 4 | rule fixtures and exception lifecycle tests |
| IC / BS | 5 | pair scenarios and reconciliation workpapers |
| GST | 6 | historical regression and finalised/reconstructed tests |
| WRITE | 7 | Demo write, idempotency, approval and verification tests |
| PAY | 8 | duplicate-safe draft timesheet test |
| DOC / AI | 9 | extraction fixture, provider audit and schema tests |
| SEC / operations | all | security tests, logs, alerts and runbooks |

---

# Part XXIII — Final Definition of Done

## 48. The project is complete only when

### Data and reporting

- all approved active entities are connected or have an explicit documented exclusion;
- scheduled incremental sync is stable;
- source lineage is available from every report figure and exception;
- board-pack outputs reconcile to Xero and approved external schedules;
- cash totals carry correct source dates;
- budgets and debt schedules are versioned;
- partial or stale data cannot appear as current without warning.

### Controls

- intercompany reconciliation is pair-aware and tested;
- GST audit supports finalised and reconstructed modes;
- rules and materiality are versioned and approved;
- balance-sheet workpapers support preparer/reviewer workflow;
- exception evidence is exportable.

### Writes

- no write path bypasses proposal, approval, revalidation, idempotency and read-back verification;
- live write feature flag is off by default;
- each action type has a tested rollback or manual reversal procedure;
- payroll remains draft-only;
- payment, pay-run, GST filing and bank reconciliation actions are absent unless separately approved in a future specification.

### Security and operations

- tokens are encrypted and rotation is tested;
- tenant isolation tests pass;
- no secrets or live data are present in source control;
- Xero rate limits and egress are monitored;
- AI controls comply with Xero terms;
- backup, recovery and reconnection runbooks are tested;
- production access and roles are approved.

### Documentation

- architecture decisions are current;
- setup and deployment instructions work from a clean environment;
- source mappings and rule ownership are documented;
- third-party notices are complete;
- user guide and operations runbook exist;
- known limitations are visible in the application and documentation.

---

# Part XXIV — Authoritative Reference Links

The implementation team must re-check these sources at the start of each relevant phase because Xero's platform changed materially in 2026.

## Xero documentation

- Pricing and tiers: <https://developer.xero.com/pricing>
- Pricing and policy FAQ: <https://developer.xero.com/faq/pricing-and-policy-updates>
- OAuth overview: <https://developer.xero.com/documentation/guides/oauth2/overview>
- OAuth limits: <https://developer.xero.com/documentation/guides/oauth2/limits>
- Tenants and connections: <https://developer.xero.com/documentation/guides/oauth2/tenants/>
- Managing connections: <https://developer.xero.com/documentation/best-practices/managing-connections/connections>
- Granular scopes: <https://developer.xero.com/documentation/guides/oauth2/scopes/>
- Manual Journals: <https://developer.xero.com/documentation/api/accounting/manualjournals/>
- Reports and NZ GST: <https://developer.xero.com/documentation/api/accounting/reports>
- Custom Connections: <https://developer.xero.com/documentation/guides/oauth2/custom-connections>
- Developer terms: <https://developer.xero.com/xero-developer-platform-terms-conditions>
- Changelog: <https://developer.xero.com/changelog>

## Official Xero GitHub repositories

- Xero Node SDK: <https://github.com/XeroAPI/xero-node>
- Xero MCP Server: <https://github.com/XeroAPI/xero-mcp-server>
- Xero Agent Toolkit: <https://github.com/XeroAPI/xero-agent-toolkit>
- Xero Prompt Library: <https://github.com/XeroAPI/xero-prompt-library>
- Xero Command Line: <https://github.com/XeroAPI/xero-command-line>
- Xero Node OAuth2 App: <https://github.com/XeroAPI/xero-node-oauth2-app>
- Xero OpenAPI: <https://github.com/XeroAPI/Xero-OpenAPI>

---

# Appendix A — Recommended Target Repository Structure

Adapt this to the existing codebase rather than forcing a rewrite.

```text
app/
  api/
    xero/
      oauth/start/
      oauth/callback/
      connections/
      sync/
      health/
    bank-imports/
    reports/
    exceptions/
    proposed-actions/
    approvals/
    timesheets/
  finance/
    dashboard/
    entities/
    cash/
    board-pack/
    reconciliations/
    intercompany/
    gst/
    exceptions/
    fix-queue/
    debt/
    timesheets/
    settings/

src/
  domain/
    money/
    dates/
    entities/
    accounting/
    gst/
    intercompany/
    reconciliation/
    approvals/
  integrations/
    xero/
      gateway.ts
      app-registry.ts
      app-router.ts
      app-secrets.ts
      compliance-gate.ts
      assignments.ts
      oauth.ts
      token-store.ts
      rate-limit.ts
      pagination.ts
      normalisers.ts
      errors.ts
      resources/
    banking/
      asb/
      bnz/
    sharepoint/
    ai/
  services/
    sync/
    rules/
    board-pack/
    exceptions/
    writes/
    exports/
  db/
    schema/
    migrations/
    repositories/
  security/
  observability/

tests/
  unit/
  contract/
  integration/
  fixtures/
  golden/

docs/
  current-state-audit.md
  requirements-traceability.md
  implementation-plan.md
  architecture-decision-records/
  runbooks/
  accounting-rules/
```

---

# Appendix B — Proposed Action State Machine

```text
DRAFT
  → VALIDATING
  → INVALID
  → READY_FOR_REVIEW
  → PENDING_APPROVAL
  → REJECTED
  → APPROVED
  → REVALIDATING
  → STALE_REQUIRES_REAPPROVAL
  → QUEUED
  → EXECUTING
  → APPLIED_UNVERIFIED
  → VERIFIED
  → FAILED
  → MANUAL_FOLLOW_UP
  → ROLLED_BACK
```

Rules:

- only validated actions may enter review;
- any payload change after approval invalidates approval;
- source-resource change requires reapproval;
- only `APPROVED` may be queued;
- only `VERIFIED` is shown as successfully applied;
- failed ambiguous writes require a read check before retry;
- rollback is action-specific.

---

# Appendix C — Initial Accounting Rule Catalogue to Confirm

These are seed candidates, not approved accounting policy until confirmed.

| Rule candidate | Required owner confirmation |
|---|---|
| GST-bearing construction costs require Wunderbuild/project tracking | Which accounts, entities and exceptions? |
| Ramwall development construction costs post to WIP | Exact accounts, projects and release policy? |
| Related-party costs recharge without margin | Which relationships and when is margin permitted? |
| Hebcohg management fees | Fee basis, GST, entity recipients and timing? |
| CHH Trust interest recharges | Source rate, accrual basis, GST treatment and period? |
| Deposits | Account treatment and recognition point? |
| Retentions | When payable/receivable and which account? |
| Non-GST-registered entities/contacts | Effective dates and Xero contact IDs? |
| Loan facilities excluded from cash | Which bank accounts/facilities? |
| Materiality | Absolute and percentage thresholds per entity/module? |
| Board adjustments | WIP, depreciation, interest and intercompany treatment? |
| Lender adjustments | Add-backs/removals and evidence requirements? |

---

# Appendix D — Phase 0 Evidence Pack

Before feature development, the repository should contain an evidence pack with:

1. current application architecture diagram;
2. current D1 schema and migration history;
3. current bank CSV samples, anonymised;
4. list of hard-coded account numbers and balances;
5. all existing entity aliases;
6. current auth model;
7. current Cloudflare bindings and plan-dependent services;
8. Xero Demo Company app details;
9. live Connected Apps checklist without secrets;
10. proposed entity-to-tenant mapping;
11. current board-pack template;
12. current Loan Register template;
13. current budget templates;
14. current SharePoint timesheet sample;
15. known GST audit fixture;
16. approved project/Wunderbuild mapping source.

No live credentials or unredacted financial documents belong in this evidence pack.


---

# Appendix E — Multi-App Configuration Contract

This is non-secret configuration. Real client IDs and client secrets remain in Cloudflare secret storage.

```json
{
  "apps": [
    {
      "key": "ramwall-read-a",
      "environment": "production",
      "purpose": "read_core",
      "tier": "starter",
      "connectionLimit": 5,
      "scopeProfile": "read_core_v1",
      "redirectUri": "https://finance.ramwall.example/api/xero/oauth/callback",
      "clientIdSecretRef": "XERO_RAMWALL_READ_A_CLIENT_ID",
      "clientSecretSecretRef": "XERO_RAMWALL_READ_A_CLIENT_SECRET",
      "complianceStatus": "approved",
      "approvalReference": null,
      "enabled": true
    },
    {
      "key": "ramwall-read-b",
      "environment": "production",
      "purpose": "read_core",
      "tier": "starter",
      "connectionLimit": 5,
      "scopeProfile": "read_core_v1",
      "redirectUri": "https://finance.ramwall.example/api/xero/oauth/callback",
      "clientIdSecretRef": "XERO_RAMWALL_READ_B_CLIENT_ID",
      "clientSecretSecretRef": "XERO_RAMWALL_READ_B_CLIENT_SECRET",
      "complianceStatus": "xero_confirmation_required",
      "approvalReference": null,
      "enabled": false
    }
  ]
}
```

Rules:

- the file is an example only; the database is the runtime source of truth;
- `enabled=true` is rejected in production if the compliance gate fails;
- app key changes are migrations, not ordinary edits;
- no secret values appear in configuration, logs or database fields;
- connection limits are configurable because tiers may change;
- the router never uses list order as routing priority.

---

# Appendix F — Initial Entity-to-App Assignment Matrix

Populate during Phase 0. The entries below are planning placeholders, not authorisations.

| Entity | Read app | Write app | Payroll app | Xero tenant verified | App slot checked | Status |
|---|---|---|---|---|---|---|
| Ramwall (2010) Limited | `ramwall-read-a` | Decision required | Decision required | No | No | Proposed pool A |
| CHH Trust | `ramwall-read-a` | Decision required | Not applicable | No | No | Proposed pool A |
| Vikat Holdings Limited | `ramwall-read-a` | Decision required | Not applicable | No | No | Proposed pool A |
| Kayo Investments Limited | `ramwall-read-a` | Decision required | Not applicable | No | No | Proposed pool A |
| Kerrs Village Limited | `ramwall-read-a` | Decision required | Not applicable | No | No | Proposed pool A |
| Hebcohg Limited | Unassigned | Decision required | Not applicable | No | No | Candidate pool B/Core |
| Ramwall Developments Limited | Unassigned | Decision required | Not applicable | No | No | Candidate pool B/Core |
| Wallson Holdings Limited | Unassigned | Decision required | Not applicable | No | No | Candidate pool B/Core |

The application must make this matrix visible and editable through audited administration screens.

---

# Appendix G — Multi-App to Core Migration Runbook

1. Record the target Core app and verify its tier/payment status.
2. Create target app records and secret bindings without enabling production sync.
3. Reauthorise one pilot entity under the target app.
4. Mark the target assignment as `shadow migration`.
5. Run accounts, contacts, transaction and report syncs through both old and target apps.
6. Compare counts, IDs, amounts, report totals and updated timestamps.
7. Resolve any scope or authorising-user differences.
8. Approve the cutover event.
9. Set the target assignment active at an effective timestamp.
10. Stop new jobs for the old assignment and let in-flight jobs finish or cancel safely.
11. Confirm the next scheduled sync and report publication use the target app.
12. Revoke/disconnect the old app only after the agreed rollback window.
13. Preserve old app, connection and authorisation metadata as retired audit records.
14. Repeat entity by entity; never bulk cut over without a tested rollback path.

---

# Appendix H — Multi-App Acceptance Scenario

Claude Code must implement an automated acceptance scenario using mocks or approved Demo Company connections:

1. Register `read-a` and `read-b` as independent Starter apps.
2. Connect five mock tenants to each app.
3. Assign ten Ramwall test entities across the two apps.
4. Run a scheduled incremental sync for all entities.
5. Produce one consolidated board-pack dataset covering all ten.
6. Match an intercompany transaction where one side is in app A and the other is in app B.
7. Simulate token expiry in app A and prove app B continues normally.
8. Simulate app A reaching its daily reserve and prove only app A jobs defer.
9. Attempt a write for an entity with no write assignment and confirm fail-closed behaviour.
10. Remove the required compliance approval from app B and prove production jobs are blocked.
11. Create a shadow Core assignment for one entity and prove it is excluded from production totals.
12. Cut the entity over and prove lineage changes without duplicate reporting.


---

**End of Master Build Specification v4.0 — Multi-App Compatible**
