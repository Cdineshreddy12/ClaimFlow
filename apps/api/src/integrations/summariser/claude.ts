import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-sonnet-5";

/** TPA emails are prose, not novels; this is generous and bounds cost on a pasted thread. */
const MAX_EMAIL_CHARS = 20_000;

export interface QuerySummary {
  summary: string;
  requestedItems: string[];
  /** ISO timestamp, only when the email actually states or implies one. */
  deadline: string | null;
  deadlineInferred: boolean;
}

export interface QuerySummariser {
  summarise(input: {
    rawEmail: string;
    /** When the TPA sent it, off the email's own header where it has one. */
    sentAt: Date;
  }): Promise<QuerySummary>;
}

const SUMMARISE_TOOL: Anthropic.Tool = {
  name: "record_query_summary",
  description: "Record what the TPA is asking for and by when.",
  input_schema: {
    type: "object",
    properties: {
      summary: {
        type: "string",
        description:
          "Two sentences at most, plain English, for a busy desk executive. Say who wants what and why it blocks the claim.",
      },
      requested_items: {
        type: "array",
        items: { type: "string" },
        description:
          "Each distinct document or piece of information requested, as a short noun phrase. Empty if the email asks for nothing concrete.",
      },
      deadline_iso: {
        type: ["string", "null"],
        description:
          "Absolute ISO 8601 timestamp of the reply deadline. Resolve relative phrases like 'within 48 hours' against the received date given. Null if the email states no deadline.",
      },
      deadline_was_relative: {
        type: "boolean",
        description:
          "True if you calculated the deadline from a relative phrase rather than reading an explicit date.",
      },
    },
    required: [
      "summary",
      "requested_items",
      "deadline_iso",
      "deadline_was_relative",
    ],
  },
};

/**
 * Turns a pasted TPA email into something a desk can act on at a glance.
 *
 * This never replaces the email. docs/adr/0005 requires the original to
 * render underneath the summary, always — the summary is a convenience,
 * the email is the record. Nothing here replies to anyone either.
 */
export class ClaudeSummariser implements QuerySummariser {
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async summarise(input: {
    rawEmail: string;
    sentAt: Date;
  }): Promise<QuerySummary> {
    const response = await this.client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      tools: [SUMMARISE_TOOL],
      tool_choice: { type: "tool", name: "record_query_summary" },
      messages: [
        {
          role: "user",
          content: [
            "An insurer or TPA sent this about a cashless hospital claim.",
            `Sent: ${input.sentAt.toISOString()}`,
            "",
            "Summarise what they want and by when. Resolve any relative",
            "deadline against the sent date above — their clock is what",
            "the window runs from, not when the hospital read it. Do not",
            "invent a deadline the email does not give.",
            "",
            "--- email ---",
            input.rawEmail.slice(0, MAX_EMAIL_CHARS),
          ].join("\n"),
        },
      ],
    });

    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
    );
    if (!toolUse) {
      throw new Error("summariser returned no structured output");
    }

    const result = toolUse.input as {
      summary: string;
      requested_items: string[];
      deadline_iso: string | null;
      deadline_was_relative: boolean;
    };

    // A malformed date would otherwise reach Postgres as Invalid Date and
    // blow up the insert; drop it and let the desk set one by hand.
    let deadline: string | null = null;
    if (result.deadline_iso) {
      const parsed = new Date(result.deadline_iso);
      if (!Number.isNaN(parsed.getTime())) deadline = parsed.toISOString();
    }

    return {
      summary: result.summary,
      requestedItems: Array.isArray(result.requested_items)
        ? result.requested_items.filter(
            (i) => typeof i === "string" && i.trim(),
          )
        : [],
      deadline,
      deadlineInferred: Boolean(deadline) && result.deadline_was_relative,
    };
  }
}

let instance: QuerySummariser | undefined;

/**
 * Null when no key is configured. Unlike document sorting there is no
 * useful non-model fallback here — you cannot summarise prose with a
 * filename match — so the desk keeps typing the summary by hand, which
 * is exactly what it did before.
 */
export function getSummariser(): QuerySummariser | null {
  if (instance) return instance;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  instance = new ClaudeSummariser(apiKey);
  return instance;
}

export function setSummariserForTesting(s: QuerySummariser | undefined): void {
  instance = s;
}
