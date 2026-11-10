import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";

/** A 4xx an error already knows about, or null if it is ours to own. */
function clientFault(error: unknown): number | null {
  const status = (error as { statusCode?: unknown })?.statusCode;
  return typeof status === "number" && status >= 400 && status < 500
    ? status
    : null;
}

function messageOf(error: unknown): string {
  const message = (error as { message?: unknown })?.message;
  return typeof message === "string" && message ? message : "bad request";
}

/**
 * What the client is told when something throws.
 *
 * Every route validates with `Schema.parse(...)` rather than Fastify's
 * own schema hooks, so a bad request arrives here as a raw `ZodError`.
 * Without this, Fastify's default handler makes that a 500 — wrong,
 * because the client sent bad input and the server did not fail.
 *
 * The same was true of everything else it did not recognise. Any error
 * that was not a `ZodError` became a 500, including the ones Fastify
 * raises itself: a malformed JSON body, a payload over the multipart
 * limit, an unknown route. Rate limiting made it visible — a 429 went
 * out as "internal server error" with a `retry-after` header on the
 * same response contradicting it. A 500 tells a client to retry and
 * tells us to go looking for a bug, and neither is true of a request
 * that was simply too big, too fast, or malformed.
 *
 * Only 4xx passes through. A 5xx from a plugin is still ours to own,
 * and is still logged as one.
 *
 * Lives here rather than inline in `server.ts` so it can be tested
 * against the plugins it has to agree with — which is how the 429
 * above turned out to be reaching it as a plain object.
 */
export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply
        .code(400)
        .send({ error: "validation failed", details: error.issues });
    }

    const status = clientFault(error);
    if (status !== null) {
      return reply.code(status).send({ error: messageOf(error) });
    }

    request.log.error(error);
    return reply.code(500).send({ error: "internal server error" });
  });
}
