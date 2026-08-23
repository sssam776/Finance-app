/**
 * Per-entity scoping (spec 14.1, 31).
 *
 * THE RULE, stated once so every caller behaves identically:
 *
 *   - A user with explicit grants sees exactly those entities. Always.
 *   - A user with no grants at all: an admin sees every entity, a viewer sees
 *     none.
 *
 * The asymmetry in the second case is deliberate. A freshly seeded system has
 * one admin and no grants, and that admin must be able to set the system up
 * without first granting themselves access to eight entities. A viewer with no
 * grants is a different situation: nobody has decided what they may see, so
 * the safe answer is nothing. Read access to one entity's bank balances is not
 * a reasonable default for an account somebody created and forgot.
 *
 * Once any grant exists for a user, it is authoritative for that user
 * regardless of role. Granting an admin one entity scopes them to it.
 */

export type Role = "admin" | "viewer";

export interface EntityAccess {
  /** Null means every entity. A list, including an empty one, means exactly those. */
  allowedEntityIds: string[] | null;
}

export function resolveEntityAccess(role: Role, grantedEntityIds: string[]): EntityAccess {
  if (grantedEntityIds.length > 0) {
    return { allowedEntityIds: [...new Set(grantedEntityIds)] };
  }
  return { allowedEntityIds: role === "admin" ? null : [] };
}

export function canAccessEntity(access: EntityAccess, entityId: string): boolean {
  if (access.allowedEntityIds === null) return true;
  return access.allowedEntityIds.includes(entityId);
}

/** Filters any row carrying an entityId. Used by the cash position and imports. */
export function filterByEntityAccess<T extends { entityId: string }>(
  access: EntityAccess,
  rows: T[]
): T[] {
  if (access.allowedEntityIds === null) return rows;
  const allowed = new Set(access.allowedEntityIds);
  return rows.filter((row) => allowed.has(row.entityId));
}
