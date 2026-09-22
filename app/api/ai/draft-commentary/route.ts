import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { entities } from "@/db/schema";
import { isValidPeriodKey } from "@/lib/periods";
import { requireSession, entityAccessFor } from "@/lib/session";
import { canAccessEntity } from "@/lib/entityAccess";
import { codexStatus, draftJson } from "@/lib/ai/codex";
import {
  buildCommentaryPrompt,
  isDraftResult,
  DRAFT_SCHEMA,
  type DraftRow,
} from "@/lib/ai/varianceDraft";

/**
 * Drafts commentary for a movement. Returns it; does not record it.
 *
 * Saving stays with the existing commentary route, which already requires
 * origin "ai" to cite the rows it describes. Keeping generation and persistence
 * apart means nothing a model produces reaches the record without a person
 * posting it deliberately, and the audit trail keeps saying who did that.
 *
 * The rows come from the request rather than being recomputed here, so the
 * draft describes the figures the controller is actually looking at. A second
 * computation could disagree with the screen, and a commentary that quietly
 * describes different numbers than the table above it is worse than none.
 */

const bodySchema = z.object({
  entityId: z.string().min(1),
  period: z.string().refine(isValidPeriodKey, "period must be YYYY-MM"),
  comparison: z.enum(["prior_month", "prior_year_month", "prior_year_ytd", "budget", "custom"]),
  accountKey: z.string().min(1),
  currency: z.string().min(1).max(8).default("NZD"),
  rows: z
    .array(
      z.object({
        accountName: z.string().min(1).max(200),
        actual: z.string().max(40),
        comparative: z.string().max(40),
        movement: z.string().max(40),
        percent: z.string().max(40).nullable(),
        favourable: z.boolean().nullable(),
      })
    )
    // Capped so one request cannot turn into an unbounded prompt against a
    // subscription that is metered by use.
    .min(1, "Nothing to describe")
    .max(60, "Narrow the selection before drafting"),
});

export async function POST(request: Request) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  const status = codexStatus();
  if (!status.available) {
    // 503 rather than 500: the app is working, this optional path is switched off.
    return NextResponse.json({ error: status.reason }, { status: 503 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }
  const { entityId, period, comparison, accountKey, currency, rows } = parsed.data;

  if (!canAccessEntity(entityAccessFor(actor), entityId)) {
    return NextResponse.json({ error: "No access to this entity" }, { status: 403 });
  }

  const entity = db.select().from(entities).where(eq(entities.id, entityId)).get();
  if (!entity) {
    return NextResponse.json({ error: "Unknown entity" }, { status: 404 });
  }

  const prompt = buildCommentaryPrompt({
    entityName: entity.shortCode,
    period,
    comparison,
    accountKey,
    currency,
    rows: rows as DraftRow[],
  });

  try {
    const result = await draftJson(prompt, DRAFT_SCHEMA);
    if (!isDraftResult(result)) {
      return NextResponse.json(
        { error: "The draft came back in an unexpected shape. Try again." },
        { status: 502 }
      );
    }
    return NextResponse.json({ draft: result, origin: "ai" });
  } catch (err) {
    // The message names the fix (sign in, install, timed out), so it is shown
    // rather than swallowed into a generic failure.
    const message = err instanceof Error ? err.message : "Drafting failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
