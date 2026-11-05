import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { defaultLayout } from "@claimflow/contracts";
import {
  buildPreauthForm,
  formLines,
  type PreauthFormValue,
} from "./preauth-form.builder.js";

const HOSPITAL = {
  name: "City General Hospital",
  address: "12 Station Road, Pune, Maharashtra, 411001",
  rohiniId: "8901234567890",
  registrationNumber: "MH-2019-001",
  deskContactName: "Priya Nair",
  deskContactPhone: "9876543211",
};

const CLAIM = {
  reference: "CLM-0001",
  patientName: "Rajendra Pawar",
  insurerName: "Company B",
  procedureName: "Gall bladder removal",
};

function confirmed(
  fieldKey: string,
  raw: string,
  display = raw,
): PreauthFormValue {
  return { fieldKey, raw, display, confirmed: true };
}

function suggested(fieldKey: string, display: string): PreauthFormValue {
  return { fieldKey, raw: null, display, confirmed: false };
}

function lineFor(values: PreauthFormValue[], key: string) {
  return formLines(defaultLayout(), values).find(
    (l) => l.placement.definition.fieldKey === key,
  );
}

/**
 * The decisions are tested here rather than by reading the rendered
 * bytes back: drawing is a straight loop over this list, and pulling
 * text out of a PDF reliably costs more than it proves — the first
 * attempt matched embedded font binary and would have passed against
 * noise.
 */
describe("formLines", () => {
  it("keeps the surgical fields when the line of treatment is surgical", () => {
    // Keyed off the raw enum value. An earlier version matched on the
    // display label, so "Surgical management" never equalled
    // "surgical_management" and these vanished from the printed form on
    // exactly the claims that needed them.
    const values = [
      confirmed(
        "lineOfTreatment",
        "surgical_management",
        "Surgical management",
      ),
    ];
    expect(lineFor(values, "surgeryName")).toBeDefined();
    expect(lineFor(values, "icd10PcsCode")).toBeDefined();
  });

  it("drops them once the treatment is ruled non-surgical", () => {
    const values = [
      confirmed("lineOfTreatment", "medical_management", "Medical management"),
    ];
    expect(lineFor(values, "surgeryName")).toBeUndefined();
  });

  it("keeps them while the treatment is still unanswered", () => {
    // Unanswered is not the same as ruled out; hiding them early would
    // prejudge the claim.
    expect(lineFor([], "surgeryName")).toBeDefined();
  });

  it("prints a confirmed value", () => {
    const values = [confirmed("provisionalDiagnosis", "Acute cholecystitis")];
    expect(lineFor(values, "provisionalDiagnosis")?.text).toBe(
      "Acute cholecystitis",
    );
  });

  it("leaves an unconfirmed suggestion blank", () => {
    // adr 0005: a suggestion is not a value, and a PDF leaving the
    // hospital is the least reversible place for an unchecked figure.
    const values = [suggested("icd10Code", "K80.0")];
    expect(lineFor(values, "icd10Code")?.text).toBe("");
  });

  it("covers every section in the layout's own order", () => {
    const sections = [
      ...new Set(formLines(defaultLayout(), []).map((l) => l.section)),
    ];
    expect(sections).toEqual([
      "Clinical details",
      "Admission",
      "Estimated cost",
    ]);
  });
});

describe("buildPreauthForm", () => {
  it("produces a loadable PDF named after the claim", async () => {
    const bytes = await buildPreauthForm(
      HOSPITAL,
      CLAIM,
      defaultLayout(),
      [confirmed("provisionalDiagnosis", "Acute cholecystitis")],
      new Date("2026-11-05T00:00:00Z"),
    );
    const doc = await PDFDocument.load(bytes);

    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
    expect(doc.getTitle()).toContain("CLM-0001");
    expect(doc.getTitle()).toContain("Rajendra Pawar");
  });

  it("renders a wholly empty form without throwing", async () => {
    // Real case: a desk prints the blank form to complete by hand
    // before anything has been extracted.
    const bytes = await buildPreauthForm(
      HOSPITAL,
      CLAIM,
      defaultLayout(),
      [],
      new Date("2026-11-05T00:00:00Z"),
    );
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(0);
  });

  it("survives a hospital with no ROHINI id or desk contact yet", async () => {
    const bytes = await buildPreauthForm(
      {
        name: "New Hospital",
        address: "",
        rohiniId: null,
        registrationNumber: null,
        deskContactName: null,
        deskContactPhone: null,
      },
      CLAIM,
      defaultLayout(),
      [],
      new Date("2026-11-05T00:00:00Z"),
    );
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(0);
  });

  // A 1×1 transparent PNG — the smallest input pdf-lib's embedPng accepts.
  const TINY_PNG = Uint8Array.from(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    ),
  );

  it("embeds a letterhead logo without throwing", async () => {
    const bytes = await buildPreauthForm(
      { ...HOSPITAL, logo: { bytes: TINY_PNG, contentType: "image/png" } },
      CLAIM,
      defaultLayout(),
      [],
      new Date("2026-11-05T00:00:00Z"),
    );
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(0);
  });

  it("colors the title with a valid accent and ignores an invalid one", async () => {
    for (const accentColorHex of ["#1A73E8", "not-a-color", null]) {
      const bytes = await buildPreauthForm(
        { ...HOSPITAL, accentColorHex },
        CLAIM,
        defaultLayout(),
        [],
        new Date("2026-11-05T00:00:00Z"),
      );
      expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(0);
    }
  });

  it("prints the tagline and footer note when the hospital has set them", async () => {
    const bytes = await buildPreauthForm(
      {
        ...HOSPITAL,
        tagline: "Multi-specialty, since 1998",
        footerNote: "Bank: HDFC · A/C 1234567890 · IFSC HDFC0001234",
      },
      CLAIM,
      defaultLayout(),
      [],
      new Date("2026-11-05T00:00:00Z"),
    );
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(0);
  });
});
