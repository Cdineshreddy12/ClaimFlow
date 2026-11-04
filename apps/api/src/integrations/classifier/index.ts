import { ClaudeClassifier } from "./claude.js";
import { HeuristicClassifier } from "./heuristic.js";
import type { DocumentClassifier } from "./types.js";

export type { ClassificationInput, DocumentClassifier } from "./types.js";
export { HeuristicClassifier } from "./heuristic.js";
export { ClaudeClassifier } from "./claude.js";

let instance: DocumentClassifier | undefined;

/**
 * Claude when ANTHROPIC_API_KEY is configured, filename matching when
 * it isn't.
 *
 * Falling back rather than failing is the deliberate call: a hospital
 * without AI credentials still gets useful sorting, and the suggestion
 * carries `classifiedBy` so the UI can say which one it was instead of
 * implying the model ran. Every downstream path is identical — the
 * human confirms either way (docs/adr/0005).
 *
 * Lazy, like db/client and s3, so importing this never throws at
 * module-load time and test collection stays unaffected.
 */
export function getClassifier(): DocumentClassifier {
  if (!instance) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    instance = apiKey
      ? new ClaudeClassifier(apiKey)
      : new HeuristicClassifier();
  }
  return instance;
}

/** Tests reach for this to pin a specific classifier. */
export function setClassifierForTesting(
  classifier: DocumentClassifier | undefined,
): void {
  instance = classifier;
}
