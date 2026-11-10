import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import { db } from "./db/client.js";

/** Under the load balancer's own timeout, so we report the failure rather than it. */
const DB_TIMEOUT_MS = 2_000;

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    work,
    new Promise<never>((_resolve, reject) =>
      setTimeout(
        () => reject(new Error(`timed out after ${ms}ms`)),
        ms,
      ).unref(),
    ),
  ]);
}

/**
 * Liveness that reaches the database, because a check that cannot fail
 * reports that the process is running, not that it can serve.
 *
 * Bounded, so a wedged pool fails the check instead of inheriting its
 * hang; 503 takes the task out of service and ECS replaces it.
 */
export function registerHealthRoute(app: FastifyInstance) {
  app.get("/health", async (_request, reply) => {
    try {
      await withTimeout(db.execute(sql`select 1`), DB_TIMEOUT_MS);
    } catch (err) {
      app.log.error({ err }, "health check could not reach the database");
      return reply
        .code(503)
        .send({ status: "degraded", service: "claimflow-api" });
    }
    return { status: "ok", service: "claimflow-api" };
  });
}
