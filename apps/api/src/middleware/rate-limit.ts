import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance, FastifyRequest } from "fastify";

/**
 * A ceiling on how fast this API can be asked to do things.
 *
 * Every model call in the product is already bounded per call —
 * `max_tokens` on all six integrations, six steps in the assistant's
 * tool loop, twenty-four messages of transcript, twenty-five megabytes
 * of upload. None of that bounds how *many* calls arrive. A retry loop,
 * a held-down button, or a demo left open on a page that refetches is
 * unmetered spend against someone's Anthropic key, and nothing in the
 * product noticed.
 *
 * Keyed by address rather than by user, which is the honest trade.
 * The limiter runs before authentication — Fastify runs a root plugin's
 * hooks ahead of the encapsulated ones each route module adds — so the
 * caller's identity is not known yet, and reading an unverified `sub`
 * out of the bearer token would let anyone mint themselves a fresh
 * bucket by changing one claim. One hospital therefore shares a
 * ceiling, which is why the AI ceiling is set per desk and not per
 * person.
 */

/** Generous: the SPA refetches on focus, and reads cost nothing to serve. */
const GLOBAL_PER_MINUTE = 600;

/**
 * Tight, but above what the busiest real minute asks for.
 *
 * A desk filing one claim uploads eight documents — eight
 * classifications — then reads the form (one extraction) and checks it
 * (one more). Call it a dozen for one claim, filed back to back. Sixty
 * leaves room for three people doing that at once and still stops a
 * loop inside a few seconds.
 */
const AI_PER_MINUTE = 60;

function retryAfterSeconds(context: { ttl: number }): number {
  return Math.max(1, Math.ceil(context.ttl / 1000));
}

/**
 * An `Error`, not the bare body object the plugin's docs imply.
 *
 * `errorResponseBuilder` reads as "return the JSON to send", and
 * returning `{ error: "..." }` looks right and is not: the plugin
 * throws whatever comes back, so a plain object reaches the error
 * handler carrying no `statusCode` at all. Ours then did the only
 * thing it could with an unrecognised throw and answered 500 — a
 * rate limit reported as a server fault, with `retry-after` on the
 * response to contradict it.
 */
function tooManyRequests(message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode: 429 });
}

export async function registerRateLimit(app: FastifyInstance) {
  await app.register(rateLimit, {
    global: true,
    max: GLOBAL_PER_MINUTE,
    timeWindow: "1 minute",
    // The health check is what tells a load balancer this task is
    // alive. Throttling it turns a busy minute into a restart.
    allowList: (request: FastifyRequest) => request.url === "/health",
    errorResponseBuilder: (_request, context) =>
      tooManyRequests(
        `Too many requests — try again in ${retryAfterSeconds(context)}s.`,
      ),
  });
}

/**
 * Spread onto the routes that call a model.
 *
 *     app.post("/extract", { ...aiRateLimit() }, handler)
 *
 * A route that already has a `preHandler` keeps it: this only sets
 * `config`, which is where the plugin reads its per-route override
 * from.
 */
export function aiRateLimit() {
  return {
    config: {
      rateLimit: {
        max: AI_PER_MINUTE,
        timeWindow: "1 minute",
        errorResponseBuilder: (
          _request: FastifyRequest,
          context: { ttl: number },
        ) =>
          tooManyRequests(
            `That is more AI work than this desk can ask for at once. ` +
              `Try again in ${retryAfterSeconds(context)}s.`,
          ),
      },
    },
  };
}
