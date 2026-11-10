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

/** What the client is told when something throws. */
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
