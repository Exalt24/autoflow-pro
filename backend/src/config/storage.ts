import { supabase } from "./supabase.js";

export const BUCKETS = {
  WORKFLOW_ATTACHMENTS: "workflow-attachments",
  EXECUTION_SCREENSHOTS: "execution-screenshots",
} as const;

export async function uploadFile(
  bucket: string,
  path: string,
  file: Buffer | Uint8Array | ArrayBuffer | Blob,
  contentType?: string
): Promise<{ data: { path: string } | null; error: Error | null }> {
  const { data, error } = await supabase.storage
    .from(bucket)
    .upload(path, file, {
      contentType,
      upsert: false,
    });

  return { data, error };
}

export async function downloadFile(
  bucket: string,
  path: string
): Promise<{ data: Blob | null; error: Error | null }> {
  const { data, error } = await supabase.storage.from(bucket).download(path);

  return { data, error };
}

export async function deleteFile(
  bucket: string,
  path: string
): Promise<{ data: null; error: Error | null }> {
  const { data, error } = await supabase.storage.from(bucket).remove([path]);

  return { data: null, error };
}

export async function getPublicUrl(
  bucket: string,
  path: string
): Promise<string> {
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

export async function getSignedUrl(
  bucket: string,
  path: string,
  expiresIn: number = 3600
): Promise<{ data: { signedUrl: string } | null; error: Error | null }> {
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, expiresIn);

  return { data, error };
}

export async function listFiles(
  bucket: string,
  path: string = ""
): Promise<{
  data: Array<{ name: string; id: string }> | null;
  error: Error | null;
}> {
  const { data, error } = await supabase.storage.from(bucket).list(path);

  return { data, error };
}

export function getUserFilePath(userId: string, filename: string): string {
  return `${userId}/${filename}`;
}

export async function testStorageConnection(): Promise<boolean> {
  try {
    const { data, error } = await supabase.storage.listBuckets();

    if (error) {
      console.error("Storage connection test failed:", error.message);
      return false;
    }

    const requiredBuckets = [
      BUCKETS.WORKFLOW_ATTACHMENTS,
      BUCKETS.EXECUTION_SCREENSHOTS,
    ];

    const existingBuckets = data.map((b) => b.name);
    const missingBuckets = requiredBuckets.filter(
      (b) => !existingBuckets.includes(b)
    );

    if (missingBuckets.length > 0) {
      console.error(`Missing storage buckets: ${missingBuckets.join(", ")}`);
      console.log("Available buckets:", existingBuckets.join(", "));
      return false;
    }

    console.log("✓ Storage buckets configured correctly");
    return true;
  } catch (error) {
    console.error("Storage connection test error:", error);
    return false;
  }
}
