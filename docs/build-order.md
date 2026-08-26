# Build order across Modules B to L

Synthesised from the eleven module plans in module-plans.md, read together
against the code as it stands. Where two planners independently invented the
same thing under different names, this picks one.

These are plans. Nothing described here exists yet.

Read all eleven plans, the traceability matrix, and verified every shared claim against the actual code. Here is the build plan.

---

# RAMWALL FINANCE PLATFORM — CONSOLIDATED BUILD ORDER

## 0. THE FINDING THAT REORDERS EVERYTHING

Four planners (B, E, F, G) independently flagged that `read_core_v1` contains scope strings Xero does not issue. They are right, and it is worse than any one of them said.

`C:\dev\Finance-app\lib\xero\scopeProfiles.ts` holds 20 strings. Roughly ten are not Xero OAuth 2.0 scopes:

| In the profile | Real Xero scope |
|---|---|
| `accounting.invoices.read`, `accounting.payments.read`, `accounting.banktransactions.read`, `accounting.manualjournals.read` | `accounting.transactions.read` (one scope, covers all of them + CreditNotes, Prepayments, Overpayments) |
| `accounting.reports.aged.read`, `.balancesheet.read`, `.banksummary.read`, `.budgetsummary.read`, `.executivesummary.read`, `.profitandloss.read`, `.trialbalance.read`, `.taxreports.read` | `accounting.reports.read` (one scope, all reports) |

The spec is not authoritative here — line 766 of the master spec literally says **"Initial `read_core_v1` candidate"**. Fixing it is compliance with the spec, not a deviation from it.

Two consequences nobody has stated plainly:

1. **Module A is not verified working.** `app/api/xero/sync/route.ts:65` calls `getReportBankSummary` on `accounting.reports.banksummary.read`. If that scope was never granted, either OAuth has never completed against a real org, or the call is failing and nobody has looked. The traceability matrix marks CASH-004 "built". It is built; it is not proven.
2. **Fixing it costs a client-calendar event, not a deploy.** Scopes cannot be added to an existing token. Every connection must re-consent (spec 9.1). That is the longest-lead item in this entire programme and it gates B, C, D, E, F, G and I — about 70 days of work.

Separately, and just as bad: `lib/xero/reports.ts:30` reads the **last cell** of each row as the closing balance and `sync/route.ts:67` matches Xero accounts to balances **by account name**. Both are guesses, both are documented as guesses, and both sit directly under the only number the client has seen.

**Nothing else in this plan matters until a one-day Demo Company spike answers these.**

---

## 1. SHARED FOUNDATIONS

Eleven planners working independently re-invented the same nine things. Where they collide, I pick one design and say why.

### S1 — `read_core_v2` scope profile · 1 day
**Consumers: B, C, D, E, F, G, I** (every module that reads Xero).
Add to `lib/xero/scopeProfiles.ts`:
```
openid, profile, email, offline_access,
accounting.settings.read, accounting.contacts.read,
accounting.transactions.read, accounting.reports.read,
accounting.attachments.read, accounting.budgets.read
```
Ten strings replacing twenty. Never edit `read_core_v1` in place — a profile change is a reviewable audited event (spec 9.1), and the old profile must stay readable to explain what an existing token actually holds.

> **Plans disagree:** G proposes exactly this list. F proposes the same. B hedges ("either the spec is authoritative or my knowledge is stale"). E flags it but leaves it as a risk. **Decision: G/F are correct, verify with one authorize URL before writing the migration.** `accounting.journals.read` stays unrequested (spec line 789).

### S2 — `lib/xero/syncRun.ts` · 0.5 day
**Consumers: B, C, D, E, F, G, I, L — eight modules.**
`startSyncRun` / `completeSyncRun` / `failSyncRun`, extracted verbatim from `app/api/xero/sync/route.ts:45-146` (the insert-running / update-complete / update-connection / audit-event envelope). Refactor the existing route onto it in the same commit.

C and D both independently specified this file, same name, same three functions. Six more planners said "copies the exact shape of app/api/xero/sync/route.ts verbatim". That is ~40 lines × 8 copies.

Fold in the one-line fix that **C, F, H and B each requested separately**: widen `getAccounts(tenantId, undefined, 'Type=="BANK"')` at `sync/route.ts:62` to `Status=="ACTIVE"`. The unique index is on `(entity_id, xero_account_id)`, so non-bank rows land with a null balance and nothing breaks.

### S3 — `lib/xero/paged.ts` · 2 days
**Consumers: E, F, G, I, L.**
Nobody owns this and five modules budgeted it privately. There is no pagination anywhere in the build today — `getAccounts` is called once, unpaged. Xero is 60 calls/min and 5,000/day per tenant.

One generator: page loop, `If-Modified-Since` watermark, 429 handling honouring `Retry-After`, a hard per-run call cap, and `sync_runs.status='partial'` on cap-out rather than all-or-nothing failure.

> F budgeted this as "a meaningful slice of the 14 days". G, E, I and L each budgeted their own. Building it four times is four different backoff bugs against the client's real tenants.

### S4 — Unified `report_snapshots` + `report_rows` · 3 days
**Consumers: B, C, D, F, G, H.**

**This is the largest collision in the set.** B, C and D each specify tables named `report_snapshots` and `report_rows` with *different columns*. Whoever builds first wins and the other two silently break.

| | Module B | Module C | Module D |
|---|---|---|---|
| report types | P&L, BS, TB | P&L only | TB only |
| column axis | `column_key ('current'\|'prior_period'\|'prior_year')` | `period ('YYYY-MM')` | none (point in time) |
| unique to it | `timeframe`, `periods`, tracking IDs | `section_kind`, `basis`, `parser_version` | `source_debit`/`source_credit`/`signed_amount`, `payload_hash`, `raw_file_key`, `balanced` |

**Decision — one table, C's axis, D's evidence columns, B's ordering:**
- `period_key` is the single column axis: `'YYYY-MM'` for a P&L column, the period-end date for a TB.
- **B's `column_key` is rejected outright.** Storing `'prior_year'` bakes the question into the answer — the same row is `'current'` in one pack and `'prior_year'` twelve months later. Derive it at read time from `period_key` against the requested window. This is a real bug in B's plan that only surfaces after two years of data.
- Keep D's `source_debit` / `source_credit` / `signed_amount` as nullable, populated only by TB rows. BS-003 requires preserving source signs for evidence, and D is the only planner who noticed.
- Keep D's `payload_hash` + `raw_file_key` (store the raw JSON via `storeRawFile`) and the `balanced` assertion that fails the sync run when debits ≠ credits. That is the only defence against the unverified-parser risk every planner flagged.
- Keep C's `section_kind` (drives favourable/adverse) and B's `row_order` / `is_subtotal`.

Same file, one generic walker in `lib/xero/reports.ts` beside the existing `parseBankSummaryClosingBalances` — **not four**. The plans propose `parseReportRows` (B), `parseProfitAndLossPeriods` (C), `parseTrialBalanceRows` (D), `parseTrialBalanceByAccountCode` (F), `parseTrialBalanceClosingBalances` (H) and `rowsOf` (G). All six walk the identical `RowType.Section` structure. Build `rowsOf(report)` once; the per-report shaping is a 10-line function on top.

### S5 — `variance_thresholds` gains one column · 0.5 day
**Consumers: B, C, D, E, F, H.**
All six reuse `lib/thresholds.ts` — correct, and the best reuse decision in the set. But three of them specify the *same migration under two different names*: B says `context`, C and D say `module`. Do it once, before any of them, or you get three fighting migrations.

**Decision: `context text not null default 'cash'`**, drop `variance_thresholds_scope_unique`, add `(entity_id, context)`. `resolveThreshold(rows, entityId, context)` gains one argument. Existing CASH-005 callers keep working on the default.

D is right that this matters: reusing a $1,000 *cash* tolerance as *balance-sheet materiality* marks every BS account over $1,000 material and buries the real ones.

### S6 — `lib/periods.ts` · 1 day
**Consumers: B, C, D.**
B's `lib/reporting/periods.ts` and C's `lib/variance/periods.ts` are the same module written twice — both resolve prior-period and prior-year windows against `entities.financial_year_end` (column exists, nullable, unpopulated). Merge. Add `monthKey` / `monthsInRange` to `lib/dates.ts` as C proposes.

G's `lib/gst/period.ts` is genuinely different (NZ filing frequency + invoice-vs-payments basis, not financial year) — **leave it separate.** Not every period is the same period.

### S7 — `lib/cashPosition.ts` extraction · 1 day
**Consumers: J (hard blocker), plus 7 modules that copy the CASH-006 evidence shape by eyeball.**
The cash-position computation lives inside `app/api/cash-position/route.ts` (150 lines). J cannot import a route handler. Every other plan says "same evidence shape as `/api/cash-position`" and none of them can actually reuse it.

This is a REM-001 fix the build wants anyway — policy out of the route layer. The route becomes a session check plus a JSON wrapper.

### S8 — Approval primitives, *not* an approval table · 1 day
**Consumers: B, D, E, F, H, K, L.**

Seven modules invent a versioned-approved-effective-dated table: `group_account_map_versions` (B), `rule_versions` (E), `loan_covenants` (H), `action_approvals` + `approval_policies` (K), `reconciliation_periods` (D), `intercompany_relationships` (F), `budget_snapshots` (C).

**I am deliberately NOT building a generic `approvals` table.** Seven tables with three columns in common is not an abstraction, it is a coincidence. What *is* shared is ~20 lines of pure policy:
- `assertApprover(preparerEmail, approverEmail, policy)` — the "approver must differ from preparer" rule, currently written out longhand in five plans.
- `resolveEffectiveVersion(rows, asOf)` — pick the row whose effective window contains a date, fail closed on two matches (same discipline as `resolveXeroRoute`).

**The blocker underneath, which four planners hit separately: segregation of duties is unenforceable today.** `users.role` is `admin|viewer`. D states it plainly — "one admin cannot [satisfy BS-001], and the module will correctly refuse to let them review their own work, which will read as a bug." B: "would need a role change, which is a decision, not a task." E requires approver ≠ creator. K adds `users.write_back_role`. L adds `users.payroll_access`.

**Decision: additive columns on `users`, never widen `users.role`.** K's reasoning is right and everyone else inherits it — widening the role enum forces re-reasoning about every `requireSession('admin')` call site. Spec 31's eight roles stay unbuilt until there is an ADR.

### S9 — `lib/exceptionLifecycle.ts` · 0.5 day
**Consumers: E, G (and D's is different — leave it).**
G is honest about this: "`gst_findings` uses Module E's RULE-004 status vocabulary verbatim so that when the shared `exceptions` table is built, this is a copy-and-rename." Share the *vocabulary and the transition function* (one `Record<status, status[]>` plus `canTransition`); keep the tables per-module. D's nine-state reconciliation machine is a genuinely different thing and must not be merged into it.

### S10 — Two guard tests · 0.5 day
**Consumers: every module, forever.**
- L's idea, generalised: assert `SCOPE_PROFILES` contains no scope lacking a `.read` suffix outside an explicit allowlist. Five lines. Adding a write scope becomes a failing test rather than a two-character diff.
- J's idea: assert `lib/ai/**` and `lib/rules/**` have no import path to `lib/xero/gateway.ts`. `buildXeroClient` is the only route to a Xero call; keeping it unreachable is structural, not policy.

### S11 — One transaction mirror · 4 days *(schedule with the first of E/F/G, not before)*
**Consumers: E, F, G — and it is specified three incompatible ways.**

| Module | Table | Coverage |
|---|---|---|
| E | `xero_invoices` (+ credit notes folded in via `document_kind`) + `xero_invoice_lines` | 2 resource types |
| F | `intercompany_items` (document-level, pre-computed `signed_total`) + `xero_contacts` | 6 resource types, counterparty-facing |
| G | `xero_source_documents` + `xero_source_document_lines` + `xero_tax_rates` | 9 resource types |

F already wrote the warning: *"intercompany_items duplicates data that the xero_invoices tables will eventually own... write that down now or the group ends up with two truths about the same invoice."*

**Decision: G's `xero_source_documents` / `xero_source_document_lines` / `xero_tax_rates` is the single mirror.** It is a strict superset of E's. F's `intercompany_items` becomes a *projection* over it carrying `signed_total` and relationship attribution — not a second sync. `xero_contacts` (F) is real reference data and stays.

The cost of getting this wrong is not schema tidiness: it is three separate syncs pulling the same invoices against a 60/min per-tenant budget.

**Foundations total: 15.5 days** (11.5 + 4 for S11).

---

## 2. BUILD ORDER

Ordered by value delivered per day, dependencies respected. **Track A is code. Track B runs in parallel and never blocks Track A.**

### TRACK A — CODE

| # | Work item | Advances | Depends on | Days |
|---|---|---|---|---|
| **0** | **Demo Company spike.** One authorize URL to confirm real scope strings. One `getReportBankSummary` to confirm column order and whether account *name* is a safe join key. One `getReportTrialBalance` for debit/credit column positions. One `getInvoices` page to confirm line items return under paging. | Everything; validates Module A | — | **1** |
| 1 | Foundations wave 1: S1 scope profile, S2 syncRun + accounts filter, S5 threshold context, S7 cashPosition extraction, S10 guard tests | All | #0 | 4 |
| 2 | Foundations wave 2: S4 report snapshot layer + generic report walker, S6 periods | B, C, D, F, G, H | #1 | 4 |
| 3 | **Module C — actuals half (VAR-001, VAR-003, VAR-004)**. P&L snapshot sync, movement engine, materiality ranking, commentary. Budget half deferred to #12. | **C** | #2 | 6 |
| 4 | Module D core: TB snapshot (rides on #2), workpaper seeding, `lib/reconciliation/status.ts`, bank-balance substantiation, period lock | **D** | #2, #3 | 4 |
| 5 | Foundations wave 3: S3 pagination/rate-limit + S11 transaction mirror | E, F, G, I, L | #1 | 6 |
| 6 | Module F refusal-first slice: `lib/intercompany/pairing.ts`, relationship registry, pair matrix. **Ships the "one side not connected" refusal, not the matcher.** | **F** | #5 | 4 |
| 7 | Module B: P&L view, materiality, eliminations + adjustments workflow, CSV export. **No group chart, no xlsx.** | **B** | #2, #3 | 6 |
| 8 | Module G calculation engine: `lib/gst/calculate.ts`, `reconcile.ts`, run/totals tables | **G** | #5 | 4 |
| 9 | Module E engine: `evaluate.ts`, `lifecycle.ts` (S9), `supplierProfile.ts`, the 2 of 13 rules that need no client policy | **E** | #5, S9 | 4 |
| 10 | Module I: metadata-first attachment sync, egress ledger, on-demand fetch, extraction tiers 1–2, runner | **I** | #5 | 7 |
| 11 | Module J: control plane, number guard, cash narrative | **J** | #1 (S7) | 4 |
| 12+ | **Blocked payloads** — see Track B. Each lands as its answer arrives. | C, B, D, E, F, G, H | Track B | 60.5 |

### TRACK B — CLIENT, NO CODE BLOCKED

Runs from day one, in this order of urgency:

1. **Book the reauthorisation round.** Longest lead item in the programme. Every connection re-consents to `read_core_v2`. Until this is scheduled, items #5 onward cannot read a single transaction from a real org.
2. Confirm which entities have their own Xero organisation — all 8 rows in `entities` are still `status='unverified'`.
3. Allocate the 5 Starter connection slots, or decide on Core.
4. Send the ten questions in section 6.
5. Collect files: board-pack template, budget workbook, Loan Register, sample supplier PDFs, a real SharePoint timesheet export.

**Module H is deliberately absent from Track A.** Six of its eight blockers are hard. Its 12.5 days move to #12+ and start the day the Loan Register template and the ASB charging-group valuations arrive — not before. Writing `parseLoanRegisterCsv.ts` against a guessed header row is the same mistake L is explicitly warning about, and H's own plan says so: *"Sequence the client request before starting, not after."*

---

## 3. CRITICAL PATH TO A USEFUL SECOND MODULE

**Module C — P&L Movement and Budget Variance, actuals half. 15 days from a standing start.**

`#0 spike (1) → #1 foundations (4) → #2 report layer (4) → #3 Module C actuals (6)`

### Why C, on client value

The Financial Controller currently has one screen that answers *"how much cash do we have and does Xero agree with the bank?"* The next question a controller actually asks is *"how did we trade this month against last month and against last year, and which lines moved enough to care about?"* That is VAR-001 and VAR-003 and it is the first output of this platform that a board member would read without being walked through it.

### Why not the alternatives

- **Module B (17d, high value)** is the obvious pick and it is a trap. BOARD-002 needs a group chart of accounts the client has not supplied, and B's own plan calls it *"the single biggest blocker in the module."* A board pack that consolidates nothing is a demo of empty tables. B also needs the approved template before the workbook layout can be right. Build B's *view* after C, when the group chart arrives.
- **Module D (10d)** produces mostly `unsubstantiated` rows — six of BS-002's eight substantiations are blocked, materiality is blocked, the CoA map is blocked, and with one admin it cannot satisfy the preparer/reviewer split at all. That is BS-005 behaving correctly, and it is a bad second impression.
- **Module H (14d)** cannot produce a trustworthy number without the register template, covenant rules and property valuations. Zero of the three exist.
- **Modules E, F, G** are all gated behind the transaction mirror and the reauth round, and each has its flagship rule blocked on a client policy answer.

### Why C survives the blockers

C's actuals half depends on **nothing except the scope fix the whole build needs anyway.** VAR-002 (budget) is blocked on the workbook and the Xero capability test — so ship VAR-001/003/004 and leave the budget comparison as a visibly empty source, which is exactly what `lib/variance/budgetSource.ts` is designed to report.

And C pays forward: its `report_snapshots` layer, `lib/periods.ts` and materiality ranking are the foundation B and D sit directly on top of. It is the only candidate where the second module and the de-risking of the two biggest modules are the same work.

---

## 4. DO NOT BUILD YET

### Module K — Controlled Write-Back (9.5 days). Do not start.

Three gates, all client-side, none technical:

1. **Spec 9.4 write-access ADR, signed.** Until then `controlled_write_v1` must not exist in `SCOPE_PROFILES`. `resolveScopes` already throws on an unknown profile — that is a free second layer of the gate and it should stay armed.
2. **Spec 9.5 Model A vs Model B decision.** One app with expanded scopes, or separate read and write apps. Model B consumes a second uncertified-app slot with its own connection tier. Commercial decision, must precede any write app registration.
3. **Spec decision #27: signed-off rollback/compensating procedure per approved action type**, documented and tested before production enablement. Accounting judgement, not code.

Even with all three cleared, K's honest deliverable today is *a proposal queue an accountant then applies in Xero by hand* — and its only proposal source is CASH-005 variance, because `exceptions` (Module E) does not exist. Nine and a half days for a worklist with one input and no executor. **Build K after E, if at all.**

Note K's own risk, which is a client-expectation problem not an engineering one: *"If the client expects automation on delivery, that expectation has to be reset before the build starts, not after."*

### Module L — Payroll Timesheets (10.5 + 4 days). Do not start.

**Be precise about which gate bites, because L1 and L2 are blocked by different things.**

**L2 (PAY-005 draft creation, 4 days) is write-scope blocked.** `payroll.timesheets` write requires: the write-access ADR; Gate E in full (Demo Company write tests, idempotency, read-back verification, production flag off until sign-off); Gate F in full (source format approved, duplicate protection passing, draft-only verified); and spec 3.5 rollback documented per action type — where the only rollback is `deleteTimesheet` while still Draft, because `revertTimesheet` is banned by PAY-005. **All four, then L2.**

**L1 (PAY-001/2/3/4/6/7, 10.5 days) is NOT write-scope blocked** — `payroll_read_v1` is three `.read` scopes and does not breach the house rule. L1 is blocked by four other things:
- A second Xero app registration with `purpose='payroll_draft'`, its own credentials, redirect URI, operational owner and approval reference. `buildXeroClient` already refuses production use without all of them.
- OAuth consent from a named Xero **Payroll Admin** (spec 8.7). A finance admin's consent will not carry payroll scopes.
- Starter tier gives that app **one connection**. Multi-entity payroll silently requires a Core upgrade — a commercial stop that surfaces at OAuth time. `capacityFailureReason` already produces the message; the client should hear it before the app is registered.
- **A real export sample.** The parser and validator are both unwritable without one, and L's own plan puts the rework at three days.

L's plan is right that it is standalone and sequences last (spec Phase 8). The scheduling argument is decisive: 12 days here is 12 days not spent on B–G, which are unblocked, and L cannot finish regardless of effort until a second app exists and a Payroll Admin consents.

**One thing from L to build now, in the foundations: `tests/payrollDraftOnly.test.ts` generalised into S10.** It greps for `approveTimesheet`, `revertTimesheet`, `createPayRun`, `createPayRunCalendar` and fails on any hit. Five lines, it is the literal artefact Gate F asks for, and it costs nothing to have running in CI two years early. **Do not ship the `POST /api/timesheets/drafts` 501 stub** — scaffolding for a phase that may never be approved.

### Also not yet

- **Module H** — not governance-blocked, data-blocked. Six of eight blockers are hard. Ready the day the register and valuations land.
- **Module I tiers 4–5 (OCR, LLM)** — Xero PDFs carry a text layer, tiers 1–3 cover the common case. The pipeline returns `needs_ocr` rather than guessing.
- **Spec 31's eight roles** — spec 31 itself says do not build a second identity system without an ADR.
- **xlsx export (Module B)** — needs one new dependency (`exceljs`) and the client's workbook conventions. CSV needs neither. Ship CSV; the template is a blocker for the workbook anyway.

---

## 5. TOTAL EFFORT

| | Days |
|---|---:|
| Shared foundations (S1–S11) | 15.5 |
| Module B — Board reporting | 13 |
| Module C — P&L / budget variance | 9 |
| Module D — Balance-sheet reconciliation | 7.5 |
| Module E — Rules and exceptions | 9 |
| Module F — Intercompany | 8 |
| Module G — GST audit | 8 |
| Module H — Debt and lender view | 12.5 |
| Module I — Attachments and extraction | 9.5 |
| Module J — AI assistance | 6 |
| Module K — Write-back (dark) | 9.5 |
| Module L1 — Payroll control | 10.5 |
| Module L2 — Draft creation | 4 |
| **Total** | **122** |

**As separately scoped by the eleven planners: 141 days. Consolidating the duplication saves ~19 days** — and more importantly removes three colliding `report_snapshots` designs, three transaction mirrors, four pagination implementations and two names for the same threshold migration.

### Split

| | Days | What it is |
|---|---:|---|
| **Buildable now** | **61.5** | Produces trustworthy output, or a genuinely useful refusal, with today's information |
| **Blocked on client** | **60.5** | Scaffolding that waits on an answer, a file, or a governance decision |

Per module, buildable / blocked:

`Foundations 15.5/0` · `C 6/3` · `D 4/3.5` · `B 6/7` · `H 4/8.5` · `G 4/4` · `E 4/5` · `F 4/4` · `I 7/2.5` · `J 4/2` · `K 0/9.5` · `L1 3/7.5` · `L2 0/4`

**Half this programme is waiting on the client.** That is the single most important number in this document. The ten questions below are worth more than any two weeks of code.

---

## 6. THE TEN QUESTIONS

Ranked by days of work each unblocks. Ready to paste into an email.

**1. Will you schedule a reauthorisation round across every connected Xero organisation, and when?**
*Unblocks: ~70 days (B, C, D, E, F, G, I).* Our Xero scope profile contains permission strings Xero does not issue — we cannot read a single invoice, report or transaction until it is corrected, and corrected scopes cannot be added to an existing token. Every organisation must re-consent once. This is a calendar item for whoever holds Xero access, and it is the longest-lead dependency in the project. **Nothing downstream starts moving until it is booked.**

**2. Which legal entities have their own Xero organisation, and which five get the Starter app's connection slots?**
*Unblocks: ~50 days and every real number.* All eight entities are currently recorded as unverified. Intercompany reconciliation needs *both* sides of a pair connected — with five slots across ten-plus entities most pairs will correctly and permanently report "one side not connected". If more than five entities are in scope, that is a commercial decision (Core tier) we need now, not at go-live.

**3. Provide the group chart of accounts, and tell us which account code in each entity is the AR control, AP control, GST control, intercompany control, WIP, and loan account.**
*Unblocks: ~50 days (B 13, G 8, H 12.5, D 7.5, F 8).* One answer feeding five modules. Without the group chart, consolidation has no target and the board pack consolidates nothing. Without the semantic map, every balance-sheet workpaper opens as "manual schedule" and the GST project-code rule cannot be configured.

**4. What are the materiality thresholds — absolute and percentage, per entity — and do they differ per report?**
*Unblocks: ~40 days of correct output across B, C, D, E, F, H.* We currently have one number tuned for bank-balance variance. Reusing a $1,000 cash tolerance as balance-sheet materiality would mark every account over $1,000 as material and bury the ones that matter. Cheap to answer, and it is the difference between a report people read and a report people ignore.

**5. Who prepares and who reviews, by name and by entity — and is one person doing both acceptable for the pilot?**
*Unblocks: D, E approvals, B adjustments, K entirely.* Balance-sheet reconciliation requires a preparer and a different reviewer. The app has two roles today (admin, viewer) and enforces separation by email address. **A single-admin deployment cannot satisfy this at all** — the system will correctly refuse to let one person sign off their own work, which will look like a bug unless you have agreed the constraint in advance.

**6. Send us the approved board-pack template and the current Excel conventions.**
*Unblocks: ~7 days of Module B.* Specifically: sheet names, header rows, number formats, whether costs show positive or negative, and whether the board expects one workbook or one sheet per entity. "Matching current conventions" cannot be implemented from a sentence. We will ship the on-screen view and a CSV without it; the workbook waits.

**7. Send us the approved budget workbook, and tell us whether each Xero org holds budgets in Budget Manager at account level.**
*Unblocks: ~3 days of Module C, and decides which source is primary.* We need the actual file: are periods columns or rows, are accounts identified by code or name, one file per entity or one file with an entity column, and is it .csv or .xlsx? An .xlsx workbook needs a spreadsheet reader — a new dependency and about a day.

**8. Send us the approved Loan Register template, the covenant rules per lender, the ASB charging-group membership, and current property valuations.**
*Unblocks: 12.5 days — all of Module H.* We need real headers (is a part-fixed/part-floating facility one row with two rate columns, or two rows?), each covenant's threshold/operator/test frequency/effective dates, and approved valuations with as-at date and basis. **Xero holds no property values, so without valuations there is no LVR at all.** We will not start Module H until these arrive — building the parser against a guess is a week of rework.

**9. Approve the accounting-rule catalogue, confirm the Wunderbuild/project code source, and list GST-registration exceptions with effective dates.**
*Unblocks: ~9 days (E's live rule content, G's flagship rule).* Thirteen rules are specified; without your approved conditions, eleven of them ship as inert drafts and the engine completes successfully having found nothing. We specifically need: which account codes make a cost a "GST-bearing project cost", whether the project code is a Xero tracking option or an external list, and which counterparties are not GST-registered (Xero holds free-text tax numbers, not a reliable flag).

**10. Approve the intercompany relationship registry: which entity pairs, the Xero Contact ID representing each entity inside the counterparty's organisation, each side's control account code, and the expected margin and GST basis per recharge.**
*Unblocks: 8 days of Module F, plus D's intercompany substantiation.* Contact **IDs**, not names — matching on name is explicitly forbidden and silently wrong when a contact is recreated. These IDs can only be read by someone with access to each Xero organisation, so **budget a working session rather than expecting a spreadsheet.**

---

**Questions deliberately not in the top ten**, because we recommend not building the work they unblock yet: the spec 9.4 write-access ADR and Model A/B decision (Module K), the SharePoint export sample and Payroll Admin identity (Module L), the AI provider approval and no-training confirmation (Module J tier 5), and the records-retention policy for cached attachment bytes (Module I). Ask these when those modules are scheduled — asking now spends client attention that questions 1–5 need more.

---

### Files worth reading before the first commit
- `C:\dev\Finance-app\lib\xero\scopeProfiles.ts` — the ten bad scope strings
- `C:\dev\Finance-app\lib\xero\reports.ts` — the unverified last-cell assumption under the delivered cash dashboard
- `C:\dev\Finance-app\app\api\xero\sync\route.ts` — lines 45-146 (the envelope eight modules copy), line 62 (the `Type=="BANK"` filter four modules ask to widen), line 67 (the account-name join)
- `C:\dev\Finance-app\lib\thresholds.ts` — the one piece of shared policy every planner reused correctly
- `C:\dev\Finance-app\db\schema.ts:348` — `GLOBAL_THRESHOLD_SCOPE`, the sentinel convention six plans build on