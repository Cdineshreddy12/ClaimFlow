import { beforeEach, describe, expect, it, vi } from "vitest";

const create = vi.fn();

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create };
  },
}));

const { ClaudeFormAuditor } = await import("./claude.js");

/**
 * The model's findings land in front of a desk executive about to send
 * a form to an insurer, so everything here is about what gets thrown
 * away: a finding pointing at a field that doesn't exist, a severity
 * nobody recognised, an empty message. None of those can be rendered,
 * and a dead link in a warning panel teaches people to ignore it.
 */

const FIELDS = [
  {
    key: "provisionalDiagnosis",
    label: "Provisional diagnosis",
    value: "Acute cholecystitis",
  },
  {
    key: "surgeryName",
    label: "Name of surgery",
    value: "Total knee replacement",
  },
  { key: "icd10Code", label: "ICD-10 code", value: "K81.0" },
];

function toolUse(findings: unknown) {
  return {
    content: [
      { type: "tool_use", name: "record_form_findings", input: { findings } },
    ],
  };
}

async function auditWith(findings: unknown) {
  create.mockResolvedValueOnce(toolUse(findings));
  return new ClaudeFormAuditor("test-key").audit({
    fields: FIELDS,
    procedureName: "Cholecystectomy",
  });
}

describe("ClaudeFormAuditor", () => {
  beforeEach(() => {
    create.mockReset();
  });

  it("keeps a finding that points at real fields", async () => {
    const result = await auditWith([
      {
        field_keys: ["provisionalDiagnosis", "surgeryName"],
        severity: "blocker",
        message:
          "The diagnosis is gallbladder disease but the surgery named is a knee replacement.",
      },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      severity: "blocker",
      fieldKeys: ["provisionalDiagnosis", "surgeryName"],
      source: "claude",
    });
  });

  it("returns nothing for a coherent form", async () => {
    expect(await auditWith([])).toEqual([]);
  });

  it("drops a finding whose fields don't exist", async () => {
    expect(
      await auditWith([
        {
          field_keys: ["patientBloodGroup"],
          severity: "blocker",
          message: "Blood group is inconsistent.",
        },
      ]),
    ).toEqual([]);
  });

  it("keeps only the field keys it recognises", async () => {
    const result = await auditWith([
      {
        field_keys: ["provisionalDiagnosis", "invented_key"],
        severity: "warning",
        message: "Diagnosis doesn't match.",
      },
    ]);
    expect(result[0]!.fieldKeys).toEqual(["provisionalDiagnosis"]);
  });

  it("drops a finding with no message to show", async () => {
    expect(
      await auditWith([
        { field_keys: ["icd10Code"], severity: "warning", message: "   " },
      ]),
    ).toEqual([]);
  });

  it("downgrades a severity it doesn't recognise rather than blocking on it", async () => {
    const result = await auditWith([
      {
        field_keys: ["icd10Code"],
        severity: "critical",
        message: "Code doesn't match the diagnosis.",
      },
    ]);
    expect(result[0]!.severity).toBe("warning");
  });

  it("survives a findings value that isn't a list", async () => {
    expect(await auditWith("none")).toEqual([]);
  });

  it("throws when the model answers in prose instead of calling the tool", async () => {
    create.mockResolvedValueOnce({
      content: [{ type: "text", text: "Looks fine to me." }],
    });

    await expect(
      new ClaudeFormAuditor("test-key").audit({
        fields: FIELDS,
        procedureName: "Cholecystectomy",
      }),
    ).rejects.toThrow("no structured output");
  });

  it("tells the model to stay out of the arithmetic the rules already check", async () => {
    await auditWith([]);
    const content = create.mock.calls[0]![0].messages[0].content as string;
    expect(content).toContain("Do NOT report");
    expect(content).toContain("arithmetic");
    // And gives it the claim's procedure for context.
    expect(content).toContain("Cholecystectomy");
  });

  it("forces the tool call", async () => {
    await auditWith([]);
    expect(create.mock.calls[0]![0].tool_choice).toEqual({
      type: "tool",
      name: "record_form_findings",
    });
  });
});
