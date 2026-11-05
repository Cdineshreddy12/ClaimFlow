/**
 * Turning TPA queries back into checklist rules.
 *
 * Every query an insurer raises asking for a document is evidence that
 * the checklist was wrong: the insurer wanted something the rules
 * didn't require. docs/adr/0001 calls the checklist engine the hardest
 * and most-likely-to-be-subtly-wrong part of the build, and today it is
 * a desk head typing rules from memory. This is the correction loop —
 * see docs/adr/0016.
 *
 * The matching below is the delicate part. Requested items are free
 * text, written by a model reading an insurer's email, so "Copy of the
 * discharge summary", "discharge summaries" and "Discharge Summary" all
 * mean one slot. Over-matching invents agreement that isn't there;
 * under-matching proposes a duplicate rule next to one that already
 * exists. Both are tested.
 */

/** Words that carry no meaning in a document name and only break matches. */
const NOISE_WORDS = new Set([
  "a",
  "an",
  "the",
  "of",
  "for",
  "copy",
  "copies",
  "original",
  "originals",
  "attested",
  "signed",
  "stamped",
  "duly",
  "filled",
  "please",
  "provide",
  "kindly",
  "share",
  "send",
  "latest",
  "complete",
  "detailed",
  "report",
  "reports",
]);

/**
 * Reduces a document name to comparable tokens.
 *
 * `report` is noise on purpose: "ultrasound report" and "ultrasound"
 * are the same document, and insurers write both. The cost is that two
 * slots distinguished *only* by the word "report" would collide, which
 * no real checklist does.
 */
export function normaliseDocumentName(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((token) =>
      token.replace(/(ies|es|s)$/, (match, _o) => (match === "ies" ? "y" : "")),
    )
    .filter((token) => token.length > 1 && !NOISE_WORDS.has(token))
    .sort();
}

/** A stable key for grouping variants of the same requested item together. */
export function documentNameKey(value: string): string {
  return normaliseDocumentName(value).join(" ");
}

/**
 * Whether a requested item and a checklist slot are the same document.
 *
 * Matches when one name's meaningful tokens are a subset of the
 * other's: "discharge summary" matches "Discharge summary", and
 * "final itemised bill" matches "Itemised bill". It deliberately does
 * not match on a single shared token — "doctor's note" and "doctor's
 * registration" share one, and treating those as one slot would file a
 * document into the wrong gap.
 */
export function isSameDocument(left: string, right: string): boolean {
  const a = normaliseDocumentName(left);
  const b = normaliseDocumentName(right);
  if (a.length === 0 || b.length === 0) return false;

  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  const longerSet = new Set(longer);
  const overlap = shorter.filter((token) => longerSet.has(token));
  if (overlap.length !== shorter.length) return false;

  // A one-token name only matches another one-token name. Otherwise
  // "bill" would swallow "itemised bill" and "pharmacy bill" alike.
  return shorter.length > 1 || longer.length === 1;
}

export type ChecklistProposalAction = "add_required" | "make_required";

export interface ChecklistProposal {
  insurerId: string;
  insurerName: string;
  procedureId: string;
  procedureName: string;
  /** The checklist slot's own wording when one matched, else the insurer's. */
  documentType: string;
  /** Exactly what the insurer asked for, when it differs from the slot name. */
  requestedAs: string[];
  /** Claims where this insurer asked for it. */
  claimsRequested: number;
  /** Out of this many submitted claims for the pair. Always shown with the above. */
  claimsSubmitted: number;
  action: ChecklistProposalAction;
}

/** Submitted claims needed before a pattern is a pattern. */
export const MIN_PROPOSAL_CLAIMS = 3;
/** Share of submitted claims the item must have been asked for in. */
export const MIN_PROPOSAL_RATE = 1 / 3;

export function proposalIsWorthShowing(proposal: {
  claimsRequested: number;
  claimsSubmitted: number;
}): boolean {
  if (proposal.claimsSubmitted < MIN_PROPOSAL_CLAIMS) return false;
  return (
    proposal.claimsRequested / proposal.claimsSubmitted >= MIN_PROPOSAL_RATE
  );
}
