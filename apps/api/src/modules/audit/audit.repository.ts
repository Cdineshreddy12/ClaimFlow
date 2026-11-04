import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { auditLog } from "../../db/schema.js";

export interface AuditEntry {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  before?: unknown;
  after?: unknown;
}

export async function insert(entry: AuditEntry) {
  await db.insert(auditLog).values({
    actorId: entry.actorId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    before: entry.before ?? null,
    after: entry.after ?? null,
  });
}

export async function list(filters: {
  entityType?: string;
  entityId?: string;
  limit: number;
}) {
  const conditions = [];
  if (filters.entityType)
    conditions.push(eq(auditLog.entityType, filters.entityType));
  if (filters.entityId)
    conditions.push(eq(auditLog.entityId, filters.entityId));

  return db
    .select()
    .from(auditLog)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(auditLog.createdAt))
    .limit(filters.limit);
}
