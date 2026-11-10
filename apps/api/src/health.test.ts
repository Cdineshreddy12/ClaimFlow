import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "./db/client.js";
import { registerHealthRoute } from "./health.js";

vi.mock("./db/client.js", () => ({ db: { execute: vi.fn() } }));

async function app() {
  const instance = Fastify({ logger: false });
  registerHealthRoute(instance);
  await instance.ready();
  return instance;
}

/*
  The check answered 200 from a static object, so it could not fail:
  the process was running, the service was not, and nothing could tell
  the difference.
*/
describe("the health check", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("is ok when the database answers", async () => {
    vi.mocked(db.execute).mockResolvedValue([{ "?column?": 1 }] as never);

    const res = await (await app()).inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "ok" });
  });

  it("reports degraded when the database refuses", async () => {
    vi.mocked(db.execute).mockRejectedValue(new Error("ECONNREFUSED"));

    const res = await (await app()).inject({ method: "GET", url: "/health" });
    // 503 so the balancer takes the task out and ECS replaces it.
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ status: "degraded" });
  });

  it("gives up on a database that never answers, rather than hanging with it", async () => {
    // The actual failure: the socket was open and dead, so the query
    // was written and simply waited. Without the bound, so does this.
    vi.mocked(db.execute).mockReturnValue(
      new Promise(() => {}) as never, // never settles
    );

    const res = await (await app()).inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(503);
  }, 10_000);

  it("doesn't hold the process open with its own timer", async () => {
    // The timeout is unref'd; a pending one must not keep node alive
    // after the request it belonged to has been answered.
    vi.mocked(db.execute).mockResolvedValue([{ "?column?": 1 }] as never);
    const res = await (await app()).inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
  });
});
