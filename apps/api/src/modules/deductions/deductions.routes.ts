import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { RecordDeductionBody } from "@claimflow/contracts";
import { authenticate, requireRole } from "../../middleware/authenticate.js";
import * as service from "./deductions.service.js";
import { ClaimNotFoundError } from "./deductions.service.js";

const ClaimIdParams = z.object({ claimId: z.string().uuid() });

/** Nested under /claims/:claimId/deductions. */
export async function registerClaimDeductionRoutes(app: FastifyInstance) {
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
   * Recording a deduction is a financial fact about settlement, so it's
   * limited to the roles accountable for it rather than any desk user.
   */
  app.post(
    "/",
    { preHandler: requireRole("org_admin", "desk_head") },
    async (request, reply) => {
      const { claimId } = ClaimIdParams.parse(request.params);
      const body = RecordDeductionBody.parse(request.body);
      try {
        const created = await service.recordDeduction(
          request.authUser!,
          claimId,
          body,
        );
        return reply.code(201).send(created);
      } catch (err) {
        if (err instanceof ClaimNotFoundError) {
          return reply.code(404).send({ error: "claim not found" });
        }
        throw err;
      }
    },
  );
}

const SummaryQuery = z.object({
  /** ISO date; defaults to the start of the current calendar month. */
  since: z.string().datetime().optional(),
});

/** Top-level /deductions/summary — org-wide, for the dashboard. */
export async function registerDeductionSummaryRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  app.get("/summary", async (request, reply) => {
    const query = SummaryQuery.parse(request.query);
    const now = new Date();
    const since = query.since
      ? new Date(query.since)
      : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    return reply.send(await service.summarise(request.authUser!, since));
  });
}
