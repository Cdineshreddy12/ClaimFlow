import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export interface PacketDocument {
  /** Checklist slot this document was confirmed into — the section heading in the packet. */
  slot: string;
  fileName: string;
  bytes: Uint8Array;
}

export interface PacketCover {
  hospitalName: string;
  hospitalAddress: string;
  rohiniId: string | null;
  insurerName: string;
  patientName: string;
  procedureName: string;
  claimId: string;
  billedAmount: string | null;
  generatedAt: Date;
}

export interface BuildPacketResult {
  bytes: Uint8Array;
  /** Documents that couldn't be embedded, with the reason — surfaced rather than silently dropped. */
  skipped: { fileName: string; reason: string }[];
}

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 56;

function isPdf(bytes: Uint8Array): boolean {
  // %PDF magic number. Extension-sniffing lies; the bytes don't.
  return (
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46
  );
}

function isPng(bytes: Uint8Array): boolean {
  return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e;
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes[0] === 0xff && bytes[1] === 0xd8;
}

/**
 * Merges a claim's confirmed documents into one PDF a desk can send to a
 * TPA, behind a cover sheet identifying the hospital and claim.
 *
 * Sources are a mix: scanned notes arrive as JPEG/PNG, forms as PDF. Type
 * is decided by magic number rather than file extension, because an
 * uploaded ".pdf" that is really a JPEG would otherwise blow up mid-merge.
 *
 * Anything unembeddable is reported in `skipped` instead of being dropped
 * silently — a packet that is quietly missing a document is worse than no
 * packet, since the whole point is proving nothing is missing.
 */
export async function buildPacket(
  cover: PacketCover,
  documents: PacketDocument[],
): Promise<BuildPacketResult> {
  const packet = await PDFDocument.create();
  packet.setTitle(`Claim packet — ${cover.patientName}`);
  packet.setProducer("ClaimFlow");
  packet.setCreationDate(cover.generatedAt);

  const skipped: BuildPacketResult["skipped"] = [];

  const bold = await packet.embedFont(StandardFonts.HelveticaBold);
  const regular = await packet.embedFont(StandardFonts.Helvetica);
  const ink = rgb(0.11, 0.106, 0.09);
  const faint = rgb(0.56, 0.56, 0.52);

  // --- cover sheet ---
  const page = packet.addPage(A4);
  let y = A4[1] - MARGIN;

  page.drawText(cover.hospitalName, {
    x: MARGIN,
    y,
    size: 18,
    font: bold,
    color: ink,
  });
  y -= 18;
  page.drawText(cover.hospitalAddress, {
    x: MARGIN,
    y,
    size: 9,
    font: regular,
    color: faint,
  });
  if (cover.rohiniId) {
    y -= 12;
    page.drawText(`ROHINI ID ${cover.rohiniId}`, {
      x: MARGIN,
      y,
      size: 9,
      font: regular,
      color: faint,
    });
  }

  y -= 28;
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: A4[0] - MARGIN, y },
    thickness: 1,
    color: faint,
  });
  y -= 30;

  page.drawText("Cashless claim document packet", {
    x: MARGIN,
    y,
    size: 13,
    font: bold,
    color: ink,
  });
  y -= 26;

  const rows: [string, string][] = [
    ["Patient", cover.patientName],
    ["Procedure", cover.procedureName],
    ["Insurer / TPA", cover.insurerName],
    ["Claim reference", cover.claimId],
    ["Billed amount", cover.billedAmount ? `INR ${cover.billedAmount}` : "—"],
    [
      "Generated",
      cover.generatedAt.toISOString().replace("T", " ").slice(0, 16),
    ],
  ];
  for (const [label, value] of rows) {
    page.drawText(label, {
      x: MARGIN,
      y,
      size: 9,
      font: regular,
      color: faint,
    });
    page.drawText(value, {
      x: MARGIN + 130,
      y,
      size: 10,
      font: bold,
      color: ink,
    });
    y -= 19;
  }

  y -= 16;
  page.drawText("Enclosed documents", {
    x: MARGIN,
    y,
    size: 11,
    font: bold,
    color: ink,
  });
  y -= 18;
  if (documents.length === 0) {
    page.drawText("None", {
      x: MARGIN,
      y,
      size: 10,
      font: regular,
      color: faint,
    });
  }
  documents.forEach((doc, i) => {
    page.drawText(`${i + 1}.  ${doc.slot}`, {
      x: MARGIN,
      y,
      size: 10,
      font: regular,
      color: ink,
    });
    y -= 16;
  });

  // --- one section per document ---
  for (const doc of documents) {
    try {
      if (isPdf(doc.bytes)) {
        const source = await PDFDocument.load(doc.bytes, {
          ignoreEncryption: true,
        });
        const copied = await packet.copyPages(source, source.getPageIndices());
        for (const p of copied) packet.addPage(p);
        continue;
      }

      if (isPng(doc.bytes) || isJpeg(doc.bytes)) {
        const image = isPng(doc.bytes)
          ? await packet.embedPng(doc.bytes)
          : await packet.embedJpg(doc.bytes);

        const imagePage = packet.addPage(A4);
        const maxWidth = A4[0] - MARGIN * 2;
        const maxHeight = A4[1] - MARGIN * 2 - 24;
        // Fit inside the margins without distorting the scan — a
        // stretched doctor's note can be unreadable.
        const scale = Math.min(
          maxWidth / image.width,
          maxHeight / image.height,
          1,
        );
        const w = image.width * scale;
        const h = image.height * scale;

        imagePage.drawText(doc.slot, {
          x: MARGIN,
          y: A4[1] - MARGIN + 6,
          size: 9,
          font: bold,
          color: faint,
        });
        imagePage.drawImage(image, {
          x: (A4[0] - w) / 2,
          y: (A4[1] - h) / 2 - 12,
          width: w,
          height: h,
        });
        continue;
      }

      skipped.push({
        fileName: doc.fileName,
        reason: "not a PDF, PNG or JPEG",
      });
    } catch (err) {
      skipped.push({
        fileName: doc.fileName,
        reason: err instanceof Error ? err.message : "could not be embedded",
      });
    }
  }

  return { bytes: await packet.save(), skipped };
}
