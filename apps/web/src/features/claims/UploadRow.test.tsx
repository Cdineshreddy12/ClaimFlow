import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { UploadRow } from "./UploadRow";
import type { ClaimDocument } from "../documents/types";
import type { Claim } from "./types";
import { api } from "@/lib/api-client";

vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn() } }));

const CLAIM = {
  id: "claim-1",
  checklistSnapshot: [
    { documentType: "Treating doctor's note", required: true },
    { documentType: "Photo ID proof", required: true },
  ],
} as unknown as Claim;

function doc(overrides: Partial<ClaimDocument> = {}): ClaimDocument {
  return {
    id: "doc-1",
    claimId: "claim-1",
    fileUrl: "claims/claim-1/9c3dc451-da7a-4a0b-93c0-14740f813e43-IMG_0423.jpg",
    aiClassifiedType: "Treating doctor's note",
    checklistSlot: null,
    confidence: "0.970",
    classifiedBy: "claude",
    classificationReason: "Names Rajendra Pawar.",
    confirmedBy: null,
    confirmedAt: null,
    createdAt: "2026-11-05T12:00:00.000Z",
    classifiedAt: "2026-11-05T12:00:00.000Z",
    ...overrides,
  } as ClaimDocument;
}

function renderRow(d: ClaimDocument) {
  return render(
    <UploadRow
      doc={d}
      claim={CLAIM}
      onConfirm={vi.fn()}
      onDiscard={vi.fn()}
      isBusy={false}
    />,
  );
}

describe("UploadRow", () => {
  /**
   * The row asks a desk to file a document into a slot. Doing that from
   * the classifier's one-line reason alone is agreeing with a sentence
   * about a page, not reading it.
   */
  it("opens an unconfirmed document in the app", async () => {
    vi.mocked(api.get).mockResolvedValue({ downloadUrl: "https://s3/x" });
    renderRow(doc());

    // The uuid prefix the storage key carries is never shown.
    const name = screen.getByRole("button", { name: /IMG_0423\.jpg/ });
    expect(api.get).not.toHaveBeenCalled();

    await userEvent.click(name);

    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith(
        "/claims/claim-1/documents/doc-1/download-url",
      ),
    );
    expect(
      await screen.findByRole("img", { name: "IMG_0423.jpg" }),
    ).toHaveAttribute("src", "https://s3/x");
  });

  it("opens a confirmed one too — a filed document still has to be checkable", async () => {
    vi.mocked(api.get).mockResolvedValue({ downloadUrl: "https://s3/y" });
    renderRow(
      doc({
        confirmedAt: "2026-11-05T12:05:00.000Z",
        checklistSlot: "Treating doctor's note",
      }),
    );

    await userEvent.click(
      screen.getByRole("button", { name: /IMG_0423\.jpg/ }),
    );

    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith(
        "/claims/claim-1/documents/doc-1/download-url",
      ),
    );
  });

  /**
   * What the row says when the human and the classifier disagree.
   *
   * A company logo was filed into "Pre-authorization form" on a live
   * claim. The classifier had refused it — no slot, confidence 0 — and
   * the row said nothing at all, so the refusal never reached the
   * person clicking Confirm. None of this blocks; the override is the
   * design (docs/adr/0005). The silence was the defect.
   */
  describe("when nothing vouches for the chosen slot", () => {
    it("stays quiet when the choice is the one that was read", () => {
      renderRow(doc());

      expect(screen.queryByText(/goes against that/)).toBeNull();
      expect(screen.getByRole("button", { name: "Confirm" })).toBeEnabled();
    });

    it("says so when a classifier ran and named no slot", () => {
      renderRow(doc({ aiClassifiedType: null, confidence: "0.000" }));

      expect(
        screen.getByText(/Nothing could identify this document/),
      ).toBeInTheDocument();
    });

    it("doesn't name a slot before one is picked", async () => {
      renderRow(doc({ aiClassifiedType: null, confidence: "0.000" }));

      // Was rendering "filing it as ." — an empty <b> read as a typo
      // and undercut the warning carrying it.
      expect(screen.queryByText(/filing it as\s*\./)).toBeNull();
      expect(
        screen.getByText(/no suggestion here is standing behind the choice/),
      ).toBeInTheDocument();
      // And "anyway" means nothing when there is nothing to confirm.
      expect(screen.getByRole("button", { name: "Confirm" })).toBeDisabled();

      await userEvent.click(
        screen.getByRole("combobox", { name: "Checklist slot" }),
      );
      await userEvent.click(
        screen.getByRole("option", { name: "Photo ID proof" }),
      );

      expect(screen.getByText(/before filing it as/)).toHaveTextContent(
        "Photo ID proof",
      );
      expect(
        screen.getByRole("button", { name: "Confirm anyway" }),
      ).toBeEnabled();
    });

    it("names what it was read as when the desk picks something else", async () => {
      renderRow(doc());

      await userEvent.click(
        screen.getByRole("combobox", { name: "Checklist slot" }),
      );
      await userEvent.click(
        screen.getByRole("option", { name: "Photo ID proof" }),
      );

      const warning = screen.getByText(/goes against that/);
      expect(warning).toHaveTextContent("Treating doctor's note");
      expect(warning).toHaveTextContent("Photo ID proof");
    });

    it("makes the override its own word, and still allows it", async () => {
      const onConfirm = vi.fn();
      render(
        <UploadRow
          doc={doc({ aiClassifiedType: null })}
          claim={CLAIM}
          onConfirm={onConfirm}
          onDiscard={vi.fn()}
          isBusy={false}
        />,
      );

      await userEvent.click(
        screen.getByRole("combobox", { name: "Checklist slot" }),
      );
      await userEvent.click(
        screen.getByRole("option", { name: "Photo ID proof" }),
      );

      const confirm = screen.getByRole("button", { name: "Confirm anyway" });
      await userEvent.click(confirm);
      expect(onConfirm).toHaveBeenCalledWith("Photo ID proof");
    });

    /**
     * A classification is an answer to "which of these slots", and the
     * list moves underneath it. estimate_sheet.png was read on the 4th
     * against six slots and correctly refused them all; on the 5th the
     * claim gained "Cost estimate". The stored refusal then described a
     * checklist that no longer existed — while the right slot sat in
     * the dropdown directly below the warning saying nothing fitted.
     */
    it("says a refusal predates slots the claim has gained since", () => {
      render(
        <UploadRow
          doc={doc({ aiClassifiedType: null, confidence: "0.000" })}
          claim={
            {
              ...CLAIM,
              checklistSnapshot: [
                ...CLAIM.checklistSnapshot,
                {
                  documentType: "Cost estimate",
                  required: true,
                  addedAt: "2026-11-06T00:00:00.000Z",
                },
              ],
            } as unknown as Claim
          }
          onConfirm={vi.fn()}
          onDiscard={vi.fn()}
          onReread={vi.fn()}
          isBusy={false}
        />,
      );

      expect(screen.getByText(/read before the claim had/)).toHaveTextContent(
        "Cost estimate",
      );
      // The stale notice replaces the refusal rather than sitting
      // beside it — two warnings disagreeing is worse than neither.
      expect(screen.queryByText(/Nothing could identify/)).toBeNull();
    });

    it("re-reads on request", async () => {
      const onReread = vi.fn();
      render(
        <UploadRow
          doc={doc({ aiClassifiedType: null })}
          claim={
            {
              ...CLAIM,
              checklistSnapshot: [
                {
                  documentType: "Cost estimate",
                  required: true,
                  addedAt: "2026-11-06T00:00:00.000Z",
                },
              ],
            } as unknown as Claim
          }
          onConfirm={vi.fn()}
          onDiscard={vi.fn()}
          onReread={onReread}
          isBusy={false}
        />,
      );

      await userEvent.click(screen.getByRole("button", { name: "Read again" }));
      expect(onReread).toHaveBeenCalled();
    });

    it("isn't stale when the checklist never changed", () => {
      // Original slots carry no addedAt at all, so the common case —
      // a claim whose checklist is the one it opened with — never
      // shows this.
      renderRow(doc({ aiClassifiedType: null }));

      expect(screen.queryByText(/read before the claim had/)).toBeNull();
    });

    it("keeps the disagreement on the record after filing", () => {
      renderRow(
        doc({
          confirmedAt: "2026-11-05T12:05:00.000Z",
          checklistSlot: "Photo ID proof",
        }),
      );

      // Six weeks later, this is the first thing worth knowing about
      // the document when a TPA queries it.
      expect(screen.getByText(/Read as/)).toHaveTextContent(
        "Treating doctor's note",
      );
    });

    it("says a document nobody read is the desk's own call, and offers the read", async () => {
      const onReread = vi.fn();
      render(
        <UploadRow
          doc={doc({
            aiClassifiedType: null,
            classifiedBy: null,
            classifiedAt: null,
          })}
          claim={CLAIM}
          onConfirm={vi.fn()}
          onDiscard={vi.fn()}
          onReread={onReread}
          isBusy={false}
        />,
      );

      // Offered straight away rather than only once a slot is picked:
      // a document nothing ever read is the one that most needs asking.
      expect(screen.getByText(/wasn't read automatically/)).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Read again" }));
      expect(onReread).toHaveBeenCalled();

      await userEvent.click(
        screen.getByRole("combobox", { name: "Checklist slot" }),
      );
      await userEvent.click(
        screen.getByRole("option", { name: "Photo ID proof" }),
      );

      // Not an override — nothing disagreed, nothing agreed either.
      expect(screen.getByRole("button", { name: "Confirm" })).toBeEnabled();
    });

    it("shows why a re-read failed instead of looking like it did nothing", () => {
      render(
        <UploadRow
          doc={doc({ aiClassifiedType: null, classifiedBy: null })}
          claim={CLAIM}
          onConfirm={vi.fn()}
          onDiscard={vi.fn()}
          onReread={vi.fn()}
          rereadError="couldn't read this document — pick a slot by hand"
          isBusy={false}
        />,
      );

      expect(
        screen.getByText(/couldn't read this document/),
      ).toBeInTheDocument();
    });
  });
});
