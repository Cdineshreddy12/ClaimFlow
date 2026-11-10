import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { authenticate, requireRole } from "../../middleware/authenticate.js";
import * as auditService from "./audit.service.js";

const ListAuditQuery = z.object({
  entityType: z.string().min(1).optional(),
  entityId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/** Read-only on purpose: entries come from the service layer as a side effect of real mutations, never from a client. */
export async function registerAuditRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  /** Read-only, and gated to the roles accountable for the org's data. */
  app.get(
    "/",
    { preHandler: requireRole("org_admin", "desk_head") },
    async (request, reply) => {
      const query = ListAuditQuery.parse(request.query);
      const entries = await auditService.listAuditLog(request.authUser!, {
        ...(query.entityType ? { entityType: query.entityType } : {}),
        ...(query.entityId ? { entityId: query.entityId } : {}),
        limit: query.limit,
      });
      return reply.send(entries);
    },
  );
}
