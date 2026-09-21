import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db/client";
import { entities } from "@/db/schema";
import { canAccessEntity } from "@/lib/entityAccess";
import { requireSession, entityAccessFor } from "@/lib/session";
import { summariseCashFlow, type CashFlowSnapshot } from "@/lib/cashFlow";

const DEFAULT_SYNC_BASE_URL =
  "https://ramwall-cash-flow-sync.ramwall-cash-flow.workers.dev";

const ENTITY_SHORT_CODE: Record<CashFlowSnapshot["entity"], string> = {
  Kayo: "KAYO",
  Vikat: "VIKAT",
  Kerrs: "KERRS_VILLAGE",
  Ramwall: "RAMWALL_2010",
  Hebcohg: "HEBCOHG",
};

const snapshotSchema = z.object({
  entity: z.enum(["Kayo", "Vikat", "Kerrs", "Ramwall", "Hebcohg"]),
  currentCash: z.number().finite(),
  asOf: z.string(),
  monthEndForecast: z.number().finite(),
  forecastLow: z.number().finite(),
  lowMonth: z.string(),
  fundingRequired: z.number().finite(),
  status: z.string(),
  refreshedAt: z.string(),
  receivedAt: z.string(),
  liquidityBasis: z.enum(["cash", "credit_facility"]),
  facilityLimit: z.number().finite().nullable(),
  currentLiquidity: z.number().finite(),
  forecast: z.record(z.number().finite()),
  forecastLiquidity: z.record(z.number().finite()),
});

const responseSchema = z.object({
  snapshots: z.array(snapshotSchema),
});

export async function GET() {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  const secret = process.env.CASH_FLOW_SYNC_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "Cash-flow dashboard sync is not configured." },
      { status: 503 }
    );
  }

  const baseUrl = (
    process.env.CASH_FLOW_SYNC_BASE_URL ?? DEFAULT_SYNC_BASE_URL
  ).replace(/\/$/, "");

  let upstream: Response;
  try {
    upstream = await fetch(`${baseUrl}/api/cash-flow/snapshots`, {
      headers: {
        Authorization: `Bearer ${secret}`,
        Accept: "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    return NextResponse.json(
      { error: "Cash-flow sync service is unavailable." },
      { status: 502 }
    );
  }

  if (!upstream.ok) {
    return NextResponse.json(
      { error: "Cash-flow sync service returned an error." },
      { status: 502 }
    );
  }

  let parsed: z.infer<typeof responseSchema>;
  try {
    parsed = responseSchema.parse(await upstream.json());
  } catch {
    return NextResponse.json(
      { error: "Cash-flow sync service returned an invalid payload." },
      { status: 502 }
    );
  }

  const access = entityAccessFor(actor);
  const entityRows = db
    .select({ id: entities.id, shortCode: entities.shortCode })
    .from(entities)
    .all();
  const idByShortCode = new Map(
    entityRows.map((entity) => [entity.shortCode, entity.id])
  );

  const snapshots = parsed.snapshots.filter((snapshot) => {
    const entityId = idByShortCode.get(ENTITY_SHORT_CODE[snapshot.entity]);
    return entityId ? canAccessEntity(access, entityId) : false;
  });

  return NextResponse.json({
    scope: access.allowedEntityIds === null ? "group" : "restricted",
    snapshots,
    summary: summariseCashFlow(snapshots),
  });
}
