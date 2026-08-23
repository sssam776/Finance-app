import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { bankImports, bankBalanceSnapshots, entityBankAccounts } from "@/db/schema";
import { nowUtcIso } from "@/lib/dates";
import { parseBankCsv, PARSER_VERSION } from "@/lib/csv/parseBankCsv";
import { storeRawFile } from "@/lib/rawFileStore";
import { recordAuditEvent } from "@/lib/audit";
import { requireSession, entityAccessFor } from "@/lib/session";
import { canAccessEntity, filterByEntityAccess } from "@/lib/entityAccess";

/**
 * Server-side CSV ingestion per REM-002/REM-003: the raw file is stored
 * with a checksum before parsing, imports are replayable, and this is a
 * POST (never a GET) so there is no side effect on read.
 */

const MAX_FILE_BYTES = 5 * 1024 * 1024;

export async function GET(request: Request) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  const url = new URL(request.url);
  const entityId = url.searchParams.get("entityId");

  const rows = db
    .select({
      id: bankImports.id,
      entityId: bankImports.entityId,
      bankName: bankImports.bankName,
      status: bankImports.status,
      fileReceivedAt: bankImports.fileReceivedAt,
      processedAt: bankImports.processedAt,
      error: bankImports.error,
      sourceFileChecksum: bankImports.sourceFileChecksum,
    })
    .from(bankImports)
    .where(entityId ? eq(bankImports.entityId, entityId) : undefined)
    .orderBy(desc(bankImports.fileReceivedAt))
    .all();

  return NextResponse.json({ imports: filterByEntityAccess(entityAccessFor(actor), rows) });
}

export async function POST(request: Request) {
  const actor = await requireSession("admin");
  if (actor instanceof NextResponse) return actor;

  const form = await request.formData();
  const file = form.get("file");
  const entityBankAccountId = form.get("entityBankAccountId");
  // Importer identity comes from the session, never the form — see lib/session.ts.
  const importedByEmail = actor.email;

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }
  if (typeof entityBankAccountId !== "string" || entityBankAccountId === "") {
    return NextResponse.json({ error: "Missing entityBankAccountId" }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: `File exceeds ${MAX_FILE_BYTES} bytes` }, { status: 400 });
  }
  if (!file.name.toLowerCase().endsWith(".csv")) {
    return NextResponse.json({ error: "Only .csv files are accepted" }, { status: 400 });
  }

  const bankAccount = db
    .select()
    .from(entityBankAccounts)
    .where(eq(entityBankAccounts.id, entityBankAccountId))
    .get();

  if (!bankAccount) {
    return NextResponse.json({ error: "Unknown entityBankAccountId" }, { status: 404 });
  }
  // Scope is checked on the write path too. Being an admin does not mean being
  // an admin for every entity once explicit grants exist.
  if (!canAccessEntity(entityAccessFor(actor), bankAccount.entityId)) {
    return NextResponse.json({ error: "No access to this entity" }, { status: 403 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const stored = await storeRawFile({
    entityId: bankAccount.entityId,
    originalFileName: file.name,
    contents: buffer,
  });

  const now = nowUtcIso();
  const importId = nanoid();

  db.insert(bankImports)
    .values({
      id: importId,
      entityId: bankAccount.entityId,
      bankName: bankAccount.bankName,
      sourceFileKey: stored.key,
      sourceFileChecksum: stored.checksum,
      fileReceivedAt: now,
      importedByEmail: importedByEmail,
      parserVersion: PARSER_VERSION,
      status: "received",
      createdAt: now,
      updatedAt: now,
    })
    .run();

  try {
    const parsed = parseBankCsv(buffer.toString("utf-8"), bankAccount.currency);

    const snapshotId = nanoid();
    db.insert(bankBalanceSnapshots)
      .values({
        id: snapshotId,
        bankImportId: importId,
        entityBankAccountId: bankAccount.id,
        balanceDate: parsed.balanceDate,
        closingBalance: parsed.closingBalance,
        currency: parsed.currency,
        sourceRowRef: `row ${parsed.rows.length + 1}`,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    db.update(bankImports)
      .set({ status: "parsed", processedAt: nowUtcIso(), updatedAt: nowUtcIso() })
      .where(eq(bankImports.id, importId))
      .run();

    await recordAuditEvent({
      actorEmail: importedByEmail,
      action: "bank_import.parsed",
      entityId: bankAccount.entityId,
      resourceType: "bank_import",
      resourceId: importId,
      detail: { rows: parsed.rows.length, balanceDate: parsed.balanceDate },
    });

    return NextResponse.json({
      importId,
      snapshotId,
      balanceDate: parsed.balanceDate,
      closingBalance: parsed.closingBalance,
      rowsParsed: parsed.rows.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown parse error";
    db.update(bankImports)
      .set({ status: "failed", error: message, updatedAt: nowUtcIso() })
      .where(eq(bankImports.id, importId))
      .run();

    await recordAuditEvent({
      actorEmail: importedByEmail,
      action: "bank_import.failed",
      entityId: bankAccount.entityId,
      resourceType: "bank_import",
      resourceId: importId,
      detail: { error: message },
    });

    return NextResponse.json({ error: message, importId }, { status: 422 });
  }
}
