import dotenv from "dotenv";
dotenv.config();

interface Environment {
  PORT: number;
  NODE_ENV: string;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_KEY: string;
  UPSTASH_REDIS_URL?: string;
  CLOUDFLARE_R2_ACCOUNT_ID?: string;
  CLOUDFLARE_R2_ACCESS_KEY_ID?: string;
  CLOUDFLARE_R2_SECRET_ACCESS_KEY?: string;
  CLOUDFLARE_R2_BUCKET_NAME?: string;
  CORS_ORIGIN: string;
}

function validateEnvironment(): Environment {
  const required = [
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_KEY",
  ];

  for (const key of required) {
    if (!process.env[key]) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
  }

  const r2Variables = [
    "CLOUDFLARE_R2_ACCOUNT_ID",
    "CLOUDFLARE_R2_ACCESS_KEY_ID",
    "CLOUDFLARE_R2_SECRET_ACCESS_KEY",
    "CLOUDFLARE_R2_BUCKET_NAME",
  ];

  const missingR2 = r2Variables.filter((key) => !process.env[key]);

  if (missingR2.length > 0 && missingR2.length < r2Variables.length) {
    console.warn(
      `⚠️  Warning: Partial R2 configuration detected. Missing: ${missingR2.join(
        ", "
      )}`
    );
    console.warn("⚠️  Data archival features will be disabled.");
  }

  return {
    PORT: parseInt(process.env.PORT || "4000", 10),
    NODE_ENV: process.env.NODE_ENV || "development",
    SUPABASE_URL: process.env.SUPABASE_URL!,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY!,
    SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY!,
    UPSTASH_REDIS_URL: process.env.UPSTASH_REDIS_URL,
    CLOUDFLARE_R2_ACCOUNT_ID: process.env.CLOUDFLARE_R2_ACCOUNT_ID,
    CLOUDFLARE_R2_ACCESS_KEY_ID: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID,
    CLOUDFLARE_R2_SECRET_ACCESS_KEY:
      process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY,
    CLOUDFLARE_R2_BUCKET_NAME: process.env.CLOUDFLARE_R2_BUCKET_NAME,
    CORS_ORIGIN: process.env.CORS_ORIGIN || "*",
  };
}

export const env = validateEnvironment();
