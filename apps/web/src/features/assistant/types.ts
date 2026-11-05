/** One file dropped into the panel, plus whatever reading it produced. */
export interface AssistantAttachment {
  id: string;
  fileName: string;
  contentType: string;
  suggestedClaimId: string | null;
  suggestedSlot: string | null;
  /** Postgres numerics arrive as strings; 0–1. */
  claimConfidence: string | null;
  slotConfidence: string | null;
  /** What on the page identified the patient — shown before approval. */
  recognitionReason: string | null;
  ocrConfidence: string | null;
  filedAt: string | null;
  dismissedAt: string | null;
  createdAt: string;
  suggestedClaim: {
    id: string;
    reference: string | null;
    patientName: string;
    procedureName: string;
    checklistSlots: string[];
  } | null;
  /**
   * Set when this file is already on a claim.
   *
   * `same_file` is the bytes and is certain; `same_name` is a filename
   * on the claim it matched, which is weaker — a document uploaded
   * through a claim page carries no hash, so a name is all there is.
   */
  duplicateOf?: {
    kind: "same_file" | "same_name";
    claimId: string;
    claimReference: string | null;
    slot: string | null;
    filedAt: string | null;
    fileName: string;
  } | null;
}

export type ProposalKind =
  | "file_document"
  | "log_query"
  | "mark_query_replied"
  | "confirm_query_deadline"
  | "add_checklist_slot"
  | "file_as_new_slot";

/**
 * Something the assistant wants to do, which it cannot do.
 *
 * `input` is the payload as the model suggested it. The card may edit
 * it before approval, and the server re-validates whatever is sent —
 * so this is a draft, not an instruction.
 */
export interface Proposal {
  id: string;
  kind: ProposalKind;
  input: Record<string, unknown>;
}

/** The `done` event — what only exists once a turn is over. */
export interface ChatResult {
  conversationId: string;
  reply: string;
  proposals: Proposal[];
}

export interface ConversationSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

/** What was done with a card, keyed by the proposal's id. */
export interface ResolvedProposal {
  outcome: "approved";
  at: string;
  by: string | null;
}

export interface Conversation extends ConversationSummary {
  turns: ChatTurn[];
  resolvedProposals: Record<string, ResolvedProposal>;
}

/**
 * One bubble. Also the stored shape — history replays these, so a turn
 * carries only what the panel renders and nothing of the provider's
 * wire format.
 */
export interface ChatTurn {
  id?: string;
  role: "user" | "assistant";
  text: string;
  attachments?: { id: string; fileName: string }[];
  proposals?: Proposal[];
  /**
   * Set when the turn never got an answer.
   *
   * It sits in the reply's place rather than at the bottom of the panel,
   * because a transient line under everything disappears on the next
   * send and leaves the question above it looking ignored. Local only —
   * a failed turn is never saved, since nothing happened.
   */
  error?: string;
}
