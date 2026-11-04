import type { DocumentClassification } from "@claimflow/contracts";
import type { ClassificationInput, DocumentClassifier } from "./types.js";

/**
 * Filename-based classifier. No credentials, no network, no model.
 *
 * This is not AI and never claims to be — it reports `classifiedBy:
 * "heuristic"` and the UI labels it "Matched by filename". It exists
 * because a desk uploading `ultrasound_report_0423.jpg` against a
 * checklist containing "Ultrasound report (abdomen)" should not have to
 * pick from a dropdown, and that much is solvable without a model.
 *
 * It is deliberately conservative: it only suggests when the overlap is
 * real, and returns null rather than guessing, because a confident wrong
 * suggestion costs more attention than no suggestion at all.
 */

/** Words that appear in almost every slot name and so carry no signal. */
const STOPWORDS = new Set([
  "the",
  "and",
  "of",
  "for",
  "copy",
  "form",
  "proof",
  "report",
  "records",
  "record",
]);

function tokenise(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, "") // drop the extension
    .split(/[^a-z]+/)
    .filter((t) => t.length > 2 && !/^\d+$/.test(t));
}

/** Tokens that actually distinguish one slot from another. */
function significantTokens(value: string): string[] {
  return tokenise(value).filter((t) => !STOPWORDS.has(t));
}

export class HeuristicClassifier implements DocumentClassifier {
  async classify(input: ClassificationInput): Promise<DocumentClassification> {
    const fileTokens = new Set(tokenise(input.fileName));

    let best: { slot: string; hits: string[]; score: number } | null = null;

    for (const slot of input.candidateSlots) {
      const slotTokens = significantTokens(slot);
      if (slotTokens.length === 0) continue;

      const hits = slotTokens.filter((t) => fileTokens.has(t));
      if (hits.length === 0) continue;

      // Share of the slot's distinguishing words present in the filename.
      const score = hits.length / slotTokens.length;
      if (!best || score > best.score) best = { slot, hits, score };
    }

    if (!best) {
      return {
        slot: null,
        confidence: 0,
        reason: `Nothing in "${input.fileName}" matched a slot on this checklist.`,
        classifiedBy: "heuristic",
      };
    }

    // Capped below certainty: a filename is a hint about a file's name,
    // not evidence about its contents. Only a reader can be sure, so a
    // human still confirms.
    const confidence = Math.min(0.85, best.score);

    return {
      slot: best.slot,
      confidence,
      reason: `Filename mentions ${best.hits.map((h) => `"${h}"`).join(", ")}.`,
      classifiedBy: "heuristic",
    };
  }
}
