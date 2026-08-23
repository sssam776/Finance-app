import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { syncRuns, xeroAccounts, xeroConnections } from "@/db/schema";
import { resolveXeroRoute, getAuthenticatedClient } from "@/lib/xero/gateway";
import { parseBankSummaryClosingBalances } from "@/lib/xero/reports";
import { nowUtcIso } from "@/lib/dates";
import { recordAuditEvent } from "@/lib/audit";
import { requireSession } from "@/lib/session";

/**
 * Fetches Accounts (reference data) and the Bank Summary report (closing
 * balances) for one entity's read_core connection, then stores both with
 * full lineage. This is the minimal read slice needed for CASH-004
 * (Xero-to-bank variance) — P&L, balance sheet, GST etc. are deferred
 * (see docs/implementation-plan.md).
 */

export async function POST(request: Request) {
  const actor = await requireSession("admin");
  if (actor instanceof NextResponse) return actor;

  const body = await request.json().catch(() => ({}));
  const entityId = body.entityId;
  if (typeof entityId !== "string" || entityId === "") {
    return NextResponse.json({ error: "Missing entityId" }, { status: 400 });
  }

  const now = nowUtcIso();
  const syncRunId = nanoid();

  let route;
  try {
    route = await resolveXeroRoute(entityId, "read_core");
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  db.insert(syncRuns)
    .values({
      id: syncRunId,
      xeroAppId: route.xeroAppId,
      connectionId: route.connectionId,
      entityId,
      resource: "accounts+bank_summary",
      status: "running",
      startedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  try {
    const { client, tenantId } = await getAuthenticatedClient(route);

    const accountsResponse = await client.accountingApi.getAccounts(tenantId, undefined, "Type==\"BANK\"");
    const bankAccounts = accountsResponse.body.accounts ?? [];

    const bankSummary = await client.accountingApi.getReportBankSummary(tenantId);
    const closingBalances = parseBankSummaryClosingBalances(bankSummary.body);
    const balanceByName = new Map(closingBalances.map((b) => [b.accountName, b.closingBalance]));

    let recordsWritten = 0;
    for (const account of bankAccounts) {
      if (!account.accountID || !account.name) continue;
      const closingBalance = balanceByName.get(account.name) ?? null;

      const existing = db
        .select()
        .from(xeroAccounts)
        .where(and(eq(xeroAccounts.entityId, entityId), eq(xeroAccounts.xeroAccountId, account.accountID)))
        .get();

      const values = {
        entityId,
        xeroAppId: route.xeroAppId,
        connectionId: route.connectionId,
        tenantId,
        xeroAccountId: account.accountID,
        code: account.code ?? null,
        name: account.name,
        type: account.type ? String(account.type) : null,
        currentBalance: closingBalance,
        balanceAsAt: closingBalance ? now.slice(0, 10) : null,
        sourceUpdatedAt: account.updatedDateUTC ? new Date(account.updatedDateUTC).toISOString() : null,
        syncRunId,
        updatedAt: now,
      };

      if (existing) {
        db.update(xeroAccounts).set(values).where(eq(xeroAccounts.id, existing.id)).run();
      } else {
        db.insert(xeroAccounts)
          .values({ id: nanoid(), createdAt: now, ...values })
          .run();
      }
      recordsWritten += 1;
    }

    db.update(syncRuns)
      .set({ status: "complete", recordsRead: recordsWritten, finishedAt: nowUtcIso(), updatedAt: nowUtcIso() })
      .where(eq(syncRuns.id, syncRunId))
      .run();

    db.update(xeroConnections)
      .set({ lastSuccessfulCallAt: nowUtcIso(), status: "healthy", updatedAt: nowUtcIso() })
      .where(eq(xeroConnections.id, route.connectionId))
      .run();

    await recordAuditEvent({
      actorEmail: actor.email,
      action: "xero_sync.complete",
      entityId,
      resourceType: "sync_run",
      resourceId: syncRunId,
      detail: { recordsWritten },
    });

    return NextResponse.json({ syncRunId, recordsWritten });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown sync error";
    db.update(syncRuns)
      .set({ status: "failed", error: message, finishedAt: nowUtcIso(), updatedAt: nowUtcIso() })
      .where(eq(syncRuns.id, syncRunId))
      .run();

    db.update(xeroConnections)
      .set({ status: "sync_error", updatedAt: nowUtcIso() })
      .where(eq(xeroConnections.id, route.connectionId))
      .run();

    await recordAuditEvent({
      actorEmail: actor.email,
      action: "xero_sync.failed",
      entityId,
      resourceType: "sync_run",
      resourceId: syncRunId,
      detail: { error: message },
    });

    return NextResponse.json({ error: message, syncRunId }, { status: 502 });
  }
}
