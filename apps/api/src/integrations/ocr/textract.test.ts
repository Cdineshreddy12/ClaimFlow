import { describe, expect, it } from "vitest";
import { canOcr } from "./textract.js";

describe("canOcr", () => {
  it.each(["image/jpeg", "image/jpg", "image/png", "image/tiff"])(
    "accepts %s",
    (type) => {
      expect(canOcr(type)).toBe(true);
    },
  );

  it("rejects PDF — the sync API can't take one, and the async API would need Textract its own S3 grant", () => {
    expect(canOcr("application/pdf")).toBe(false);
  });

  it.each(["text/plain", "application/msword", "image/svg+xml"])(
    "rejects %s",
    (type) => {
      expect(canOcr(type)).toBe(false);
    },
  );
});
