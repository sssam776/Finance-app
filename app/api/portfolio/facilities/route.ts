import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { z } from "zod";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { entities, lenders, loanFacilities, facilityEvents } from "@/db/schema";
import { requireSession, entityAccessFor } from "@/lib/session";
import { canAccessEntity, filterByEntityAccess } from "@/lib/entityAccess";
import { recordAuditEvent } from "@/lib/audit";
import { nowUtcIso, isValidDateOnly, nzDateOnlyNow } from "@/lib/dates";
import { expiryWatch, valueWithin, BOARD_HORIZON_DAYS } from "@/lib/portfolio/expiry";
import { csvResponse, csvFilename } from "@/lib/csv/toCsv";

/**
 * Loan facilities and the expiry watch built from them.
 *
 * The register is hand-kept on purpose. Which facility secures which property,
 * when its rate re-fixes and when its term ends do not come out of Xero
 * cleanly, and the CFO schedule holds them as prose in several date formats.
 * Normalising them on the way in is what makes the watch possible at all.
 */

const MONEY = /^-?\d+(\.\d{1,2})?$/;

const facilitySchema = z.object({
  entityId: z.string().min(1),
  lenderName: z.string().trim().min(1).max(120),
  facilityReference: z.string().trim().min(1).max(120),
  facilityType: z
    .enum(["term_loan", "revolving_credit", "overdraft", "development", "other"])
    .default("term_loan"),
  drawnAmount: z.string().regex(MONEY, "drawnAmount must be a decimal amount"),
  facilityLimit: z.string().regex(MONEY, "facilityLimit must be a decimal amount").optional(),
  currency: z.string().trim().length(3).default("NZD"),
  /** Decimal fraction: 0.0785 for 7.85% p.a. */
  interestRate: z
    .string()
    .regex(/^\d+(\.\d+)?$/, "interestRate must be a decimal fraction, e.g. 0.0785")
    .optional(),
  rateType: z.enum(["fixed", "floating", "capitalised", "unknown"]).default("unknown"),
  interestCapitalised: z.boolean().default(false),
  includeInAvailableLiquidity: z.boolean().default(false),
  rateRefixDate: z.string().refine(isValidDateOnly, "rateRefixDate must be YYYY-MM-DD").optional(),
  termExpiryDate: z.string().refine(isValidDateOnly, "termExpiryDate must be YYYY-MM-DD").optional(),
  notes: z.string().trim().max(500).optional(),
});

export async function GET(request: Request) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  const url = new URL(request.url);
  const asOf = url.searchParams.get("asOf");
  if (asOf && !isValidDateOnly(asOf)) {
    return NextResponse.json({ error: "asOf must be YYYY-MM-DD" }, { status: 400 });
  }
  const effectiveAsOf = asOf ?? nzDateOnlyNow();

  // Scoped exactly as every other read is. A facility belongs to an entity,
  // and a preparer trusted with two entities sees two entities' debt.
  const visible = filterByEntityAccess(
    entityAccessFor(actor),
    db
      .select()
      .from(loanFacilities)
      .where(eq(loanFacilities.active, true))
      .all()
      .map((f) => ({ ...f, entityId: f.entityId }))
  );

  const allEntities = db.select().from(entities).all();
  const allLenders = db.select().from(lenders).all();

  const events = visible.length
    ? db
        .select()
        .from(facilityEvents)
        .where(
          inArray(
            facilityEvents.facilityId,
            visible.map((f) => f.id)
          )
        )
        .all()
    : [];

  const rows = expiryWatch(
    events.flatMap((event) => {
      const facility = visible.find((f) => f.id === event.facilityId);
      if (!facility) return [];
      // Drawdowns are recorded for history and are not a deadline. Including
      // them would put a past funding date into a list headed "expiring".
      if (event.eventType === "drawdown") return [];
      return [
        {
          facilityReference: facility.facilityReference,
          lenderName: allLenders.find((l) => l.id === facility.lenderId)?.name ?? "Unknown",
          entityShortCode:
            allEntities.find((e) => e.id === facility.entityId)?.shortCode ?? facility.entityId,
          eventType: event.eventType,
          eventDate: event.eventDate,
          amount: facility.drawnAmount,
          currency: facility.currency,
          confirmed: event.confirmed,
        },
      ];
    }),
    effectiveAsOf
  );

  if (url.searchParams.get("format") === "csv") {
    return csvResponse(
      csvFilename(["facility-expiry", effectiveAsOf]),
      ["Entity", "Lender", "Facility", "Event", "Date", "Days until", "Urgency", "Confirmed", "Drawn", "Currency"],
      rows.map((r) => [
        r.entityShortCode,
        r.lenderName,
        r.facilityReference,
        r.eventType,
        r.eventDate,
        r.daysUntil,
        r.urgency,
        r.confirmed ? "yes" : "no",
        r.amount,
        r.currency,
      ])
    );
  }

  return NextResponse.json({
    asOf: effectiveAsOf,
    facilities: visible.map((f) => ({
      id: f.id,
      entityShortCode: allEntities.find((e) => e.id === f.entityId)?.shortCode ?? f.entityId,
      lenderName: allLenders.find((l) => l.id === f.lenderId)?.name ?? "Unknown",
      facilityReference: f.facilityReference,
      facilityType: f.facilityType,
      drawnAmount: f.drawnAmount,
      facilityLimit: f.facilityLimit,
      currency: f.currency,
      interestRate: f.interestRate,
      rateType: f.rateType,
      interestCapitalised: f.interestCapitalised,
    })),
    watch: rows,
    /** The twelve-month figure a board paper leads with, per currency. */
    withinTwelveMonths: valueWithin(rows, BOARD_HORIZON_DAYS),
  });
}

export async function POST(request: Request) {
  const actor = await requireSession("admin");
  if (actor instanceof NextResponse) return actor;

  const parsed = facilitySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") },
      { status: 400 }
    );
  }
  const input = parsed.data;

  if (!canAccessEntity(entityAccessFor(actor), input.entityId)) {
    return NextResponse.json({ error: "No access to this entity" }, { status: 403 });
  }
  const entity = db.select().from(entities).where(eq(entities.id, input.entityId)).get();
  if (!entity) return NextResponse.json({ error: "Unknown entityId" }, { status: 404 });

  if (!input.rateRefixDate && !input.termExpiryDate) {
    return NextResponse.json(
      {
        error:
          "A facility needs a rate re-fix date, a term expiry date, or both. Without one it cannot appear on the expiry watch, which is the reason the register exists.",
      },
      { status: 400 }
    );
  }

  const now = nowUtcIso();

  // Lenders are created by name on first use rather than managed separately.
  // A lender is a name and a type; a screen to administer that would be a
  // screen nobody visits twice.
  let lender = db.select().from(lenders).where(eq(lenders.name, input.lenderName)).get();
  if (!lender) {
    const lenderId = nanoid();
    db.insert(lenders)
      .values({
        id: lenderId,
        name: input.lenderName,
        lenderType: input.interestCapitalised ? "second_tier" : "senior",
        active: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    lender = db.select().from(lenders).where(eq(lenders.id, lenderId)).get()!;
  }

  const existing = db
    .select()
    .from(loanFacilities)
    .where(eq(loanFacilities.facilityReference, input.facilityReference))
    .all()
    .find((f) => f.lenderId === lender!.id);
  if (existing) {
    return NextResponse.json(
      { error: `${input.lenderName} already has a facility referenced ${input.facilityReference}.` },
      { status: 409 }
    );
  }

  const facilityId = nanoid();

  // Facility and its events in one transaction. A facility written without its
  // dates is invisible to the watch while looking present in the register,
  // which is worse than a failed save.
  db.transaction((tx) => {
    tx.insert(loanFacilities)
      .values({
        id: facilityId,
        entityId: input.entityId,
        lenderId: lender!.id,
        facilityReference: input.facilityReference,
        facilityType: input.facilityType,
        facilityLimit: input.facilityLimit ?? null,
        drawnAmount: input.drawnAmount,
        currency: input.currency.toUpperCase(),
        interestRate: input.interestRate ?? null,
        rateType: input.rateType,
        interestCapitalised: input.interestCapitalised,
        includeInAvailableLiquidity: input.includeInAvailableLiquidity,
        active: true,
        notes: input.notes ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    for (const [eventType, eventDate] of [
      ["rate_refix", input.rateRefixDate],
      ["term_expiry", input.termExpiryDate],
    ] as const) {
      if (!eventDate) continue;
      tx.insert(facilityEvents)
        .values({
          id: nanoid(),
          facilityId,
          eventType,
          eventDate,
          confirmed: false,
          source: "manual entry",
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }
  });

  await recordAuditEvent({
    actorEmail: actor.email,
    action: "facility.created",
    entityId: input.entityId,
    resourceType: "loan_facility",
    resourceId: facilityId,
    detail: {
      lender: input.lenderName,
      reference: input.facilityReference,
      drawn: input.drawnAmount,
      rateRefixDate: input.rateRefixDate ?? null,
      termExpiryDate: input.termExpiryDate ?? null,
    },
  });

  return NextResponse.json({ id: facilityId }, { status: 201 });
}
