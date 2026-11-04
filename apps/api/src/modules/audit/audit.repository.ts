import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { auditLog } from "../../db/schema.js";

export interface AuditEntry {
  organizationId: string;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  before?: unknown;
  after?: unknown;
}

export async function insert(entry: AuditEntry) {
  await db.insert(auditLog).values({
    organizationId: entry.organizationId,
    actorId: entry.actorId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    before: entry.before ?? null,
    after: entry.after ?? null,
  });
}

export async function listForOrganization(
  organizationId: string,
  filters: { entityType?: string; entityId?: string; limit: number },
) {
  const conditions = [eq(auditLog.organizationId, organizationId)];
  if (filters.entityType)
    conditions.push(eq(auditLog.entityType, filters.entityType));
  if (filters.entityId)
    conditions.push(eq(auditLog.entityId, filters.entityId));

  return db
    .select()
    .from(auditLog)
    .where(and(...conditions))
    .orderBy(desc(auditLog.createdAt))
    .limit(filters.limit);
}
