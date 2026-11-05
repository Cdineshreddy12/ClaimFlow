import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MatchTable } from "./MatchTable";
import type { AssistantAttachment } from "./types";

function attachment(
  overrides: Partial<AssistantAttachment> = {},
): AssistantAttachment {
  return {
    id: "att-1",
    fileName: "IMG_0423.jpg",
    contentType: "image/jpeg",
    suggestedClaimId: "claim-1",
    suggestedSlot: "Treating doctor's note",
    claimConfidence: "0.970",
    slotConfidence: "0.980",
    recognitionReason: "Names Rajendra Pawar.",
    ocrConfidence: "0.990",
    filedAt: null,
    dismissedAt: null,
    createdAt: "2026-11-05T12:00:00.000Z",
    suggestedClaim: {
      id: "claim-1",
      reference: "CLM-0001",
      patientName: "Rajendra Pawar",
      procedureName: "Gall bladder removal",
      checklistSlots: ["Treating doctor's note"],
    },
    ...overrides,
  };
}

describe("MatchTable", () => {
  it("puts each file's match on its own row", () => {
    render(
      <MatchTable
        attachments={[
          attachment(),
          attachment({ id: "att-2", fileName: "scan_0017.jpg" }),
        ]}
      />,
    );

    // Header plus one row per file.
    expect(screen.getAllByRole("row")).toHaveLength(3);
    expect(screen.getByText("IMG_0423.jpg")).toBeInTheDocument();
    expect(screen.getAllByText("CLM-0001")).toHaveLength(2);
    expect(screen.getAllByText("97%")).toHaveLength(2);
  });

  it("says plainly when nothing matched rather than leaving a blank cell", () => {
    render(
      <MatchTable
        attachments={[
          attachment({
            suggestedClaim: null,
            suggestedClaimId: null,
            claimConfidence: null,
            suggestedSlot: null,
          }),
        ]}
      />,
    );

    expect(screen.getByText("No match")).toBeInTheDocument();
  });

  it("marks a row whose file is already filed", () => {
    render(
      <MatchTable
        attachments={[
          attachment({
            duplicateOf: {
              kind: "same_file",
              claimId: "claim-1",
              claimReference: "CLM-0001",
              slot: "Cost estimate",
              filedAt: "2026-11-05T12:52:00.000Z",
              fileName: "ecard.jpg",
            },
          }),
        ]}
      />,
    );

    expect(screen.getByText("Already filed")).toBeInTheDocument();
  });

  it("flags a low-confidence match rather than showing it like any other", () => {
    render(
      <MatchTable attachments={[attachment({ claimConfidence: "0.550" })]} />,
    );

    const cell = screen.getByText("55%");
    // 55% and 97% must not read the same — the whole point of showing
    // the number is that one of them deserves a second look.
    expect(cell.className).toContain("text-pending");
  });

  it("renders nothing at all when there is nothing to show", () => {
    const { container } = render(<MatchTable attachments={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("keeps the row readable when a claim has no reference yet", () => {
    render(
      <MatchTable
        attachments={[
          attachment({
            suggestedClaim: {
              id: "claim-1",
              reference: null,
              patientName: "Rajendra Pawar",
              procedureName: "Gall bladder removal",
              checklistSlots: [],
            },
          }),
        ]}
      />,
    );

    const row = screen.getAllByRole("row")[1]!;
    expect(within(row).getByText("Rajendra Pawar")).toBeInTheDocument();
  });
});
