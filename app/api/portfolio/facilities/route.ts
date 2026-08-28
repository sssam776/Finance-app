import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { entities, lenders, loanFacilities, facilityEvents } from "@/db/schema";
import { requireSession, entityAccessFor } from "@/lib/session";
import { canAccessEntity, filterByEntityAccess } from "@/lib/entityAccess";
import { recordAuditEvent } from "@/lib/audit";
import { nowUtcIso, isValidDateOnly, nzDateOnlyNow } from "@/lib/dates";
import { expiryWatch, valueWithin, BOARD_HORIZON_DAYS } from "@/lib/portfolio/expiry";
import { resolveLender, resolvePool } from "@/lib/portfolio/registry";
import { csvResponse, csvFilename } from "@/lib/csv/toCsv";

/**
 * Loan facilities and the expiry watch built from them.
 *
 * The register is hand-kept on purpose. Which facility secures which property,
 * when its rate re-fixes and when its term ends do not come out of Xero
 * cleanly, and the CFO schedule holds them as prose in several date formats.
 * Normalising them on the way in is what makes the watch possible at all.
 */

/**
 * Balances are unsigned. A drawn loan balance is never negative, and a signed
 * pattern let an entry mistake reduce the reported twelve-month exposure
 * rather than being refused: a facility posted at -4,000,000 netted off
 * against a real one and understated the figure a board acts on.
 *
 * The length bound refuses an amount no property group holds, so a slipped
 * keyboard cannot produce a total that is arithmetically fine and obviously
 * absurd.
 */
const MONEY = /^\d{1,15}(\.\d{1,2})?$/;

/**
 * Thrown to roll the write back when the facility already exists. A sentinel
 * rather than a bare Error so the catch can tell an expected duplicate from a
 * genuine failure and rethrow the latter.
 */
class DuplicateFacility extends Error {}

const facilitySchema = z.object({
  entityId: z.string().min(1),
  lenderName: z.string().trim().min(1).max(120),
  /**
   * The security pool this facility is drawn against. Defaults to the
   * lender's own pool, which is the ordinary case: a bank's facilities are
   * secured over the properties charged to that bank.
   *
   * Without this the facility carried no pool and every pool position
   * reported zero debt against real security, which reads as enormous
   * headroom rather than as missing data.
   */
  poolName: z.string().trim().min(1).max(120).optional(),
  facilityReference: z.string().trim().min(1).max(120),
  facilityType: z
    .enum(["term_loan", "revolving_credit", "overdraft", "development", "other"])
    .default("term_loan"),
  drawnAmount: z.string().regex(MONEY, "drawnAmount must be a positive decimal amount"),
  facilityLimit: z
    .string()
    .regex(MONEY, "facilityLimit must be a positive decimal amount")
    .optional(),
  // Letters only. A three-character free-for-all let "=1+" through, which then
  // became its own bucket in the per-currency board total.
  currency: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{3}$/, "currency must be a three-letter code, e.g. NZD")
    .default("NZD"),
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
          facilityId: facility.id,
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
  const facilityId = nanoid();

  /**
   * Lender resolution, the duplicate check and every insert happen in one
   * transaction.
   *
   * Lenders are created by name on first use rather than administered on their
   * own screen. Previously that insert sat outside the transaction, so a
   * facility that failed to save left an orphan lender behind, created into
   * global state by an entity-scoped actor.
   *
   * The name match is case-insensitive. The unique index on `lenders.name` is
   * BINARY, so "ASB" and "asb" were two lenders, which then defeated the
   * facility uniqueness index entirely: the same real loan could be entered
   * twice, appear twice in the register, and still be counted once in the
   * board figure.
   */
  let conflict: string | null = null;

  try {
    db.transaction((tx) => {
      const lender = resolveLender(tx, input.lenderName, {
        interestCapitalised: input.interestCapitalised,
      });
      const pool = resolvePool(tx, lender.id, input.poolName ?? input.lenderName, {
        targetLvr: "0.65",
        stressRate: "0.07",
      });

    /**
     * Scoped to the entity as well as the lender. The check used to scan every
     * facility in the group, which told a caller that a reference existed
     * inside an entity they have no access to, and refused a shape that is
     * ordinary in a property group: two SPVs each holding an ASB facility
     * referenced "1".
     */
    const existing = tx
      .select()
      .from(loanFacilities)
      .where(
        and(
          eq(loanFacilities.entityId, input.entityId),
          eq(loanFacilities.lenderId, lender.id),
          eq(loanFacilities.facilityReference, input.facilityReference)
        )
      )
      .get();

    if (existing) {
      conflict = `${entity.shortCode} already has a ${lender.name} facility referenced ${input.facilityReference}.`;
      // Rolls the transaction back, so a lender created above for a request
      // that turns out to be a duplicate is not left behind.
      throw new DuplicateFacility();
    }

    tx.insert(loanFacilities)
      .values({
        id: facilityId,
        entityId: input.entityId,
        lenderId: lender.id,
        poolId: pool.id,
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
  } catch (err) {
    // A rolled-back duplicate is an expected outcome, not a failure. Anything
    // else is a real error and is rethrown.
    if (!(err instanceof DuplicateFacility)) throw err;
  }

  if (conflict) {
    return NextResponse.json({ error: conflict }, { status: 409 });
  }

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
