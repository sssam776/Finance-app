import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import {
  entities,
  reportSnapshots,
  reportRows,
  reconciliationPeriods,
  reconciliationWorkpapers,
  varianceThresholds,
  bankBalanceSnapshots,
  entityBankAccounts,
  syncRuns,
} from "@/db/schema";
import { nowUtcIso, isValidDateOnly } from "@/lib/dates";
import { resolveThreshold } from "@/lib/thresholds";
import { resolveWorkpaperStatus, periodReadiness } from "@/lib/reconciliation/status";
import { Money } from "@/lib/money";
import { recordAuditEvent } from "@/lib/audit";
import { requireSession, entityAccessFor } from "@/lib/session";
import { canAccessEntity } from "@/lib/entityAccess";

/**
 * BS-001..005: balance-sheet workpapers for one entity and period.
 *
 * GET returns the workpapers and whether the period can be locked.
 * POST seeds them from a pinned trial balance snapshot.
 *
 * Substantiation is deliberately thin at this stage. Only bank balances can be
 * resolved automatically today; everything else lands as `unsubstantiated`
 * until a source is attached, which is BS-005 behaving correctly rather than a
 * gap. See docs/module-plans.md.
 */

const seedSchema = z.object({
  entityId: z.string().min(1),
  periodEnd: z.string().refine(isValidDateOnly, "periodEnd must be YYYY-MM-DD"),
});

export async function GET(request: Request) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  const url = new URL(request.url);
  const entityId = url.searchParams.get("entityId") ?? "";
  const periodEnd = url.searchParams.get("periodEnd") ?? "";

  if (!entityId || !isValidDateOnly(periodEnd)) {
    return NextResponse.json(
      { error: "entityId and a YYYY-MM-DD periodEnd are required" },
      { status: 400 }
    );
  }
  if (!canAccessEntity(entityAccessFor(actor), entityId)) {
    return NextResponse.json({ error: "No access to this entity" }, { status: 403 });
  }

  const period = db
    .select()
    .from(reconciliationPeriods)
    .where(
      and(
        eq(reconciliationPeriods.entityId, entityId),
        eq(reconciliationPeriods.periodEnd, periodEnd)
      )
    )
    .get();

  if (!period) {
    return NextResponse.json({
      entityId,
      periodEnd,
      available: false,
      reason: "No workpapers have been prepared for this period yet.",
      workpapers: [],
    });
  }

  const workpapers = db
    .select()
    .from(reconciliationWorkpapers)
    .where(eq(reconciliationWorkpapers.periodId, period.id))
    .all();

  const readiness = periodReadiness(
    workpapers.map((w) => ({
      accountCode: w.accountCode,
      status: w.status,
      isMaterial: w.isMaterial,
    }))
  );

  const snapshot = db
    .select()
    .from(reportSnapshots)
    .where(eq(reportSnapshots.id, period.tbSnapshotId))
    .get();

  // Report rows are stored at four decimal places so no precision is lost on
  // the way in. Money is presented at two, and both columns must agree or the
  // eye reads a difference that is not there.
  const presented = workpapers.map((w) => ({
    ...w,
    tbAmount: Money.of(w.tbAmount, w.currency).toFixedString(2),
    substantiatedAmount: w.substantiatedAmount
      ? Money.of(w.substantiatedAmount, w.currency).toFixedString(2)
      : null,
    difference: w.difference ? Money.of(w.difference, w.currency).toFixedString(2) : null,
  }));

  return NextResponse.json({
    entityId,
    periodEnd,
    available: true,
    period: {
      id: period.id,
      status: period.status,
      lockedByEmail: period.lockedByEmail,
      lockedAt: period.lockedAt,
      lockAcknowledgedUnresolved: period.lockAcknowledgedUnresolved,
    },
    readiness,
    workpapers: presented,
    evidence: snapshot
      ? {
          tbSnapshotId: snapshot.id,
          syncRunId: snapshot.syncRunId,
          tenantId: snapshot.tenantId,
          balanced: snapshot.balanced,
          fetchedAt: snapshot.fetchedAt,
        }
      : null,
  });
}

export async function POST(request: Request) {
  const actor = await requireSession("admin");
  if (actor instanceof NextResponse) return actor;

  const parsed = seedSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { entityId, periodEnd } = parsed.data;

  if (!canAccessEntity(entityAccessFor(actor), entityId)) {
    return NextResponse.json({ error: "No access to this entity" }, { status: 403 });
  }
  const entity = db.select().from(entities).where(eq(entities.id, entityId)).get();
  if (!entity) return NextResponse.json({ error: "Unknown entityId" }, { status: 404 });

  // Only a completed trial balance sync may be reconciled against. A run that
  // failed partway holds whatever was written before the failure.
  const snapshotRow = db
    .select()
    .from(reportSnapshots)
    .innerJoin(syncRuns, eq(reportSnapshots.syncRunId, syncRuns.id))
    .where(
      and(
        eq(reportSnapshots.entityId, entityId),
        eq(reportSnapshots.reportType, "trial_balance"),
        eq(reportSnapshots.periodEnd, periodEnd),
        eq(syncRuns.status, "complete")
      )
    )
    .orderBy(desc(reportSnapshots.createdAt))
    .get();

  if (!snapshotRow) {
    return NextResponse.json(
      {
        error: `No completed trial balance has been synced for ${periodEnd}. Sync one before preparing workpapers.`,
      },
      { status: 409 }
    );
  }
  const snapshot = snapshotRow.report_snapshots;

  // A trial balance whose debits and credits disagree means the parse is
  // wrong, and every workpaper derived from it would inherit that.
  if (snapshot.balanced === false) {
    return NextResponse.json(
      { error: "The trial balance for this period does not balance. Resolve that before reconciling." },
      { status: 409 }
    );
  }

  const existing = db
    .select()
    .from(reconciliationPeriods)
    .where(
      and(
        eq(reconciliationPeriods.entityId, entityId),
        eq(reconciliationPeriods.periodEnd, periodEnd)
      )
    )
    .get();

  if (existing?.status === "locked") {
    return NextResponse.json(
      { error: "This period is locked. Reopen it before re-seeding workpapers." },
      { status: 409 }
    );
  }

  const thresholdRows = db.select().from(varianceThresholds).all();
  const materiality = resolveThreshold(thresholdRows, entityId, "balance_sheet");

  const tbRows = db
    .select()
    .from(reportRows)
    .where(eq(reportRows.snapshotId, snapshot.id))
    .all()
    .filter((r) => !r.isSubtotal);

  const now = nowUtcIso();
  const periodId = existing?.id ?? nanoid();
  let seeded = 0;

  db.transaction((tx) => {
    if (!existing) {
      tx.insert(reconciliationPeriods)
        .values({
          id: periodId,
          entityId,
          periodEnd,
          status: "open",
          tbSnapshotId: snapshot.id,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    } else {
      tx.update(reconciliationPeriods)
        .set({ tbSnapshotId: snapshot.id, updatedAt: now })
        .where(eq(reconciliationPeriods.id, periodId))
        .run();
    }

    for (const tbRow of tbRows) {
      const accountCode = tbRow.accountCode ?? tbRow.accountName;

      const substantiation = substantiateBankBalance(entityId, accountCode, periodEnd);
      const resolution = resolveWorkpaperStatus(
        {
          tbAmount: tbRow.amount,
          substantiatedAmount: substantiation.amount,
          substantiationType: substantiation.type,
          availability: substantiation.availability,
          currency: tbRow.currency,
        },
        materiality
      );

      const isMaterial = materiality
        ? Money.of(tbRow.amount, tbRow.currency)
            .abs()
            .compare(Money.of(materiality.absoluteAmount, tbRow.currency).abs()) > 0
        : true;

      const values = {
        periodId,
        entityId,
        accountCode,
        accountName: tbRow.accountName,
        xeroAccountId: tbRow.xeroAccountId,
        tbRowId: tbRow.id,
        tbAmount: tbRow.amount,
        substantiationType: substantiation.type,
        substantiatedAmount: substantiation.amount,
        substantiationSourceRef: substantiation.sourceRef,
        substantiationAvailability: substantiation.availability,
        difference: resolution.difference,
        currency: tbRow.currency,
        status: resolution.status,
        isMaterial,
        updatedAt: now,
      };

      const prior = tx
        .select()
        .from(reconciliationWorkpapers)
        .where(
          and(
            eq(reconciliationWorkpapers.periodId, periodId),
            eq(reconciliationWorkpapers.accountCode, accountCode)
          )
        )
        .get();

      // A workpaper someone has already reviewed is not overwritten by a
      // re-seed. Their sign-off would otherwise vanish silently.
      if (prior && (prior.status === "reviewed" || prior.status === "locked")) continue;

      if (prior) {
        tx.update(reconciliationWorkpapers)
          .set(values)
          .where(eq(reconciliationWorkpapers.id, prior.id))
          .run();
      } else {
        tx.insert(reconciliationWorkpapers)
          .values({ id: nanoid(), createdAt: now, ...values })
          .run();
      }
      seeded += 1;
    }
  });

  await recordAuditEvent({
    actorEmail: actor.email,
    action: "reconciliation.seeded",
    entityId,
    resourceType: "reconciliation_period",
    resourceId: periodId,
    detail: { periodEnd, workpapers: seeded, tbSnapshotId: snapshot.id },
  });

  return NextResponse.json({ periodId, workpapers: seeded }, { status: 201 });
}

/**
 * The one substantiation that can resolve without client input today.
 *
 * Everything else in BS-002 needs a source this build does not have: aged
 * receivables and payables need the invoice tables, GST needs Module G, loans
 * need Module H, and fixed assets need a scope this build deliberately lacks.
 * Those land as `none` and stay visibly unsupported.
 */
function substantiateBankBalance(
  entityId: string,
  accountCode: string,
  periodEnd: string
): {
  type: "bank_balance" | "none";
  amount: string | null;
  availability: "available" | "unavailable";
  sourceRef: string | null;
} {
  const accounts = db
    .select()
    .from(entityBankAccounts)
    .where(
      and(eq(entityBankAccounts.entityId, entityId), eq(entityBankAccounts.xeroAccountCode, accountCode))
    )
    .all();

  if (accounts.length === 0) {
    return { type: "none", amount: null, availability: "unavailable", sourceRef: null };
  }

  // Two bank accounts mapped to the same Xero code is a mapping error, and
  // picking either one substantiates a balance from an account nobody chose.
  // Fail closed, the same way resolveXeroRoute does on a duplicate assignment.
  if (accounts.length > 1) {
    return { type: "bank_balance", amount: null, availability: "unavailable", sourceRef: null };
  }

  const account = accounts[0]!;

  // The latest snapshot at or before the period end. A balance dated after the
  // period cannot substantiate it.
  const snapshot = db
    .select()
    .from(bankBalanceSnapshots)
    .where(eq(bankBalanceSnapshots.entityBankAccountId, account.id))
    .orderBy(desc(bankBalanceSnapshots.balanceDate), desc(bankBalanceSnapshots.createdAt))
    .all()
    .find((s) => s.balanceDate <= periodEnd);

  if (!snapshot) {
    return { type: "bank_balance", amount: null, availability: "unavailable", sourceRef: null };
  }

  return {
    type: "bank_balance",
    amount: snapshot.closingBalance,
    availability: "available",
    sourceRef: `bank_balance_snapshots:${snapshot.id}`,
  };
}
