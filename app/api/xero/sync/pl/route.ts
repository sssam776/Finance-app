import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { reportSnapshots, reportRows } from "@/db/schema";
import { resolveXeroRoute, getAuthenticatedClient } from "@/lib/xero/gateway";
import { startSyncRun, completeSyncRun, failSyncRun } from "@/lib/xero/syncRun";
import {
  parseProfitAndLoss,
  payloadHash,
  REPORT_PARSER_VERSION,
  headersOf,
} from "@/lib/xero/reports";
import { nowUtcIso, isValidDateOnly } from "@/lib/dates";
import { periodKeyFromColumnLabel } from "@/lib/variance/columnLabel";
import { requireSession, entityAccessFor } from "@/lib/session";
import { canAccessEntity } from "@/lib/entityAccess";

/**
 * VAR-001: pulls a monthly Profit and Loss into an immutable snapshot.
 *
 * A refresh inserts a new snapshot rather than updating one (spec 14.7), so a
 * figure someone signed off last month still resolves to what they signed off
 * on, even after Xero's own numbers move.
 */

const syncSchema = z.object({
  entityId: z.string().min(1),
  /** Date-only. The last day of the most recent month to fetch. */
  periodEnd: z.string().refine(isValidDateOnly, "periodEnd must be a valid YYYY-MM-DD date"),
  /**
   * How many months back to request as comparison columns. Xero documents a
   * maximum of 12 (accountingApi.d.ts), so a larger value is rejected here as
   * a 400 rather than surfacing later as an opaque upstream 502.
   */
  periods: z.number().int().min(1).max(12).default(12),
  /** Cash basis when true. Accrual is the default and the usual reporting basis. */
  paymentsOnly: z.boolean().default(false),
});

/** Maps the parser's section kinds onto the narrower set the schema stores. */
function storedSectionKind(kind: string): "revenue" | "expense" | "other" {
  if (kind === "revenue" || kind === "other_income") return "revenue";
  if (kind === "cost_of_sales" || kind === "operating_expense" || kind === "other_expense") {
    return "expense";
  }
  return "other";
}

export async function POST(request: Request) {
  const actor = await requireSession("admin");
  if (actor instanceof NextResponse) return actor;

  const parsed = syncSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { entityId, periodEnd, periods, paymentsOnly } = parsed.data;

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

  const syncRunId = startSyncRun({ route, resource: "profit_and_loss" });

  try {
    const { client, tenantId } = await getAuthenticatedClient(route);

    // Argument order matters and is easy to get wrong: there are FOUR tracking
    // parameters between the timeframe and standardLayout, not two. Passing
    // standardLayout early sends `true` as a tracking option id.
    const response = await client.accountingApi.getReportProfitAndLoss(
      tenantId,
      undefined, // fromDate: Xero derives it from toDate and the period count
      periodEnd,
      periods,
      "MONTH",
      undefined, // trackingCategoryID
      undefined, // trackingCategoryID2
      undefined, // trackingOptionID
      undefined, // trackingOptionID2
      true, // standardLayout, so section titles are predictable enough to classify
      paymentsOnly
    );

    const accountRows = parseProfitAndLoss(response.body);
    const now = nowUtcIso();
    const snapshotId = nanoid();

    // Column labels that cannot be resolved to a period are collected and
    // reported rather than dropped quietly. A figure filed under the wrong
    // month is worse than a figure that is visibly missing.
    const unresolvedColumns = new Set<string>();
    let written = 0;
    const shortRows = accountRows.filter((r) => r.short).length;

    // One transaction. A snapshot committed without its rows is readable as
    // authoritative and holds only whatever was written before the failure,
    // which is a report built from half an answer.
    db.transaction((tx) => {
      tx.insert(reportSnapshots)
        .values({
          id: snapshotId,
          entityId,
          reportType: "profit_and_loss",
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

      for (const [index, accountRow] of accountRows.entries()) {
        for (const column of accountRow.amountsByColumn) {
          if (column.amount === null) continue;

          const period = periodKeyFromColumnLabel(column.columnLabel);
          if (!period) {
            unresolvedColumns.add(column.columnLabel);
            continue;
          }

          tx.insert(reportRows)
            .values({
              id: nanoid(),
              snapshotId,
              rowOrder: index,
              sectionTitle: accountRow.section,
              sectionKind: storedSectionKind(accountRow.sectionKind),
              accountCode: null,
              accountName: accountRow.accountName,
              xeroAccountId: accountRow.xeroAccountId,
              periodKey: period,
              amount: column.amount,
              currency: "NZD",
              isSubtotal: accountRow.isSubtotal,
              createdAt: now,
            })
            .run();
          written += 1;
        }
      }

      tx.update(reportSnapshots)
        .set({ rowCount: written, updatedAt: nowUtcIso() })
        .where(eq(reportSnapshots.id, snapshotId))
        .run();
    });

    await completeSyncRun({
      syncRunId,
      route,
      actorEmail: actor.email,
      recordsRead: written,
      // A run that could not place every column, or that saw rows narrower
      // than the header, is partial rather than complete: it must not be
      // treated as a full refresh, and the read route only trusts complete
      // runs.
      partial: unresolvedColumns.size > 0 || shortRows > 0,
      detail: {
        snapshotId,
        accountRows: accountRows.length,
        columnHeaders: headersOf(response.body),
        unresolvedColumns: [...unresolvedColumns],
        shortRows,
      },
    });

    return NextResponse.json({
      syncRunId,
      snapshotId,
      rowsWritten: written,
      unresolvedColumns: [...unresolvedColumns],
    });
  } catch (err) {
    const message = await failSyncRun({ syncRunId, route, actorEmail: actor.email, error: err });
    return NextResponse.json({ error: message, syncRunId }, { status: 502 });
  }
}
