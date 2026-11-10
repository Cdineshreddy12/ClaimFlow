import { createHash } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { LOW_CONFIDENCE_THRESHOLD, type Role } from "@claimflow/contracts";
import {
  getAssistant,
  type AssistantEvent,
} from "../../integrations/assistant/claude.js";
import { getClassifier } from "../../integrations/classifier/index.js";
import { canOcr, detectText } from "../../integrations/ocr/textract.js";
import {
  getRecogniser,
  hasRecogniser,
} from "../../integrations/recogniser/index.js";
import {
  buildObjectKey,
  buildStagingKey,
  getDownloadUrl,
  getObjectBytes,
  getUploadUrl,
  moveObject,
} from "../../integrations/storage/s3.js";
import * as auditService from "../audit/audit.service.js";
import * as checklistService from "../checklist/checklist.service.js";
import * as claimsService from "../claims/claims.service.js";
import { AppealAlreadyOpenError } from "../deductions/deductions.service.js";
import * as deductionsService from "../deductions/deductions.service.js";
import * as documentsService from "../documents/documents.service.js";
import { getMemberId } from "../members/members.repository.js";
import * as queriesService from "../queries/queries.service.js";
import * as assistantRepository from "./assistant.repository.js";
import type { Attachment } from "./assistant.repository.js";
import type {
  ApproveProposalBody,
  ChatBody,
  RegisterAttachmentBody,
  RequestAttachmentUploadBody,
} from "./assistant.schema.js";
import {
  canManageRules,
  executeReadTool,
  PROPOSAL_INPUT,
  toolsFor,
  type ProposalKind,
} from "./assistant.tools.js";

export class AssistantUnavailableError extends Error {}
export class AttachmentNotFoundError extends Error {}
export class AlreadyFiledError extends Error {}
export class SlotNotOnClaimError extends Error {}
export class ForbiddenError extends Error {}
export class ConversationNotFoundError extends Error {}

interface AuthContext {
  userId: string;
  role: Role;
}

// --- attachments ------------------------------------------------------

export async function requestAttachmentUpload(
  _auth: AuthContext,
  body: RequestAttachmentUploadBody,
) {
  const key = buildStagingKey(body.fileName);
  const uploadUrl = await getUploadUrl(key, body.contentType, body.sizeBytes);
  return { uploadUrl, key };
}

/** Takes a file that has no claim yet and works out where it goes. */
export async function registerAttachment(
  auth: AuthContext,
  body: RegisterAttachmentBody,
) {
  const memberId = await getMemberId(auth.userId);
  const created = await assistantRepository.create({
    fileUrl: body.key,
    fileName: body.fileName,
    contentType: body.contentType,
    uploadedBy: memberId,
  });

  try {
    // Decorated like every other path returns them.
    return await decorate(auth, await recognise(auth, created));
  } catch (err) {
    console.error("attachment recognition failed", {
      attachmentId: created.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return decorate(auth, created);
  }
}

async function recognise(
  auth: AuthContext,
  attachment: Attachment,
): Promise<Attachment> {
  // Read the bytes once: OCR, the recogniser and the classifier all
  // want the same object and S3 shouldn't be paid for three times.
  let cached: Uint8Array | undefined;
  const readBytes = async () =>
    (cached ??= await getObjectBytes(attachment.fileUrl));

  // Hashed on the way past, from bytes already in hand.
  const contentHash = createHash("sha256")
    .update(await readBytes())
    .digest("hex");

  let ocrText: string | undefined;
  let ocrConfidence: number | null = null;
  if (canOcr(attachment.contentType)) {
    try {
      const result = await detectText(await readBytes());
      ocrText = result?.text;
      ocrConfidence = result?.confidence ?? null;
    } catch (err) {
      console.error("OCR failed, recognising without it", {
        attachmentId: attachment.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Only what this user can see (docs/adr/0002).
  const claims = await claimsService.listClaims(auth, { scope: "all" });
  const recognition = await getRecogniser().recognise({
    fileName: attachment.fileName,
    contentType: attachment.contentType,
    readBytes,
    ocrText,
    candidates: claims.map((c) => ({
      id: c.id,
      reference: c.reference ?? c.id.slice(0, 8),
      patientName: c.patientName,
      procedureName: c.procedureName,
      insurerName: c.insurerName,
      status: c.status,
    })),
  });

  let slot: string | null = null;
  let slotConfidence: number | null = null;
  if (recognition.claimId) {
    const claim = claims.find((c) => c.id === recognition.claimId);
    const candidateSlots = (claim?.checklistSnapshot ?? []).map(
      (item) => item.documentType,
    );
    if (candidateSlots.length > 0) {
      const classification = await getClassifier().classify({
        fileName: attachment.fileName,
        contentType: attachment.contentType,
        candidateSlots,
        readBytes,
        ocrText,
      });
      // A floor the upload row deliberately doesn't apply.
      const confident = classification.confidence >= LOW_CONFIDENCE_THRESHOLD;
      slot = confident ? classification.slot : null;
      slotConfidence = slot ? classification.confidence : null;
    }
  }

  // Falls back to the row we already hold: a vanished attachment means
  // someone dismissed it mid-read, which costs the recognition and nothing
  // else.
  return (
    (await assistantRepository.saveRecognition(attachment.id, {
      contentHash,
      suggestedClaimId: recognition.claimId,
      suggestedSlot: slot,
      claimConfidence: recognition.claimId ? recognition.confidence : null,
      slotConfidence,
      recognitionReason: recognition.reason,
      ocrConfidence,
    })) ?? attachment
  );
}

export async function listPendingAttachments(auth: AuthContext) {
  const memberId = await getMemberId(auth.userId);
  const rows = await assistantRepository.listPending(memberId);
  return Promise.all(rows.map((row) => decorate(auth, row)));
}

/** Attachments carry a claim id; a panel has to show a reference and a name. */
async function decorate(auth: AuthContext, row: Attachment) {
  const duplicate = await findDuplicate(auth, row);
  if (!row.suggestedClaimId) {
    return { ...row, suggestedClaim: null, duplicateOf: duplicate };
  }
  try {
    const claim = await claimsService.getClaim(auth, row.suggestedClaimId);
    return {
      ...row,
      duplicateOf: duplicate,
      suggestedClaim: {
        id: claim.id,
        reference: claim.reference,
        patientName: claim.patientName,
        procedureName: claim.procedureName,
        checklistSlots: claim.checklistSnapshot.map((i) => i.documentType),
      },
    };
  } catch {
    // Claim gone, or no longer this user's to see. The attachment is
    // still theirs; it just has nothing to suggest any more.
    return { ...row, suggestedClaim: null, duplicateOf: duplicate };
  }
}

export interface DuplicateOf {
  /**
   * `same_file` is the bytes; `same_name` is a filename already on the
   * matched claim.
   */
  kind: "same_file" | "same_name";
  claimId: string;
  claimReference: string | null;
  slot: string | null;
  filedAt: Date | null;
  fileName: string;
}

/** Whether this file is already on a claim. */
async function findDuplicate(
  auth: AuthContext,
  row: Attachment,
): Promise<DuplicateOf | null> {
  try {
    if (row.contentHash) {
      const twin = await assistantRepository.findFiledByHash(
        row.contentHash,
        row.uploadedBy,
        row.id,
      );
      if (twin?.suggestedClaimId) {
        const claim = await claimsService.getClaim(auth, twin.suggestedClaimId);
        return {
          kind: "same_file",
          claimId: claim.id,
          claimReference: claim.reference,
          slot: twin.suggestedSlot,
          filedAt: twin.filedAt,
          fileName: twin.fileName,
        };
      }
    }

    // Falls back to the name, on the claim the recogniser picked.
    if (!row.suggestedClaimId) return null;
    const claim = await claimsService.getClaim(auth, row.suggestedClaimId);
    const documents = await documentsService.listDocuments(auth, claim.id);
    const match = documents.find(
      (d) => displayFileName(d.fileUrl) === row.fileName,
    );
    if (!match) return null;
    return {
      kind: "same_name",
      claimId: claim.id,
      claimReference: claim.reference,
      slot: match.checklistSlot,
      filedAt: match.confirmedAt ?? match.createdAt,
      fileName: row.fileName,
    };
  } catch {
    // A duplicate check that failed is not a reason to fail an upload.
    return null;
  }
}

/** Strips the uuid prefix buildObjectKey adds, back to what was uploaded. */
function displayFileName(key: string): string {
  const base = key.split("/").pop() ?? key;
  return base.replace(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/,
    "",
  );
}

/** A link to look at the file itself. */
export async function getAttachmentDownloadUrl(auth: AuthContext, id: string) {
  const attachment = await requireOwnAttachment(auth, id);
  return { downloadUrl: await getDownloadUrl(attachment.fileUrl) };
}

export async function dismissAttachment(auth: AuthContext, id: string) {
  const attachment = await requireOwnAttachment(auth, id);
  return assistantRepository.markDismissed(attachment.id);
}

async function requireOwnAttachment(auth: AuthContext, id: string) {
  const attachment = await assistantRepository.getById(id);
  if (!attachment) throw new AttachmentNotFoundError(id);
  const memberId = await getMemberId(auth.userId);
  // Not a hospital-wide pile: see assistant.repository's note.
  if (attachment.uploadedBy !== memberId) throw new AttachmentNotFoundError(id);
  return attachment;
}

// --- chat -------------------------------------------------------------

/** One turn of conversation. */
export async function chat(
  auth: AuthContext,
  body: ChatBody,
  onEvent?: (event: AssistantEvent) => void,
) {
  const assistant = getAssistant();
  if (!assistant) {
    throw new AssistantUnavailableError(
      "The assistant needs ANTHROPIC_API_KEY configured.",
    );
  }

  const attachments = await Promise.all(
    body.attachmentIds.map(async (id) => {
      const row = await requireOwnAttachment(auth, id);
      return decorate(auth, row);
    }),
  );

  const content: Anthropic.ContentBlockParam[] = [];
  if (attachments.length > 0) {
    content.push({
      type: "text",
      text: [
        "The user has just dropped these files into the panel. Each has",
        "already been read; this is what came back.",
        "",
        ...attachments.map((a) =>
          [
            `- attachment_id: ${a.id}`,
            `  filename: ${a.fileName}`,
            // The id as well as the reference, and labelled as the thing to
            // pass: given only "CLM-0001" the model will naturally propose
            // that, because it is what a human would say — and the
            // reference is not what the tool takes.
            `  claim_id to use: ${a.suggestedClaim?.id ?? "unknown — ask the desk"}`,
            `  looks like: ${a.suggestedClaim ? `${a.suggestedClaim.reference} — ${a.suggestedClaim.patientName}, ${a.suggestedClaim.procedureName}` : "no claim identified"}`,
            `  identified by: ${a.recognitionReason ?? "—"}`,
            // A percentage, because that is the only form of it anyone
            // in this product sees — 0.550 is the column, not the fact.
            `  claim confidence: ${
              a.claimConfidence
                ? `${Math.round(Number(a.claimConfidence) * 100)}%`
                : "—"
            }`,
            `  suggested slot: ${a.suggestedSlot ?? "none picked"}`,
            ...(a.duplicateOf
              ? [
                  a.duplicateOf.kind === "same_file"
                    ? `  ALREADY FILED: these exact bytes are already on ${a.duplicateOf.claimReference} in "${a.duplicateOf.slot}". Say so and propose nothing unless the desk asks for a second copy.`
                    : `  POSSIBLE DUPLICATE: ${a.duplicateOf.claimReference} already has a document named "${a.duplicateOf.fileName}" in "${a.duplicateOf.slot}". Same name is weaker evidence than same bytes — say which it is.`,
                ]
              : []),
            ...(a.suggestedClaim
              ? [
                  `  that claim's slots: ${a.suggestedClaim.checklistSlots.join(", ")}`,
                ]
              : []),
          ].join("\n"),
        ),
        "",
        "Propose a filing for each one you are confident about, and say plainly",
        "which you aren't — an unidentified file needs the desk to pick the claim.",
        "",
        "Never propose a filing for a file whose 'identified by' says it doesn't",
        "look like a claim document, or whose claim_id is unknown. Name what it",
        "appears to be and leave it alone. A stray logo or screenshot filed into",
        "a checklist slot is worse than one left sitting in the panel: the slot",
        "then reads as answered, and the document it was waiting for never gets",
        "chased.",
        "",
        "A file with no suggested slot is not a file with no home — it is one",
        "nothing read confidently enough to place. Ask which slot, or propose",
        "only the claim.",
        "",
        "The ids above are for the tools. Never put one in a sentence: call each",
        "file by its filename. A desk executive recognises IMG_0423.jpg and has",
        "no idea what df501503 is.",
      ].join("\n"),
    });
  }
  if (body.message.trim()) {
    content.push({ type: "text", text: body.message.trim() });
  }

  // Resolved before the model is called, not after: refusing someone else's
  // conversation should cost nothing, and a turn that is going to be
  // rejected should not be paid for first.
  const existing = body.conversationId
    ? await requireOwnConversation(auth, body.conversationId)
    : null;

  const result = await assistant.run({
    transcript: (existing?.transcript ?? []) as Anthropic.MessageParam[],
    userContent: content,
    systemContext: [
      `The user's role is ${auth.role}.`,
      `Today is ${new Date().toISOString().slice(0, 10)}.`,
      auth.role === "desk_executive"
        ? "They are a desk executive, so every tool only returns claims assigned to them. If something isn't found, it may simply not be theirs — say that rather than that it doesn't exist."
        : "They can see every claim on the desk.",
    ].join(" "),
    tools: toolsFor(auth.role),
    executeRead: (name, input) => executeReadTool(auth, name, input),
    ...(onEvent ? { onEvent } : {}),
  });

  const proposals = await Promise.all(
    result.proposals.map(async (p) => ({
      id: p.id,
      kind: p.kind,
      input: await resolveClaimReference(auth, p.input),
    })),
  );

  // Created only now that there is something to put in it.
  const conversation =
    existing ??
    (await assistantRepository.createConversation(
      await getMemberId(auth.userId),
      body.message,
    ));

  // The readable record and the machinery, saved together.
  const turns = [
    ...(conversation.turns as ChatTurn[]),
    {
      role: "user" as const,
      text: body.message,
      attachments: attachments.map((a) => ({
        id: a.id,
        fileName: a.fileName,
      })),
    },
    { role: "assistant" as const, text: result.reply, proposals },
  ];
  await assistantRepository.saveConversation(conversation.id, {
    turns,
    transcript: result.transcript,
  });

  return {
    conversationId: conversation.id,
    reply: result.reply,
    proposals,
  };
}

/** One bubble, as the panel renders it and as history replays it. */
interface ChatTurn {
  role: "user" | "assistant";
  text: string;
  attachments?: { id: string; fileName: string }[];
  proposals?: { id: string; kind: string; input: Record<string, unknown> }[];
}

async function requireOwnConversation(auth: AuthContext, id: string) {
  const conversation = await assistantRepository.getConversation(id);
  if (!conversation) throw new ConversationNotFoundError(id);
  const memberId = await getMemberId(auth.userId);
  // A chat is a half-formed train of thought; reading a colleague's is
  // a different product from the one this is.
  if (conversation.memberId !== memberId) {
    throw new ConversationNotFoundError(id);
  }
  return conversation;
}

export async function listConversations(auth: AuthContext) {
  return assistantRepository.listConversations(await getMemberId(auth.userId));
}

export async function getConversation(auth: AuthContext, id: string) {
  const conversation = await requireOwnConversation(auth, id);
  // The transcript stays on the server.
  return {
    id: conversation.id,
    title: conversation.title,
    turns: conversation.turns,
    // So a replayed card can say "Done" instead of offering an action
    // that can only fail.
    resolvedProposals: conversation.resolvedProposals,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  };
}

export async function deleteConversation(auth: AuthContext, id: string) {
  const conversation = await requireOwnConversation(auth, id);
  return assistantRepository.deleteConversation(conversation.id);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Turns a claim reference back into a claim id. */
async function resolveClaimReference(
  auth: AuthContext,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const claimId = input.claim_id;
  if (typeof claimId !== "string" || UUID.test(claimId)) return input;

  const claims = await claimsService.listClaims(auth, { scope: "all" });
  const matched = claims.find(
    (c) => c.reference?.toLowerCase() === claimId.toLowerCase(),
  );
  return matched ? { ...input, claim_id: matched.id } : input;
}

export function assistantAvailable(): boolean {
  return Boolean(getAssistant()) && hasRecogniser();
}

// --- approval ---------------------------------------------------------

/** Executes what the human approved — never what the model said. */
export async function approveProposal(
  auth: AuthContext,
  body: ApproveProposalBody,
) {
  const kind = body.kind as ProposalKind;
  const result = await execute(auth, kind, body.input);

  await auditService.record(auth, {
    action: "assistant.proposal_approved",
    entityType: "claim",
    entityId: result.entityId,
    after: { kind, input: body.input },
  });

  // Bookkeeping, after the fact and deliberately non-fatal: the filing has
  // happened and is audited.
  if (body.conversationId && body.proposalId) {
    try {
      const conversation = await requireOwnConversation(
        auth,
        body.conversationId,
      );
      await assistantRepository.resolveProposal(
        conversation.id,
        body.proposalId,
        {
          outcome: "approved",
          at: new Date().toISOString(),
          by: await getMemberId(auth.userId),
        },
      );
    } catch (err) {
      console.error("couldn't mark a proposal as approved", {
        conversationId: body.conversationId,
        proposalId: body.proposalId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result.payload;
}

/** Moves a staged attachment onto a claim and confirms it into a slot. */
async function fileOntoClaim(
  auth: AuthContext,
  attachment: Attachment,
  claimId: string,
  checklistSlot: string,
) {
  if (attachment.filedAt) throw new AlreadyFiledError(attachment.id);

  const key = buildObjectKey(claimId, attachment.fileName);
  await moveObject(attachment.fileUrl, key);

  const document = await documentsService.registerDocument(
    auth,
    claimId,
    key,
    attachment.contentType,
    // Already read once on the way in.
    {
      slot: checklistSlot,
      confidence: Number(attachment.slotConfidence ?? 0),
      // Says where it came from, because what's stored is the reason the
      // *claim* was matched, not the slot.
      reason:
        `Filed from the desk assistant. ${attachment.recognitionReason ?? ""}`.trim(),
      classifiedBy: "claude",
    },
  );

  // Approving the card *is* the confirmation — the human read the claim,
  // the slot and the reason, and clicked file (docs/adr/0005).
  const confirmed = await documentsService.confirmDocument(
    auth,
    claimId,
    document.id,
    checklistSlot,
  );
  await assistantRepository.markFiled(attachment.id, document.id, key);
  return confirmed;
}

async function execute(
  auth: AuthContext,
  kind: ProposalKind,
  rawInput: unknown,
): Promise<{ entityId: string; payload: unknown }> {
  switch (kind) {
    case "file_document": {
      const input = PROPOSAL_INPUT.file_document.parse(rawInput);
      const attachment = await requireOwnAttachment(auth, input.attachment_id);

      // Throws for a claim this user can't see, which is the whole
      // authorization check — the model proposing a claim id is not
      // evidence that anyone is allowed to write to it.
      const claim = await claimsService.getClaim(auth, input.claim_id);
      const slots = claim.checklistSnapshot.map((i) => i.documentType);
      if (!slots.includes(input.checklist_slot)) {
        // A slot that isn't on this claim would be filed against nothing
        // and would never count toward the checklist, so the desk would see
        // a document vanish into a gap that stays open.
        throw new SlotNotOnClaimError(input.checklist_slot);
      }

      const confirmed = await fileOntoClaim(
        auth,
        attachment,
        claim.id,
        input.checklist_slot,
      );
      return { entityId: claim.id, payload: confirmed };
    }

    /**
     * The document belongs here; the checklist just never had a place for
     * it.
     */
    case "file_as_new_slot": {
      const input = PROPOSAL_INPUT.file_as_new_slot.parse(rawInput);
      const attachment = await requireOwnAttachment(auth, input.attachment_id);
      // Checked before the slot is added, not inside fileOntoClaim: adding
      // a slot and then refusing to fill it would leave an empty
      // requirement on the claim that nobody asked for and nothing would
      // ever remove.
      if (attachment.filedAt) throw new AlreadyFiledError(attachment.id);

      // Does its own getClaim, so authorization is checked before the
      // snapshot is touched rather than after.
      await claimsService.addChecklistSlot(
        auth,
        input.claim_id,
        input.checklist_slot,
      );

      const confirmed = await fileOntoClaim(
        auth,
        attachment,
        input.claim_id,
        input.checklist_slot,
      );
      return { entityId: input.claim_id, payload: confirmed };
    }

    /** The checklist was wrong, not the document (docs/adr/0016). */
    case "add_checklist_slot": {
      const input = PROPOSAL_INPUT.add_checklist_slot.parse(rawInput);
      // The tool isn't offered to a desk executive, but the offer is a
      // courtesy and this is the gate: it is the same pair
      // checklist.routes.ts requires, and calling the service directly
      // would otherwise walk straight past the route that enforces it.
      if (!canManageRules(auth.role)) {
        throw new ForbiddenError(
          "Changing the checklist is a desk head's call.",
        );
      }

      const claim = await claimsService.getClaim(auth, input.claim_id);
      const rule = await checklistService.applyProposal(auth, {
        insurerId: claim.insurerId,
        procedureId: claim.procedureId,
        documentType: input.document_type,
        action: "add_required",
      });
      return { entityId: claim.id, payload: rule };
    }

    // Each appeal goes through `contestDeduction`, so the audit row and the
    // already-contested guard are the ones the appeal worklist would
    // produce.
    case "open_appeal": {
      const input = PROPOSAL_INPUT.open_appeal.parse(rawInput);
      // The tool isn't offered to a desk executive; this is the gate.
      // Same pair deductions.routes.ts requires on the contest route.
      if (!canManageRules(auth.role)) {
        throw new ForbiddenError(
          "Contesting a deduction is a desk head's call.",
        );
      }

      const opened: { id: string; amount: string; claimId: string }[] = [];
      const alreadyOpen: string[] = [];
      for (const deductionId of input.deduction_ids) {
        try {
          const contested = await deductionsService.contestDeduction(
            auth,
            deductionId,
            // Never a note.
            {},
          );
          opened.push({
            id: contested.id,
            amount: contested.amount,
            claimId: contested.claimId,
          });
        } catch (err) {
          if (err instanceof AppealAlreadyOpenError) {
            alreadyOpen.push(deductionId);
            continue;
          }
          throw err;
        }
      }

      return {
        // The provenance row only records that the assistant suggested
        // this; `contestDeduction` has already written one per appeal
        // against its own claim.
        entityId: opened[0]?.claimId ?? input.deduction_ids[0]!,
        payload: { opened, alreadyOpen },
      };
    }

    case "log_query": {
      const input = PROPOSAL_INPUT.log_query.parse(rawInput);
      const query = await queriesService.createQuery(auth, input.claim_id, {
        tpaRawEmail: input.tpa_raw_email,
        requestedItems: [],
      });
      return { entityId: input.claim_id, payload: query };
    }

    case "mark_query_replied": {
      const input = PROPOSAL_INPUT.mark_query_replied.parse(rawInput);
      const query = await queriesService.markReplied(auth, input.query_id);
      return { entityId: input.query_id, payload: query };
    }

    case "confirm_query_deadline": {
      const input = PROPOSAL_INPUT.confirm_query_deadline.parse(rawInput);
      const query = await queriesService.confirmDeadline(auth, input.query_id, {
        ...(input.deadline !== undefined ? { deadline: input.deadline } : {}),
      });
      return { entityId: input.query_id, payload: query };
    }
  }
}
