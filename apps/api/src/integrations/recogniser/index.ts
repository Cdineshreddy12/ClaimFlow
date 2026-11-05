import { ClaudeRecogniser } from "./claude.js";
import type {
  ClaimRecogniser,
  Recognition,
  RecognitionInput,
} from "./types.js";

export type {
  ClaimCandidate,
  ClaimRecogniser,
  Recognition,
  RecognitionInput,
} from "./types.js";
export { ClaudeRecogniser } from "./claude.js";

/**
 * What runs without an ANTHROPIC_API_KEY.
 *
 * Document sorting has a filename fallback because a filename carries
 * real signal about what a document *is*. Nothing equivalent exists for
 * whose claim it belongs to — a filename almost never names the
 * patient, and a fallback that matched on one anyway would be guessing
 * at the one decision in this product where a wrong answer puts a
 * stranger's paperwork on someone's claim.
 *
 * So it abstains, and the panel asks the desk to pick the claim — which
 * is exactly what they do today, so nothing is lost.
 */
export class NullRecogniser implements ClaimRecogniser {
  async recognise(_input: RecognitionInput): Promise<Recognition> {
    return {
      claimId: null,
      confidence: 0,
      reason: "Reading documents isn't configured — pick the claim yourself.",
      documentKind: null,
    };
  }
}

let instance: ClaimRecogniser | undefined;

export function getRecogniser(): ClaimRecogniser {
  if (!instance) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    instance = apiKey ? new ClaudeRecogniser(apiKey) : new NullRecogniser();
  }
  return instance;
}

/** Surfaced to the web app so the panel can say the feature needs configuring. */
export function hasRecogniser(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY) || instance !== undefined;
}

/** Tests reach for this to pin a specific recogniser. */
export function setRecogniserForTesting(
  recogniser: ClaimRecogniser | undefined,
): void {
  instance = recogniser;
}
