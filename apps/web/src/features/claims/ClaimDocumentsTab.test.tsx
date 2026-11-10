import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { ClaimDocumentsTab } from "./ClaimDocumentsTab";
import type { Claim, ClaimGaps } from "./types";
import { api } from "@/lib/api-client";

vi.mock("@/lib/api-client", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

const CLAIM = {
  id: "claim-1",
  checklistSnapshot: [
    { documentType: "Treating doctor's note", required: true },
    { documentType: "Photo ID proof", required: true },
  ],
} as unknown as Claim;

const GAPS = { missing: ["Photo ID proof"], satisfied: [] } as ClaimGaps;

const DOCUMENT = {
  id: "doc-1",
  claimId: "claim-1",
  fileUrl: "claims/claim-1/9c3dc451-da7a-4a0b-93c0-14740f813e43-scan_0017.jpg",
  aiClassifiedType: "Treating doctor's note",
  checklistSlot: null,
  confidence: "0.970",
  classifiedBy: "claude",
  classificationReason: "Names Rajendra Pawar.",
  classifiedAt: "2026-11-05T12:00:00.000Z",
  confirmedBy: null,
  confirmedAt: null,
  createdAt: "2026-11-05T12:00:00.000Z",
};

function renderTab() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ClaimDocumentsTab claim={CLAIM} gaps={GAPS} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.get).mockResolvedValue([DOCUMENT]);
  vi.mocked(api.patch).mockResolvedValue({ ...DOCUMENT });
});

/**
 * The brief asks for misfiled documents to be *dragged* to the right
 * slot, not merely re-filed somehow. dnd-kit's own pointer simulation
 * doesn't survive happy-dom, so this covers the parts that can be
 * asserted without a layout engine: that the gesture exists, that it
 * has a keyboard equivalent, and that the dropdown it supplements is
 * still there.
 */
describe("ClaimDocumentsTab", () => {
  it("gives every document a drag handle naming the file", async () => {
    renderTab();

    const grip = await screen.findByRole("button", {
      name: "Move scan_0017.jpg to a checklist slot",
    });
    // Focusable, which is what makes it reachable by keyboard at all —
    // dnd-kit's KeyboardSensor binds to the handle, so a pointer-only
    // gesture would leave this unusable without a mouse.
    expect(grip).toHaveAttribute("tabindex", "0");
    expect(grip).toHaveAttribute("aria-roledescription");
  });

  it("keeps the dropdown — drag is never the only way to file", async () => {
    renderTab();

    expect(
      await screen.findByRole("combobox", { name: "Checklist slot" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm" })).toBeInTheDocument();
  });

  it("files through the same confirm call the button uses", async () => {
    renderTab();

    // Whatever route a desk takes to say "this one goes there", the
    // write is identical: same endpoint, same audit entry, same gap
    // recount, same adr 0005 rule that a human placed it.
    await userEvent.click(
      await screen.findByRole("button", { name: "Confirm" }),
    );

    expect(api.patch).toHaveBeenCalledWith(
      "/claims/claim-1/documents/doc-1/confirm",
      { checklistSlot: "Treating doctor's note" },
    );
  });

  it("shows the gap view the documents are dragged onto", async () => {
    renderTab();

    // The drop targets are the slots, so they have to be on the same
    // screen as the files — which is the whole reason this tab exists
    // as one component.
    expect(await screen.findByText("Photo ID proof")).toBeInTheDocument();
    expect(screen.getByText("Treating doctor's note")).toBeInTheDocument();
  });

  /*
    A claim file is seven or eight documents, and the picker used to
    take one: the input had no `multiple` and the handler read
    `files[0]`, so choosing a stack silently uploaded the first and
    dropped the rest without saying so.
  */
  describe("uploading a stack", () => {
    const pdf = (name: string) =>
      new File(["%PDF-1.4"], name, { type: "application/pdf" });

    function pick(files: File[]) {
      const input = document.querySelector(
        'input[type="file"]',
      ) as HTMLInputElement;
      return userEvent.upload(input, files);
    }

    it("takes every file picked, not just the first", async () => {
      vi.mocked(api.post).mockResolvedValue({
        uploadUrl: "https://s3.test/put",
        key: "k",
      });
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({ ok: true } as Response),
      );
      renderTab();

      await pick([pdf("note.pdf"), pdf("cbc.pdf"), pdf("ecard.pdf")]);

      // Two posts per file: the pre-signed URL, then the row.
      await vi.waitFor(() => expect(api.post).toHaveBeenCalledTimes(6));
      for (const name of ["note.pdf", "cbc.pdf", "ecard.pdf"]) {
        expect(api.post).toHaveBeenCalledWith(
          "/claims/claim-1/documents/upload-url",
          expect.objectContaining({ fileName: name }),
        );
      }
    });

    it("keeps the good files when one of them is refused", async () => {
      vi.mocked(api.post).mockResolvedValue({
        uploadUrl: "https://s3.test/put",
        key: "k",
      });
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({ ok: true } as Response),
      );
      renderTab();

      const video = new File(["x"], "ward-round.mp4", { type: "video/mp4" });
      await pick([pdf("note.pdf"), video, pdf("cbc.pdf")]);

      // Named, with the reason — not "Upload failed — try again", which
      // on a batch says neither which file nor what to do about it.
      expect(await screen.findByText("ward-round.mp4")).toBeInTheDocument();
      expect(
        screen.getByText(/isn't a document type this accepts/),
      ).toBeInTheDocument();

      // And the two PDFs around it still went up: a batch that fails as
      // a unit would lose work the desk already did.
      expect(api.post).toHaveBeenCalledWith(
        "/claims/claim-1/documents/upload-url",
        expect.objectContaining({ fileName: "note.pdf" }),
      );
      expect(api.post).toHaveBeenCalledWith(
        "/claims/claim-1/documents/upload-url",
        expect.objectContaining({ fileName: "cbc.pdf" }),
      );
    });
  });
});
