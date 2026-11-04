import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { buildPacket, type PacketCover } from "./packet.builder.js";

const COVER: PacketCover = {
  hospitalName: "City General Hospital",
  hospitalAddress: "12 Station Road, Pune, Maharashtra, 411001",
  rohiniId: "8901234567890",
  insurerName: "Company B",
  patientName: "Rajendra Pawar",
  procedureName: "Gall bladder removal",
  claimId: "e4523b9c-a5b8-4ee3-94b1-6cfa6911dfcc",
  billedAmount: "185000.00",
  generatedAt: new Date("2026-11-04T10:00:00Z"),
};

/** A real 2-page PDF, built with the same library that has to read it back. */
async function makePdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([200, 200]);
  return doc.save();
}

/** Smallest valid 1x1 PNG. */
const PNG_1PX = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);

async function pageCount(bytes: Uint8Array): Promise<number> {
  return (await PDFDocument.load(bytes)).getPageCount();
}

describe("buildPacket", () => {
  it("produces a cover sheet even with no documents", async () => {
    const { bytes, skipped } = await buildPacket(COVER, []);
    expect(await pageCount(bytes)).toBe(1);
    expect(skipped).toEqual([]);
  });

  it("copies every page of a source PDF, not just the first", async () => {
    const { bytes, skipped } = await buildPacket(COVER, [
      {
        slot: "Pre-authorization form",
        fileName: "form.pdf",
        bytes: await makePdf(3),
      },
    ]);
    // 1 cover + 3 copied pages
    expect(await pageCount(bytes)).toBe(4);
    expect(skipped).toEqual([]);
  });

  it("embeds a scanned image as its own page", async () => {
    const { bytes, skipped } = await buildPacket(COVER, [
      { slot: "Treating doctor's note", fileName: "scan.png", bytes: PNG_1PX },
    ]);
    expect(await pageCount(bytes)).toBe(2);
    expect(skipped).toEqual([]);
  });

  it("merges PDFs and images together in the order given", async () => {
    const { bytes, skipped } = await buildPacket(COVER, [
      { slot: "Form", fileName: "a.pdf", bytes: await makePdf(2) },
      { slot: "Scan", fileName: "b.png", bytes: PNG_1PX },
      { slot: "Report", fileName: "c.pdf", bytes: await makePdf(1) },
    ]);
    expect(await pageCount(bytes)).toBe(1 + 2 + 1 + 1);
    expect(skipped).toEqual([]);
  });

  it("decides type by magic number, not file extension", async () => {
    // A PNG that someone uploaded named ".pdf" — extension-sniffing
    // would try to parse it as a PDF and throw.
    const { bytes, skipped } = await buildPacket(COVER, [
      { slot: "Mislabelled", fileName: "actually-a-png.pdf", bytes: PNG_1PX },
    ]);
    expect(await pageCount(bytes)).toBe(2);
    expect(skipped).toEqual([]);
  });

  it("reports an unembeddable file instead of dropping it silently", async () => {
    const { bytes, skipped } = await buildPacket(COVER, [
      { slot: "Good", fileName: "ok.png", bytes: PNG_1PX },
      {
        slot: "Bad",
        fileName: "notes.docx",
        bytes: Uint8Array.from([0x50, 0x4b, 0x03, 0x04]),
      },
    ]);
    // The good one still makes it in...
    expect(await pageCount(bytes)).toBe(2);
    // ...and the bad one is named, so the desk knows what's missing.
    expect(skipped).toEqual([
      { fileName: "notes.docx", reason: "not a PDF, PNG or JPEG" },
    ]);
  });

  it("reports a corrupt PDF rather than failing the whole packet", async () => {
    const corrupt = Uint8Array.from([
      0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x00, 0x01,
    ]);
    const { bytes, skipped } = await buildPacket(COVER, [
      { slot: "Broken", fileName: "corrupt.pdf", bytes: corrupt },
      { slot: "Good", fileName: "ok.png", bytes: PNG_1PX },
    ]);
    expect(await pageCount(bytes)).toBe(2);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]!.fileName).toBe("corrupt.pdf");
  });
});
