import type { FastifyInstance } from "fastify";
import { authenticate } from "../../middleware/authenticate.js";
import * as referenceRepository from "./reference.repository.js";

/**
 * Shared catalogue the Checklist Admin screen picks from. Authenticated
 * but not role-gated: every desk user needs to read procedure names to
 * make sense of a claim.
 *
 * Insurers used to be served from here too. They moved to their own
 * module once the desk could maintain them — two routes answering GET
 * /insurers is a boot-time collision, and the reader and the writer of
 * a master list belong together.
 */
export async function registerReferenceRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  app.get("/procedures", async (_request, reply) =>
    reply.send(await referenceRepository.listProcedures()),
  );
}
