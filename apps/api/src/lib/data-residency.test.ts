import { describe, expect, it, vi } from "vitest";
import { assertDataResidency, residencyFindings } from "./data-residency.js";

/**
 * The DPDP Act 2023 treats a patient's health records as sensitive
 * personal data and the brief names data residency as a constraint.
 * Before this, the only thing enforcing it was a comment in
 * `.env.example` — so a deploy that mistyped a region stored every scan
 * outside India and nothing said a word.
 */
describe("data residency", () => {
  it("accepts both Indian regions", () => {
    expect(residencyFindings({ AWS_REGION: "ap-south-1" })).toHaveLength(0);
    // Hyderabad, opened 2022 — in-country, so not a finding.
    expect(residencyFindings({ AWS_REGION: "ap-south-2" })).toHaveLength(0);
  });

  it("names the setting at fault, so the fix is obvious", () => {
    expect(residencyFindings({ AWS_REGION: "us-east-1" })).toEqual([
      { setting: "AWS_REGION", value: "us-east-1" },
    ]);
  });

  it("checks OCR separately — Textract can be pointed elsewhere", () => {
    const findings = residencyFindings({
      AWS_REGION: "ap-south-1",
      AWS_TEXTRACT_REGION: "us-west-2",
    });

    // A handwritten doctor's note sent to Oregon for reading has left
    // the country just as surely as one stored there.
    expect(findings).toEqual([
      { setting: "AWS_TEXTRACT_REGION", value: "us-west-2" },
    ]);
  });

  it("reads the region out of a Supabase pooler host", () => {
    expect(
      residencyFindings({
        DATABASE_URL:
          "postgresql://u:p@aws-0-us-east-2.pooler.supabase.com:6543/postgres",
      }),
    ).toEqual([{ setting: "DATABASE_URL", value: "us-east-2" }]);
  });

  it("says nothing about a URL that carries no region", () => {
    // Guessing a region from a project ref would be inventing a fact.
    expect(
      residencyFindings({
        DATABASE_URL: "postgresql://u:p@db.abcdefgh.supabase.co:5432/postgres",
      }),
    ).toHaveLength(0);
  });

  it("stays quiet when nothing is configured", () => {
    // The S3 client already refuses to start without a region. Adding
    // "undefined is not in India" buries the real error under a second.
    expect(residencyFindings({})).toHaveLength(0);
  });

  it("refuses to boot in production", () => {
    expect(() =>
      assertDataResidency({ NODE_ENV: "production", AWS_REGION: "eu-west-1" }),
    ).toThrow(/DPDP/);
  });

  it("warns but runs elsewhere — local dev uses LocalStack", () => {
    const log = vi.fn();
    expect(() =>
      assertDataResidency({ NODE_ENV: "development", AWS_REGION: "eu-west-1" }),
    ).not.toThrow();
    assertDataResidency(
      { NODE_ENV: "development", AWS_REGION: "eu-west-1" },
      log,
    );
    expect(log).toHaveBeenCalledWith(expect.stringContaining("WARNING"));
  });

  it("is silent on a correctly configured production server", () => {
    const log = vi.fn();
    assertDataResidency(
      {
        NODE_ENV: "production",
        AWS_REGION: "ap-south-1",
        AWS_TEXTRACT_REGION: "ap-south-1",
      },
      log,
    );
    expect(log).not.toHaveBeenCalled();
  });
});

/**
 * The override is a compliance control with a hole deliberately cut in
 * it, so the shape of the hole is worth pinning down.
 */
describe("DATA_RESIDENCY_ACK", () => {
  const outside = {
    NODE_ENV: "production",
    DATABASE_URL:
      "postgres://u:p@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres",
  } as NodeJS.ProcessEnv;

  it("still refuses production with no acknowledgement", () => {
    expect(() => assertDataResidency(outside, () => {})).toThrow(
      /outside India/,
    );
  });

  it("lets a reasoned acknowledgement through, and says so every boot", () => {
    const lines: string[] = [];
    assertDataResidency(
      { ...outside, DATA_RESIDENCY_ACK: "demo on synthetic records" },
      (m) => lines.push(m),
    );

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("DATA RESIDENCY OVERRIDDEN");
    // The reason given, quoted back — the log line is the evidence.
    expect(lines[0]).toContain("demo on synthetic records");
    expect(lines[0]).toContain("must not hold real patient data");
  });

  it("treats whitespace as no acknowledgement at all", () => {
    // Otherwise DATA_RESIDENCY_ACK=" " is a silent bypass, which is the
    // one thing this must not be.
    expect(() =>
      assertDataResidency({ ...outside, DATA_RESIDENCY_ACK: "   " }, () => {}),
    ).toThrow(/outside India/);
  });

  it("stays quiet when the regions are in India, acknowledged or not", () => {
    const lines: string[] = [];
    assertDataResidency(
      {
        NODE_ENV: "production",
        AWS_REGION: "ap-south-1",
        DATA_RESIDENCY_ACK: "not needed",
      } as NodeJS.ProcessEnv,
      (m) => lines.push(m),
    );

    expect(lines).toEqual([]);
  });
});
