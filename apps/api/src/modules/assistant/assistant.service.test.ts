import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import * as assistantRepository from "./assistant.repository.js";
import * as checklistService from "../checklist/checklist.service.js";
import * as claimsService from "../claims/claims.service.js";
import * as documentsService from "../documents/documents.service.js";
import * as queriesService from "../queries/queries.service.js";
import * as orgMembersRepository from "../members/members.repository.js";
import * as s3 from "../../integrations/storage/s3.js";
import * as assistant from "../../integrations/assistant/claude.js";

vi.mock("./assistant.repository.js");
vi.mock("../checklist/checklist.service.js");
vi.mock("../claims/claims.service.js");
vi.mock("../documents/documents.service.js");
vi.mock("../queries/queries.service.js");
vi.mock("../members/members.repository.js");
vi.mock("../audit/audit.service.js");
vi.mock("../../integrations/storage/s3.js");
vi.mock("../../integrations/assistant/claude.js");

const CONVERSATION_ID = "aaaa1111-2222-3333-4444-555566667777";

/** A fresh conversation, as the repository hands one back. */
function conversation(overrides: Record<string, unknown> = {}) {
  return {
    id: CONVERSATION_ID,
    memberId: MEMBER_ID,
    title: "where does this go?",
    turns: [],
    transcript: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as never;
}

const USER_ID = "22222222-2222-2222-2222-222222222222";
const MEMBER_ID = "55555555-5555-5555-5555-555555555555";
const OTHER_MEMBER_ID = "66666666-6666-6666-6666-666666666666";
const CLAIM_ID = "33333333-3333-3333-3333-333333333333";
const ATTACHMENT_ID = "44444444-4444-4444-4444-444444444444";
const DOCUMENT_ID = "77777777-7777-7777-7777-777777777777";
const QUERY_ID = "88888888-8888-8888-8888-888888888888";

function auth(
  role: "desk_executive" | "desk_head" | "org_admin" = "desk_head",
) {
  return { userId: USER_ID, role };
}

function attachment(overrides: Record<string, unknown> = {}) {
  return {
    id: ATTACHMENT_ID,
    fileUrl: "assistant/staging/abc-scan.jpg",
    fileName: "scan.jpg",
    contentType: "image/jpeg",
    uploadedBy: MEMBER_ID,
    suggestedClaimId: CLAIM_ID,
    suggestedSlot: "Ultrasound report (abdomen)",
    claimConfidence: "0.910",
    slotConfidence: "0.880",
    recognitionReason: "The page is headed Rajendra Pawar, UHID 2026/18440.",
    ocrConfidence: "0.940",
    filedDocumentId: null,
    filedAt: null,
    dismissedAt: null,
    createdAt: new Date(),
    ...overrides,
  } as never;
}

function claim(slots = ["Ultrasound report (abdomen)", "Photo ID proof"]) {
  return {
    id: CLAIM_ID,
    reference: "CLM-0001",
    patientName: "Rajendra Pawar",
    procedureName: "Gall bladder removal",
    checklistSnapshot: slots.map((documentType) => ({
      documentType,
      required: true,
    })),
  } as never;
}

describe("assistant.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(orgMembersRepository.getMemberId).mockResolvedValue(MEMBER_ID);
  });

  /**
   * The model proposes; this is where a human's approval becomes a
   * write. Everything worth pinning is about what approval is *not*
   * allowed to wave through — the model's output is a draft payload,
   * not an instruction, and these are the checks that make that true.
   */
  describe("approveProposal — file_document", () => {
    beforeEach(() => {
      vi.mocked(assistantRepository.getById).mockResolvedValue(attachment());
      vi.mocked(claimsService.getClaim).mockResolvedValue(claim());
      vi.mocked(documentsService.registerDocument).mockResolvedValue({
        id: DOCUMENT_ID,
      } as never);
      vi.mocked(documentsService.confirmDocument).mockResolvedValue({
        id: DOCUMENT_ID,
        checklistSlot: "Ultrasound report (abdomen)",
      } as never);
      vi.mocked(s3.buildObjectKey).mockReturnValue("claims/33/abc-scan.jpg");
      vi.mocked(s3.moveObject).mockResolvedValue(undefined);
    });

    it("files the document through the ordinary services, so the audit and role checks are theirs", async () => {
      const { approveProposal } = await import("./assistant.service.js");

      await approveProposal(auth(), {
        kind: "file_document",
        input: {
          attachment_id: ATTACHMENT_ID,
          claim_id: CLAIM_ID,
          checklist_slot: "Ultrasound report (abdomen)",
        },
      });

      // getClaim is the authorization check: it throws for a claim this
      // user can't see, and a model naming a claim id is not evidence
      // that anyone may write to it.
      expect(claimsService.getClaim).toHaveBeenCalledWith(
        expect.anything(),
        CLAIM_ID,
      );
      expect(s3.moveObject).toHaveBeenCalledWith(
        "assistant/staging/abc-scan.jpg",
        "claims/33/abc-scan.jpg",
      );
      expect(documentsService.confirmDocument).toHaveBeenCalledWith(
        expect.anything(),
        CLAIM_ID,
        DOCUMENT_ID,
        "Ultrasound report (abdomen)",
      );
      expect(assistantRepository.markFiled).toHaveBeenCalledWith(
        ATTACHMENT_ID,
        DOCUMENT_ID,
        "claims/33/abc-scan.jpg",
      );
    });

    it("passes the reading it already paid for instead of classifying twice", async () => {
      const { approveProposal } = await import("./assistant.service.js");

      await approveProposal(auth(), {
        kind: "file_document",
        input: {
          attachment_id: ATTACHMENT_ID,
          claim_id: CLAIM_ID,
          checklist_slot: "Ultrasound report (abdomen)",
        },
      });

      expect(documentsService.registerDocument).toHaveBeenCalledWith(
        expect.anything(),
        CLAIM_ID,
        "claims/33/abc-scan.jpg",
        "image/jpeg",
        expect.objectContaining({
          slot: "Ultrasound report (abdomen)",
          classifiedBy: "claude",
        }),
      );
    });

    it("refuses a slot that isn't on the claim's checklist", async () => {
      const { approveProposal, SlotNotOnClaimError } =
        await import("./assistant.service.js");

      await expect(
        approveProposal(auth(), {
          kind: "file_document",
          input: {
            attachment_id: ATTACHMENT_ID,
            claim_id: CLAIM_ID,
            checklist_slot: "Discharge summary",
          },
        }),
      ).rejects.toThrow(SlotNotOnClaimError);

      // Nothing moved. A document filed against a slot this claim
      // doesn't have would never count toward the checklist, so the gap
      // would stay open with the document sitting invisibly behind it.
      expect(s3.moveObject).not.toHaveBeenCalled();
      expect(documentsService.registerDocument).not.toHaveBeenCalled();
    });

    it("refuses an attachment belonging to another member", async () => {
      vi.mocked(assistantRepository.getById).mockResolvedValue(
        attachment({ uploadedBy: OTHER_MEMBER_ID }),
      );

      const { approveProposal, AttachmentNotFoundError } =
        await import("./assistant.service.js");

      await expect(
        approveProposal(auth(), {
          kind: "file_document",
          input: {
            attachment_id: ATTACHMENT_ID,
            claim_id: CLAIM_ID,
            checklist_slot: "Ultrasound report (abdomen)",
          },
        }),
      ).rejects.toThrow(AttachmentNotFoundError);
      expect(s3.moveObject).not.toHaveBeenCalled();
    });

    it("refuses to file the same attachment twice", async () => {
      vi.mocked(assistantRepository.getById).mockResolvedValue(
        attachment({ filedAt: new Date(), filedDocumentId: DOCUMENT_ID }),
      );

      const { approveProposal, AlreadyFiledError } =
        await import("./assistant.service.js");

      await expect(
        approveProposal(auth(), {
          kind: "file_document",
          input: {
            attachment_id: ATTACHMENT_ID,
            claim_id: CLAIM_ID,
            checklist_slot: "Ultrasound report (abdomen)",
          },
        }),
      ).rejects.toThrow(AlreadyFiledError);
    });

    it("re-parses the payload rather than trusting the shape it arrived in", async () => {
      const { approveProposal } = await import("./assistant.service.js");

      await expect(
        approveProposal(auth(), {
          kind: "file_document",
          input: { attachment_id: "not-a-uuid", claim_id: CLAIM_ID },
        }),
      ).rejects.toThrow(ZodError);
      expect(assistantRepository.getById).not.toHaveBeenCalled();
    });
  });

  describe("approveProposal — the other actions", () => {
    it("logs a query through the queries service, email text untouched", async () => {
      vi.mocked(queriesService.createQuery).mockResolvedValue({
        id: QUERY_ID,
      } as never);

      const { approveProposal } = await import("./assistant.service.js");
      await approveProposal(auth(), {
        kind: "log_query",
        input: { claim_id: CLAIM_ID, tpa_raw_email: "Dear Team, ..." },
      });

      expect(queriesService.createQuery).toHaveBeenCalledWith(
        expect.anything(),
        CLAIM_ID,
        { tpaRawEmail: "Dear Team, ...", requestedItems: [] },
      );
    });

    it("confirms a deadline without a value when the proposal didn't carry one", async () => {
      vi.mocked(queriesService.confirmDeadline).mockResolvedValue({
        id: QUERY_ID,
      } as never);

      const { approveProposal } = await import("./assistant.service.js");
      await approveProposal(auth(), {
        kind: "confirm_query_deadline",
        input: { query_id: QUERY_ID },
      });

      // Empty body, not an echoed date: confirming as-is must not
      // rewrite a deadline that moved since the model read it.
      expect(queriesService.confirmDeadline).toHaveBeenCalledWith(
        expect.anything(),
        QUERY_ID,
        {},
      );
    });
  });

  /**
   * The fix for the document in hand, as opposed to the fix for the
   * checklist. Adding the slot and filing into it are one approval
   * because they are one decision.
   */
  describe("approveProposal — file_as_new_slot", () => {
    beforeEach(() => {
      vi.mocked(assistantRepository.getById).mockResolvedValue(attachment());
      vi.mocked(claimsService.addChecklistSlot).mockResolvedValue({
        id: CLAIM_ID,
      } as never);
      vi.mocked(documentsService.registerDocument).mockResolvedValue({
        id: DOCUMENT_ID,
      } as never);
      vi.mocked(documentsService.confirmDocument).mockResolvedValue({
        id: DOCUMENT_ID,
      } as never);
      vi.mocked(s3.buildObjectKey).mockReturnValue("claims/33/abc-scan.jpg");
      vi.mocked(s3.moveObject).mockResolvedValue(undefined);
    });

    it("adds the slot to that one claim, then files into it", async () => {
      const { approveProposal } = await import("./assistant.service.js");

      await approveProposal(auth(), {
        kind: "file_as_new_slot",
        input: {
          attachment_id: ATTACHMENT_ID,
          claim_id: CLAIM_ID,
          checklist_slot: "Cost estimate",
        },
      });

      expect(claimsService.addChecklistSlot).toHaveBeenCalledWith(
        expect.anything(),
        CLAIM_ID,
        "Cost estimate",
      );
      expect(documentsService.confirmDocument).toHaveBeenCalledWith(
        expect.anything(),
        CLAIM_ID,
        DOCUMENT_ID,
        "Cost estimate",
      );
      // The rules are untouched. This is the per-claim fix; changing
      // what future claims ask for is a different card with a different
      // blast radius and a different approver.
      expect(checklistService.applyProposal).not.toHaveBeenCalled();
    });

    it("doesn't touch the snapshot when the file was already filed", async () => {
      vi.mocked(assistantRepository.getById).mockResolvedValue(
        attachment({ filedAt: new Date() }),
      );
      vi.mocked(claimsService.addChecklistSlot).mockResolvedValue({
        id: CLAIM_ID,
      } as never);

      const { approveProposal, AlreadyFiledError } =
        await import("./assistant.service.js");

      await expect(
        approveProposal(auth(), {
          kind: "file_as_new_slot",
          input: {
            attachment_id: ATTACHMENT_ID,
            claim_id: CLAIM_ID,
            checklist_slot: "Cost estimate",
          },
        }),
      ).rejects.toThrow(AlreadyFiledError);
      expect(s3.moveObject).not.toHaveBeenCalled();
      // The guard has to run before the slot is added. Adding one and
      // then refusing to fill it strands an empty requirement on the
      // claim that nothing would ever clear.
      expect(claimsService.addChecklistSlot).not.toHaveBeenCalled();
    });
  });

  /**
   * A document that fits no slot is evidence about the checklist, not
   * about the document — the same argument docs/adr/0016 makes from TPA
   * queries. What's worth pinning is that it stays a desk head's call
   * and that it goes through the existing rule path.
   */
  describe("approveProposal — add_checklist_slot", () => {
    beforeEach(() => {
      vi.mocked(claimsService.getClaim).mockResolvedValue({
        ...(claim() as object),
        insurerId: "99999999-9999-9999-9999-999999999999",
        procedureId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      } as never);
      vi.mocked(checklistService.applyProposal).mockResolvedValue({
        id: "rule-1",
        documentType: "Cost estimate",
      } as never);
    });

    it("adds the rule through the same path the checklist admin uses", async () => {
      const { approveProposal } = await import("./assistant.service.js");

      await approveProposal(auth("desk_head"), {
        kind: "add_checklist_slot",
        input: { claim_id: CLAIM_ID, document_type: "Cost estimate" },
      });

      expect(checklistService.applyProposal).toHaveBeenCalledWith(
        expect.anything(),
        {
          insurerId: "99999999-9999-9999-9999-999999999999",
          procedureId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
          documentType: "Cost estimate",
          action: "add_required",
        },
      );
    });

    it("refuses a desk executive, the same as the admin route would", async () => {
      const { approveProposal, ForbiddenError } =
        await import("./assistant.service.js");

      await expect(
        approveProposal(auth("desk_executive"), {
          kind: "add_checklist_slot",
          input: { claim_id: CLAIM_ID, document_type: "Cost estimate" },
        }),
      ).rejects.toThrow(ForbiddenError);

      // The gate is here, not in the tool list. Withholding the tool is
      // a courtesy; calling the service directly would otherwise walk
      // straight past the route that enforces the role.
      expect(checklistService.applyProposal).not.toHaveBeenCalled();
    });

    it("resolves the insurer and procedure from the claim, not from the model", async () => {
      const { approveProposal } = await import("./assistant.service.js");

      await approveProposal(auth("org_admin" as never), {
        kind: "add_checklist_slot",
        input: { claim_id: CLAIM_ID, document_type: "Cost estimate" },
      });

      // getClaim is what makes a claim id the model produced safe to
      // act on — and it is also where the pair comes from, so the model
      // cannot name an insurer/procedure combination of its own.
      expect(claimsService.getClaim).toHaveBeenCalledWith(
        expect.anything(),
        CLAIM_ID,
      );
    });
  });

  describe("marking a proposal spent", () => {
    beforeEach(() => {
      vi.mocked(assistantRepository.getById).mockResolvedValue(attachment());
      vi.mocked(claimsService.getClaim).mockResolvedValue(claim());
      vi.mocked(documentsService.registerDocument).mockResolvedValue({
        id: DOCUMENT_ID,
      } as never);
      vi.mocked(documentsService.confirmDocument).mockResolvedValue({
        id: DOCUMENT_ID,
      } as never);
      vi.mocked(s3.buildObjectKey).mockReturnValue("claims/33/abc-scan.jpg");
      vi.mocked(s3.moveObject).mockResolvedValue(undefined);
      vi.mocked(assistantRepository.getConversation).mockResolvedValue(
        conversation(),
      );
    });

    const fileIt = {
      kind: "file_document" as const,
      input: {
        attachment_id: ATTACHMENT_ID,
        claim_id: CLAIM_ID,
        checklist_slot: "Ultrasound report (abdomen)",
      },
      conversationId: CONVERSATION_ID,
      proposalId: "toolu_01",
    };

    it("records the approval against the card it came from", async () => {
      const { approveProposal } = await import("./assistant.service.js");
      await approveProposal(auth(), fileIt);

      expect(assistantRepository.resolveProposal).toHaveBeenCalledWith(
        CONVERSATION_ID,
        "toolu_01",
        expect.objectContaining({ outcome: "approved", by: MEMBER_ID }),
      );
    });

    it("won't record against someone else's conversation", async () => {
      vi.mocked(assistantRepository.getConversation).mockResolvedValue(
        conversation({ memberId: OTHER_MEMBER_ID }),
      );

      const { approveProposal } = await import("./assistant.service.js");
      await approveProposal(auth(), fileIt);

      expect(assistantRepository.resolveProposal).not.toHaveBeenCalled();
      // And the filing itself still went through: the bookkeeping is
      // after the fact, so a refused tick cannot undo a real action.
      expect(documentsService.confirmDocument).toHaveBeenCalled();
    });

    it("still succeeds when the bookkeeping fails", async () => {
      vi.mocked(assistantRepository.resolveProposal).mockRejectedValue(
        new Error("db down"),
      );

      const { approveProposal } = await import("./assistant.service.js");

      // Reporting a completed, audited filing as an error is how a desk
      // ends up doing it twice.
      await expect(approveProposal(auth(), fileIt)).resolves.toBeDefined();
    });
  });

  /**
   * The same estimate dropped in twice used to produce five sentences
   * weighing whether it might be a duplicate, a different patient, or a
   * second episode — careful reasoning around a fact nothing recorded.
   */
  describe("duplicate detection", () => {
    beforeEach(() => {
      vi.mocked(claimsService.getClaim).mockResolvedValue(claim());
      vi.mocked(documentsService.listDocuments).mockResolvedValue([] as never);
    });

    it("recognises the same bytes already filed, and says which claim", async () => {
      vi.mocked(assistantRepository.listPending).mockResolvedValue([
        attachment({ contentHash: "abc123" }),
      ]);
      vi.mocked(assistantRepository.findFiledByHash).mockResolvedValue(
        attachment({
          id: "older",
          fileName: "Estimate_Pawar_GB.jpg",
          suggestedClaimId: CLAIM_ID,
          suggestedSlot: "Cost estimate",
          filedAt: new Date("2026-11-05T12:52:00Z"),
        }),
      );

      const { listPendingAttachments } = await import("./assistant.service.js");
      const [row] = await listPendingAttachments(auth());

      expect(row!.duplicateOf).toMatchObject({
        kind: "same_file",
        claimReference: "CLM-0001",
        slot: "Cost estimate",
      });
    });

    it("doesn't call an unfiled twin a duplicate", async () => {
      vi.mocked(assistantRepository.listPending).mockResolvedValue([
        attachment({ contentHash: "abc123" }),
      ]);
      // An unfiled twin is the same decision still waiting to be made,
      // not a thing already done.
      vi.mocked(assistantRepository.findFiledByHash).mockResolvedValue(
        undefined as never,
      );

      const { listPendingAttachments } = await import("./assistant.service.js");
      const [row] = await listPendingAttachments(auth());

      expect(row!.duplicateOf).toBeNull();
    });

    it("falls back to the filename, but only on the claim it matched", async () => {
      vi.mocked(assistantRepository.listPending).mockResolvedValue([
        attachment({ contentHash: null, fileName: "Estimate_Pawar_GB.jpg" }),
      ]);
      vi.mocked(documentsService.listDocuments).mockResolvedValue([
        {
          id: "doc-1",
          fileUrl:
            "claims/33/9c3dc451-da7a-4a0b-93c0-14740f813e43-Estimate_Pawar_GB.jpg",
          checklistSlot: "Cost estimate",
          confirmedAt: new Date("2026-11-05T12:52:00Z"),
          createdAt: new Date(),
        },
      ] as never);

      const { listPendingAttachments } = await import("./assistant.service.js");
      const [row] = await listPendingAttachments(auth());

      // Weaker evidence, and labelled as such — a document uploaded
      // through a claim page carries no hash.
      expect(row!.duplicateOf).toMatchObject({
        kind: "same_name",
        fileName: "Estimate_Pawar_GB.jpg",
      });
    });

    it("never fails an upload over a duplicate check", async () => {
      vi.mocked(assistantRepository.listPending).mockResolvedValue([
        attachment({ contentHash: "abc123" }),
      ]);
      vi.mocked(assistantRepository.findFiledByHash).mockRejectedValue(
        new Error("db down"),
      );

      const { listPendingAttachments } = await import("./assistant.service.js");
      const [row] = await listPendingAttachments(auth());

      expect(row!.duplicateOf).toBeNull();
      expect(row!.id).toBe(ATTACHMENT_ID);
    });
  });

  describe("conversations", () => {
    it("won't open someone else's conversation", async () => {
      vi.mocked(assistantRepository.getConversation).mockResolvedValue(
        conversation({ memberId: OTHER_MEMBER_ID }),
      );

      const { getConversation, ConversationNotFoundError } =
        await import("./assistant.service.js");

      await expect(getConversation(auth(), CONVERSATION_ID)).rejects.toThrow(
        ConversationNotFoundError,
      );
    });

    it("keeps the provider transcript on the server when handing back history", async () => {
      vi.mocked(assistantRepository.getConversation).mockResolvedValue(
        conversation({
          turns: [{ role: "user", text: "hi" }],
          transcript: [{ role: "user", content: [{ type: "text" }] }],
        }),
      );

      const { getConversation } = await import("./assistant.service.js");
      const result = await getConversation(auth(), CONVERSATION_ID);

      // Taking the wire format off the wire was half the point of
      // persisting; handing it back on read would undo that.
      expect(result).not.toHaveProperty("transcript");
      expect(result).toHaveProperty("resolvedProposals");
      expect(result.turns).toEqual([{ role: "user", text: "hi" }]);
    });

    it("doesn't leave an empty conversation behind when the turn fails", async () => {
      vi.mocked(assistant.getAssistant).mockReturnValue({
        run: vi.fn().mockRejectedValue(new Error("anthropic down")),
      } as never);

      const { chat } = await import("./assistant.service.js");
      await expect(
        chat(auth(), { message: "what should i do next", attachmentIds: [] }),
      ).rejects.toThrow("anthropic down");

      // Creating it up front left a titled, empty row in the history
      // list recording that someone typed a sentence nothing answered.
      expect(assistantRepository.createConversation).not.toHaveBeenCalled();
    });

    it("checks the conversation is this user's before paying for a turn", async () => {
      const run = vi.fn();
      vi.mocked(assistant.getAssistant).mockReturnValue({ run } as never);
      vi.mocked(assistantRepository.getConversation).mockResolvedValue(
        conversation({ memberId: OTHER_MEMBER_ID }),
      );

      const { chat, ConversationNotFoundError } =
        await import("./assistant.service.js");

      await expect(
        chat(auth(), {
          conversationId: CONVERSATION_ID,
          message: "continue",
          attachmentIds: [],
        }),
      ).rejects.toThrow(ConversationNotFoundError);
      expect(run).not.toHaveBeenCalled();
    });

    it("continues an existing conversation rather than starting a new one", async () => {
      vi.mocked(assistant.getAssistant).mockReturnValue({
        run: vi.fn().mockResolvedValue({
          reply: "ok",
          proposals: [],
          transcript: [{ role: "assistant", content: [] }],
        }),
      } as never);
      vi.mocked(assistantRepository.getConversation).mockResolvedValue(
        conversation({ turns: [{ role: "user", text: "earlier" }] }),
      );

      const { chat } = await import("./assistant.service.js");
      const result = await chat(auth(), {
        conversationId: CONVERSATION_ID,
        message: "and now?",
        attachmentIds: [],
      });

      expect(assistantRepository.createConversation).not.toHaveBeenCalled();
      expect(result.conversationId).toBe(CONVERSATION_ID);
      // Appended, not replaced: the earlier turn is still the first one.
      const saved = vi.mocked(assistantRepository.saveConversation).mock
        .calls[0]![1] as { turns: { text: string }[] };
      expect(saved.turns).toHaveLength(3);
      expect(saved.turns[0]!.text).toBe("earlier");
    });
  });

  describe("chat", () => {
    it("says the assistant isn't configured rather than failing obscurely", async () => {
      vi.mocked(assistant.getAssistant).mockReturnValue(null);

      const { chat, AssistantUnavailableError } =
        await import("./assistant.service.js");

      await expect(
        chat(auth(), { message: "hello", attachmentIds: [] }),
      ).rejects.toThrow(AssistantUnavailableError);
    });

    it("turns a claim reference in a proposal back into a claim id", async () => {
      // What the model actually did the first time this ran end to end:
      // proposed claim_id "CLM-0001", because that is what a human says.
      vi.mocked(assistant.getAssistant).mockReturnValue({
        run: vi.fn().mockResolvedValue({
          reply: "This belongs to CLM-0001.",
          proposals: [
            {
              id: "toolu_1",
              kind: "file_document",
              input: {
                attachment_id: ATTACHMENT_ID,
                claim_id: "CLM-0001",
                checklist_slot: "Ultrasound report (abdomen)",
              },
            },
          ],
          transcript: [],
        }),
      } as never);
      vi.mocked(claimsService.listClaims).mockResolvedValue([
        { id: CLAIM_ID, reference: "CLM-0001" },
      ] as never);

      const { chat } = await import("./assistant.service.js");
      vi.mocked(assistantRepository.createConversation).mockResolvedValue(
        conversation(),
      );
      const result = await chat(auth(), {
        message: "where does this go?",
        attachmentIds: [],
      });

      expect(result.proposals[0]!.input.claim_id).toBe(CLAIM_ID);
    });

    it("leaves a reference it can't resolve alone, so approval refuses it rather than guessing", async () => {
      vi.mocked(assistant.getAssistant).mockReturnValue({
        run: vi.fn().mockResolvedValue({
          reply: "...",
          proposals: [
            {
              id: "toolu_1",
              kind: "file_document",
              input: { attachment_id: ATTACHMENT_ID, claim_id: "CLM-9999" },
            },
          ],
          transcript: [],
        }),
      } as never);
      vi.mocked(claimsService.listClaims).mockResolvedValue([
        { id: CLAIM_ID, reference: "CLM-0001" },
      ] as never);

      const { chat } = await import("./assistant.service.js");
      vi.mocked(assistantRepository.createConversation).mockResolvedValue(
        conversation(),
      );
      const result = await chat(auth(), {
        message: "file it",
        attachmentIds: [],
      });

      expect(result.proposals[0]!.input.claim_id).toBe("CLM-9999");
    });

    it("won't describe an attachment belonging to someone else", async () => {
      vi.mocked(assistant.getAssistant).mockReturnValue({
        run: vi.fn(),
      } as never);
      vi.mocked(assistantRepository.getById).mockResolvedValue(
        attachment({ uploadedBy: OTHER_MEMBER_ID }),
      );

      const { chat, AttachmentNotFoundError } =
        await import("./assistant.service.js");

      await expect(
        chat(auth(), {
          message: "file this",
          attachmentIds: [ATTACHMENT_ID],
        }),
      ).rejects.toThrow(AttachmentNotFoundError);
    });
  });
});
