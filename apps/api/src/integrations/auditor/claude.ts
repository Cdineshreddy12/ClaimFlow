import Anthropic from "@anthropic-ai/sdk";
import type { ReviewFinding } from "@claimflow/contracts";

const MODEL = "claude-sonnet-5";

/**
 * Reads a filled pre-auth form for the contradictions arithmetic can't
 * see: a diagnosis that doesn't match the procedure, an ICD-10 code
 * that doesn't match either, a line of treatment that doesn't fit the
 * clinical story.
 *
 * Strictly the second half of the review. The deterministic rules in
 * @claimflow/contracts handle dates, sums and missing identifiers,
 * because those are checkable facts and a model would make them
 * unexplainable. This handles only the part that genuinely needs
 * reading, and it is told to stay out of the other half.
 *
 * It never blocks anything. The findings land next to the rules'
 * findings in the same panel, labelled with their source, and a human
 * decides — docs/adr/0005.
 */
export interface FormAuditor {
  audit(input: {
    fields: { key: string; label: string; value: string }[];
    procedureName: string;
  }): Promise<ReviewFinding[]>;
}

const AUDIT_TOOL: Anthropic.Tool = {
  name: "record_form_findings",
  description:
    "Record clinical contradictions in a pre-authorisation form. Record nothing if the form is coherent.",
  input_schema: {
    type: "object",
    properties: {
      findings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            field_keys: {
              type: "array",
              items: { type: "string" },
              description:
                "The field keys this contradiction is between, exactly as given to you.",
            },
            severity: {
              type: "string",
              enum: ["blocker", "warning"],
              description:
                "blocker if an insurer would reject or query the form over it; warning if it is merely odd.",
            },
            message: {
              type: "string",
              description:
                "One sentence a desk executive can act on. Name the contradiction, not the rule.",
            },
          },
          required: ["field_keys", "severity", "message"],
        },
      },
    },
    required: ["findings"],
  },
};

const INSTRUCTIONS = [
  "You are checking a hospital's cashless pre-authorisation form before it goes to an insurer.",
  "",
  "Report only clinical or coding contradictions between the fields:",
  "- a diagnosis that doesn't match the named surgery or procedure",
  "- an ICD-10 or ICD-10-PCS code that doesn't correspond to the diagnosis or surgery stated",
  "- a line of treatment that contradicts the clinical findings",
  "- clinical findings that don't support the diagnosis",
  "- a room type, stay length or ICU charge that makes no sense for the stated treatment",
  "",
  "Do NOT report:",
  "- arithmetic, totals, or whether line items add up",
  "- date ordering, missing registration numbers, or malformed code formats",
  "- fields that are simply empty",
  "Those are checked separately and reporting them again would be noise.",
  "",
  "If the form is clinically coherent, record no findings. A clean form is the",
  "common case and inventing a finding to look useful costs a desk real time.",
].join("\n");

export class ClaudeFormAuditor implements FormAuditor {
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async audit(input: {
    fields: { key: string; label: string; value: string }[];
    procedureName: string;
  }): Promise<ReviewFinding[]> {
    const response = await this.client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      tools: [AUDIT_TOOL],
      tool_choice: { type: "tool", name: "record_form_findings" },
      messages: [
        {
          role: "user",
          content: [
            INSTRUCTIONS,
            "",
            `Claim procedure: ${input.procedureName}`,
            "",
            "--- form ---",
            ...input.fields.map((f) => `${f.key} (${f.label}): ${f.value}`),
          ].join("\n"),
        },
      ],
    });

    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
    );
    if (!toolUse) throw new Error("auditor returned no structured output");

    const result = toolUse.input as {
      findings?: {
        field_keys?: unknown;
        severity?: unknown;
        message?: unknown;
      }[];
    };
    if (!Array.isArray(result.findings)) return [];

    const knownKeys = new Set(input.fields.map((f) => f.key));

    return result.findings.flatMap((raw, index) => {
      const message = typeof raw.message === "string" ? raw.message.trim() : "";
      if (!message) return [];

      // Only keys we actually sent. A finding that points at a field
      // that doesn't exist can't be rendered against anything, and a
      // hallucinated key would otherwise reach the UI as a dead link.
      const fieldKeys = Array.isArray(raw.field_keys)
        ? raw.field_keys.filter(
            (key): key is string =>
              typeof key === "string" && knownKeys.has(key),
          )
        : [];
      if (fieldKeys.length === 0) return [];

      return [
        {
          code: `claude_${index}`,
          // Anything unrecognised lands as a warning. The model does not
          // get to block a submission on a severity we can't parse.
          severity: raw.severity === "blocker" ? "blocker" : "warning",
          fieldKeys,
          message,
          source: "claude" as const,
        },
      ];
    });
  }
}

let instance: FormAuditor | null | undefined;

/** Null when no key is configured — the rules still run without it. */
export function getFormAuditor(): FormAuditor | null {
  if (instance !== undefined) return instance;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  instance = apiKey ? new ClaudeFormAuditor(apiKey) : null;
  return instance;
}

export function setFormAuditorForTesting(a: FormAuditor | null | undefined) {
  instance = a;
}
