import Fastify, { type FastifyInstance } from "fastify";
import { describe, expect, it } from "vitest";
import { registerRequestDeadline } from "./request-deadline.js";

async function appWithDeadline(ms: number): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerRequestDeadline(app, ms);
  app.get("/quick", async () => ({ ok: true }));
  app.get("/hangs", () => new Promise(() => {}));
  app.get("/assistant/chat", () => new Promise(() => {}));
  await app.ready();
  return app;
}

/*
  Nothing bounded a handler, so when the pool saturated the requests
  queued for a connection that never freed and simply never answered —
  a spinner rather than an error.
*/
describe("the request deadline", () => {
  it("leaves a normal request alone", async () => {
    const app = await appWithDeadline(50);
    const res = await app.inject({ method: "GET", url: "/quick" });
    expect(res.statusCode).toBe(200);
  });

  it("fails a request that never finishes", async () => {
    const app = await appWithDeadline(50);
    const res = await app.inject({ method: "GET", url: "/hangs" });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({
      error: expect.stringContaining("too long"),
    });
  });

  it("leaves the assistant unbounded, because Claude is slow on purpose", async () => {
    /*
      The only responses past three seconds in a week of traffic were
      assistant turns — 21s is a normal answer there. A deadline that
      cut those off would be trading a real hang for a fake one.
    */
    const app = await appWithDeadline(50);
    const res = await Promise.race([
      app.inject({ method: "GET", url: "/assistant/chat" }),
      new Promise((resolve) => setTimeout(() => resolve("still running"), 200)),
    ]);
    expect(res).toBe("still running");
  });
});
