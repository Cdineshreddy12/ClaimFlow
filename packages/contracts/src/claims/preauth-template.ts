import { z } from "zod";

/**
 * How the printed pre-auth form looks.
 *
 * Not a preference for its own sake. A TPA desk sorts paper by shape
 * before it reads a word, and hospitals disagree about which shape
 * gets through fastest: some want the boxed, ruled grid their insurers
 * have processed for twenty years, some want a letterhead that looks
 * like the hospital rather than like a government form, and a hospital
 * whose checklist runs to forty fields wants the whole thing on one
 * sheet more than it wants either.
 *
 * Styling only. Every template prints the same fields, in the layout's
 * own order, with the same rule that an unconfirmed value is a blank
 * line and never a number (docs/adr/0005).
 */
export const PreauthTemplate = z.enum(["classic", "ruled", "compact"]);
export type PreauthTemplate = z.infer<typeof PreauthTemplate>;

export const PREAUTH_TEMPLATE_LABEL: Record<PreauthTemplate, string> = {
  classic: "Classic",
  ruled: "Ruled",
  compact: "Compact",
};

export const PREAUTH_TEMPLATE_BLURB: Record<PreauthTemplate, string> = {
  classic: "Typographic letterhead. Quiet rules, generous spacing.",
  ruled: "A boxed grid with banded headers — the shape TPAs expect.",
  compact: "Smaller type, tighter rows. For long forms that must fit a page.",
};

export const DEFAULT_PREAUTH_TEMPLATE: PreauthTemplate = "classic";

/**
 * The measurements a template actually changes.
 *
 * Kept as data rather than three drawing functions: the three differ in
 * weight and rhythm, not in what they print, and a fork would let them
 * drift until one quietly stopped showing a field.
 */
export interface PreauthTemplateStyle {
  /** Width of the label column, in points. */
  labelWidth: number;
  labelSize: number;
  valueSize: number;
  /** Leading for each, so a tighter template stays legible. */
  labelLeading: number;
  valueLeading: number;
  /** Space below each field row. */
  rowGap: number;
  /** A hairline under every row, so the eye tracks across the gutter. */
  rowRule: boolean;
  /** Section names on a tinted band rather than over a rule. */
  sectionBand: boolean;
  /** A box drawn around each section's rows. */
  sectionBox: boolean;
  /** Space between sections. */
  sectionGap: number;
  /** Letterhead name size — the compact form gives the page back to fields. */
  hospitalNameSize: number;
}

export const PREAUTH_TEMPLATE_STYLE: Record<
  PreauthTemplate,
  PreauthTemplateStyle
> = {
  classic: {
    labelWidth: 190,
    labelSize: 9,
    valueSize: 10,
    labelLeading: 10,
    valueLeading: 11,
    rowGap: 3,
    rowRule: false,
    sectionBand: false,
    sectionBox: false,
    sectionGap: 6,
    hospitalNameSize: 17,
  },
  ruled: {
    // Wider label column: boxed rows need the label to sit clear of the
    // cell edge, and a banded form reads worse when labels wrap.
    labelWidth: 205,
    labelSize: 9,
    valueSize: 10,
    labelLeading: 10,
    valueLeading: 11,
    rowGap: 5,
    rowRule: true,
    sectionBand: true,
    sectionBox: true,
    sectionGap: 6,
    hospitalNameSize: 16,
  },
  compact: {
    labelWidth: 170,
    labelSize: 8,
    valueSize: 9,
    labelLeading: 9,
    valueLeading: 10,
    rowGap: 4,
    rowRule: true,
    sectionBand: false,
    sectionBox: false,
    sectionGap: 5,
    hospitalNameSize: 14,
  },
};

export function preauthTemplateStyle(
  template: PreauthTemplate | null | undefined,
): PreauthTemplateStyle {
  return PREAUTH_TEMPLATE_STYLE[template ?? DEFAULT_PREAUTH_TEMPLATE];
}
