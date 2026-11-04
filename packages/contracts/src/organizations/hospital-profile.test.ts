import { describe, expect, it } from "vitest";
import {
  HospitalComplianceStep,
  HospitalContactStep,
  HospitalIdentityStep,
} from "./hospital-profile.js";

function messagesFor(
  schema: { safeParse: (v: unknown) => unknown },
  value: unknown,
) {
  const result = schema.safeParse(value) as {
    success: boolean;
    error?: { issues: { path: (string | number)[]; message: string }[] };
  };
  return Object.fromEntries(
    (result.error?.issues ?? []).map((i) => [i.path.join("."), i.message]),
  );
}

describe("HospitalIdentityStep", () => {
  it("gives a blank select a human message, not Zod's enum internals", () => {
    const messages = messagesFor(HospitalIdentityStep, {
      name: "A",
      legalEntityName: "B",
      hospitalType: "",
      ownershipType: "",
      bedCount: "",
    });
    expect(messages["hospitalType"]).toBe("Select a hospital type");
    expect(messages["ownershipType"]).toBe("Select an ownership type");
    // The thing that used to leak — guard against it coming back.
    expect(messages["hospitalType"]).not.toContain("Expected");
  });

  it("coerces a numeric string bed count", () => {
    const result = HospitalIdentityStep.parse({
      name: "A",
      legalEntityName: "B",
      hospitalType: "multi_specialty",
      ownershipType: "private",
      bedCount: "180",
    });
    expect(result.bedCount).toBe(180);
  });
});

describe("HospitalComplianceStep", () => {
  const base = {
    rohiniId: "1234567890123",
    registrationNumber: "MH-1",
    registrationValidUntil: "2028-03-31",
    pan: "AAPFU0939F",
  };

  it("accepts a hospital with no GSTIN", () => {
    const result = HospitalComplianceStep.safeParse({
      ...base,
      gstin: "",
      nabhStatus: "none",
    });
    expect(result.success).toBe(true);
  });

  it("requires an expiry date once NABH accreditation is claimed", () => {
    const messages = messagesFor(HospitalComplianceStep, {
      ...base,
      nabhStatus: "accredited",
      nabhValidUntil: "",
    });
    expect(messages["nabhValidUntil"]).toBe(
      "Add the expiry date on the NABH certificate",
    );
  });

  it("does not demand an expiry date when there's no accreditation", () => {
    const result = HospitalComplianceStep.safeParse({
      ...base,
      nabhStatus: "none",
      nabhValidUntil: "",
    });
    expect(result.success).toBe(true);
  });
});

describe("HospitalContactStep", () => {
  const base = {
    addressLine1: "1 Main Road",
    city: "Pune",
    state: "Maharashtra",
    pincode: "422001",
    phone: "9876543210",
    email: "desk@example.com",
    deskContactName: "Priya Nair",
    deskContactPhone: "+91 98765 43211",
    deskContactEmail: "priya@example.com",
  };

  it("normalises both phone numbers to bare 10 digits", () => {
    const result = HospitalContactStep.parse(base);
    expect(result.phone).toBe("9876543210");
    expect(result.deskContactPhone).toBe("9876543211");
  });

  it("gives a blank state select a human message", () => {
    const messages = messagesFor(HospitalContactStep, { ...base, state: "" });
    expect(messages["state"]).toBe("Select a state");
  });

  it("treats website as genuinely optional", () => {
    expect(
      HospitalContactStep.safeParse({ ...base, website: "" }).success,
    ).toBe(true);
  });
});
