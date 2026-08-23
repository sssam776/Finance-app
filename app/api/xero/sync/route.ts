import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { xeroAccounts } from "@/db/schema";
import { resolveXeroRoute, getAuthenticatedClient } from "@/lib/xero/gateway";
import { startSyncRun, completeSyncRun, failSyncRun } from "@/lib/xero/syncRun";
import { parseBankSummaryClosingBalances } from "@/lib/xero/reports";
import { nowUtcIso } from "@/lib/dates";
import { requireSession, entityAccessFor } from "@/lib/session";
import { canAccessEntity } from "@/lib/entityAccess";

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
  if (!canAccessEntity(entityAccessFor(actor), entityId)) {
    return NextResponse.json({ error: "No access to this entity" }, { status: 403 });
  }

  let route;
  try {
    route = await resolveXeroRoute(entityId, "read_core");
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const syncRunId = startSyncRun({ route, resource: "accounts+bank_summary" });

  try {
    const { client, tenantId } = await getAuthenticatedClient(route);

    // Active accounts of every type, not only BANK. Later modules need the
    // full chart, and a non-bank account simply carries a null balance: the
    // unique index is on (entity_id, xero_account_id), so nothing collides.
    const accountsResponse = await client.accountingApi.getAccounts(
      tenantId,
      undefined,
      'Status=="ACTIVE"'
    );
    const accounts = accountsResponse.body.accounts ?? [];

    const bankSummary = await client.accountingApi.getReportBankSummary(tenantId);
    const closingBalances = parseBankSummaryClosingBalances(bankSummary.body);
    const balanceByName = new Map(closingBalances.map((b) => [b.accountName, b.closingBalance]));

    const now = nowUtcIso();
    let recordsWritten = 0;

    for (const account of accounts) {
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

    await completeSyncRun({
      syncRunId,
      route,
      actorEmail: actor.email,
      recordsRead: recordsWritten,
      detail: { bankSummaryRows: closingBalances.length },
    });

    return NextResponse.json({ syncRunId, recordsWritten });
  } catch (err) {
    const message = await failSyncRun({ syncRunId, route, actorEmail: actor.email, error: err });
    return NextResponse.json({ error: message, syncRunId }, { status: 502 });
  }
}
