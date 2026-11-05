import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AttachmentChip, type StagedFile } from "./AttachmentChip";
import type { AssistantAttachment } from "./types";
import { api } from "../../lib/api-client";

vi.mock("../../lib/api-client", () => ({
  api: { get: vi.fn() },
}));

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
    recognitionReason: "Names Rajendra Pawar, UHID 2026/18440.",
    ocrConfidence: "0.990",
    filedAt: null,
    dismissedAt: null,
    createdAt: "2026-11-05T12:00:00.000Z",
    suggestedClaim: {
      id: "claim-1",
      reference: "CLM-0001",
      patientName: "Rajendra Pawar",
      procedureName: "Gall bladder removal",
      checklistSlots: ["Treating doctor's note", "Photo ID proof"],
    },
    ...overrides,
  };
}

function staged(overrides: Partial<StagedFile> = {}): StagedFile {
  return {
    key: "k1",
    fileName: "IMG_0423.jpg",
    state: "done",
    attachment: attachment(),
    ...overrides,
  };
}

describe("AttachmentChip", () => {
  /**
   * The bug this component shipped with: every file read as "claim not
   * identified", including ones matched at 97%, because the upload
   * response was never decorated. These pin each state apart from the
   * others so the next version of that mistake has somewhere to fail.
   */
  describe("what each state says", () => {
    it("shows progress while the bytes are still moving", () => {
      render(
        <AttachmentChip
          file={staged({
            state: "uploading",
            progress: 0.42,
            attachment: undefined,
          })}
        />,
      );

      expect(screen.getByText("42%")).toBeInTheDocument();
      // Not a verdict yet — the recogniser hasn't run.
      expect(screen.queryByText(/No claim matched/)).not.toBeInTheDocument();
    });

    it("says it is reading once the upload lands", () => {
      render(
        <AttachmentChip
          file={staged({ state: "reading", attachment: undefined })}
        />,
      );

      expect(screen.getByText(/Reading the page/)).toBeInTheDocument();
      expect(screen.queryByText(/No claim matched/)).not.toBeInTheDocument();
    });

    it("names the claim it matched, with the confidence and the slot", () => {
      render(<AttachmentChip file={staged()} />);

      expect(screen.getByText("CLM-0001")).toBeInTheDocument();
      expect(screen.getByText(/Rajendra Pawar/)).toBeInTheDocument();
      expect(screen.getByText(/97%/)).toBeInTheDocument();
      expect(screen.getByText(/Treating doctor's note/)).toBeInTheDocument();
      // The exact regression: a matched file must never read as
      // unmatched.
      expect(screen.queryByText(/No claim matched/)).not.toBeInTheDocument();
    });

    it("says no claim matched only when there genuinely isn't one", () => {
      render(
        <AttachmentChip
          file={staged({
            attachment: attachment({
              suggestedClaim: null,
              suggestedClaimId: null,
              claimConfidence: null,
            }),
          })}
        />,
      );

      expect(screen.getByText(/No claim matched/)).toBeInTheDocument();
    });

    it("surfaces an upload failure on the file it belongs to", () => {
      render(
        <AttachmentChip
          file={staged({
            state: "failed",
            error: "Couldn't reach storage.",
            attachment: undefined,
          })}
        />,
      );

      expect(screen.getByText("Couldn't reach storage.")).toBeInTheDocument();
    });
  });

  describe("opening the file", () => {
    it("shows the scan in the app, minting the URL on click rather than on render", async () => {
      vi.mocked(api.get).mockResolvedValue({ downloadUrl: "https://s3/x" });
      render(<AttachmentChip file={staged()} />);

      // A URL minted for every chip would expire before most are used,
      // and most are never opened at all.
      expect(api.get).not.toHaveBeenCalled();

      await userEvent.click(
        screen.getByRole("button", { name: "IMG_0423.jpg" }),
      );

      await waitFor(() =>
        expect(api.get).toHaveBeenCalledWith(
          "/assistant/attachments/att-1/download-url",
        ),
      );
      // In a dialog over the panel, not a new tab: the filing decision
      // needs the page and what the assistant said about it together.
      const image = await screen.findByRole("img", { name: "IMG_0423.jpg" });
      expect(image).toHaveAttribute("src", "https://s3/x");
      expect(window.open).not.toHaveBeenCalled();
    });

    it("isn't clickable before there is anything to open", () => {
      render(
        <AttachmentChip
          file={staged({ state: "uploading", attachment: undefined })}
        />,
      );

      expect(
        screen.queryByRole("button", { name: "IMG_0423.jpg" }),
      ).not.toBeInTheDocument();
      expect(screen.getByText("IMG_0423.jpg")).toBeInTheDocument();
    });
  });

  it("can be taken out of the batch", async () => {
    const onRemove = vi.fn();
    render(<AttachmentChip file={staged()} onRemove={onRemove} />);

    await userEvent.click(
      screen.getByRole("button", { name: "Remove IMG_0423.jpg" }),
    );
    expect(onRemove).toHaveBeenCalled();
  });
});
