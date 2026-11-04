import type { FastifyInstance } from "fastify";
import { authenticate } from "../../middleware/authenticate.js";
import * as claimsService from "./claims.service.js";
import {
  ClaimIdParams,
  CreateClaimBody,
  ListClaimsQuery,
  UpdateClaimStatusBody,
} from "./claims.schema.js";
import {
  ClaimNotFoundError,
  InvalidTransitionError,
} from "./claims.service.js";

export async function registerClaimsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  app.get("/", async (request, reply) => {
    const query = ListClaimsQuery.parse(request.query);
    const result = await claimsService.listClaims(request.authUser!, query);
    return reply.send(result);
  });

  app.get("/:id", async (request, reply) => {
    const { id } = ClaimIdParams.parse(request.params);
    try {
      const claim = await claimsService.getClaim(request.authUser!, id);
      return reply.send(claim);
    } catch (err) {
      if (err instanceof ClaimNotFoundError) {
        return reply.code(404).send({ error: "claim not found" });
      }
      throw err;
    }
  });

  app.post("/", async (request, reply) => {
    const body = CreateClaimBody.parse(request.body);
    const claim = await claimsService.createClaim(request.authUser!, body);
    return reply.code(201).send(claim);
  });

  app.patch("/:id/status", async (request, reply) => {
    const { id } = ClaimIdParams.parse(request.params);
    const body = UpdateClaimStatusBody.parse(request.body);
    try {
      const claim = await claimsService.transitionClaimStatus(
        request.authUser!,
        id,
        body.status,
        body.slaDeadline,
      );
      return reply.send(claim);
    } catch (err) {
      if (err instanceof ClaimNotFoundError) {
        return reply.code(404).send({ error: "claim not found" });
      }
      if (err instanceof InvalidTransitionError) {
        return reply.code(422).send({ error: err.message });
      }
      throw err;
    }
  });
}
