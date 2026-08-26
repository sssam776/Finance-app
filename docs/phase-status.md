# Phase status

What is built, what is not, and what each phase still needs. Phases follow
Part T of `Ramwall_Finance_Platform_Rebuild_Spec.md`.

Status values mean exactly this:

| | Meaning |
|---|---|
| **Built** | Code exists, is covered by tests, and runs. |
| **Partial** | Some of the phase works; the gaps are listed explicitly. |
| **Schema only** | Tables and calculations exist; no API, no UI, no data. |
| **Not started** | No code. |

A table with no rows in it is **not** a working feature, and is never recorded
as one below.

---

## Summary

| Phase | Scope | Status |
|---|---|---|
| 1 | Canonical data layer | **Partial** — schema complete, no API or UI |
| 2 | Cash Position | **Partial** — variance control works, liquidity model incomplete |
| 3 | CFO portfolio dashboard | **Schema only** — engines built, nothing rendered |
| 4 | Property sell / redeploy | **Not started** |
| 5 | Cash-flow forecast | **Not started** |
| 6 | Xero / automated sources | **Partial** — built early, never connected to a real organisation |

Phase 6 being underway before phases 3–5 is a deliberate consequence of build
order: the Xero modules were specified and built against the earlier master
spec, before the rebuild spec reordered the work.

---

## Phase 1 — canonical data layer

**Status: Partial.** Every table exists and the ratio engines that read them are
tested. There is no API, no screen, and no data in the portfolio tables.

| Requirement | Status | Where |
|---|---|---|
| Entities | Built | `entities` — 8 seeded, all `unverified` |
| Bank accounts | Built | `entity_bank_accounts`, with an explicit `is_loan_facility` flag |
| Properties | Schema only | `properties` — investment / development / held-for-sale |
| Lenders | Schema only | `lenders` — senior / second-tier separation |
| Facilities | Schema only | `loan_facilities` — limit and drawn held separately |
| Lender pools | Schema only | `lender_pools` — target LVR and stress rate per pool |
| Valuations | Schema only | `property_valuations` — bank, market and council bases, dated |
| NOI | Schema only | `property_noi_snapshots`, with a mapping-status flag |
| Covenant rules | Schema only | `covenant_rules` — effective-dated, with rule type |
| Import / source lineage | Partial | `source_lineage` exists; `raw_bank_rows` is not built |

**Calculations built and tested** (`lib/portfolio/ratios.ts`): LVR, debt capacity,
headroom, over-limit, debt yield, interest cover, stress interest cover, and
covenant assessment against the threshold in force on a given date.

Two decisions worth knowing:

- **No derived figure is stored.** Every ratio is computed on read. Precomputed
  totals are the reason the source workbook's tabs could disagree with one
  another.
- **A covenant result is not a boolean.** It is `pass`, `breach`, `no_rule` or
  `not_measurable`. A lender with no express financial covenant is not
  breaching, and a pool whose LVR cannot be calculated is not passing.

**Still needed:** an import path for the workbook registers, API routes, and the
screens that display them. Also `raw_bank_rows`, if row-level drilldown into
the original CSV is wanted.

---

## Phase 2 — Cash Position

**Status: Partial.** The bank-versus-Xero variance control is complete and in
use. The liquidity model specified in §26–27 is not.

| Requirement | Status | Notes |
|---|---|---|
| ASB parser | Built | Requires a running-balance column |
| BNZ parser | Built | Same |
| Account mapping | Built | Explicit master; treatment is never inferred from an account name |
| Exception queue | **Not built** | See below |
| Balance snapshots | Built | Latest-snapshot rule, tie-broken by ingest time |
| Liquidity engine | **Partial** | Loan facilities excluded from available cash; nothing else is |
| Cash by entity | Built | Per currency, never summed across currencies |
| "Available to use" KPI | **Not built** | Needs undrawn facility headroom |
| Import reconciliation | **Not built** | No reconcile-before-publish step |

**On the exception queue.** The spec assumes a CSV containing many accounts,
auto-matched by account number, with unmatched rows queued for an operator. This
build takes a different route: the uploader chooses the target account, and
`bank_balance_snapshots` has a foreign key to the account master. An unmapped
account therefore cannot enter the totals at all — it is structurally
impossible rather than filtered out. That is safe, but narrower than specified,
and it does not support multi-account files.

**On the liquidity gap.** Today `available cash` means every mapped, non-loan
account with a balance. The spec requires more: statutory, GST/PAYE, tax and
restricted reserve accounts excluded unless explicitly approved as deployable,
and revolving liquidity computed as `facility limit − drawn` rather than a loan
balance counted as cash. `loan_facilities` now carries `facility_limit`,
`drawn_amount` and `include_in_available_liquidity` to support this, but
`lib/cashPosition.ts` does not read them yet.

**Still needed:** classification flags on `entity_bank_accounts` beyond the
single loan boolean, the revolving-liquidity calculation, the combined
"available to use" figure, and an import reconciliation screen.

---

## Phase 3 — CFO portfolio dashboard

**Status: Schema only.** The arithmetic is built and tested; nothing renders it.

| Requirement | Status |
|---|---|
| Investment / development split | Schema supports it (`properties.status`); no view |
| Debt by lender | Schema supports it; no view |
| Pool LVR | Calculation built and tested; no view |
| Covenants | Calculation built and tested, effective-dated; no view |
| ICR stress | Calculation built and tested; no view |
| Facility expiry watch | `facility_events` exists; no urgency classifier, no view |
| Second-tier / development debt treatment | Schema supports it (`interest_capitalised`); not applied |

**Still needed:** the expiry urgency classifier, API routes over the engines, and
the dashboard itself. Per §36 the components must read computed results and must
not recompute any ratio themselves.

---

## Phase 4 — property sell / redeploy

**Status: Not started.**

Fully specified in §16–18 with a worked example to verify against, and §63 lists
eleven required test cases including sale below bank value, zero and 20%
haircuts, top-up required, and negative NOI.

The load-bearing rule to preserve: the repayment required to release a security
is set by the **bank's** valuation of the property, so it does not change when
the sale price does. A low sale price bites in two other ways instead — proceeds
may not cover the paydown, and a sale below bank value can trigger a
revaluation of the retained pool.

Depends on Phase 1 having real data.

---

## Phase 5 — cash-flow forecast

**Status: Not started.** `forecast_lines` is not built. Opening cash is intended
to connect directly to the Cash Position snapshot.

---

## Phase 6 — Xero / automated sources

**Status: Partial.** More is built here than the phase order implies, because
this work predates the rebuild spec. None of it has run against a real Xero
organisation.

| Requirement | Status |
|---|---|
| OAuth 2.0 authorisation | Built — tokens encrypted at rest (AES-256-GCM) |
| Read-only scope enforcement | Built — a test fails if any write scope is added |
| Connection capacity gate | Built — checked before consent, not after |
| Production compliance gate | Built — `lib/xero/compliance.ts` |
| Connection health and staleness | Built |
| Paged, rate-limit-aware fetching | Built — honours `Retry-After`, retries count against the call cap |
| P&L movement (Module C) | Built — favourable/adverse, materiality ranking, commentary |
| Balance-sheet reconciliation (Module D) | Built — refuses to mark unsupported balances reconciled |
| Live connection | **Never made** |

**Two open risks.** Two report-parsing assumptions are unconfirmed against real
Xero responses; `scripts/spike-xero-shapes.ts` settles both once an organisation
is connected. Both degrade to no-match rather than to a wrong number. Separately,
the token-refresh compare-and-swap in `lib/xero/gateway.ts` is not a true lock —
two concurrent refreshes can still race, which is low risk with one user and
real with several.

**Capacity constraint.** The registered app is Starter tier with a limit of five
connections, against eight entities. Spec 3.3 forbids adding a second
same-purpose Starter app as a free-tier workaround, and the compliance gate
enforces that, so covering all eight is a commercial decision (Core tier) rather
than a code change.

---

## Cross-cutting, outside the phase numbering

Built and in use across every phase:

| | Status |
|---|---|
| Password authentication, sessions, rotation, login throttling | Built |
| Role model (viewer / admin) | Built |
| Per-entity permission scoping | Built, enforced for admins too |
| Audit log with actor identity taken from the session | Built |
| Money as Decimal throughout, never floating point | Built |
| Evidence drill-through on every figure | Built for bank and Xero sources |
| Design system | Built; not yet aligned to the Ramwall brand palette |

---

## What is needed from Ramwall

1. **A Xero organisation to connect**, and a decision on the five-connection
   limit against eight entities.
2. **Confirmation of which entities have their own Xero organisation.** All
   eight are `unverified`.
3. **The Master Finance Schedule workbook**, to populate the Phase 1 registers.
   Nothing in the portfolio layer can display until it exists.
4. **One real ASB and one real BNZ export**, to confirm the parsers against
   genuine files.
5. **Materiality thresholds**, rather than the placeholder defaults loaded.
6. **A decision on bank-account classification** — which accounts are
   statutory, restricted, or approved as deployable.
