import { describe, expect, it } from "vitest";
import {
  CLAIM_TRANSITIONS,
  ClaimStatus,
  canTransition,
  isTerminal,
  needsAttention,
  TERMINAL_STATUSES,
} from "./status.js";

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

  it("lets an approved claim ask for more cover", () => {
    // The usual moment for an enhancement: the sanction is agreed on
    // admission and the overrun shows up mid-stay. Forbidding it here
    // is why the enhancement flow used to write the status change
    // straight to the repository and skip this table entirely.
    expect(
      canTransition("APPROVED", "ENHANCEMENT_REQUESTED", "desk_executive"),
    ).toBe(true);
  });

  it("still won't send an approved claim back to a document query", () => {
    // Approved means the insurer has decided. A missing document after
    // that is a final-bill problem, not a pre-auth one.
    expect(canTransition("APPROVED", "QUERY_RAISED", "desk_head")).toBe(false);
  });

  it("restricts settlement to the desk head", () => {
    expect(
      canTransition("DISCHARGE_AUTHORISED", "SETTLED", "desk_executive"),
    ).toBe(false);
    expect(canTransition("DISCHARGE_AUTHORISED", "SETTLED", "desk_head")).toBe(
      true,
    );
  });

  it("treats terminal states as dead ends", () => {
    expect(canTransition("SETTLED", "APPROVED", "desk_head")).toBe(false);
    expect(canTransition("REJECTED", "PRE_AUTH_SENT", "desk_head")).toBe(false);
  });
});

describe("terminal statuses", () => {
  it("derives exactly the statuses with nowhere left to go", () => {
    expect(TERMINAL_STATUSES.sort()).toEqual(["REJECTED", "SETTLED"]);
  });

  it("agrees with isTerminal for every status", () => {
    for (const status of ClaimStatus.options) {
      expect(isTerminal(status)).toBe(TERMINAL_STATUSES.includes(status));
    }
  });

  it("treats a sent pre-auth as open but not needing attention", () => {
    // It's waiting on the insurer, not on the desk — the distinction the
    // dashboard's two counts rest on.
    expect(isTerminal("PRE_AUTH_SENT")).toBe(false);
    expect(needsAttention("PRE_AUTH_SENT")).toBe(false);
    expect(needsAttention("QUERY_RAISED")).toBe(true);
    expect(needsAttention("ENHANCEMENT_REQUESTED")).toBe(true);
  });
});

/**
 * Who may settle.
 *
 * The transition table is the only authorization in the product that
 * is not a `requireRole(...)` on a route, and it drifted: it named
 * `desk_head` alone, so an org_admin — more privileged on every other
 * surface — could not take a claim to SETTLED. A hospital with one
 * admin could never finish a claim.
 */
describe("settling", () => {
  it("is open to both roles that administer the desk", () => {
    expect(canTransition("DISCHARGE_AUTHORISED", "SETTLED", "org_admin")).toBe(
      true,
    );
    expect(canTransition("DISCHARGE_AUTHORISED", "SETTLED", "desk_head")).toBe(
      true,
    );
  });

  it("is still closed to a desk executive", () => {
    // The point of the restriction: settling is irreversible and is
    // where the money stops moving.
    expect(
      canTransition("DISCHARGE_AUTHORISED", "SETTLED", "desk_executive"),
    ).toBe(false);
  });
});

/*
  The final bill used to go straight to SETTLED, which made the gap
  between them the wait for payment — and that gap was then measured
  against IRDAI's three-hour discharge window. Letting the patient go
  and paying the bill are separate answers to the same submission, and
  only the first one is on a regulator's clock.
*/
describe("discharge authorisation", () => {
  it("sits between the final bill and the money", () => {
    // Containment, not equality: the final bill can also be queried,
    // which is a detour rather than a step on this path.
    expect(CLAIM_TRANSITIONS.FINAL_BILL_SUBMITTED.to).toContain(
      "DISCHARGE_AUTHORISED",
    );
    expect(CLAIM_TRANSITIONS.DISCHARGE_AUTHORISED.to).toEqual(["SETTLED"]);
  });

  it("cannot be skipped on the way to settlement", () => {
    expect(canTransition("FINAL_BILL_SUBMITTED", "SETTLED", "org_admin")).toBe(
      false,
    );
  });

  it("is open to a desk executive, because nothing has been paid yet", () => {
    // Recorded with a patient at the counter waiting to leave, which is
    // a poor moment to find out you lack the role.
    expect(
      canTransition(
        "FINAL_BILL_SUBMITTED",
        "DISCHARGE_AUTHORISED",
        "desk_executive",
      ),
    ).toBe(true);
  });
});

/*
  A TPA queries the final bill as readily as the pre-auth — a missing
  break-up, an implant invoice, a discharge summary that stops a day
  short. The stage could only go forward, so the query could be logged
  against the claim while the claim went on saying it was waiting for a
  discharge authorisation.
*/
describe("a query at the final bill", () => {
  it("can be raised there, not only at the pre-auth", () => {
    expect(
      canTransition("FINAL_BILL_SUBMITTED", "QUERY_RAISED", "desk_executive"),
    ).toBe(true);
  });

  it("can be answered back to either stage a query is raised at", () => {
    // The table cannot tell which applies to a given claim — only its
    // history can, and transitionClaimStatus is where that is enforced.
    expect(CLAIM_TRANSITIONS.QUERY_RAISED.to).toEqual([
      "PRE_AUTH_SENT",
      "FINAL_BILL_SUBMITTED",
    ]);
  });

  it("still cannot jump the pre-auth stages", () => {
    // Widening QUERY_RAISED must not open a back door into the middle
    // of the lifecycle.
    expect(canTransition("QUERY_RAISED", "APPROVED", "org_admin")).toBe(false);
    expect(canTransition("QUERY_RAISED", "SETTLED", "org_admin")).toBe(false);
  });
});
