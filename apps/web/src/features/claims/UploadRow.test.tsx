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
});
