import { InsurerInput, SetInsurerActiveBody } from "@claimflow/contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, requireRole } from "../../middleware/authenticate.js";
import * as service from "./insurers.service.js";
import {
  DuplicateInsurerError,
  InsurerInUseError,
  InsurerNotFoundError,
} from "./insurers.service.js";

const IdParams = z.object({ id: z.string().uuid() });
const ListQuery = z.object({
  includeInactive: z.enum(["true", "false"]).optional(),
});

/** The TPA master. */
export async function registerInsurersAdminRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  app.get("/", async (request, reply) => {
    const { includeInactive } = ListQuery.parse(request.query);
    return reply.send(await service.listInsurers(includeInactive === "true"));
  });

  app.post(
    "/",
    { preHandler: requireRole("org_admin", "desk_head") },
    async (request, reply) => {
      const body = InsurerInput.parse(request.body);
      try {
        return reply
          .code(201)
          .send(await service.createInsurer(request.authUser!, body));
      } catch (err) {
        if (err instanceof DuplicateInsurerError) {
          return reply
            .code(409)
            .send({ error: "there's already an insurer with that name" });
        }
        throw err;
      }
    },
  );

  app.put(
    "/:id",
    { preHandler: requireRole("org_admin", "desk_head") },
    async (request, reply) => {
      const { id } = IdParams.parse(request.params);
      const body = InsurerInput.parse(request.body);
      try {
        return reply.send(
          await service.updateInsurer(request.authUser!, id, body),
        );
      } catch (err) {
        if (err instanceof InsurerNotFoundError) {
          return reply.code(404).send({ error: "insurer not found" });
        }
        if (err instanceof DuplicateInsurerError) {
          return reply
            .code(409)
            .send({ error: "there's already an insurer with that name" });
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
      const { isActive } = SetInsurerActiveBody.parse(request.body);
      try {
        return reply.send(
          await service.setInsurerActive(request.authUser!, id, isActive),
        );
      } catch (err) {
        if (err instanceof InsurerNotFoundError) {
          return reply.code(404).send({ error: "insurer not found" });
        }
        throw err;
      }
    },
  );

  app.delete(
    "/:id",
    { preHandler: requireRole("org_admin") },
    async (request, reply) => {
      const { id } = IdParams.parse(request.params);
      try {
        await service.deleteInsurer(request.authUser!, id);
        return reply.code(204).send();
      } catch (err) {
        if (err instanceof InsurerNotFoundError) {
          return reply.code(404).send({ error: "insurer not found" });
        }
        if (err instanceof InsurerInUseError) {
          // 409, and say what to do instead — deleting would strand
          // every claim filed under this name.
          return reply.code(409).send({
            error: `${err.usage} claims or checklist rules use this insurer — retire it instead of deleting`,
          });
        }
        throw err;
      }
    },
  );
}
