import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { ChecklistGapsCard } from "./ChecklistGapsCard";
import type { Claim, ClaimGaps } from "./types";

vi.mock("@/lib/api-client", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

function claim(snapshot: { documentType: string; required: boolean }[]) {
  return { id: "claim-1", checklistSnapshot: snapshot } as unknown as Claim;
}

function show(c: Claim, gaps: ClaimGaps) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ChecklistGapsCard claim={c} gaps={gaps} />
    </QueryClientProvider>,
  );
}

describe("ChecklistGapsCard", () => {
  it("does not call a claim with no checklist 'Complete'", () => {
    // No rules means nothing can ever be reported missing, so the count
    // reaches zero without a single document being looked at. The pill
    // is what a desk scans, and "Complete" on an unchecked file reads
    // as "ready to send".
    show(claim([]), { missing: [], satisfied: [] } as ClaimGaps);

    expect(screen.queryByText("Complete")).toBeNull();
    expect(screen.getByText("Not checked")).toBeInTheDocument();
    expect(screen.getByText(/This claim has no checklist/)).toBeInTheDocument();
  });

  it("says Complete when a real checklist has nothing outstanding", () => {
    show(claim([{ documentType: "Photo ID proof", required: true }]), {
      missing: [],
      satisfied: ["Photo ID proof"],
    } as ClaimGaps);

    expect(screen.getByText("Complete")).toBeInTheDocument();
  });

  it("counts what is actually outstanding", () => {
    show(
      claim([
        { documentType: "Photo ID proof", required: true },
        { documentType: "Treating doctor's note", required: true },
      ]),
      { missing: ["Photo ID proof"], satisfied: [] } as ClaimGaps,
    );

    expect(screen.getByText("1 missing")).toBeInTheDocument();
  });
});
