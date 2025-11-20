import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "./environment.js";

const r2Client = new S3Client({
  region: "auto",
  endpoint: `https://${env.CLOUDFLARE_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: env.CLOUDFLARE_R2_ACCESS_KEY_ID || "",
    secretAccessKey: env.CLOUDFLARE_R2_SECRET_ACCESS_KEY || "",
  },
});

const BUCKET_NAME = env.CLOUDFLARE_R2_BUCKET_NAME || "autoflow-archives";

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
    throw new Error("No data returned from R2");
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
    const command = new HeadBucketCommand({ Bucket: BUCKET_NAME });
    await r2Client.send(command);
    return true;
  } catch (error) {
    console.error("R2 connection test failed:", error);
    return false;
  }
}

export { r2Client, BUCKET_NAME };
