import { config } from "dotenv";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Self-sufficient and lazy, same reasoning as db/client.ts: throwing on
// import (rather than on first actual call) would crash test collection
// for every file that imports this module, including ones that never
// touch S3 and run fine in CI without AWS credentials configured.
config({ path: "../../.env" });

let client: S3Client | undefined;
let bucket: string | undefined;

function getClient(): { client: S3Client; bucket: string } {
  if (!client) {
    const region = process.env.AWS_REGION;
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
    bucket = process.env.AWS_S3_BUCKET;
    if (!region || !accessKeyId || !secretAccessKey || !bucket) {
      throw new Error(
        "AWS_REGION/AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY/AWS_S3_BUCKET are not set — see .env.example",
      );
    }
    client = new S3Client({
      region,
      credentials: { accessKeyId, secretAccessKey },
    });
  }
  return { client, bucket: bucket! };
}

/** organizations/{orgId}/claims/{claimId}/{uuid}-{filename} — keeps every tenant's files under their own prefix. */
export function buildObjectKey(
  organizationId: string,
  claimId: string,
  fileName: string,
): string {
  const safeName = fileName.replace(/[^a-zA-Z0-9.\-_]/g, "_");
  return `organizations/${organizationId}/claims/${claimId}/${crypto.randomUUID()}-${safeName}`;
}

/** Pre-signed PUT URL the frontend uploads directly to — the API never streams file bytes through itself. */
export async function getUploadUrl(
  key: string,
  contentType: string,
  expiresInSeconds = 300,
): Promise<string> {
  const { client: s3, bucket: bucketName } = getClient();
  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(s3, command, { expiresIn: expiresInSeconds });
}

/** Pre-signed GET URL — the bucket is private, so viewing a document always goes through this, never a public URL. */
export async function getDownloadUrl(
  key: string,
  expiresInSeconds = 300,
): Promise<string> {
  const { client: s3, bucket: bucketName } = getClient();
  const command = new GetObjectCommand({ Bucket: bucketName, Key: key });
  return getSignedUrl(s3, command, { expiresIn: expiresInSeconds });
}

export async function deleteObject(key: string): Promise<void> {
  const { client: s3, bucket: bucketName } = getClient();
  await s3.send(new DeleteObjectCommand({ Bucket: bucketName, Key: key }));
}
