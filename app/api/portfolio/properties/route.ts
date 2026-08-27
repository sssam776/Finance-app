import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import {
  entities,
  properties,
  propertyValuations,
  propertyNoiSnapshots,
  propertyPoolMemberships,
  lenderPools,
  lenders,
  VALUATION_BASES,
  PROPERTY_STATUSES,
} from "@/db/schema";
import { requireSession, entityAccessFor } from "@/lib/session";
import { canAccessEntity, filterByEntityAccess } from "@/lib/entityAccess";
import { recordAuditEvent } from "@/lib/audit";
import { nowUtcIso, isValidDateOnly, nzDateOnlyNow } from "@/lib/dates";
import { resolveLender, resolvePool } from "@/lib/portfolio/registry";
import { csvResponse, csvFilename } from "@/lib/csv/toCsv";

/**
 * The security register: which properties the lenders hold as collateral, what
 * they are worth, and what they earn.
 *
 * This is hand-kept for the same reason the facility register is. Which
 * property secures which pool, and on what valuation basis, does not come out
 * of Xero at all; it lives in the loan agreements and the valuer's reports.
 */

const MONEY = /^\d{1,15}(\.\d{1,2})?$/;
const FRACTION = /^(0(\.\d+)?|1(\.0+)?)$/;

class DuplicateProperty extends Error {}

const propertySchema = z.object({
  entityId: z.string().min(1),
  name: z.string().trim().min(1).max(200),
  address: z.string().trim().max(300).optional(),
  status: z.enum(PROPERTY_STATUSES).default("investment"),

  /** The pool this property is charged to, identified by lender and pool name. */
  lenderName: z.string().trim().min(1).max(120),
  poolName: z.string().trim().min(1).max(120).optional(),
  /** Applied only when the pool is first created. */
  targetLvr: z.string().regex(FRACTION, "targetLvr must be a fraction between 0 and 1").default("0.65"),
  stressRate: z.string().regex(FRACTION, "stressRate must be a fraction between 0 and 1").default("0.07"),
  contributionShare: z
    .string()
    .regex(FRACTION, "contributionShare must be a fraction between 0 and 1")
    .default("1"),

  /**
   * Bank value by default, because that is the basis a covenant is tested on.
   * Market value is what you would sell for and is not interchangeable with
   * it: using one where the other is meant is the specific mistake the three
   * separate bases exist to prevent.
   */
  valuationBasis: z.enum(VALUATION_BASES).default("bank"),
  value: z.string().regex(MONEY, "value must be a positive decimal amount"),
  valuationDate: z.string().refine(isValidDateOnly, "valuationDate must be YYYY-MM-DD").optional(),
  valuer: z.string().trim().max(160).optional(),

  annualNoi: z.string().regex(MONEY, "annualNoi must be a positive decimal amount").optional(),
  noiAsOfDate: z.string().refine(isValidDateOnly, "noiAsOfDate must be YYYY-MM-DD").optional(),
  notes: z.string().trim().max(500).optional(),
});

export async function GET(request: Request) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  const url = new URL(request.url);
  const basis = url.searchParams.get("basis") ?? "bank";

  const visible = filterByEntityAccess(
    entityAccessFor(actor),
    db.select().from(properties).where(eq(properties.active, true)).all()
  );

  const allEntities = db.select().from(entities).all();
  const allPools = db.select().from(lenderPools).all();
  const allLenders = db.select().from(lenders).all();

  const rows = visible.map((p) => {
    // Latest valuation on the requested basis. Valuations are append-only, so
    // "latest" is the answer rather than the only row.
    const valuation = db
      .select()
      .from(propertyValuations)
      .where(
        and(eq(propertyValuations.propertyId, p.id), eq(propertyValuations.basis, basis as "bank"))
      )
      .all()
      .sort((a, b) => (b.valuationDate ?? "").localeCompare(a.valuationDate ?? ""))[0];

    const noi = db
      .select()
      .from(propertyNoiSnapshots)
      .where(eq(propertyNoiSnapshots.propertyId, p.id))
      .all()
      .sort((a, b) => b.asOfDate.localeCompare(a.asOfDate))[0];

    const membership = db
      .select()
      .from(propertyPoolMemberships)
      .where(eq(propertyPoolMemberships.propertyId, p.id))
      .all()
      .find((m) => m.effectiveTo === null);

    const poolRow = membership ? allPools.find((x) => x.id === membership.poolId) : undefined;

    return {
      id: p.id,
      name: p.name,
      address: p.address,
      status: p.status,
      entityShortCode: allEntities.find((e) => e.id === p.entityId)?.shortCode ?? p.entityId,
      poolName: poolRow?.name ?? null,
      lenderName: poolRow ? allLenders.find((l) => l.id === poolRow.lenderId)?.name ?? null : null,
      contributionShare: membership?.contributionShare ?? null,
      valuationBasis: basis,
      value: valuation?.value ?? null,
      valuationDate: valuation?.valuationDate ?? null,
      annualNoi: noi?.annualNoi ?? null,
      noiMappingStatus: noi?.mappingStatus ?? "unmapped",
    };
  });

  if (url.searchParams.get("format") === "csv") {
    return csvResponse(
      csvFilename(["security-register", nzDateOnlyNow()]),
      [
        "Entity",
        "Property",
        "Address",
        "Status",
        "Lender",
        "Pool",
        "Share",
        "Valuation basis",
        "Value",
        "Valued on",
        "Annual NOI",
        "Income mapping",
      ],
      rows.map((r) => [
        r.entityShortCode,
        r.name,
        r.address,
        r.status,
        r.lenderName,
        r.poolName,
        r.contributionShare,
        r.valuationBasis,
        r.value,
        r.valuationDate,
        r.annualNoi,
        r.noiMappingStatus,
      ])
    );
  }

  return NextResponse.json({ basis, properties: rows });
}

export async function POST(request: Request) {
  const actor = await requireSession("admin");
  if (actor instanceof NextResponse) return actor;

  const parsed = propertySchema.safeParse(await request.json().catch(() => ({})));
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

  const now = nowUtcIso();
  const propertyId = nanoid();
  let conflict: string | null = null;

  try {
    db.transaction((tx) => {
      /**
       * Scoped to the entity, matching the unique index. Two entities in a
       * group can hold similarly named properties, and the name is the only
       * identifier a hand-kept register has.
       */
      const existing = tx
        .select()
        .from(properties)
        .where(and(eq(properties.entityId, input.entityId), eq(properties.name, input.name)))
        .get();
      if (existing) {
        conflict = `${entity.shortCode} already has a property named ${input.name}.`;
        throw new DuplicateProperty();
      }

      const lender = resolveLender(tx, input.lenderName);
      const pool = resolvePool(tx, lender.id, input.poolName ?? input.lenderName, {
        targetLvr: input.targetLvr,
        stressRate: input.stressRate,
      });

      tx.insert(properties)
        .values({
          id: propertyId,
          entityId: input.entityId,
          name: input.name,
          address: input.address ?? null,
          assetType: null,
          status: input.status,
          active: true,
          notes: input.notes ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      tx.insert(propertyValuations)
        .values({
          id: nanoid(),
          propertyId,
          basis: input.valuationBasis,
          value: input.value,
          currency: entity.reportingCurrency,
          valuationDate: input.valuationDate ?? null,
          valuer: input.valuer ?? null,
          sourceLineageId: null,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      if (input.annualNoi) {
        tx.insert(propertyNoiSnapshots)
          .values({
            id: nanoid(),
            propertyId,
            annualNoi: input.annualNoi,
            currency: entity.reportingCurrency,
            asOfDate: input.noiAsOfDate ?? nzDateOnlyNow(),
            mappingStatus: "mapped",
            sourceLineageId: null,
            createdAt: now,
            updatedAt: now,
          })
          .run();
      }

      tx.insert(propertyPoolMemberships)
        .values({
          id: nanoid(),
          propertyId,
          poolId: pool.id,
          contributionShare: input.contributionShare,
          effectiveFrom: input.valuationDate ?? nzDateOnlyNow(),
          effectiveTo: null,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    });
  } catch (err) {
    if (!(err instanceof DuplicateProperty)) throw err;
  }

  if (conflict) {
    return NextResponse.json({ error: conflict }, { status: 409 });
  }

  await recordAuditEvent({
    actorEmail: actor.email,
    action: "property.created",
    entityId: input.entityId,
    resourceType: "property",
    resourceId: propertyId,
    detail: {
      name: input.name,
      status: input.status,
      lender: input.lenderName,
      basis: input.valuationBasis,
      value: input.value,
    },
  });

  return NextResponse.json({ id: propertyId }, { status: 201 });
}
