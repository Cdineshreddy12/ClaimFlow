import { describe, expect, it } from "vitest";
import {
  documentNameKey,
  isSameDocument,
  normaliseDocumentName,
  proposalIsWorthShowing,
} from "./checklist-learning.js";

describe("normaliseDocumentName", () => {
  it("strips the padding insurers write around a document name", () => {
    expect(normaliseDocumentName("Copy of the discharge summary")).toEqual([
      "discharge",
      "summary",
    ]);
  });

  it("folds plurals so one slot doesn't split in two", () => {
    expect(documentNameKey("Discharge summaries")).toBe(
      documentNameKey("Discharge summary"),
    );
    expect(documentNameKey("Investigation reports")).toBe(
      documentNameKey("Investigation report"),
    );
  });

  it("ignores case and punctuation", () => {
    expect(documentNameKey("Treating Doctor's Note")).toBe(
      documentNameKey("treating doctor note"),
    );
  });

  it("drops the word report, which insurers add and omit at random", () => {
    expect(documentNameKey("Ultrasound report")).toBe(
      documentNameKey("Ultrasound"),
    );
  });

  it("reduces an empty or meaningless name to nothing", () => {
    expect(normaliseDocumentName("  the of a  ")).toEqual([]);
    expect(normaliseDocumentName("")).toEqual([]);
  });
});

describe("isSameDocument", () => {
  it("matches the same document written differently", () => {
    expect(
      isSameDocument("Copy of discharge summary", "Discharge summary"),
    ).toBe(true);
    expect(isSameDocument("Final itemised bill", "Itemised bill")).toBe(true);
    expect(
      isSameDocument(
        "Duly filled pre-authorization form",
        "Pre-authorization form",
      ),
    ).toBe(true);
  });

  it("does not match two documents that merely share a word", () => {
    // The failure that would file a document into the wrong gap.
    expect(
      isSameDocument("Treating doctor's note", "Doctor's registration proof"),
    ).toBe(false);
    expect(isSameDocument("Pharmacy bill", "Itemised bill")).toBe(false);
    expect(isSameDocument("ICU chart", "OT notes")).toBe(false);
  });

  it("won't let a one-word name swallow a specific one", () => {
    expect(isSameDocument("Bill", "Itemised bill")).toBe(false);
    expect(isSameDocument("Bill", "bills")).toBe(true);
  });

  it("is symmetric", () => {
    expect(
      isSameDocument("Discharge summary", "Copy of discharge summary"),
    ).toBe(isSameDocument("Copy of discharge summary", "Discharge summary"));
  });

  it("never matches a name that normalises to nothing", () => {
    expect(isSameDocument("the of a", "Discharge summary")).toBe(false);
    expect(isSameDocument("", "")).toBe(false);
  });
});

describe("proposalIsWorthShowing", () => {
  it("needs enough submitted claims to be a pattern at all", () => {
    expect(
      proposalIsWorthShowing({ claimsRequested: 2, claimsSubmitted: 2 }),
    ).toBe(false);
  });

  it("needs the insurer to have asked often, not once", () => {
    expect(
      proposalIsWorthShowing({ claimsRequested: 1, claimsSubmitted: 12 }),
    ).toBe(false);
  });

  it("shows a pattern that holds across a third of claims", () => {
    expect(
      proposalIsWorthShowing({ claimsRequested: 4, claimsSubmitted: 12 }),
    ).toBe(true);
    expect(
      proposalIsWorthShowing({ claimsRequested: 9, claimsSubmitted: 14 }),
    ).toBe(true);
  });
});
