import type { FastifyInstance } from "fastify";

/**
 * Longer than anything healthy: p99.9 of real traffic is 2.4s, and the
 * only responses past 3s in a week were the assistant's Claude calls,
 * which this skips.
 */
const DEADLINE_MS = 20_000;

/** The assistant waits on Claude, and 21s is a normal answer there. */
const UNBOUNDED = ["/assistant"];

/**
 * Fails a request that has run too long instead of letting it hang.
 *
 * Nothing bounded a handler. When the connection pool saturated, every
 * request queued for a connection that never freed: in-flight climbed
 * past the pool's ceiling and stayed there, and 36 of them simply
 * never answered — the desk saw a spinner, not an error.
 *
 * Not Fastify's `requestTimeout`, which bounds how long the server
 * waits to *receive* a request and would never have fired here.
 */
export function registerRequestDeadline(
  app: FastifyInstance,
  ms: number = DEADLINE_MS,
) {
  app.addHook("onRequest", (request, reply, done) => {
    if (UNBOUNDED.some((prefix) => request.url.startsWith(prefix))) {
      return done();
    }

    const timer = setTimeout(() => {
      if (reply.sent) return;
      request.log.error(
        { url: request.url, ms },
        "request exceeded its deadline",
      );
      reply
        .code(503)
        .send({ error: "The server took too long. Please try again." });
    }, ms);
    // So a pending timer cannot hold the process open, and so a
    // client that hangs up stops the clock with it.
    timer.unref();
    reply.raw.on("close", () => clearTimeout(timer));

    done();
  });
}
