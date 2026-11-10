import type { FastifyInstance } from "fastify";
import { authenticate } from "../../middleware/authenticate.js";
import { aiRateLimit } from "../../middleware/rate-limit.js";
import * as queriesService from "./queries.service.js";
import {
  ClaimNotFoundError,
  NothingToSummariseError,
  QueryNotFoundError,
  SummarisationFailedError,
  SummariserUnavailableError,
} from "./queries.service.js";
import {
  ClaimIdParams,
  ConfirmDeadlineBody,
  CreateQueryBody,
  ListInboxQuery,
  QueryIdParams,
  UpdateQueryBody,
} from "./queries.schema.js";

/** Nested under /claims/:claimId/queries — logging and listing a claim's own queries. */
export async function registerClaimQueriesRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  app.get("/", async (request, reply) => {
    const { claimId } = ClaimIdParams.parse(request.params);
    try {
      const result = await queriesService.listForClaim(
        request.authUser!,
        claimId,
      );
      return reply.send(result);
    } catch (err) {
      if (err instanceof ClaimNotFoundError) {
        return reply.code(404).send({ error: "claim not found" });
      }
      throw err;
    }
  });

  // Logging a query summarises the pasted email.
  app.post("/", aiRateLimit(), async (request, reply) => {
    const { claimId } = ClaimIdParams.parse(request.params);
    const body = CreateQueryBody.parse(request.body);
    try {
      const query = await queriesService.createQuery(
        request.authUser!,
        claimId,
        body,
      );
      return reply.code(201).send(query);
    } catch (err) {
      if (err instanceof ClaimNotFoundError) {
        return reply.code(404).send({ error: "claim not found" });
      }
      throw err;
    }
  });
}

/** Top-level /queries — the org-wide inbox view, spanning claims, per the product brief's Query Inbox screen. */
export async function registerQueryInboxRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  app.get("/", async (request, reply) => {
    const query = ListInboxQuery.parse(request.query);
    const result = await queriesService.listInbox(request.authUser!, query);
    return reply.send(result);
  });

  app.get("/:id", async (request, reply) => {
    const { id } = QueryIdParams.parse(request.params);
    try {
      const result = await queriesService.getQuery(request.authUser!, id);
      return reply.send(result);
    } catch (err) {
      if (err instanceof QueryNotFoundError) {
        return reply.code(404).send({ error: "query not found" });
      }
      throw err;
    }
  });

  app.patch("/:id", async (request, reply) => {
    const { id } = QueryIdParams.parse(request.params);
    const body = UpdateQueryBody.parse(request.body);
    try {
      const result = await queriesService.updateQuery(
        request.authUser!,
        id,
        body,
      );
      return reply.send(result);
    } catch (err) {
      if (err instanceof QueryNotFoundError) {
        return reply.code(404).send({ error: "query not found" });
      }
      throw err;
    }
  });

  app.patch("/:id/deadline", async (request, reply) => {
    const { id } = QueryIdParams.parse(request.params);
    const body = ConfirmDeadlineBody.parse(request.body ?? {});
    try {
      const result = await queriesService.confirmDeadline(
        request.authUser!,
        id,
        body,
      );
      return reply.send(result);
    } catch (err) {
      if (err instanceof QueryNotFoundError) {
        return reply.code(404).send({ error: "query not found" });
      }
      throw err;
    }
  });

  /*
    A retry, asked for by a human after the automatic attempt failed.
    POST rather than PATCH: it is not an edit to the query, it runs
    work and costs a model call, and running it twice is two calls.
  */
  app.post("/:id/summarise", aiRateLimit(), async (request, reply) => {
    const { id } = QueryIdParams.parse(request.params);
    try {
      const result = await queriesService.resummarise(request.authUser!, id);
      return reply.send(result);
    } catch (err) {
      if (err instanceof QueryNotFoundError) {
        return reply.code(404).send({ error: "query not found" });
      }
      if (err instanceof NothingToSummariseError) {
        return reply
          .code(422)
          .send({ error: "this query has no email to read" });
      }
      if (err instanceof SummariserUnavailableError) {
        return reply
          .code(503)
          .send({ error: "summarising is switched off on this install" });
      }
      if (err instanceof SummarisationFailedError) {
        return reply
          .code(502)
          .send({ error: "couldn't read the email — try again" });
      }
      throw err;
    }
  });

  app.patch("/:id/reply", async (request, reply) => {
    const { id } = QueryIdParams.parse(request.params);
    try {
      const result = await queriesService.markReplied(request.authUser!, id);
      return reply.send(result);
    } catch (err) {
      if (err instanceof QueryNotFoundError) {
        return reply.code(404).send({ error: "query not found" });
      }
      throw err;
    }
  });
}
