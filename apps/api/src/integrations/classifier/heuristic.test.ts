import { describe, expect, it } from "vitest";
import { HeuristicClassifier } from "./heuristic.js";

const SLOTS = [
  "Pre-authorization form",
  "Treating doctor's note",
  "Ultrasound report (abdomen)",
  "Photo ID proof",
  "Policy / e-card copy",
  "Previous treatment records",
];

const classifier = new HeuristicClassifier();

function classify(fileName: string, candidateSlots = SLOTS) {
  return classifier.classify({
    fileName,
    contentType: "image/jpeg",
    candidateSlots,
    readBytes: async () => {
      throw new Error("heuristic must never read the file");
    },
  });
}

describe("HeuristicClassifier", () => {
  it("matches an obviously-named scan to its slot", async () => {
    const result = await classify("ultrasound_report_0423.jpg");
    expect(result.slot).toBe("Ultrasound report (abdomen)");
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.classifiedBy).toBe("heuristic");
  });

  it("never reads the file — a filename match needs no bytes", async () => {
    // readBytes throws; reaching it would fail this test.
    await expect(classify("photo_id.png")).resolves.toBeDefined();
  });

  it("returns null rather than guessing on an opaque camera filename", async () => {
    const result = await classify("IMG_0423.jpg");
    expect(result.slot).toBeNull();
    expect(result.confidence).toBe(0);
    expect(result.reason).toContain("IMG_0423.jpg");
  });

  it("explains itself with the words it actually matched", async () => {
    const result = await classify("policy-ecard-copy.pdf");
    expect(result.slot).toBe("Policy / e-card copy");
    expect(result.reason).toContain("policy");
  });

  it("never exceeds 0.85 — a filename describes a name, not contents", async () => {
    const result = await classify("pre-authorization.pdf");
    expect(result.confidence).toBeLessThanOrEqual(0.85);
  });

  it("ignores words shared by most slots", async () => {
    // "report" and "form" appear across slots, so a file named only
    // "report.pdf" distinguishes nothing and should not match.
    const result = await classify("report.pdf");
    expect(result.slot).toBeNull();
  });

  it("prefers the slot with the stronger overlap", async () => {
    const result = await classify("previous-treatment-ultrasound.jpg");
    // "previous" and "treatment" are both distinguishing; "ultrasound"
    // is one of two for the other slot.
    expect(result.slot).toBe("Previous treatment records");
  });

  it("only ever suggests slots on this claim's checklist", async () => {
    const result = await classify("ultrasound_report.jpg", [
      "Pre-authorization form",
      "Photo ID proof",
    ]);
    expect(result.slot).toBeNull();
  });

  it("handles an empty checklist without blowing up", async () => {
    const result = await classify("anything.pdf", []);
    expect(result.slot).toBeNull();
  });
});
