import type { FastifyInstance } from "fastify";
import { authenticate } from "../../middleware/authenticate.js";
import * as referenceRepository from "./reference.repository.js";

/**
 * Shared catalogue the Checklist Admin screen picks from. Authenticated
 * but not role-gated: every desk user needs to read insurer/procedure
 * names to make sense of a claim. No write routes — see the repository.
 */
export async function registerReferenceRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  app.get("/insurers", async (_request, reply) =>
    reply.send(await referenceRepository.listInsurers()),
  );

  app.get("/procedures", async (_request, reply) =>
    reply.send(await referenceRepository.listProcedures()),
  );
}
