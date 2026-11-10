import type { FastifyInstance } from "fastify";
import { authenticate, requireRole } from "../../middleware/authenticate.js";
import * as receivablesService from "./receivables.service.js";

export async function registerReceivablesRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  /** What the hospital is owed, by age and by insurer. */
  app.get(
    "/ageing",
    { preHandler: requireRole("org_admin", "desk_head") },
    async (request, reply) =>
      reply.send(await receivablesService.getAgeing(request.authUser!)),
  );
}
