import { describe, expect, it } from "vitest";
import { CLAIM_TRANSITIONS } from "./status.js";
import { DESK_HOLD_LABEL, SLA_WINDOWS, heldBy, statusesHeldBy } from "./sla.js";
import type { ClaimStatus } from "./status.js";

/**
 * "IRDAI expects insurers to decide cashless requests in 1 hour and
 * discharge in 3 hours, so the hospital's own delays must be timed."
 *
 * The windows only ever described the insurer's obligations, so every
 * number the product produced was about the other side of the table. A
 * desk that takes five hours to send a pre-auth has spent five hours of
 * a patient's admission, and nothing measured it.
 */
describe("who holds a claim", () => {
  it("accounts for every status a claim can sit in and move on from", () => {
    const nonTerminal = (
      Object.keys(CLAIM_TRANSITIONS) as ClaimStatus[]
    ).filter((status) => CLAIM_TRANSITIONS[status].to.length > 0);

    // A status nobody is recorded as holding is time that goes
    // unmeasured on both reports — the exact gap being closed here.
    for (const status of nonTerminal) {
      expect(heldBy(status), `${status} has no owner`).not.toBeNull();
    }
  });

  it("leaves terminal states unowned — there is nothing left to wait for", () => {
    expect(heldBy("SETTLED")).toBeNull();
    expect(heldBy("REJECTED")).toBeNull();
  });

  it("keeps the desk's steps out of the regulatory windows", () => {
    // SLA_WINDOWS is deadlines, and all three are IRDAI's obligations
    // on the insurer. Putting a desk step in there would print our own
    // invented target beside a regulation as though it were one.
    for (const status of statusesHeldBy("desk")) {
      expect(SLA_WINDOWS[status]).toBeUndefined();
    }
    for (const window of Object.values(SLA_WINDOWS)) {
      expect(window.owedBy).toBe("insurer");
    }
  });

  it("names the desk's steps as work, not as database states", () => {
    // "Draft" is a column value; "Opened → pre-auth sent" is a gap a
    // desk head can actually shorten.
    for (const status of statusesHeldBy("desk")) {
      expect(DESK_HOLD_LABEL[status]).toBeTruthy();
      expect(DESK_HOLD_LABEL[status]).not.toBe(status);
    }
  });

  it("puts the two IRDAI windows on the insurer's side", () => {
    expect(heldBy("PRE_AUTH_SENT")).toBe("insurer");
    expect(heldBy("FINAL_BILL_SUBMITTED")).toBe("insurer");
    // And the waiting-on-us states on ours.
    expect(heldBy("DRAFT")).toBe("desk");
    expect(heldBy("QUERY_RAISED")).toBe("desk");
    expect(heldBy("APPROVED")).toBe("desk");
  });
});
