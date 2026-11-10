import Fastify, { type FastifyInstance } from "fastify";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { registerErrorHandler } from "./errors.js";
import { aiRateLimit, registerRateLimit } from "./rate-limit.js";

/**
 * The limiter and the error handler, together.
 *
 * Apart they both looked right: the plugin counted correctly and
 * stopped the 61st request, and the handler returned whatever status
 * an error carried. Together they returned "internal server error"
 * with a `retry-after` header on the same response, because
 * `errorResponseBuilder` reads as "return the body to send" and the
 * plugin throws what it returns — so a plain `{ error }` object
 * reached the handler with no `statusCode` on it at all.
 *
 * Built with `inject`, so there is no port, no clock to wait on and
 * nothing flaky about it.
 */
async function appWithLimits(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await registerRateLimit(app);
  registerErrorHandler(app);

  app.post("/ai", aiRateLimit(), async () => ({ ok: true }));
  app.get("/cheap", async () => ({ ok: true }));
  app.post("/zod", async () => {
    z.object({ n: z.number() }).parse({ n: "no" });
    return { ok: true };
  });
  await app.ready();
  return app;
}

const AI_LIMIT = 60;

describe("the AI rate limit", () => {
  it("serves the whole allowance, then refuses", async () => {
    const app = await appWithLimits();
    try {
      for (let i = 0; i < AI_LIMIT; i++) {
        const res = await app.inject({ method: "POST", url: "/ai" });
        expect(res.statusCode, `request ${i + 1}`).toBe(200);
      }
      const over = await app.inject({ method: "POST", url: "/ai" });
      expect(over.statusCode).toBe(429);
    } finally {
      await app.close();
    }
  });

  it("says 429 and why, not 'internal server error'", async () => {
    const app = await appWithLimits();
    try {
      for (let i = 0; i < AI_LIMIT; i++) {
        await app.inject({ method: "POST", url: "/ai" });
      }
      const over = await app.inject({ method: "POST", url: "/ai" });

      expect(over.statusCode).toBe(429);
      // The symptom that sent this the wrong way: a throttle reported
      // as a server fault, which tells a client to retry immediately.
      expect(over.json()).not.toEqual({ error: "internal server error" });
      expect(over.json().error).toMatch(/more AI work/i);
      // And the header a client would actually act on.
      expect(over.headers["retry-after"]).toBeDefined();
    } finally {
      await app.close();
    }
  });

  it("leaves the cheap routes alone at that volume", async () => {
    const app = await appWithLimits();
    try {
      for (let i = 0; i < AI_LIMIT; i++) {
        await app.inject({ method: "POST", url: "/ai" });
      }
      // Reads share the generous global ceiling, not the AI one: a desk
      // that has just filed a claim must still be able to look at it.
      const read = await app.inject({ method: "GET", url: "/cheap" });
      expect(read.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it("still turns a bad body into a 400 with its reasons", async () => {
    const app = await appWithLimits();
    try {
      const res = await app.inject({ method: "POST", url: "/zod" });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("validation failed");
      expect(res.json().details).toHaveLength(1);
    } finally {
      await app.close();
    }
  });

  it("does not throttle the health check", async () => {
    // It is what tells the load balancer this task is alive; throttling
    // it turns a busy minute into a restart.
    const app = Fastify({ logger: false });
    await registerRateLimit(app);
    registerErrorHandler(app);
    app.get("/health", async () => ({ status: "ok" }));
    await app.ready();
    try {
      for (let i = 0; i < 700; i++) {
        const res = await app.inject({ method: "GET", url: "/health" });
        if (res.statusCode !== 200) {
          throw new Error(`throttled at ${i + 1}: ${res.statusCode}`);
        }
      }
    } finally {
      await app.close();
    }
  });
});
