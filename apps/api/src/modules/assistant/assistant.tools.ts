import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { CLAIM_STATUS_LABEL, type Role } from "@claimflow/contracts";
import * as checklistService from "../checklist/checklist.service.js";
import * as claimsService from "../claims/claims.service.js";
import * as deductionsService from "../deductions/deductions.service.js";
import * as documentsService from "../documents/documents.service.js";
import * as preauthService from "../preauth/preauth.service.js";
import * as receivablesService from "../receivables/receivables.service.js";
import * as slaService from "../sla/sla.service.js";
import * as queriesService from "../queries/queries.service.js";

/**
 * What the assistant can do, split along the only line that matters:
 * whether running it changes anything.
 *
 * **Read tools execute immediately.** They go through the same service
 * functions the HTTP routes call, so a desk executive asking the
 * assistant about a claim gets exactly the claims a desk executive can
 * see — the role filtering in claims.service is the boundary, and
 * reaching past it into the repositories would quietly route around
 * docs/adr/0002.
 *
 * **Write tools are never executed by the model.** Emitting one
 * produces a proposal card the human approves, and the approval goes
 * back through the ordinary audited service. That is docs/adr/0005's
 * rule — a suggestion isn't a value until a human says so — applied to
 * actions rather than fields. The model cannot act; it can only ask.
 */

export interface AuthContext {
  userId: string;
  role: Role;
}

// --- read tools ------------------------------------------------------

const READ_TOOLS: Anthropic.Tool[] = [
  {
    name: "search_claims",
    description:
      "List the claims this user can see, optionally filtered. Use this to resolve a patient name or a claim reference to a claim id before any other tool.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Free text matched against patient name, claim reference, procedure and insurer. Omit to list everything.",
        },
        status: {
          type: "string",
          description:
            "Exact claim status, e.g. QUERY_RAISED, PRE_AUTH_SENT, SETTLED. Omit for any.",
        },
      },
    },
  },
  {
    name: "get_claim",
    description:
      "Full detail for one claim: status, money, and which required checklist documents are still missing.",
    input_schema: {
      type: "object",
      properties: { claim_id: { type: "string" } },
      required: ["claim_id"],
    },
  },
  {
    name: "get_sla_watch",
    description:
      "Claims against the clock right now, worst first: which are already breached, which are due soon, and whether the hospital or the insurer owes the next move. Use this for 'what should I do next' — a query inbox alone doesn't answer it.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_deduction_risk",
    description:
      "What this claim is likely to be cut for, from this hospital's own settled history with this insurer and procedure. No model involved — counts over deductions the desk recorded itself, so every warning carries its evidence. Use it before a claim is submitted, while the paperwork can still change.",
    input_schema: {
      type: "object",
      properties: { claim_id: { type: "string" } },
      required: ["claim_id"],
    },
  },
  {
    name: "run_presubmission_review",
    description:
      "Check a claim's confirmed pre-auth form before it goes to the insurer. Returns blockers and warnings from the deterministic rules (dates, sums, missing identifiers) plus a clinical read of contradictions between fields. Changes nothing. Costs a model call, so run it when asked rather than in passing.",
    input_schema: {
      type: "object",
      properties: { claim_id: { type: "string" } },
      required: ["claim_id"],
    },
  },
  {
    name: "get_deduction_summary",
    description:
      "What the hospital lost to deductions over a period, by reason, with the avoidable share and what was recovered on appeal. The CFO question: how much of this was paperwork rather than clinical dispute.",
    input_schema: {
      type: "object",
      properties: {
        since: {
          type: "string",
          description: "ISO date. Defaults to the last 90 days.",
        },
        until: { type: "string", description: "ISO date. Defaults to now." },
      },
    },
  },
  {
    name: "get_receivables_ageing",
    description:
      "What the hospital is owed and how long it has been owed: outstanding amounts bucketed 0-30/31-60/61-90/90+ days since the final bill went in, split by insurer, with the oldest unpaid claims. The cash-timing question — approved money that hasn't arrived.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_insurer_turnaround",
    description:
      "How long each insurer actually takes to decide, against the window they are supposed to. Decisions, average and worst hours, and breaches, per insurer. This is the report a hospital takes into a renewal negotiation.",
    input_schema: {
      type: "object",
      properties: {
        since: {
          type: "string",
          description: "ISO date. Defaults to the last 90 days.",
        },
      },
    },
  },
  {
    name: "get_claim_financials",
    description:
      "One claim's money properly worked out: what the insurer sanctioned, what the hospital expects to spend and billed, what was cut, and the resulting shortfall. Use this rather than the raw amounts on get_claim when the question is about money.",
    input_schema: {
      type: "object",
      properties: { claim_id: { type: "string" } },
      required: ["claim_id"],
    },
  },
  {
    name: "get_appeal_worklist",
    description:
      "Deductions worth contesting, and how past appeals went. Money already lost that could still come back.",
    input_schema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          description:
            "Filter by appeal status, e.g. NOT_CONTESTED for what hasn't been fought yet. Omit for all.",
        },
      },
    },
  },
  {
    name: "list_documents",
    description:
      "Every document on a claim: which slot it sits in, the filename it came from, when it was filed and whether anyone confirmed it. Use it before saying a document is or isn't there — the checklist only says a slot is satisfied, not what satisfied it, so this is the only way to spot that a file has already been filed once.",
    input_schema: {
      type: "object",
      properties: { claim_id: { type: "string" } },
      required: ["claim_id"],
    },
  },
  {
    name: "list_queries",
    description:
      "TPA queries across claims — what each insurer asked for, the reply deadline, and whether it has been answered.",
    input_schema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["open", "replied", "all"],
          description: "Defaults to open.",
        },
      },
    },
  },
];

const SearchClaimsInput = z.object({
  query: z.string().optional(),
  status: z.string().optional(),
});
const GetClaimInput = z.object({ claim_id: z.string().uuid() });
const ClaimIdInput = z.object({ claim_id: z.string().uuid() });
const PeriodInput = z.object({
  since: z.coerce.date().optional(),
  until: z.coerce.date().optional(),
});

/** Ninety days: long enough for a pattern, short enough to still be this year's. */
const DEFAULT_PERIOD_DAYS = 90;

function periodStart(since: Date | undefined): Date {
  return since ?? new Date(Date.now() - DEFAULT_PERIOD_DAYS * 86_400_000);
}
const ListQueriesInput = z.object({
  status: z.enum(["open", "replied", "all"]).default("open"),
});

/** Strips the uuid prefix buildObjectKey adds, back to what was uploaded. */
function displayFileName(key: string): string {
  const base = key.split("/").pop() ?? key;
  return base.replace(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/,
    "",
  );
}

/** Everything a search match could sensibly be typed against. */
function claimHaystack(claim: {
  reference: string | null;
  patientName: string;
  procedureName: string;
  insurerName: string;
}): string {
  return [
    claim.reference ?? "",
    claim.patientName,
    claim.procedureName,
    claim.insurerName,
  ]
    .join(" ")
    .toLowerCase();
}

export function isReadTool(name: string): boolean {
  return READ_TOOLS.some((tool) => tool.name === name);
}

/**
 * Runs one read tool and returns what the model should see.
 *
 * Deliberately narrow output: the model gets the fields a desk question
 * could need and not whole rows. A smaller payload is cheaper, but the
 * reason that matters is that everything returned here can end up
 * quoted back to the user, so the tool should only carry what it would
 * be fine to say out loud.
 */
export async function executeReadTool(
  auth: AuthContext,
  name: string,
  rawInput: unknown,
): Promise<unknown> {
  // The money questions are the hospital's, not one desk's. Withheld
  // from the tool list too, but this is the gate — the list is a
  // courtesy and calling a service directly would walk past it.
  if (PORTFOLIO_TOOLS.has(name) && !canManageRules(auth.role)) {
    throw new Error(
      "Only a desk head or an admin can see the hospital's figures.",
    );
  }

  switch (name) {
    case "search_claims": {
      const input = SearchClaimsInput.parse(rawInput ?? {});
      const claims = await claimsService.listClaims(auth, {
        ...(input.status ? { status: input.status as never } : {}),
        scope: "all",
      });
      const needle = input.query?.trim().toLowerCase();
      const matched = needle
        ? claims.filter((c) => claimHaystack(c).includes(needle))
        : claims;
      return {
        count: matched.length,
        claims: matched.slice(0, 40).map((c) => ({
          claim_id: c.id,
          reference: c.reference,
          patient_name: c.patientName,
          procedure: c.procedureName,
          insurer: c.insurerName,
          status: CLAIM_STATUS_LABEL[c.status],
          // Both, because the two are for different readers: the label
          // ends up in a sentence to desk staff, the code is what this
          // tool's own `status` filter takes.
          status_code: c.status,
        })),
      };
    }

    case "get_claim": {
      const input = GetClaimInput.parse(rawInput);
      // getClaim throws ClaimNotFoundError for a desk executive who
      // isn't assigned to it, which is the right answer to give the
      // model too — "no such claim", not "not allowed".
      const claim = await claimsService.getClaim(auth, input.claim_id);
      const [gaps, rulesNow] = await Promise.all([
        claimsService.getClaimGaps(auth, input.claim_id),
        checklistService.listRules(auth, claim.insurerId, claim.procedureId),
      ]);
      return {
        claim_id: claim.id,
        reference: claim.reference,
        patient_name: claim.patientName,
        procedure: claim.procedureName,
        insurer: claim.insurerName,
        status: CLAIM_STATUS_LABEL[claim.status],
        status_code: claim.status,
        admitted_at: claim.admittedAt,
        billed_amount: claim.billedAmount,
        sanctioned_amount: claim.sanctionedAmount,
        settled_amount: claim.settledAmount,
        missing_required_documents: gaps.missing,
        documents_on_file: gaps.satisfied,
        // Two different lists, and the difference is the point. The
        // snapshot is what THIS claim was opened against and can never
        // change (docs/adr/0001); the rules are what a claim opened
        // today would get. Without both, the model cannot tell "there
        // is no such slot" from "the slot exists, just not here", and
        // would propose a rule that already exists.
        checklist_slots: claim.checklistSnapshot.map((i) => i.documentType),
        checklist_rules_for_new_claims: rulesNow.rules.map(
          (r) => r.documentType,
        ),
      };
    }

    /**
     * The worklist "what should I do next" actually needs.
     *
     * Deliberately unscoped by role, matching /sla/watch: the comment
     * on that route is that a desk exec watching a patient wait at
     * discharge needs this most. Exposing it here widens nothing.
     */
    case "get_sla_watch": {
      const watch = await slaService.getSlaWatch(auth);
      return {
        breached: watch.breached,
        due_soon: watch.dueSoon,
        breached_on_insurer: watch.breachedOnInsurer,
        // Already sorted worst-first by the service; the tail is claims
        // with days left, which is not what the question is about.
        claims: watch.items.slice(0, 20).map((i) => ({
          claim_id: i.claimId,
          reference: i.reference,
          patient_name: i.patientName,
          insurer: i.insurerName,
          status: CLAIM_STATUS_LABEL[i.status],
          state: i.state,
          hours_remaining:
            i.remainingMs === null
              ? null
              : Math.round(i.remainingMs / 3_600_000),
          owed_by: i.owedBy,
        })),
      };
    }

    case "get_deduction_risk": {
      const input = ClaimIdInput.parse(rawInput);
      // assessRisk reads the claim through the repository, so the role
      // filter is not on its path. Gating here keeps the tool's scope
      // from depending on a detail of someone else's function.
      await claimsService.getClaim(auth, input.claim_id);

      const assessment = await deductionsService.assessRisk(
        auth,
        input.claim_id,
      );
      if (!assessment.enoughHistory) {
        return {
          enough_history: false,
          claims_considered: assessment.claimsConsidered,
          note: "Too little settled history with this insurer to say anything. Don't infer a clean bill of health from it.",
        };
      }
      return {
        enough_history: true,
        // Said out loud because "this insurer cuts for X" and "this
        // insurer cuts for X on this procedure" are different claims,
        // and the narrower one is the one that sounds authoritative.
        based_on: assessment.scope,
        claims_considered: assessment.claimsConsidered,
        risks: assessment.risks.slice(0, 8).map((r) => ({
          reason: r.reason,
          avoidable: r.avoidable,
          claims_affected: r.claimsAffected,
          average_per_claim: Math.round(r.averagePerClaim),
          expected_cost: Math.round(r.expectedCost),
          // The live join: history says this insurer cuts for missing
          // documents and the claim is missing these right now.
          open_gaps: r.openGaps,
        })),
      };
    }

    case "run_presubmission_review": {
      const input = ClaimIdInput.parse(rawInput);
      // Same reason as above: reviewClaimForm reads the claim through
      // the repository, so the scoping is added here rather than
      // assumed.
      await claimsService.getClaim(auth, input.claim_id);

      const review = await preauthService.reviewClaimForm(auth, input.claim_id);
      return {
        blockers: review.blockers,
        warnings: review.warnings,
        // Matters when reporting a clean result: the rules passing with
        // the clinical half skipped is not the same as a clean review,
        // and saying "no problems found" without this would overstate it.
        clinical_review_ran: review.clinicalReviewRan,
        findings: review.findings.map((f) => ({
          severity: f.severity,
          fields: f.fieldKeys,
          message: f.message,
          source: f.source,
        })),
      };
    }

    /**
     * What the gap view deliberately cannot say.
     *
     * `get_claim` reports that a slot is satisfied; it has never
     * reported *what* satisfied it. That gap is why a re-uploaded file
     * produced a paragraph of careful hedging about duplicates and
     * different patients, when the useful answer was "you filed this
     * exact file on the 5th".
     */
    case "get_deduction_summary": {
      const input = PeriodInput.parse(rawInput ?? {});
      const since = periodStart(input.since);
      const summary = await deductionsService.summarise(
        auth,
        since,
        input.until,
      );
      return {
        since: since.toISOString().slice(0, 10),
        until: (input.until ?? new Date()).toISOString().slice(0, 10),
        total: Math.round(summary.total),
        // The number the product exists to move — docs/adr/0011's
        // premise is that most of what an insurer cuts is paperwork.
        avoidable_total: Math.round(summary.avoidableTotal),
        recovered_total: Math.round(summary.recoveredTotal),
        by_reason: summary.byReason.map((r) => ({
          reason: r.reason,
          total: Math.round(r.total),
          claims: r.count,
          recovered: Math.round(r.recovered),
        })),
      };
    }

    case "get_receivables_ageing": {
      const report = await receivablesService.getAgeing(auth);
      return {
        total_outstanding: Math.round(report.total),
        claims: report.claims,
        buckets: report.buckets.map((b) => ({
          age: b.label,
          claims: b.claims,
          total: Math.round(b.total),
        })),
        by_insurer: report.byInsurer.slice(0, 15).map((i) => ({
          insurer: i.insurerName,
          claims: i.claims,
          total: Math.round(i.total),
          oldest_days: i.oldestDays,
        })),
        oldest_claims: report.oldest.slice(0, 10).map((c) => ({
          claim_id: c.claimId,
          reference: c.reference,
          patient_name: c.patientName,
          insurer: c.insurerName,
          days_outstanding: c.days,
          outstanding: Math.round(c.outstanding),
        })),
      };
    }

    case "get_insurer_turnaround": {
      const input = PeriodInput.parse(rawInput ?? {});
      const since = periodStart(input.since);
      const report = await slaService.getTurnaroundReport(auth, since);
      return {
        since: since.toISOString().slice(0, 10),
        rows: report.rows.slice(0, 30).map((r) => ({
          insurer: r.insurerName,
          from_status: CLAIM_STATUS_LABEL[r.fromStatus],
          decisions: r.decisions,
          average_hours: Math.round(r.avgHours),
          worst_hours: Math.round(r.worstHours),
          breaches: r.breaches,
          breach_rate: Number(r.breachRate.toFixed(2)),
          target_hours: r.targetHours,
        })),
      };
    }

    case "get_claim_financials": {
      const input = ClaimIdInput.parse(rawInput);
      const money = await claimsService.getClaimFinancials(
        auth,
        input.claim_id,
      );
      return money;
    }

    case "get_appeal_worklist": {
      const input = z
        .object({ status: z.string().optional() })
        .parse(rawInput ?? {});
      const rows = await deductionsService.listAppealWorklist(auth, {
        ...(input.status ? { status: input.status as never } : {}),
      });
      return { count: rows.length, deductions: rows.slice(0, 30) };
    }

    case "list_documents": {
      const input = ClaimIdInput.parse(rawInput);
      await claimsService.getClaim(auth, input.claim_id);

      const documents = await documentsService.listDocuments(
        auth,
        input.claim_id,
      );
      return {
        count: documents.length,
        documents: documents.map((d) => ({
          document_id: d.id,
          // The uuid prefix the storage key carries is noise to a
          // reader; what they recognise is what they uploaded.
          file_name: displayFileName(d.fileUrl),
          // What to put in a markdown link so the name is openable.
          // A scheme rather than a URL because a real download link is
          // pre-signed and short-lived — the panel resolves this one
          // when someone actually clicks it.
          link: `document:${input.claim_id}/${d.id}`,
          slot: d.checklistSlot,
          confirmed: Boolean(d.confirmedAt),
          filed_at: d.confirmedAt ?? d.createdAt,
          classified_by: d.classifiedBy,
        })),
      };
    }

    case "list_queries": {
      const input = ListQueriesInput.parse(rawInput ?? {});
      const queries = await queriesService.listInbox(auth, {
        status: input.status,
      });
      return {
        count: queries.length,
        queries: queries.slice(0, 40).map((q) => ({
          query_id: q.id,
          claim_id: q.claimId,
          reference: q.claimReference,
          patient_name: q.claimPatientName,
          insurer: q.insurerName,
          summary: q.aiSummary,
          requested_items: q.requestedItems,
          deadline: q.deadline,
          deadline_confirmed: Boolean(q.deadlineConfirmedAt),
          replied_at: q.replySentAt,
        })),
      };
    }

    default:
      throw new Error(`not a read tool: ${name}`);
  }
}

// --- write tools, which are only ever proposals ----------------------

/**
 * Questions about the hospital's money rather than one claim's paperwork.
 *
 * Gated to the roles the deductions admin routes gate on. A desk
 * executive is scoped to their own claims everywhere else in this
 * product; handing them hospital-wide leakage and insurer performance
 * through a chat window would be a quieter way of undoing that.
 */
const PORTFOLIO_TOOLS = new Set([
  "get_receivables_ageing",
  "get_deduction_summary",
  "get_insurer_turnaround",
  "get_appeal_worklist",
]);

export const PROPOSAL_KINDS = [
  "file_document",
  "log_query",
  "mark_query_replied",
  "confirm_query_deadline",
  "add_checklist_slot",
  "file_as_new_slot",
  "open_appeal",
] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];

/**
 * Proposals only a desk head or org admin is offered.
 *
 * Was a single `!==` in `toolsFor`. `open_appeal` makes two, and a
 * chain of name comparisons is how the third one gets forgotten —
 * especially since the gate that matters is in assistant.service, so a
 * miss here fails silently as a card nobody can click.
 */
const DESK_HEAD_WRITES = new Set<string>(["add_checklist_slot", "open_appeal"]);

const WRITE_TOOLS: Anthropic.Tool[] = [
  {
    name: "file_document",
    description:
      "Propose filing one attachment the user uploaded onto a claim, in a named checklist slot. The user must approve before anything is filed.",
    input_schema: {
      type: "object",
      properties: {
        attachment_id: {
          type: "string",
          description: "The id of an attachment from this conversation.",
        },
        claim_id: { type: "string" },
        checklist_slot: {
          type: "string",
          description:
            "One of that claim's checklist slots, copied verbatim from get_claim.",
        },
      },
      required: ["attachment_id", "claim_id", "checklist_slot"],
    },
  },
  {
    name: "log_query",
    description:
      "Propose logging a TPA query against a claim from an email the user pasted. The user must approve before it is logged.",
    input_schema: {
      type: "object",
      properties: {
        claim_id: { type: "string" },
        tpa_raw_email: {
          type: "string",
          description:
            "The email text exactly as the user gave it. Never paraphrase it — the original is the record.",
        },
      },
      required: ["claim_id", "tpa_raw_email"],
    },
  },
  {
    name: "file_as_new_slot",
    description:
      "Propose adding a slot to THIS ONE CLAIM and filing an attachment into it. Use when a document plainly belongs to a claim but none of that claim's slots fit — this is the one that actually gets the document onto the claim in hand. It does not change the checklist for any other claim; add_checklist_slot is the separate, forward-looking fix for that.",
    input_schema: {
      type: "object",
      properties: {
        attachment_id: { type: "string" },
        claim_id: { type: "string" },
        checklist_slot: {
          type: "string",
          description:
            "What to call the new slot, as a desk would name it on a checklist — e.g. 'Cost estimate'. Short, singular, no punctuation.",
        },
      },
      required: ["attachment_id", "claim_id", "checklist_slot"],
    },
  },
  {
    name: "add_checklist_slot",
    description:
      "Propose adding a document type to the checklist for this claim's insurer and procedure. Use when a document clearly belongs to a claim but none of that claim's slots fit it — the checklist is probably the thing that's wrong. Say plainly that this applies to claims opened from now on and does NOT open a slot on the claim in hand.",
    input_schema: {
      type: "object",
      properties: {
        claim_id: {
          type: "string",
          description:
            "The claim whose insurer and procedure pair the slot should be added to.",
        },
        document_type: {
          type: "string",
          description:
            "What the slot should be called, as a desk would name it on a checklist — e.g. 'Cost estimate'. Short, singular, no punctuation.",
        },
      },
      required: ["claim_id", "document_type"],
    },
  },
  {
    name: "open_appeal",
    /*
      The one proposal that comes from a portfolio read rather than a
      claim in hand, and the only one that acts on more than one thing
      at a time. docs/adr/0013 exists because nobody schedules appeal
      work -- a card that opens one deduction at a time against a
      backlog of forty is the same invisibility with an extra click, so
      this takes a list. The cap is what a desk can actually read
      before approving; an approval nobody read is not an approval.
    */
    description:
      "Propose opening appeals on deductions the hospital has not contested. Takes several at once, from get_appeal_worklist. Pick the ones actually worth contesting — the biggest, or the ones whose reason this insurer has given back before — and say why you chose them. Never a note: the argument to the insurer is the desk's to write. The user must approve before any appeal is opened.",
    input_schema: {
      type: "object",
      properties: {
        deduction_ids: {
          type: "array",
          items: { type: "string" },
          description:
            "Deduction ids from get_appeal_worklist, at most ten, each still NOT_CONTESTED.",
        },
      },
      required: ["deduction_ids"],
    },
  },
  {
    name: "mark_query_replied",
    description:
      "Propose recording that a reply to a TPA query has been sent. This only records that it went out through some other channel — nothing is sent from here.",
    input_schema: {
      type: "object",
      properties: { query_id: { type: "string" } },
      required: ["query_id"],
    },
  },
  {
    name: "confirm_query_deadline",
    description:
      "Propose confirming, correcting or clearing the reply deadline on a TPA query.",
    input_schema: {
      type: "object",
      properties: {
        query_id: { type: "string" },
        deadline: {
          type: ["string", "null"],
          description:
            "ISO 8601 timestamp to set, or null to record that the email sets no deadline. Omit to confirm the stored one unchanged.",
        },
      },
      required: ["query_id"],
    },
  },
];

/**
 * Re-validated server-side at approval, not trusted from the model.
 *
 * The model's tool input is a *suggested payload* and nothing more. It
 * arrives again on the approval request, gets parsed here, and only
 * then reaches a service — so a malformed or invented field fails at
 * the same gate a hand-crafted HTTP request would.
 */
export const PROPOSAL_INPUT = {
  file_document: z.object({
    attachment_id: z.string().uuid(),
    claim_id: z.string().uuid(),
    checklist_slot: z.string().min(1),
  }),
  log_query: z.object({
    claim_id: z.string().uuid(),
    tpa_raw_email: z.string().min(1),
  }),
  mark_query_replied: z.object({ query_id: z.string().uuid() }),
  add_checklist_slot: z.object({
    claim_id: z.string().uuid(),
    document_type: z.string().trim().min(1).max(120),
  }),
  file_as_new_slot: z.object({
    attachment_id: z.string().uuid(),
    claim_id: z.string().uuid(),
    checklist_slot: z.string().trim().min(1).max(120),
  }),
  confirm_query_deadline: z.object({
    query_id: z.string().uuid(),
    deadline: z.coerce.date().nullable().optional(),
  }),
  open_appeal: z.object({
    /*
      Capped, and deduplicated, because the card is the approval: ten
      rows with their amounts is something a desk reads, and the same
      id listed twice would contest once and look like two.
    */
    deduction_ids: z
      .array(z.string().uuid())
      .min(1)
      .max(10)
      .transform((ids) => [...new Set(ids)]),
  }),
} satisfies Record<ProposalKind, z.ZodTypeAny>;

export function isProposalKind(name: string): name is ProposalKind {
  return (PROPOSAL_KINDS as readonly string[]).includes(name);
}

export const ASSISTANT_TOOLS: Anthropic.Tool[] = [
  ...READ_TOOLS,
  ...WRITE_TOOLS,
];

/**
 * The roles allowed to change the checklist — the same pair
 * checklist.routes.ts gates its admin endpoints on.
 */
const CAN_MANAGE_RULES: Role[] = ["org_admin", "desk_head"];

export function canManageRules(role: Role): boolean {
  return CAN_MANAGE_RULES.includes(role);
}

/**
 * What this user is actually offered.
 *
 * A checklist rule applies to every future claim for an insurer and
 * procedure, so changing one is a desk head's call, not a desk
 * executive's. Withholding the tool stops the model putting a card in
 * front of someone who would only be refused when they clicked it. The
 * server check in assistant.service is still the gate — this just keeps
 * the conversation honest about what is on offer.
 */
export function toolsFor(role: Role): Anthropic.Tool[] {
  if (canManageRules(role)) return ASSISTANT_TOOLS;
  return ASSISTANT_TOOLS.filter(
    (tool) =>
      !DESK_HEAD_WRITES.has(tool.name) && !PORTFOLIO_TOOLS.has(tool.name),
  );
}
