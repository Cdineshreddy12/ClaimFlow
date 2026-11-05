import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  ContestDeductionBody,
  DeductionAppealStatus,
  RecordDeductionBody,
  ResolveAppealBody,
} from "@claimflow/contracts";
import { authenticate, requireRole } from "../../middleware/authenticate.js";
import * as service from "./deductions.service.js";
import {
  AppealAlreadyOpenError,
  AppealAlreadyResolvedError,
  ClaimNotFoundError,
  DeductionNotFoundError,
  RecoveryExceedsDeductionError,
} from "./deductions.service.js";

const ClaimIdParams = z.object({ claimId: z.string().uuid() });
const DeductionIdParams = ClaimIdParams.extend({
  deductionId: z.string().uuid(),
});

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
   * Readable by any desk user, unlike recording one below. Recording a
   * deduction is a financial fact only a desk head owns; being warned
   * about one is the job of whoever is assembling the claim.
   */
  app.get("/risk", async (request, reply) => {
    const { claimId } = ClaimIdParams.parse(request.params);
    try {
      return reply.send(await service.assessRisk(request.authUser!, claimId));
    } catch (err) {
      if (err instanceof ClaimNotFoundError) {
        return reply.code(404).send({ error: "claim not found" });
      }
      throw err;
    }
  });

  /**
   * Opening and resolving an appeal are both financial facts about
   * settlement, so they sit with the same roles that record one.
   */
  app.patch(
    "/:deductionId/contest",
    { preHandler: requireRole("org_admin", "desk_head") },
    async (request, reply) => {
      const { deductionId } = DeductionIdParams.parse(request.params);
      const body = ContestDeductionBody.parse(request.body ?? {});
      try {
        return reply.send(
          await service.contestDeduction(request.authUser!, deductionId, body),
        );
      } catch (err) {
        if (err instanceof DeductionNotFoundError) {
          return reply.code(404).send({ error: "deduction not found" });
        }
        if (err instanceof AppealAlreadyOpenError) {
          return reply.code(409).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  app.patch(
    "/:deductionId/appeal",
    { preHandler: requireRole("org_admin", "desk_head") },
    async (request, reply) => {
      const { deductionId } = DeductionIdParams.parse(request.params);
      const body = ResolveAppealBody.parse(request.body);
      try {
        return reply.send(
          await service.resolveAppeal(request.authUser!, deductionId, body),
        );
      } catch (err) {
        if (err instanceof DeductionNotFoundError) {
          return reply.code(404).send({ error: "deduction not found" });
        }
        if (err instanceof AppealAlreadyResolvedError) {
          return reply.code(409).send({ error: err.message });
        }
        if (err instanceof RecoveryExceedsDeductionError) {
          return reply.code(422).send({ error: err.message });
        }
        throw err;
      }
    },
  );

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

const AppealWorklistQuery = z.object({
  /** Omitted means the two states a human can still act on. */
  status: DeductionAppealStatus.optional(),
});

const SummaryQuery = z.object({
  /** ISO date; defaults to the start of the current calendar month. */
  since: z.string().datetime().optional(),
});

/** Top-level /deductions/summary — org-wide, for the dashboard. */
export async function registerDeductionSummaryRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  /**
   * The appeal worklist: every deduction still worth chasing, across
   * claims. Readable by any desk user — chasing one is the work, and
   * only recording the outcome is a desk-head fact.
   */
  app.get("/appeals", async (request, reply) => {
    const query = AppealWorklistQuery.parse(request.query);
    return reply.send(
      await service.listAppealWorklist(request.authUser!, {
        ...(query.status ? { status: query.status } : {}),
      }),
    );
  });

  app.get("/summary", async (request, reply) => {
    const query = SummaryQuery.parse(request.query);
    const now = new Date();
    const since = query.since
      ? new Date(query.since)
      : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    return reply.send(await service.summarise(request.authUser!, since));
  });
}
