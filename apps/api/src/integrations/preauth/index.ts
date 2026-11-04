import { ClaudePreauthExtractor } from "./claude.js";
import type {
  ExtractionInput,
  ExtractionOutcome,
  PreauthExtractor,
} from "./types.js";

export type {
  ExtractionDocument,
  ExtractionInput,
  ExtractionOutcome,
  PreauthExtractor,
} from "./types.js";
export { ClaudePreauthExtractor } from "./claude.js";

/**
 * What runs when no ANTHROPIC_API_KEY is configured.
 *
 * Document sorting has a credential-free fallback because a filename
 * genuinely carries signal. Nothing equivalent exists here — there is no
 * way to guess an ICD-10 code or a surgeon's fee from a filename, and a
 * fallback that produced something anyway would be inventing values onto
 * a form a TPA authorises against. So this returns nothing, and the UI
 * says the feature needs configuring rather than silently finding zero
 * fields and looking broken.
 */
export class NullPreauthExtractor implements PreauthExtractor {
  async extract(_input: ExtractionInput): Promise<ExtractionOutcome> {
    return { fields: [], documentsRead: 0 };
  }
}

let instance: PreauthExtractor | undefined;

export function getPreauthExtractor(): PreauthExtractor {
  if (!instance) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    instance = apiKey
      ? new ClaudePreauthExtractor(apiKey)
      : new NullPreauthExtractor();
  }
  return instance;
}

/**
 * Whether reading documents is actually wired up. Surfaced to the web
 * app so it can disable the action with a reason, instead of offering a
 * button that always comes back having found nothing.
 */
export function hasPreauthExtractor(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY) || instance !== undefined;
}

/** Tests reach for this to pin a specific extractor. */
export function setPreauthExtractorForTesting(
  extractor: PreauthExtractor | undefined,
): void {
  instance = extractor;
}
