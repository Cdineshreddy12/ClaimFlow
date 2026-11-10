import type { FastifyInstance } from "fastify";
import { authenticate } from "../../middleware/authenticate.js";

/** Shared catalogue the Checklist Admin screen picks from. */
export async function registerReferenceRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
}
