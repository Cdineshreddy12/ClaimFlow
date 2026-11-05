import {
  layoutPlacements,
  placementLabel,
  type PreauthLayout,
  type PreauthPlacement,
} from "@claimflow/contracts";
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 48;
const LABEL_W = 190;
const LOGO_MAX_W = 130;
const LOGO_MAX_H = 46;

/** "#RRGGBB" → pdf-lib's rgb(), or null for anything that doesn't parse — a bad value prints as the default ink rather than throwing. */
function hexToColor(hex: string | null | undefined) {
  const match = hex ? /^#?([0-9a-fA-F]{6})$/.exec(hex.trim()) : null;
  if (!match?.[1]) return null;
  const n = parseInt(match[1], 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

export interface PreauthFormHospital {
  name: string;
  address: string;
  rohiniId: string | null;
  registrationNumber: string | null;
  deskContactName: string | null;
  deskContactPhone: string | null;
  /** Printed under the hospital name, where a logo alone doesn't say enough. */
  tagline?: string | null;
  /** Free text under the declaration — bank details, a closing note. */
  footerNote?: string | null;
  /** "#RRGGBB" — colors the form's title. Falls back to plain ink when unset or unparsable. */
  accentColorHex?: string | null;
  /** The letterhead logo, already fetched. Only PNG/JPEG — the two formats pdf-lib can embed. */
  logo?: { bytes: Uint8Array; contentType: "image/png" | "image/jpeg" } | null;
}

export interface PreauthFormClaim {
  reference: string;
  patientName: string;
  insurerName: string;
  procedureName: string;
}

export interface PreauthFormValue {
  fieldKey: string;
  /** Rendered text. Null prints as a rule to write on. */
  display: string | null;
  /**
   * The stored value, before formatting. Conditional fields are keyed
   * off enum *keys* — matching on the display label silently hid the
   * surgery fields on a surgical claim, because "Surgical management"
   * is not "surgical_management".
   */
  raw: string | null;
  confirmed: boolean;
}

/**
 * Which fields the printed form shows, in order, and what each prints.
 *
 * Pulled out of the drawing code so it can be tested as a decision
 * rather than by reading bytes back out of a PDF. The rules it encodes
 * are the ones that matter: conditional fields key off the raw enum
 * value, and an unconfirmed suggestion prints as a blank rule.
 */
export function formLines(
  layout: PreauthLayout,
  values: PreauthFormValue[],
): { section: string; placement: PreauthPlacement; text: string }[] {
  const byKey = new Map(values.map((v) => [v.fieldKey, v]));
  const confirmedRaw = Object.fromEntries(
    values.filter((v) => v.confirmed).map((v) => [v.fieldKey, v.raw]),
  );

  const sectionOf = new Map<string, string>();
  for (const section of layout.sections) {
    for (const placement of section.placements) {
      sectionOf.set(placement.id, section.name);
    }
  }

  return layoutPlacements(layout)
    .filter((placement) => {
      // Conditional fields key off the raw stored value, never the
      // display label — "Surgical management" is not
      // "surgical_management", and matching the label silently hid the
      // surgery fields on exactly the claims that needed them.
      const condition = placement.definition.conditionalOn;
      if (!condition) return true;
      const current = confirmedRaw[condition.fieldKey];
      if (!current) return true;
      return current === condition.equals;
    })
    .map((placement) => {
      const entry = byKey.get(placement.definition.fieldKey);
      return {
        section: sectionOf.get(placement.id) ?? "",
        placement,
        text: entry?.confirmed ? (entry.display ?? "") : "",
      };
    });
}

/**
 * The filled pre-auth form, as a page a desk can print and fax.
 *
 * This is the claim form itself, not the document bundle — the packet
 * builder next door merges the *attachments*. A TPA wants both: the
 * form stating what is being asked for, and the evidence behind it.
 *
 * Unconfirmed values are deliberately not printed. The whole point of
 * docs/adr/0005 is that a suggestion isn't a value until a human says
 * so, and a PDF that leaves the hospital is the least reversible place
 * for an unchecked figure to appear. Blanks print as a rule instead,
 * so the form stays usable as something to complete by hand.
 */
export async function buildPreauthForm(
  hospital: PreauthFormHospital,
  claim: PreauthFormClaim,
  layout: PreauthLayout,
  values: PreauthFormValue[],
  generatedAt: Date,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Pre-authorisation — ${claim.patientName} (${claim.reference})`);
  doc.setProducer("ClaimFlow");
  doc.setCreationDate(generatedAt);

  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const ink = rgb(0.11, 0.106, 0.09);
  const faint = rgb(0.56, 0.56, 0.52);
  const rule = rgb(0.82, 0.82, 0.8);
  const accent = hexToColor(hospital.accentColorHex) ?? ink;

  const lines = formLines(layout, values);

  let page = doc.addPage(A4);
  let y = A4[1] - MARGIN;

  function ensureRoom(needed: number) {
    if (y - needed > MARGIN) return;
    page = doc.addPage(A4);
    y = A4[1] - MARGIN;
  }

  /** pdf-lib has no wrapping, so lines are measured and broken by hand. */
  function wrap(text: string, font: PDFFont, size: number, width: number) {
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

  // --- letterhead -------------------------------------------------------
  // The logo sits left of the name/address block rather than above it —
  // a form that opens with a blank strip of logo-sized whitespace above
  // the hospital's name reads as unfinished, not branded.
  const topY = y;
  let logoW = 0;
  let logoH = 0;
  if (hospital.logo) {
    const embedded =
      hospital.logo.contentType === "image/png"
        ? await doc.embedPng(hospital.logo.bytes)
        : await doc.embedJpg(hospital.logo.bytes);
    const scale = Math.min(
      LOGO_MAX_W / embedded.width,
      LOGO_MAX_H / embedded.height,
      1,
    );
    logoW = embedded.width * scale;
    logoH = embedded.height * scale;
    page.drawImage(embedded, {
      x: MARGIN,
      y: topY - logoH,
      width: logoW,
      height: logoH,
    });
  }
  const textX = logoW > 0 ? MARGIN + logoW + 14 : MARGIN;
  const textW = A4[0] - MARGIN - textX;

  page.drawText(hospital.name, {
    x: textX,
    y,
    size: 17,
    font: bold,
    color: ink,
  });
  y -= 15;
  if (hospital.tagline) {
    page.drawText(hospital.tagline, {
      x: textX,
      y,
      size: 9,
      font: regular,
      color: faint,
    });
    y -= 11;
  }
  for (const line of wrap(hospital.address, regular, 9, textW)) {
    page.drawText(line, { x: textX, y, size: 9, font: regular, color: faint });
    y -= 11;
  }
  const ids = [
    hospital.rohiniId ? `ROHINI ID ${hospital.rohiniId}` : null,
    hospital.registrationNumber ? `Reg. ${hospital.registrationNumber}` : null,
  ].filter(Boolean);
  if (ids.length > 0) {
    page.drawText(ids.join("   ·   "), {
      x: textX,
      y,
      size: 9,
      font: regular,
      color: faint,
    });
    y -= 11;
  }
  // The logo can be taller than the text block beside it (a square mark
  // next to a one-line address, say) — don't let the title overlap it.
  if (logoH > 0) y = Math.min(y, topY - logoH - 4);

  y -= 12;
  page.drawText("REQUEST FOR CASHLESS HOSPITALISATION", {
    x: MARGIN,
    y,
    size: 12,
    font: bold,
    color: accent,
  });
  y -= 13;
  page.drawText(
    `${claim.reference}   ·   ${claim.patientName}   ·   ${claim.procedureName}   ·   ${claim.insurerName}`,
    { x: MARGIN, y, size: 9, font: regular, color: faint },
  );
  y -= 14;
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: A4[0] - MARGIN, y },
    thickness: 1,
    color: rule,
  });
  y -= 22;

  // --- the form, in the order the layout declares -----------------------
  const sectionNames = [...new Set(lines.map((l) => l.section))];
  for (const sectionName of sectionNames) {
    const inSection = lines.filter((l) => l.section === sectionName);
    if (inSection.length === 0) continue;

    ensureRoom(40);
    page.drawText(sectionName.toUpperCase(), {
      x: MARGIN,
      y,
      size: 9,
      font: bold,
      color: faint,
    });
    y -= 16;

    for (const { placement, text } of inSection) {
      const valueW = A4[0] - MARGIN * 2 - LABEL_W;
      const lines = text ? wrap(text, regular, 10, valueW) : [""];

      ensureRoom(lines.length * 13 + 8);

      page.drawText(labelFor(placement), {
        x: MARGIN,
        y,
        size: 9,
        font: regular,
        color: faint,
      });

      if (text) {
        let ly = y;
        for (const line of lines) {
          page.drawText(line, {
            x: MARGIN + LABEL_W,
            y: ly,
            size: 10,
            font: bold,
            color: ink,
          });
          ly -= 12;
        }
        y = ly - 4;
      } else {
        // Nothing confirmed: print a rule so the form can be finished
        // by hand rather than silently claiming the field is empty.
        page.drawLine({
          start: { x: MARGIN + LABEL_W, y: y - 2 },
          end: { x: A4[0] - MARGIN, y: y - 2 },
          thickness: 0.5,
          color: rule,
        });
        y -= 18;
      }
    }
    y -= 10;
  }

  // --- declaration ------------------------------------------------------
  ensureRoom(90);
  y -= 6;
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: A4[0] - MARGIN, y },
    thickness: 1,
    color: rule,
  });
  y -= 18;
  for (const line of wrap(
    "We confirm the particulars above are true and that the patient is under treatment at this hospital.",
    regular,
    9,
    A4[0] - MARGIN * 2,
  )) {
    page.drawText(line, { x: MARGIN, y, size: 9, font: regular, color: faint });
    y -= 11;
  }
  y -= 26;
  page.drawText("Treating doctor's signature", {
    x: MARGIN,
    y: y - 12,
    size: 8,
    font: regular,
    color: faint,
  });
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: MARGIN + 190, y },
    thickness: 0.5,
    color: rule,
  });
  page.drawText("Hospital seal", {
    x: A4[0] - MARGIN - 190,
    y: y - 12,
    size: 8,
    font: regular,
    color: faint,
  });
  page.drawLine({
    start: { x: A4[0] - MARGIN - 190, y },
    end: { x: A4[0] - MARGIN, y },
    thickness: 0.5,
    color: rule,
  });

  // Bank details, a closing line — whatever the hospital wants on every
  // form without retyping it. Flows after the signature block rather
  // than pinned to the page bottom like the contact line below, since
  // free text has no fixed length to reserve room for.
  if (hospital.footerNote) {
    ensureRoom(34);
    y -= 24;
    for (const line of wrap(
      hospital.footerNote,
      regular,
      8,
      A4[0] - MARGIN * 2,
    )) {
      ensureRoom(10);
      page.drawText(line, {
        x: MARGIN,
        y,
        size: 8,
        font: regular,
        color: faint,
      });
      y -= 10;
    }
  }

  // --- footer -----------------------------------------------------------
  const contact = hospital.deskContactName
    ? `Desk contact: ${hospital.deskContactName}${
        hospital.deskContactPhone ? ` · ${hospital.deskContactPhone}` : ""
      }`
    : "";
  page.drawText(
    `${contact}${contact ? "   ·   " : ""}Generated by ClaimFlow on ${generatedAt
      .toISOString()
      .slice(0, 10)}`,
    { x: MARGIN, y: MARGIN - 16, size: 7.5, font: regular, color: faint },
  );

  return doc.save();
}

/** The layout's label, plus the field's own wording where it has a hint. */
function labelFor(placement: PreauthPlacement): string {
  const label = placementLabel(placement);
  const hint = placement.definition.hint;
  return hint ? `${label} (${hint})` : label;
}
