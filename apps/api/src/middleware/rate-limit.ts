import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance, FastifyRequest } from "fastify";

/** Generous: the SPA refetches on focus, and reads cost nothing to serve. */
const GLOBAL_PER_MINUTE = 600;

/** Tight, but above what the busiest real minute asks for. */
const AI_PER_MINUTE = 60;

function retryAfterSeconds(context: { ttl: number }): number {
  return Math.max(1, Math.ceil(context.ttl / 1000));
}

/** An `Error`, not the bare body object the plugin's docs imply. */
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

/** Spread onto the routes that call a model. */
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
