import { beforeEach, describe, expect, it, vi } from "vitest";
import * as checklistService from "../checklist/checklist.service.js";
import * as claimsService from "../claims/claims.service.js";
import * as deductionsService from "../deductions/deductions.service.js";
import * as documentsService from "../documents/documents.service.js";
import * as preauthService from "../preauth/preauth.service.js";
import * as queriesService from "../queries/queries.service.js";
import * as slaService from "../sla/sla.service.js";
import {
  ASSISTANT_TOOLS,
  canManageRules,
  executeReadTool,
  isProposalKind,
  isReadTool,
  PROPOSAL_KINDS,
  toolsFor,
} from "./assistant.tools.js";

vi.mock("../checklist/checklist.service.js");
vi.mock("../claims/claims.service.js");
vi.mock("../deductions/deductions.service.js");
vi.mock("../documents/documents.service.js");
vi.mock("../preauth/preauth.service.js");
vi.mock("../queries/queries.service.js");
vi.mock("../sla/sla.service.js");

const CLAIM_ID = "33333333-3333-3333-3333-333333333333";

function auth(role: "desk_executive" | "desk_head" = "desk_head") {
  return { userId: "22222222-2222-2222-2222-222222222222", role };
}

describe("assistant.tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * The whole safety argument rests on this partition. A write tool
   * that also answered true to isReadTool would be executed inside the
   * conversation loop instead of becoming a card — the model would be
   * able to act, which is the one thing the design says it cannot do.
   */
  describe("the read/write split", () => {
    it("no proposal kind is executable as a read tool", () => {
      for (const kind of PROPOSAL_KINDS) {
        expect(isReadTool(kind)).toBe(false);
        expect(isProposalKind(kind)).toBe(true);
      }
    });

    it("every tool offered to the model is exactly one of the two", () => {
      for (const tool of ASSISTANT_TOOLS) {
        expect(isReadTool(tool.name) !== isProposalKind(tool.name)).toBe(true);
      }
    });

    it("executing a write tool as a read is refused outright", async () => {
      await expect(
        executeReadTool(auth(), "file_document", {}),
      ).rejects.toThrow(/not a read tool/);
    });
  });

  describe("what each role is offered", () => {
    it("doesn't offer a desk executive a tool they'd only be refused on", () => {
      const names = toolsFor("desk_executive").map((t) => t.name);
      expect(names).not.toContain("add_checklist_slot");
      // Withholds one card; it is not a read-only mode.
      expect(names).toContain("file_document");
      expect(names).toContain("search_claims");
    });

    it("offers the checklist tool to the roles the admin route allows", () => {
      for (const role of ["desk_head", "org_admin"] as const) {
        expect(canManageRules(role)).toBe(true);
        expect(toolsFor(role).map((t) => t.name)).toContain(
          "add_checklist_slot",
        );
      }
      expect(canManageRules("desk_executive")).toBe(false);
    });
  });

  describe("read tools go through the services, not the repositories", () => {
    it("search_claims filters what the service already scoped to the user", async () => {
      vi.mocked(claimsService.listClaims).mockResolvedValue([
        {
          id: CLAIM_ID,
          reference: "CLM-0001",
          patientName: "Rajendra Pawar",
          procedureName: "Gall bladder removal",
          insurerName: "Company B",
          status: "QUERY_RAISED",
        },
        {
          id: "other",
          reference: "CLM-0002",
          patientName: "Sunita Deshpande",
          procedureName: "Cataract",
          insurerName: "Star Health",
          status: "SETTLED",
        },
      ] as never);

      const result = (await executeReadTool(
        auth("desk_executive"),
        "search_claims",
        {
          query: "pawar",
        },
      )) as { count: number; claims: { reference: string }[] };

      // The service is the role boundary (docs/adr/0002). Reaching past
      // it into claims.repository would hand a desk executive the whole
      // desk's claims through a chat window.
      expect(claimsService.listClaims).toHaveBeenCalled();
      expect(result.count).toBe(1);
      expect(result.claims[0]!.reference).toBe("CLM-0001");
    });

    it("get_claim shows this claim's snapshot and today's rules as separate lists", async () => {
      vi.mocked(claimsService.getClaim).mockResolvedValue({
        id: CLAIM_ID,
        insurerId: "i1",
        procedureId: "p1",
        checklistSnapshot: [{ documentType: "Photo ID proof" }],
      } as never);
      vi.mocked(claimsService.getClaimGaps).mockResolvedValue({
        missing: [],
        satisfied: [],
      } as never);
      vi.mocked(checklistService.listRules).mockResolvedValue({
        rules: [
          { documentType: "Photo ID proof" },
          { documentType: "Cost estimate" },
        ],
        activeClaims: 1,
      } as never);

      const result = (await executeReadTool(auth(), "get_claim", {
        claim_id: CLAIM_ID,
      })) as Record<string, string[]>;

      // The difference between the two is what tells the model "that
      // slot exists, this claim just predates it" — without it, it
      // proposes a rule that is already there and the desk gets a card
      // that can only 409.
      expect(result.checklist_slots).toEqual(["Photo ID proof"]);
      expect(result.checklist_rules_for_new_claims).toEqual([
        "Photo ID proof",
        "Cost estimate",
      ]);
    });

    it("get_claim lets the service's refusal through rather than softening it", async () => {
      const notFound = new Error("no such claim");
      vi.mocked(claimsService.getClaim).mockRejectedValue(notFound);

      await expect(
        executeReadTool(auth("desk_executive"), "get_claim", {
          claim_id: CLAIM_ID,
        }),
      ).rejects.toThrow(notFound);
    });

    it("get_sla_watch returns the worst clocks first, not the whole list", async () => {
      vi.mocked(slaService.getSlaWatch).mockResolvedValue({
        breached: 1,
        dueSoon: 0,
        breachedOnInsurer: 0,
        items: Array.from({ length: 30 }, (_, n) => ({
          claimId: `c${n}`,
          reference: `CLM-${n}`,
          patientName: "P",
          insurerName: "I",
          status: "QUERY_RAISED",
          state: "breached",
          remainingMs: -3_600_000,
          owedBy: "hospital",
        })),
      } as never);

      const result = (await executeReadTool(auth(), "get_sla_watch", {})) as {
        claims: { hours_remaining: number }[];
      };

      expect(result.claims).toHaveLength(20);
      expect(result.claims[0]!.hours_remaining).toBe(-1);
    });

    it("get_deduction_risk checks the claim is this user's before reading history", async () => {
      vi.mocked(claimsService.getClaim).mockRejectedValue(
        new Error("no such claim"),
      );

      await expect(
        executeReadTool(auth("desk_executive"), "get_deduction_risk", {
          claim_id: CLAIM_ID,
        }),
      ).rejects.toThrow("no such claim");

      // assessRisk reads the claim through the repository, so without
      // this gate the tool would answer for a claim the user would be
      // refused on the claims list.
      expect(deductionsService.assessRisk).not.toHaveBeenCalled();
    });

    it("get_deduction_risk says thin history is thin, rather than returning no risks", async () => {
      vi.mocked(claimsService.getClaim).mockResolvedValue({
        id: CLAIM_ID,
      } as never);
      vi.mocked(deductionsService.assessRisk).mockResolvedValue({
        scope: "insurer",
        claimsConsidered: 1,
        enoughHistory: false,
        risks: [],
      } as never);

      const result = (await executeReadTool(auth(), "get_deduction_risk", {
        claim_id: CLAIM_ID,
      })) as { enough_history: boolean; note?: string };

      // An empty risk list and "nothing is known" look identical to a
      // model unless the difference is spelled out.
      expect(result.enough_history).toBe(false);
      expect(result.note).toMatch(/clean bill of health/i);
    });

    it("run_presubmission_review carries whether the clinical half actually ran", async () => {
      vi.mocked(claimsService.getClaim).mockResolvedValue({
        id: CLAIM_ID,
      } as never);
      vi.mocked(preauthService.reviewClaimForm).mockResolvedValue({
        findings: [],
        blockers: 0,
        warnings: 0,
        clinicalReviewRan: false,
      } as never);

      const result = (await executeReadTool(
        auth(),
        "run_presubmission_review",
        { claim_id: CLAIM_ID },
      )) as { clinical_review_ran: boolean };

      // Rules passing with the model half skipped is not a clean
      // review, and dropping this flag would let it be reported as one.
      expect(result.clinical_review_ran).toBe(false);
    });

    it("says a status the way a person would, and keeps the code for filtering", async () => {
      vi.mocked(claimsService.listClaims).mockResolvedValue([
        {
          id: CLAIM_ID,
          reference: "CLM-0001",
          patientName: "Rajendra Pawar",
          procedureName: "Gall bladder removal",
          insurerName: "Company B",
          status: "FINAL_BILL_SUBMITTED",
        },
      ] as never);

      const result = (await executeReadTool(auth(), "search_claims", {})) as {
        claims: { status: string; status_code: string }[];
      };

      // The assistant was quoting FINAL_BILL_SUBMITTED at desk staff,
      // which is the database talking rather than a colleague.
      expect(result.claims[0]!.status).toBe("final bill submitted");
      expect(result.claims[0]!.status_code).toBe("FINAL_BILL_SUBMITTED");
    });

    it("list_documents names the file a desk uploaded, not the storage key", async () => {
      vi.mocked(claimsService.getClaim).mockResolvedValue({
        id: CLAIM_ID,
      } as never);
      vi.mocked(documentsService.listDocuments).mockResolvedValue([
        {
          id: "doc-1",
          fileUrl:
            "claims/33/9c3dc451-da7a-4a0b-93c0-14740f813e43-Estimate_Pawar_GB.jpg",
          checklistSlot: "Cost estimate",
          confirmedAt: new Date("2026-11-05T12:00:00Z"),
          createdAt: new Date("2026-11-05T11:59:00Z"),
          classifiedBy: "claude",
        },
      ] as never);

      const result = (await executeReadTool(auth(), "list_documents", {
        claim_id: CLAIM_ID,
      })) as { documents: { file_name: string; confirmed: boolean }[] };

      // The point of the tool: spotting that this exact file has been
      // filed before, which needs the name a human recognises.
      expect(result.documents[0]!.file_name).toBe("Estimate_Pawar_GB.jpg");
      expect(result.documents[0]!.confirmed).toBe(true);
    });

    it("list_documents checks the claim is this user's first", async () => {
      vi.mocked(claimsService.getClaim).mockRejectedValue(
        new Error("no such claim"),
      );

      await expect(
        executeReadTool(auth("desk_executive"), "list_documents", {
          claim_id: CLAIM_ID,
        }),
      ).rejects.toThrow("no such claim");
      expect(documentsService.listDocuments).not.toHaveBeenCalled();
    });

    it("refuses a desk executive the hospital's figures", async () => {
      for (const tool of [
        "get_deduction_summary",
        "get_insurer_turnaround",
        "get_appeal_worklist",
      ]) {
        await expect(
          executeReadTool(auth("desk_executive"), tool, {}),
        ).rejects.toThrow(/desk head or an admin/);
      }
      // A desk executive is scoped to their own claims everywhere else;
      // hospital-wide leakage through a chat window would undo that.
      expect(deductionsService.summarise).not.toHaveBeenCalled();
    });

    it("doesn't even offer them to a desk executive", () => {
      const names = toolsFor("desk_executive").map((t) => t.name);
      expect(names).not.toContain("get_deduction_summary");
      expect(names).not.toContain("get_insurer_turnaround");
      // Claim-scoped money is still theirs to ask about.
      expect(names).toContain("get_claim_financials");
      expect(toolsFor("desk_head").map((t) => t.name)).toContain(
        "get_deduction_summary",
      );
    });

    it("get_deduction_summary leads with the avoidable share", async () => {
      vi.mocked(deductionsService.summarise).mockResolvedValue({
        total: 120000,
        avoidableTotal: 78000,
        recoveredTotal: 12000,
        byReason: [
          { reason: "missing_document", total: 78000, count: 4, recovered: 0 },
        ],
      } as never);

      const result = (await executeReadTool(
        auth("desk_head"),
        "get_deduction_summary",
        {},
      )) as { avoidable_total: number; by_reason: unknown[] };

      // The number the product exists to move — adr 0011's premise is
      // that most of what an insurer cuts is paperwork.
      expect(result.avoidable_total).toBe(78000);
      expect(result.by_reason).toHaveLength(1);
    });

    it("list_queries defaults to the open ones", async () => {
      vi.mocked(queriesService.listInbox).mockResolvedValue([] as never);

      await executeReadTool(auth(), "list_queries", {});

      expect(queriesService.listInbox).toHaveBeenCalledWith(expect.anything(), {
        status: "open",
      });
    });
  });
});
