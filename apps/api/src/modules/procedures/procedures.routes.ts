import { ProcedureInput } from "@claimflow/contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, requireRole } from "../../middleware/authenticate.js";
import * as service from "./procedures.service.js";
import {
  DuplicateProcedureError,
  ProcedureInUseError,
  ProcedureNotFoundError,
} from "./procedures.service.js";

const IdParams = z.object({ id: z.string().uuid() });
const SetActiveBody = z.object({ isActive: z.boolean() });
/** Only the admin screen asks for retired rows; every picker wants the live list. */
const ListQuery = z.object({
  includeInactive: z.enum(["true", "false"]).optional(),
});

/** The procedure master. */
export async function registerProceduresRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  app.get("/", async (request, reply) => {
    const { includeInactive } = ListQuery.parse(request.query);
    return reply.send(await service.listProcedures(includeInactive === "true"));
  });

  app.post(
    "/",
    { preHandler: requireRole("org_admin", "desk_head") },
    async (request, reply) => {
      const body = ProcedureInput.parse(request.body);
      try {
        return reply
          .code(201)
          .send(await service.createProcedure(request.authUser!, body));
      } catch (err) {
        if (err instanceof DuplicateProcedureError) {
          return reply
            .code(409)
            .send({ error: "A procedure with that name already exists" });
        }
        throw err;
      }
    },
  );

  app.patch(
    "/:id",
    { preHandler: requireRole("org_admin", "desk_head") },
    async (request, reply) => {
      const { id } = IdParams.parse(request.params);
      const body = ProcedureInput.parse(request.body);
      try {
        return reply.send(
          await service.updateProcedure(request.authUser!, id, body),
        );
      } catch (err) {
        if (err instanceof ProcedureNotFoundError) {
          return reply.code(404).send({ error: "procedure not found" });
        }
        if (err instanceof DuplicateProcedureError) {
          return reply
            .code(409)
            .send({ error: "A procedure with that name already exists" });
        }
        throw err;
      }
    },
  );

  app.patch(
    "/:id/active",
    { preHandler: requireRole("org_admin", "desk_head") },
    async (request, reply) => {
      const { id } = IdParams.parse(request.params);
      const { isActive } = SetActiveBody.parse(request.body);
      try {
        return reply.send(
          await service.setProcedureActive(request.authUser!, id, isActive),
        );
      } catch (err) {
        if (err instanceof ProcedureNotFoundError) {
          return reply.code(404).send({ error: "procedure not found" });
        }
        throw err;
      }
    },
  );

  app.delete(
    "/:id",
    { preHandler: requireRole("org_admin", "desk_head") },
    async (request, reply) => {
      const { id } = IdParams.parse(request.params);
      try {
        await service.deleteProcedure(request.authUser!, id);
        return reply.code(204).send();
      } catch (err) {
        if (err instanceof ProcedureNotFoundError) {
          return reply.code(404).send({ error: "procedure not found" });
        }
        if (err instanceof ProcedureInUseError) {
          // Says what depends on it, because the answer is "retire it".
          return reply.code(409).send({
            error: `In use by ${err.usage.claims} claim(s) and ${err.usage.rules} rule(s) — retire it instead.`,
          });
        }
        throw err;
      }
    },
  );
}
