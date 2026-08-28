import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { covenantRules, lenderPools, lenders, COVENANT_METRICS, VALUATION_BASES } from "@/db/schema";
import { requireSession } from "@/lib/session";
import { recordAuditEvent } from "@/lib/audit";
import { nowUtcIso, isValidDateOnly } from "@/lib/dates";
import { resolveLender } from "@/lib/portfolio/registry";

/**
 * Covenant terms, effective-dated.
 *
 * The dating is the point. One lender's cover test steps up from 1.75x to
 * 1.95x on a known future date and current cover sits between the two, so a
 * single stored threshold could only ever tell one of two truths: it would
 * either hide the breach that is coming or report one that has not happened.
 *
 * Covenants are group-level terms of a facility agreement rather than
 * entity-scoped records, so this is admin-only and not filtered by entity
 * access. A scoped admin who can see a pool's position sees the rule it is
 * tested against, which is the term the lender applies to that pool.
 */

const THRESHOLD = /^\d+(\.\d+)?$/;

const covenantSchema = z
  .object({
    lenderName: z.string().trim().min(1).max(120),
    /** Omit to apply the rule to the lender's whole exposure. */
    poolName: z.string().trim().min(1).max(120).optional(),
    metric: z.enum(COVENANT_METRICS),
    operator: z.enum(["lte", "gte"]),
    threshold: z.string().regex(THRESHOLD, "threshold must be a positive decimal"),
    valuationBasis: z.enum(VALUATION_BASES).optional(),
    effectiveFrom: z.string().refine(isValidDateOnly, "effectiveFrom must be YYYY-MM-DD"),
    effectiveTo: z.string().refine(isValidDateOnly, "effectiveTo must be YYYY-MM-DD").optional(),
    /**
     * A lender with no express financial covenant is monitored, not breaching.
     * Recording that as a covenant would raise an alarm about a term that does
     * not exist.
     */
    ruleType: z.enum(["covenant", "monitoring", "management_stress"]).default("covenant"),
    notes: z.string().trim().max(500).optional(),
  })
  .refine((v) => !v.effectiveTo || v.effectiveTo >= v.effectiveFrom, {
    message: "effectiveTo must not precede effectiveFrom",
    path: ["effectiveTo"],
  });

export async function GET() {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  const rules = db.select().from(covenantRules).all();
  const allLenders = db.select().from(lenders).all();
  const allPools = db.select().from(lenderPools).all();

  return NextResponse.json({
    covenants: rules
      .map((r) => ({
        id: r.id,
        lenderName: allLenders.find((l) => l.id === r.lenderId)?.name ?? "Unknown",
        poolName: r.poolId ? allPools.find((p) => p.id === r.poolId)?.name ?? null : null,
        metric: r.metric,
        operator: r.operator,
        threshold: r.threshold,
        valuationBasis: r.valuationBasis,
        effectiveFrom: r.effectiveFrom,
        effectiveTo: r.effectiveTo,
        ruleType: r.ruleType,
        notes: r.notes,
      }))
      .sort(
        (a, b) =>
          a.lenderName.localeCompare(b.lenderName) ||
          a.metric.localeCompare(b.metric) ||
          a.effectiveFrom.localeCompare(b.effectiveFrom)
      ),
  });
}

export async function POST(request: Request) {
  const actor = await requireSession("admin");
  if (actor instanceof NextResponse) return actor;

  const parsed = covenantSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") },
      { status: 400 }
    );
  }
  const input = parsed.data;

  const id = nanoid();
  const now = nowUtcIso();
  let overlap: string | null = null;

  class OverlappingRule extends Error {}

  try {
    db.transaction((tx) => {
      const lender = resolveLender(tx, input.lenderName);

      let poolId: string | null = null;
      if (input.poolName) {
        const wanted = input.poolName.trim().toLowerCase();
        const pool = tx
          .select()
          .from(lenderPools)
          .all()
          .find(
            (p: { lenderId: string; name: string }) =>
              p.lenderId === lender.id && p.name.trim().toLowerCase() === wanted
          );
        if (!pool) {
          overlap = `${input.lenderName} has no pool named ${input.poolName}. Add a property to it first, which is what creates a pool.`;
          throw new OverlappingRule();
        }
        poolId = pool.id;
      }

      /**
       * Two rules for the same metric covering the same date make the
       * assessment ambiguous, and `resolveEffectiveVersion` fails closed on
       * that, reporting no_rule. Refusing the write is better than accepting
       * one that silently disables the check it was meant to add.
       */
      const clash = tx
        .select()
        .from(covenantRules)
        .all()
        .find((r: typeof covenantRules.$inferSelect) => {
          if (r.lenderId !== lender.id) return false;
          if (r.metric !== input.metric) return false;
          if ((r.poolId ?? null) !== poolId) return false;
          const existingTo = r.effectiveTo ?? "9999-12-31";
          const newTo = input.effectiveTo ?? "9999-12-31";
          return r.effectiveFrom <= newTo && input.effectiveFrom <= existingTo;
        });

      if (clash) {
        overlap = `A ${input.metric.toUpperCase()} rule for ${input.lenderName} already covers ${input.effectiveFrom}${input.effectiveTo ? ` to ${input.effectiveTo}` : " onwards"}. Close the existing rule first: overlapping windows make the test ambiguous and it fails closed.`;
        throw new OverlappingRule();
      }

      tx.insert(covenantRules)
        .values({
          id,
          lenderId: lender.id,
          poolId,
          metric: input.metric,
          operator: input.operator,
          threshold: input.threshold,
          valuationBasis: input.valuationBasis ?? null,
          effectiveFrom: input.effectiveFrom,
          effectiveTo: input.effectiveTo ?? null,
          ruleType: input.ruleType,
          sourceLineageId: null,
          notes: input.notes ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    });
  } catch (err) {
    if (!(err instanceof OverlappingRule)) throw err;
  }

  if (overlap) {
    return NextResponse.json({ error: overlap }, { status: 409 });
  }

  await recordAuditEvent({
    actorEmail: actor.email,
    action: "covenant.created",
    resourceType: "covenant_rule",
    resourceId: id,
    detail: {
      lender: input.lenderName,
      pool: input.poolName ?? null,
      metric: input.metric,
      operator: input.operator,
      threshold: input.threshold,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: input.effectiveTo ?? null,
      ruleType: input.ruleType,
    },
  });

  return NextResponse.json({ id }, { status: 201 });
}
