import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FilePreview } from "./FilePreview";
import { api } from "@/lib/api-client";

vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn() } }));

describe("FilePreview", () => {
  it("shows an image inline", async () => {
    vi.mocked(api.get).mockResolvedValue({ downloadUrl: "https://s3/scan" });
    render(
      <FilePreview
        target={{
          fileName: "scan_0017.jpg",
          contentType: "image/jpeg",
          downloadPath: "/x/download-url",
        }}
        onClose={vi.fn()}
      />,
    );

    expect(
      await screen.findByRole("img", { name: "scan_0017.jpg" }),
    ).toHaveAttribute("src", "https://s3/scan");
    // A new tab is still where you zoom, rotate and print.
    expect(
      screen.getByRole("link", { name: "Open in a new tab" }),
    ).toHaveAttribute("href", "https://s3/scan");
  });

  it("falls back to the extension when no content type was recorded", async () => {
    vi.mocked(api.get).mockResolvedValue({ downloadUrl: "https://s3/f" });
    render(
      <FilePreview
        target={{ fileName: "report.PDF", downloadPath: "/x/download-url" }}
        onClose={vi.fn()}
      />,
    );

    // Claim documents carry no content type — only a storage key.
    expect(await screen.findByTitle("report.PDF")).toBeInTheDocument();
  });

  it("says plainly when a file can't be shown rather than framing nothing", async () => {
    vi.mocked(api.get).mockResolvedValue({ downloadUrl: "https://s3/t" });
    render(
      <FilePreview
        target={{ fileName: "notes.txt", downloadPath: "/x/download-url" }}
        onClose={vi.fn()}
      />,
    );

    expect(await screen.findByText(/can't be shown here/)).toBeInTheDocument();
  });

  it("fetches nothing until there is something to show", () => {
    render(<FilePreview target={null} onClose={vi.fn()} />);
    expect(api.get).not.toHaveBeenCalled();
  });
});
