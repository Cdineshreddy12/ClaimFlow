import { describe, expect, it } from "vitest";
import { Organization, OrgMember } from "./organization.js";

describe("Organization contract", () => {
  it("accepts a well-formed organization", () => {
    const result = Organization.safeParse({
      id: "00000000-0000-0000-0000-000000000001",
      name: "Company A — Nashik Multispecialty",
      slug: "company-a-nashik",
      plan: "pilot",
      subscriptionStatus: "active",
      createdAt: new Date().toISOString(),
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown subscription status", () => {
    const result = Organization.safeParse({
      id: "00000000-0000-0000-0000-000000000001",
      name: "Company A",
      slug: "company-a",
      plan: "pilot",
      subscriptionStatus: "lifetime-free", // not a real status
      createdAt: new Date().toISOString(),
    });
    expect(result.success).toBe(false);
  });

  it("validates an org member's role against the shared Role enum", () => {
    const result = OrgMember.safeParse({
      id: "00000000-0000-0000-0000-000000000002",
      organizationId: "00000000-0000-0000-0000-000000000001",
      userId: "00000000-0000-0000-0000-000000000003",
      role: "desk_executive",
    });
    expect(result.success).toBe(true);
  });
});
