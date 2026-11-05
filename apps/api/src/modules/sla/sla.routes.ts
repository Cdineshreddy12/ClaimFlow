import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate.js";
import * as service from "./sla.service.js";

const SinceQuery = z.object({
  /** ISO date; defaults to the last 30 days, which is how a desk talks about turnaround. */
  since: z.string().datetime().optional(),
});

/** Top-level /sla. */
export async function registerSlaRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  /**
   * The live clock list. Any desk user — this is the queue, and a desk
   * exec watching a patient wait at discharge needs it most.
   */
  app.get("/watch", async (request, reply) => {
    return reply.send(await service.getSlaWatch(request.authUser!));
  });

  app.get("/turnaround", async (request, reply) => {
    const query = SinceQuery.parse(request.query);
    const since = query.since
      ? new Date(query.since)
      : new Date(Date.now() - 30 * 24 * 3_600_000);
    return reply.send(
      await service.getTurnaroundReport(request.authUser!, since),
    );
  });
}
