import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  DecideEnhancementBody,
  RequestEnhancementBody,
} from "@claimflow/contracts";
import { authenticate, requireRole } from "../../middleware/authenticate.js";
import * as service from "./enhancements.service.js";
import {
  ClaimNotFoundError,
  EnhancementAlreadyDecidedError,
  EnhancementAlreadyOpenError,
  EnhancementNotFoundError,
} from "./enhancements.service.js";

const ClaimIdParams = z.object({ claimId: z.string().uuid() });
const EnhancementIdParams = ClaimIdParams.extend({
  enhancementId: z.string().uuid(),
});

/** Nested under /claims/:claimId/enhancements. */
export async function registerEnhancementRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  app.get("/", async (request, reply) => {
    const { claimId } = ClaimIdParams.parse(request.params);
    try {
      return reply.send(await service.listForClaim(request.authUser!, claimId));
    } catch (err) {
      if (err instanceof ClaimNotFoundError) {
        return reply.code(404).send({ error: "claim not found" });
      }
      throw err;
    }
  });

  /**
   * Any desk user can ask: the exec watching the cost cross the ceiling
   * is the one who knows, and making them find a desk head first is how
   * the request arrives after discharge.
   */
  app.post("/", async (request, reply) => {
    const { claimId } = ClaimIdParams.parse(request.params);
    const body = RequestEnhancementBody.parse(request.body);
    try {
      const created = await service.requestEnhancement(
        request.authUser!,
        claimId,
        body,
      );
      return reply.code(201).send(created);
    } catch (err) {
      if (err instanceof ClaimNotFoundError) {
        return reply.code(404).send({ error: "claim not found" });
      }
      if (err instanceof EnhancementAlreadyOpenError) {
        return reply.code(409).send({ error: err.message });
      }
      throw err;
    }
  });

  /**
   * Recording the insurer's answer raises the claim's sanctioned
   * amount, which is a financial fact — same roles as recording a
   * deduction, and for the same reason.
   */
  app.patch(
    "/:enhancementId",
    { preHandler: requireRole("org_admin", "desk_head") },
    async (request, reply) => {
      const { enhancementId } = EnhancementIdParams.parse(request.params);
      const body = DecideEnhancementBody.parse(request.body);
      try {
        return reply.send(
          await service.decideEnhancement(
            request.authUser!,
            enhancementId,
            body,
          ),
        );
      } catch (err) {
        if (err instanceof EnhancementNotFoundError) {
          return reply.code(404).send({ error: "enhancement not found" });
        }
        if (err instanceof EnhancementAlreadyDecidedError) {
          return reply.code(409).send({ error: err.message });
        }
        throw err;
      }
    },
  );
}
