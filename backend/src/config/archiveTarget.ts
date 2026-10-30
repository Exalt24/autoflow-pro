import type { S3ClientConfig } from "@aws-sdk/client-s3";

export type ArchiveProvider = "r2" | "s3";

// ArchivalService writes every run archive under this prefix, and the Terraform
// IAM policy in deploy/aws grants access to this prefix only.
export const ARCHIVE_PREFIX = "executions/";

export interface ArchiveTarget {
  provider: ArchiveProvider;
  enabled: boolean;
  bucket: string;
  client: S3ClientConfig;
  notConfiguredMessage: string;
}

type Vars = Record<string, string | undefined>;

export function parseArchiveProvider(raw: string | undefined): ArchiveProvider {
  const value = (raw ?? "").trim().toLowerCase();
  if (value === "" || value === "r2") return "r2";
  if (value === "s3") return "s3";
  throw new Error(`ARCHIVE_PROVIDER must be "r2" or "s3", got "${raw}"`);
}

export function resolveArchiveTarget(vars: Vars): ArchiveTarget {
  const provider = parseArchiveProvider(vars.ARCHIVE_PROVIDER);

  if (provider === "s3") {
    const endpoint = vars.AWS_S3_ENDPOINT || undefined;
    return {
      provider,
      enabled: !!vars.AWS_S3_BUCKET_NAME,
      bucket: vars.AWS_S3_BUCKET_NAME || "autoflow-archives",
      // No endpoint set: the SDK resolves the regional AWS S3 endpoint itself and
      // signs in with its default chain (environment, shared config or an IAM role).
      // An endpoint is only set to point at an emulator, which needs path-style URLs.
      client: {
        region: vars.AWS_REGION || vars.AWS_DEFAULT_REGION || "us-east-1",
        ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
      },
      notConfiguredMessage:
        "AWS S3 storage is not configured. Set AWS_S3_BUCKET_NAME (and AWS_REGION) to enable archival.",
    };
  }

  return {
    provider,
    enabled: !!(
      vars.CLOUDFLARE_R2_ACCESS_KEY_ID &&
      vars.CLOUDFLARE_R2_SECRET_ACCESS_KEY &&
      vars.CLOUDFLARE_R2_ACCOUNT_ID
    ),
    bucket: vars.CLOUDFLARE_R2_BUCKET_NAME || "autoflow-archives",
    client: {
      region: "auto",
      endpoint: `https://${vars.CLOUDFLARE_R2_ACCOUNT_ID || "missing"}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: vars.CLOUDFLARE_R2_ACCESS_KEY_ID || "",
        secretAccessKey: vars.CLOUDFLARE_R2_SECRET_ACCESS_KEY || "",
      },
    },
    notConfiguredMessage:
      "R2 storage is not configured. Set CLOUDFLARE_R2_ACCESS_KEY_ID, CLOUDFLARE_R2_SECRET_ACCESS_KEY, and CLOUDFLARE_R2_ACCOUNT_ID to enable archival.",
  };
}
