import { describe, expect, it } from "vitest";
import { canTransition } from "./status.js";

describe("canTransition", () => {
  it("allows pre-auth to move to a query", () => {
    expect(
      canTransition("PRE_AUTH_SENT", "QUERY_RAISED", "desk_executive"),
    ).toBe(true);
  });

  it("rejects skipping straight from draft to approved", () => {
    expect(canTransition("DRAFT", "APPROVED", "desk_head")).toBe(false);
  });

  it("treats enhancement as distinct from query", () => {
    expect(
      canTransition("PRE_AUTH_SENT", "ENHANCEMENT_REQUESTED", "desk_executive"),
    ).toBe(true);
    expect(
      canTransition("QUERY_RAISED", "ENHANCEMENT_REQUESTED", "desk_executive"),
    ).toBe(false);
  });

  it("restricts settlement to the desk head", () => {
    expect(
      canTransition("FINAL_BILL_SUBMITTED", "SETTLED", "desk_executive"),
    ).toBe(false);
    expect(canTransition("FINAL_BILL_SUBMITTED", "SETTLED", "desk_head")).toBe(
      true,
    );
  });

  it("treats terminal states as dead ends", () => {
    expect(canTransition("SETTLED", "APPROVED", "desk_head")).toBe(false);
    expect(canTransition("REJECTED", "PRE_AUTH_SENT", "desk_head")).toBe(false);
  });
});
