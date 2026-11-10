import { describe, expect, it } from "vitest";
import { LOGO_MAX_BYTES } from "@claimflow/contracts";
import { RequestLogoUploadUrlBody } from "./hospital.schema.js";

const body = (over: Record<string, unknown> = {}) => ({
  fileName: "logo.png",
  contentType: "image/png",
  sizeBytes: 40_000,
  ...over,
});

/*
  Logo upload was broken in production for every user: the schema grew a
  required `sizeBytes` and the one client that calls it was never
  updated, so every attempt failed. `z.coerce.number()` is what hid it —
  it ran Number(undefined), got NaN, and reported "expected number,
  received nan", which reads as a client sending the wrong type rather
  than a client sending nothing. The field is no longer coerced, so the
  error names what is actually wrong.
*/
describe("RequestLogoUploadUrlBody", () => {
  it("accepts a reasonable logo", () => {
    expect(RequestLogoUploadUrlBody.safeParse(body()).success).toBe(true);
  });

  it("says the size is missing rather than that it is not a number", () => {
    const { fileName, contentType } = body();
    const result = RequestLogoUploadUrlBody.safeParse({
      fileName,
      contentType,
    });

    expect(result.success).toBe(false);
    const issue = result.error!.issues.find((i) => i.path[0] === "sizeBytes")!;
    expect(issue.message).toBe("sizeBytes is required");
    // The symptom that sent this the wrong way for a week.
    expect(JSON.stringify(result.error!.issues)).not.toContain("nan");
  });

  it("holds the same 2MB bound the browser checks against", () => {
    expect(
      RequestLogoUploadUrlBody.safeParse(body({ sizeBytes: LOGO_MAX_BYTES }))
        .success,
    ).toBe(true);
    expect(
      RequestLogoUploadUrlBody.safeParse(
        body({ sizeBytes: LOGO_MAX_BYTES + 1 }),
      ).success,
    ).toBe(false);
  });

  it("refuses an empty file and a type a letterhead cannot carry", () => {
    expect(
      RequestLogoUploadUrlBody.safeParse(body({ sizeBytes: 0 })).success,
    ).toBe(false);
    expect(
      RequestLogoUploadUrlBody.safeParse(body({ contentType: "image/svg+xml" }))
        .success,
    ).toBe(false);
  });
});
