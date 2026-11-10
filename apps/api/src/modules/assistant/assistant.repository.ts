import { and, desc, eq, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import {
  assistantAttachments,
  assistantConversations,
} from "../../db/schema.js";

/**
 * Attachments are scoped to the member who dropped them, not to the
 * hospital.
 */

/** One row, as everything downstream passes it around. */
export type Attachment = typeof assistantAttachments.$inferSelect;

export interface NewAttachment {
  fileUrl: string;
  fileName: string;
  contentType: string;
  uploadedBy: string | null;
}

export async function create(data: NewAttachment): Promise<Attachment> {
  const [row] = await db.insert(assistantAttachments).values(data).returning();
  // An insert that returned nothing is not a case to carry through the
  // whole module as a maybe-row; it is the database having failed.
  if (!row) throw new Error("assistant_attachments insert returned no row");
  return row;
}

export async function getById(id: string) {
  const [row] = await db
    .select()
    .from(assistantAttachments)
    .where(eq(assistantAttachments.id, id));
  return row;
}

/** What the panel shows on open: dropped, and neither filed nor thrown away. */
export async function listPending(uploadedBy: string | null) {
  return db
    .select()
    .from(assistantAttachments)
    .where(
      and(
        uploadedBy
          ? eq(assistantAttachments.uploadedBy, uploadedBy)
          : isNull(assistantAttachments.uploadedBy),
        isNull(assistantAttachments.filedAt),
        isNull(assistantAttachments.dismissedAt),
      ),
    )
    .orderBy(desc(assistantAttachments.createdAt));
}

/** An earlier attachment with these exact bytes, already filed. */
export async function findFiledByHash(
  contentHash: string,
  uploadedBy: string | null,
  excludeId: string,
) {
  const [row] = await db
    .select()
    .from(assistantAttachments)
    .where(
      and(
        eq(assistantAttachments.contentHash, contentHash),
        uploadedBy
          ? eq(assistantAttachments.uploadedBy, uploadedBy)
          : isNull(assistantAttachments.uploadedBy),
        isNotNull(assistantAttachments.filedDocumentId),
        ne(assistantAttachments.id, excludeId),
      ),
    )
    .orderBy(desc(assistantAttachments.filedAt))
    .limit(1);
  return row;
}

export async function saveRecognition(
  id: string,
  data: {
    contentHash: string | null;
    suggestedClaimId: string | null;
    suggestedSlot: string | null;
    claimConfidence: number | null;
    slotConfidence: number | null;
    recognitionReason: string;
    ocrConfidence: number | null;
  },
) {
  const [row] = await db
    .update(assistantAttachments)
    .set({
      contentHash: data.contentHash,
      suggestedClaimId: data.suggestedClaimId,
      suggestedSlot: data.suggestedSlot,
      // numeric columns take strings through drizzle — same as
      // documents.confidence, and for the same reason: a float that
      // round-trips exactly is worth more than a tidier type.
      claimConfidence:
        data.claimConfidence === null ? null : data.claimConfidence.toFixed(3),
      slotConfidence:
        data.slotConfidence === null ? null : data.slotConfidence.toFixed(3),
      recognitionReason: data.recognitionReason,
      ocrConfidence:
        data.ocrConfidence === null ? null : data.ocrConfidence.toFixed(3),
    })
    .where(eq(assistantAttachments.id, id))
    .returning();
  return row;
}

export async function markFiled(
  id: string,
  documentId: string,
  fileUrl: string,
) {
  const [row] = await db
    .update(assistantAttachments)
    // fileUrl moves with it: the object is under the claim's prefix now,
    // and a stale staging key here would point at nothing.
    .set({ filedDocumentId: documentId, filedAt: new Date(), fileUrl })
    .where(eq(assistantAttachments.id, id))
    .returning();
  return row;
}

export async function markDismissed(id: string) {
  const [row] = await db
    .update(assistantAttachments)
    .set({ dismissedAt: new Date() })
    .where(eq(assistantAttachments.id, id))
    .returning();
  return row;
}

/** Conversations are scoped to the member who held them. */

export type Conversation = typeof assistantConversations.$inferSelect;

/** The opening line, as the history list shows it. */
function titleFrom(message: string): string {
  const trimmed = message.trim().replace(/\s+/g, " ");
  if (!trimmed) return "Files dropped in";
  return trimmed.length > 80 ? `${trimmed.slice(0, 79)}…` : trimmed;
}

export async function createConversation(
  memberId: string | null,
  firstMessage: string,
): Promise<Conversation> {
  const [row] = await db
    .insert(assistantConversations)
    .values({ memberId, title: titleFrom(firstMessage) })
    .returning();
  if (!row) throw new Error("assistant_conversations insert returned no row");
  return row;
}

export async function getConversation(id: string) {
  const [row] = await db
    .select()
    .from(assistantConversations)
    .where(eq(assistantConversations.id, id));
  return row;
}

export async function listConversations(memberId: string | null, limit = 30) {
  return db
    .select({
      id: assistantConversations.id,
      title: assistantConversations.title,
      createdAt: assistantConversations.createdAt,
      updatedAt: assistantConversations.updatedAt,
    })
    .from(assistantConversations)
    .where(
      memberId
        ? eq(assistantConversations.memberId, memberId)
        : isNull(assistantConversations.memberId),
    )
    .orderBy(desc(assistantConversations.updatedAt))
    .limit(limit);
}

export async function saveConversation(
  id: string,
  data: { turns: unknown; transcript: unknown },
) {
  const [row] = await db
    .update(assistantConversations)
    .set({
      turns: data.turns,
      transcript: data.transcript,
      updatedAt: new Date(),
    })
    .where(eq(assistantConversations.id, id))
    .returning();
  return row;
}

/**
 * Marks one proposal spent.
 *
 * Merged in SQL rather than read-modify-written: two cards approved in
 * quick succession would otherwise race and one outcome would vanish.
 */
export async function resolveProposal(
  conversationId: string,
  proposalId: string,
  outcome: { outcome: "approved"; at: string; by: string | null },
) {
  const [row] = await db
    .update(assistantConversations)
    .set({
      resolvedProposals: sql`${assistantConversations.resolvedProposals} || ${JSON.stringify({ [proposalId]: outcome })}::jsonb`,
    })
    .where(eq(assistantConversations.id, conversationId))
    .returning();
  return row;
}

export async function deleteConversation(id: string) {
  const [row] = await db
    .delete(assistantConversations)
    .where(eq(assistantConversations.id, id))
    .returning();
  return row;
}
