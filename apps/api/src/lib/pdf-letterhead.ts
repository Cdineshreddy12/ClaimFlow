import { rgb, type PDFDocument, type PDFFont, type PDFPage } from "pdf-lib";
import type { PreauthLogoPlacement } from "@claimflow/contracts";

/**
 * The hospital's letterhead, drawn the same way on every document it
 * sends.
 *
 * It lived inside the pre-auth form builder, so the period report —
 * the other thing a hospital forwards to someone outside the building
 * — had its own stripped-down version with no logo, no tagline and no
 * accent. A desk head who had set all of that saw it on one PDF and
 * not the other, which reads as the branding being broken rather than
 * as two builders having been written a month apart.
 *
 * Shared rather than copied for the obvious reason: the next option
 * added to one would otherwise be missing from the other again.
 */

export interface LetterheadBrand {
  name: string;
  address: string;
  tagline?: string | null | undefined;
  /** Already formatted — "ROHINI ID 89012…", "Reg. MH-2019-001". */
  ids: string[];
  /** Fetched by the caller; only the two formats pdf-lib can embed. */
  logo?:
    | { bytes: Uint8Array; contentType: "image/png" | "image/jpeg" }
    | null
    | undefined;
  logoPlacement?: PreauthLogoPlacement | undefined;
}

export interface LetterheadFonts {
  bold: PDFFont;
  regular: PDFFont;
  nameSize: number;
}

const LOGO_MAX_W = 130;
const LOGO_MAX_H = 46;

/** pdf-lib has no wrapping, so lines are measured and broken by hand. */
export function wrapText(
  text: string,
  font: PDFFont,
  size: number,
  width: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) > width && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.length > 0 ? lines : [""];
}

/**
 * Draws the letterhead and returns the y to carry on from.
 *
 * The logo sits left of the name/address block by default rather than
 * above it — a document that opens with a blank strip of logo-sized
 * whitespace above the hospital's name reads as unfinished, not
 * branded. "above" is for a wide lockup, which squeezed the address
 * into a ribbon when forced into a column beside it.
 */
export async function drawLetterhead(
  doc: PDFDocument,
  page: PDFPage,
  brand: LetterheadBrand,
  fonts: LetterheadFonts,
  geometry: { margin: number; pageWidth: number; top: number },
): Promise<number> {
  const { margin, pageWidth, top } = geometry;
  const { bold, regular, nameSize } = fonts;
  const faint = rgb(0.56, 0.56, 0.52);
  const ink = rgb(0.11, 0.106, 0.09);
  const above = brand.logoPlacement === "above";

  let y = top;
  let logoW = 0;
  let logoH = 0;

  if (brand.logo) {
    const embedded =
      brand.logo.contentType === "image/png"
        ? await doc.embedPng(brand.logo.bytes)
        : await doc.embedJpg(brand.logo.bytes);
    const scale = Math.min(
      LOGO_MAX_W / embedded.width,
      LOGO_MAX_H / embedded.height,
      1,
    );
    logoW = embedded.width * scale;
    logoH = embedded.height * scale;
    page.drawImage(embedded, {
      x: above ? (pageWidth - logoW) / 2 : margin,
      y: top - logoH,
      width: logoW,
      height: logoH,
    });
    if (above) y = top - logoH - 14;
  }

  const textX = logoW > 0 && !above ? margin + logoW + 14 : margin;
  const textW = pageWidth - margin - textX;
  const centre = (text: string, font: PDFFont, size: number) =>
    above && logoW > 0
      ? (pageWidth - font.widthOfTextAtSize(text, size)) / 2
      : textX;

  page.drawText(brand.name, {
    x: centre(brand.name, bold, nameSize),
    y,
    size: nameSize,
    font: bold,
    color: ink,
  });
  y -= nameSize - 2;

  if (brand.tagline) {
    page.drawText(brand.tagline, {
      x: centre(brand.tagline, regular, 9),
      y,
      size: 9,
      font: regular,
      color: faint,
    });
    y -= 11;
  }

  for (const line of wrapText(brand.address, regular, 9, textW)) {
    page.drawText(line, {
      x: centre(line, regular, 9),
      y,
      size: 9,
      font: regular,
      color: faint,
    });
    y -= 11;
  }

  if (brand.ids.length > 0) {
    const joined = brand.ids.join("   ·   ");
    page.drawText(joined, {
      x: centre(joined, regular, 9),
      y,
      size: 9,
      font: regular,
      color: faint,
    });
    y -= 11;
  }

  // A square mark beside a one-line address is taller than the text
  // block next to it — don't let whatever comes next overlap it.
  if (logoH > 0 && !above) y = Math.min(y, top - logoH - 4);

  return y;
}

/**
 * The hospital's logo bytes, or null.
 *
 * Never fatal: a logo that's briefly unreachable in S3 must not stop a
 * desk from printing a document they need right now — it prints
 * without the mark that time.
 *
 * The upload endpoint accepts only PNG and JPEG and the key keeps the
 * original extension, so the key alone says which a given logo is
 * without a content-type column to keep in sync.
 */
export async function fetchLogo(
  logoFileKey: string | null | undefined,
  readBytes: (key: string) => Promise<Uint8Array>,
): Promise<LetterheadBrand["logo"]> {
  if (!logoFileKey) return null;
  return readBytes(logoFileKey)
    .then((bytes) => ({
      bytes,
      contentType: logoFileKey.toLowerCase().endsWith(".png")
        ? ("image/png" as const)
        : ("image/jpeg" as const),
    }))
    .catch(() => null);
}
