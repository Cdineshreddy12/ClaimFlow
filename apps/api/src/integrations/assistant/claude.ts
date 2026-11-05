import Anthropic from "@anthropic-ai/sdk";
import {
  isProposalKind,
  isReadTool,
  type ProposalKind,
} from "../../modules/assistant/assistant.tools.js";

/**
 * The conversation loop behind the desk assistant.
 *
 * The shape of this is one decision: **the model never takes an
 * action.** Read tools run inside the loop because looking something up
 * changes nothing. A write tool stops the loop and becomes a card the
 * desk approves, and the approval goes through the ordinary audited
 * service as the signed-in user. docs/adr/0005 said a suggestion isn't
 * a value until a human says so; this is the same rule for verbs.
 *
 * It also means the worst a confused model can do here is waste
 * someone's time — the write path it would need doesn't exist on this
 * side of the approval.
 */

const MODEL = "claude-sonnet-5";

/**
 * How many times the model may call read tools before it has to answer.
 *
 * Six covers "find the claim, read it, read its queries" with room to
 * spare. The cap exists so a model that keeps re-reading the same claim
 * costs a slow answer rather than an unbounded bill.
 */
const MAX_STEPS = 6;

/**
 * Enough for a reply about a batch of files without stopping mid-word.
 *
 * 1536 was fine for one-paragraph answers and visibly wrong the first
 * time someone dropped five scans in: the reply was cut off at "matching
 * the cla", and the proposals it was about to make never arrived,
 * because a turn truncated by the limit never reaches its tool calls.
 */
const MAX_TOKENS = 4096;

/**
 * How much history travels back with each turn.
 *
 * The transcript is held by the browser and posted back, so this is the
 * only thing bounding what a long-running panel costs per message.
 */
const MAX_TRANSCRIPT_MESSAGES = 24;

export interface ProposedAction {
  /** The tool_use id — the approval request quotes it back. */
  id: string;
  kind: ProposalKind;
  input: Record<string, unknown>;
}

export interface AssistantTurn {
  reply: string;
  proposals: ProposedAction[];
  /** The full message list to send back on the next turn. */
  transcript: Anthropic.MessageParam[];
}

/**
 * What the panel is told while a turn is still running.
 *
 * The loop can spend ten seconds reading claims before it has a word to
 * say, and silence for ten seconds reads as broken. `tool` is what
 * fills that gap honestly — it says what is actually happening rather
 * than animating a dot.
 */
export type AssistantEvent =
  { type: "text"; text: string } | { type: "tool"; name: string };

export interface AssistantRunner {
  run(input: {
    transcript: Anthropic.MessageParam[];
    userContent: Anthropic.ContentBlockParam[];
    systemContext: string;
    /** Varies by role — see assistant.tools.toolsFor. */
    tools: Anthropic.Tool[];
    executeRead: (name: string, input: unknown) => Promise<unknown>;
    /** Called as the turn unfolds. Omit and the turn simply buffers. */
    onEvent?: (event: AssistantEvent) => void;
  }): Promise<AssistantTurn>;
}

const SYSTEM = [
  "You are the desk assistant inside ClaimFlow, a cashless insurance claims",
  "desk used by hospital insurance staff in India. You help one desk get",
  "through its day: finding claims, saying what is missing, reading documents",
  "someone has just handed you, and preparing actions for them to approve.",
  "",
  "How you work:",
  "",
  "- Files dropped into the panel are read before you ever see them, and you",
  "  are handed the result rather than the file. A scanned image goes through",
  "  OCR first (jpeg, png and tiff only — a PDF skips it and is read as a",
  "  picture), then a recogniser works out which claim it belongs to from the",
  "  patient name, UHID or claim reference on the page, then the classifier",
  "  picks a checklist slot. Count that as something you do when you are asked",
  "  what you can do: working out where a pile of scans belongs is what this",
  "  panel is for, and you would have no way of knowing it happens otherwise.",
  "- You cannot change anything yourself. The write tools do not perform an",
  "  action — they put a card in front of the user, who approves, edits or",
  "  dismisses it. So never say you have done something. Say what you are",
  "  proposing, and that it is waiting for them.",
  "- When the next step is one of your proposal tools, propose it. Do not ask",
  "  whether to — the card is the question, and it has a 'Not now' on it.",
  "  'Shall I mark the query replied?' costs the user a round trip to say yes",
  "  to something they could have declined in one click. Do still say what you",
  "  found in a line or two before the card — not asking is different from",
  "  saying nothing, and a card with no sentence above it is abrupt.",
  "- Resolve names to ids before anything else. A desk talks about 'Rajendra's",
  "  claim' and 'the Star Health query'; every tool wants an id. Use",
  "  search_claims and list_queries to find them, and if two claims could match,",
  "  ask which one rather than picking.",
  "- Abstain rather than guess. 'I can't tell which claim this belongs to' is a",
  "  useful answer from you and a cheap one for them to fix. A confident wrong",
  "  claim is neither.",
  "- A document that clearly belongs to a claim but fits none of its slots is",
  "  usually the checklist being wrong, not the document. There are two",
  "  separate fixes and they are not alternatives:",
  "    file_as_new_slot adds a slot to THAT ONE CLAIM and files the document",
  "    into it. This is the one that deals with the document in front of you.",
  "    add_checklist_slot changes the rules so future claims for that insurer",
  "    and procedure ask for it. It does nothing for the claim in hand.",
  "  Propose the first when the document plainly belongs to the claim. Propose",
  "  both when the gap looks like it will recur. If get_claim already lists the",
  "  slot under the rules for new claims, the rule exists and only this claim",
  "  predates it — say that instead of proposing it again.",
  "- 'What should I do next' is a clock question before it is an inbox",
  "  question. Start with get_sla_watch — a breached claim with a patient",
  "  waiting outranks an unread email — and only then look at queries.",
  "- Before anything is submitted, get_deduction_risk and",
  "  run_presubmission_review are the two that still change the outcome.",
  "  Afterwards they are trivia.",
  "- Two results that are easy to overstate, so don't: a review where",
  "  clinical_review_ran is false has only had its arithmetic checked, and a",
  "  risk assessment with enough_history false means nothing is known, not",
  "  that the claim is safe. Say which it is.",
  "- Before saying a claim does or doesn't already have a document, call",
  "  list_documents. The checklist only says a slot is satisfied; it never says",
  "  what satisfied it, and a file being dropped in for the second time looks",
  "  exactly like a new one until you check the names and dates.",
  "- Money questions about the hospital rather than one claim —",
  "  get_receivables_ageing, get_deduction_summary, get_insurer_turnaround and",
  "  get_appeal_worklist — are",
  "  the ones a CFO asks. Lead with what was avoidable: the product's premise is",
  "  that most of what an insurer cuts is paperwork, not clinical dispute, so",
  "  the avoidable share is the number worth putting first.",
  "- Never invent a value. If a figure, a date or a code is not in what you were",
  "  given, say it isn't there. The numbers here end up on forms an insurer",
  "  authorises against.",
  "- Quote what you read. When you say a document belongs to a claim, say what",
  "  on the page told you — a name, a UHID, a reference.",
  "- Say a status the way a person would — 'final bill submitted', not",
  "  FINAL_BILL_SUBMITTED. The tools give you both; the code is for filtering,",
  "  the label is for sentences. Same for confidence: it comes to you as a",
  "  percentage, so use it as one.",
  "- Be brief. These are busy people at a counter. Two or three sentences",
  "  usually, plain English, no preamble.",
  "- Markdown renders, so use it where it earns its place: a bulleted list for",
  "  what is missing from a claim, bold for a figure or a reference the eye",
  "  should land on. The panel is a narrow column, so no headings.",
  "- Name a file and you link it: `[scan_0017.jpg](document:<claim_id>/<doc_id>)`",
  "  using the `link` list_documents gives you, or",
  "  `[IMG_0423.jpg](attachment:<attachment_id>)` for something just dropped in.",
  "  A filename the reader cannot open is a filename they have to go and find.",
  "  Link it once per reply, not every mention.",
  "- You can draw a chart. Emit a fenced block tagged `chart` holding",
  '  {"type":"bar"|"donut","title":"…","unit":"currency"|"count"|"hours"|"percent",',
  '  "data":[{"label":"…","value":123}]} — up to eight rows. Use a bar for',
  "  comparing amounts across categories, a donut only for parts of one whole.",
  "  Plot numbers a tool just gave you and never a figure you worked out in your",
  "  head; each one is printed beside its bar, so an invented value is on show.",
  "  A chart is for a shape worth seeing — two numbers are a sentence.",
  "- Use a table when you are showing records rather than describing one:",
  "  several claims, several documents, several queries. Three or four columns",
  "  at most — the panel is narrow, and a wide table scrolls sideways. One",
  "  record is a sentence, not a one-row table.",
  "- The files someone just dropped already appear above your reply as a table",
  "  of what each matched. Don't repeat that table back; say the part it",
  "  can't hold — why something matched, and what to do about what didn't.",
  "- You never send anything to an insurer or a TPA. Marking a query replied",
  "  only records that the desk sent it through their own channel.",
].join("\n");

function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

/** Keeps the tail, and never starts on an assistant turn the API would reject. */
function trimTranscript(
  transcript: Anthropic.MessageParam[],
): Anthropic.MessageParam[] {
  const tail = transcript.slice(-MAX_TRANSCRIPT_MESSAGES);
  const firstUser = tail.findIndex((m) => m.role === "user");
  return firstUser <= 0 ? tail : tail.slice(firstUser);
}

export class ClaudeAssistant implements AssistantRunner {
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async run(input: {
    transcript: Anthropic.MessageParam[];
    userContent: Anthropic.ContentBlockParam[];
    systemContext: string;
    tools: Anthropic.Tool[];
    executeRead: (name: string, toolInput: unknown) => Promise<unknown>;
    onEvent?: (event: AssistantEvent) => void;
  }): Promise<AssistantTurn> {
    const messages: Anthropic.MessageParam[] = [
      ...trimTranscript(input.transcript),
      { role: "user", content: input.userContent },
    ];

    const proposals: ProposedAction[] = [];
    let reply = "";

    for (let step = 0; step < MAX_STEPS; step++) {
      // Streamed even when nobody is listening: one code path means the
      // buffered caller and the streaming one cannot drift, and the
      // final message is assembled by the SDK either way.
      const stream = this.client.messages.stream({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: `${SYSTEM}\n\n${input.systemContext}`,
        tools: input.tools,
        messages,
      });

      if (input.onEvent) {
        const emit = input.onEvent;
        stream.on("text", (delta) => emit({ type: "text", text: delta }));
      }

      const response = await stream.finalMessage();
      reply = textOf(response) || reply;
      messages.push({ role: "assistant", content: response.content });

      // Say so rather than stopping mid-sentence and looking broken.
      // Raising the ceiling makes this rare; it does not make it
      // impossible, and silently losing the end of an answer is the
      // kind of failure a desk only notices after acting on half of it.
      if (response.stop_reason === "max_tokens") {
        const note =
          "\n\n_(cut off — that was longer than I can say in one go. Ask me to continue.)_";
        reply += note;
        input.onEvent?.({ type: "text", text: note });
        return { reply, proposals, transcript: messages };
      }

      const toolUses = response.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
      );
      if (toolUses.length === 0)
        return { reply, proposals, transcript: messages };

      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const use of toolUses) {
        // Named before it runs: a read can take a second or two, and
        // "checking the clock" is a better thing to show than nothing.
        if (!isProposalKind(use.name))
          input.onEvent?.({ type: "tool", name: use.name });
        if (isProposalKind(use.name)) {
          proposals.push({
            id: use.id,
            kind: use.name,
            input: (use.input ?? {}) as Record<string, unknown>,
          });
          // The transcript has to stay valid — every tool_use needs a
          // result or the next turn is rejected — and this is also the
          // honest answer: it was shown, not done.
          results.push({
            type: "tool_result",
            tool_use_id: use.id,
            content:
              "Shown to the user as a proposal awaiting their approval. Do not repeat it or assume it was accepted.",
          });
          continue;
        }

        if (!isReadTool(use.name)) {
          results.push({
            type: "tool_result",
            tool_use_id: use.id,
            content: `No such tool: ${use.name}`,
            is_error: true,
          });
          continue;
        }

        try {
          const output = await input.executeRead(use.name, use.input);
          results.push({
            type: "tool_result",
            tool_use_id: use.id,
            content: JSON.stringify(output),
          });
        } catch (err) {
          // Handed back rather than thrown: a claim the user can't see
          // reaches here as an error, and the model should tell them it
          // found nothing instead of the panel showing a 500.
          results.push({
            type: "tool_result",
            tool_use_id: use.id,
            content: err instanceof Error ? err.message : String(err),
            is_error: true,
          });
        }
      }

      messages.push({ role: "user", content: results });

      // A proposal is a question for the human, so the turn ends on it
      // rather than the model carrying on talking to itself.
      if (proposals.length > 0) {
        return { reply, proposals, transcript: messages };
      }
    }

    return {
      reply:
        reply ||
        "I looked at a few things but couldn't get to an answer — try asking more specifically.",
      proposals,
      transcript: messages,
    };
  }
}

let instance: AssistantRunner | null | undefined;

/** Null when no ANTHROPIC_API_KEY is configured — the panel says so rather than failing. */
export function getAssistant(): AssistantRunner | null {
  if (instance === undefined) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    instance = apiKey ? new ClaudeAssistant(apiKey) : null;
  }
  return instance;
}

/** Tests reach for this to pin a specific runner. */
export function setAssistantForTesting(
  runner: AssistantRunner | null | undefined,
): void {
  instance = runner;
}
