import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import "dotenv/config";
import { ARCHIVE_PREFIX, resolveArchiveTarget } from "./archiveTarget.js";

// ARCHIVE_PROVIDER picks the target: r2 (default, Cloudflare R2) or s3 (AWS S3).
// Both go through the same S3 client; only its configuration differs.
const target = resolveArchiveTarget(process.env);

export const r2Enabled = target.enabled;
export const archiveProvider = target.provider;
export const archiveNotConfiguredMessage = target.notConfiguredMessage;

const r2Client = new S3Client(target.client);

const BUCKET_NAME = target.bucket;

export interface R2UploadResult {
  key: string;
  bucket: string;
  size: number;
}

export async function uploadToR2(
  key: string,
  data: Buffer | Uint8Array | string,
  contentType?: string
): Promise<R2UploadResult> {
  const buffer = typeof data === "string" ? Buffer.from(data) : data;

  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: contentType || "application/octet-stream",
  });

  await r2Client.send(command);

  return {
    key,
    bucket: BUCKET_NAME,
    size: buffer.length,
  };
}

export async function downloadFromR2(key: string): Promise<Buffer> {
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  });

  const response = await r2Client.send(command);

  if (!response.Body) {
    throw new Error(`No data returned from ${target.provider}`);
  }

  const chunks: Uint8Array[] = [];
  for await (const chunk of response.Body as any) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

export async function deleteFromR2(key: string): Promise<void> {
  const command = new DeleteObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  });

  await r2Client.send(command);
}

export async function getSignedDownloadUrl(
  key: string,
  expiresIn: number = 3600
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  });

  return getSignedUrl(r2Client, command, { expiresIn });
}

export async function testR2Connection(): Promise<boolean> {
  try {
    // The AWS policy in deploy/aws lists only the archive prefix, and HeadBucket
    // needs an unrestricted list, so the S3 check lists that prefix instead.
    const command =
      target.provider === "s3"
        ? new ListObjectsV2Command({
            Bucket: BUCKET_NAME,
            Prefix: ARCHIVE_PREFIX,
            MaxKeys: 1,
          })
        : new HeadBucketCommand({ Bucket: BUCKET_NAME });
    await r2Client.send(command);
    return true;
  } catch (error) {
    console.error(`${target.provider} connection test failed:`, error);
    return false;
  }
}

export { r2Client, BUCKET_NAME };
