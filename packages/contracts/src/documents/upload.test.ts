import { describe, expect, it } from "vitest";
import {
  LOGO_MAX_BYTES,
  UPLOAD_MAX_BYTES,
  isAllowedUploadType,
  logoRejection,
  uploadRejection,
} from "./upload.js";

describe("isAllowedUploadType", () => {
  it("takes the scans and photographs a claim file is made of", () => {
    expect(isAllowedUploadType("application/pdf")).toBe(true);
    expect(isAllowedUploadType("image/jpeg")).toBe(true);
    expect(isAllowedUploadType("image/heic")).toBe(true);
  });

  it("refuses application/octet-stream", () => {
    // What a browser reports when it cannot tell. Accepting it is
    // accepting everything, which is what the old `z.string().min(1)`
    // amounted to.
    expect(isAllowedUploadType("application/octet-stream")).toBe(false);
  });

  it("refuses things a hospital has no business storing here", () => {
    expect(isAllowedUploadType("application/x-msdownload")).toBe(false);
    expect(isAllowedUploadType("video/mp4")).toBe(false);
    expect(isAllowedUploadType("text/html")).toBe(false);
  });

  it("is not fooled by casing", () => {
    expect(isAllowedUploadType("Application/PDF")).toBe(true);
  });
});

describe("uploadRejection", () => {
  const pdf = (size: number) => ({ type: "application/pdf", size });

  it("passes a scan of a sensible size", () => {
    expect(uploadRejection(pdf(2 * 1024 * 1024))).toBeNull();
  });

  it("names the limit rather than just refusing", () => {
    const why = uploadRejection(pdf(UPLOAD_MAX_BYTES + 1));
    expect(why).toContain("25MB");
  });

  it("accepts a file exactly on the limit", () => {
    expect(uploadRejection(pdf(UPLOAD_MAX_BYTES))).toBeNull();
  });

  it("refuses an empty file", () => {
    expect(uploadRejection(pdf(0))).toBe("That file is empty.");
  });

  it("says what to attach instead when the type is wrong", () => {
    expect(uploadRejection({ type: "video/mp4", size: 100 })).toContain(
      "PDF or a scan",
    );
  });

  it("has something to say when the browser could not read the type", () => {
    const why = uploadRejection({ type: "", size: 100 });
    expect(why).toContain("couldn't be read");
  });

  /*
    Type before size: a 90MB video should be told it is the wrong kind
    of thing, not that it is slightly too large, because shrinking it
    would not help.
  */
  it("complains about the type first when both are wrong", () => {
    const why = uploadRejection({
      type: "video/mp4",
      size: UPLOAD_MAX_BYTES * 4,
    });
    expect(why).toContain("PDF or a scan");
  });
});

describe("logoRejection", () => {
  const png = (size: number) => ({ type: "image/png", size });

  it("takes the two formats a letterhead can embed", () => {
    expect(logoRejection(png(40_000))).toBeNull();
    expect(logoRejection({ type: "image/jpeg", size: 40_000 })).toBeNull();
  });

  it("refuses the formats pdf-lib cannot decode", () => {
    // SVG and WebP are reasonable logo formats everywhere except here.
    expect(logoRejection({ type: "image/svg+xml", size: 4_000 })).toContain(
      "PNG or a JPEG",
    );
    expect(logoRejection({ type: "image/webp", size: 4_000 })).toContain(
      "PNG or a JPEG",
    );
  });

  it("names the limit rather than just refusing", () => {
    expect(logoRejection(png(LOGO_MAX_BYTES + 1))).toContain("2MB");
  });

  it("accepts a logo exactly on the limit", () => {
    expect(logoRejection(png(LOGO_MAX_BYTES))).toBeNull();
  });

  it("is a tighter bound than a document's", () => {
    // A 10MB scan is a fine document and a hopeless letterhead logo.
    expect(
      uploadRejection({ type: "application/pdf", size: 10 * 1024 * 1024 }),
    ).toBeNull();
    expect(logoRejection(png(10 * 1024 * 1024))).toContain("2MB");
  });
});
