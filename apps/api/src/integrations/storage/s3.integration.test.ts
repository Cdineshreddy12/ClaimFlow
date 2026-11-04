import { config } from "dotenv";
config({ path: "../../.env" });

import { describe, expect, it } from "vitest";
import {
  buildObjectKey,
  deleteObject,
  getDownloadUrl,
  getUploadUrl,
} from "./s3.js";

const hasAwsCreds = Boolean(
  process.env.AWS_ACCESS_KEY_ID &&
  process.env.AWS_SECRET_ACCESS_KEY &&
  process.env.AWS_S3_BUCKET,
);

/** Hits the real S3 bucket in AWS_S3_BUCKET. Skips when AWS creds aren't set (e.g. in CI). */
describe.skipIf(!hasAwsCreds)("s3 (integration)", () => {
  it("round-trips an object through pre-signed PUT and GET URLs", async () => {
    const key = buildObjectKey("test-org", "test-claim", "report.txt");
    expect(key).toContain("organizations/test-org/claims/test-claim/");

    const uploadUrl = await getUploadUrl(key, "text/plain");
    const putResponse = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": "text/plain" },
      body: "claimflow integration test content",
    });
    expect(putResponse.ok).toBe(true);

    const downloadUrl = await getDownloadUrl(key);
    const getResponse = await fetch(downloadUrl);
    const body = await getResponse.text();
    expect(body).toBe("claimflow integration test content");

    await deleteObject(key);

    const afterDelete = await fetch(downloadUrl);
    expect(afterDelete.status).toBe(404);
  });
});
