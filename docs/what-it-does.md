# Ramwall Finance Control — what it does today

Written for the Financial Controller, not for developers. Every claim here is
something the software actually does now, not something planned.

## The short version

It answers three questions, and refuses to answer them when it cannot do so
honestly:

1. **How much cash does the group have, and does Xero agree with the bank?**
2. **What changed in the P&L this month, and which movements are worth
   explaining?**
3. **Which balance-sheet accounts are actually supported by evidence, and
   which are not?**

The refusals matter as much as the answers. Where the software does not have
what it needs, it says so in plain words rather than showing a figure that
looks finished.

---

## Cash Position

Per mapped bank account, side by side:

- the closing balance from the bank's own CSV export
- the balance Xero holds for the matching account
- the variance between them, in dollars and percent
- whether that variance breaches the threshold you set

Loan facilities are excluded from available cash. Totals are shown **per
currency and never added together**, because converting needs an approved
exchange rate and the software does not have one.

Every figure opens to its evidence: which statement file it came from,
that file's checksum, who imported it, which Xero sync produced the other
side, and when. A number on screen can always be traced back to the document
it came from.

**What it is not:** this is a control and variance check, not line-by-line
bank reconciliation.

## Bank Imports

Upload an ASB or BNZ CSV export that includes the running balance column. The
file is parsed on the server, the original is kept, and the closing balance is
taken from the most recent row.

Malformed files are rejected with the reason. Amounts must be plain figures;
anything else is refused rather than stored and discovered later.

## P&L Movement

For any month, against either the prior month or the same month last year:

- what each account did, and by how much
- whether the movement is **favourable or adverse** — revenue rising and costs
  rising are the same arithmetic and opposite news, and the software knows the
  difference
- accounts ranked so the ones worth explaining sit at the top: anything
  breaching your threshold comes first, then by size of movement
- an account that appears for the first time this month is shown as a movement
  from zero, not hidden

**Explanations** can be typed against any account or against the entity as a
whole. They live entirely apart from the calculations, so writing an
explanation can never change a figure. A new explanation supersedes the
previous one rather than erasing it, so the earlier reasoning stays on record.

**Budget comparison is not built.** It needs either a Xero budget or your
approved budget workbook. Until one exists the software says the comparison is
unavailable and why, rather than showing zero and letting it read as "budget
was nil".

## Balance Sheet

Every account on the trial balance, with what supports it:

- what the trial balance says
- what the supporting source says
- the difference
- a status

**An account with no supporting source is never marked reconciled.** However
small the difference looks, a trial balance agreeing with itself is not
evidence that a balance is right. Those accounts read `unsubstantiated` and
stay that way until something supports them.

Today only **bank balances** can be substantiated automatically. Receivables,
payables, GST, loans and fixed assets all need sources the software does not
yet have, so they show as unsupported. That is the software being honest, not
incomplete.

A difference someone has explained as timing gets its own status rather than
being folded into "reconciled", because a difference that was explained is
still a difference.

**Closing a period:** a period can be locked. If material accounts are still
unsupported, locking requires an explicit acknowledgement, and that
acknowledgement is recorded on the period. A close that went ahead over known
gaps is visible afterwards rather than looking identical to a clean one.
Immaterial accounts do not hold up a close. Reopening a locked period requires
a written reason.

## Entities and Xero Connections

The eight Ramwall entities are loaded and every one is marked **unverified**,
because nobody has yet confirmed which of them have their own Xero
organisation. That label stays on screen until you confirm it.

The Xero page shows connection health, when each organisation last synced
successfully, and how many of the tier's connection slots are used. A
connection that has quietly stopped syncing is flagged rather than looking
identical to a healthy one.

## Who can do what

Two roles:

- **Viewer** — reads every screen.
- **Admin** — additionally imports statements, maps bank accounts, connects
  Xero organisations, changes thresholds, records explanations, and locks
  periods.

Access can be narrowed **per entity**, so a preparer trusted with two entities
sees only those two. Every change is recorded against the person who made it,
taken from their sign-in rather than from anything the browser sent.

---

## What it deliberately cannot do

- **It cannot write to Xero.** No write permission is requested anywhere, and
  a test in the build fails if anyone adds one.
- **It cannot convert currencies.** Balances in different currencies are shown
  separately, never summed.
- **It cannot mark an unsupported balance as reconciled.**
- **It cannot compare against a budget** until a budget source exists.

## What it needs from you

1. **A Xero developer app** so the software can connect. Free.
2. **Confirmation of which entities have their own Xero organisation.** All
   eight are unverified today.
3. **One real ASB and one real BNZ statement export**, to confirm the file
   format against a genuine file rather than an assumed one.
4. **Your approved budget workbook**, if you want budget variance.
5. **Materiality thresholds** you actually want, rather than the placeholder
   defaults currently loaded.
