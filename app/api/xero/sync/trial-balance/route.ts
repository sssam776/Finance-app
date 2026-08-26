import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { z } from "zod";
import { eq } from "drizzle-orm";
import Decimal from "decimal.js";
import { db } from "@/db/client";
import { reportSnapshots, reportRows } from "@/db/schema";
import { resolveXeroRoute, getAuthenticatedClient } from "@/lib/xero/gateway";
import { startSyncRun, completeSyncRun, failSyncRun } from "@/lib/xero/syncRun";
import {
  rowsOf,
  headersOf,
  columnIndex,
  parseReportAmount,
  payloadHash,
  trialBalanceBalances,
  isAggregateRowLabel,
  REPORT_PARSER_VERSION,
} from "@/lib/xero/reports";
import { nowUtcIso, isValidDateOnly } from "@/lib/dates";
import { requireSession, entityAccessFor } from "@/lib/session";
import { canAccessEntity } from "@/lib/entityAccess";

/**
 * Trial balance snapshot, the input Module D reconciles against.
 *
 * Debit and credit columns are located by header rather than by position, and
 * the run is marked partial if they cannot be found. A trial balance parsed
 * from the wrong columns produces workpapers that are all wrong in the same
 * direction, which reads as a systematic problem rather than a parse error.
 */

const syncSchema = z.object({
  entityId: z.string().min(1),
  periodEnd: z.string().refine(isValidDateOnly, "periodEnd must be YYYY-MM-DD"),
});

export async function POST(request: Request) {
  const actor = await requireSession("admin");
  if (actor instanceof NextResponse) return actor;

  const parsed = syncSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { entityId, periodEnd } = parsed.data;

  if (!canAccessEntity(entityAccessFor(actor), entityId)) {
    return NextResponse.json({ error: "No access to this entity" }, { status: 403 });
  }

  let route;
  try {
    route = await resolveXeroRoute(entityId, "read_core");
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 400 }
    );
  }

  const syncRunId = startSyncRun({ route, resource: "trial_balance" });

  try {
    const { client, tenantId } = await getAuthenticatedClient(route);
    const response = await client.accountingApi.getReportTrialBalance(tenantId, periodEnd);

    const headers = headersOf(response.body);
    const debitIndex = columnIndex(response.body, /debit/i);
    const creditIndex = columnIndex(response.body, /credit/i);
    const columnsResolved = debitIndex > 0 && creditIndex > 0;

    let debitTotal = new Decimal(0);
    let creditTotal = new Decimal(0);
    const now = nowUtcIso();
    const snapshotId = nanoid();

    const walked = rowsOf(response.body).filter(
      (row) => row.cells.length >= 2 && row.cells[0]!.value.trim() !== ""
    );

    db.transaction((tx) => {
      tx.insert(reportSnapshots)
        .values({
          id: snapshotId,
          entityId,
          reportType: "trial_balance",
          periodEnd,
          xeroAppId: route.xeroAppId,
          connectionId: route.connectionId,
          tenantId,
          syncRunId,
          sourceReportId: response.body.reports?.[0]?.reportID ?? null,
          reportTitle: response.body.reports?.[0]?.reportName ?? null,
          payloadHash: payloadHash(response.body),
          parserVersion: REPORT_PARSER_VERSION,
          rowCount: 0,
          fetchedAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      let written = 0;
      for (const [index, row] of walked.entries()) {
        const accountName = row.cells[0]!.value;
        const isSubtotal = row.isSubtotal || isAggregateRowLabel(accountName);

        const debit = columnsResolved ? parseReportAmount(row.cells[debitIndex]?.value ?? "") : null;
        const credit = columnsResolved
          ? parseReportAmount(row.cells[creditIndex]?.value ?? "")
          : null;

        // Debit-positive. BS-003 keeps the source signs alongside it as
        // evidence rather than replacing them.
        const signed = new Decimal(debit ?? "0").minus(new Decimal(credit ?? "0"));

        if (!isSubtotal) {
          debitTotal = debitTotal.plus(new Decimal(debit ?? "0"));
          creditTotal = creditTotal.plus(new Decimal(credit ?? "0"));
        }

        tx.insert(reportRows)
          .values({
            id: nanoid(),
            snapshotId,
            rowOrder: index,
            sectionTitle: row.sectionTitle,
            sectionKind: "other",
            accountCode: null,
            accountName,
            xeroAccountId: row.cells[0]!.attributes.account ?? null,
            periodKey: periodEnd,
            amount: signed.toFixed(4),
            currency: "NZD",
            sourceDebit: debit,
            sourceCredit: credit,
            isSubtotal,
            createdAt: now,
          })
          .run();
        written += 1;
      }

      const balanced = columnsResolved
        ? trialBalanceBalances(debitTotal.toFixed(4), creditTotal.toFixed(4))
        : false;

      tx.update(reportSnapshots)
        .set({
          rowCount: written,
          debitTotal: debitTotal.toFixed(4),
          creditTotal: creditTotal.toFixed(4),
          balanced,
          updatedAt: nowUtcIso(),
        })
        .where(eq(reportSnapshots.id, snapshotId))
        .run();
    });

    const snapshot = db
      .select()
      .from(reportSnapshots)
      .where(eq(reportSnapshots.id, snapshotId))
      .get()!;

    await completeSyncRun({
      syncRunId,
      route,
      actorEmail: actor.email,
      recordsRead: snapshot.rowCount,
      // Unbalanced or unlocatable columns mean the parse cannot be trusted, so
      // the run is partial and Module D refuses to seed from it.
      partial: !columnsResolved || snapshot.balanced === false,
      detail: {
        snapshotId,
        columnHeaders: headers,
        columnsResolved,
        debitTotal: snapshot.debitTotal,
        creditTotal: snapshot.creditTotal,
        balanced: snapshot.balanced,
      },
    });

    return NextResponse.json({
      syncRunId,
      snapshotId,
      rowsWritten: snapshot.rowCount,
      balanced: snapshot.balanced,
      columnsResolved,
    });
  } catch (err) {
    const message = await failSyncRun({ syncRunId, route, actorEmail: actor.email, error: err });
    return NextResponse.json({ error: message, syncRunId }, { status: 502 });
  }
}
