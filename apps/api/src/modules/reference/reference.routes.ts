import type { FastifyInstance } from "fastify";
import { authenticate } from "../../middleware/authenticate.js";

/**
 * Shared catalogue the Checklist Admin screen picks from. Authenticated
 * but not role-gated: every desk user needs to read procedure names to
 * make sense of a claim.
 *
 * Insurers used to be served from here, and procedures after them.
 * Both moved to their own modules once the desk could maintain them —
 * two routes answering one GET is a boot-time collision, and the
 * reader and the writer of a master list belong together.
 *
 * Nothing is left. The module stays as the home for the next piece of
 * shared reference data that has no owner yet.
 */
export async function registerReferenceRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
}
