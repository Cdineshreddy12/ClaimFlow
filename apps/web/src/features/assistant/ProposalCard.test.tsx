import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProposalCard } from "./ProposalCard";
import type { AssistantAttachment, Proposal } from "./types";
import { api } from "../../lib/api-client";

vi.mock("../../lib/api-client", () => ({
  api: { post: vi.fn() },
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const ATTACHMENT: AssistantAttachment = {
  id: "att-1",
  fileName: "scan_0017.jpg",
  contentType: "image/jpeg",
  suggestedClaimId: "claim-1",
  suggestedSlot: "Ultrasound report (abdomen)",
  claimConfidence: "0.970",
  slotConfidence: "0.990",
  recognitionReason: 'Patient name "Mr. Rajendra Pawar" matches CLM-0001.',
  ocrConfidence: "0.990",
  filedAt: null,
  dismissedAt: null,
  createdAt: "2026-11-05T12:00:00.000Z",
  suggestedClaim: {
    id: "claim-1",
    reference: "CLM-0001",
    patientName: "Rajendra Pawar",
    procedureName: "Gall bladder removal",
    checklistSlots: ["Ultrasound report (abdomen)", "Photo ID proof"],
  },
};

function fileProposal(input: Record<string, unknown> = {}): Proposal {
  return {
    id: "toolu_1",
    kind: "file_document",
    input: {
      attachment_id: "att-1",
      claim_id: "claim-1",
      checklist_slot: "Ultrasound report (abdomen)",
      ...input,
    },
  };
}

describe("ProposalCard", () => {
  beforeEach(() => {
    vi.mocked(api.post).mockResolvedValue({});
  });

  /**
   * This card is the permission step (docs/adr/0005). What matters is
   * that nothing happens until it is clicked, that what happens is what
   * the desk actually saw, and that a spent card cannot be clicked
   * again.
   */
  it("shows the claim, the quote it was matched on, and does nothing on its own", () => {
    render(
      <ProposalCard proposal={fileProposal()} attachments={[ATTACHMENT]} />,
      { wrapper },
    );

    expect(screen.getByText("scan_0017.jpg")).toBeInTheDocument();
    expect(screen.getByText(/CLM-0001 — Rajendra Pawar/)).toBeInTheDocument();
    expect(screen.getByText(/97% sure/)).toBeInTheDocument();
    // The quote is the point of the card: "it says CLM-0001 on it" and
    // "the name matches" are different levels of proof.
    expect(
      screen.getByText(/Patient name "Mr. Rajendra Pawar" matches CLM-0001./),
    ).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  it("sends the slot the desk left on the card, not the one the model proposed", async () => {
    render(
      <ProposalCard proposal={fileProposal()} attachments={[ATTACHMENT]} />,
      { wrapper },
    );

    // The select is a Radix trigger; picking through it is the only
    // path a real user has.
    await userEvent.click(
      screen.getByRole("combobox", { name: "Checklist slot" }),
    );
    await userEvent.click(
      await screen.findByRole("option", { name: "Photo ID proof" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "File it" }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        "/assistant/proposals/approve",
        expect.objectContaining({
          kind: "file_document",
          input: expect.objectContaining({ checklist_slot: "Photo ID proof" }),
        }),
      ),
    );
  });

  it("carries where the card came from, so it can be marked spent", async () => {
    render(
      <ProposalCard
        proposal={fileProposal()}
        attachments={[ATTACHMENT]}
        conversationId="conv-1"
      />,
      { wrapper },
    );

    await userEvent.click(screen.getByRole("button", { name: "File it" }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        "/assistant/proposals/approve",
        expect.objectContaining({
          conversationId: "conv-1",
          proposalId: "toolu_1",
        }),
      ),
    );
  });

  it("offers nothing to click on a card that was already approved", () => {
    render(
      <ProposalCard
        proposal={fileProposal()}
        attachments={[ATTACHMENT]}
        alreadyApproved
      />,
      { wrapper },
    );

    expect(screen.getByText("Done")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "File it" }),
    ).not.toBeInTheDocument();
  });

  it("can be waved away without doing anything", async () => {
    render(
      <ProposalCard proposal={fileProposal()} attachments={[ATTACHMENT]} />,
      { wrapper },
    );

    await userEvent.click(screen.getByRole("button", { name: "Not now" }));

    expect(screen.queryByText("scan_0017.jpg")).not.toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  it("reports a refusal instead of implying the filing worked", async () => {
    vi.mocked(api.post).mockRejectedValue(
      new Error("that file was already filed"),
    );
    render(
      <ProposalCard proposal={fileProposal()} attachments={[ATTACHMENT]} />,
      { wrapper },
    );

    await userEvent.click(screen.getByRole("button", { name: "File it" }));

    expect(
      await screen.findByText(/that file was already filed/),
    ).toBeInTheDocument();
    expect(screen.queryByText("Done")).not.toBeInTheDocument();
  });

  /**
   * The two slot proposals are easy to confuse and have very different
   * blast radii, so each has to say which it is — see docs/adr/0001's
   * amendment.
   */
  describe("the two kinds of new slot", () => {
    it("a rule change says it won't help the claim in hand", () => {
      render(
        <ProposalCard
          proposal={{
            id: "toolu_2",
            kind: "add_checklist_slot",
            input: { claim_id: "claim-1", document_type: "Cost estimate" },
          }}
          attachments={[ATTACHMENT]}
        />,
        { wrapper },
      );

      expect(screen.getByText(/Add .Cost estimate./)).toBeInTheDocument();
      expect(
        screen.getByText(/won't open a slot on the claim this came from/),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Add the slot" }),
      ).toBeInTheDocument();
    });

    it("a per-claim slot says it changes only this claim", () => {
      render(
        <ProposalCard
          proposal={{
            id: "toolu_3",
            kind: "file_as_new_slot",
            input: {
              attachment_id: "att-1",
              claim_id: "claim-1",
              checklist_slot: "Cost estimate",
            },
          }}
          attachments={[ATTACHMENT]}
        />,
        { wrapper },
      );

      expect(screen.getByText(/Only this claim/)).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Add slot and file" }),
      ).toBeInTheDocument();
    });
  });
});
