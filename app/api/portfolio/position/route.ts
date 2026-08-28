import { NextResponse } from "next/server";
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
  loanFacilities,
  covenantRules,
} from "@/db/schema";
import { requireSession, entityAccessFor } from "@/lib/session";
import { filterByEntityAccess } from "@/lib/entityAccess";
import { isValidDateOnly, nzDateOnlyNow, type DateOnly } from "@/lib/dates";
import { poolPosition, splitByStatus, type PoolPropertyInput } from "@/lib/portfolio/poolPosition";
import { csvResponse, csvFilename } from "@/lib/csv/toCsv";

/**
 * The portfolio position: LVR, headroom, cover and covenant status per
 * cross-collateralised pool.
 *
 * Nothing here is stored. A pool's LVR is a fact about the valuations and
 * balances that were true on a date, and a stored copy would be a second
 * answer free to disagree with the first. That is the failure mode the source
 * workbook had, where tabs holding precomputed totals could contradict each
 * other.
 */

export async function GET(request: Request) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  const url = new URL(request.url);
  const asOfParam = url.searchParams.get("asOf");
  if (asOfParam && !isValidDateOnly(asOfParam)) {
    return NextResponse.json({ error: "asOf must be YYYY-MM-DD" }, { status: 400 });
  }
  const asOf: DateOnly = asOfParam ?? nzDateOnlyNow();
  const basis = url.searchParams.get("basis") ?? "bank";

  const access = entityAccessFor(actor);
  const visibleProperties = filterByEntityAccess(
    access,
    db.select().from(properties).where(eq(properties.active, true)).all()
  );
  const visibleFacilities = filterByEntityAccess(
    access,
    db.select().from(loanFacilities).where(eq(loanFacilities.active, true)).all()
  );

  const allEntities = db.select().from(entities).all();
  const allPools = db.select().from(lenderPools).all();
  const allLenders = db.select().from(lenders).all();
  const allCovenants = db.select().from(covenantRules).all();

  /**
   * Shaped once per property rather than inside the pool loop. A property
   * belongs to one pool at a time, so building this per pool would re-query
   * the same valuation for every pool it is not in.
   */
  const shaped = visibleProperties.map((p) => {
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

    // The membership in force on the date asked about, not simply the open
    // one: a pool tested for a past date has to see the security as it stood.
    const membership = db
      .select()
      .from(propertyPoolMemberships)
      .where(eq(propertyPoolMemberships.propertyId, p.id))
      .all()
      .find((m) => m.effectiveFrom <= asOf && (m.effectiveTo === null || m.effectiveTo >= asOf));

    const shapedProperty: PoolPropertyInput = {
      propertyId: p.id,
      name: p.name,
      entityShortCode: allEntities.find((e) => e.id === p.entityId)?.shortCode ?? p.entityId,
      status: p.status,
      value: valuation?.value ?? null,
      valuationBasis: basis,
      valuationDate: valuation?.valuationDate ?? null,
      contributionShare: membership?.contributionShare ?? "1",
      annualNoi: noi?.annualNoi ?? null,
      noiMappingStatus: noi?.mappingStatus ?? "unmapped",
    };

    return { poolId: membership?.poolId ?? null, property: shapedProperty };
  });

  const positions = allPools
    .map((pool) => {
      const lenderName = allLenders.find((l) => l.id === pool.lenderId)?.name ?? "Unknown";
      const poolProperties = shaped.filter((s) => s.poolId === pool.id).map((s) => s.property);
      const poolFacilities = visibleFacilities.filter((f) => f.poolId === pool.id);

      // A pool with nothing visible to this caller is omitted rather than
      // shown as an empty position, which would report a pool that exists but
      // reveal nothing true about it.
      if (poolProperties.length === 0 && poolFacilities.length === 0) return null;

      return poolPosition(
        {
          poolId: pool.id,
          poolName: pool.name,
          lenderName,
          targetLvr: pool.targetLvr,
          stressRate: pool.stressRate,
          currency: poolFacilities[0]?.currency ?? "NZD",
          properties: poolProperties,
          facilities: poolFacilities.map((f) => ({
            facilityId: f.id,
            facilityReference: f.facilityReference,
            drawnAmount: f.drawnAmount,
            currency: f.currency,
            interestCapitalised: f.interestCapitalised,
          })),
          covenants: allCovenants
            .filter((c) => c.lenderId === pool.lenderId)
            .filter((c) => c.poolId === null || c.poolId === pool.id)
            .map((c) => ({
              metric: c.metric,
              operator: c.operator,
              threshold: c.threshold,
              effectiveFrom: c.effectiveFrom,
              effectiveTo: c.effectiveTo,
              ruleType: c.ruleType,
            })),
        },
        asOf
      );
    })
    .filter((p): p is NonNullable<typeof p> => p !== null)
    .sort((a, b) => a.lenderName.localeCompare(b.lenderName) || a.poolName.localeCompare(b.poolName));

  const unpooled = shaped.filter((s) => s.poolId === null).map((s) => s.property);

  if (url.searchParams.get("format") === "csv") {
    return csvResponse(
      csvFilename(["portfolio-position", asOf]),
      [
        "Lender",
        "Pool",
        "Currency",
        "Security value",
        "Drawn debt",
        "LVR %",
        "Target LVR %",
        "Headroom",
        "Over limit by",
        "Annual NOI",
        "Debt yield %",
        "Stress ICR",
        "LVR covenant",
        "ICR covenant",
        "Properties",
        "Facilities",
      ],
      positions.map((p) => [
        p.lenderName,
        p.poolName,
        p.currency,
        p.securityValue,
        p.drawnDebt,
        p.lvr === null ? null : (Number(p.lvr) * 100).toFixed(1),
        (Number(p.targetLvr) * 100).toFixed(1),
        p.headroom,
        p.overLimitBy,
        p.annualNoi,
        p.debtYield === null ? null : (Number(p.debtYield) * 100).toFixed(1),
        p.stressIcr === null ? null : Number(p.stressIcr).toFixed(2),
        p.lvrCovenant.outcome,
        p.icrCovenant.outcome,
        p.propertyCount,
        p.facilityCount,
      ])
    );
  }

  return NextResponse.json({
    asOf,
    basis,
    positions,
    /**
     * The investment/development split, across everything visible rather than
     * per pool. Development stock sits outside the book a senior lender tests,
     * and blending the two produces a group figure that flatters the
     * investment book.
     */
    split: splitByStatus(shaped.map((s) => s.property)),
    /** Properties with no pool membership in force. Security nobody is holding. */
    unpooled: unpooled.map((p) => ({ name: p.name, entityShortCode: p.entityShortCode, value: p.value })),
  });
}
