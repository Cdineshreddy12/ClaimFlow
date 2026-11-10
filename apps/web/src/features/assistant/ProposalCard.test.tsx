import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProposalCard } from "./ProposalCard";
import type { AssistantAttachment, Proposal } from "./types";
import { api } from "../../lib/api-client";

vi.mock("../../lib/api-client", () => ({
  api: { get: vi.fn(), post: vi.fn() },
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

/*
  The appeal card is the only one that acts on several things at once,
  and the only one whose figures do not come from the proposal. The
  model passes ids; the amounts are read from the worklist, because the
  amount is the entire basis on which a desk decides to contest and
  approving the model's arithmetic is not the same as approving the
  appeal.
*/
describe("the open_appeal card", () => {
  const D1 = "ded-1";
  const D2 = "ded-2";

  function appealProposal(ids: string[] = [D1, D2]): Proposal {
    return {
      id: "toolu_appeal",
      kind: "open_appeal",
      input: { deduction_ids: ids },
    };
  }

  function row(id: string, overrides: Record<string, unknown> = {}) {
    return {
      id,
      claimId: "claim-1",
      claimReference: id === D1 ? "CLM-0001" : "CLM-0002",
      patientName: id === D1 ? "Rajendra Pawar" : "Meera Joshi",
      insurerName: "Star Health",
      reason: "missing_document",
      amount: id === D1 ? "18000.00" : "42000.00",
      note: null,
      appealStatus: "NOT_CONTESTED",
      recoveredAmount: null,
      contestedAt: null,
      resolvedAt: null,
      appealNote: null,
      createdAt: "2026-11-05T12:00:00.000Z",
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.get).mockResolvedValue([row(D1), row(D2)] as never);
    vi.mocked(api.post).mockResolvedValue({
      opened: [{ id: D1 }, { id: D2 }],
      alreadyOpen: [],
    } as never);
  });

  it("lists each deduction with the amount the server reports", async () => {
    render(<ProposalCard proposal={appealProposal()} attachments={[]} />, {
      wrapper,
    });

    expect(await screen.findByText(/CLM-0001/)).toBeInTheDocument();
    expect(screen.getByText(/CLM-0002/)).toBeInTheDocument();
    // 18,000 + 42,000, in the heading — the number that decides whether
    // this is worth anyone's afternoon.
    expect(screen.getByText(/60,000/)).toBeInTheDocument();
  });

  it("says plainly that nothing goes to the insurer", async () => {
    // ADR 0013's lifecycle stops at CONTESTED. A card that read as
    // "appeal filed" would be the assistant claiming to have done the
    // part a person still has to do.
    render(<ProposalCard proposal={appealProposal()} attachments={[]} />, {
      wrapper,
    });
    expect(
      await screen.findByText(/Nothing is sent to the insurer/),
    ).toBeInTheDocument();
  });

  it("sends only the deductions it actually showed", async () => {
    // The worklist moved between the model reading it and the desk
    // clicking: D2 is already contested, so it isn't on the card and
    // must not be in the approval either.
    vi.mocked(api.get).mockResolvedValue([
      row(D1),
      row(D2, { appealStatus: "CONTESTED" }),
    ] as never);

    render(<ProposalCard proposal={appealProposal()} attachments={[]} />, {
      wrapper,
    });

    await screen.findByText(/CLM-0001/);
    expect(screen.queryByText(/CLM-0002/)).not.toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: "Open the appeals" }),
    );

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        "/assistant/proposals/approve",
        expect.objectContaining({ input: { deduction_ids: [D1] } }),
      ),
    );
  });

  it("won't offer the button when there is nothing left to contest", async () => {
    // Every id already contested. A button here would report success
    // for opening nothing.
    vi.mocked(api.get).mockResolvedValue([
      row(D1, { appealStatus: "CONTESTED" }),
      row(D2, { appealStatus: "CONTESTED" }),
    ] as never);

    render(<ProposalCard proposal={appealProposal()} attachments={[]} />, {
      wrapper,
    });

    expect(
      await screen.findByText(/None of these are still uncontested/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open the appeals" }),
    ).toBeDisabled();
  });

  it("reports the half that happened, not a flat Done", async () => {
    vi.mocked(api.post).mockResolvedValue({
      opened: [{ id: D1 }],
      alreadyOpen: [D2],
    } as never);

    render(<ProposalCard proposal={appealProposal()} attachments={[]} />, {
      wrapper,
    });

    await screen.findByText(/CLM-0001/);
    await userEvent.click(
      screen.getByRole("button", { name: "Open the appeals" }),
    );

    expect(
      await screen.findByText(/1 opened · 1 already contested/),
    ).toBeInTheDocument();
  });

  it("doesn't read the appeal worklist for any other card", async () => {
    // The route is gated to a desk head, so an unconditional fetch
    // would 403 for a desk executive on every proposal shown to them.
    render(
      <ProposalCard proposal={fileProposal()} attachments={[ATTACHMENT]} />,
      { wrapper },
    );
    await screen.findByText(/scan_0017.jpg/);
    expect(api.get).not.toHaveBeenCalled();
  });
});
