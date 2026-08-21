import { nanoid } from "nanoid";
import { db } from "@/db/client";
import { auditEvents } from "@/db/schema";
import { nowUtcIso } from "./dates";

export async function recordAuditEvent(input: {
  actorEmail: string;
  action: string;
  entityId?: string;
  resourceType?: string;
  resourceId?: string;
  detail?: Record<string, unknown>;
}) {
  db.insert(auditEvents)
    .values({
      id: nanoid(),
      actorEmail: input.actorEmail,
      action: input.action,
      entityId: input.entityId,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      detail: input.detail ? JSON.stringify(input.detail) : null,
      createdAt: nowUtcIso(),
    })
    .run();
}
