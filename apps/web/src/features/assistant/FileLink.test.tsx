import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FileLink, parseFileRef } from "./FileLink";
import { api } from "../../lib/api-client";

vi.mock("../../lib/api-client", () => ({ api: { get: vi.fn() } }));

describe("parseFileRef", () => {
  it("reads both of our schemes", () => {
    expect(parseFileRef("attachment:att-1")).toEqual({
      kind: "attachment",
      attachmentId: "att-1",
    });
    expect(parseFileRef("document:claim-1/doc-1")).toEqual({
      kind: "document",
      claimId: "claim-1",
      documentId: "doc-1",
    });
  });

  it("leaves ordinary links alone", () => {
    // Anything returning null stays an <a>, sanitised as before.
    expect(parseFileRef("https://example.com")).toBeNull();
    expect(parseFileRef("mailto:a@b.c")).toBeNull();
    expect(parseFileRef(undefined)).toBeNull();
  });

  it("refuses a half-written reference rather than building a broken URL", () => {
    expect(parseFileRef("document:claim-1")).toBeNull();
    expect(parseFileRef("attachment:")).toBeNull();
  });
});

describe("FileLink", () => {
  it("opens the file in the app, minting the URL on click", async () => {
    vi.mocked(api.get).mockResolvedValue({ downloadUrl: "https://s3/x" });
    render(
      <FileLink reference={{ kind: "attachment", attachmentId: "att-1" }}>
        IMG_0423.jpg
      </FileLink>,
    );

    // Pre-signed links are short-lived; minting one per filename would
    // spend them on the many nobody clicks.
    expect(api.get).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "IMG_0423.jpg" }));

    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith(
        "/assistant/attachments/att-1/download-url",
      ),
    );
    expect(
      await screen.findByRole("img", { name: "IMG_0423.jpg" }),
    ).toHaveAttribute("src", "https://s3/x");
  });

  it("uses the claim's own document route for a filed document", async () => {
    vi.mocked(api.get).mockResolvedValue({ downloadUrl: "https://s3/y" });
    render(
      <FileLink
        reference={{ kind: "document", claimId: "c1", documentId: "d1" }}
      >
        scan_0017.jpg
      </FileLink>,
    );

    await userEvent.click(
      screen.getByRole("button", { name: "scan_0017.jpg" }),
    );

    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith(
        "/claims/c1/documents/d1/download-url",
      ),
    );
  });

  it("says a discarded file is gone instead of showing an empty frame", async () => {
    vi.mocked(api.get).mockRejectedValue(new Error("404"));
    render(
      <FileLink reference={{ kind: "attachment", attachmentId: "att-1" }}>
        gone.jpg
      </FileLink>,
    );

    await userEvent.click(screen.getByRole("button", { name: "gone.jpg" }));

    // The model can name a document someone has since discarded.
    expect(
      await screen.findByText("That file isn't there any more."),
    ).toBeInTheDocument();
  });
});
