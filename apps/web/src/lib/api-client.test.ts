import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "./api-client";

vi.mock("./supabase-client", () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null } }) } },
}));

afterEach(() => vi.unstubAllGlobals());

describe("api client", () => {
  it("turns a request that never answers into an error, not a hang", async () => {
    // `fetch` has no default timeout. Without one, a server restart or a
    // dropped connection left every mutation pending forever — its
    // button disabled, no message, nothing to retry. The desk's only
    // way out was reloading the page.
    //
    // Rejecting with a TimeoutError is exactly what the browser does
    // once the signal fires, so this tests the handling without the
    // test sitting through the real minute.
    vi.stubGlobal("fetch", () =>
      Promise.reject(new DOMException("timed out", "TimeoutError")),
    );

    await expect(api.get("/anything")).rejects.toBeInstanceOf(ApiError);
    await expect(api.get("/anything")).rejects.toThrow(/didn't respond/i);
  });

  it("says the server is unreachable rather than leaking TypeError", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("Failed")));

    await expect(api.get("/anything")).rejects.toThrow(/connection/i);
  });

  it("still surfaces the API's own message on a refusal", async () => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve(
        new Response(JSON.stringify({ error: "retire it instead" }), {
          status: 409,
        }),
      ),
    );

    await expect(api.delete("/procedures/1")).rejects.toThrow(
      "retire it instead",
    );
  });

  it("passes an abort signal on every call, blobs included", async () => {
    const seen: (AbortSignal | null | undefined)[] = [];
    vi.stubGlobal("fetch", (_url: string, init?: RequestInit) => {
      seen.push(init?.signal);
      return Promise.resolve(new Response("{}", { status: 200 }));
    });

    await api.get("/a");
    await api.post("/b", { x: 1 });
    await api.getBlob("/c.pdf");

    expect(seen).toHaveLength(3);
    for (const signal of seen) expect(signal).toBeInstanceOf(AbortSignal);
  });
});
