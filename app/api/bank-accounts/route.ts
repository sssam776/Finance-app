import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { z } from "zod";
import { db } from "@/db/client";
import { entityBankAccounts } from "@/db/schema";
import { eq } from "drizzle-orm";
import { nowUtcIso } from "@/lib/dates";
import { recordAuditEvent } from "@/lib/audit";
import { requireSession, entityAccessFor } from "@/lib/session";
import { canAccessEntity, filterByEntityAccess } from "@/lib/entityAccess";

const createSchema = z.object({
  entityId: z.string().min(1),
  bankName: z.enum(["ASB", "BNZ"]),
  accountNumber: z.string().min(1),
  accountName: z.string().min(1),
  currency: z.string().default("NZD"),
  xeroAccountCode: z.string().optional(),
  isLoanFacility: z.boolean().default(false),
});

export async function GET(request: Request) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  const url = new URL(request.url);
  const entityId = url.searchParams.get("entityId");

  const rows = entityId
    ? db.select().from(entityBankAccounts).where(eq(entityBankAccounts.entityId, entityId)).all()
    : db.select().from(entityBankAccounts).all();

  return NextResponse.json({ bankAccounts: filterByEntityAccess(entityAccessFor(actor), rows) });
}

export async function POST(request: Request) {
  const actor = await requireSession("admin");
  if (actor instanceof NextResponse) return actor;

  const body = await request.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  if (!canAccessEntity(entityAccessFor(actor), parsed.data.entityId)) {
    return NextResponse.json({ error: "No access to this entity" }, { status: 403 });
  }

  const now = nowUtcIso();
  const id = nanoid();

  db.insert(entityBankAccounts)
    .values({
      id,
      entityId: parsed.data.entityId,
      bankName: parsed.data.bankName,
      accountNumber: parsed.data.accountNumber,
      accountName: parsed.data.accountName,
      currency: parsed.data.currency,
      xeroAccountCode: parsed.data.xeroAccountCode,
      isLoanFacility: parsed.data.isLoanFacility,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  await recordAuditEvent({
    actorEmail: actor.email,
    action: "bank_account.created",
    entityId: parsed.data.entityId,
    resourceType: "entity_bank_account",
    resourceId: id,
  });

  return NextResponse.json({ id }, { status: 201 });
}
