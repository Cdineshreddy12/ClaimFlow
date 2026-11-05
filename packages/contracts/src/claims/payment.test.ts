import { describe, expect, it } from "vitest";
import { RecordPaymentBody, shortfall } from "./payment.js";

function yesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function tomorrow() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

describe("RecordPaymentBody", () => {
  it("takes an amount and the date it arrived", () => {
    const result = RecordPaymentBody.safeParse({
      settledAmount: 185000,
      settledOn: yesterday(),
    });
    expect(result.success).toBe(true);
  });

  it("rejects a payment dated in the future", () => {
    // A typo here skews every "settled this month" figure on the
    // dashboard, and nothing else would catch it.
    const result = RecordPaymentBody.safeParse({
      settledAmount: 185000,
      settledOn: tomorrow(),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["settledOn"]);
    }
  });

  it("accepts zero — a claim can be settled for nothing", () => {
    // Fully deducted is a real outcome, and refusing to record it would
    // leave the claim looking unpaid forever.
    expect(
      RecordPaymentBody.safeParse({ settledAmount: 0, settledOn: yesterday() })
        .success,
    ).toBe(true);
  });

  it("rejects a negative amount", () => {
    expect(
      RecordPaymentBody.safeParse({
        settledAmount: -1,
        settledOn: yesterday(),
      }).success,
    ).toBe(false);
  });

  it("rejects a malformed date", () => {
    expect(
      RecordPaymentBody.safeParse({
        settledAmount: 100,
        settledOn: "30-10-2026",
      }).success,
    ).toBe(false);
  });
});

describe("shortfall", () => {
  it("is the gap between what was authorised and what arrived", () => {
    expect(shortfall("185000.00", "150000.00")).toBe(35000);
  });

  it("is null until both numbers are known", () => {
    // Otherwise an unrecorded payment reads as a 100% shortfall, which
    // is alarming and wrong.
    expect(shortfall("185000.00", null)).toBeNull();
    expect(shortfall(null, "150000.00")).toBeNull();
  });

  it("can be zero when the insurer paid in full", () => {
    expect(shortfall("185000.00", "185000.00")).toBe(0);
  });
});
