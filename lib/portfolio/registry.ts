import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { lenders, lenderPools } from "@/db/schema";
import { nowUtcIso } from "../dates";

/**
 * Resolution of the shared portfolio records, in one place.
 *
 * Lenders and pools are created by name on first use rather than administered
 * on their own screens: a lender is a name and a type, and a screen for that
 * is one nobody visits twice. But both the facility register and the property
 * register need to resolve them, and duplicating the lookup would duplicate
 * the case-insensitivity rule below, which is exactly the kind of thing that
 * gets fixed in one copy and not the other.
 *
 * Both functions take a transaction. Resolution has to happen inside the same
 * write as the record that needs it, or a failed insert leaves an orphan
 * lender behind, created into global state by an entity-scoped actor.
 */

/**
 * Matches on a case-insensitive name.
 *
 * The unique index on `lenders.name` is BINARY, so "ASB" and "asb" are two
 * rows as far as SQLite is concerned. Two lender rows for one real bank then
 * defeat every uniqueness rule downstream that is keyed on the lender.
 */
export function resolveLender(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  name: string,
  options: { interestCapitalised?: boolean } = {}
): { id: string; name: string } {
  const wanted = name.trim().toLowerCase();
  const existing = tx
    .select()
    .from(lenders)
    .all()
    .find((l: { name: string }) => l.name.trim().toLowerCase() === wanted);
  if (existing) return existing;

  const now = nowUtcIso();
  const id = nanoid();
  tx.insert(lenders)
    .values({
      id,
      name: name.trim(),
      lenderType: options.interestCapitalised ? "second_tier" : "senior",
      active: true,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return tx.select().from(lenders).where(eq(lenders.id, id)).get();
}

/**
 * A pool belongs to a lender, so the same case-insensitive rule applies to its
 * name. `targetLvr` and `stressRate` are only used when the pool is created:
 * changing a lender's release LVR is a decision about a facility agreement,
 * not a side effect of adding a property to it.
 */
export function resolvePool(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  lenderId: string,
  name: string,
  defaults: { targetLvr: string; stressRate: string }
): { id: string; name: string; targetLvr: string; stressRate: string } {
  const wanted = name.trim().toLowerCase();
  const existing = tx
    .select()
    .from(lenderPools)
    .all()
    .find(
      (p: { lenderId: string; name: string }) =>
        p.lenderId === lenderId && p.name.trim().toLowerCase() === wanted
    );
  if (existing) return existing;

  const now = nowUtcIso();
  const id = nanoid();
  tx.insert(lenderPools)
    .values({
      id,
      lenderId,
      name: name.trim(),
      targetLvr: defaults.targetLvr,
      stressRate: defaults.stressRate,
      active: true,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return tx.select().from(lenderPools).where(eq(lenderPools.id, id)).get();
}
