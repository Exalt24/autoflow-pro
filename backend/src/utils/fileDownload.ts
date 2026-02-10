import type { Page, Download } from "playwright-core";
import { uploadFile, getUserFilePath } from "../config/storage.js";

export interface DownloadResult {
  filename: string;
  size: number;
  path: string;
  url?: string;
}

export async function handleDownload(
  page: Page,
  triggerAction: () => Promise<void>,
  userId: string,
  timeout: number = 30000
): Promise<DownloadResult> {
  const downloadPromise = page.waitForEvent("download", { timeout });

  await triggerAction();

  const download: Download = await downloadPromise;
  const suggestedFilename = download.suggestedFilename();
  const buffer = await download.createReadStream().then(async (stream) => {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  });

  const storagePath = getUserFilePath(userId, suggestedFilename);

  const { error } = await uploadFile(
    "workflow-attachments",
    storagePath,
    buffer,
    getMimeType(suggestedFilename)
  );

  if (error) {
    throw new Error(`Failed to upload file: ${error.message}`);
  }

  return {
    filename: suggestedFilename,
    size: buffer.length,
    path: storagePath,
  };
}

function getMimeType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase();
  const mimeTypes: Record<string, string> = {
    pdf: "application/pdf",
    csv: "text/csv",
    json: "application/json",
    txt: "text/plain",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    xls: "application/vnd.ms-excel",
    zip: "application/zip",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
  };
  return mimeTypes[ext || ""] || "application/octet-stream";
}
