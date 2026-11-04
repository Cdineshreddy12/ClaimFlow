import { z } from "zod";

/**
 * Which classifier produced a suggestion. Stored and surfaced so the UI
 * can be literal about provenance — calling a filename match "AI" would
 * be a lie, and the confirmation UX in docs/adr/0005 only works if the
 * human can trust what the label says.
 */
export const ClassifierKind = z.enum(["heuristic", "claude"]);
export type ClassifierKind = z.infer<typeof ClassifierKind>;

export const CLASSIFIER_LABEL: Record<ClassifierKind, string> = {
  heuristic: "Matched by filename",
  claude: "Read by AI",
};

export const DocumentClassification = z.object({
  /** Null when nothing matched well enough to be worth suggesting. */
  slot: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  /** The evidence, shown to the human before they confirm — adr 0005. */
  reason: z.string(),
  classifiedBy: ClassifierKind,
});
export type DocumentClassification = z.infer<typeof DocumentClassification>;

/**
 * Below this, a suggestion still shows but is flagged as a guess, so a
 * desk exec reads it as "check this one" rather than "this is right".
 */
export const LOW_CONFIDENCE_THRESHOLD = 0.6;
