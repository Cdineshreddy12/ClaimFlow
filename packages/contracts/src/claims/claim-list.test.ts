import { describe, expect, it } from "vitest";
import {
  CLAIM_STATUS_ORDER,
  ClaimListQuery,
  MAX_CLAIM_PAGE_SIZE,
  statusesForFilter,
} from "./claim-list.js";
import { ClaimStatus, isTerminal, needsAttention } from "./status.js";

/**
 * What the claims list is asking for.
 *
 * These used to be comparators in the browser, run over every claim
 * the hospital had ever opened. They are SQL now, and they live here
 * so the query and the screen cannot hold different ideas of what
 * "open" means.
 */
describe("statusesForFilter", () => {
  it("hides settled and rejected behind 'open'", () => {
    const open = statusesForFilter("open")!;
    expect(open).not.toContain("SETTLED");
    expect(open).not.toContain("REJECTED");
    expect(open).toContain("PRE_AUTH_SENT");
  });

  it("makes 'attention' a subset of open", () => {
    const attention = statusesForFilter("attention")!;
    const open = statusesForFilter("open")!;
    expect(attention.length).toBeGreaterThan(0);
    for (const status of attention) expect(open).toContain(status);
  });

  it("returns null for 'all', meaning no status clause at all", () => {
    // Not "every status listed out" — an absent WHERE is cheaper and
    // stays right when a status is added.
    expect(statusesForFilter("all")).toBeNull();
  });

  it("takes a single status literally", () => {
    expect(statusesForFilter("QUERY_RAISED")).toEqual(["QUERY_RAISED"]);
  });

  it("derives both groups from the state machine, not a hand-kept list", () => {
    // The guard that matters: add a status to the enum and it lands in
    // the right group without anyone remembering to edit this file.
    for (const status of ClaimStatus.options) {
      expect(statusesForFilter("open")!.includes(status)).toBe(
        !isTerminal(status),
      );
      expect(statusesForFilter("attention")!.includes(status)).toBe(
        needsAttention(status),
      );
    }
  });
});

describe("CLAIM_STATUS_ORDER", () => {
  it("ranks every status, so sorting never drops one", () => {
    for (const status of ClaimStatus.options) {
      expect(CLAIM_STATUS_ORDER[status]).toBeTypeOf("number");
    }
  });

  it("reads as progress rather than alphabetically", () => {
    expect(CLAIM_STATUS_ORDER.DRAFT).toBeLessThan(
      CLAIM_STATUS_ORDER.PRE_AUTH_SENT,
    );
    expect(CLAIM_STATUS_ORDER.APPROVED).toBeLessThan(
      CLAIM_STATUS_ORDER.SETTLED,
    );
  });
});

describe("ClaimListQuery", () => {
  it("caps the page size, so a caller can't ask for everything", () => {
    expect(
      ClaimListQuery.safeParse({ limit: MAX_CLAIM_PAGE_SIZE + 1 }).success,
    ).toBe(false);
    expect(ClaimListQuery.safeParse({ limit: 50 }).success).toBe(true);
  });

  it("reads numbers off a query string", () => {
    const parsed = ClaimListQuery.parse({ limit: "25", offset: "50" });
    expect(parsed.limit).toBe(25);
    expect(parsed.offset).toBe(50);
  });

  it("rejects a negative offset rather than wrapping", () => {
    expect(ClaimListQuery.safeParse({ offset: -1 }).success).toBe(false);
  });
});
