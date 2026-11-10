import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate.js";
import * as packetService from "./packet.service.js";
import { ClaimNotFoundError } from "./packet.service.js";
import { ClaimNotFoundError as ClaimsNotFoundError } from "../claims/claims.service.js";

const ClaimIdParams = z.object({ claimId: z.string().uuid() });

export async function registerPacketRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  /**
   * POST, not GET: this writes a new object to S3 every call, so it isn't
   * safe to retry blindly or cache.
   */
  app.post("/", async (request, reply) => {
    const { claimId } = ClaimIdParams.parse(request.params);
    try {
      const result = await packetService.generatePacket(
        request.authUser!,
        claimId,
      );
      return reply.send(result);
    } catch (err) {
      if (
        err instanceof ClaimNotFoundError ||
        err instanceof ClaimsNotFoundError
      ) {
        return reply.code(404).send({ error: "claim not found" });
      }
      throw err;
    }
  });
}
