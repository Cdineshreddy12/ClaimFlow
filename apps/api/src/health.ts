import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import { db } from "./db/client.js";

/*
  Comfortably under the load balancer's own check timeout, so a wedged
  pool is reported as degraded by us rather than as a timeout by it.
  The distinction matters in the logs: one says the database is
  unreachable, the other says nothing at all.
*/
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
 * Liveness that reaches the database.
 *
 * This returned a static object. When the connection pool wedged
 * against Supabase's pooler, every request that touched the database
 * hung forever while this answered 200 in a third of a millisecond —
 * so the balancer kept the task in service and ECS saw nothing wrong
 * with it for hours. A health check that cannot fail is not reporting
 * health, it is reporting that the process is running, and something
 * has to notice when those two stop being the same thing.
 *
 * `select 1`, bounded, so a wedged pool fails the check rather than
 * inheriting its hang. 503 takes the task out of service and ECS
 * replaces it — the recovery this needed and did not have.
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
