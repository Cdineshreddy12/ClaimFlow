import {
  DEFAULT_PREAUTH_DECLARATION,
  layoutPlacements,
  placementLabel,
  preauthOptions,
  preauthTemplateStyle,
  type PreauthOptions,
  type PreauthTemplate,
  type PreauthLayout,
  type PreauthPlacement,
} from "@claimflow/contracts";
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 48;
/** Kept clear between the two columns, so a wrapped label never touches its value. */
const LABEL_GUTTER = 12;
/**
 * What the declaration, signatures and footer note actually draw.
 *
 * Reserved as one block so the form never breaks between the
 * confirmation sentence and the signature line it belongs to. The old
 * figure was 90, which was less than the block draws — so it could
 * clear the check and then run off the bottom of the page. Measured
 * rather than guessed: 6 + 18 + 11 to the declaration line, 20 to the
 * signature rule, 12 for its caption, 34 and a line for the footer
 * note. 101 worst case, with the rest as headroom.
 */
const DECLARATION_H = 112;
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
  /** Which styling the hospital chose. Null is the classic form. */
  preauthTemplate?: PreauthTemplate | null;
  /** The rest of the form switches, as stored. Null reads as all-defaults. */
  preauthOptions?: PreauthOptions | unknown;
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

  const options = preauthOptions(hospital.preauthOptions);

  // The two faces pdf-lib embeds without shipping a font file. A desk
  // that has processed typed forms for twenty years reads a serif one
  // as more official, and hospitals ask for it.
  const serif = options.typeface === "serif";
  const bold = await doc.embedFont(
    serif ? StandardFonts.TimesRomanBold : StandardFonts.HelveticaBold,
  );
  const regular = await doc.embedFont(
    serif ? StandardFonts.TimesRoman : StandardFonts.Helvetica,
  );
  const ink = rgb(0.11, 0.106, 0.09);
  const faint = rgb(0.56, 0.56, 0.52);
  const rule = rgb(0.82, 0.82, 0.8);
  const accent = hexToColor(hospital.accentColorHex) ?? ink;

  const style = preauthTemplateStyle(hospital.preauthTemplate);
  // Tints derived rather than hard-coded, so a hospital's accent
  // carries into the bands instead of a grey that fights it.
  const band = rgb(0.937, 0.937, 0.925);
  const hairline = rgb(0.9, 0.9, 0.886);
  /*
    The writable column, inside the section box when there is one.

    `valueW` was measured to the page margin while the box was drawn
    ON that margin, so a wrapped line filled the column exactly and
    then crossed its own border — "Nausea ++," and "USG" printed over
    the right-hand rule. The pad is the same on both sides, so a label
    never touches the box either.
  */
  const BOX_PAD = style.sectionBox ? 7 : 0;
  const contentLeft = MARGIN + BOX_PAD;
  const contentRight = A4[0] - MARGIN - BOX_PAD;
  const valueX = MARGIN + style.labelWidth;
  const valueW = contentRight - valueX;

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
  const logoAbove = options.logoPlacement === "above";
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
    // Centred above the name suits a wide lockup, which squeezed the
    // address into a ribbon when forced into a column beside it.
    page.drawImage(embedded, {
      x: logoAbove ? (A4[0] - logoW) / 2 : MARGIN,
      y: topY - logoH,
      width: logoW,
      height: logoH,
    });
    if (logoAbove) y = topY - logoH - 14;
  }
  const textX = logoW > 0 && !logoAbove ? MARGIN + logoW + 14 : MARGIN;
  const textW = A4[0] - MARGIN - textX;

  const centre = (text: string, font: PDFFont, size: number) =>
    logoAbove && logoW > 0
      ? (A4[0] - font.widthOfTextAtSize(text, size)) / 2
      : textX;

  page.drawText(hospital.name, {
    x: centre(hospital.name, bold, style.hospitalNameSize),
    y,
    size: style.hospitalNameSize,
    font: bold,
    color: ink,
  });
  y -= style.hospitalNameSize - 2;
  if (hospital.tagline) {
    page.drawText(hospital.tagline, {
      x: centre(hospital.tagline, regular, 9),
      y,
      size: 9,
      font: regular,
      color: faint,
    });
    y -= 11;
  }
  for (const line of wrap(hospital.address, regular, 9, textW)) {
    page.drawText(line, {
      x: centre(line, regular, 9),
      y,
      size: 9,
      font: regular,
      color: faint,
    });
    y -= 11;
  }
  const ids = [
    hospital.rohiniId ? `ROHINI ID ${hospital.rohiniId}` : null,
    hospital.registrationNumber ? `Reg. ${hospital.registrationNumber}` : null,
  ].filter(Boolean);
  if (ids.length > 0) {
    page.drawText(ids.join("   ·   "), {
      x: centre(ids.join("   ·   "), regular, 9),
      y,
      size: 9,
      font: regular,
      color: faint,
    });
    y -= 11;
  }
  // The logo can be taller than the text block beside it (a square mark
  // next to a one-line address, say) — don't let the title overlap it.
  if (logoH > 0 && !logoAbove) y = Math.min(y, topY - logoH - 4);

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

    // How tall this section's rows are, measured before anything is
    // drawn: a banded or boxed template has to know where the box ends
    // before it draws the box, and a section that would be split across
    // a page break looks like two different forms.
    const rows = inSection.map(({ placement, text }) => {
      const money = placement.definition.fieldType === "currency";
      const labelLines = wrap(
        labelFor(placement),
        regular,
        style.labelSize,
        style.labelWidth - LABEL_GUTTER - BOX_PAD,
      );
      // Measured in the font it is DRAWN in. Values print bold, and
      // bold Helvetica is wider than regular — so a line measured
      // against the regular face fitted the column by the ruler and
      // then overran it on the page, crossing the section box's own
      // border.
      const valueLines = text
        ? wrap(text, bold, style.valueSize, valueW)
        : [""];
      return {
        money,
        labelLines,
        valueLines,
        text,
        height: Math.max(
          labelLines.length * style.labelLeading,
          valueLines.length * style.valueLeading,
        ),
      };
    });

    const headerH = style.sectionBand ? 18 : 14;
    ensureRoom(headerH + rows[0]!.height + style.rowGap + 8);

    if (style.sectionBand) {
      // The band is the whole point of the ruled template: a TPA sorts
      // a form by its shape before reading a word of it.
      page.drawRectangle({
        x: MARGIN,
        y: y - 5,
        width: A4[0] - MARGIN * 2,
        height: 16,
        color: band,
      });
      page.drawText(sectionName.toUpperCase(), {
        x: MARGIN + 6,
        y,
        size: style.labelSize,
        font: bold,
        color: options.accentHeadings ? accent : ink,
      });
      y -= headerH;
    } else {
      page.drawText(sectionName.toUpperCase(), {
        x: MARGIN,
        y,
        size: style.labelSize,
        font: bold,
        color: options.accentHeadings ? accent : faint,
      });
      y -= headerH;
    }

    const sectionTop = y + style.labelLeading;
    // Where the last row's content actually ends, so a boxed section
    // closes against its own last line instead of trailing a band of
    // empty box under the total.
    let sectionBottom = y;

    // A run of amounts ending in one more amount is a total — that is
    // what the last line of a cost table is, whatever the hospital
    // named the field. Structural rather than keyed on `totalExpectedCost`,
    // because the form is configurable and that field can be renamed or
    // removed.
    const moneyRows = rows.filter((r) => r.money).length;
    const totalIndex =
      moneyRows >= 3 && rows[rows.length - 1]?.money ? rows.length - 1 : -1;

    for (const [index, row] of rows.entries()) {
      const isTotal = index === totalIndex;
      ensureRoom(row.height + style.rowGap + 4);

      if (isTotal) {
        // A rule above it, the way every bill ever printed does it.
        y -= 4;
        page.drawLine({
          start: { x: valueX, y: y + style.valueSize },
          end: {
            x: contentRight,
            y: y + style.valueSize,
          },
          thickness: 0.8,
          color: rule,
        });
        y -= 2;
      }

      let ly = y;
      for (const line of row.labelLines) {
        page.drawText(line, {
          x: contentLeft,
          y: ly,
          size: style.labelSize,
          font: regular,
          color: faint,
        });
        ly -= style.labelLeading;
      }

      if (row.text) {
        let vy = y;
        for (const line of row.valueLines) {
          // Money right-aligns against the page edge, so a column of
          // amounts can be read down and added up — which is the first
          // thing anyone does with an estimate.
          const size = isTotal ? style.valueSize + 1 : style.valueSize;
          const w = bold.widthOfTextAtSize(line, size);
          const x = row.money ? contentRight - w : valueX;
          page.drawText(line, {
            x,
            y: vy,
            size: isTotal ? style.valueSize + 1 : style.valueSize,
            font: bold,
            color: isTotal ? accent : ink,
          });
          vy -= style.valueLeading;
        }
      } else {
        // Nothing confirmed: print a rule so the form can be finished
        // by hand rather than silently claiming the field is empty.
        page.drawLine({
          start: { x: valueX, y: y - 2 },
          end: { x: contentRight, y: y - 2 },
          thickness: 0.5,
          color: rule,
        });
      }

      const lastRow = index === rows.length - 1;

      if (style.rowRule) {
        /*
          Placed against the row it closes, not the gap below it.

          `y` here is the FIRST baseline of the row; the last one is
          however many lines down the taller column ran. Measuring from
          the post-decrement `y` put the rule between the next row's
          baseline and its cap height — straight through the following
          label, which looked like every field had been struck out.
        */
        const lastBaseline = Math.min(
          y - (row.labelLines.length - 1) * style.labelLeading,
          y - (row.valueLines.length - 1) * style.valueLeading,
        );
        sectionBottom = lastBaseline - 5;
        // The box's own bottom edge closes the last row. Drawing the
        // hairline there too prints two lines a point apart.
        if (!lastRow || !style.sectionBox) {
          page.drawLine({
            start: { x: MARGIN, y: sectionBottom },
            end: { x: A4[0] - MARGIN, y: sectionBottom },
            thickness: 0.4,
            color: hairline,
          });
        }
      } else {
        sectionBottom =
          Math.min(
            y - (row.labelLines.length - 1) * style.labelLeading,
            y - (row.valueLines.length - 1) * style.valueLeading,
          ) - 5;
      }

      y -= row.height + style.rowGap;
    }

    if (style.sectionBox) {
      page.drawRectangle({
        x: MARGIN,
        y: sectionBottom,
        width: A4[0] - MARGIN * 2,
        height: sectionTop - sectionBottom,
        borderWidth: 0.6,
        borderColor: rule,
      });
    }

    y -= style.sectionGap;
  }

  // --- declaration ------------------------------------------------------
  ensureRoom(DECLARATION_H);
  y -= 6;
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: A4[0] - MARGIN, y },
    thickness: 1,
    color: rule,
  });
  y -= 18;
  for (const line of wrap(
    options.declaration || DEFAULT_PREAUTH_DECLARATION,
    regular,
    9,
    A4[0] - MARGIN * 2,
  )) {
    page.drawText(line, { x: MARGIN, y, size: 9, font: regular, color: faint });
    y -= 11;
  }
  y -= 20;
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

  // Many hospitals need the patient or attendant on the same sheet. A
  // form with no space for it gets signed in the margin.
  if (options.patientSignature) {
    ensureRoom(40);
    y -= 34;
    page.drawText("Patient / attendant signature", {
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
  }

  // Bank details, a closing line — whatever the hospital wants on every
  // form without retyping it. Flows after the signature block rather
  // than pinned to the page bottom like the contact line below, since
  // free text has no fixed length to reserve room for.
  if (hospital.footerNote) {
    ensureRoom(34);
    // Clear of the signature caption, which hangs 12pt below the rule
    // without moving `y` — at 24 the note read as part of it.
    y -= 34;
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

  // Stamped at the end, when the page count is finally known — and on
  // every page, unlike the contact line above, which belongs with the
  // signatures. A long form runs to two sheets and a TPA desk that
  // receives them loose has no way to tell which is which.
  if (options.pageNumbers) {
    const pages = doc.getPages();
    pages.forEach((p, i) => {
      const text = `Page ${i + 1} of ${pages.length}`;
      p.drawText(text, {
        x: A4[0] - MARGIN - regular.widthOfTextAtSize(text, 7.5),
        y: MARGIN - 16,
        size: 7.5,
        font: regular,
        color: faint,
      });
    });
  }

  return doc.save();
}

/** The layout's label, plus the field's own wording where it has a hint. */
function labelFor(placement: PreauthPlacement): string {
  const label = placementLabel(placement);
  const hint = placement.definition.hint;
  return hint ? `${label} (${hint})` : label;
}
