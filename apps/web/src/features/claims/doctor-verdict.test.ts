import { describe, expect, it } from "vitest";
import { doctorVerdict } from "./doctor-verdict";
import type { DoctorApprovalRequest } from "./api";

const NOW = new Date("2026-11-06T10:00:00.000Z");

function link(
  overrides: Partial<DoctorApprovalRequest> = {},
): DoctorApprovalRequest {
  return {
    id: "link-1",
    token: "t",
    doctorName: "Dr S. A. Kulkarni",
    expiresAt: "2026-11-08T10:00:00.000Z",
    firstViewedAt: null,
    approvedAt: null,
    declinedAt: null,
    declineReason: null,
    ...overrides,
  };
}

/**
 * The decision a doctor made is only useful if the desk sees it before
 * they submit. adr 0010 records it; until now the only place it
 * appeared was inside a dialog nobody opens.
 */
describe("doctorVerdict", () => {
  it("is 'none' when nobody was asked", () => {
    expect(doctorVerdict([], NOW)).toEqual({ kind: "none" });
    expect(doctorVerdict(undefined, NOW)).toEqual({ kind: "none" });
  });

  it("separates a link that was opened from one that wasn't", () => {
    expect(doctorVerdict([link()], NOW)).toMatchObject({
      kind: "awaiting",
      viewed: false,
    });
    expect(
      doctorVerdict([link({ firstViewedAt: "2026-11-06T09:00:00.000Z" })], NOW),
    ).toMatchObject({ kind: "awaiting", viewed: true });
  });

  it("calls an unanswered, out-of-date link expired — it needs sending again", () => {
    expect(
      doctorVerdict([link({ expiresAt: "2026-11-05T10:00:00.000Z" })], NOW),
    ).toMatchObject({ kind: "expired" });
  });

  it("carries the decline reason, which is the whole point of asking", () => {
    const verdict = doctorVerdict(
      [
        link({
          declinedAt: "2026-11-06T09:30:00.000Z",
          declineReason: "The ICD code doesn't match what I operated on.",
        }),
      ],
      NOW,
    );

    expect(verdict).toMatchObject({
      kind: "declined",
      reason: "The ICD code doesn't match what I operated on.",
    });
  });

  it("takes the latest decision, not the worst one", () => {
    // A doctor who declines a note and approves the replacement has
    // approved it. Showing the old refusal next to the new approval
    // teaches the desk to ignore both.
    const verdict = doctorVerdict(
      [
        link({
          id: "a",
          declinedAt: "2026-11-05T10:00:00.000Z",
          declineReason: "Wrong scan attached.",
        }),
        link({ id: "b", approvedAt: "2026-11-06T09:00:00.000Z" }),
      ],
      NOW,
    );

    expect(verdict).toMatchObject({ kind: "approved" });
  });

  it("a later decline overrides an earlier approval", () => {
    const verdict = doctorVerdict(
      [
        link({ id: "a", approvedAt: "2026-11-05T10:00:00.000Z" }),
        link({
          id: "b",
          declinedAt: "2026-11-06T09:00:00.000Z",
          declineReason: "Second look — the dates are wrong.",
        }),
      ],
      NOW,
    );

    expect(verdict).toMatchObject({ kind: "declined" });
  });

  it("a decision outranks a link still outstanding", () => {
    // Asking a second doctor doesn't un-ask the first.
    const verdict = doctorVerdict(
      [
        link({
          id: "a",
          declinedAt: "2026-11-06T08:00:00.000Z",
          declineReason: "Not my patient.",
        }),
        link({ id: "b", doctorName: "Dr Rao" }),
      ],
      NOW,
    );

    expect(verdict).toMatchObject({ kind: "declined" });
  });
});
