import { describe, expect, it } from "vitest";
import { Member } from "./member.js";

describe("Member contract", () => {
  it("validates a member's role against the shared Role enum", () => {
    const result = Member.safeParse({
      id: "00000000-0000-0000-0000-000000000002",
      userId: "00000000-0000-0000-0000-000000000003",
      role: "desk_executive",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a role that isn't one of ours", () => {
    const result = Member.safeParse({
      id: "00000000-0000-0000-0000-000000000002",
      userId: "00000000-0000-0000-0000-000000000003",
      role: "superuser",
    });
    expect(result.success).toBe(false);
  });
});
