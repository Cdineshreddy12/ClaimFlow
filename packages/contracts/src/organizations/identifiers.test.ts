import { describe, expect, it } from "vitest";
import {
  Gstin,
  IndianPhone,
  Pan,
  Pincode,
  RohiniId,
  gstinCheckDigit,
  isValidGstin,
} from "./identifiers.js";

describe("PAN", () => {
  it("accepts a well-formed PAN and upper-cases it", () => {
    expect(Pan.parse("abcde1234f")).toBe("ABCDE1234F");
  });

  it.each(["ABCD1234F", "ABCDE1234", "ABCDE12345", "ABCDEF234F"])(
    "rejects %s",
    (value) => {
      expect(Pan.safeParse(value).success).toBe(false);
    },
  );
});

describe("GSTIN", () => {
  // Matches the example GSTIN published in Indian GST documentation —
  // its real check digit is 'V', which is what pins the algorithm down.
  const VALID = "27AAPFU0939F1ZV";

  it("computes the documented check digit for a known GSTIN", () => {
    expect(gstinCheckDigit("27AAPFU0939F1Z")).toBe("V");
  });

  it("accepts a valid GSTIN", () => {
    expect(Gstin.parse(VALID)).toBe(VALID);
  });

  it("rejects a GSTIN whose shape is right but check digit is wrong", () => {
    expect(isValidGstin("27AAPFU0939F1ZX")).toBe(false);
  });

  it("rejects a transposition that still matches the shape regex", () => {
    // Swapping two digits keeps the pattern legal but breaks the checksum —
    // exactly the typo a regex-only check would wave through.
    expect(isValidGstin("27AAPFU0993F1ZV")).toBe(false);
  });

  it("rejects an impossible state code", () => {
    expect(isValidGstin("00AAPFU0939F1ZV")).toBe(false);
    expect(isValidGstin("45AAPFU0939F1ZV")).toBe(false);
  });

  it("accepts the special 97 and 99 state codes", () => {
    for (const prefix of ["97", "99"]) {
      const base = `${prefix}AAPFU0939F1Z`;
      expect(isValidGstin(base + gstinCheckDigit(base))).toBe(true);
    }
  });

  it("rejects anything that isn't 15 characters", () => {
    expect(isValidGstin("27AAPFU0939F1Z")).toBe(false);
  });
});

describe("RohiniId", () => {
  it("accepts exactly 13 digits", () => {
    expect(RohiniId.parse("1234567890123")).toBe("1234567890123");
  });

  it.each(["123456789012", "12345678901234", "12345678901AB"])(
    "rejects %s",
    (value) => {
      expect(RohiniId.safeParse(value).success).toBe(false);
    },
  );
});

describe("Pincode", () => {
  it("accepts a 6-digit code", () => {
    expect(Pincode.parse("422001")).toBe("422001");
  });

  it("rejects a leading zero — no Indian PIN starts with 0", () => {
    expect(Pincode.safeParse("022001").success).toBe(false);
  });

  it("rejects the wrong length", () => {
    expect(Pincode.safeParse("42200").success).toBe(false);
  });
});

describe("IndianPhone", () => {
  it.each([
    ["9876543210", "9876543210"],
    ["+919876543210", "9876543210"],
    ["09876543210", "9876543210"],
    ["98765 43210", "9876543210"],
    ["98765-43210", "9876543210"],
  ])("normalises %s to %s", (input, expected) => {
    expect(IndianPhone.parse(input)).toBe(expected);
  });

  it("rejects a number not starting 6-9", () => {
    expect(IndianPhone.safeParse("1234567890").success).toBe(false);
  });

  it("rejects a short number", () => {
    expect(IndianPhone.safeParse("98765").success).toBe(false);
  });
});
