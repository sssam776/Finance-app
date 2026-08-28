import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import {
  entities,
  properties,
  propertyValuations,
  propertyNoiSnapshots,
  propertyPoolMemberships,
  lenderPools,
  lenders,
  loanFacilities,
} from "@/db/schema";
import { requireSession, entityAccessFor } from "@/lib/session";
import { canAccessEntity } from "@/lib/entityAccess";
import { isValidDateOnly, nzDateOnlyNow } from "@/lib/dates";
import {
  sellRedeploy,
  SELL_REDEPLOY_DEFAULTS,
  SELL_REDEPLOY_BOUNDS,
} from "@/lib/portfolio/sellRedeploy";

/**
 * Models releasing one property from its security pool.
 *
 * A read-only model. Nothing is written, because nothing has been decided:
 * this answers what would happen, and the answer changes every time a
 * valuation does. Storing a result would be storing an opinion with a date on
 * it that nobody would think to check.
 *
 * The pool figures come from the register rather than from the caller. A
 * request that could supply its own pool value could ask for an answer about
 * a portfolio that does not exist, and the resulting number would look exactly
 * as authoritative as a real one.
 */

const FRACTION = /^(0(\.\d+)?|1(\.0+)?)$/;
const MONEY = /^\d{1,15}(\.\d{1,2})?$/;

function boundedFraction(field: keyof typeof SELL_REDEPLOY_BOUNDS) {
  const { min, max } = SELL_REDEPLOY_BOUNDS[field];
  return z
    .string()
    .regex(FRACTION, `${field} must be a fraction between 0 and 1`)
    .refine((v) => Number(v) >= min && Number(v) <= max, {
      message: `${field} must be between ${min} and ${max}`,
    });
}

const inputSchema = z.object({
  propertyId: z.string().min(1),
  salePrice: z.string().regex(MONEY, "salePrice must be a positive decimal amount"),
  sellingCostPct: boundedFraction("sellingCostPct").default(SELL_REDEPLOY_DEFAULTS.sellingCostPct),
  retainedPoolHaircutPct: boundedFraction("retainedPoolHaircutPct").default(
    SELL_REDEPLOY_DEFAULTS.retainedPoolHaircutPct
  ),
  replacementLvr: boundedFraction("replacementLvr").default(SELL_REDEPLOY_DEFAULTS.replacementLvr),
  asOf: z.string().refine(isValidDateOnly, "asOf must be YYYY-MM-DD").optional(),
  basis: z.enum(["bank", "market", "council"]).default("bank"),
});

export async function POST(request: Request) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  const parsed = inputSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") },
      { status: 400 }
    );
  }
  const input = parsed.data;
  const asOf = input.asOf ?? nzDateOnlyNow();

  const property = db.select().from(properties).where(eq(properties.id, input.propertyId)).get();
  if (!property) return NextResponse.json({ error: "Unknown propertyId" }, { status: 404 });

  if (!canAccessEntity(entityAccessFor(actor), property.entityId)) {
    return NextResponse.json({ error: "No access to this entity" }, { status: 403 });
  }

  const membership = db
    .select()
    .from(propertyPoolMemberships)
    .where(eq(propertyPoolMemberships.propertyId, property.id))
    .all()
    .find((m) => m.effectiveFrom <= asOf && (m.effectiveTo === null || m.effectiveTo >= asOf));

  if (!membership) {
    return NextResponse.json(
      {
        error:
          "This property is charged to no security pool, so there is nothing for a lender to release. Add it to a pool first.",
      },
      { status: 409 }
    );
  }

  const pool = db.select().from(lenderPools).where(eq(lenderPools.id, membership.poolId)).get();
  if (!pool) return NextResponse.json({ error: "The pool this property belongs to is missing" }, { status: 500 });

  const latestValuation = (propertyId: string) =>
    db
      .select()
      .from(propertyValuations)
      .where(
        and(
          eq(propertyValuations.propertyId, propertyId),
          eq(propertyValuations.basis, input.basis)
        )
      )
      .all()
      .sort((a, b) => (b.valuationDate ?? "").localeCompare(a.valuationDate ?? ""))[0];

  const latestNoi = (propertyId: string) =>
    db
      .select()
      .from(propertyNoiSnapshots)
      .where(eq(propertyNoiSnapshots.propertyId, propertyId))
      .all()
      .sort((a, b) => b.asOfDate.localeCompare(a.asOfDate))[0];

  const propertyValuation = latestValuation(property.id);
  if (!propertyValuation) {
    return NextResponse.json(
      {
        error: `${property.name} has no ${input.basis} valuation. The release repayment is computed from it, so the model cannot answer without one.`,
      },
      { status: 409 }
    );
  }

  /**
   * The whole pool, not only what this caller can see.
   *
   * A pool's LVR is a property of the pool. Computing a release against the
   * subset of a pool one user happens to be scoped to would produce a
   * confident number for a pool that does not exist. Access is decided by the
   * property being modelled, above; the pool it sits in is then taken whole.
   */
  const poolMembers = db
    .select()
    .from(propertyPoolMemberships)
    .where(eq(propertyPoolMemberships.poolId, pool.id))
    .all()
    .filter((m) => m.effectiveFrom <= asOf && (m.effectiveTo === null || m.effectiveTo >= asOf));

  let poolValue = 0;
  let poolNoi = 0;
  let unvalued = 0;

  for (const member of poolMembers) {
    const valuation = latestValuation(member.propertyId);
    if (valuation) {
      poolValue += Number(valuation.value) * Number(member.contributionShare);
    } else {
      unvalued += 1;
    }
    const noi = latestNoi(member.propertyId);
    if (noi) poolNoi += Number(noi.annualNoi);
  }

  const poolFacilities = db
    .select()
    .from(loanFacilities)
    .where(and(eq(loanFacilities.poolId, pool.id), eq(loanFacilities.active, true)))
    .all();

  const poolDebt = poolFacilities.reduce((t, f) => t + Number(f.drawnAmount), 0);

  const propertyNoi = latestNoi(property.id);

  const result = sellRedeploy({
    propertyBankValue: propertyValuation.value,
    propertyNoi: propertyNoi?.annualNoi ?? "0",
    poolValue: poolValue.toFixed(2),
    poolDebt: poolDebt.toFixed(2),
    poolNoi: poolNoi.toFixed(2),
    targetLvr: pool.targetLvr,
    stressRate: pool.stressRate,
    salePrice: input.salePrice,
    sellingCostPct: input.sellingCostPct,
    retainedPoolHaircutPct: input.retainedPoolHaircutPct,
    replacementLvr: input.replacementLvr,
  });

  /** Named so the figures on screen can be checked against the register. */
  const gaps: string[] = [];
  if (unvalued > 0) {
    gaps.push(
      `${unvalued} propert${unvalued === 1 ? "y" : "ies"} in this pool have no ${input.basis} valuation, so the retained pool value is understated and the repayment overstated.`
    );
  }
  if (!propertyNoi) {
    gaps.push(
      `${property.name} has no recorded income, so the model treats the income lost on sale as nil.`
    );
  }
  if (poolFacilities.length === 0) {
    gaps.push("This pool has no facilities recorded, so there is no debt to repay on release.");
  }

  return NextResponse.json({
    asOf,
    basis: input.basis,
    property: {
      id: property.id,
      name: property.name,
      entityShortCode:
        db.select().from(entities).where(eq(entities.id, property.entityId)).get()?.shortCode ??
        property.entityId,
      value: propertyValuation.value,
      valuationDate: propertyValuation.valuationDate,
      annualNoi: propertyNoi?.annualNoi ?? null,
    },
    pool: {
      id: pool.id,
      name: pool.name,
      lenderName: db.select().from(lenders).where(eq(lenders.id, pool.lenderId)).get()?.name ?? "Unknown",
      value: poolValue.toFixed(2),
      debt: poolDebt.toFixed(2),
      noi: poolNoi.toFixed(2),
      targetLvr: pool.targetLvr,
      stressRate: pool.stressRate,
      propertyCount: poolMembers.length,
    },
    inputs: {
      salePrice: input.salePrice,
      sellingCostPct: input.sellingCostPct,
      retainedPoolHaircutPct: input.retainedPoolHaircutPct,
      replacementLvr: input.replacementLvr,
    },
    result,
    gaps,
  });
}
