import type { FastifyInstance } from "fastify";
import { authenticate, requireRole } from "../../middleware/authenticate.js";
import * as checklistService from "./checklist.service.js";
import { DuplicateRuleError, RuleNotFoundError } from "./checklist.service.js";
import {
  ApplyProposalBody,
  ChecklistRuleIdParams,
  CreateChecklistRuleBody,
  ListChecklistRulesQuery,
  UpdateChecklistRuleBody,
} from "./checklist.schema.js";

const manageRules = requireRole("org_admin", "desk_head");

export async function registerChecklistRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  app.get("/", async (request, reply) => {
    const query = ListChecklistRulesQuery.parse(request.query);
    const result = await checklistService.listRules(
      request.authUser!,
      query.insurerId,
      query.procedureId,
    );
    return reply.send(result);
  });

  /** What the insurers' own queries say the checklist is missing. */
  /** Read-only, like the rules list itself — the actions are what's gated. */
  app.get("/coverage", async (request, reply) =>
    reply.send(await checklistService.getCoverage(request.authUser!)),
  );

  app.get("/proposals", async (request, reply) => {
    return reply.send(await checklistService.proposeRules(request.authUser!));
  });

  app.post(
    "/proposals/apply",
    { preHandler: manageRules },
    async (request, reply) => {
      const body = ApplyProposalBody.parse(request.body);
      try {
        const rule = await checklistService.applyProposal(
          request.authUser!,
          body,
        );
        return reply.code(201).send(rule);
      } catch (err) {
        if (err instanceof DuplicateRuleError) {
          return reply.code(409).send({ error: err.message });
        }
        if (err instanceof RuleNotFoundError) {
          return reply.code(404).send({ error: "rule not found" });
        }
        throw err;
      }
    },
  );

  app.post("/", { preHandler: manageRules }, async (request, reply) => {
    const body = CreateChecklistRuleBody.parse(request.body);
    try {
      const rule = await checklistService.createRule(request.authUser!, body);
      return reply.code(201).send(rule);
    } catch (err) {
      if (err instanceof DuplicateRuleError) {
        return reply.code(409).send({ error: err.message });
      }
      throw err;
    }
  });

  app.patch("/:id", { preHandler: manageRules }, async (request, reply) => {
    const { id } = ChecklistRuleIdParams.parse(request.params);
    const body = UpdateChecklistRuleBody.parse(request.body);
    try {
      const rule = await checklistService.updateRule(
        request.authUser!,
        id,
        body,
      );
      return reply.send(rule);
    } catch (err) {
      if (err instanceof RuleNotFoundError) {
        return reply.code(404).send({ error: "checklist rule not found" });
      }
      throw err;
    }
  });

  app.delete("/:id", { preHandler: manageRules }, async (request, reply) => {
    const { id } = ChecklistRuleIdParams.parse(request.params);
    try {
      await checklistService.deleteRule(request.authUser!, id);
      return reply.code(204).send();
    } catch (err) {
      if (err instanceof RuleNotFoundError) {
        return reply.code(404).send({ error: "checklist rule not found" });
      }
      throw err;
    }
  });
}
