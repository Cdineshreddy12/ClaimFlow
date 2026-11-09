import { config } from "dotenv";
import {
  CopyObjectCommand,
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

/** claims/{claimId}/{uuid}-{filename} — one bucket prefix per claim. */
export function buildObjectKey(claimId: string, fileName: string): string {
  const safeName = fileName.replace(/[^a-zA-Z0-9.\-_]/g, "_");
  return `claims/${claimId}/${crypto.randomUUID()}-${safeName}`;
}

/**
 * assistant/staging/{uuid}-{filename} — a file dropped into the
 * assistant before anyone knows which claim it belongs to.
 *
 * Its own prefix rather than a claim's, because at upload time there is
 * no claim to name: working that out is what the assistant is for. The
 * object moves under `claims/{claimId}/` the moment a human approves a
 * filing, so nothing that reads the claim prefix has to learn about
 * this one.
 */
export function buildStagingKey(fileName: string): string {
  const safeName = fileName.replace(/[^a-zA-Z0-9.\-_]/g, "_");
  return `assistant/staging/${crypto.randomUUID()}-${safeName}`;
}

/** hospital/branding/{uuid}-{filename} — the one hospital's letterhead logo. */
export function buildHospitalLogoKey(fileName: string): string {
  const safeName = fileName.replace(/[^a-zA-Z0-9.\-_]/g, "_");
  return `hospital/branding/${crypto.randomUUID()}-${safeName}`;
}

/** Pre-signed PUT URL the frontend uploads directly to — the API never streams file bytes through itself. */
/**
 * A link that will accept exactly one file, of exactly this size.
 *
 * `ContentLength` is signed, so it becomes a condition of the URL
 * rather than a hint: S3 refuses a PUT whose body is any other
 * length. Without it the signature constrained the key and the content
 * type and nothing else, and a link handed out for a 2MB scan would
 * equally have accepted two gigabytes — on a bucket billed to the
 * hospital.
 *
 * The browser sets `Content-Length` itself from the body it sends, so
 * an honest client needs to do nothing; a dishonest one gets a 403
 * from S3 before a byte is stored.
 */
export async function getUploadUrl(
  key: string,
  contentType: string,
  sizeBytes: number,
  expiresInSeconds = 300,
): Promise<string> {
  const { client: s3, bucket: bucketName } = getClient();
  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    ContentType: contentType,
    ContentLength: sizeBytes,
  });
  return getSignedUrl(s3, command, {
    expiresIn: expiresInSeconds,
    // Signed rather than left to the client, which is the whole point.
    signableHeaders: new Set(["content-length", "content-type"]),
  });
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

/**
 * Pulls the actual bytes into the API process. Everything else here
 * hands out pre-signed URLs so file data never passes through the
 * server — this is the one exception, because building a merged PDF
 * packet means reading each source document, and a pre-signed URL
 * can't be read by pdf-lib without a round trip back out to S3 anyway.
 */
export async function getObjectBytes(key: string): Promise<Uint8Array> {
  const { client: s3, bucket: bucketName } = getClient();
  const result = await s3.send(
    new GetObjectCommand({ Bucket: bucketName, Key: key }),
  );
  if (!result.Body) throw new Error(`empty object body for key: ${key}`);
  return result.Body.transformToByteArray();
}

export async function putObject(
  key: string,
  body: Uint8Array,
  contentType: string,
): Promise<void> {
  const { client: s3, bucket: bucketName } = getClient();
  await s3.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

/**
 * Moves an object, for a staged attachment being filed onto a claim.
 *
 * Copy-then-delete rather than leaving it where it landed: `claims/
 * {claimId}/` is how everything else in the bucket is organised, and a
 * document whose bytes sit under an assistant prefix would be the one
 * exception every lifecycle rule and every bucket audit has to know
 * about. The delete is deliberately not fatal — a stray staged copy
 * costs pennies, whereas failing here after the copy succeeded would
 * lose the desk a filing that actually worked.
 */
export async function moveObject(from: string, to: string): Promise<void> {
  const { client: s3, bucket: bucketName } = getClient();
  await s3.send(
    new CopyObjectCommand({
      Bucket: bucketName,
      CopySource: `${bucketName}/${from}`,
      Key: to,
    }),
  );
  try {
    await deleteObject(from);
  } catch (err) {
    console.error("staged object copied but not cleaned up", {
      from,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function deleteObject(key: string): Promise<void> {
  const { client: s3, bucket: bucketName } = getClient();
  await s3.send(new DeleteObjectCommand({ Bucket: bucketName, Key: key }));
}
